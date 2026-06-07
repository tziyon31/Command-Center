import { base44 } from '@/api/base44Client';
import {
  normalizeWorkStageStatuses,
} from '@/lib/workStageLogic';
import { runWorkStageReminderRulesForProject } from '@/lib/workStageReminderRules';
import { runWorkStageInvoiceReviewRulesForProject } from '@/lib/invoiceReminderRules';

export async function loadWorkStagesForProject(projectId) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return [];

  const items = await base44.entities.WorkStage.list();
  return items.filter((stage) => String(stage.project_id || '').trim() === normalizedProjectId);
}

export async function persistNormalizedWorkStages(stages = []) {
  const normalized = normalizeWorkStageStatuses(stages);
  const updatedIds = [];

  for (const stage of normalized) {
    const original = stages.find((item) => item.id === stage.id);
    if (!original) continue;

    const patch = {};
    if (original.status !== stage.status) patch.status = stage.status;

    const beforeCompletedAt = String(original.completed_at || '');
    const afterCompletedAt = String(stage.completed_at || '');
    if (beforeCompletedAt !== afterCompletedAt) {
      patch.completed_at = afterCompletedAt;
    }

    if (!Object.keys(patch).length) continue;

    await base44.entities.WorkStage.update(stage.id, patch);
    updatedIds.push(stage.id);
  }

  return { normalized, updatedIds };
}

export async function recalculateProjectWorkStages(projectId, options = {}) {
  const stages = options.stages ?? await loadWorkStagesForProject(projectId);
  const result = await persistNormalizedWorkStages(stages);

  await runWorkStageReminderRulesForProject(projectId, {
    ...options,
    workStages: result.normalized,
  });

  await runWorkStageInvoiceReviewRulesForProject(projectId, {
    ...options,
    stages: result.normalized,
  });

  return result;
}

export async function getNextWorkStageOrderIndex(projectId) {
  const stages = await loadWorkStagesForProject(projectId);
  const maxIndex = stages.reduce(
    (max, stage) => Math.max(max, Number(stage.order_index) || 0),
    0,
  );
  return maxIndex + 1;
}

export async function invalidateWorkStageQueries(queryClient, projectId) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['work-stages'] }),
    queryClient.invalidateQueries({ queryKey: ['work-stages', projectId] }),
    queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
    queryClient.invalidateQueries({ queryKey: ['project-details', projectId] }),
    queryClient.invalidateQueries({ queryKey: ['reminders'] }),
    queryClient.invalidateQueries({ queryKey: ['reminders', 'visible'] }),
  ]);
}
