export const WORK_STAGE_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

export function isWorkStageCompleted(stage) {
  return stage?.aaron_approved === true
    && stage?.client_approved === true
    && stage?.draftsman_approved === true;
}

export function sortWorkStages(stages = []) {
  return [...stages].sort((left, right) => {
    const orderDiff = (Number(left.order_index) || 0) - (Number(right.order_index) || 0);
    if (orderDiff !== 0) return orderDiff;
    return String(left.id || '').localeCompare(String(right.id || ''));
  });
}

export function getNonCancelledWorkStages(stages = []) {
  return sortWorkStages(stages.filter((stage) => stage?.status !== WORK_STAGE_STATUS.CANCELLED));
}

export function normalizeWorkStageStatuses(stages = []) {
  const cancelledStages = stages.filter((stage) => stage?.status === WORK_STAGE_STATUS.CANCELLED);
  const sorted = getNonCancelledWorkStages(stages);
  const now = new Date().toISOString();
  let activeAssigned = false;

  const normalized = sorted.map((stage, index) => {
    if (isWorkStageCompleted(stage)) {
      return {
        ...stage,
        status: WORK_STAGE_STATUS.COMPLETED,
        completed_at: stage.completed_at || now,
      };
    }

    const hasIncompleteBefore = sorted
      .slice(0, index)
      .some((item) => !isWorkStageCompleted(item));

    let status = WORK_STAGE_STATUS.PENDING;
    if (!activeAssigned && !hasIncompleteBefore) {
      status = WORK_STAGE_STATUS.ACTIVE;
      activeAssigned = true;
    }

    return {
      ...stage,
      status,
      completed_at: '',
    };
  });

  return sortWorkStages([...normalized, ...cancelledStages]);
}

export function getActiveWorkStage(stages = []) {
  const normalized = normalizeWorkStageStatuses(stages);
  return normalized.find((stage) => stage.status === WORK_STAGE_STATUS.ACTIVE) || null;
}

export function buildWorkStagePayloadWithStatus(stageInput, allProjectStages = []) {
  const merged = allProjectStages.map((stage) => (
    stage.id === stageInput.id ? { ...stage, ...stageInput } : stage
  ));
  const normalized = normalizeWorkStageStatuses(merged);
  return normalized.find((stage) => stage.id === stageInput.id) || stageInput;
}

export function countActiveWorkStages(stages = []) {
  return normalizeWorkStageStatuses(stages).filter(
    (stage) => stage.status === WORK_STAGE_STATUS.ACTIVE,
  ).length;
}
