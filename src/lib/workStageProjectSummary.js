import {
  getActiveWorkStage,
  getNonCancelledWorkStages,
  isWorkStageCompleted,
  normalizeWorkStageStatuses,
} from '@/lib/workStageLogic';

const parseDateValue = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const findUpcomingTargetDate = (stages, activeStage) => {
  const candidates = [];

  if (activeStage?.target_date) {
    candidates.push(activeStage.target_date);
  }

  for (const stage of stages) {
    if (isWorkStageCompleted(stage)) continue;
    if (activeStage?.id && stage.id === activeStage.id) continue;
    if (stage.target_date) candidates.push(stage.target_date);
  }

  const dated = candidates
    .map((value) => ({ value, date: parseDateValue(value) }))
    .filter((item) => item.date)
    .sort((left, right) => left.date - right.date);

  return dated[0]?.value || null;
};

/**
 * @returns {null | {
 *   totalStages: number,
 *   completedStages: number,
 *   activeStage: object | null,
 *   overallStatus: string,
 *   upcomingTargetDate: string | null,
 * }}
 */
export function computeProjectWorkStageSummary(stages = []) {
  const sorted = getNonCancelledWorkStages(stages);
  if (!sorted.length) return null;

  const normalized = normalizeWorkStageStatuses(stages);
  const totalStages = sorted.length;
  const completedStages = sorted.filter((stage) => isWorkStageCompleted(stage)).length;
  const activeStage = getActiveWorkStage(stages);

  let overallStatus = 'ממתין';
  if (completedStages === totalStages) {
    overallStatus = 'הושלם';
  } else if (activeStage) {
    overallStatus = 'בעבודה';
  } else if (completedStages === 0) {
    overallStatus = 'לא התחיל';
  }

  return {
    totalStages,
    completedStages,
    activeStage,
    overallStatus,
    upcomingTargetDate: findUpcomingTargetDate(normalized.filter(
      (stage) => stage.status !== 'cancelled',
    ), activeStage),
  };
}

export function groupWorkStagesByProjectId(workStages = []) {
  const groups = new Map();

  for (const stage of workStages) {
    const projectId = String(stage?.project_id || '').trim();
    if (!projectId) continue;

    if (!groups.has(projectId)) {
      groups.set(projectId, []);
    }
    groups.get(projectId).push(stage);
  }

  return groups;
}
