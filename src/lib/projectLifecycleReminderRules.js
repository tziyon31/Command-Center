/**
 * P2G — Project lifecycle reminder rules.
 *
 * Aligns project reminders with the current Project.status:
 * - status !== pricing  → resolve stale project_needs_proposal
 * - waiting             → ensure project_waiting_followup
 * - signed/execution    → ensure project_needs_work_stages when no WorkStages,
 *                         resolve it when WorkStages exist; resolve waiting followup
 * - completed/rejected/cancelled/collection_completed
 *                       → resolve project_waiting_followup + project_needs_work_stages
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
import { getProjectNeedsProposalConditionKey } from '@/lib/proposalReminderRules';
import {
  hasNonCancelledWorkStageForProject,
  SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX,
} from '@/lib/workStageReminderRules';
import { buildWorkStagesPageUrl } from '@/lib/workflowNavigation';

export const PROJECT_WAITING_FOLLOWUP_PREFIX = 'project_waiting_followup:';
export const PROJECT_NEEDS_WORK_STAGES_PREFIX = 'project_needs_work_stages:';

export const APPLY_PROJECT_REMINDER_RULES_CONFIRM_TEXT = 'APPLY_PROJECT_REMINDER_RULES_ALIGNMENT';

export function getProjectWaitingFollowupConditionKey(projectId) {
  return `${PROJECT_WAITING_FOLLOWUP_PREFIX}${projectId}`;
}

export function getProjectNeedsWorkStagesConditionKey(projectId) {
  return `${PROJECT_NEEDS_WORK_STAGES_PREFIX}${projectId}`;
}

const CLOSED_PROJECT_STATUSES = new Set([
  'completed',
  'rejected',
  'cancelled',
  'collection_completed',
]);

const WORK_STAGE_REMINDER_STATUSES = new Set(['signed', 'execution']);

const normalizeStatus = (project) => String(project?.status || '').trim();

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
 * Performs zero mutations.
 */
export function planProjectLifecycleReminderActions(project, context) {
  const actions = [];
  if (!project?.id) return actions;

  const status = normalizeStatus(project);
  const { cache, workStages, clientsById } = context;

  const proposalKey = getProjectNeedsProposalConditionKey(project.id);
  const followupKey = getProjectWaitingFollowupConditionKey(project.id);
  const workStagesKey = getProjectNeedsWorkStagesConditionKey(project.id);

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

  // Rule B: waiting → ensure follow-up reminder.
  if (status === 'waiting') {
    if (!hasOpenReminderForConditionKey(cache, followupKey)) {
      actions.push({
        ...baseActionRow(project, 'waitingFollowupRemindersToCreate', 'project_waiting_followup', followupKey),
        action: 'create',
        reason: 'Waiting project has no follow-up reminder',
        reminder_input: buildWaitingFollowupReminderInput(project, clientsById),
      });
    }
  } else {
    // Any non-waiting status → the waiting follow-up reminder is no longer relevant.
    const existingFollowup = summarizeExistingReminder(cache, followupKey);
    if (existingFollowup) {
      actions.push({
        ...baseActionRow(project, 'projectWorkStageRemindersToResolve', 'project_waiting_followup', followupKey),
        action: 'resolve',
        reason: `Project status is "${status}" (not waiting); follow-up reminder is no longer relevant`,
        ...existingFollowup,
      });
    }
  }

  // Rule C: signed/execution → work-stage setup reminder management.
  if (WORK_STAGE_REMINDER_STATUSES.has(status)) {
    const hasWorkStages = hasNonCancelledWorkStageForProject(project.id, workStages);

    if (hasWorkStages) {
      const existing = summarizeExistingReminder(cache, workStagesKey);
      if (existing) {
        actions.push({
          ...baseActionRow(project, 'projectWorkStageRemindersToResolve', 'project_needs_work_stages', workStagesKey),
          action: 'resolve',
          reason: 'Work stages already exist for this project',
          ...existing,
        });
      }
    } else {
      const signedProposalReminders = context
        .openSignedProposalWorkStageRemindersByProjectId.get(String(project.id)) || [];

      if (signedProposalReminders.length > 0) {
        actions.push({
          ...baseActionRow(project, 'duplicatesPrevented', 'project_needs_work_stages', workStagesKey),
          action: 'skip_duplicate',
          reason: 'Active signed_proposal_needs_work_stages reminder already covers this project',
          existing_signed_proposal_reminders: signedProposalReminders,
        });
      } else if (!hasOpenReminderForConditionKey(cache, workStagesKey)) {
        actions.push({
          ...baseActionRow(project, 'workStageRemindersToCreate', 'project_needs_work_stages', workStagesKey),
          action: 'create',
          reason: `${status} project has no work stages and no work-stage reminder`,
          reminder_input: buildWorkStagesReminderInput(project, clientsById),
        });
      }
    }
  }

  // Rule D: closed statuses → resolve project_needs_work_stages if still open.
  // (waiting follow-up is already handled by the non-waiting branch above.)
  if (CLOSED_PROJECT_STATUSES.has(status)) {
    const existing = summarizeExistingReminder(cache, workStagesKey);
    if (existing) {
      actions.push({
        ...baseActionRow(project, 'projectWorkStageRemindersToResolve', 'project_needs_work_stages', workStagesKey),
        action: 'resolve',
        reason: `Project status is "${status}"; work-stage reminder should be closed`,
        ...existing,
      });
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
    if (action.action === 'skip_duplicate') {
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
