import { MONETARY_OPEN_COLLECTION_STATUSES } from '@/lib/collectionDueUtils';
import {
  CONSTRUCTION_STATUS_NOT_UPDATED,
  getConstructionStatusLabel,
  normalizeConstructionStatus,
} from '@/lib/constructionStatusUtils';
import {
  getActiveWorkStage,
  getNonCancelledWorkStages,
  isWorkStageCompleted,
} from '@/lib/workStageLogic';

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export const PROJECT_WORK_STATUS_LABELS = {
  lead: 'ליד',
  pricing: 'בתמחור',
  waiting: 'ממתין לתגובה',
  signed: 'התקבלה',
  planning: 'בתכנון',
  submission: 'בהגשה',
  execution: 'בעבודה',
  completed: 'בוצע - תכנון הושלם',
  collection_completed: 'גבייה הושלמה',
  cancelled: 'בוטלה',
  rejected: 'לא התקבלה',
};

export const PIPELINE_GROUP_ORDER = [
  'proposal_pricing',
  'proposal_waiting',
  'accepted_without_workflow',
  'accepted_with_workflow',
  'in_work_without_workflow',
  'in_work_with_active_stage',
  'in_work_without_active_stage',
  'planning_completed',
  'rejected_cancelled',
  'other',
];

export const PIPELINE_GROUP_LABELS = {
  proposal_pricing: 'הצעות בתמחור',
  proposal_waiting: 'הצעות ממתינות לתגובה',
  accepted_without_workflow: 'התקבלה - דורש הגדרת שלבי עבודה',
  accepted_with_workflow: 'התקבלה - עם שלבי עבודה',
  in_work_without_workflow: 'בעבודה - ללא שלבי עבודה',
  in_work_with_active_stage: 'בעבודה - עם שלב פעיל',
  in_work_without_active_stage: 'בעבודה - עם שלבים אך בלי שלב פעיל',
  planning_completed: 'בוצע - תכנון הושלם',
  rejected_cancelled: 'לא התקבלו / בוטלו',
  other: 'אחר',
};

export const PIPELINE_GROUP_COLLAPSED_BY_DEFAULT = new Set(['rejected_cancelled']);

export const BUSINESS_ACTIVE_STATUSES = new Set([
  'pricing',
  'waiting',
  'signed',
  'planning',
  'submission',
  'execution',
  'completed',
  'collection_completed',
]);

function groupWorkStagesByProjectId(workStages = []) {
  const byProjectId = new Map();

  for (const stage of workStages) {
    const projectId = String(stage?.project_id || '').trim();
    if (!projectId) continue;
    if (!byProjectId.has(projectId)) byProjectId.set(projectId, []);
    byProjectId.get(projectId).push(stage);
  }

  return byProjectId;
}

function groupCollectionDuesByProjectId(collectionDues = []) {
  const byProjectId = new Map();

  for (const due of collectionDues) {
    const projectId = String(due?.project_id || '').trim();
    if (!projectId) continue;
    if (!byProjectId.has(projectId)) byProjectId.set(projectId, []);
    byProjectId.get(projectId).push(due);
  }

  return byProjectId;
}

export function getProjectWorkStatusLabel(project) {
  const status = String(project?.status || '').trim();
  return PROJECT_WORK_STATUS_LABELS[status] || status || '-';
}

export function getProjectWorkProgressLabel(project, stages = []) {
  const nonCancelled = getNonCancelledWorkStages(stages);
  const totalCount = nonCancelled.length;

  if (totalCount === 0) {
    return 'לא הוגדרו שלבי עבודה';
  }

  const completedCount = nonCancelled.filter((stage) => isWorkStageCompleted(stage)).length;
  const activeStage = getActiveWorkStage(stages);
  let label = `בוצעו ${completedCount}/${totalCount} שלבים`;

  if (activeStage?.title) {
    label += ` · שלב פעיל: ${activeStage.title}`;
  }

  return label;
}

export function getProjectConstructionStatusSummary(project) {
  const constructionStatus = normalizeConstructionStatus(project?.construction_status);

  return {
    construction_status: constructionStatus,
    construction_status_label: getConstructionStatusLabel(constructionStatus),
    construction_status_updated_at: project?.construction_status_updated_at || '',
    is_not_updated: constructionStatus === CONSTRUCTION_STATUS_NOT_UPDATED,
  };
}

export function getProjectCollectionSummary(project, collectionDues = []) {
  const projectId = String(project?.id || '').trim();
  const projectCollections = (collectionDues || []).filter(
    (item) => String(item?.project_id || '').trim() === projectId && item?.status !== 'cancelled',
  );

  const openCollections = projectCollections.filter(
    (item) => MONETARY_OPEN_COLLECTION_STATUSES.has(item?.status),
  );

  const openAmount = openCollections.reduce(
    (sum, item) => sum + Math.max(toNumber(item.remaining_amount), 0),
    0,
  );

  const paidAmount = projectCollections.reduce(
    (sum, item) => sum + Math.max(toNumber(item.amount_paid), 0),
    0,
  );

  return {
    open_collection_due_amount: openAmount,
    paid_collection_due_amount: paidAmount,
    has_open_collection_due: openCollections.length > 0,
    primary_open_collection_due_id: openCollections[0]?.id || null,
  };
}

function analyzeWorkStages(stages = []) {
  const nonCancelled = getNonCancelledWorkStages(stages);
  const activeStage = getActiveWorkStage(stages);
  const completedCount = nonCancelled.filter((stage) => isWorkStageCompleted(stage)).length;

  return {
    has_work_stages: nonCancelled.length > 0,
    work_stage_count: nonCancelled.length,
    completed_work_stage_count: completedCount,
    active_work_stage_title: activeStage?.title || '',
    has_active_work_stage: Boolean(activeStage),
    work_progress_label: getProjectWorkProgressLabel({}, stages),
  };
}

export function resolvePipelineGroupKey(project, workStageInfo) {
  const status = String(project?.status || '').trim();
  const {
    has_work_stages: hasWorkStages,
    has_active_work_stage: hasActiveWorkStage,
  } = workStageInfo;

  if (status === 'pricing') return 'proposal_pricing';
  if (status === 'waiting') return 'proposal_waiting';
  if (status === 'signed' && !hasWorkStages) return 'accepted_without_workflow';
  if (status === 'signed' && hasWorkStages) return 'accepted_with_workflow';
  if (status === 'execution' && !hasWorkStages) return 'in_work_without_workflow';
  if (status === 'execution' && hasWorkStages && hasActiveWorkStage) {
    return 'in_work_with_active_stage';
  }
  if (status === 'execution' && hasWorkStages && !hasActiveWorkStage) {
    return 'in_work_without_active_stage';
  }
  if (status === 'completed') return 'planning_completed';
  if (status === 'rejected' || status === 'cancelled') return 'rejected_cancelled';

  return 'other';
}

function resolveAttention(project, workStageInfo, collectionSummary, constructionSummary) {
  const status = String(project?.status || '').trim();

  if (status === 'signed' && !workStageInfo.has_work_stages) {
    return {
      attention_level: 'high',
      attention_reason: 'התקבלה ללא שלבי עבודה',
    };
  }

  if (status === 'execution' && !workStageInfo.has_work_stages) {
    return {
      attention_level: 'high',
      attention_reason: 'בעבודה ללא שלבי עבודה',
    };
  }

  if (collectionSummary.has_open_collection_due) {
    return {
      attention_level: 'medium',
      attention_reason: 'גבייה פתוחה',
    };
  }

  if (
    constructionSummary.is_not_updated
    && ['signed', 'execution', 'completed'].includes(status)
  ) {
    return {
      attention_level: 'medium',
      attention_reason: 'סטטוס בנייה לא עודכן',
    };
  }

  return {
    attention_level: 'low',
    attention_reason: '',
  };
}

export function buildProjectPipelineRow(project, {
  stages = [],
  collectionDues = [],
} = {}) {
  const workStageInfo = analyzeWorkStages(stages);
  const collectionSummary = getProjectCollectionSummary(project, collectionDues);
  const constructionSummary = getProjectConstructionStatusSummary(project);
  const groupKey = resolvePipelineGroupKey(project, workStageInfo);
  const attention = resolveAttention(
    project,
    workStageInfo,
    collectionSummary,
    constructionSummary,
  );

  return {
    project_id: project.id,
    project_name: project.name || '',
    bid_number: project.bid_number || '',
    work_number: project.work_number || '',
    client_id: project.client_id || '',
    client_name: '',
    city: project.city || '',
    project_type: project.project_type || '',
    year: toNumber(project.year),
    total_amount: toNumber(project.total_amount),
    status: String(project?.status || '').trim(),
    status_label: getProjectWorkStatusLabel(project),

    work_stage_count: workStageInfo.work_stage_count,
    completed_work_stage_count: workStageInfo.completed_work_stage_count,
    active_work_stage_title: workStageInfo.active_work_stage_title,
    work_progress_label: workStageInfo.work_progress_label,

    construction_status: constructionSummary.construction_status,
    construction_status_label: constructionSummary.construction_status_label,
    construction_status_updated_at: constructionSummary.construction_status_updated_at,

    open_collection_due_amount: collectionSummary.open_collection_due_amount,
    paid_collection_due_amount: collectionSummary.paid_collection_due_amount,
    has_open_collection_due: collectionSummary.has_open_collection_due,
    primary_open_collection_due_id: collectionSummary.primary_open_collection_due_id,

    group_key: groupKey,
    group_label: PIPELINE_GROUP_LABELS[groupKey] || PIPELINE_GROUP_LABELS.other,
    attention_level: attention.attention_level,
    attention_reason: attention.attention_reason,
  };
}

export function buildProjectPipelineRows(projects = [], workStages = [], collectionDues = []) {
  const workStagesByProjectId = groupWorkStagesByProjectId(workStages);

  return (projects || []).map((project) => {
    const projectId = String(project?.id || '').trim();
    const stages = workStagesByProjectId.get(projectId) || [];

    return buildProjectPipelineRow(project, {
      stages,
      collectionDues,
    });
  });
}

export function sortPipelineRows(rows = []) {
  return [...rows].sort((left, right) => {
    const yearDiff = toNumber(right.year) - toNumber(left.year);
    if (yearDiff !== 0) return yearDiff;

    return String(left.project_name || '').localeCompare(
      String(right.project_name || ''),
      'he',
    );
  });
}

export function groupProjectPipelineRows(rows = []) {
  const grouped = {};

  for (const groupKey of PIPELINE_GROUP_ORDER) {
    grouped[groupKey] = {
      group_key: groupKey,
      group_label: PIPELINE_GROUP_LABELS[groupKey],
      rows: [],
      count: 0,
      total_amount: 0,
      collapsed_by_default: PIPELINE_GROUP_COLLAPSED_BY_DEFAULT.has(groupKey),
    };
  }

  for (const row of sortPipelineRows(rows)) {
    const groupKey = grouped[row.group_key] ? row.group_key : 'other';
    grouped[groupKey].rows.push(row);
    grouped[groupKey].count += 1;
    grouped[groupKey].total_amount += toNumber(row.total_amount);
  }

  return grouped;
}

export function buildPipelineSummary(rows = []) {
  const businessActiveRows = rows.filter((row) => BUSINESS_ACTIVE_STATUSES.has(row.status));

  return {
    businessActiveCount: businessActiveRows.length,
    pricingCount: rows.filter((row) => row.group_key === 'proposal_pricing').length,
    waitingCount: rows.filter((row) => row.group_key === 'proposal_waiting').length,
    acceptedWithoutWorkflowCount: rows.filter(
      (row) => row.group_key === 'accepted_without_workflow',
    ).length,
    inWorkWithoutWorkflowCount: rows.filter(
      (row) => row.group_key === 'in_work_without_workflow',
    ).length,
    completedCount: rows.filter((row) => row.group_key === 'planning_completed').length,
    withWorkflowCount: rows.filter(
      (row) => row.group_key === 'accepted_with_workflow'
        || row.group_key === 'in_work_with_active_stage'
        || row.group_key === 'in_work_without_active_stage',
    ).length,
    openCollectionCount: rows.filter((row) => row.has_open_collection_due).length,
    constructionNotUpdatedCount: rows.filter(
      (row) => row.construction_status === CONSTRUCTION_STATUS_NOT_UPDATED
        && ['signed', 'execution', 'completed'].includes(row.status),
    ).length,
  };
}
