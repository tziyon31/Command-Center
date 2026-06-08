import { base44 } from '@/api/base44Client';
import { buildInvoiceCollectionNote, getTodayDateString } from '@/lib/projectCollectionDue';

export const PAPERLESS_INVOICE_URL = 'https://www.paperless.tax/admin/invoice';
export const GMAIL_URL = 'https://mail.google.com';

export function buildGmailSearchUrl({ clientName = '', invoiceReference = '' } = {}) {
  const query = [clientName, invoiceReference]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');

  if (!query) return GMAIL_URL;

  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`;
}

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export const COLLECTION_DUE_STATUS_LABELS = {
  open: 'פתוחה',
  partially_paid: 'שולמה חלקית',
  awaiting_tax_invoice: 'התקבל תשלום - ממתין לחשבונית מס',
  paid: 'נסגרה',
  cancelled: 'בוטלה',
};

export const MONETARY_OPEN_COLLECTION_STATUSES = new Set(['open', 'partially_paid']);
export const ACTIVE_COLLECTION_STATUSES = new Set(['open', 'partially_paid', 'awaiting_tax_invoice']);
/** @deprecated use MONETARY_OPEN_COLLECTION_STATUSES or ACTIVE_COLLECTION_STATUSES */
export const OPEN_COLLECTION_STATUSES = ACTIVE_COLLECTION_STATUSES;

export const AWAITING_TAX_INVOICE_NOTE = 'נדרש לשלוח חשבונית מס ללקוח';

export function buildSingleCollectionLegacyNote(invoiceReference = '') {
  const reference = String(invoiceReference || '').trim();
  return reference ? `גבייה עבור חשבונית ${reference}` : 'גבייה עבור חשבונית';
}

export function buildMultiCollectionLegacyNote() {
  return 'קיימות גביות פתוחות בפרויקט';
}

export function computeCollectionDueStatus(collection, { now = new Date() } = {}) {
  const nowIso = now.toISOString();

  if (collection?.status === 'cancelled') {
    return {
      amount_paid: toNumber(collection.amount_paid),
      remaining_amount: toNumber(collection.remaining_amount),
      status: 'cancelled',
      payment_received: collection.payment_received === true,
      payment_received_at: collection.payment_received_at || '',
      tax_invoice_sent_to_client: collection.tax_invoice_sent_to_client === true,
      tax_invoice_sent_at: collection.tax_invoice_sent_at || '',
      paid_at: collection.paid_at || '',
    };
  }

  const amountDue = toNumber(collection?.amount_due);
  const amountPaid = toNumber(collection?.amount_paid);
  const paymentReceivedFlag = collection?.payment_received === true;
  const taxInvoiceSent = collection?.tax_invoice_sent_to_client === true;
  let paymentReceivedAt = collection?.payment_received_at || '';
  let taxInvoiceSentAt = collection?.tax_invoice_sent_at || '';
  let paidAt = collection?.paid_at || '';

  if (amountPaid <= 0 && !paymentReceivedFlag) {
    return {
      amount_paid: 0,
      remaining_amount: amountDue,
      status: 'open',
      payment_received: false,
      payment_received_at: '',
      tax_invoice_sent_to_client: false,
      tax_invoice_sent_at: '',
      paid_at: '',
    };
  }

  if (amountPaid > 0 && amountPaid < amountDue && !paymentReceivedFlag) {
    return {
      amount_paid: amountPaid,
      remaining_amount: amountDue - amountPaid,
      status: 'partially_paid',
      payment_received: false,
      payment_received_at: '',
      tax_invoice_sent_to_client: false,
      tax_invoice_sent_at: '',
      paid_at: '',
    };
  }

  const fullPayment = paymentReceivedFlag || amountPaid >= amountDue;
  if (fullPayment) {
    if (!paymentReceivedAt) paymentReceivedAt = nowIso;

    if (!taxInvoiceSent) {
      return {
        amount_paid: amountDue,
        remaining_amount: 0,
        status: 'awaiting_tax_invoice',
        payment_received: true,
        payment_received_at: paymentReceivedAt,
        tax_invoice_sent_to_client: false,
        tax_invoice_sent_at: '',
        paid_at: '',
      };
    }

    if (!taxInvoiceSentAt) taxInvoiceSentAt = nowIso;
    if (!paidAt) paidAt = nowIso;

    return {
      amount_paid: amountDue,
      remaining_amount: 0,
      status: 'paid',
      payment_received: true,
      payment_received_at: paymentReceivedAt,
      tax_invoice_sent_to_client: true,
      tax_invoice_sent_at: taxInvoiceSentAt,
      paid_at: paidAt,
    };
  }

  return {
    amount_paid: amountPaid,
    remaining_amount: Math.max(amountDue - amountPaid, 0),
    status: 'open',
    payment_received: false,
    payment_received_at: '',
    tax_invoice_sent_to_client: false,
    tax_invoice_sent_at: '',
    paid_at: '',
  };
}

export function computeCollectionPaymentFields(amountDue, amountPaid, { paidAt = null } = {}) {
  return computeCollectionDueStatus({
    amount_due: amountDue,
    amount_paid: amountPaid,
    payment_received: false,
    tax_invoice_sent_to_client: false,
    paid_at: paidAt || '',
    status: 'open',
  });
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

function mergeCollectionDueRecords(collections = [], freshRecords = []) {
  if (!freshRecords.length) return collections || [];

  const byId = new Map((collections || []).map((item) => [item.id, item]));
  for (const fresh of freshRecords) {
    if (!fresh?.id) continue;
    byId.set(fresh.id, { ...byId.get(fresh.id), ...fresh });
  }

  return [...byId.values()];
}

export function buildProjectLegacyCollectionPayload(collections, { lastPaidAt = null } = {}) {
  const items = collections || [];
  const openTreatment = items.filter((item) => ACTIVE_COLLECTION_STATUSES.has(item?.status));
  const monetaryOpen = openTreatment.filter((item) => MONETARY_OPEN_COLLECTION_STATUSES.has(item?.status));
  const awaitingTax = openTreatment.filter((item) => item?.status === 'awaiting_tax_invoice');
  const hasActiveWork = openTreatment.length > 0;

  if (!hasActiveWork) {
    const payload = {
      collection_due_now: false,
      collection_due_amount: 0,
      collection_due_note: '',
      collection_due_date: '',
    };
    if (lastPaidAt) payload.last_collection_paid_on = lastPaidAt;
    return payload;
  }

  const totalRemaining = monetaryOpen.reduce((sum, item) => sum + toNumber(item.remaining_amount), 0);

  let note = '';
  if (monetaryOpen.length > 0) {
    note = monetaryOpen.length === 1
      ? buildSingleCollectionLegacyNote(monetaryOpen[0].invoice_reference)
      : buildMultiCollectionLegacyNote();
  } else if (awaitingTax.length > 0) {
    note = AWAITING_TAX_INVOICE_NOTE;
  }

  let dueDate = getTodayDateString();
  if (monetaryOpen.length > 0) {
    dueDate = pickNearestDueDate(
      monetaryOpen.map((item) => item.due_date).filter(Boolean),
      getTodayDateString(),
    );
  }

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

const defaultCollectionPaymentFields = () => ({
  payment_received: false,
  payment_received_at: '',
  tax_invoice_sent_to_client: false,
  tax_invoice_sent_at: '',
  tax_invoice_reference: '',
});

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
    ...defaultCollectionPaymentFields(),
  };
}

export async function syncProjectLegacyCollectionFields(
  projectId,
  { lastPaidAt = null, entities = base44.entities, freshCollections = [] } = {},
) {
  if (!projectId) return null;

  const collections = mergeCollectionDueRecords(
    await fetchCollectionDuesForProject(projectId, entities),
    freshCollections,
  );
  const payload = buildProjectLegacyCollectionPayload(collections, { lastPaidAt });
  return entities.Project.update(projectId, payload);
}

async function runCollectionRulesSafe(collection, options = {}) {
  if (!collection?.id) return;
  try {
    const { runCollectionReminderRulesForCollection } = await import('@/lib/collectionReminderRules');
    await runCollectionReminderRulesForCollection(collection, options);
  } catch (error) {
    console.error('[collectionDueUtils] collection reminder rules failed', error);
  }
}

export async function openCollectionDueFromInvoice({ invoice, entities = base44.entities, cache = null } = {}) {
  if (!invoice?.id || !invoice?.project_id) {
    throw new Error('INVALID_INVOICE');
  }

  const existing = await findNonCancelledCollectionDueForInvoice(invoice.id, entities);
  if (existing) {
    if (String(invoice.collection_due_id || '') !== String(existing.id)) {
      await entities.InvoiceProcess.update(invoice.id, { collection_due_id: existing.id });
    }
    await syncProjectLegacyCollectionFields(invoice.project_id, {
      entities,
      freshCollections: [existing],
    });
    await runCollectionRulesSafe(existing, { entities, cache });
    return { collectionDue: existing, created: false, invoiceId: invoice.id };
  }

  const payload = buildCollectionDuePayloadFromInvoice(invoice);
  const collectionDue = await entities.CollectionDue.create(payload);

  await entities.InvoiceProcess.update(invoice.id, { collection_due_id: collectionDue.id });
  await syncProjectLegacyCollectionFields(invoice.project_id, {
    entities,
    freshCollections: [collectionDue],
  });
  await runCollectionRulesSafe(collectionDue, { entities, cache });

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

export async function completeCollectionDue(
  collectionDue,
  {
    paymentReceived = false,
    taxInvoiceSent = false,
    taxInvoiceReference = '',
    entities = base44.entities,
    cache = null,
  } = {},
) {
  if (!collectionDue?.id) throw new Error('COLLECTION_NOT_FOUND');

  const merged = {
    ...collectionDue,
    amount_paid: paymentReceived
      ? toNumber(collectionDue.amount_due)
      : toNumber(collectionDue.amount_paid),
    payment_received: paymentReceived || collectionDue.payment_received === true,
    tax_invoice_sent_to_client: taxInvoiceSent,
    tax_invoice_reference: taxInvoiceReference || collectionDue.tax_invoice_reference || '',
  };

  const computed = computeCollectionDueStatus(merged);
  const updatePayload = {
    ...computed,
    tax_invoice_reference: merged.tax_invoice_reference,
  };

  const updated = await entities.CollectionDue.update(collectionDue.id, updatePayload);
  const result = { ...collectionDue, ...updated, ...updatePayload };

  const syncOptions = {
    entities,
    freshCollections: [result],
    lastPaidAt: computed.status === 'paid' ? computed.paid_at : null,
  };

  await syncProjectLegacyCollectionFields(collectionDue.project_id, syncOptions);

  if (computed.status === 'paid') {
    await createCollectionEventForPayment(result, entities);
  }

  await runCollectionRulesSafe(result, { entities, cache });
  return result;
}

export async function markCollectionDuePaid(collectionDue, entities = base44.entities) {
  return completeCollectionDue(collectionDue, {
    paymentReceived: true,
    taxInvoiceSent: true,
    entities,
  });
}

export async function cancelCollectionDue(collectionDue, entities = base44.entities, cache = null) {
  if (!collectionDue?.id) throw new Error('COLLECTION_NOT_FOUND');

  const updated = await entities.CollectionDue.update(collectionDue.id, {
    status: 'cancelled',
    form_status: 'cancelled',
  });

  const cancelledRecord = { ...collectionDue, ...updated, status: 'cancelled' };
  await syncProjectLegacyCollectionFields(collectionDue.project_id, {
    entities,
    freshCollections: [cancelledRecord],
  });
  await runCollectionRulesSafe(cancelledRecord, { entities, cache });
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
    ...defaultCollectionPaymentFields(),
  };
}
