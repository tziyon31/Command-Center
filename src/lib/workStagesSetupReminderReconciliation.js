import { base44 } from '@/api/base44Client';
import { fetchWorkStagesForProjects } from '@/lib/workStageLoader';
import {
  getProjectNeedsWorkStagesConditionKey,
  getSignedProposalNeedsWorkStagesConditionKey,
  hasNonCancelledWorkStageForProject,
  PROJECT_NEEDS_WORK_STAGES_PREFIX,
  SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX,
} from '@/lib/workStageReminderRules';
import {
  loadReminderEngineCache,
  REMINDER_STATUS,
  resolveReminder,
  upsertReminderInCache,
} from '@/lib/reminderEngine';

const OPEN_REMINDER_STATUSES = new Set([
  REMINDER_STATUS.ACTIVE,
  REMINDER_STATUS.SNOOZED,
]);

function isOpenReminder(reminder) {
  return OPEN_REMINDER_STATUSES.has(reminder?.status);
}

function isProjectNeedsWorkStagesConditionKey(conditionKey) {
  return String(conditionKey || '').trim().startsWith(PROJECT_NEEDS_WORK_STAGES_PREFIX);
}

function isSignedProposalNeedsWorkStagesConditionKey(conditionKey) {
  return String(conditionKey || '').trim().startsWith(SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX);
}

function resolveProjectIdForSetupReminder(reminder, signedProposalsById = new Map()) {
  const directProjectId = String(reminder?.project_id || '').trim();
  if (directProjectId) return directProjectId;

  const conditionKey = String(reminder?.condition_key || '').trim();
  if (isProjectNeedsWorkStagesConditionKey(conditionKey)) {
    return conditionKey.slice(PROJECT_NEEDS_WORK_STAGES_PREFIX.length).trim();
  }

  if (isSignedProposalNeedsWorkStagesConditionKey(conditionKey)) {
    const signedProposalId = conditionKey.slice(SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX.length).trim();
    const signedProposal = signedProposalsById.get(signedProposalId);
    return String(signedProposal?.project_id || '').trim();
  }

  return '';
}

function findStaleWorkStagesSetupReminders(reminders = [], workStages = [], projectIds = new Set(), signedProposalsById = new Map()) {
  return reminders.filter((reminder) => {
    if (!isOpenReminder(reminder)) return false;

    const conditionKey = String(reminder?.condition_key || '').trim();
    const isSetupReminder = (
      isProjectNeedsWorkStagesConditionKey(conditionKey)
      || isSignedProposalNeedsWorkStagesConditionKey(conditionKey)
    );
    if (!isSetupReminder) return false;

    const projectId = resolveProjectIdForSetupReminder(reminder, signedProposalsById);
    return Boolean(projectId)
      && projectIds.has(projectId)
      && hasNonCancelledWorkStageForProject(projectId, workStages);
  });
}

async function safeListSignedProposals(entities) {
  if (!entities?.SignedProposal?.list) return [];
  try {
    return (await entities.SignedProposal.list()) || [];
  } catch (error) {
    console.warn('[workStagesSetupReminderReconciliation] failed to load SignedProposal list', error);
    return [];
  }
}

/**
 * One-time reconciliation: close stale setup reminders for projects that already
 * have non-cancelled WorkStages. Only touches project_needs_work_stages and
 * signed_proposal_needs_work_stages reminders.
 */
export async function reconcileStaleWorkStagesSetupReminders({
  entities = base44.entities,
  projects: projectsInput,
  workStages: workStagesInput,
  cache: cacheInput,
  dryRun = false,
} = {}) {
  const report = {
    projectsChecked: 0,
    projectsWithWorkStages: 0,
    staleSetupRemindersFound: 0,
    staleSetupRemindersResolved: 0,
    errors: [],
    resolvedReminderIds: [],
    dryRun,
  };

  let cache = cacheInput;
  try {
    cache = await loadReminderEngineCache(cache);
  } catch (error) {
    report.errors.push({
      stage: 'load_reminder_cache',
      message: error?.message || String(error),
    });
    return report;
  }

  let projects = projectsInput;
  if (!projects) {
    try {
      projects = await entities.Project.list('-year');
    } catch (error) {
      report.errors.push({
        stage: 'load_projects',
        message: error?.message || String(error),
      });
      return report;
    }
  }

  report.projectsChecked = projects.length;
  const projectIds = new Set(
    projects.map((project) => String(project?.id || '').trim()).filter(Boolean),
  );

  let workStages = workStagesInput;
  if (!workStages) {
    try {
      workStages = await fetchWorkStagesForProjects(projects, { entities });
    } catch (error) {
      report.errors.push({
        stage: 'load_work_stages',
        message: error?.message || String(error),
      });
      return report;
    }
  }

  report.projectsWithWorkStages = projects.filter((project) => {
    const projectId = String(project?.id || '').trim();
    return hasNonCancelledWorkStageForProject(projectId, workStages);
  }).length;

  const signedProposals = await safeListSignedProposals(entities);
  const signedProposalsById = new Map(
    signedProposals.map((item) => [String(item?.id || '').trim(), item]),
  );

  const staleReminders = findStaleWorkStagesSetupReminders(
    cache.reminders || [],
    workStages,
    projectIds,
    signedProposalsById,
  );

  report.staleSetupRemindersFound = staleReminders.length;

  if (dryRun) return report;

  for (const reminder of staleReminders) {
    try {
      const resolved = await resolveReminder(reminder.id, 'work_stages_defined');
      upsertReminderInCache(cache, resolved);
      if (resolved?.status === REMINDER_STATUS.RESOLVED) {
        report.staleSetupRemindersResolved += 1;
        report.resolvedReminderIds.push(reminder.id);
      }
    } catch (error) {
      report.errors.push({
        stage: 'resolve_reminder',
        reminder_id: reminder.id,
        condition_key: reminder.condition_key || '',
        message: error?.message || String(error),
      });
    }
  }

  return report;
}

export function getExpectedResolvedSetupConditionKeysForProject(projectId) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return [];

  return [
    getProjectNeedsWorkStagesConditionKey(normalizedProjectId),
  ];
}

export function getExpectedResolvedR7ConditionKeyForSignedProposal(signedProposalId) {
  const normalizedId = String(signedProposalId || '').trim();
  if (!normalizedId) return null;
  return getSignedProposalNeedsWorkStagesConditionKey(normalizedId);
}
