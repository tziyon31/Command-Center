import { base44 } from '@/api/base44Client';
import {
  cancelRemindersForDeletedSource,
  resolveReminderByConditionKey,
} from '@/lib/reminderEngine';
import { getWorkStageNeedsInvoiceReviewConditionKey } from '@/lib/invoiceReminderRules';
import { isWorkStageCompleted } from '@/lib/workStageLogic';
import { runWorkStageReminderRulesForProject } from '@/lib/workStageReminderRules';
import {
  getWorkStageNeedsCheckConditionKey,
  getWorkStageTargetDateConditionKey,
} from '@/lib/workStageReminderRules';
import {
  createDeletionSummary,
  findActiveRemindersForSourceRefs,
  listEntitiesByExactProjectId,
  normalizeEntityId,
  safeDeleteEntityRecord,
  trackDeletionResult,
} from '@/lib/deletionUtils';

export async function cancelWorkStageRelatedReminders(stageId) {
  const normalizedId = normalizeEntityId(stageId);
  if (!normalizedId) return;

  const conditionKeys = [
    getWorkStageNeedsCheckConditionKey(normalizedId),
    getWorkStageTargetDateConditionKey(normalizedId),
    getWorkStageNeedsInvoiceReviewConditionKey(normalizedId),
  ];

  for (const conditionKey of conditionKeys) {
    await resolveReminderByConditionKey(conditionKey, 'source_deleted');
  }

  await cancelRemindersForDeletedSource('work_stage', normalizedId);
}

export async function buildWorkProcessDeletionImpact(projectId, { entities = base44.entities } = {}) {
  const normalizedProjectId = normalizeEntityId(projectId);
  if (!normalizedProjectId) {
    throw new Error('MISSING_PROJECT_ID');
  }

  const [projectResults, workStages, reminders] = await Promise.all([
    entities.Project.filter({ id: normalizedProjectId }),
    listEntitiesByExactProjectId(entities.WorkStage, normalizedProjectId),
    entities.Reminder?.list ? entities.Reminder.list() : Promise.resolve([]),
  ]);

  const project = projectResults?.[0] || null;
  const sourceRefs = workStages.map((stage) => ['work_stage', stage.id]);
  const activeReminders = findActiveRemindersForSourceRefs(reminders, sourceRefs);

  return {
    projectId: normalizedProjectId,
    project,
    projectName: project?.name || workStages[0]?.project_name || 'פרויקט',
    workStages,
    stageTitles: workStages.map((stage) => stage.title || 'שלב ללא שם'),
    counts: {
      totalStages: workStages.length,
      completedStages: workStages.filter((stage) => isWorkStageCompleted(stage)).length,
      activeReminders: activeReminders.length,
    },
    activeReminders,
  };
}

export async function deleteWorkProcessForProject(projectId, { entities = base44.entities } = {}) {
  const impact = await buildWorkProcessDeletionImpact(projectId, { entities });
  const summary = createDeletionSummary();

  for (const stage of impact.workStages) {
    await cancelWorkStageRelatedReminders(stage.id);

    const result = await safeDeleteEntityRecord(entities.WorkStage, stage.id);
    trackDeletionResult(summary, 'workStages', result);

    if (result.status === 'failed') {
      throw result.error instanceof Error ? result.error : new Error(String(result.error || 'WORK_STAGE_DELETE_FAILED'));
    }
  }

  await runWorkStageReminderRulesForProject(impact.projectId);

  return { impact, summary };
}
