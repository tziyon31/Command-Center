import { base44 } from '@/api/base44Client';
import { buildInvoiceCollectionNote, getTodayDateString } from '@/lib/projectCollectionDue';

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export const COLLECTION_DUE_STATUS_LABELS = {
  open: 'פתוח',
  partially_paid: 'שולם חלקית',
  paid: 'שולם',
  cancelled: 'בוטל',
};

export const OPEN_COLLECTION_STATUSES = new Set(['open', 'partially_paid']);

export function buildSingleCollectionLegacyNote(invoiceReference = '') {
  const reference = String(invoiceReference || '').trim();
  return reference ? `גבייה עבור חשבונית ${reference}` : 'גבייה עבור חשבונית';
}

export function buildMultiCollectionLegacyNote() {
  return 'קיימות גביות פתוחות בפרויקט';
}

export function computeCollectionPaymentFields(amountDue, amountPaid, { paidAt = null } = {}) {
  const due = toNumber(amountDue);
  const paid = Math.max(toNumber(amountPaid), 0);

  if (paid <= 0) {
    return {
      amount_paid: 0,
      remaining_amount: due,
      status: 'open',
      paid_at: '',
    };
  }

  if (paid >= due) {
    return {
      amount_paid: due,
      remaining_amount: 0,
      status: 'paid',
      paid_at: paidAt || new Date().toISOString(),
    };
  }

  return {
    amount_paid: paid,
    remaining_amount: due - paid,
    status: 'partially_paid',
    paid_at: '',
  };
}

export function pickNearestDueDate(dueDates = [], fallback = getTodayDateString()) {
  const parsed = dueDates
    .map((value) => {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    })
    .filter(Boolean);

  if (!parsed.length) return fallback;

  const now = Date.now();
  let nearest = parsed[0];
  let nearestDistance = Math.abs(nearest.getTime() - now);

  for (const date of parsed.slice(1)) {
    const distance = Math.abs(date.getTime() - now);
    if (distance < nearestDistance) {
      nearest = date;
      nearestDistance = distance;
    }
  }

  return nearest.toISOString().slice(0, 10);
}

export function buildProjectLegacyCollectionPayload(openCollections, { lastPaidAt = null } = {}) {
  const open = (openCollections || []).filter((item) => OPEN_COLLECTION_STATUSES.has(item?.status));

  if (!open.length) {
    const payload = {
      collection_due_now: false,
      collection_due_amount: 0,
      collection_due_note: '',
      collection_due_date: '',
    };
    if (lastPaidAt) payload.last_collection_paid_on = lastPaidAt;
    return payload;
  }

  const totalRemaining = open.reduce((sum, item) => sum + toNumber(item.remaining_amount), 0);
  const note = open.length === 1
    ? buildSingleCollectionLegacyNote(open[0].invoice_reference)
    : buildMultiCollectionLegacyNote();
  const dueDate = pickNearestDueDate(
    open.map((item) => item.due_date).filter(Boolean),
    getTodayDateString(),
  );

  return {
    collection_due_now: true,
    collection_due_amount: totalRemaining,
    collection_due_note: note,
    collection_due_date: dueDate,
  };
}

export async function fetchCollectionDuesForProject(projectId, entities = base44.entities) {
  if (!projectId) return [];
  const items = await entities.CollectionDue.filter({ project_id: projectId });
  return items || [];
}

export async function findNonCancelledCollectionDueForInvoice(invoiceProcessId, entities = base44.entities) {
  if (!invoiceProcessId) return null;
  const items = await entities.CollectionDue.filter({ invoice_process_id: invoiceProcessId });
  return (items || []).find((item) => item.status !== 'cancelled') || null;
}

export function buildCollectionDuePayloadFromInvoice(invoice, { now = new Date() } = {}) {
  const amount = toNumber(invoice?.amount);
  const nowIso = now.toISOString();

  return {
    invoice_process_id: invoice.id,
    invoice_reference: invoice.invoice_reference || '',
    project_id: invoice.project_id,
    project_name: invoice.project_name || '',
    client_id: invoice.client_id || '',
    client_name: invoice.client_name || '',
    amount_due: amount,
    amount_paid: 0,
    remaining_amount: amount,
    due_date: getTodayDateString(),
    opened_at: nowIso,
    paid_at: '',
    status: 'open',
    source_type: 'invoice_process',
    work_stage_ids: invoice.work_stage_ids || '',
    work_stage_titles: invoice.work_stage_titles || '',
    notes: buildInvoiceCollectionNote({
      invoiceReference: invoice.invoice_reference,
      workStageTitles: invoice.work_stage_titles,
      invoiceScope: invoice.invoice_scope,
    }),
    form_status: 'submitted',
  };
}

export async function syncProjectLegacyCollectionFields(
  projectId,
  { lastPaidAt = null, entities = base44.entities } = {},
) {
  if (!projectId) return null;

  const collections = await fetchCollectionDuesForProject(projectId, entities);
  const payload = buildProjectLegacyCollectionPayload(collections, { lastPaidAt });
  return entities.Project.update(projectId, payload);
}

export async function openCollectionDueFromInvoice({ invoice, entities = base44.entities }) {
  if (!invoice?.id || !invoice?.project_id) {
    throw new Error('INVALID_INVOICE');
  }

  const existing = await findNonCancelledCollectionDueForInvoice(invoice.id, entities);
  if (existing) {
    if (String(invoice.collection_due_id || '') !== String(existing.id)) {
      await entities.InvoiceProcess.update(invoice.id, { collection_due_id: existing.id });
    }
    await syncProjectLegacyCollectionFields(invoice.project_id, { entities });
    return { collectionDue: existing, created: false, invoiceId: invoice.id };
  }

  const payload = buildCollectionDuePayloadFromInvoice(invoice);
  const collectionDue = await entities.CollectionDue.create(payload);

  await entities.InvoiceProcess.update(invoice.id, { collection_due_id: collectionDue.id });
  await syncProjectLegacyCollectionFields(invoice.project_id, { entities });

  return { collectionDue, created: true, invoiceId: invoice.id };
}

export async function createCollectionEventForPayment(collectionDue, entities = base44.entities) {
  const reference = String(collectionDue.invoice_reference || '').trim();
  const note = reference
    ? `תשלום עבור חשבונית ${reference}`
    : 'תשלום גבייה';

  return entities.CollectionEvent.create({
    project_id: collectionDue.project_id,
    project_name: collectionDue.project_name || '',
    amount: toNumber(collectionDue.amount_due),
    note,
    opened_at: collectionDue.opened_at || collectionDue.due_date || '',
    paid_at: collectionDue.paid_at || new Date().toISOString(),
    type: 'collection_paid',
  });
}

export async function markCollectionDuePaid(collectionDue, entities = base44.entities) {
  if (!collectionDue?.id) throw new Error('COLLECTION_NOT_FOUND');

  const now = new Date().toISOString();
  const amountDue = toNumber(collectionDue.amount_due);
  const paymentFields = computeCollectionPaymentFields(amountDue, amountDue, { paidAt: now });

  const updated = await entities.CollectionDue.update(collectionDue.id, paymentFields);

  await syncProjectLegacyCollectionFields(collectionDue.project_id, {
    lastPaidAt: now,
    entities,
  });

  const eventPayload = {
    ...collectionDue,
    ...paymentFields,
    paid_at: paymentFields.paid_at,
  };

  await createCollectionEventForPayment(eventPayload, entities);

  return { ...collectionDue, ...updated, ...paymentFields };
}

export async function cancelCollectionDue(collectionDue, entities = base44.entities) {
  if (!collectionDue?.id) throw new Error('COLLECTION_NOT_FOUND');

  await entities.CollectionDue.update(collectionDue.id, {
    status: 'cancelled',
    form_status: 'cancelled',
  });

  await syncProjectLegacyCollectionFields(collectionDue.project_id, { entities });
}

export function buildCollectionDueFormPrefillFromInvoice(invoice) {
  const amount = toNumber(invoice?.amount);
  const nowIso = new Date().toISOString();

  return {
    invoice_process_id: invoice.id,
    invoice_reference: invoice.invoice_reference || '',
    project_id: invoice.project_id || '',
    project_name: invoice.project_name || '',
    client_id: invoice.client_id || '',
    client_name: invoice.client_name || '',
    amount_due: amount,
    amount_paid: 0,
    remaining_amount: amount,
    due_date: getTodayDateString(),
    opened_at: nowIso,
    paid_at: '',
    status: 'open',
    source_type: 'invoice_process',
    work_stage_ids: invoice.work_stage_ids || '',
    work_stage_titles: invoice.work_stage_titles || '',
    notes: buildInvoiceCollectionNote({
      invoiceReference: invoice.invoice_reference,
      workStageTitles: invoice.work_stage_titles,
      invoiceScope: invoice.invoice_scope,
    }),
    form_status: 'submitted',
  };
}
