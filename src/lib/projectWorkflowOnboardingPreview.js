/**
 * Controlled Workflow Onboarding Preview — read-only by default.
 *
 * Suggests workflow_managed / workflow_entry_stage / exemptions for existing
 * projects based on active workflow reminders or completed status.
 * Does NOT create or close reminders.
 */
import { api as base44 } from '@/api/apiClient';
import {
  loadReminderEngineCache,
  REMINDER_STATUS,
} from '@/lib/reminderEngine';
import { isProjectExcludedFromWorkflowReminders } from '@/lib/projectWorkflowExclusions';
import { SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX } from '@/lib/workStageReminderRules';
import {
  APPLY_PROJECT_WORKFLOW_ONBOARDING_CONFIRM_TEXT,
  buildWorkflowOnboardingPatch,
  formatHistoricalExemptions,
  HISTORICAL_EXEMPTION_KEY,
  isCompletedNoRemindersEntry,
  isWorkflowManagedProject,
  WORKFLOW_ENTRY_STAGE,
  WORKFLOW_ORIGIN,
} from '@/lib/projectWorkflowOnboarding';

const isOpenStatus = (status) => (
  status === REMINDER_STATUS.ACTIVE || status === REMINDER_STATUS.SNOOZED
);

const WORKFLOW_REMINDER_PREFIXES = [
  'project_needs_proposal:',
  'project_waiting_followup:',
  'project_needs_work_stages:',
  'signed_proposal_needs_work_stages:',
  'proposal_waiting_followup:',
];

function listOpenWorkflowRemindersForProject(cache, projectId, signedProposalsById) {
  const projectIdStr = String(projectId).trim();
  const rows = [];

  for (const reminder of cache.reminders || []) {
    if (!isOpenStatus(reminder?.status)) continue;

    const conditionKey = String(reminder?.condition_key || '').trim();
    if (!WORKFLOW_REMINDER_PREFIXES.some((prefix) => conditionKey.startsWith(prefix))) {
      continue;
    }

    let matchesProject = String(reminder?.project_id || '').trim() === projectIdStr;

    if (!matchesProject && conditionKey.startsWith(SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX)) {
      const signedProposal = signedProposalsById.get(String(reminder?.source_id || '').trim());
      matchesProject = String(signedProposal?.project_id || '').trim() === projectIdStr;
    }

    if (!matchesProject && conditionKey.endsWith(`:${projectIdStr}`)) {
      matchesProject = true;
    }

    if (!matchesProject) continue;

    rows.push({
      reminder_id: reminder.id,
      reminder_title: reminder.title || '',
      condition_key: conditionKey,
      reminder_status: reminder.status,
      reminder_kind: conditionKey.split(':')[0],
    });
  }

  return rows;
}

function inferOnboardingFromActiveReminders(project, activeReminders, signedProposalsById) {
  const byKind = new Set(activeReminders.map((row) => row.reminder_kind));

  if (byKind.has('signed_proposal_needs_work_stages')) {
    const spReminder = activeReminders.find((row) => row.reminder_kind === 'signed_proposal_needs_work_stages');
    const signedProposalId = String(spReminder?.condition_key || '').split(':')[1] || '';
    const signedProposal = signedProposalsById.get(signedProposalId);
    const origin = signedProposal?.id ? WORKFLOW_ORIGIN.NATIVE : WORKFLOW_ORIGIN.LEGACY_BOOTSTRAP;

    return {
      reason: 'Active signed_proposal_needs_work_stages reminder',
      suggested_patch: buildWorkflowOnboardingPatch({
        workflow_managed: true,
        workflow_origin: origin,
        workflow_entry_stage: WORKFLOW_ENTRY_STAGE.WORK_STAGES,
        workflow_historical_exemptions: '',
        workflow_onboarding_note: 'Inferred from active signed_proposal_needs_work_stages reminder',
      }),
      active_reminders: activeReminders,
    };
  }

  if (byKind.has('project_needs_work_stages')) {
    return {
      reason: 'Active project_needs_work_stages bridge reminder',
      suggested_patch: buildWorkflowOnboardingPatch({
        workflow_managed: true,
        workflow_origin: WORKFLOW_ORIGIN.LEGACY_BOOTSTRAP,
        workflow_entry_stage: WORKFLOW_ENTRY_STAGE.WORK_STAGES,
        workflow_historical_exemptions: formatHistoricalExemptions([
          HISTORICAL_EXEMPTION_KEY.PROPOSAL,
          HISTORICAL_EXEMPTION_KEY.SIGNED_PROPOSAL,
        ]),
        workflow_onboarding_note: 'Inferred from active project_needs_work_stages bridge reminder',
      }),
      active_reminders: activeReminders,
    };
  }

  if (byKind.has('project_waiting_followup') || byKind.has('proposal_waiting_followup')) {
    return {
      reason: 'Active proposal follow-up reminder',
      suggested_patch: buildWorkflowOnboardingPatch({
        workflow_managed: true,
        workflow_origin: WORKFLOW_ORIGIN.LEGACY_BOOTSTRAP,
        workflow_entry_stage: WORKFLOW_ENTRY_STAGE.PROPOSAL_FOLLOWUP,
        workflow_historical_exemptions: HISTORICAL_EXEMPTION_KEY.PROPOSAL,
        workflow_onboarding_note: 'Inferred from active follow-up reminder',
      }),
      active_reminders: activeReminders,
    };
  }

  if (byKind.has('project_needs_proposal')) {
    return {
      reason: 'Active project_needs_proposal reminder',
      suggested_patch: buildWorkflowOnboardingPatch({
        workflow_managed: true,
        workflow_origin: WORKFLOW_ORIGIN.LEGACY_BOOTSTRAP,
        workflow_entry_stage: WORKFLOW_ENTRY_STAGE.PROPOSAL,
        workflow_historical_exemptions: '',
        workflow_onboarding_note: 'Inferred from active project_needs_proposal reminder',
      }),
      active_reminders: activeReminders,
    };
  }

  return null;
}

function planOnboardingForProject(project, cache, signedProposalsById) {
  if (!project?.id) return null;

  if (isProjectExcludedFromWorkflowReminders(project)) {
    return {
      project_id: project.id,
      project_name: project.name || '',
      project_status: project.status || '',
      bucket: 'workflowExcludedProjects',
      action: 'skip_excluded',
      reason: 'Project is excluded from workflow reminders',
    };
  }

  if (isWorkflowManagedProject(project) && project.workflow_onboarded_at) {
    return {
      project_id: project.id,
      project_name: project.name || '',
      project_status: project.status || '',
      bucket: 'alreadyOnboarded',
      action: 'report_only',
      reason: 'Project already has workflow onboarding fields applied',
      current_fields: {
        workflow_managed: project.workflow_managed,
        workflow_origin: project.workflow_origin,
        workflow_entry_stage: project.workflow_entry_stage,
        workflow_historical_exemptions: project.workflow_historical_exemptions || '',
      },
    };
  }

  // Idempotent after Apply: completed_no_reminders is a terminal onboarding state
  // (workflow_managed may be false).
  if (isCompletedNoRemindersEntry(project)) {
    return {
      project_id: project.id,
      project_name: project.name || '',
      project_status: project.status || '',
      bucket: WORKFLOW_ENTRY_STAGE.COMPLETED_NO_REMINDERS,
      action: 'report_only',
      reason: 'Project already marked as completed_no_reminders',
      current_fields: {
        workflow_managed: project.workflow_managed,
        workflow_origin: project.workflow_origin,
        workflow_entry_stage: project.workflow_entry_stage,
        workflow_historical_exemptions: project.workflow_historical_exemptions || '',
      },
    };
  }

  const activeReminders = listOpenWorkflowRemindersForProject(
    cache,
    project.id,
    signedProposalsById,
  );

  const inferred = inferOnboardingFromActiveReminders(project, activeReminders, signedProposalsById);
  if (inferred) {
    const entryStage = inferred.suggested_patch.workflow_entry_stage;
    return {
      project_id: project.id,
      project_name: project.name || '',
      project_status: project.status || '',
      bucket: entryStage,
      action: 'suggest_onboarding',
      ...inferred,
    };
  }

  const status = String(project.status || '').trim();
  if (status === 'completed' && activeReminders.length === 0) {
    return {
      project_id: project.id,
      project_name: project.name || '',
      project_status: status,
      bucket: WORKFLOW_ENTRY_STAGE.COMPLETED_NO_REMINDERS,
      action: 'suggest_onboarding',
      reason: 'Completed project with no active workflow reminders',
      suggested_patch: buildWorkflowOnboardingPatch({
        workflow_managed: false,
        workflow_origin: WORKFLOW_ORIGIN.NONE,
        workflow_entry_stage: WORKFLOW_ENTRY_STAGE.COMPLETED_NO_REMINDERS,
        workflow_historical_exemptions: '',
        workflow_onboarding_note: 'Completed project — no workflow reminders at this stage',
      }),
      active_reminders: [],
    };
  }

  return null;
}

function emptyOnboardingGroups() {
  return {
    proposal: [],
    proposal_followup: [],
    work_stages: [],
    completed_no_reminders: [],
    alreadyOnboarded: [],
    workflowExcludedProjects: [],
    unclassified: [],
  };
}

const SUGGESTION_BUCKETS = [
  'proposal',
  'proposal_followup',
  'work_stages',
  'completed_no_reminders',
];

function countOnboardingSuggestions(groups) {
  return SUGGESTION_BUCKETS.reduce(
    (total, bucket) => total + (groups[bucket] || []).filter(
      (row) => row.action === 'suggest_onboarding',
    ).length,
    0,
  );
}

function buildOnboardingCounts(groups) {
  return {
    proposal: groups.proposal.length,
    proposal_followup: groups.proposal_followup.length,
    work_stages: groups.work_stages.length,
    completed_no_reminders: groups.completed_no_reminders.length,
    alreadyOnboarded: groups.alreadyOnboarded.length,
    workflowExcludedProjects: groups.workflowExcludedProjects.length,
    unclassified: groups.unclassified.length,
    totalSuggestions: countOnboardingSuggestions(groups),
  };
}

/**
 * Read-only preview of suggested workflow onboarding patches.
 */
export async function runProjectWorkflowOnboardingPreview({ entities = base44.entities } = {}) {
  const cache = await loadReminderEngineCache();
  const [projects, signedProposals] = await Promise.all([
    entities.Project?.list?.() || [],
    entities.SignedProposal?.list?.() || [],
  ]);

  const signedProposalsById = new Map(
    signedProposals.map((item) => [String(item.id), item]),
  );

  const groups = emptyOnboardingGroups();
  const allRows = [];

  for (const project of projects) {
    const row = planOnboardingForProject(project, cache, signedProposalsById);
    if (!row) continue;

    allRows.push(row);
    const bucket = groups[row.bucket] ? row.bucket : 'unclassified';
    groups[bucket].push(row);
  }

  return {
    status: 'completed',
    readOnly: true,
    generated_at: new Date().toISOString(),
    projectsChecked: projects.length,
    counts: buildOnboardingCounts(groups),
    groups,
    rows: allRows,
  };
}

/**
 * Applies onboarding patches to Project fields only. Separate from reminder Apply.
 * Requires confirmText === APPLY_PROJECT_WORKFLOW_ONBOARDING.
 */
export async function applyProjectWorkflowOnboarding(
  preview,
  { apply = false, dryRun = true, confirmText = '', entities = base44.entities } = {},
) {
  if (!preview?.rows?.length) {
    return { applied: false, dryRun: true, updated: 0, skipped: 0, errors: [] };
  }

  const applying = apply === true && dryRun === false;
  if (applying && confirmText !== APPLY_PROJECT_WORKFLOW_ONBOARDING_CONFIRM_TEXT) {
    throw new Error('Missing explicit confirmText for workflow onboarding');
  }

  const result = { applied: applying, dryRun: !applying, updated: 0, skipped: 0, errors: [] };

  if (!applying) return result;

  const toApply = preview.rows.filter((row) => row.action === 'suggest_onboarding' && row.suggested_patch);

  for (const row of toApply) {
    try {
      await entities.Project.update(row.project_id, row.suggested_patch);
      result.updated += 1;
    } catch (error) {
      result.errors.push({
        project_id: row.project_id,
        error: error?.message || String(error),
      });
    }
  }

  result.skipped = preview.rows.length - toApply.length;
  return result;
}
