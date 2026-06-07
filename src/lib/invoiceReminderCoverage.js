import { parseWorkStageIds } from '@/lib/invoiceProcessUtils';
import { buildInvoiceCollectionNote } from '@/lib/projectCollectionDue';
import { isWorkStageCompleted, WORK_STAGE_STATUS } from '@/lib/workStageLogic';

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export function parseIsoTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isWorkStageCompletedForInvoiceReview(stage) {
  if (!stage || stage.status === WORK_STAGE_STATUS.CANCELLED) return false;
  if (stage.status === WORK_STAGE_STATUS.COMPLETED) return true;
  return isWorkStageCompleted(stage);
}

export function getStageCompletionTimestamp(stage) {
  const completedAt = parseIsoTimestamp(stage?.completed_at);
  if (completedAt) return completedAt;

  if (!isWorkStageCompletedForInvoiceReview(stage)) return null;
  return parseIsoTimestamp(stage?.updated_date || stage?.created_date);
}

export function getInvoiceEffectiveTimestamp(invoice) {
  return parseIsoTimestamp(invoice?.submitted_at || invoice?.created_date || invoice?.updated_date);
}

export function isInvoiceProcessActive(invoice) {
  return Boolean(invoice) && invoice.form_status !== 'cancelled';
}

export function isInvoiceProcessSubmitted(invoice) {
  return isInvoiceProcessActive(invoice) && invoice.form_status === 'submitted';
}

export function invoiceCoversWorkStage(invoice, stage) {
  if (!isInvoiceProcessActive(invoice) || !stage?.id) return false;
  if (String(invoice.project_id || '') !== String(stage.project_id || '')) return false;

  const scope = String(invoice.invoice_scope || '');
  const stageIds = parseWorkStageIds(invoice.work_stage_ids).map((id) => String(id));

  if (scope === 'stage' || scope === 'multiple_stages') {
    return stageIds.includes(String(stage.id));
  }

  if (scope === 'general' || scope === 'final_project') {
    const invoiceAt = getInvoiceEffectiveTimestamp(invoice);
    const completedAt = getStageCompletionTimestamp(stage);
    if (!invoiceAt || !completedAt) return false;
    return completedAt.getTime() <= invoiceAt.getTime();
  }

  return false;
}

export function isWorkStageCoveredByInvoices(stage, invoices = []) {
  return invoices.some((invoice) => invoiceCoversWorkStage(invoice, stage));
}

export function getLatestStageCompletionTimestamp(stages = []) {
  let latest = null;

  for (const stage of stages) {
    const timestamp = getStageCompletionTimestamp(stage);
    if (!timestamp) continue;
    if (!latest || timestamp.getTime() > latest.getTime()) latest = timestamp;
  }

  return latest;
}

export function projectCompletedStagesAreFullyCovered(projectId, stages = [], invoices = []) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return false;

  const relevantStages = stages.filter(
    (stage) => String(stage?.project_id || '').trim() === normalizedProjectId
      && stage?.status !== WORK_STAGE_STATUS.CANCELLED
      && isWorkStageCompletedForInvoiceReview(stage),
  );

  if (relevantStages.length === 0) return false;

  if (relevantStages.every((stage) => isWorkStageCoveredByInvoices(stage, invoices))) {
    return true;
  }

  const latestCompletion = getLatestStageCompletionTimestamp(relevantStages);
  if (!latestCompletion) return false;

  return invoices.some((invoice) => {
    if (!isInvoiceProcessActive(invoice)) return false;
    if (String(invoice.project_id || '') !== String(normalizedProjectId)) return false;

    const scope = String(invoice.invoice_scope || '');
    if (scope !== 'general' && scope !== 'final_project') return false;

    const invoiceAt = getInvoiceEffectiveTimestamp(invoice);
    if (!invoiceAt) return false;

    return invoiceAt.getTime() >= latestCompletion.getTime();
  });
}

export function hasCollectionOpenedForInvoice(invoice, project) {
  if (!invoice) return false;

  if (String(invoice.collection_due_id || '').trim()) return true;
  if (!project || project.collection_due_now !== true) return false;

  const invoiceAmount = toNumber(invoice.amount);
  const dueAmount = toNumber(project.collection_due_amount);
  if (invoiceAmount <= 0 || dueAmount <= 0) return false;

  const note = String(project.collection_due_note || '').trim();
  if (!note.includes('גבייה עבור חשבונית')) return false;

  const reference = String(invoice.invoice_reference || '').trim();
  if (reference && note.includes(reference)) return true;

  const expectedNote = buildInvoiceCollectionNote({
    invoiceReference: invoice.invoice_reference,
    workStageTitles: invoice.work_stage_titles,
    invoiceScope: invoice.invoice_scope,
  });

  if (note === expectedNote && Math.abs(dueAmount - invoiceAmount) < 0.01) return true;
  if (Math.abs(dueAmount - invoiceAmount) < 0.01) return true;

  return false;
}
