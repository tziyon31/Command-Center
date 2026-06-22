export const WORK_STAGE_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

export const OPERATIONAL_WORK_STATUS = {
  NO_STAGES: 'no_stages',
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
};

export const OPERATIONAL_WORK_STATUS_LABELS = {
  [OPERATIONAL_WORK_STATUS.NO_STAGES]: 'לא הוגדרו שלבי עבודה',
  [OPERATIONAL_WORK_STATUS.NOT_STARTED]: 'טרם התחיל',
  [OPERATIONAL_WORK_STATUS.IN_PROGRESS]: 'בעבודה',
  [OPERATIONAL_WORK_STATUS.COMPLETED]: 'הושלם',
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

function hasStageWorkProgress(stage) {
  if (!stage) return false;

  return isWorkStageCompleted(stage)
    || Boolean(stage.aaron_approved || stage.client_approved || stage.draftsman_approved);
}

export function getProjectOperationalWorkStatus(stages = []) {
  const nonCancelled = getNonCancelledWorkStages(stages);

  if (nonCancelled.length === 0) {
    return {
      key: OPERATIONAL_WORK_STATUS.NO_STAGES,
      label: OPERATIONAL_WORK_STATUS_LABELS[OPERATIONAL_WORK_STATUS.NO_STAGES],
      current_stage_title: '',
      has_work_stages: false,
    };
  }

  const allCompleted = nonCancelled.every((stage) => isWorkStageCompleted(stage));
  if (allCompleted) {
    return {
      key: OPERATIONAL_WORK_STATUS.COMPLETED,
      label: OPERATIONAL_WORK_STATUS_LABELS[OPERATIONAL_WORK_STATUS.COMPLETED],
      current_stage_title: '',
      has_work_stages: true,
    };
  }

  const activeStage = getActiveWorkStage(stages);
  const hasAnyProgress = nonCancelled.some(hasStageWorkProgress);

  if (!hasAnyProgress) {
    const nextStage = activeStage || nonCancelled[0] || null;
    return {
      key: OPERATIONAL_WORK_STATUS.NOT_STARTED,
      label: OPERATIONAL_WORK_STATUS_LABELS[OPERATIONAL_WORK_STATUS.NOT_STARTED],
      current_stage_title: nextStage?.title || '',
      has_work_stages: true,
    };
  }

  return {
    key: OPERATIONAL_WORK_STATUS.IN_PROGRESS,
    label: OPERATIONAL_WORK_STATUS_LABELS[OPERATIONAL_WORK_STATUS.IN_PROGRESS],
    current_stage_title: activeStage?.title || '',
    has_work_stages: true,
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
