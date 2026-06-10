/**
 * P2G/P2I — Project lifecycle reminder rules.
 *
 * Two planner modes (architectural rule — Project.status is legacy/display):
 *
 * legacy_bootstrap (explicit only): one-time migration of old projects that
 * have no workflow records yet. ONLY this mode may use Project.status as a trigger.
 * runtime (default): ongoing workflow driven by records only.
 * - status !== pricing                          → resolve stale project_needs_proposal
 * - status === pricing + no records             → create project_needs_proposal (P2H)
 * - waiting + no workflow records               → ensure project_waiting_followup
 * - submitted SignedProposal OR signed/execution, without WorkStages
 *                                               → ensure work-stage reminder (with dedup
 *                                                 against signed_proposal_needs_work_stages)
 * - WorkStages exist / no workflow source       → resolve project_needs_work_stages
 *
 * runtime (workflow_entry_stage + records; Project.status is NEVER a trigger):
 * - workflow_managed === true required; onboarding via Project workflow fields.
 * - proposal:          entry_stage=proposal only → project_needs_proposal
 * - follow-up:         entry_stage=proposal_followup → proposal_waiting_followup
 *                      or legacy bridge project_waiting_followup
 * - work stages:       entry_stage=work_stages → signed_proposal_needs_work_stages
 *                      or legacy bridge project_needs_work_stages (never closed
 *                      solely for missing SignedProposal)
 * - completed_no_reminders / unmanaged → report only, no creates/resolves.
 *
 * Truth order in both modes: workflow records outrank Project.status. When
 * status contradicts the records, valid reminders are NOT resolved — the
 * conflict is reported as a statusWorkflowMismatch instead.
 *
 * Default is dry-run (plan only, zero mutations). Mutations require
 * apply: true, dryRun: false AND the plan-matching explicit confirmText.
 */
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import {
  ensureReminderForCondition,
  findReminderByConditionKeyInCache,
  hasOpenReminderForConditionKey,
  isRateLimitError,
  loadReminderEngineCache,
  REMINDER_STATUS,
  resolveReminderByConditionKey,
} from '@/lib/reminderEngine';
import {
  getProjectNeedsProposalConditionKey,
  hasSignedProposalForProject,
} from '@/lib/proposalReminderRules';
import {
  getSignedProposalNeedsWorkStagesConditionKey,
  hasNonCancelledWorkStageForProject,
  SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX,
} from '@/lib/workStageReminderRules';
import { buildProposalFormPageUrl, buildWorkStagesPageUrl } from '@/lib/workflowNavigation';
import {
  getProjectWorkflowExclusion,
  isProjectExcludedFromWorkflowReminders,
} from '@/lib/projectWorkflowExclusions';
import {
  getWorkflowEntryStage,
  hasHistoricalExemption,
  HISTORICAL_EXEMPTION_KEY,
  isCompletedNoRemindersEntry,
  isProposalEntryStage,
  isProposalFollowupEntryStage,
  isWorkStagesEntryStage,
  isWorkflowManagedProject,
  WORKFLOW_ENTRY_STAGE,
} from '@/lib/projectWorkflowOnboarding';

export const PROJECT_WAITING_FOLLOWUP_PREFIX = 'project_waiting_followup:';
export const PROJECT_NEEDS_WORK_STAGES_PREFIX = 'project_needs_work_stages:';
export const PROPOSAL_WAITING_FOLLOWUP_PREFIX = 'proposal_waiting_followup:';

/**
 * Planner modes — architectural separation:
 * - legacy_bootstrap: one-time migration of old projects that have no workflow
 *   records yet. ONLY this mode may use Project.status (pricing/waiting/
 *   signed/execution) as a trigger.
 * - runtime: ongoing workflow. Reminders are driven by records only
 *   (Proposal / SignedProposal / WorkStage). Project.status is display/legacy
 *   and is never a creation trigger; status-only evidence becomes a
 *   report-only runtimeEvidenceGaps row.
 */
export const PLANNER_MODE_LEGACY_BOOTSTRAP = 'legacy_bootstrap';
export const PLANNER_MODE_RUNTIME = 'runtime';

export const APPLY_PROJECT_REMINDER_RULES_CONFIRM_TEXT = 'APPLY_PROJECT_REMINDER_RULES_ALIGNMENT';
export const APPLY_PRICING_PROPOSAL_REMINDERS_CONFIRM_TEXT = 'APPLY_PRICING_PROPOSAL_REMINDERS';

const ACCEPTED_APPLY_CONFIRM_TEXTS = new Set([
  APPLY_PROJECT_REMINDER_RULES_CONFIRM_TEXT,
  APPLY_PRICING_PROPOSAL_REMINDERS_CONFIRM_TEXT,
]);

export function getProjectWaitingFollowupConditionKey(projectId) {
  return `${PROJECT_WAITING_FOLLOWUP_PREFIX}${projectId}`;
}

export function getProjectNeedsWorkStagesConditionKey(projectId) {
  return `${PROJECT_NEEDS_WORK_STAGES_PREFIX}${projectId}`;
}

export function getProposalWaitingFollowupConditionKey(proposalId) {
  return `${PROPOSAL_WAITING_FOLLOWUP_PREFIX}${proposalId}`;
}

const WORK_STAGE_FALLBACK_STATUSES = new Set(['signed', 'execution']);

const STATUS_BEHIND_WORKFLOW = new Set(['pricing', 'waiting']);

const REJECTED_OR_CANCELLED_STATUSES = new Set(['rejected', 'cancelled']);

function isRejectedOrCancelledStatus(status) {
  return REJECTED_OR_CANCELLED_STATUSES.has(String(status || '').trim());
}

function isCompletedStatus(status) {
  return String(status || '').trim() === 'completed';
}

const normalizeStatus = (project) => String(project?.status || '').trim();

/**
 * Workflow-first truth evaluation for one project.
 * WorkStages > submitted SignedProposal > Project.status (fallback).
 */
export function evaluateProjectWorkflowState(project, { workStages = [], signedProposals = [] } = {}) {
  const hasWorkStages = hasNonCancelledWorkStageForProject(project?.id, workStages);
  const hasSubmittedSignedProposal = hasSignedProposalForProject(project, signedProposals);

  let workflowState = 'none';
  if (hasWorkStages) workflowState = 'work_stages_exist';
  else if (hasSubmittedSignedProposal) workflowState = 'signed_proposal_exists';

  return { hasWorkStages, hasSubmittedSignedProposal, workflowState };
}

/**
 * Returns a mismatch row when Project.status lags behind the workflow records,
 * or null when there is no contradiction. Report-only — never used to resolve.
 */
export function buildStatusWorkflowMismatch(project, workflow) {
  const status = normalizeStatus(project);
  if (!STATUS_BEHIND_WORKFLOW.has(status)) return null;
  if (workflow.workflowState === 'none') return null;

  const reason = workflow.workflowState === 'work_stages_exist'
    ? `Project.status is ${status} but WorkStages exist`
    : `Project.status is ${status} but submitted SignedProposal exists`;

  return {
    project_id: project.id,
    project_name: project.name || project.project_name || '',
    project_status: status,
    workflow_state: workflow.workflowState,
    reason,
    recommended_action: 'Review whether Project.status should be updated manually',
  };
}

const isOpenStatus = (status) => (
  status === REMINDER_STATUS.ACTIVE || status === REMINDER_STATUS.SNOOZED
);

function resolveClientName(project, clientsById) {
  const client = clientsById.get(String(project?.client_id || '').trim());
  return client?.name
    || project?.client_name
    || project?.name
    || project?.project_name
    || 'ללא שם';
}

function buildWaitingFollowupReminderInput(project, clientsById) {
  const projectName = project.name || project.project_name || 'ללא שם';

  return {
    title: `לעקוב אחרי הצעה ממתינה לתגובה עבור ${projectName}`,
    description: 'הצעת המחיר ממתינה לתגובת הלקוח. כדאי לבצע מעקב.',
    client_name: resolveClientName(project, clientsById),
    client_id: project.client_id || '',
    project_name: projectName,
    project_id: project.id,
    source_type: 'project',
    source_id: project.id,
    condition_key: getProjectWaitingFollowupConditionKey(project.id),
    action_url: createPageUrl(`ProjectDetails?id=${project.id}`),
    action_label: 'פתח פרויקט',
    frequency: 'daily',
  };
}

/** P2H: missing project_needs_proposal reminder for a pricing project. */
function buildPricingProposalReminderInput(project, clientsById) {
  const projectName = project.name || project.project_name || 'ללא שם';
  const clientId = String(project.client_id || '').trim();
  const resolvedClient = clientsById.get(clientId);
  const clientName = project.client_name
    || resolvedClient?.name
    || projectName;

  return {
    title: `לפתוח הצעת מחיר לפרויקט ${projectName}`,
    description: 'הפרויקט נמצא בתמחור ועדיין אין לו תזכורת פעילה לפתיחת הצעת מחיר.',
    client_name: clientName,
    client_id: clientId,
    project_name: projectName,
    project_id: project.id,
    source_type: 'project',
    source_id: project.id,
    condition_key: getProjectNeedsProposalConditionKey(project.id),
    action_url: buildProposalFormPageUrl({
      clientId,
      clientName: clientId ? clientName : '',
      projectId: project.id,
      projectName,
    }),
    action_label: 'פתח הצעת מחיר',
    frequency: 'daily',
  };
}

/** Runtime: follow-up keyed to the submitted Proposal record, not Project.status. */
function buildProposalFollowupReminderInput(proposal, project, clientsById) {
  const projectName = project.name || project.project_name || proposal.project_name || 'ללא שם';

  return {
    title: `לעקוב אחרי הצעה ממתינה לתגובה עבור ${projectName}`,
    description: 'הצעת המחיר הוגשה וממתינה לתגובת הלקוח. כדאי לבצע מעקב.',
    client_name: proposal.client_name || resolveClientName(project, clientsById),
    client_id: proposal.client_id || project.client_id || '',
    project_name: projectName,
    project_id: project.id,
    source_type: 'proposal',
    source_id: proposal.id,
    condition_key: getProposalWaitingFollowupConditionKey(proposal.id),
    action_url: buildProposalFormPageUrl({ proposalId: proposal.id }),
    action_label: 'פתח הצעת מחיר',
    frequency: 'daily',
  };
}

/** Runtime: work-stage reminder keyed to the submitted SignedProposal (R7 key). */
function buildSignedProposalWorkStagesReminderInput(signedProposal, project, clientsById) {
  const projectName = String(signedProposal.project_name || project.name || '').trim();

  return {
    title: projectName
      ? `להגדיר שלבי עבודה לפרויקט ${projectName}`
      : 'להגדיר שלבי עבודה לפרויקט',
    description: 'קיימת הצעה/הזמנה חתומה, אך עדיין לא הוגדרו שלבי עבודה לפרויקט.',
    client_name: signedProposal.client_name || resolveClientName(project, clientsById),
    client_id: signedProposal.client_id || project.client_id || '',
    project_name: projectName,
    project_id: signedProposal.project_id || project.id,
    source_type: 'signed_proposal',
    source_id: signedProposal.id,
    condition_key: getSignedProposalNeedsWorkStagesConditionKey(signedProposal.id),
    action_url: buildWorkStagesPageUrl({
      projectId: signedProposal.project_id || project.id,
      signedProposalId: signedProposal.id,
    }),
    action_label: 'הגדר שלבי עבודה',
    frequency: 'daily',
  };
}

function buildWorkStagesReminderInput(project, clientsById) {
  const projectName = project.name || project.project_name || 'ללא שם';
  const status = normalizeStatus(project);
  const isExecution = status === 'execution';

  return {
    title: isExecution
      ? `להגדיר / לנהל שלבי עבודה לפרויקט ${projectName}`
      : `להגדיר שלבי עבודה לפרויקט ${projectName}`,
    description: isExecution
      ? 'הפרויקט בעבודה אך אין לו שלבי עבודה מוגדרים.'
      : 'הפרויקט התקבל אך עדיין לא הוגדרו לו שלבי עבודה.',
    client_name: resolveClientName(project, clientsById),
    client_id: project.client_id || '',
    project_name: projectName,
    project_id: project.id,
    source_type: 'project',
    source_id: project.id,
    condition_key: getProjectNeedsWorkStagesConditionKey(project.id),
    action_url: buildWorkStagesPageUrl({ projectId: project.id }),
    action_label: isExecution ? 'פתח שלבי עבודה' : 'הגדר שלבי עבודה',
    frequency: 'daily',
  };
}

function summarizeExistingReminder(cache, conditionKey) {
  const reminder = findReminderByConditionKeyInCache(cache, conditionKey);
  if (!reminder || !isOpenStatus(reminder.status)) return null;

  return {
    reminder_id: reminder.id,
    reminder_title: reminder.title || '',
    reminder_status: reminder.status,
    next_remind_at: reminder.next_remind_at || '',
  };
}

/**
 * Maps each project id to its open signed_proposal_needs_work_stages reminders.
 * Project id is resolved from reminder.project_id, with a fallback through
 * SignedProposal.project_id by source_id.
 */
function buildOpenSignedProposalWorkStageReminderMap(cache, signedProposalsById) {
  const byProjectId = new Map();

  for (const reminder of cache.reminders || []) {
    if (!isOpenStatus(reminder?.status)) continue;

    const conditionKey = String(reminder?.condition_key || '').trim();
    if (!conditionKey.startsWith(SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX)) continue;

    let projectId = String(reminder?.project_id || '').trim();
    if (!projectId) {
      const signedProposal = signedProposalsById.get(String(reminder?.source_id || '').trim());
      projectId = String(signedProposal?.project_id || '').trim();
    }
    if (!projectId) continue;

    if (!byProjectId.has(projectId)) byProjectId.set(projectId, []);
    byProjectId.get(projectId).push({
      reminder_id: reminder.id,
      reminder_title: reminder.title || '',
      condition_key: conditionKey,
      reminder_status: reminder.status,
    });
  }

  return byProjectId;
}

async function safeListEntity(entities, entityName) {
  if (!entities?.[entityName]?.list) return [];
  try {
    return (await entities[entityName].list()) || [];
  } catch (error) {
    console.warn(`[projectLifecycleReminderRules] failed to load ${entityName}`, error);
    return [];
  }
}

export async function loadProjectLifecycleRuleContext({ entities = base44.entities } = {}) {
  const cache = await loadReminderEngineCache();

  const [projects, workStages, signedProposals, clients, proposals] = await Promise.all([
    safeListEntity(entities, 'Project'),
    safeListEntity(entities, 'WorkStage'),
    safeListEntity(entities, 'SignedProposal'),
    safeListEntity(entities, 'Client'),
    safeListEntity(entities, 'Proposal'),
  ]);

  const signedProposalsById = new Map(
    signedProposals.map((item) => [String(item.id), item]),
  );
  const clientsById = new Map(clients.map((client) => [String(client.id), client]));

  return {
    cache,
    projects,
    workStages,
    signedProposals,
    proposals,
    signedProposalsById,
    clientsById,
    openSignedProposalWorkStageRemindersByProjectId:
      buildOpenSignedProposalWorkStageReminderMap(cache, signedProposalsById),
  };
}

const getProposalsForProject = (projectId, proposals = []) => (
  proposals.filter(
    (proposal) => String(proposal?.project_id || '').trim() === String(projectId).trim(),
  )
);

// Same semantics as proposalReminderRules: only 'cancelled' stops covering
// the proposal need (P2H legacy bootstrap relies on this).
const isNonCancelledProposal = (proposal) => proposal?.form_status !== 'cancelled';

// Runtime follow-up targets: submitted proposals. Proposal has no separate
// rejected field — form_status (draft/submitted/cancelled) is the whole truth,
// and 'submitted' already excludes cancelled.
const isSubmittedActiveProposal = (proposal) => proposal?.form_status === 'submitted';

const hasNonCancelledProposalForProject = (projectId, proposals = []) => (
  getProposalsForProject(projectId, proposals).some(isNonCancelledProposal)
);

const findSubmittedSignedProposalForProject = (project, signedProposals = []) => (
  signedProposals.find(
    (signedProposal) => hasSignedProposalForProject(project, [signedProposal]),
  ) || null
);

function baseActionRow(project, bucket, reminderKind, conditionKey) {
  return {
    bucket,
    reminder_kind: reminderKind,
    condition_key: conditionKey,
    project_id: project.id,
    project_name: project.name || project.project_name || '',
    project_status: normalizeStatus(project),
  };
}

function hasActiveDownstreamWorkflowReminder(cache, {
  followupKey,
  workStagesKey,
  openSignedProposalReminders = [],
  projectProposals = [],
}) {
  if (hasOpenReminderForConditionKey(cache, followupKey)) return true;
  if (hasOpenReminderForConditionKey(cache, workStagesKey)) return true;
  if (openSignedProposalReminders.length > 0) return true;

  return projectProposals.some(
    (proposal) => hasOpenReminderForConditionKey(
      cache,
      getProposalWaitingFollowupConditionKey(proposal.id),
    ),
  );
}

function resolveFollowupRemindersWhenSuperseded(project, cache, shared, reason) {
  const actions = [];
  const { followupKey, projectProposals = [] } = shared;

  for (const proposal of projectProposals) {
    const proposalFollowupKey = getProposalWaitingFollowupConditionKey(proposal.id);
    const existing = summarizeExistingReminder(cache, proposalFollowupKey);
    if (existing) {
      actions.push({
        ...baseActionRow(project, 'projectWorkStageRemindersToResolve', 'proposal_waiting_followup', proposalFollowupKey),
        action: 'resolve',
        reason,
        ...existing,
      });
    }
  }

  const existingLegacyFollowup = summarizeExistingReminder(cache, followupKey);
  if (existingLegacyFollowup) {
    actions.push({
      ...baseActionRow(project, 'projectWorkStageRemindersToResolve', 'project_waiting_followup', followupKey),
      action: 'resolve',
      reason,
      ...existingLegacyFollowup,
    });
  }

  return actions;
}

/**
 * Runtime rules — workflow_entry_stage + records. Project.status is NEVER a
 * creation trigger; legacy bridge reminders are preserved until real records
 * or explicit exemptions say otherwise.
 */
function planRuntimeWorkflowActions(project, context, shared) {
  const actions = [];
  const { cache, signedProposals, proposals = [], clientsById } = context;
  const {
    workflow, proposalKey, followupKey, workStagesKey, openSignedProposalReminders,
  } = shared;
  const { hasWorkStages, hasSubmittedSignedProposal } = workflow;
  const status = normalizeStatus(project);
  const entryStage = getWorkflowEntryStage(project);

  if (isCompletedNoRemindersEntry(project)) {
    actions.push({
      ...baseActionRow(project, 'completedNoReminders', 'completed_no_reminders', ''),
      action: 'report_only',
      reason: 'workflow_entry_stage is completed_no_reminders — no workflow reminders',
      workflow_entry_stage: entryStage,
    });
    return actions;
  }

  if (isRejectedOrCancelledStatus(status)) {
    actions.push({
      ...baseActionRow(project, 'closedProjectsNoWorkflow', 'closed_project', ''),
      action: 'report_only',
      reason: `Project.status is "${status}" — no runtime workflow reminders`,
      workflow_entry_stage: entryStage,
    });
    return actions;
  }

  // Completed projects are not onboarding gaps — align with completed_no_reminders
  // (onboarded or pending onboarding suggestion).
  if (isCompletedStatus(status) && !isWorkflowManagedProject(project)) {
    actions.push({
      ...baseActionRow(project, 'completedNoReminders', 'completed_status', ''),
      action: 'report_only',
      reason: 'Completed project — no workflow reminders at this stage',
      workflow_entry_stage: entryStage,
      recommended_action: 'Apply Workflow Onboarding to set completed_no_reminders if not yet onboarded',
    });
    return actions;
  }

  if (!isWorkflowManagedProject(project)) {
    actions.push({
      ...baseActionRow(project, 'runtimeEvidenceGaps', 'workflow_onboarding', ''),
      action: 'report_only',
      reason: 'Project is not workflow-managed (workflow_managed !== true)',
      workflow_entry_stage: entryStage,
      recommended_action: 'Run Workflow Onboarding Preview and apply onboarding before runtime reminders',
    });
    return actions;
  }

  const projectProposals = getProposalsForProject(project.id, proposals);
  const nonCancelledProposals = projectProposals.filter(isNonCancelledProposal);
  const submittedProposals = projectProposals.filter(isSubmittedActiveProposal);
  const exemptProposal = hasHistoricalExemption(project, HISTORICAL_EXEMPTION_KEY.PROPOSAL);
  const exemptSignedProposal = hasHistoricalExemption(project, HISTORICAL_EXEMPTION_KEY.SIGNED_PROPOSAL);

  const downstreamShared = {
    followupKey,
    workStagesKey,
    openSignedProposalReminders,
    projectProposals,
  };

  // Runtime Rule 1 — project_needs_proposal only at entry_stage === proposal.
  if (isProposalEntryStage(project)) {
    const proposalNeedIsCovered = (
      nonCancelledProposals.length > 0 || hasSubmittedSignedProposal || hasWorkStages
    );

    if (proposalNeedIsCovered) {
      const existingProposalReminder = summarizeExistingReminder(cache, proposalKey);
      if (existingProposalReminder) {
        actions.push({
          ...baseActionRow(project, 'staleProposalRemindersToResolve', 'project_needs_proposal', proposalKey),
          action: 'resolve',
          reason: 'Workflow records already cover the proposal need at proposal entry stage',
          ...existingProposalReminder,
        });
      }
    } else if (
      !hasOpenReminderForConditionKey(cache, proposalKey)
      && !hasActiveDownstreamWorkflowReminder(cache, downstreamShared)
    ) {
      actions.push({
        ...baseActionRow(project, 'pricingProposalRemindersToCreate', 'project_needs_proposal', proposalKey),
        action: 'create',
        reason: 'workflow_entry_stage=proposal with no proposal records and no downstream reminder',
        reminder_input: buildPricingProposalReminderInput(project, clientsById),
      });
    }
  }

  // Runtime Rule 2 — proposal follow-up at entry_stage === proposal_followup.
  if (isProposalFollowupEntryStage(project)) {
    const superseded = hasSubmittedSignedProposal || hasWorkStages;

    if (superseded) {
      actions.push(...resolveFollowupRemindersWhenSuperseded(
        project,
        cache,
        { followupKey, projectProposals },
        'Signed proposal or work stages supersede the follow-up reminder',
      ));
    } else if (submittedProposals.length > 0) {
      for (const proposal of submittedProposals) {
        const proposalFollowupKey = getProposalWaitingFollowupConditionKey(proposal.id);
        if (hasOpenReminderForConditionKey(cache, proposalFollowupKey)) continue;

        if (hasOpenReminderForConditionKey(cache, followupKey)) {
          actions.push({
            ...baseActionRow(project, 'duplicatesPrevented', 'proposal_waiting_followup', proposalFollowupKey),
            action: 'skip_duplicate',
            reason: 'Legacy project_waiting_followup bridge already covers this follow-up',
          });
          continue;
        }

        actions.push({
          ...baseActionRow(project, 'proposalFollowupRemindersToCreate', 'proposal_waiting_followup', proposalFollowupKey),
          action: 'create',
          reason: 'Submitted proposal awaits client response (proposal_followup entry stage)',
          reminder_input: buildProposalFollowupReminderInput(proposal, project, clientsById),
        });
      }
    } else if (!hasOpenReminderForConditionKey(cache, followupKey)) {
      actions.push({
        ...baseActionRow(project, 'waitingFollowupRemindersToCreate', 'project_waiting_followup', followupKey),
        action: 'create',
        reason: 'Legacy proposal_followup entry without Proposal record — bridge project_waiting_followup',
        reminder_input: buildWaitingFollowupReminderInput(project, clientsById),
      });
    }
  } else if (hasSubmittedSignedProposal || hasWorkStages) {
    actions.push(...resolveFollowupRemindersWhenSuperseded(
      project,
      cache,
      { followupKey, projectProposals },
      'Signed proposal or work stages supersede the follow-up reminder',
    ));
  }

  // Runtime Rule 3 — work stages at entry_stage === work_stages.
  if (isWorkStagesEntryStage(project)) {
    if (hasWorkStages) {
      const existingBridge = summarizeExistingReminder(cache, workStagesKey);
      if (existingBridge) {
        actions.push({
          ...baseActionRow(project, 'projectWorkStageRemindersToResolve', 'project_needs_work_stages', workStagesKey),
          action: 'resolve',
          reason: 'Work stages exist — legacy bridge reminder is fulfilled',
          ...existingBridge,
        });
      }

      for (const signedProposalReminder of openSignedProposalReminders) {
        actions.push({
          ...baseActionRow(
            project,
            'projectWorkStageRemindersToResolve',
            'signed_proposal_needs_work_stages',
            signedProposalReminder.condition_key,
          ),
          action: 'resolve',
          reason: 'Work stages exist — signed-proposal work-stage reminder is fulfilled',
          reminder_id: signedProposalReminder.reminder_id,
          reminder_title: signedProposalReminder.reminder_title,
          reminder_status: signedProposalReminder.reminder_status,
        });
      }
    } else if (hasSubmittedSignedProposal && !exemptSignedProposal) {
      if (openSignedProposalReminders.length > 0) {
        actions.push({
          ...baseActionRow(project, 'duplicatesPrevented', 'signed_proposal_needs_work_stages', ''),
          action: 'skip_duplicate',
          reason: 'Active signed_proposal_needs_work_stages reminder already covers this project',
          existing_signed_proposal_reminders: openSignedProposalReminders,
        });
      } else if (hasOpenReminderForConditionKey(cache, workStagesKey)) {
        actions.push({
          ...baseActionRow(project, 'duplicatesPrevented', 'project_needs_work_stages', workStagesKey),
          action: 'skip_duplicate',
          reason: 'Active project_needs_work_stages bridge reminder already covers this project',
        });
      } else {
        const signedProposal = findSubmittedSignedProposalForProject(project, signedProposals);
        if (signedProposal?.id) {
          const signedProposalKey = getSignedProposalNeedsWorkStagesConditionKey(signedProposal.id);
          actions.push({
            ...baseActionRow(project, 'workStageRemindersToCreate', 'signed_proposal_needs_work_stages', signedProposalKey),
            action: 'create',
            reason: 'Submitted signed proposal exists but no work stages (work_stages entry stage)',
            reminder_input: buildSignedProposalWorkStagesReminderInput(signedProposal, project, clientsById),
          });
        }
      }
    } else if (!hasOpenReminderForConditionKey(cache, workStagesKey) && openSignedProposalReminders.length === 0) {
      actions.push({
        ...baseActionRow(project, 'workStageRemindersToCreate', 'project_needs_work_stages', workStagesKey),
        action: 'create',
        reason: 'work_stages entry stage without WorkStages — legacy bridge project_needs_work_stages',
        reminder_input: buildWorkStagesReminderInput(project, clientsById),
      });
    }
    // Never resolve project_needs_work_stages bridge solely because there is no SignedProposal.
  } else if (hasSubmittedSignedProposal && !hasWorkStages) {
    if (openSignedProposalReminders.length > 0) {
      actions.push({
        ...baseActionRow(project, 'duplicatesPrevented', 'signed_proposal_needs_work_stages', ''),
        action: 'skip_duplicate',
        reason: 'Active signed_proposal_needs_work_stages reminder already covers this project',
        existing_signed_proposal_reminders: openSignedProposalReminders,
      });
    }
  }

  // Report-only: legacy status without records — never act on Project.status alone.
  // Skip terminal/closed projects (completed / rejected / cancelled / completed_no_reminders).
  if (
    !hasSubmittedSignedProposal
    && !hasWorkStages
    && WORK_STAGE_FALLBACK_STATUSES.has(status)
    && !isWorkStagesEntryStage(project)
    && !exemptSignedProposal
    && !isCompletedNoRemindersEntry(project)
    && !isRejectedOrCancelledStatus(status)
    && !isCompletedStatus(status)
  ) {
    actions.push({
      ...baseActionRow(project, 'runtimeEvidenceGaps', 'work_stages_needed', ''),
      action: 'report_only',
      reason: `Project.status is "${status}" but there is no submitted SignedProposal and no WorkStages record`,
      workflow_entry_stage: entryStage,
      recommended_action: 'Use Workflow Onboarding or legacy bootstrap; runtime does not act on Project.status',
    });
  }

  return actions;
}

/**
 * Pure planner: returns the list of planned actions for one project.
 * Workflow records win over Project.status. Performs zero mutations.
 *
 * mode:
 * - PLANNER_MODE_RUNTIME (default): records-only (Proposal/SignedProposal/WorkStage);
 *   Project.status is never a creation trigger.
 * - PLANNER_MODE_LEGACY_BOOTSTRAP (explicit only): may use Project.status as a
 *   trigger — one-time migration of legacy projects without workflow records.
 *   Apply mutations are permitted ONLY in this mode.
 */
export function planProjectLifecycleReminderActions(
  project,
  context,
  mode = PLANNER_MODE_RUNTIME,
) {
  const actions = [];
  if (!project?.id) return actions;

  const status = normalizeStatus(project);
  const { cache, workStages, signedProposals, proposals = [], clientsById } = context;

  const workflow = evaluateProjectWorkflowState(project, { workStages, signedProposals });
  const { hasWorkStages, hasSubmittedSignedProposal } = workflow;

  const proposalKey = getProjectNeedsProposalConditionKey(project.id);
  const followupKey = getProjectWaitingFollowupConditionKey(project.id);
  const workStagesKey = getProjectNeedsWorkStagesConditionKey(project.id);

  const openSignedProposalReminders = context
    .openSignedProposalWorkStageRemindersByProjectId.get(String(project.id)) || [];

  // Reminder-policy exclusion (Aharon approval): no workflow reminders for
  // this project. Stale project_needs_proposal cleanup still applies, and any
  // open workflow reminder is planned for resolve in a dedicated bucket.
  if (isProjectExcludedFromWorkflowReminders(project)) {
    const exclusion = getProjectWorkflowExclusion(project);

    actions.push({
      ...baseActionRow(project, 'workflowExcludedProjects', 'workflow_exclusion', ''),
      action: 'report_only',
      reason: exclusion.reason,
      recommended_action: 'No workflow reminder needed unless Aharon changes the decision.',
    });

    // Runtime does not resolve proposal reminders on excluded projects via records;
    // only the dedicated excluded-workflow bucket applies.
    if (mode !== PLANNER_MODE_RUNTIME && status !== 'pricing') {
      const existingProposal = summarizeExistingReminder(cache, proposalKey);
      if (existingProposal) {
        actions.push({
          ...baseActionRow(project, 'staleProposalRemindersToResolve', 'project_needs_proposal', proposalKey),
          action: 'resolve',
          reason: `Project status is "${status}" (not pricing); proposal reminder is stale`,
          ...existingProposal,
        });
      }
    }

    for (const [kind, key] of [
      ['project_waiting_followup', followupKey],
      ['project_needs_work_stages', workStagesKey],
    ]) {
      const existing = summarizeExistingReminder(cache, key);
      if (existing) {
        actions.push({
          ...baseActionRow(project, 'excludedWorkflowRemindersToResolve', kind, key),
          action: 'resolve',
          reason: 'Project is excluded from workflow reminders by Aharon approval',
          ...existing,
        });
      }
    }

    for (const signedProposalReminder of openSignedProposalReminders) {
      actions.push({
        ...baseActionRow(
          project,
          'excludedWorkflowRemindersToResolve',
          'signed_proposal_needs_work_stages',
          signedProposalReminder.condition_key,
        ),
        action: 'resolve',
        reason: 'Project is excluded from workflow reminders by Aharon approval',
        reminder_id: signedProposalReminder.reminder_id,
        reminder_title: signedProposalReminder.reminder_title,
        reminder_status: signedProposalReminder.reminder_status,
      });
    }

    return actions;
  }

  // Status-vs-workflow contradiction → report only, never resolve because of it.
  const mismatch = buildStatusWorkflowMismatch(project, workflow);
  if (mismatch) {
    actions.push({
      ...baseActionRow(project, 'statusWorkflowMismatches', 'status_workflow_mismatch', ''),
      action: 'report_only',
      workflow_state: mismatch.workflow_state,
      reason: mismatch.reason,
      recommended_action: mismatch.recommended_action,
    });
  }

  if (mode === PLANNER_MODE_RUNTIME) {
    actions.push(...planRuntimeWorkflowActions(project, context, {
      workflow,
      proposalKey,
      followupKey,
      workStagesKey,
      openSignedProposalReminders,
    }));
    return actions;
  }

  // ---- Legacy bootstrap rules below: Project.status is allowed ONLY here ----

  // Rule A: stale project_needs_proposal — valid only for pricing.
  if (status !== 'pricing') {
    const existing = summarizeExistingReminder(cache, proposalKey);
    if (existing) {
      actions.push({
        ...baseActionRow(project, 'staleProposalRemindersToResolve', 'project_needs_proposal', proposalKey),
        action: 'resolve',
        reason: `Project status is "${status}" (not pricing); proposal reminder is stale`,
        ...existing,
      });
    }
  }

  // Rule E (P2H): pricing project with no proposal coverage → create
  // project_needs_proposal. Missing client_id does NOT block creation.
  if (
    status === 'pricing'
    && !hasOpenReminderForConditionKey(cache, proposalKey)
    && !hasSubmittedSignedProposal
    && !hasWorkStages
    && !hasNonCancelledProposalForProject(project.id, proposals)
  ) {
    actions.push({
      ...baseActionRow(project, 'pricingProposalRemindersToCreate', 'project_needs_proposal', proposalKey),
      action: 'create',
      reason: 'Pricing project has no proposal, no signed proposal, no work stages and no active proposal reminder',
      reminder_input: buildPricingProposalReminderInput(project, clientsById),
    });
  }

  // Rule B: waiting follow-up is valid ONLY when there are no workflow records.
  const waitingFollowupIsValid = (
    status === 'waiting'
    && !hasSubmittedSignedProposal
    && !hasWorkStages
    && openSignedProposalReminders.length === 0
  );

  if (waitingFollowupIsValid) {
    if (!hasOpenReminderForConditionKey(cache, followupKey)) {
      actions.push({
        ...baseActionRow(project, 'waitingFollowupRemindersToCreate', 'project_waiting_followup', followupKey),
        action: 'create',
        reason: 'Waiting project with no workflow records has no follow-up reminder',
        reminder_input: buildWaitingFollowupReminderInput(project, clientsById),
      });
    }
  } else {
    const existingFollowup = summarizeExistingReminder(cache, followupKey);
    if (existingFollowup) {
      const followupReason = status === 'waiting'
        ? 'Workflow records exist (signed proposal / work stages); follow-up reminder is superseded'
        : `Project status is "${status}" (not waiting); follow-up reminder is no longer relevant`;
      actions.push({
        ...baseActionRow(project, 'projectWorkStageRemindersToResolve', 'project_waiting_followup', followupKey),
        action: 'resolve',
        reason: followupReason,
        ...existingFollowup,
      });
    }
  }

  // Rule C: work-stage reminder is needed when the workflow says so —
  // submitted SignedProposal (any status) OR signed/execution as status fallback.
  const needsWorkStageReminder = !hasWorkStages
    && (hasSubmittedSignedProposal || WORK_STAGE_FALLBACK_STATUSES.has(status));

  if (needsWorkStageReminder) {
    if (openSignedProposalReminders.length > 0) {
      actions.push({
        ...baseActionRow(project, 'duplicatesPrevented', 'project_needs_work_stages', workStagesKey),
        action: 'skip_duplicate',
        reason: 'Active signed_proposal_needs_work_stages reminder already covers this project',
        existing_signed_proposal_reminders: openSignedProposalReminders,
      });
    } else if (hasOpenReminderForConditionKey(cache, workStagesKey)) {
      actions.push({
        ...baseActionRow(project, 'duplicatesPrevented', 'project_needs_work_stages', workStagesKey),
        action: 'skip_duplicate',
        reason: 'Active project_needs_work_stages reminder already exists',
      });
    } else {
      const createReason = hasSubmittedSignedProposal
        ? 'Submitted signed proposal exists but no work stages and no work-stage reminder'
        : `${status} project has no work stages and no work-stage reminder`;
      actions.push({
        ...baseActionRow(project, 'workStageRemindersToCreate', 'project_needs_work_stages', workStagesKey),
        action: 'create',
        reason: createReason,
        reminder_input: buildWorkStagesReminderInput(project, clientsById),
      });
    }
  } else {
    // Resolve project_needs_work_stages ONLY when: work stages exist, or there
    // is no workflow source AND no status fallback. Never because the status
    // merely lags behind the workflow.
    const existing = summarizeExistingReminder(cache, workStagesKey);
    if (existing) {
      if (hasWorkStages) {
        actions.push({
          ...baseActionRow(project, 'projectWorkStageRemindersToResolve', 'project_needs_work_stages', workStagesKey),
          action: 'resolve',
          reason: 'Work stages already exist for this project',
          ...existing,
        });
      } else {
        actions.push({
          ...baseActionRow(project, 'projectWorkStageRemindersToResolve', 'project_needs_work_stages', workStagesKey),
          action: 'resolve',
          reason: `No submitted signed proposal and status "${status}" is not signed/execution; work-stage reminder has no workflow source`,
          ...existing,
        });
      }
    }
  }

  return actions;
}

async function executeAction(action, cache) {
  if (action.action === 'resolve') {
    return resolveReminderByConditionKey(
      action.condition_key,
      'project_lifecycle_alignment',
      { cache },
    );
  }

  if (action.action === 'create') {
    return ensureReminderForCondition(true, action.reminder_input, { cache, immediate: false });
  }

  return { action: 'skipped' };
}

function emptyGroups() {
  return {
    staleProposalRemindersToResolve: [],
    pricingProposalRemindersToCreate: [],
    waitingFollowupRemindersToCreate: [],
    proposalFollowupRemindersToCreate: [],
    workStageRemindersToCreate: [],
    projectWorkStageRemindersToResolve: [],
    duplicatesPrevented: [],
    statusWorkflowMismatches: [],
    excludedWorkflowRemindersToResolve: [],
    workflowExcludedProjects: [],
    runtimeEvidenceGaps: [],
    completedNoReminders: [],
    closedProjectsNoWorkflow: [],
  };
}

function groupActions(actions) {
  const groups = emptyGroups();
  for (const action of actions) {
    if (groups[action.bucket]) groups[action.bucket].push(action);
  }
  return groups;
}

function buildCounts(groups) {
  return {
    staleProposalRemindersToResolve: groups.staleProposalRemindersToResolve.length,
    pricingProposalRemindersToCreate: groups.pricingProposalRemindersToCreate.length,
    waitingFollowupRemindersToCreate: groups.waitingFollowupRemindersToCreate.length,
    proposalFollowupRemindersToCreate: groups.proposalFollowupRemindersToCreate.length,
    workStageRemindersToCreate: groups.workStageRemindersToCreate.length,
    projectWorkStageRemindersToResolve: groups.projectWorkStageRemindersToResolve.length,
    duplicatesPrevented: groups.duplicatesPrevented.length,
    statusWorkflowMismatches: groups.statusWorkflowMismatches.length,
    excludedWorkflowRemindersToResolve: groups.excludedWorkflowRemindersToResolve.length,
    workflowExcludedProjects: groups.workflowExcludedProjects.length,
    runtimeEvidenceGaps: groups.runtimeEvidenceGaps.length,
    completedNoReminders: groups.completedNoReminders.length,
    closedProjectsNoWorkflow: groups.closedProjectsNoWorkflow.length,
  };
}

const shouldApply = (options = {}) => options.apply === true && options.dryRun === false;

/**
 * Plan-aware confirm guard: each apply scope has its own confirmText.
 * - P2H pricing creations require APPLY_PRICING_PROPOSAL_REMINDERS (the P2G
 *   text is NOT accepted for them).
 * - P2G lifecycle alignment actions (without pricing creations) require
 *   APPLY_PROJECT_REMINDER_RULES_ALIGNMENT.
 */
function assertConfirmTextMatchesPlan(groups, confirmText) {
  const hasPricingCreates = groups.pricingProposalRemindersToCreate.length > 0;
  const hasLifecycleAlignmentActions = (
    groups.staleProposalRemindersToResolve.length > 0
    || groups.waitingFollowupRemindersToCreate.length > 0
    || groups.proposalFollowupRemindersToCreate.length > 0
    || groups.workStageRemindersToCreate.length > 0
    || groups.projectWorkStageRemindersToResolve.length > 0
    || groups.excludedWorkflowRemindersToResolve.length > 0
  );

  if (hasPricingCreates && confirmText !== APPLY_PRICING_PROPOSAL_REMINDERS_CONFIRM_TEXT) {
    throw new Error('Missing explicit confirmText for pricing proposal reminders');
  }

  if (
    !hasPricingCreates
    && hasLifecycleAlignmentActions
    && confirmText !== APPLY_PROJECT_REMINDER_RULES_CONFIRM_TEXT
  ) {
    throw new Error('Missing explicit confirmText for lifecycle alignment');
  }
}

function assertApplyModeIsLegacyBootstrap(mode) {
  if (mode !== PLANNER_MODE_LEGACY_BOOTSTRAP) {
    throw new Error('Apply is allowed only in legacy_bootstrap mode');
  }
}

/**
 * Runs lifecycle rules for a single project.
 * Default: dryRun=true, apply=false, mode=runtime — returns the plan without mutating.
 */
export async function runProjectLifecycleReminderRulesForProject(project, options = {}) {
  const {
    dryRun = true, apply = false, confirmText = '', mode = PLANNER_MODE_RUNTIME,
  } = options;
  const applying = shouldApply({ dryRun, apply });

  if (applying) {
    assertApplyModeIsLegacyBootstrap(mode);
  }

  if (applying && !ACCEPTED_APPLY_CONFIRM_TEXTS.has(confirmText)) {
    throw new Error('Missing explicit confirmText');
  }

  const context = options.context || await loadProjectLifecycleRuleContext(options);
  const actions = planProjectLifecycleReminderActions(project, context, mode);

  if (!applying) {
    return { dryRun: true, applied: false, actions };
  }

  assertConfirmTextMatchesPlan(groupActions(actions), confirmText);

  const results = [];
  for (const action of actions) {
    results.push({ action, result: await executeAction(action, context.cache) });
  }

  return { dryRun: false, applied: true, actions, results };
}

/**
 * Runs lifecycle rules for all projects.
 *
 * Mutation requires ALL of:
 *   apply: true, dryRun: false, mode: legacy_bootstrap (explicit),
 *   and a confirmText that matches the plan:
 *   - plan contains pricing creations → APPLY_PRICING_PROPOSAL_REMINDERS only
 *   - lifecycle alignment actions only → APPLY_PROJECT_REMINDER_RULES_ALIGNMENT
 */
export async function runProjectLifecycleReminderRulesForAll(options = {}) {
  const {
    dryRun = true, apply = false, confirmText = '', mode = PLANNER_MODE_RUNTIME,
  } = options;
  const applying = shouldApply({ dryRun, apply });

  if (applying) {
    assertApplyModeIsLegacyBootstrap(mode);
  }

  if (applying && !ACCEPTED_APPLY_CONFIRM_TEXTS.has(confirmText)) {
    throw new Error('Missing explicit confirmText');
  }

  const context = await loadProjectLifecycleRuleContext(options);
  const allActions = [];

  for (const project of context.projects) {
    allActions.push(...planProjectLifecycleReminderActions(project, context, mode));
  }

  const groups = groupActions(allActions);
  const counts = buildCounts(groups);

  if (applying) {
    assertConfirmTextMatchesPlan(groups, confirmText);
  }

  const summary = {
    status: 'completed',
    mode,
    readOnly: !applying,
    dryRun: !applying,
    applied: applying,
    generated_at: new Date().toISOString(),
    projectsChecked: context.projects.length,
    counts,
    groups,
    executed: { resolved: 0, created: 0, skipped: 0, errors: [] },
    rateLimited: false,
  };

  if (!applying) return summary;

  for (const action of allActions) {
    if (action.action === 'skip_duplicate' || action.action === 'report_only') {
      summary.executed.skipped += 1;
      continue;
    }

    try {
      const result = await executeAction(action, context.cache);
      const resultAction = result?.action || '';

      if (action.action === 'resolve' && (resultAction === 'resolved' || resultAction === 'already_resolved')) {
        summary.executed.resolved += 1;
      } else if (action.action === 'create' && (resultAction === 'created' || resultAction === 'reactivated')) {
        summary.executed.created += 1;
      } else {
        summary.executed.skipped += 1;
      }
    } catch (error) {
      console.error('[projectLifecycleReminderRules] action failed', action.condition_key, error);
      summary.executed.errors.push({
        condition_key: action.condition_key,
        action: action.action,
        error: error?.message || String(error),
      });

      if (isRateLimitError(error)) {
        summary.rateLimited = true;
        break;
      }
    }
  }

  return summary;
}
