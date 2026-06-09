import { startOfMonth, startOfQuarter, startOfYear } from 'date-fns';
import { MONETARY_OPEN_COLLECTION_STATUSES } from '@/lib/collectionDueUtils';
import { calculateProjectFinancialSummary } from '@/lib/projectFinancialUtils';
import {
  COLLECTION_DUE_TEST_SCAN_FIELDS,
  filterRealBusinessCollectionEvents,
  isClearlyTestRecord,
} from '@/lib/testDataUtils';

const RECORDED_COLLECTION_TYPES = ['collection_paid', 'collection_paid_legacy'];

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export const parseDateOnly = (value) => {
  if (!value) return null;

  const datePart = String(value).split('T')[0];
  const parts = datePart.split('-');
  if (parts.length === 3) {
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfDay = (date) => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

export const getPeriodStart = (period, now = new Date()) => (
  period === 'month' ? startOfMonth(now)
    : period === 'quarter' ? startOfQuarter(now)
    : period === 'year' ? startOfYear(now)
    : new Date(0)
);

const hasValidPaidAt = (paidAt) => {
  if (!paidAt) return false;
  const paidDate = new Date(paidAt);
  return !Number.isNaN(paidDate.getTime());
};

export function filterRealBusinessCollectionDues(collectionDues = [], projectsById = new Map()) {
  return (collectionDues || []).filter((record) => !isClearlyTestRecord(record, {
    fields: COLLECTION_DUE_TEST_SCAN_FIELDS,
    linkedProject: projectsById.get(record.project_id),
  }));
}

export function groupCollectionDuesByProjectId(collectionDues = []) {
  const byProjectId = new Map();

  for (const record of collectionDues) {
    const projectId = String(record?.project_id || '');
    if (!projectId) continue;

    if (!byProjectId.has(projectId)) {
      byProjectId.set(projectId, []);
    }
    byProjectId.get(projectId).push(record);
  }

  return byProjectId;
}

export function isMonetaryOpenCollectionDue(record) {
  if (!record || record.status === 'cancelled') return false;
  if (!MONETARY_OPEN_COLLECTION_STATUSES.has(record.status)) return false;
  return toNumber(record.remaining_amount) > 0;
}

export function isAwaitingTaxInvoiceCollectionDue(record) {
  if (!record || record.status === 'cancelled') return false;
  if (record.status === 'awaiting_tax_invoice') return true;

  return record.payment_received === true
    && record.tax_invoice_sent_to_client !== true
    && record.status !== 'paid';
}

export function isOverdueCollectionDue(record, now = new Date()) {
  if (!isMonetaryOpenCollectionDue(record)) return false;

  const dueDate = parseDateOnly(record.due_date);
  if (!dueDate) return false;

  return dueDate < startOfDay(now);
}

export function isLegacyOverdueCollection(project, now = new Date()) {
  if (project?.collection_due_now !== true || toNumber(project.collection_due_amount) <= 0) {
    return false;
  }

  const targetDate = parseDateOnly(project.collection_due_target_date);
  if (!targetDate) return false;

  return targetDate < startOfDay(now);
}

export function getDaysOverdue(targetDateValue, now = new Date()) {
  const targetDate = parseDateOnly(targetDateValue);
  if (!targetDate) return null;

  const today = startOfDay(now);
  if (targetDate >= today) return null;

  return Math.floor((today.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
}

function isEventInCollectionPeriod(event, period, now) {
  if (!RECORDED_COLLECTION_TYPES.includes(event.type)) return false;
  if (!hasValidPaidAt(event.paid_at)) return false;
  if (period === 'all') return true;

  const paidDate = new Date(event.paid_at);
  return paidDate >= getPeriodStart(period, now);
}

function getCollectionDuePaidTimestamp(record) {
  return record?.paid_at || record?.payment_received_at || record?.migrated_at || record?.created_date || null;
}

function isCollectionDuePaidInPeriod(record, period, now) {
  const paidTimestamp = getCollectionDuePaidTimestamp(record);
  if (!paidTimestamp) return period === 'all';

  const paidDate = new Date(paidTimestamp);
  if (Number.isNaN(paidDate.getTime())) return false;
  if (period === 'all') return true;

  return paidDate >= getPeriodStart(period, now);
}

function projectHasCollectionDue(collectionDuesByProjectId, projectId) {
  return (collectionDuesByProjectId.get(String(projectId)) || []).length > 0;
}

function buildLegacyOpenCollectionItems(projects, collectionDuesByProjectId) {
  return projects
    .filter((project) => !projectHasCollectionDue(collectionDuesByProjectId, project.id))
    .filter((project) => project.collection_due_now === true && toNumber(project.collection_due_amount) > 0)
    .map((project) => ({
      title: project.name || 'פרויקט ללא שם',
      subtitle: `₪${toNumber(project.collection_due_amount).toLocaleString()}${
        project.collection_due_note ? ` - ${project.collection_due_note}` : ''
      }${
        project.collection_due_target_date
          ? ` - יעד: ${new Intl.DateTimeFormat('he-IL').format(parseDateOnly(project.collection_due_target_date))}`
          : ' - ללא תאריך יעד'
      }`,
      data: project,
      isLegacyFallback: true,
    }));
}

function buildLegacyOverdueCollectionItems(projects, collectionDuesByProjectId, now) {
  return projects
    .filter((project) => !projectHasCollectionDue(collectionDuesByProjectId, project.id))
    .filter((project) => isLegacyOverdueCollection(project, now))
    .map((project) => {
      const daysOverdue = getDaysOverdue(project.collection_due_target_date, now);
      return {
        title: project.name || 'פרויקט ללא שם',
        subtitle: `₪${toNumber(project.collection_due_amount).toLocaleString()} - תאריך יעד עבר לפני ${daysOverdue} ימים`,
        data: project,
        isLegacyFallback: true,
      };
    });
}

function buildCollectionDueActionItem(record, { overdue = false, now = new Date() } = {}) {
  const amount = toNumber(record.remaining_amount);
  const notePart = record.notes ? ` - ${record.notes}` : '';
  const dueDateLabel = record.due_date
    ? new Intl.DateTimeFormat('he-IL').format(parseDateOnly(record.due_date))
    : null;

  let subtitle = `₪${amount.toLocaleString()}${notePart}`;
  if (overdue) {
    const daysOverdue = getDaysOverdue(record.due_date, now);
    subtitle += ` - תאריך יעד עבר לפני ${daysOverdue} ימים`;
  } else {
    subtitle += dueDateLabel ? ` - יעד: ${dueDateLabel}` : ' - ללא תאריך יעד';
  }

  return {
    title: record.project_name || 'פרויקט ללא שם',
    subtitle,
    data: { id: record.project_id },
    collectionDueId: record.id,
    isLegacyFallback: false,
    status: record.status,
    clientName: record.client_name || '',
    remainingAmount: amount,
    dueDate: record.due_date || '',
    notes: record.notes || '',
  };
}

export function buildDashboardCollectionMetrics({
  projects = [],
  collectionDues = [],
  collectionEvents = [],
  now = new Date(),
  collectionPeriod = 'year',
} = {}) {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const realCollectionDues = filterRealBusinessCollectionDues(collectionDues, projectsById);
  const realCollectionEvents = filterRealBusinessCollectionEvents(collectionEvents);
  const collectionDuesByProjectId = groupCollectionDuesByProjectId(realCollectionDues);

  const openCollectionDues = realCollectionDues.filter(isMonetaryOpenCollectionDue);
  const overdueCollectionDues = openCollectionDues.filter((record) => isOverdueCollectionDue(record, now));
  const awaitingTaxInvoiceCollectionDues = realCollectionDues.filter(isAwaitingTaxInvoiceCollectionDue);
  const paidCollectionDues = realCollectionDues.filter((record) => record.status === 'paid');
  const partiallyPaidCollectionDues = realCollectionDues.filter((record) => record.status === 'partially_paid');

  const openCollectionAmount = openCollectionDues.reduce(
    (sum, record) => sum + toNumber(record.remaining_amount),
    0,
  );
  const overdueCollectionAmount = overdueCollectionDues.reduce(
    (sum, record) => sum + toNumber(record.remaining_amount),
    0,
  );
  const paidCollectionAmount = realCollectionDues
    .filter((record) => record.status !== 'cancelled')
    .reduce((sum, record) => sum + toNumber(record.amount_paid), 0);

  const hasPaidCollectionDueRecords = realCollectionDues.some(
    (record) => record.status !== 'cancelled' && toNumber(record.amount_paid) > 0,
  );

  const recordedCollection = hasPaidCollectionDueRecords
    ? realCollectionDues
      .filter((record) => record.status !== 'cancelled' && toNumber(record.amount_paid) > 0)
      .filter((record) => isCollectionDuePaidInPeriod(record, collectionPeriod, now))
      .reduce((sum, record) => sum + toNumber(record.amount_paid), 0)
    : realCollectionEvents
      .filter((event) => isEventInCollectionPeriod(event, collectionPeriod, now))
      .reduce((sum, event) => sum + toNumber(event.amount), 0);

  const recordedCollectionSource = hasPaidCollectionDueRecords ? 'collection_due' : 'collection_event';

  const projectFinancialSummaries = projects.map((project) => {
    const projectCollections = collectionDuesByProjectId.get(String(project.id)) || [];
    const summary = calculateProjectFinancialSummary(project, projectCollections);

    return {
      project_id: project.id,
      project_name: project.name,
      ...summary,
      usesLegacyFallback: !summary.usesCollectionDue,
    };
  });

  const legacyFallbackUsedProjects = projectFinancialSummaries
    .filter((summary) => summary.usesLegacyFallback)
    .map((summary) => ({
      project_id: summary.project_id,
      project_name: summary.project_name,
      collected_amount: toNumber(projectsById.get(summary.project_id)?.collected_amount),
    }));

  const openCollectionProjects = projectFinancialSummaries.filter(
    (summary) => summary.outstandingAmount > 0,
  );
  const totalOutstandingAmount = openCollectionProjects.reduce(
    (sum, summary) => sum + summary.outstandingAmount,
    0,
  );

  const legacyOpenItems = buildLegacyOpenCollectionItems(projects, collectionDuesByProjectId);
  const legacyOverdueItems = buildLegacyOverdueCollectionItems(projects, collectionDuesByProjectId, now);

  const openCollectionActionItems = [
    ...openCollectionDues.map((record) => buildCollectionDueActionItem(record, { now })),
    ...legacyOpenItems,
  ];
  const overdueCollectionActionItems = [
    ...overdueCollectionDues.map((record) => buildCollectionDueActionItem(record, { overdue: true, now })),
    ...legacyOverdueItems,
  ];

  const collectionEventRawPaidTotal = realCollectionEvents
    .filter((event) => RECORDED_COLLECTION_TYPES.includes(event.type) && hasValidPaidAt(event.paid_at))
    .reduce((sum, event) => sum + toNumber(event.amount), 0);

  // Activity feed still uses CollectionEvent; financial KPIs use CollectionDue to avoid double counting.
  const businessCollectionActivityItems = realCollectionEvents
    .filter((event) => event.type === 'collection_paid' && hasValidPaidAt(event.paid_at))
    .sort((left, right) => new Date(right.paid_at).getTime() - new Date(left.paid_at).getTime())
    .slice(0, 10)
    .map((event) => ({
      type: 'collection_paid',
      title: 'גבייה בוצעה',
      description: `${event.project_name || 'פרויקט ללא שם'} · ₪${toNumber(event.amount).toLocaleString()}`,
      date: event.paid_at,
      projectId: event.project_id,
    }));

  return {
    openCollectionDues,
    overdueCollectionDues,
    awaitingTaxInvoiceCollectionDues,
    paidCollectionDues,
    partiallyPaidCollectionDues,

    openCollectionCount: openCollectionDues.length + legacyOpenItems.length,
    openCollectionAmount: openCollectionAmount + legacyOpenItems.reduce(
      (sum, item) => sum + toNumber(item.data?.collection_due_amount),
      0,
    ),
    overdueCollectionCount: overdueCollectionDues.length + legacyOverdueItems.length,
    overdueCollectionAmount: overdueCollectionAmount + legacyOverdueItems.reduce(
      (sum, item) => sum + toNumber(item.data?.collection_due_amount),
      0,
    ),
    awaitingTaxInvoiceCount: awaitingTaxInvoiceCollectionDues.length,
    paidCollectionAmount,
    recordedCollection,
    recordedCollectionSource,
    collectionEventRawPaidTotal,

    projectFinancialSummaries,
    totalOutstandingAmount,
    openCollectionProjectsCount: openCollectionProjects.length,

    openCollectionActionItems,
    overdueCollectionActionItems,

    businessCollectionActivityItems,
    legacyFallbackUsedProjects,
    usesCollectionDuePrimary: hasPaidCollectionDueRecords || realCollectionDues.length > 0,
  };
}
