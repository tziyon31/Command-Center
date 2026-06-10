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
 * runtime (records only — Proposal/SignedProposal/WorkStage; Project.status is
 * NEVER a creation trigger):
 * - proposal needed:   no non-cancelled Proposal + no submitted SignedProposal
 *                      + no WorkStages + project is workflow-managed
 * - follow-up:         submitted Proposal without SignedProposal/WorkStages
 *                      → proposal_waiting_followup:<proposal.id>
 * - work stages:       submitted SignedProposal without WorkStages
 *                      → signed_proposal_needs_work_stages:<sp.id>
 * - status-only evidence (e.g. signed/execution with no records)
 *                      → runtimeEvidenceGaps, report only.
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

/**
 * Heuristic: is this project born/managed inside the new workflow?
 * Every current create path writes form_status (projectCreatePayload.js), and
 * inquiry/signed-proposal born projects carry source ids. Legacy imported
 * projects have none of these. An explicit `workflow_managed: true` field on
 * Project would be safer — flagged in the P2I report.
 */
export function isProjectWorkflowManaged(project) {
  if (project?.workflow_managed === true) return true;
  return Boolean(
    String(project?.form_status || '').trim()
    || String(project?.source_inquiry_id || '').trim()
    || String(project?.source_signed_proposal_id || '').trim(),
  );
}

const WORK_STAGE_FALLBACK_STATUSES = new Set(['signed', 'execution']);

const STATUS_BEHIND_WORKFLOW = new Set(['pricing', 'waiting']);

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

/**
 * Runtime rules — records only. Project.status is NEVER a trigger here:
 * status-only evidence is reported in runtimeEvidenceGaps instead of acted on.
 */
function planRuntimeWorkflowActions(project, context, shared) {
  const actions = [];
  const { cache, signedProposals, proposals = [], clientsById } = context;
  const {
    workflow, proposalKey, followupKey, workStagesKey, openSignedProposalReminders,
  } = shared;
  const { hasWorkStages, hasSubmittedSignedProposal } = workflow;
  const status = normalizeStatus(project);

  const projectProposals = getProposalsForProject(project.id, proposals);
  const nonCancelledProposals = projectProposals.filter(isNonCancelledProposal);
  const submittedProposals = projectProposals.filter(isSubmittedActiveProposal);

  // Runtime Rule 1 — proposal needed (records only, no Project.status):
  // covered by any non-cancelled Proposal / submitted SignedProposal / WorkStages.
  const proposalNeedIsCovered = (
    nonCancelledProposals.length > 0 || hasSubmittedSignedProposal || hasWorkStages
  );

  if (proposalNeedIsCovered) {
    const existingProposalReminder = summarizeExistingReminder(cache, proposalKey);
    if (existingProposalReminder) {
      actions.push({
        ...baseActionRow(project, 'staleProposalRemindersToResolve', 'project_needs_proposal', proposalKey),
        action: 'resolve',
        reason: 'Workflow records (proposal / signed proposal / work stages) already cover the proposal need',
        ...existingProposalReminder,
      });
    }
  } else if (!hasOpenReminderForConditionKey(cache, proposalKey)) {
    if (isProjectWorkflowManaged(project)) {
      actions.push({
        ...baseActionRow(project, 'pricingProposalRemindersToCreate', 'project_needs_proposal', proposalKey),
        action: 'create',
        reason: 'Workflow-managed project has no proposal records and no active proposal reminder (records-based)',
        reminder_input: buildPricingProposalReminderInput(project, clientsById),
      });
    } else {
      actions.push({
        ...baseActionRow(project, 'runtimeEvidenceGaps', 'project_needs_proposal', proposalKey),
        action: 'report_only',
        reason: 'Project has no workflow records and is not identifiably workflow-managed (no form_status / source_inquiry_id / source_signed_proposal_id)',
        recommended_action: 'Align via legacy bootstrap, or add an explicit workflow_managed field to Project',
      });
    }
  }

  // Runtime Rule 2 — proposal follow-up, based on submitted Proposal records
  // (NOT Project.status === waiting). Key: proposal_waiting_followup:<proposal.id>.
  const followupIsNeeded = (
    submittedProposals.length > 0 && !hasSubmittedSignedProposal && !hasWorkStages
  );

  if (followupIsNeeded) {
    for (const proposal of submittedProposals) {
      const proposalFollowupKey = getProposalWaitingFollowupConditionKey(proposal.id);
      if (hasOpenReminderForConditionKey(cache, proposalFollowupKey)) continue;

      if (hasOpenReminderForConditionKey(cache, followupKey)) {
        actions.push({
          ...baseActionRow(project, 'duplicatesPrevented', 'proposal_waiting_followup', proposalFollowupKey),
          action: 'skip_duplicate',
          reason: 'Legacy project_waiting_followup reminder already covers this follow-up',
        });
        continue;
      }

      actions.push({
        ...baseActionRow(project, 'proposalFollowupRemindersToCreate', 'proposal_waiting_followup', proposalFollowupKey),
        action: 'create',
        reason: 'Submitted proposal awaits client response (no signed proposal, no work stages)',
        reminder_input: buildProposalFollowupReminderInput(proposal, project, clientsById),
      });
    }
  } else {
    for (const proposal of projectProposals) {
      const proposalFollowupKey = getProposalWaitingFollowupConditionKey(proposal.id);
      const existing = summarizeExistingReminder(cache, proposalFollowupKey);
      if (existing) {
        actions.push({
          ...baseActionRow(project, 'projectWorkStageRemindersToResolve', 'proposal_waiting_followup', proposalFollowupKey),
          action: 'resolve',
          reason: hasSubmittedSignedProposal || hasWorkStages
            ? 'Workflow records (signed proposal / work stages) supersede the proposal follow-up'
            : 'Proposal is no longer submitted; follow-up has no record source',
          ...existing,
        });
      }
    }

    if (hasSubmittedSignedProposal || hasWorkStages) {
      const existingLegacyFollowup = summarizeExistingReminder(cache, followupKey);
      if (existingLegacyFollowup) {
        actions.push({
          ...baseActionRow(project, 'projectWorkStageRemindersToResolve', 'project_waiting_followup', followupKey),
          action: 'resolve',
          reason: 'Workflow records (signed proposal / work stages) supersede the legacy follow-up',
          ...existingLegacyFollowup,
        });
      }
    }
  }

  // Runtime Rule 3 — work stages needed: ONLY submitted SignedProposal counts
  // (no signed/execution status fallback). Key stays SP-based (R7).
  if (hasSubmittedSignedProposal && !hasWorkStages) {
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
        reason: 'Active project_needs_work_stages reminder already covers this project',
      });
    } else {
      const signedProposal = findSubmittedSignedProposalForProject(project, signedProposals);
      if (signedProposal?.id) {
        const signedProposalKey = getSignedProposalNeedsWorkStagesConditionKey(signedProposal.id);
        actions.push({
          ...baseActionRow(project, 'workStageRemindersToCreate', 'signed_proposal_needs_work_stages', signedProposalKey),
          action: 'create',
          reason: 'Submitted signed proposal exists but no work stages and no work-stage reminder (records-based)',
          reminder_input: buildSignedProposalWorkStagesReminderInput(signedProposal, project, clientsById),
        });
      }
    }
  } else {
    const existingWorkStagesReminder = summarizeExistingReminder(cache, workStagesKey);
    if (existingWorkStagesReminder) {
      actions.push({
        ...baseActionRow(project, 'projectWorkStageRemindersToResolve', 'project_needs_work_stages', workStagesKey),
        action: 'resolve',
        reason: hasWorkStages
          ? 'Work stages already exist for this project'
          : 'No submitted signed proposal; work-stage reminder has no record source',
        ...existingWorkStagesReminder,
      });
    }
  }

  // Evidence gap (report only): legacy status claims the project was accepted
  // but there are no records to act on. Runtime never guesses from status.
  if (!hasSubmittedSignedProposal && !hasWorkStages && WORK_STAGE_FALLBACK_STATUSES.has(status)) {
    actions.push({
      ...baseActionRow(project, 'runtimeEvidenceGaps', 'work_stages_needed', ''),
      action: 'report_only',
      reason: `Project.status is "${status}" but there is no submitted SignedProposal and no WorkStages record`,
      recommended_action: 'Align via legacy bootstrap or attach workflow records; runtime does not act on Project.status',
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

    const proposalReminderIsStale = mode === PLANNER_MODE_RUNTIME
      ? (
        hasNonCancelledProposalForProject(project.id, proposals)
        || hasSubmittedSignedProposal
        || hasWorkStages
      )
      : status !== 'pricing';

    if (proposalReminderIsStale) {
      const existingProposal = summarizeExistingReminder(cache, proposalKey);
      if (existingProposal) {
        actions.push({
          ...baseActionRow(project, 'staleProposalRemindersToResolve', 'project_needs_proposal', proposalKey),
          action: 'resolve',
          reason: mode === PLANNER_MODE_RUNTIME
            ? 'Workflow records (proposal / signed proposal / work stages) already cover the proposal need'
            : `Project status is "${status}" (not pricing); proposal reminder is stale`,
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
