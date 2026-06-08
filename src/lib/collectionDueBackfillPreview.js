import { base44 } from '@/api/base44Client';
import {
  isTestCollectionEvent,
  recordContainsTestReminderFlow,
} from '@/lib/testDataUtils';

const PAID_COLLECTION_EVENT_TYPES = new Set(['collection_paid', 'collection_paid_legacy']);

const HISTORICAL_PAID_MIGRATION_NOTE = (
  'Historical paid collection migrated from CollectionEvent. '
  + 'Tax invoice assumed handled because old system did not track it separately.'
);

const PROJECT_TEST_FIELDS = ['name', 'notes'];
const INVOICE_TEST_FIELDS = ['project_name', 'client_name', 'invoice_reference', 'notes'];
const COLLECTION_DUE_TEST_FIELDS = ['project_name', 'client_name', 'invoice_reference', 'notes'];

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const amountsRoughlyEqual = (left, right, epsilon = 0.01) => (
  Math.abs(toNumber(left) - toNumber(right)) <= epsilon
);

function isTestProject(project) {
  return recordContainsTestReminderFlow(project, PROJECT_TEST_FIELDS);
}

function isTestInvoice(invoice) {
  return recordContainsTestReminderFlow(invoice, INVOICE_TEST_FIELDS);
}

function isTestCollectionDue(record) {
  return recordContainsTestReminderFlow(record, COLLECTION_DUE_TEST_FIELDS);
}

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

function sumPaidCollectionEventsForProject(events = []) {
  return (events || [])
    .filter((event) => isPaidCollectionEvent(event) && !isTestCollectionEvent(event))
    .reduce((sum, event) => sum + Math.max(toNumber(event.amount), 0), 0);
}

function printBackfillPreviewReport(report) {
  console.group('CollectionDue Backfill Preview');
  console.info('summary', report.summary);
  console.table(report.paidFromCollectionEvents);
  console.table(report.openFromProjectLegacy);
  console.table(report.ambiguousCollectedAmountCandidates);
  console.table(report.invoiceToCollectionCandidates);
  console.table(report.testRecordsExcluded);
  if (report.skippedExistingCollectionDue.length > 0) {
    console.table(report.skippedExistingCollectionDue);
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

  const paidFromCollectionEvents = [];
  const openFromProjectLegacy = [];
  const ambiguousCollectedAmountCandidates = [];
  const invoiceToCollectionCandidates = [];
  const skippedExistingCollectionDue = [];
  const testRecordsExcluded = [];
  const invalidCandidates = [];

  for (const event of collectionEvents || []) {
    if (isTestCollectionEvent(event)) {
      testRecordsExcluded.push({
        entity: 'CollectionEvent',
        id: event.id,
        project_id: event.project_id,
        project_name: event.project_name,
        reason: 'TEST_REMINDER_FLOW marker',
      });
      continue;
    }

    if (!isPaidCollectionEvent(event)) continue;

    const amount = toNumber(event.amount);
    const projectId = String(event?.project_id || '').trim();

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
      skippedExistingCollectionDue.push({
        source_entity_type: 'collection_event',
        source_entity_id: event.id,
        project_id: projectId,
        existing_collection_due_id: existingSourceIndex.get(sourceKey)?.id || '',
        reason: 'CollectionDue already exists for this CollectionEvent',
      });
      continue;
    }

    const project = projectById.get(projectId);
    const paidAt = event.paid_at || '';
    const isLegacy = event.is_legacy === true || event.type === 'collection_paid_legacy';

    paidFromCollectionEvents.push({
      kind: 'paid_from_collection_event',
      source_entity_type: 'collection_event',
      source_entity_id: event.id,
      project_id: projectId,
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
    });
  }

  for (const project of projects || []) {
    if (isTestProject(project)) {
      testRecordsExcluded.push({
        entity: 'Project',
        id: project.id,
        project_name: project.name,
        reason: 'TEST_REMINDER_FLOW marker',
      });
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
        skippedExistingCollectionDue.push({
          source_entity_type: 'project_legacy_open',
          source_entity_id: projectId,
          project_id: projectId,
          existing_collection_due_id: existingSourceIndex.get(sourceKey)?.id || '',
          reason: 'CollectionDue already exists for this Project legacy open collection',
        });
      } else {
        openFromProjectLegacy.push({
          kind: 'open_from_project_legacy',
          source_entity_type: 'project_legacy_open',
          source_entity_id: projectId,
          project_id: projectId,
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
        });
      }
    }

    const collectedAmount = toNumber(project.collected_amount);
    if (collectedAmount > 0) {
      const projectEvents = eventsByProjectId.get(projectId) || [];
      const sumCollectionEvents = sumPaidCollectionEventsForProject(projectEvents);
      const hasPaidEvents = projectEvents.some(
        (event) => isPaidCollectionEvent(event)
          && !isTestCollectionEvent(event)
          && toNumber(event.amount) > 0,
      );

      if (!hasPaidEvents || !amountsRoughlyEqual(collectedAmount, sumCollectionEvents)) {
        const difference = collectedAmount - sumCollectionEvents;
        let reason = 'sum(CollectionEvent.amount) does not match project.collected_amount';
        if (!hasPaidEvents) {
          reason = 'collected_amount > 0 but no matching non-test CollectionEvent payments';
        }

        ambiguousCollectedAmountCandidates.push({
          project_id: projectId,
          project_name: project.name || '',
          total_amount: toNumber(project.total_amount),
          collected_amount: collectedAmount,
          sumCollectionEvents,
          difference,
          last_collection_paid_on: project.last_collection_paid_on || '',
          reason,
        });
      }
    }
  }

  for (const invoice of invoiceProcesses || []) {
    if (isTestInvoice(invoice)) {
      testRecordsExcluded.push({
        entity: 'InvoiceProcess',
        id: invoice.id,
        project_name: invoice.project_name,
        invoice_reference: invoice.invoice_reference,
        reason: 'TEST_REMINDER_FLOW marker',
      });
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
      invoiceToCollectionCandidates.push({
        invoice_process_id: invoice.id,
        project_id: invoice.project_id || '',
        project_name: invoice.project_name || '',
        client_id: invoice.client_id || '',
        client_name: invoice.client_name || '',
        amount,
        invoice_reference: invoice.invoice_reference || '',
        invoice_sent_at: invoice.invoice_sent_at || '',
        reason: 'Invoice sent with amount but no collection_due_id',
      });
    }
  }

  for (const record of collectionDues || []) {
    if (isTestCollectionDue(record)) {
      testRecordsExcluded.push({
        entity: 'CollectionDue',
        id: record.id,
        project_name: record.project_name,
        reason: 'TEST_REMINDER_FLOW marker',
      });
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

  const paidFromCollectionEventsTotal = paidFromCollectionEvents.reduce(
    (sum, item) => sum + toNumber(item.amount_due),
    0,
  );
  const openFromProjectLegacyTotal = openFromProjectLegacy.reduce(
    (sum, item) => sum + toNumber(item.amount_due),
    0,
  );

  const summary = {
    paidFromCollectionEventsCount: paidFromCollectionEvents.length,
    paidFromCollectionEventsTotal,
    openFromProjectLegacyCount: openFromProjectLegacy.length,
    openFromProjectLegacyTotal,
    invoiceToCollectionCandidatesCount: invoiceToCollectionCandidates.length,
    ambiguousCollectedAmountCandidatesCount: ambiguousCollectedAmountCandidates.length,
    skippedExistingCount: skippedExistingCollectionDue.length,
    testRecordsExcludedCount: testRecordsExcluded.length,
    invalidCandidatesCount: invalidCandidates.length,
    existingCollectionDueCount: (collectionDues || []).length,
    totalProjects: (projects || []).length,
    totalCollectionEvents: (collectionEvents || []).length,
    totalInvoiceProcesses: (invoiceProcesses || []).length,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    summary,
    paidFromCollectionEvents,
    openFromProjectLegacy,
    ambiguousCollectedAmountCandidates,
    invoiceToCollectionCandidates,
    skippedExistingCollectionDue,
    testRecordsExcluded,
    invalidCandidates,
  };

  printBackfillPreviewReport(report);
  return report;
}
