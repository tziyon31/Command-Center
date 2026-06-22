export const WORK_STAGE_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

export const PROJECT_WORK_STATE = {
  NO_STAGES: 'no_stages',
  IN_WORK: 'in_work',
  COMPLETED: 'completed',
};

export const PROJECT_WORK_STATE_LABELS = {
  [PROJECT_WORK_STATE.NO_STAGES]: 'לא הוגדרו שלבי עבודה',
  [PROJECT_WORK_STATE.IN_WORK]: 'בעבודה',
  [PROJECT_WORK_STATE.COMPLETED]: 'הושלם',
};

/** @deprecated Use PROJECT_WORK_STATE */
export const OPERATIONAL_WORK_STATUS = PROJECT_WORK_STATE;

/** @deprecated Use PROJECT_WORK_STATE_LABELS */
export const OPERATIONAL_WORK_STATUS_LABELS = PROJECT_WORK_STATE_LABELS;

const PROPOSAL_COMMERCIAL_STATUSES = new Set(['pricing', 'waiting', 'lead']);
const IN_WORK_COMMERCIAL_STATUSES = new Set(['execution', 'planning', 'submission']);
const COMPLETED_COMMERCIAL_STATUSES = new Set(['completed', 'collection_completed']);

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

export function getProjectWorkState(project, workStages = []) {
  const commercialStatus = String(project?.status || '').trim();
  const nonCancelled = getNonCancelledWorkStages(workStages);
  const totalStagesCount = nonCancelled.length;
  const completedStagesCount = nonCancelled.filter((stage) => isWorkStageCompleted(stage)).length;
  const hasWorkflowStages = totalStagesCount > 0;
  const allStagesCompleted = hasWorkflowStages && completedStagesCount === totalStagesCount;
  const activeStage = getActiveWorkStage(workStages);
  const currentStageTitle = activeStage?.title
    || (hasWorkflowStages ? nonCancelled[0]?.title || '' : '');

  let operationalStatus = PROJECT_WORK_STATE.NO_STAGES;

  if (COMPLETED_COMMERCIAL_STATUSES.has(commercialStatus) || allStagesCompleted) {
    operationalStatus = PROJECT_WORK_STATE.COMPLETED;
  } else if (hasWorkflowStages) {
    operationalStatus = PROJECT_WORK_STATE.IN_WORK;
  } else if (
    commercialStatus === 'signed'
    || IN_WORK_COMMERCIAL_STATUSES.has(commercialStatus)
  ) {
    operationalStatus = commercialStatus === 'signed'
      ? PROJECT_WORK_STATE.NO_STAGES
      : PROJECT_WORK_STATE.IN_WORK;
  } else if (!PROPOSAL_COMMERCIAL_STATUSES.has(commercialStatus)) {
    operationalStatus = PROJECT_WORK_STATE.NO_STAGES;
  }

  return {
    commercialStatus,
    operationalStatus,
    operationalStatusLabel: PROJECT_WORK_STATE_LABELS[operationalStatus] || operationalStatus,
    currentStageTitle,
    completedStagesCount,
    totalStagesCount,
    hasWorkflowStages,
    allStagesCompleted,
  };
}

/** @deprecated Use getProjectWorkState(project, workStages) */
export function getProjectOperationalWorkStatus(stages = [], project = {}) {
  const workState = getProjectWorkState(project, stages);

  return {
    key: workState.operationalStatus,
    label: workState.operationalStatusLabel,
    current_stage_title: workState.currentStageTitle,
    has_work_stages: workState.hasWorkflowStages,
  };
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

export function findCompletedStagesInvalidatedByReorder(stagesInNewOrder = []) {
  const ordered = sortWorkStages(
    stagesInNewOrder.filter((stage) => stage?.status !== WORK_STAGE_STATUS.CANCELLED),
  );

  const firstIncompleteIndex = ordered.findIndex((stage) => !isWorkStageCompleted(stage));
  if (firstIncompleteIndex === -1) return [];

  return ordered
    .slice(firstIncompleteIndex + 1)
    .filter((stage) => isWorkStageCompleted(stage));
}

export function buildWorkStageReorderConfirmMessage({
  nextActiveStage = null,
  invalidatedStages = [],
} = {}) {
  const activeName = nextActiveStage?.title || '(אין שלב פעיל)';

  if (!invalidatedStages.length) {
    return [
      'הסדר החדש ישנה את השלב הפעיל ואת התזכורות.',
      `השלב הפעיל החדש יהיה: ${activeName}.`,
      'האם לשמור את הסדר החדש?',
    ].join('\n');
  }

  const stageList = invalidatedStages
    .map((stage) => `• ${stage.title || 'שלב ללא שם'}`)
    .join('\n');

  return [
    'הסדר החדש מציב שלב פתוח לפני שלבים שכבר סומנו כהושלמו.',
    'כדי לשמור את הסדר החדש, האישורים של השלבים הבאים יתאפסו:',
    '',
    stageList,
    '',
    'המשמעות:',
    'השלבים האלה יחזרו למצב ממתין/פתוח, והתזכורות יחושבו מחדש לפי הסדר החדש.',
    '',
    'האם לאפס את האישורים ולשמור את הסדר החדש?',
  ].join('\n');
}
