import { base44 } from '@/api/base44Client';
import { syncProjectLegacyCollectionFields } from '@/lib/collectionDueUtils';
import { cancelRemindersForCollectionDue } from '@/lib/collectionReminderRules';

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const normalizeText = (value) => String(value || '').trim();

const matchesOptionalText = (actual, expected) => {
  const needle = normalizeText(expected);
  if (!needle) return true;
  return normalizeText(actual) === needle;
};

const matchesOptionalAmount = (actual, expected) => {
  if (expected == null || expected === '') return true;
  return toNumber(actual) === toNumber(expected);
};

const matchesOptionalStatus = (actual, expected) => {
  const needle = normalizeText(expected);
  if (!needle) return true;
  return normalizeText(actual) === needle;
};

function filterCollectionDueCandidates(collectionDues = [], filters = {}) {
  return (collectionDues || []).filter((item) => (
    matchesOptionalText(item.client_name, filters.clientName)
    && matchesOptionalText(item.project_name, filters.projectName)
    && matchesOptionalAmount(item.amount_due, filters.amountDue)
    && matchesOptionalAmount(item.amount_paid, filters.amountPaid)
    && matchesOptionalStatus(item.status, filters.status)
    && (
      !filters.notesIncludes
      || String(item.notes || '').includes(String(filters.notesIncludes))
    )
  ));
}

const buildPreviewRow = (collectionDue) => ({
  id: collectionDue.id,
  client_name: collectionDue.client_name || '',
  project_name: collectionDue.project_name || '',
  project_id: collectionDue.project_id || '',
  invoice_process_id: collectionDue.invoice_process_id || '',
  amount_due: collectionDue.amount_due,
  amount_paid: collectionDue.amount_paid,
  remaining_amount: collectionDue.remaining_amount,
  status: collectionDue.status || '',
  paid_at: collectionDue.paid_at || '',
  tax_invoice_sent_to_client: collectionDue.tax_invoice_sent_to_client === true,
  notes: collectionDue.notes || '',
});

async function findLinkedInvoiceProcesses(collectionDueId) {
  const invoices = await base44.entities.InvoiceProcess.list();
  return (invoices || []).filter(
    (invoice) => String(invoice.collection_due_id || '').trim() === String(collectionDueId).trim(),
  );
}

function isLikelyCollectionEventMatch(collectionDue, event) {
  if (!event || event.type !== 'collection_paid') return false;
  if (String(event.project_id || '').trim() !== String(collectionDue.project_id || '').trim()) {
    return false;
  }

  const amountDue = toNumber(collectionDue.amount_due);
  const amountPaid = toNumber(collectionDue.amount_paid);
  const eventAmount = toNumber(event.amount);
  if (eventAmount !== amountDue && eventAmount !== amountPaid) return false;

  const reference = String(collectionDue.invoice_reference || '').trim();
  const note = String(event.note || '');
  if (reference && note.includes(reference)) return true;

  const collectionPaidAt = collectionDue.paid_at ? new Date(collectionDue.paid_at) : null;
  const eventPaidAt = event.paid_at ? new Date(event.paid_at) : null;
  if (collectionPaidAt && eventPaidAt && !Number.isNaN(collectionPaidAt.getTime()) && !Number.isNaN(eventPaidAt.getTime())) {
    if (collectionPaidAt.toISOString() === eventPaidAt.toISOString()) return true;
    if (collectionPaidAt.toISOString().slice(0, 10) === eventPaidAt.toISOString().slice(0, 10)) {
      return true;
    }
  }

  return false;
}

async function findLikelyCollectionEvents(collectionDue) {
  if (!collectionDue?.project_id || !base44.entities.CollectionEvent) return [];

  const events = await base44.entities.CollectionEvent.filter({
    project_id: collectionDue.project_id,
  });

  return (events || []).filter((event) => isLikelyCollectionEventMatch(collectionDue, event));
}

async function deleteCollectionDueRecord(collectionDue) {
  if (typeof base44.entities.CollectionDue.delete === 'function') {
    try {
      await base44.entities.CollectionDue.delete(collectionDue.id);
      return { method: 'deleted' };
    } catch (error) {
      console.warn('[oneTimeCleanup] physical delete failed, falling back to cancel', error);
    }
  }

  await base44.entities.CollectionDue.update(collectionDue.id, {
    status: 'cancelled',
    form_status: 'cancelled',
    amount_paid: 0,
    remaining_amount: 0,
    notes: `${collectionDue.notes || ''} | cancelled by one-time cleanup`.trim(),
  });

  return { method: 'cancelled' };
}

/**
 * Lookup only — shows candidate CollectionDue rows with ids in the console.
 * TEMPORARY — remove after manual cleanup is confirmed.
 */
export async function previewCollectionDueCleanupCandidates(filters = {}) {
  const all = await base44.entities.CollectionDue.list('-created_date');
  const candidates = filterCollectionDueCandidates(all, filters);

  console.log('[oneTimeCleanup] Candidate CollectionDue records:');
  if (!candidates.length) {
    console.log('(none)');
    return { count: 0, candidates: [] };
  }

  console.table(candidates.map(buildPreviewRow));

  if (candidates.length === 1) {
    console.log('[oneTimeCleanup] Single match id:', candidates[0].id);
    console.log('Run: await window.cleanupOneTestCollectionDueById("%s")', candidates[0].id);
  } else {
    console.warn('[oneTimeCleanup] Multiple matches — refine filters before cleanup');
  }

  return { count: candidates.length, candidates };
}

/**
 * Cleanup only when filters resolve to exactly one CollectionDue.
 * TEMPORARY — remove after manual cleanup is confirmed.
 */
export async function cleanupOneTestCollectionDueByFingerprint(filters = {}, options = {}) {
  const lookup = await previewCollectionDueCleanupCandidates(filters);

  if (lookup.count === 0) {
    return { ok: false, reason: 'no_match', filters };
  }

  if (lookup.count > 1) {
    console.error('[oneTimeCleanup] Refusing cleanup — multiple matches. Use exact id instead.');
    return { ok: false, reason: 'ambiguous_match', filters, candidates: lookup.candidates.map((item) => item.id) };
  }

  return cleanupOneTestCollectionDueById(lookup.candidates[0].id, options);
}

/**
 * One-time cleanup utility for a single test CollectionDue by exact id.
 * TEMPORARY — remove after manual cleanup is confirmed.
 */
export async function cleanupOneTestCollectionDueById(collectionDueId, options = {}) {
  const normalizedId = String(collectionDueId || '').trim();
  if (!normalizedId) {
    throw new Error('CollectionDue id is required');
  }

  const matches = await base44.entities.CollectionDue.filter({ id: normalizedId });
  const collectionDue = matches?.[0];
  if (!collectionDue) {
    console.error('[oneTimeCleanup] CollectionDue not found:', normalizedId);
    return { ok: false, reason: 'not_found', collectionDueId: normalizedId };
  }

  console.log('[oneTimeCleanup] Preview — CollectionDue:');
  console.table([buildPreviewRow(collectionDue)]);

  const linkedInvoices = await findLinkedInvoiceProcesses(normalizedId);
  console.log('[oneTimeCleanup] Linked InvoiceProcess records:');
  console.table(linkedInvoices.map((invoice) => ({
    id: invoice.id,
    invoice_reference: invoice.invoice_reference || '',
    collection_due_id: invoice.collection_due_id || '',
    project_id: invoice.project_id || '',
  })));

  let project = null;
  if (collectionDue.project_id) {
    const projects = await base44.entities.Project.filter({ id: collectionDue.project_id });
    project = projects?.[0] || null;
  }

  console.log('[oneTimeCleanup] Project legacy fields before cleanup:');
  console.table([{
    project_id: project?.id || collectionDue.project_id || '',
    collection_due_now: project?.collection_due_now ?? '',
    collection_due_amount: project?.collection_due_amount ?? '',
    collection_due_note: project?.collection_due_note || '',
    collection_due_date: project?.collection_due_date || '',
    last_collection_paid_on: project?.last_collection_paid_on || '',
  }]);

  const likelyEvents = await findLikelyCollectionEvents(collectionDue);
  console.log('[oneTimeCleanup] Likely CollectionEvent matches:');
  if (likelyEvents.length) {
    console.table(likelyEvents.map((event) => ({
      id: event.id,
      project_id: event.project_id,
      amount: event.amount,
      note: event.note || '',
      paid_at: event.paid_at || '',
      type: event.type || '',
    })));
  } else {
    console.log('(none)');
  }

  if (options.skipConfirm !== true) {
    const confirmed = window.confirm(
      'האם למחוק את CollectionDue הבדיקתי הזה ולסנכרן את הפרויקט מחדש?\n\n'
      + `ID: ${collectionDue.id}\n`
      + `לקוח: ${collectionDue.client_name || '-'}\n`
      + `פרויקט: ${collectionDue.project_name || '-'}\n`
      + `שולם: ${collectionDue.amount_paid ?? 0}`,
    );

    if (!confirmed) {
      console.log('[oneTimeCleanup] Cancelled by user — no changes made');
      return { ok: false, reason: 'user_cancelled', collectionDueId: normalizedId };
    }
  }

  const summary = {
    ok: true,
    collectionDueId: normalizedId,
    collectionDueRemoved: null,
    invoiceProcessesUpdated: [],
    collectionEventsRemoved: [],
    collectionEventsSkipped: [],
    remindersCancelled: false,
    projectSynced: false,
  };

  for (const invoice of linkedInvoices) {
    await base44.entities.InvoiceProcess.update(invoice.id, { collection_due_id: '' });
    summary.invoiceProcessesUpdated.push(invoice.id);
  }

  if (likelyEvents.length === 1 && typeof base44.entities.CollectionEvent?.delete === 'function') {
    try {
      await base44.entities.CollectionEvent.delete(likelyEvents[0].id);
      summary.collectionEventsRemoved.push(likelyEvents[0].id);
    } catch (error) {
      console.warn('[oneTimeCleanup] failed to delete CollectionEvent', likelyEvents[0].id, error);
      summary.collectionEventsSkipped.push({
        id: likelyEvents[0].id,
        reason: 'delete_failed',
      });
    }
  } else if (likelyEvents.length > 1) {
    console.warn('[oneTimeCleanup] multiple CollectionEvent matches — skipped deletion for safety');
    summary.collectionEventsSkipped.push(
      ...likelyEvents.map((event) => ({ id: event.id, reason: 'ambiguous_match' })),
    );
  } else if (likelyEvents.length === 1) {
    console.warn('[oneTimeCleanup] CollectionEvent delete not available — skipped');
    summary.collectionEventsSkipped.push({
      id: likelyEvents[0].id,
      reason: 'delete_not_supported',
    });
  }

  summary.collectionDueRemoved = await deleteCollectionDueRecord(collectionDue);

  try {
    await cancelRemindersForCollectionDue(normalizedId);
    summary.remindersCancelled = true;
  } catch (error) {
    console.warn('[oneTimeCleanup] failed to cancel collection reminders', error);
  }

  if (collectionDue.project_id) {
    await syncProjectLegacyCollectionFields(collectionDue.project_id);
    summary.projectSynced = true;

    const refreshedProjects = await base44.entities.Project.filter({ id: collectionDue.project_id });
    const refreshedProject = refreshedProjects?.[0];
    console.log('[oneTimeCleanup] Project legacy fields after cleanup:');
    console.table([{
      project_id: refreshedProject?.id || collectionDue.project_id,
      collection_due_now: refreshedProject?.collection_due_now ?? '',
      collection_due_amount: refreshedProject?.collection_due_amount ?? '',
      collection_due_note: refreshedProject?.collection_due_note || '',
      collection_due_date: refreshedProject?.collection_due_date || '',
      last_collection_paid_on: refreshedProject?.last_collection_paid_on || '',
    }]);
  }

  console.log('[oneTimeCleanup] Cleanup summary:', summary);
  return summary;
}
