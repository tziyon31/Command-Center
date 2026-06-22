import { base44 } from '@/api/base44Client';
import { MONETARY_OPEN_COLLECTION_STATUSES } from '@/lib/collectionDueUtils';
import {
  COLLECTION_NEEDS_TAX_INVOICE_PREFIX,
  COLLECTION_PAYMENT_DUE_PREFIX,
} from '@/lib/collectionReminderRules';
import {
  CONSTRUCTION_STATUS_NOT_UPDATED,
  getConstructionStatusLabel,
  normalizeConstructionStatus,
} from '@/lib/constructionStatusUtils';
import {
  getActiveWorkStage,
  getNonCancelledWorkStages,
  getProjectOperationalWorkStatus,
  isWorkStageCompleted,
  OPERATIONAL_WORK_STATUS,
} from '@/lib/workStageLogic';
import {
  getVisibleReminders,
  sortVisibleReminders,
} from '@/lib/reminderEngine';
import { createPageUrl } from '@/utils';

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

export const PROJECT_COMMERCIAL_STATUS_LABELS = PROJECT_WORK_STATUS_LABELS;

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

export const PIPELINE_GROUP_EXPANDED_BY_DEFAULT = new Set([
  'proposal_pricing',
  'proposal_waiting',
  'accepted_without_workflow',
  'in_work_without_workflow',
]);

export const PIPELINE_GROUP_COLLAPSED_BY_DEFAULT = new Set([
  'planning_completed',
  'rejected_cancelled',
]);

export const PIPELINE_GROUP_EMPTY_MESSAGES = {
  proposal_pricing: 'אין פרויקטים בקבוצה זו',
  proposal_waiting: 'אין פרויקטים בקבוצה זו',
  accepted_without_workflow: 'אין פרויקטים בקבוצה זו',
  accepted_with_workflow: 'אין פרויקטים עם שלבי עבודה מוגדרים עדיין',
  in_work_without_workflow: 'אין פרויקטים בקבוצה זו',
  in_work_with_active_stage: 'אין פרויקטים עם שלב פעיל כרגע',
  in_work_without_active_stage: 'אין פרויקטים עם שלבים ללא שלב פעיל',
  planning_completed: 'אין פרויקטים בקבוצה זו',
  rejected_cancelled: 'אין פרויקטים בקבוצה זו',
  other: 'אין פרויקטים בקבוצה זו',
};

export const PIPELINE_STATUS_DISPLAY_LABELS = {
  lead: 'ליד',
  pricing: 'בתמחור',
  waiting: 'ממתין לתגובה',
  signed: 'התקבלה',
  planning: 'בתכנון',
  submission: 'בהגשה',
  execution: 'בעבודה',
  completed: 'בוצע - תכנון הושלם',
  collection_completed: 'גבייה הושלמה',
  cancelled: 'בוטל',
  rejected: 'לא התקבל',
};

export const PIPELINE_BADGE_LABELS = {
  no_work_stages: 'ללא שלבי עבודה',
  open_collection_due: 'גבייה פתוחה',
  construction_not_updated: 'סטטוס בנייה לא עודכן',
  proposal_waiting: 'ממתין לתגובה',
  completed_planning: 'תכנון הושלם',
  cancelled: 'בוטל',
  rejected: 'לא התקבל',
};

export const PIPELINE_QUICK_FILTER_KEYS = {
  PROPOSALS: 'proposals',
  ACCEPTED: 'accepted',
  IN_WORK: 'in_work',
  NO_WORK_STAGES: 'no_work_stages',
  OPEN_COLLECTION: 'open_collection',
  CONSTRUCTION_NOT_UPDATED: 'construction_not_updated',
  COMPLETED: 'completed',
  PRICING: 'pricing',
  WAITING: 'waiting',
  ACCEPTED_NO_STAGES: 'accepted_no_stages',
  IN_WORK_NO_STAGES: 'in_work_no_stages',
  ACTIVE_REMINDERS: 'active_reminders',
};

const COLLECTION_REMINDER_CONDITION_PREFIXES = [
  COLLECTION_PAYMENT_DUE_PREFIX,
  COLLECTION_NEEDS_TAX_INVOICE_PREFIX,
];

const PROJECT_NEEDS_WORK_STAGES_PREFIX = 'project_needs_work_stages:';
const SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX = 'signed_proposal_needs_work_stages:';

function getReminderActionUrl(reminder) {
  return String(reminder?.action_url || reminder?.target_url || '').trim();
}

function reminderMatchesProject(reminder, projectId) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return false;

  const reminderProjectId = String(reminder?.project_id || '').trim();
  const conditionKey = String(reminder?.condition_key || '').trim();
  const actionUrl = getReminderActionUrl(reminder);

  return (
    reminderProjectId === normalizedProjectId
    || actionUrl.includes(`project_id=${normalizedProjectId}`)
    || actionUrl.includes(`id=${normalizedProjectId}`)
    || conditionKey.endsWith(`:${normalizedProjectId}`)
  );
}

export function isWorkStagesReminder(reminder) {
  const conditionKey = String(reminder?.condition_key || '').trim();
  const actionUrl = getReminderActionUrl(reminder);

  return (
    conditionKey.startsWith(PROJECT_NEEDS_WORK_STAGES_PREFIX)
    || conditionKey.startsWith(SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX)
    || actionUrl.includes('/WorkStages')
  );
}

export function findWorkStagesReminderForProject(projectOrProjectId, activeReminders = []) {
  const projectId = typeof projectOrProjectId === 'object'
    ? String(projectOrProjectId?.id || projectOrProjectId?.project_id || '').trim()
    : String(projectOrProjectId || '').trim();

  if (!projectId) return null;

  return (activeReminders || []).find((reminder) => {
    if (reminder?.status && reminder.status !== 'active') return false;
    if (!reminderMatchesProject(reminder, projectId)) return false;
    return isWorkStagesReminder(reminder);
  }) || null;
}

export function isPipelineGroupExpandedByDefault(groupKey) {
  return PIPELINE_GROUP_EXPANDED_BY_DEFAULT.has(groupKey);
}

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

export function getProjectCommercialStatusLabel(project) {
  const status = String(project?.status || '').trim();
  return PROJECT_COMMERCIAL_STATUS_LABELS[status] || status || '-';
}

export function getProjectWorkStatusLabel(project) {
  return getProjectCommercialStatusLabel(project);
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
  const operationalWorkStatus = getProjectOperationalWorkStatus(stages);

  return {
    has_work_stages: nonCancelled.length > 0,
    work_stage_count: nonCancelled.length,
    completed_work_stage_count: completedCount,
    active_work_stage_title: activeStage?.title || '',
    has_active_work_stage: Boolean(activeStage),
    work_progress_label: getProjectWorkProgressLabel({}, stages),
    operational_work_status_key: operationalWorkStatus.key,
    operational_work_status_label: operationalWorkStatus.label,
    operational_current_stage_title: operationalWorkStatus.current_stage_title,
  };
}

export function resolvePipelineGroupKey(project, workStageInfo) {
  const status = String(project?.status || '').trim();
  const {
    has_work_stages: hasWorkStages,
    has_active_work_stage: hasActiveWorkStage,
    operational_work_status_key: operationalKey,
  } = workStageInfo;

  if (status === 'pricing' || status === 'lead') return 'proposal_pricing';
  if (status === 'waiting') return 'proposal_waiting';
  if (status === 'rejected' || status === 'cancelled') return 'rejected_cancelled';
  if (status === 'completed' || status === 'collection_completed') return 'planning_completed';

  if (operationalKey === OPERATIONAL_WORK_STATUS.COMPLETED) {
    return 'planning_completed';
  }

  if (operationalKey === OPERATIONAL_WORK_STATUS.NO_STAGES) {
    if (['execution', 'planning', 'submission'].includes(status)) {
      return 'in_work_without_workflow';
    }
    if (status === 'signed') return 'accepted_without_workflow';
  }

  if (operationalKey === OPERATIONAL_WORK_STATUS.NOT_STARTED) {
    return 'accepted_with_workflow';
  }

  if (operationalKey === OPERATIONAL_WORK_STATUS.IN_PROGRESS) {
    if (hasWorkStages && hasActiveWorkStage) return 'in_work_with_active_stage';
    if (hasWorkStages) return 'in_work_without_active_stage';
    return 'in_work_without_workflow';
  }

  if (status === 'signed' && !hasWorkStages) return 'accepted_without_workflow';
  if (status === 'signed' && hasWorkStages) return 'accepted_with_workflow';
  if (status === 'execution' && !hasWorkStages) return 'in_work_without_workflow';
  if (status === 'execution' && hasWorkStages && hasActiveWorkStage) {
    return 'in_work_with_active_stage';
  }
  if (status === 'execution' && hasWorkStages && !hasActiveWorkStage) {
    return 'in_work_without_active_stage';
  }

  return 'other';
}

function buildRowBadges(project, workStageInfo, collectionSummary, constructionSummary) {
  const status = String(project?.status || '').trim();
  const badges = [];

  if (status === 'waiting') {
    badges.push({ code: 'proposal_waiting', label: PIPELINE_BADGE_LABELS.proposal_waiting });
  }
  if (status === 'completed') {
    badges.push({ code: 'completed_planning', label: PIPELINE_BADGE_LABELS.completed_planning });
  }
  if (status === 'cancelled') {
    badges.push({ code: 'cancelled', label: PIPELINE_BADGE_LABELS.cancelled });
  }
  if (status === 'rejected') {
    badges.push({ code: 'rejected', label: PIPELINE_BADGE_LABELS.rejected });
  }
  if ((status === 'signed' || status === 'execution') && !workStageInfo.has_work_stages) {
    badges.push({ code: 'no_work_stages', label: PIPELINE_BADGE_LABELS.no_work_stages });
  }
  if (collectionSummary.has_open_collection_due) {
    badges.push({ code: 'open_collection_due', label: PIPELINE_BADGE_LABELS.open_collection_due });
  }
  if (
    constructionSummary.is_not_updated
    && ['signed', 'execution', 'completed'].includes(status)
  ) {
    badges.push({
      code: 'construction_not_updated',
      label: PIPELINE_BADGE_LABELS.construction_not_updated,
    });
  }

  return badges;
}

export function getWorkStagesCompactDisplay(row) {
  if (!row?.work_stage_count) {
    return {
      primary: 'לא הוגדרו שלבים',
      secondary: '',
    };
  }

  const primary = `בוצעו ${row.completed_work_stage_count}/${row.work_stage_count}`;
  const secondary = row.active_work_stage_title
    ? `פעיל: ${row.active_work_stage_title}`
    : '';

  return { primary, secondary };
}

export function getPipelineStatusDisplayLabel(status) {
  const normalized = String(status || '').trim();
  return PIPELINE_STATUS_DISPLAY_LABELS[normalized]
    || PROJECT_WORK_STATUS_LABELS[normalized]
    || normalized
    || '-';
}

export function matchesQuickFilter(row, quickFilter) {
  if (!quickFilter) return true;

  switch (quickFilter) {
    case PIPELINE_QUICK_FILTER_KEYS.PROPOSALS:
      return ['pricing', 'waiting'].includes(row.status);
    case PIPELINE_QUICK_FILTER_KEYS.ACCEPTED:
      return row.status === 'signed'
        && row.operational_work_status_key !== OPERATIONAL_WORK_STATUS.IN_PROGRESS
        && row.operational_work_status_key !== OPERATIONAL_WORK_STATUS.COMPLETED;
    case PIPELINE_QUICK_FILTER_KEYS.IN_WORK:
      return row.operational_work_status_key === OPERATIONAL_WORK_STATUS.IN_PROGRESS
        || (
          row.status === 'execution'
          && row.operational_work_status_key !== OPERATIONAL_WORK_STATUS.COMPLETED
        );
    case PIPELINE_QUICK_FILTER_KEYS.NO_WORK_STAGES:
      return row.work_stage_count === 0;
    case PIPELINE_QUICK_FILTER_KEYS.OPEN_COLLECTION:
      return row.has_open_collection_due;
    case PIPELINE_QUICK_FILTER_KEYS.CONSTRUCTION_NOT_UPDATED:
      return row.construction_status === CONSTRUCTION_STATUS_NOT_UPDATED
        && ['signed', 'execution', 'completed'].includes(row.status);
    case PIPELINE_QUICK_FILTER_KEYS.COMPLETED:
      return row.group_key === 'planning_completed';
    case PIPELINE_QUICK_FILTER_KEYS.PRICING:
      return row.group_key === 'proposal_pricing';
    case PIPELINE_QUICK_FILTER_KEYS.WAITING:
      return row.group_key === 'proposal_waiting';
    case PIPELINE_QUICK_FILTER_KEYS.ACCEPTED_NO_STAGES:
      return row.group_key === 'accepted_without_workflow';
    case PIPELINE_QUICK_FILTER_KEYS.IN_WORK_NO_STAGES:
      return row.group_key === 'in_work_without_workflow';
    case PIPELINE_QUICK_FILTER_KEYS.ACTIVE_REMINDERS:
      return toNumber(row.active_reminder_count) > 0;
    default:
      return true;
  }
}

export async function loadReadOnlyVisibleReminders({ now = new Date() } = {}) {
  const reminders = await base44.entities.Reminder.list();
  const visible = getVisibleReminders(reminders, now);
  return sortVisibleReminders(visible, now);
}

export function parseProjectIdFromReminderUrl(url) {
  const value = String(url || '').trim();
  if (!value) return '';

  const queryPart = value.includes('?') ? value.split('?')[1].split('#')[0] : '';
  if (queryPart) {
    const params = new URLSearchParams(queryPart);
    const projectId = params.get('id') || params.get('project_id');
    if (projectId) return String(projectId).trim();
  }

  const match = value.match(/(?:^|[?&])(?:id|project_id)=([^&#]+)/);
  return match ? decodeURIComponent(match[1]).trim() : '';
}

function buildCollectionDuesById(collectionDues = []) {
  const byId = new Map();
  for (const due of collectionDues) {
    const dueId = String(due?.id || '').trim();
    if (!dueId) continue;
    byId.set(dueId, due);
  }
  return byId;
}

function buildProjectIdsSet(projects = []) {
  return new Set(
    (projects || [])
      .map((project) => String(project?.id || '').trim())
      .filter(Boolean),
  );
}

function resolveCollectionDueProjectId(conditionKey, collectionDuesById) {
  const normalizedKey = String(conditionKey || '').trim();
  if (!normalizedKey) return '';

  for (const prefix of COLLECTION_REMINDER_CONDITION_PREFIXES) {
    if (!normalizedKey.startsWith(prefix)) continue;

    const collectionDueId = normalizedKey.slice(prefix.length).trim();
    const collectionDue = collectionDuesById.get(collectionDueId);
    return String(collectionDue?.project_id || '').trim();
  }

  return '';
}

export function resolveReminderProjectId(reminder, {
  collectionDuesById = new Map(),
  projectIds = new Set(),
} = {}) {
  const directProjectId = String(reminder?.project_id || '').trim();
  if (directProjectId && projectIds.has(directProjectId)) {
    return directProjectId;
  }

  const collectionProjectId = resolveCollectionDueProjectId(
    reminder?.condition_key,
    collectionDuesById,
  );
  if (collectionProjectId && projectIds.has(collectionProjectId)) {
    return collectionProjectId;
  }

  const urlProjectId = parseProjectIdFromReminderUrl(reminder?.action_url);
  if (urlProjectId && projectIds.has(urlProjectId)) {
    return urlProjectId;
  }

  return '';
}

export function toReminderSummary(reminder, projectId) {
  const mappedProjectId = String(projectId || reminder?.project_id || '').trim();
  const actionUrl = String(reminder?.action_url || '').trim();
  const fallbackProjectUrl = mappedProjectId
    ? createPageUrl(`ProjectDetails?id=${mappedProjectId}`)
    : '';

  return {
    id: reminder.id,
    title: reminder.title || '',
    description: reminder.description || '',
    status: reminder.status,
    condition_key: reminder.condition_key || '',
    frequency: reminder.frequency || '',
    next_remind_at: reminder.next_remind_at || '',
    project_id: mappedProjectId,
    project_name: reminder.project_name || '',
    client_name: reminder.client_name || '',
    action_url: actionUrl,
    target_url: actionUrl || fallbackProjectUrl,
    target_label: reminder.action_label || '',
    action_label: reminder.action_label || '',
    source_type: reminder.source_type || '',
    has_navigation_target: Boolean(actionUrl || mappedProjectId),
  };
}

export function buildProjectReminderMap(reminders = [], projects = [], collectionDues = []) {
  const byProjectId = {};
  const unmappedReminders = [];
  const projectIds = buildProjectIdsSet(projects);
  const collectionDuesById = buildCollectionDuesById(collectionDues);

  let mappedProjectRemindersCount = 0;
  let collectionReminderMappedCount = 0;

  for (const reminder of reminders) {
    const projectId = resolveReminderProjectId(reminder, {
      collectionDuesById,
      projectIds,
    });

    if (!projectId) {
      unmappedReminders.push(reminder);
      continue;
    }

    const summary = toReminderSummary(reminder, projectId);
    if (!byProjectId[projectId]) byProjectId[projectId] = [];
    byProjectId[projectId].push(summary);
    mappedProjectRemindersCount += 1;

    const conditionKey = String(reminder?.condition_key || '');
    if (COLLECTION_REMINDER_CONDITION_PREFIXES.some((prefix) => conditionKey.startsWith(prefix))) {
      collectionReminderMappedCount += 1;
    }
  }

  for (const projectId of Object.keys(byProjectId)) {
    byProjectId[projectId].sort((left, right) => {
      const leftTime = Date.parse(left.next_remind_at || '') || Number.MAX_SAFE_INTEGER;
      const rightTime = Date.parse(right.next_remind_at || '') || Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    });
  }

  return {
    byProjectId,
    unmappedReminders,
    stats: {
      totalActiveReminders: reminders.length,
      mappedProjectRemindersCount,
      projectsWithActiveRemindersCount: Object.keys(byProjectId).length,
      unmappedRemindersCount: unmappedReminders.length,
      collectionReminderMappedCount,
    },
  };
}

export function enrichPipelineRowsWithReminders(rows = [], reminderMapResult = {}) {
  const byProjectId = reminderMapResult.byProjectId || {};

  return rows.map((row) => {
    const reminders = byProjectId[row.project_id] || [];

    return {
      ...row,
      reminders,
      active_reminder_count: reminders.length,
    };
  });
}

export function buildProjectPipelineRow(project, {
  stages = [],
  collectionDues = [],
} = {}) {
  const workStageInfo = analyzeWorkStages(stages);
  const collectionSummary = getProjectCollectionSummary(project, collectionDues);
  const constructionSummary = getProjectConstructionStatusSummary(project);
  const groupKey = resolvePipelineGroupKey(project, workStageInfo);
  const status = String(project?.status || '').trim();
  const statusBadges = buildRowBadges(
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
    status,
    commercial_status_label: getProjectCommercialStatusLabel(project),
    status_label: getProjectCommercialStatusLabel(project),
    status_display_label: workStageInfo.operational_work_status_label,
    operational_work_status_key: workStageInfo.operational_work_status_key,
    operational_work_status_label: workStageInfo.operational_work_status_label,
    operational_current_stage_title: workStageInfo.operational_current_stage_title,

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
    status_badges: statusBadges,
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
      expanded_by_default: isPipelineGroupExpandedByDefault(groupKey),
      collapsed_by_default: !isPipelineGroupExpandedByDefault(groupKey),
      empty_message: PIPELINE_GROUP_EMPTY_MESSAGES[groupKey] || PIPELINE_GROUP_EMPTY_MESSAGES.other,
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
    inWorkWithActiveStageCount: rows.filter(
      (row) => row.group_key === 'in_work_with_active_stage',
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
    activeRemindersCount: rows.reduce(
      (sum, row) => sum + toNumber(row.active_reminder_count),
      0,
    ),
    projectsWithActiveRemindersCount: rows.filter(
      (row) => toNumber(row.active_reminder_count) > 0,
    ).length,
  };
}
