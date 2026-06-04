import { isWorkStageCompleted } from '@/lib/workStageLogic';

export const INVOICE_SCOPE_LABELS = {
  stage: 'שלב בודד',
  multiple_stages: 'כמה שלבים',
  final_project: 'חשבונית סופית לפרויקט',
};

export const FORM_STATUS_LABELS = {
  draft: 'טיוטה',
  submitted: 'הוגש',
  cancelled: 'בוטל',
};

export function isWorkStageEligibleForInvoice(stage) {
  if (!stage || stage.status === 'cancelled') return false;
  if (stage.status === 'completed') return true;
  return isWorkStageCompleted(stage);
}

export function parseWorkStageIds(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];

  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((id) => String(id).trim()).filter(Boolean);
      }
    } catch (_error) {
      return [];
    }
  }

  return raw.split(',').map((id) => id.trim()).filter(Boolean);
}

export function serializeWorkStageIds(ids = []) {
  const unique = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
  return JSON.stringify(unique);
}

export function serializeWorkStageTitles(stages = []) {
  return stages
    .map((stage) => String(stage?.title || '').trim())
    .filter(Boolean)
    .join(' · ');
}

export function parseWorkStageIdsFromQueryParam(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  return raw.split(',').map((id) => id.trim()).filter(Boolean);
}

export function formatWorkStageIdsForQuery(ids = []) {
  return [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))].join(',');
}

export function resolveInvoiceScopeFromSelection(selectedIds = [], explicitScope = '') {
  const scope = String(explicitScope || '').trim();
  if (scope === 'final_project') return 'final_project';
  if (selectedIds.length > 1) return 'multiple_stages';
  if (selectedIds.length === 1) return 'stage';
  return scope || 'stage';
}

const nowIso = () => new Date().toISOString();

export function applyInvoiceProcessTimestampFields(payload, source = {}) {
  const next = { ...payload };

  if (next.invoice_created_in_paperless === true) {
    next.invoice_created_at = source.invoice_created_at || next.invoice_created_at || nowIso();
  } else {
    next.invoice_created_at = '';
  }

  if (next.invoice_sent_to_client === true) {
    next.invoice_sent_at = source.invoice_sent_at || next.invoice_sent_at || nowIso();
  } else {
    next.invoice_sent_at = '';
  }

  if (next.client_confirmed_received === true) {
    next.client_confirmed_at = source.client_confirmed_at || next.client_confirmed_at || nowIso();
  } else {
    next.client_confirmed_at = '';
  }

  return next;
}

export function validateInvoiceProcessSubmit({ projectId, clientId, clientName, invoiceScope, selectedStageIds }) {
  if (!String(projectId || '').trim()) {
    return 'יש לבחור פרויקט';
  }

  if (!String(clientId || '').trim() && !String(clientName || '').trim()) {
    return 'יש לבחור לקוח או למלא שם לקוח';
  }

  if (!invoiceScope) {
    return 'יש לבחור סוג חשבונית';
  }

  if (invoiceScope === 'stage' || invoiceScope === 'multiple_stages') {
    if (!selectedStageIds.length) {
      return 'יש לבחור לפחות שלב עבודה שהושלם';
    }
  }

  return null;
}
