import { base44 } from '@/api/base44Client';
import {
  COLLECTION_NEEDS_TAX_INVOICE_PREFIX,
  COLLECTION_PAYMENT_DUE_PREFIX,
  getCollectionNeedsTaxInvoiceConditionKey,
  getCollectionPaymentDueConditionKey,
} from '@/lib/collectionReminderRules';
import { calculateProjectFinancialSummary } from '@/lib/projectFinancialUtils';
import {
  filterRealBusinessCollectionEvents,
  isTestCollectionEvent,
} from '@/lib/testDataUtils';

const MERLOG_PROJECT_ID = '69eb6b5f9ae59e23cdf769ad';
const MERLOG_REAL_EVENT_ID = '6a063b51354cb9a5b178aa1e';
const MERLOG_LEGACY_EVENT_ID = '6a06d69264bf214f0935064f';

const EXPECTED_TOTAL = 25;
const EXPECTED_PAID = 16;
const EXPECTED_OPEN = 9;

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

function addIssue(issues, check, message, details = null) {
  issues.push({
    check,
    severity: 'error',
    message,
    details,
  });
}

function countByStatus(collectionDues = []) {
  const counts = {
    total: collectionDues.length,
    paid: 0,
    open: 0,
    partially_paid: 0,
    awaiting_tax_invoice: 0,
    cancelled: 0,
    other: 0,
  };

  for (const record of collectionDues) {
    const status = String(record?.status || '').trim();
    if (status in counts && status !== 'total') {
      counts[status] += 1;
    } else {
      counts.other += 1;
    }
  }

  return counts;
}

function findDuplicateSources(collectionDues = []) {
  const bySource = new Map();

  for (const record of collectionDues) {
    const sourceType = String(record?.source_entity_type || '').trim();
    const sourceId = String(record?.source_entity_id || '').trim();
    if (!sourceType || !sourceId) continue;

    const key = `${sourceType}:${sourceId}`;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push({
      id: record.id,
      project_id: record.project_id,
      project_name: record.project_name,
      status: record.status,
      amount_due: record.amount_due,
    });
  }

  return [...bySource.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([sourceKey, items]) => ({ sourceKey, items }));
}

function validatePaidCollectionDue(record, issues) {
  const label = `paid:${record.id}`;

  if (record.status !== 'paid') {
    addIssue(issues, 'paid_migration', `${label} status is not paid`, { status: record.status });
  }
  if (!amountsEqual(record.amount_due, record.amount_paid)) {
    addIssue(issues, 'paid_migration', `${label} amount_due != amount_paid`, record);
  }
  if (toNumber(record.remaining_amount) !== 0) {
    addIssue(issues, 'paid_migration', `${label} remaining_amount is not 0`, record);
  }
  if (record.payment_received !== true) {
    addIssue(issues, 'paid_migration', `${label} payment_received is not true`, record);
  }
  if (record.tax_invoice_sent_to_client !== true) {
    addIssue(issues, 'paid_migration', `${label} tax_invoice_sent_to_client is not true`, record);
  }
}

function validateOpenCollectionDue(record, project, issues) {
  const label = `open:${record.id}`;

  if (record.status !== 'open') {
    addIssue(issues, 'open_migration', `${label} status is not open`, { status: record.status });
  }
  if (toNumber(record.amount_paid) !== 0) {
    addIssue(issues, 'open_migration', `${label} amount_paid is not 0`, record);
  }
  if (!amountsEqual(record.amount_due, record.remaining_amount)) {
    addIssue(issues, 'open_migration', `${label} remaining_amount != amount_due`, record);
  }
  if (record.payment_received === true) {
    addIssue(issues, 'open_migration', `${label} payment_received should be false`, record);
  }
  if (record.tax_invoice_sent_to_client === true) {
    addIssue(issues, 'open_migration', `${label} tax_invoice_sent_to_client should be false`, record);
  }

  const projectTargetDate = String(project?.collection_due_target_date || '').slice(0, 10);
  const recordDueDate = String(record?.due_date || '').slice(0, 10);
  if (projectTargetDate && recordDueDate && projectTargetDate !== recordDueDate) {
    addIssue(issues, 'open_migration', `${label} due_date does not match project.collection_due_target_date`, {
      projectTargetDate,
      recordDueDate,
      project_id: record.project_id,
    });
  }
}

function amountsEqual(left, right, epsilon = 0.01) {
  return Math.abs(toNumber(left) - toNumber(right)) <= epsilon;
}

function validateMerlog(collectionDues, issues) {
  const merlogRecords = collectionDues.filter(
    (record) => String(record.project_id) === MERLOG_PROJECT_ID,
  );
  const realRecord = merlogRecords.find(
    (record) => String(record.source_entity_id) === MERLOG_REAL_EVENT_ID,
  );
  const legacyRecord = merlogRecords.find(
    (record) => String(record.source_entity_id) === MERLOG_LEGACY_EVENT_ID,
  );

  const details = {
    totalForProject: merlogRecords.length,
    realRecordId: realRecord?.id || null,
    legacyRecordId: legacyRecord?.id || null,
    records: merlogRecords.map((record) => ({
      id: record.id,
      source_entity_id: record.source_entity_id,
      amount_due: record.amount_due,
      amount_paid: record.amount_paid,
      status: record.status,
    })),
  };

  let passed = true;

  if (merlogRecords.length !== 1) {
    passed = false;
    addIssue(issues, 'merlog', `Merlog should have exactly 1 CollectionDue, found ${merlogRecords.length}`, details);
  }
  if (legacyRecord) {
    passed = false;
    addIssue(issues, 'merlog', 'Merlog legacy duplicate CollectionDue must not exist', legacyRecord);
  }
  if (!realRecord) {
    passed = false;
    addIssue(issues, 'merlog', 'Merlog real CollectionDue missing', details);
  } else {
    if (!amountsEqual(realRecord.amount_due, 6000) || !amountsEqual(realRecord.amount_paid, 6000)) {
      passed = false;
      addIssue(issues, 'merlog', 'Merlog amount must be 6000', realRecord);
    }
    if (realRecord.status !== 'paid') {
      passed = false;
      addIssue(issues, 'merlog', 'Merlog status must be paid', realRecord);
    }
    if (String(realRecord.source_entity_id) !== MERLOG_REAL_EVENT_ID) {
      passed = false;
      addIssue(issues, 'merlog', 'Merlog source_entity_id mismatch', realRecord);
    }
  }

  return { passed, details };
}

function validateCollectionEvents(collectionEvents, collectionDues, issues) {
  const testEvents = (collectionEvents || []).filter((event) => isTestCollectionEvent(event));
  const migrationNotes = [
    'migrated from collectionevent',
    'historical paid collection migrated',
    'open legacy collection migrated',
    'manual migration resolution',
    'backfill',
  ];

  const migratedAtTimes = (collectionDues || [])
    .map((record) => Date.parse(record.migrated_at || ''))
    .filter((value) => Number.isFinite(value));

  const earliestMigration = migratedAtTimes.length
    ? Math.min(...migratedAtTimes)
    : null;

  const suspiciousNewEvents = [];

  for (const event of collectionEvents || []) {
    const note = String(event.note || '').toLowerCase();
    const hasMigrationNote = migrationNotes.some((fragment) => note.includes(fragment));
    const createdAt = Date.parse(event.created_date || event.paid_at || '');
    const createdDuringMigration = earliestMigration !== null
      && Number.isFinite(createdAt)
      && createdAt >= earliestMigration - 60_000;

    if (hasMigrationNote || (createdDuringMigration && note.includes('migration'))) {
      suspiciousNewEvents.push({
        id: event.id,
        project_id: event.project_id,
        project_name: event.project_name,
        amount: event.amount,
        paid_at: event.paid_at,
        note: event.note,
        reason: hasMigrationNote ? 'migration note in CollectionEvent' : 'created around migration window',
      });
    }
  }

  if (suspiciousNewEvents.length > 0) {
    addIssue(
      issues,
      'collection_events',
      'Suspicious CollectionEvent records that may have been created by migration',
      suspiciousNewEvents,
    );
  }

  const realEvents = filterRealBusinessCollectionEvents(collectionEvents);
  const duplicateBusinessActivityRisk = realEvents.length > 0 && collectionDues.some(
    (record) => record.status === 'paid'
      && record.source_entity_type === 'collection_event'
      && realEvents.some((event) => String(event.id) === String(record.source_entity_id)),
  );

  return {
    totalEvents: (collectionEvents || []).length,
    realEventsCount: realEvents.length,
    testEvents,
    suspiciousNewEvents,
    businessActivityUsesSamePaidEvents: duplicateBusinessActivityRisk,
    note: duplicateBusinessActivityRisk
      ? 'Business Activity still reads CollectionEvent; paid CollectionDue mirror source events (expected, not new events).'
      : 'No mirrored paid CollectionEvent pattern detected.',
  };
}

function validateReminders(reminders, collectionDues) {
  const collectionDueIds = new Set((collectionDues || []).map((record) => String(record.id)));
  const unexpectedReminders = [];
  let collectionPaymentDueCount = 0;
  let collectionNeedsTaxInvoiceCount = 0;

  for (const reminder of reminders || []) {
    const conditionKey = String(reminder?.condition_key || '');

    if (conditionKey.startsWith(COLLECTION_PAYMENT_DUE_PREFIX)) {
      collectionPaymentDueCount += 1;
      const collectionId = conditionKey.slice(COLLECTION_PAYMENT_DUE_PREFIX.length);
      if (collectionDueIds.has(collectionId)) {
        unexpectedReminders.push({
          id: reminder.id,
          condition_key: conditionKey,
          status: reminder.status,
          title: reminder.title,
          reason: 'COL1 reminder exists for backfilled CollectionDue',
        });
      }
    }

    if (conditionKey.startsWith(COLLECTION_NEEDS_TAX_INVOICE_PREFIX)) {
      collectionNeedsTaxInvoiceCount += 1;
      const collectionId = conditionKey.slice(COLLECTION_NEEDS_TAX_INVOICE_PREFIX.length);
      if (collectionDueIds.has(collectionId)) {
        unexpectedReminders.push({
          id: reminder.id,
          condition_key: conditionKey,
          status: reminder.status,
          title: reminder.title,
          reason: 'COL2 reminder exists for backfilled CollectionDue',
        });
      }
    }
  }

  return {
    collectionPaymentDueCount,
    collectionNeedsTaxInvoiceCount,
    unexpectedReminders,
    openCollectionDueIds: [...collectionDues]
      .filter((record) => record.status === 'open')
      .map((record) => record.id),
    expectedCol1KeysForOpen: [...collectionDues]
      .filter((record) => record.status === 'open')
      .map((record) => getCollectionPaymentDueConditionKey(record.id)),
  };
}

function buildProjectFinancialSample(project, collectionDues) {
  const projectCollections = collectionDues.filter(
    (record) => String(record.project_id) === String(project.id),
  );
  const summary = calculateProjectFinancialSummary(project, projectCollections);
  const openDue = projectCollections
    .filter((record) => record.status === 'open' || record.status === 'partially_paid')
    .reduce((sum, record) => sum + toNumber(record.remaining_amount), 0);

  return {
    project_id: project.id,
    project_name: project.name,
    total_amount: toNumber(project.total_amount),
    project_collected_amount_legacy: toNumber(project.collected_amount),
    collected_from_collection_due: summary.collectedAmount,
    outstanding: summary.outstandingAmount,
    open_due_from_collection_due: openDue,
    uses_collection_due: summary.usesCollectionDue,
    collection_due_count: projectCollections.length,
    collection_due_statuses: projectCollections.map((record) => record.status),
    project_details_expected: {
      collected: summary.collectedAmount,
      outstanding: summary.outstandingAmount,
      usesCollectionDue: summary.usesCollectionDue,
    },
  };
}

function pickProjectFinancialSamples(projects, collectionDues) {
  const samples = [];
  const merlog = projects.find((project) => project.id === MERLOG_PROJECT_ID);
  if (merlog) samples.push(buildProjectFinancialSample(merlog, collectionDues));

  const sanCenter = projects.find((project) => (
    String(project.name || '').includes('סאן סנטר')
    || String(project.name || '').includes('בית שמש')
  ));
  if (sanCenter && sanCenter.id !== MERLOG_PROJECT_ID) {
    samples.push(buildProjectFinancialSample(sanCenter, collectionDues));
  }

  const openRecord = collectionDues.find((record) => record.status === 'open');
  if (openRecord) {
    const openProject = projects.find((project) => project.id === openRecord.project_id);
    if (openProject && !samples.some((item) => item.project_id === openProject.id)) {
      samples.push(buildProjectFinancialSample(openProject, collectionDues));
    }
  }

  return samples;
}

function buildDashboardSourceReport() {
  return {
    changedInThisStep: false,
    readsCollectionDueDirectly: false,
    readsProjectLegacyFields: [
      'collection_due_now',
      'collection_due_amount',
      'collection_due_note',
      'collection_due_target_date',
      'collected_amount',
      'total_amount',
    ],
    readsCollectionEvent: [
      'recordedCollection (גבייה רשומה)',
      'recentActivity / תנועה עסקית',
    ],
    readsReminders: [
      'ReminderPanel via loadVisibleReminders',
    ],
    note: 'Dashboard was not modified in H1C. Next migration step is separate (H2).',
  };
}

function printValidationReport(report) {
  console.group('H1C Post-backfill validation');
  if (report.issues.length > 0) {
    console.table(report.issues);
  } else {
    console.info('No issues found');
  }
  console.log('summary', report.summary);
  console.groupEnd();
}

export async function runCollectionDuePostBackfillValidation({ entities = base44.entities } = {}) {
  const issues = [];

  const [collectionDues, collectionEvents, projects, reminders] = await Promise.all([
    entities.CollectionDue?.list ? entities.CollectionDue.list() : Promise.resolve([]),
    entities.CollectionEvent?.list ? entities.CollectionEvent.list() : Promise.resolve([]),
    entities.Project.list(),
    entities.Reminder?.list ? entities.Reminder.list() : Promise.resolve([]),
  ]);

  const projectById = new Map((projects || []).map((project) => [project.id, project]));
  const counts = countByStatus(collectionDues);

  if (counts.total !== EXPECTED_TOTAL) {
    addIssue(issues, 'counts', `Expected total=${EXPECTED_TOTAL}, got ${counts.total}`, counts);
  }
  if (counts.paid !== EXPECTED_PAID) {
    addIssue(issues, 'counts', `Expected paid=${EXPECTED_PAID}, got ${counts.paid}`, counts);
  }
  if (counts.open !== EXPECTED_OPEN) {
    addIssue(issues, 'counts', `Expected open=${EXPECTED_OPEN}, got ${counts.open}`, counts);
  }
  if (counts.partially_paid !== 0) {
    addIssue(issues, 'counts', `Expected partially_paid=0, got ${counts.partially_paid}`, counts);
  }
  if (counts.awaiting_tax_invoice !== 0) {
    addIssue(issues, 'counts', `Expected awaiting_tax_invoice=0, got ${counts.awaiting_tax_invoice}`, counts);
  }
  if (counts.cancelled !== 0) {
    addIssue(issues, 'counts', `Expected cancelled=0, got ${counts.cancelled}`, counts);
  }

  const duplicateSources = findDuplicateSources(collectionDues);
  if (duplicateSources.length > 0) {
    addIssue(issues, 'duplicate_sources', 'Duplicate CollectionDue source keys found', duplicateSources);
  }

  for (const record of collectionDues) {
    const sourceType = String(record?.source_entity_type || '').trim();
    if (sourceType === 'collection_event') {
      validatePaidCollectionDue(record, issues);
    }
    if (sourceType === 'project_legacy_open') {
      validateOpenCollectionDue(record, projectById.get(record.project_id), issues);
    }
  }

  const merlog = validateMerlog(collectionDues, issues);
  const collectionEventsReport = validateCollectionEvents(collectionEvents, collectionDues, issues);
  const remindersReport = validateReminders(reminders, collectionDues);

  if (remindersReport.unexpectedReminders.length > 0) {
    addIssue(
      issues,
      'reminders',
      'Collection reminders exist for backfilled CollectionDue records',
      remindersReport.unexpectedReminders,
    );
  }

  const projectFinancialSamples = pickProjectFinancialSamples(projects, collectionDues);
  const dashboard = buildDashboardSourceReport();

  const summary = {
    status: issues.length === 0 ? 'passed' : 'failed',
    counts,
    duplicateSourcesCount: duplicateSources.length,
    merlogPassed: merlog.passed,
    suspiciousCollectionEventsCount: collectionEventsReport.suspiciousNewEvents.length,
    testCollectionEventsCount: collectionEventsReport.testEvents.length,
    collectionPaymentDueReminders: remindersReport.collectionPaymentDueCount,
    collectionNeedsTaxInvoiceReminders: remindersReport.collectionNeedsTaxInvoiceCount,
    unexpectedRemindersCount: remindersReport.unexpectedReminders.length,
    projectFinancialSamplesCount: projectFinancialSamples.length,
    dashboardChanged: false,
    issuesCount: issues.length,
    expected: {
      total: EXPECTED_TOTAL,
      paid: EXPECTED_PAID,
      open: EXPECTED_OPEN,
    },
  };

  const report = {
    status: summary.status,
    counts,
    duplicateSources,
    merlog,
    collectionEvents: collectionEventsReport,
    reminders: remindersReport,
    projectFinancialSamples,
    dashboard,
    issues,
    summary,
    generatedAt: new Date().toISOString(),
    readOnly: true,
  };

  printValidationReport(report);
  return report;
}
