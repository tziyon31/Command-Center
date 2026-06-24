import { api as base44 } from '@/api/apiClient';
import {
  COLLECTION_DUE_TEST_SCAN_FIELDS,
  INVOICE_TEST_SCAN_FIELDS,
  isClearlyTestRecord,
  isTestCollectionEvent,
  PROJECT_TEST_SCAN_FIELDS,
} from '@/lib/testDataUtils';

const PAID_COLLECTION_EVENT_TYPES = new Set(['collection_paid', 'collection_paid_legacy']);

const HISTORICAL_PAID_MIGRATION_NOTE = (
  'Historical paid collection migrated from CollectionEvent. '
  + 'Tax invoice assumed handled because old system did not track it separately.'
);

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const amountsRoughlyEqual = (left, right, epsilon = 0.01) => (
  Math.abs(toNumber(left) - toNumber(right)) <= epsilon
);

function isPaidCollectionEvent(event) {
  return PAID_COLLECTION_EVENT_TYPES.has(String(event?.type || '').trim());
}

function buildExistingSourceIndex(collectionDues = []) {
  const bySourceKey = new Map();

  for (const record of collectionDues || []) {
    const sourceType = String(record?.source_entity_type || '').trim();
    const sourceId = String(record?.source_entity_id || '').trim();
    if (!sourceType || !sourceId) continue;
    bySourceKey.set(`${sourceType}:${sourceId}`, record);
  }

  return bySourceKey;
}

function getRelevantPaidEvents(events = []) {
  return (events || []).filter(
    (event) => isPaidCollectionEvent(event) && toNumber(event.amount) > 0,
  );
}

function sumEventAmounts(events = []) {
  return events.reduce((sum, event) => sum + Math.max(toNumber(event.amount), 0), 0);
}

function formatEventSummary(event) {
  return {
    id: event.id,
    amount: toNumber(event.amount),
    paid_at: event.paid_at || '',
    type: event.type || '',
    note: event.note || '',
    is_legacy: event.is_legacy === true || event.type === 'collection_paid_legacy',
  };
}

function detectSuspectedDuplicatePaidEvents(events = []) {
  const paidEvents = getRelevantPaidEvents(events).filter(
    (event) => !isTestCollectionEvent(event),
  );

  for (let index = 0; index < paidEvents.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < paidEvents.length; otherIndex += 1) {
      const left = paidEvents[index];
      const right = paidEvents[otherIndex];
      const leftLegacy = left.is_legacy === true || left.type === 'collection_paid_legacy';
      const rightLegacy = right.is_legacy === true || right.type === 'collection_paid_legacy';

      if (
        amountsRoughlyEqual(left.amount, right.amount)
        && leftLegacy !== rightLegacy
      ) {
        return true;
      }
    }
  }

  return false;
}

function parseDateOnly(value) {
  if (!value) return null;

  const datePart = String(value).split('T')[0];
  const parts = datePart.split('-');
  if (parts.length === 3) {
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isOverdueLegacyOpen(project, now = new Date()) {
  const targetDate = parseDateOnly(project?.collection_due_target_date);
  if (!targetDate) return false;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  targetDate.setHours(0, 0, 0, 0);

  return targetDate < today;
}

function buildExcludedTestEntry(entity, record, reason, extra = {}) {
  return {
    entity,
    id: record?.id || '',
    project_id: record?.project_id || record?.id || '',
    project_name: record?.project_name || record?.name || '',
    client_name: record?.client_name || '',
    reason,
    ...extra,
  };
}

function analyzeProjectCollectionEvents(project, events = []) {
  const projectCollectedAmount = toNumber(project?.collected_amount);
  const nonTestPaidEvents = getRelevantPaidEvents(events).filter(
    (event) => !isTestCollectionEvent(event, project),
  );
  const eventTotal = sumEventAmounts(nonTestPaidEvents);
  const eventCount = nonTestPaidEvents.length;
  const suspectedDuplicate = detectSuspectedDuplicatePaidEvents(events);
  const hasCollectedMismatch = projectCollectedAmount > 0
    && !amountsRoughlyEqual(projectCollectedAmount, eventTotal);

  const requiresReview = hasCollectedMismatch || suspectedDuplicate;

  let reason = '';
  if (hasCollectedMismatch && suspectedDuplicate) {
    reason = 'project.collected_amount does not match sum(CollectionEvent.amount) and suspected legacy/non-legacy duplicate';
  } else if (hasCollectedMismatch) {
    reason = 'project.collected_amount does not match sum(CollectionEvent.amount)';
  } else if (suspectedDuplicate) {
    reason = 'suspected duplicate paid CollectionEvents with same amount (legacy + non-legacy)';
  }

  return {
    project_id: project.id,
    project_name: project.name || '',
    projectCollectedAmount,
    eventTotal,
    difference: projectCollectedAmount - eventTotal,
    eventCount,
    suspectedDuplicate,
    requiresReview,
    reason,
    events: nonTestPaidEvents.map(formatEventSummary),
  };
}

function buildDuplicateReviewEntry(analysis) {
  return {
    project_id: analysis.project_id,
    project_name: analysis.project_name,
    projectCollectedAmount: analysis.projectCollectedAmount,
    eventTotal: analysis.eventTotal,
    difference: analysis.difference,
    eventCount: analysis.eventCount,
    suspectedDuplicate: analysis.suspectedDuplicate,
    reason: analysis.reason,
    events: analysis.events,
    confidence: 'low',
    willCreate: false,
  };
}

function buildPaidSafeCandidate(event, project) {
  const amount = toNumber(event.amount);
  const paidAt = event.paid_at || '';
  const isLegacy = event.is_legacy === true || event.type === 'collection_paid_legacy';

  return {
    kind: 'paid_from_collection_event',
    willCreate: true,
    confidence: 'high',
    source_entity_type: 'collection_event',
    source_entity_id: event.id,
    project_id: event.project_id,
    project_name: event.project_name || project?.name || '',
    client_id: project?.client_id || '',
    client_name: project?.client_name || '',
    amount_due: amount,
    amount_paid: amount,
    remaining_amount: 0,
    status: 'paid',
    payment_received: true,
    payment_received_at: paidAt,
    tax_invoice_sent_to_client: true,
    tax_invoice_sent_at: paidAt,
    paid_at: paidAt,
    source_type: isLegacy ? 'legacy_collection_event' : 'collection_event',
    notes: event.note || '',
    migration_note: HISTORICAL_PAID_MIGRATION_NOTE,
  };
}

function buildOpenLegacySafeCandidate(project) {
  const dueAmount = toNumber(project.collection_due_amount);
  const overdue = isOverdueLegacyOpen(project);

  return {
    kind: 'open_from_project_legacy',
    willCreate: true,
    confidence: 'high',
    source_entity_type: 'project_legacy_open',
    source_entity_id: project.id,
    project_id: project.id,
    project_name: project.name || '',
    client_id: project.client_id || '',
    client_name: project.client_name || '',
    amount_due: dueAmount,
    amount_paid: 0,
    remaining_amount: dueAmount,
    due_date: project.collection_due_target_date || '',
    opened_at: project.collection_due_date || '',
    status: 'open',
    payment_received: false,
    tax_invoice_sent_to_client: false,
    source_type: 'project_legacy_open',
    notes: project.collection_due_note || '',
    overdue,
    warning: overdue ? 'overdue legacy open collection' : '',
  };
}

function printBackfillPreviewReport(report) {
  console.group('CollectionDue Backfill Preview - Classified');
  console.info('summary', report.summary);
  console.table(report.safeToMigrate.paidFromCollectionEvents);
  console.table(report.safeToMigrate.openFromProjectLegacy);
  console.table(report.requiresReview.duplicateOrMismatchedCollectionEvents);
  console.table(report.requiresReview.ambiguousCollectedAmountCandidates);
  console.table(report.requiresReview.invoiceToCollectionCandidates);
  console.table(report.excludedAsTest);
  if (report.skippedExisting.length > 0) {
    console.table(report.skippedExisting);
  }
  if (report.invalidCandidates.length > 0) {
    console.warn('invalidCandidates', report.invalidCandidates);
    console.table(report.invalidCandidates);
  }
  console.groupEnd();
}

export async function runCollectionDueBackfillPreview({ entities = base44.entities } = {}) {
  const [projects, collectionEvents, collectionDues, invoiceProcesses] = await Promise.all([
    entities.Project.list(),
    entities.CollectionEvent?.list ? entities.CollectionEvent.list() : Promise.resolve([]),
    entities.CollectionDue?.list ? entities.CollectionDue.list() : Promise.resolve([]),
    entities.InvoiceProcess?.list ? entities.InvoiceProcess.list() : Promise.resolve([]),
  ]);

  const projectById = new Map((projects || []).map((project) => [project.id, project]));
  const eventsByProjectId = new Map();

  for (const event of collectionEvents || []) {
    const projectId = String(event?.project_id || '').trim();
    if (!projectId) continue;
    if (!eventsByProjectId.has(projectId)) eventsByProjectId.set(projectId, []);
    eventsByProjectId.get(projectId).push(event);
  }

  const existingSourceIndex = buildExistingSourceIndex(collectionDues);
  const projectEventAnalysisById = new Map();
  const projectsRequiringEventReview = new Set();

  for (const project of projects || []) {
    if (!project?.id) continue;
    const analysis = analyzeProjectCollectionEvents(
      project,
      eventsByProjectId.get(project.id) || [],
    );
    projectEventAnalysisById.set(project.id, analysis);
    if (analysis.requiresReview) {
      projectsRequiringEventReview.add(project.id);
    }
  }

  const safeToMigrate = {
    paidFromCollectionEvents: [],
    openFromProjectLegacy: [],
  };
  const requiresReview = {
    duplicateOrMismatchedCollectionEvents: [],
    ambiguousCollectedAmountCandidates: [],
    invoiceToCollectionCandidates: [],
  };
  const excludedAsTest = [];
  const skippedExisting = [];
  const invalidCandidates = [];

  for (const project of projects || []) {
    if (isClearlyTestRecord(project, { fields: PROJECT_TEST_SCAN_FIELDS, nameField: 'name' })) {
      excludedAsTest.push(buildExcludedTestEntry(
        'Project',
        project,
        'clearly test project (TEST_REMINDER_FLOW or בדיקה)',
      ));
    }
  }

  const duplicateReviewByProjectId = new Map();
  for (const projectId of projectsRequiringEventReview) {
    const analysis = projectEventAnalysisById.get(projectId);
    if (!analysis) continue;
    const entry = buildDuplicateReviewEntry(analysis);
    duplicateReviewByProjectId.set(projectId, entry);
    requiresReview.duplicateOrMismatchedCollectionEvents.push(entry);
  }

  for (const event of collectionEvents || []) {
    const projectId = String(event?.project_id || '').trim();
    const project = projectId ? projectById.get(projectId) : null;

    if (isTestCollectionEvent(event, project)) {
      excludedAsTest.push(buildExcludedTestEntry(
        'CollectionEvent',
        event,
        'clearly test CollectionEvent (TEST_REMINDER_FLOW, בדיקה, or linked test project)',
      ));
      continue;
    }

    if (!isPaidCollectionEvent(event)) continue;

    const amount = toNumber(event.amount);

    if (!projectId) {
      invalidCandidates.push({
        kind: 'collection_event_missing_project_id',
        source_entity_type: 'collection_event',
        source_entity_id: event.id,
        reason: 'CollectionEvent missing project_id',
      });
      continue;
    }

    if (amount <= 0) {
      invalidCandidates.push({
        kind: 'collection_event_missing_amount',
        source_entity_type: 'collection_event',
        source_entity_id: event.id,
        project_id: projectId,
        reason: 'CollectionEvent amount is empty or zero',
      });
      continue;
    }

    const sourceKey = `collection_event:${event.id}`;
    if (existingSourceIndex.has(sourceKey)) {
      skippedExisting.push({
        source_entity_type: 'collection_event',
        source_entity_id: event.id,
        project_id: projectId,
        existing_collection_due_id: existingSourceIndex.get(sourceKey)?.id || '',
        reason: 'CollectionDue already exists for this CollectionEvent',
      });
      continue;
    }

    if (projectsRequiringEventReview.has(projectId)) {
      continue;
    }

    safeToMigrate.paidFromCollectionEvents.push(buildPaidSafeCandidate(event, project));
  }

  for (const project of projects || []) {
    if (isClearlyTestRecord(project, { fields: PROJECT_TEST_SCAN_FIELDS, nameField: 'name' })) {
      continue;
    }

    const projectId = String(project?.id || '').trim();
    if (!projectId) {
      invalidCandidates.push({
        kind: 'project_missing_id',
        source_entity_type: 'project_legacy_open',
        reason: 'Project record missing id',
      });
      continue;
    }

    const dueAmount = toNumber(project.collection_due_amount);
    const hasOpenFlag = project.collection_due_now === true || dueAmount > 0;

    if (hasOpenFlag && dueAmount <= 0) {
      invalidCandidates.push({
        kind: 'project_open_without_amount',
        source_entity_type: 'project_legacy_open',
        source_entity_id: projectId,
        project_id: projectId,
        project_name: project.name || '',
        collection_due_now: project.collection_due_now,
        collection_due_amount: project.collection_due_amount,
        reason: 'Project collection_due_now=true but collection_due_amount is empty or zero',
      });
    }

    if (hasOpenFlag && dueAmount > 0) {
      const sourceKey = `project_legacy_open:${projectId}`;
      if (existingSourceIndex.has(sourceKey)) {
        skippedExisting.push({
          source_entity_type: 'project_legacy_open',
          source_entity_id: projectId,
          project_id: projectId,
          existing_collection_due_id: existingSourceIndex.get(sourceKey)?.id || '',
          reason: 'CollectionDue already exists for this Project legacy open collection',
        });
      } else {
        safeToMigrate.openFromProjectLegacy.push(buildOpenLegacySafeCandidate(project));
      }
    }

    const collectedAmount = toNumber(project.collected_amount);
    if (collectedAmount > 0 && !duplicateReviewByProjectId.has(projectId)) {
      const projectEvents = eventsByProjectId.get(projectId) || [];
      const nonTestPaidEvents = getRelevantPaidEvents(projectEvents).filter(
        (event) => !isTestCollectionEvent(event, project),
      );
      const sumCollectionEvents = sumEventAmounts(nonTestPaidEvents);
      const hasPaidEvents = nonTestPaidEvents.length > 0;

      if (!hasPaidEvents || !amountsRoughlyEqual(collectedAmount, sumCollectionEvents)) {
        let reason = 'sum(CollectionEvent.amount) does not match project.collected_amount';
        if (!hasPaidEvents) {
          reason = 'collected_amount > 0 but no matching non-test CollectionEvent payments';
        }

        requiresReview.ambiguousCollectedAmountCandidates.push({
          project_id: projectId,
          project_name: project.name || '',
          total_amount: toNumber(project.total_amount),
          collected_amount: collectedAmount,
          sumCollectionEvents,
          difference: collectedAmount - sumCollectionEvents,
          last_collection_paid_on: project.last_collection_paid_on || '',
          reason,
          confidence: 'low',
          willCreate: false,
        });
      }
    }
  }

  for (const invoice of invoiceProcesses || []) {
    const linkedProject = invoice.project_id ? projectById.get(invoice.project_id) : null;

    if (isClearlyTestRecord(invoice, {
      fields: INVOICE_TEST_SCAN_FIELDS,
      linkedProject,
    })) {
      excludedAsTest.push(buildExcludedTestEntry(
        'InvoiceProcess',
        invoice,
        'clearly test invoice (TEST_REMINDER_FLOW, בדיקה, or linked test project)',
        { invoice_reference: invoice.invoice_reference || '' },
      ));
      continue;
    }

    const amount = toNumber(invoice.amount);
    const isCancelled = String(invoice.form_status || '').toLowerCase() === 'cancelled';
    const hasCollectionDueId = Boolean(String(invoice.collection_due_id || '').trim());

    if (
      invoice.invoice_sent_to_client === true
      && amount > 0
      && !hasCollectionDueId
      && !isCancelled
    ) {
      requiresReview.invoiceToCollectionCandidates.push({
        invoice_process_id: invoice.id,
        project_id: invoice.project_id || '',
        project_name: invoice.project_name || '',
        client_id: invoice.client_id || '',
        client_name: invoice.client_name || '',
        amount,
        invoice_reference: invoice.invoice_reference || '',
        invoice_sent_at: invoice.invoice_sent_at || '',
        reason: 'Invoice sent with amount but no collection_due_id — manual review required',
        confidence: 'low',
        willCreate: false,
      });
    }
  }

  for (const record of collectionDues || []) {
    const linkedProject = record.project_id ? projectById.get(record.project_id) : null;

    if (isClearlyTestRecord(record, {
      fields: COLLECTION_DUE_TEST_SCAN_FIELDS,
      linkedProject,
    })) {
      excludedAsTest.push(buildExcludedTestEntry(
        'CollectionDue',
        record,
        'clearly test CollectionDue',
      ));
    }

    const projectId = String(record?.project_id || '').trim();
    if (projectId && !projectById.has(projectId)) {
      invalidCandidates.push({
        kind: 'collection_due_orphan_project',
        collection_due_id: record.id,
        project_id: projectId,
        reason: 'CollectionDue references missing Project',
      });
    }
  }

  const safePaidFromCollectionEventsTotal = safeToMigrate.paidFromCollectionEvents.reduce(
    (sum, item) => sum + toNumber(item.amount_due),
    0,
  );
  const safeOpenFromProjectLegacyTotal = safeToMigrate.openFromProjectLegacy.reduce(
    (sum, item) => sum + toNumber(item.amount_due),
    0,
  );

  const requiresReviewCount = (
    requiresReview.duplicateOrMismatchedCollectionEvents.length
    + requiresReview.ambiguousCollectedAmountCandidates.length
    + requiresReview.invoiceToCollectionCandidates.length
  );

  const summary = {
    safePaidFromCollectionEventsCount: safeToMigrate.paidFromCollectionEvents.length,
    safePaidFromCollectionEventsTotal,
    safeOpenFromProjectLegacyCount: safeToMigrate.openFromProjectLegacy.length,
    safeOpenFromProjectLegacyTotal,
    requiresReviewCount,
    duplicateOrMismatchedCollectionEventsCount: requiresReview.duplicateOrMismatchedCollectionEvents.length,
    ambiguousCollectedAmountCandidatesCount: requiresReview.ambiguousCollectedAmountCandidates.length,
    invoiceToCollectionCandidatesReviewCount: requiresReview.invoiceToCollectionCandidates.length,
    excludedAsTestCount: excludedAsTest.length,
    skippedExistingCount: skippedExisting.length,
    invalidCandidatesCount: invalidCandidates.length,
    existingCollectionDueCount: (collectionDues || []).length,
    totalProjects: (projects || []).length,
    totalCollectionEvents: (collectionEvents || []).length,
    totalInvoiceProcesses: (invoiceProcesses || []).length,
    legacy: {
      paidFromCollectionEventsCount: safeToMigrate.paidFromCollectionEvents.length,
      paidFromCollectionEventsTotal: safePaidFromCollectionEventsTotal,
      openFromProjectLegacyCount: safeToMigrate.openFromProjectLegacy.length,
      openFromProjectLegacyTotal: safeOpenFromProjectLegacyTotal,
      testRecordsExcludedCount: excludedAsTest.length,
    },
  };

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    summary,
    safeToMigrate,
    requiresReview,
    excludedAsTest,
    skippedExisting,
    invalidCandidates,
  };

  printBackfillPreviewReport(report);
  return report;
}
