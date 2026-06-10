/**
 * P2G — Project lifecycle reminder rules (workflow-first).
 *
 * Truth order: workflow records are stronger than Project.status —
 *   1. WorkStages exist            → project is in execution workflow
 *   2. submitted SignedProposal    → project is at least at signed-proposal stage
 *   3. Project.status              → fallback only when no workflow records
 * When Project.status contradicts the workflow, valid reminders are NOT
 * resolved — the conflict is reported as a statusWorkflowMismatch instead.
 *
 * Rules:
 * - status !== pricing                          → resolve stale project_needs_proposal
 * - waiting + no workflow records               → ensure project_waiting_followup
 * - submitted SignedProposal OR signed/execution, without WorkStages
 *                                               → ensure work-stage reminder (with dedup
 *                                                 against signed_proposal_needs_work_stages)
 * - WorkStages exist / no workflow source       → resolve project_needs_work_stages
 *
 * Default mode is dry-run (plan only, zero mutations). Mutations require
 * apply: true, dryRun: false AND the explicit confirmText.
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
  hasNonCancelledWorkStageForProject,
  SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX,
} from '@/lib/workStageReminderRules';
import { buildWorkStagesPageUrl } from '@/lib/workflowNavigation';
import {
  getProjectWorkflowExclusion,
  isProjectExcludedFromWorkflowReminders,
} from '@/lib/projectWorkflowExclusions';

export const PROJECT_WAITING_FOLLOWUP_PREFIX = 'project_waiting_followup:';
export const PROJECT_NEEDS_WORK_STAGES_PREFIX = 'project_needs_work_stages:';

export const APPLY_PROJECT_REMINDER_RULES_CONFIRM_TEXT = 'APPLY_PROJECT_REMINDER_RULES_ALIGNMENT';

export function getProjectWaitingFollowupConditionKey(projectId) {
  return `${PROJECT_WAITING_FOLLOWUP_PREFIX}${projectId}`;
}

export function getProjectNeedsWorkStagesConditionKey(projectId) {
  return `${PROJECT_NEEDS_WORK_STAGES_PREFIX}${projectId}`;
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

  const [projects, workStages, signedProposals, clients] = await Promise.all([
    safeListEntity(entities, 'Project'),
    safeListEntity(entities, 'WorkStage'),
    safeListEntity(entities, 'SignedProposal'),
    safeListEntity(entities, 'Client'),
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
    signedProposalsById,
    clientsById,
    openSignedProposalWorkStageRemindersByProjectId:
      buildOpenSignedProposalWorkStageReminderMap(cache, signedProposalsById),
  };
}

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
 * Pure planner: returns the list of planned actions for one project.
 * Workflow records win over Project.status. Performs zero mutations.
 */
export function planProjectLifecycleReminderActions(project, context) {
  const actions = [];
  if (!project?.id) return actions;

  const status = normalizeStatus(project);
  const { cache, workStages, signedProposals, clientsById } = context;

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

    if (status !== 'pricing') {
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
    waitingFollowupRemindersToCreate: [],
    workStageRemindersToCreate: [],
    projectWorkStageRemindersToResolve: [],
    duplicatesPrevented: [],
    statusWorkflowMismatches: [],
    excludedWorkflowRemindersToResolve: [],
    workflowExcludedProjects: [],
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
    waitingFollowupRemindersToCreate: groups.waitingFollowupRemindersToCreate.length,
    workStageRemindersToCreate: groups.workStageRemindersToCreate.length,
    projectWorkStageRemindersToResolve: groups.projectWorkStageRemindersToResolve.length,
    duplicatesPrevented: groups.duplicatesPrevented.length,
    statusWorkflowMismatches: groups.statusWorkflowMismatches.length,
    excludedWorkflowRemindersToResolve: groups.excludedWorkflowRemindersToResolve.length,
    workflowExcludedProjects: groups.workflowExcludedProjects.length,
  };
}

const shouldApply = (options = {}) => options.apply === true && options.dryRun === false;

/**
 * Runs lifecycle rules for a single project.
 * Default: dryRun=true, apply=false — returns the plan without mutating.
 */
export async function runProjectLifecycleReminderRulesForProject(project, options = {}) {
  const { dryRun = true, apply = false, confirmText = '' } = options;
  const applying = shouldApply({ dryRun, apply });

  if (applying && confirmText !== APPLY_PROJECT_REMINDER_RULES_CONFIRM_TEXT) {
    throw new Error('Missing explicit confirmText');
  }

  const context = options.context || await loadProjectLifecycleRuleContext(options);
  const actions = planProjectLifecycleReminderActions(project, context);

  if (!applying) {
    return { dryRun: true, applied: false, actions };
  }

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
 *   apply: true, dryRun: false,
 *   confirmText: APPLY_PROJECT_REMINDER_RULES_CONFIRM_TEXT
 */
export async function runProjectLifecycleReminderRulesForAll(options = {}) {
  const { dryRun = true, apply = false, confirmText = '' } = options;
  const applying = shouldApply({ dryRun, apply });

  if (applying && confirmText !== APPLY_PROJECT_REMINDER_RULES_CONFIRM_TEXT) {
    throw new Error('Missing explicit confirmText');
  }

  const context = await loadProjectLifecycleRuleContext(options);
  const allActions = [];

  for (const project of context.projects) {
    allActions.push(...planProjectLifecycleReminderActions(project, context));
  }

  const groups = groupActions(allActions);
  const counts = buildCounts(groups);

  const summary = {
    status: 'completed',
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
