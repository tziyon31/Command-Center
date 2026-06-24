import { api as base44 } from '@/api/apiClient';
import {
  hasCollectionOpenedForInvoice,
  isInvoiceProcessSubmitted,
  isWorkStageCompletedForInvoiceReview,
  isWorkStageCoveredByInvoices,
  projectCompletedStagesAreFullyCovered,
} from '@/lib/invoiceReminderCoverage';
import { WORK_STAGE_STATUS } from '@/lib/workStageLogic';
import { buildInvoiceProcessFormPageUrl } from '@/lib/workflowNavigation';
import {
  ensureReminderForCondition,
  isRateLimitError,
  loadReminderEngineCache,
  resolveReminderByConditionKey,
} from '@/lib/reminderEngine';

export const WORK_STAGE_NEEDS_INVOICE_REVIEW_PREFIX = 'work_stage_needs_invoice_review:';
export const PROJECT_COMPLETED_NEEDS_INVOICE_REVIEW_PREFIX = 'project_completed_needs_invoice_review:';
export const INVOICE_NEEDS_PAPERLESS_PREFIX = 'invoice_needs_paperless:';
export const INVOICE_NEEDS_SEND_PREFIX = 'invoice_needs_send:';
export const INVOICE_NEEDS_RECEIPT_CONFIRMATION_PREFIX = 'invoice_needs_receipt_confirmation:';
export const INVOICE_NEEDS_COLLECTION_PREFIX = 'invoice_needs_collection:';

const INVOICE_LIFECYCLE_PREFIXES = [
  INVOICE_NEEDS_PAPERLESS_PREFIX,
  INVOICE_NEEDS_SEND_PREFIX,
  INVOICE_NEEDS_RECEIPT_CONFIRMATION_PREFIX,
  INVOICE_NEEDS_COLLECTION_PREFIX,
];

export function getWorkStageNeedsInvoiceReviewConditionKey(stageId) {
  return `${WORK_STAGE_NEEDS_INVOICE_REVIEW_PREFIX}${stageId}`;
}

export function getProjectCompletedNeedsInvoiceReviewConditionKey(projectId) {
  return `${PROJECT_COMPLETED_NEEDS_INVOICE_REVIEW_PREFIX}${projectId}`;
}

export function getInvoiceNeedsPaperlessConditionKey(invoiceId) {
  return `${INVOICE_NEEDS_PAPERLESS_PREFIX}${invoiceId}`;
}

export function getInvoiceNeedsSendConditionKey(invoiceId) {
  return `${INVOICE_NEEDS_SEND_PREFIX}${invoiceId}`;
}

export function getInvoiceNeedsReceiptConfirmationConditionKey(invoiceId) {
  return `${INVOICE_NEEDS_RECEIPT_CONFIRMATION_PREFIX}${invoiceId}`;
}

export function getInvoiceNeedsCollectionConditionKey(invoiceId) {
  return `${INVOICE_NEEDS_COLLECTION_PREFIX}${invoiceId}`;
}

const classifyRuleAction = (engineResult) => {
  const action = engineResult?.action;
  if (action === 'created') return 'created';
  if (action === 'updated' || action === 'reactivated') return 'updated';
  if (action === 'resolved' || action === 'already_resolved') return 'resolved';
  return 'skipped';
};

const withReminderCache = (cache, options = {}) => (
  cache?.reminders ? { ...options, cache } : options
);

const tallyRuleAction = (summary, action) => {
  if (action === 'created') summary.created += 1;
  else if (action === 'updated') summary.updated += 1;
  else if (action === 'resolved') summary.resolved += 1;
  else summary.skipped += 1;

  if (action === 'created' || action === 'updated' || action === 'resolved') {
    summary.mutationCount += 1;
  }
};

const emptyBatchSummary = () => ({
  checked: 0,
  created: 0,
  updated: 0,
  resolved: 0,
  skipped: 0,
  errors: 0,
  rateLimited: false,
  mutationCount: 0,
  hasMore: false,
});

const getProjectFromCache = (cache, projectId) => {
  const map = cache?.ProjectById;
  if (map) return map.get(projectId) || null;
  return (cache?.projects || []).find((project) => project.id === projectId) || null;
};

const getInvoicesForProject = (cache, projectId) => {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return [];

  const map = cache?.InvoiceProcessById;
  if (map) {
    return [...map.values()].filter(
      (invoice) => String(invoice?.project_id || '').trim() === normalizedProjectId,
    );
  }

  return (cache?.invoiceProcesses || []).filter(
    (invoice) => String(invoice?.project_id || '').trim() === normalizedProjectId,
  );
};

const getWorkStagesForProject = (cache, projectId) => {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return [];

  const map = cache?.WorkStageById;
  if (map) {
    return [...map.values()].filter(
      (stage) => String(stage?.project_id || '').trim() === normalizedProjectId,
    );
  }

  return (cache?.workStages || []).filter(
    (stage) => String(stage?.project_id || '').trim() === normalizedProjectId,
  );
};

const mergeInvoicesIntoCache = (invoices = [], cache = {}) => {
  if (!cache.InvoiceProcessById) cache.InvoiceProcessById = new Map();
  for (const invoice of invoices) {
    if (invoice?.id) cache.InvoiceProcessById.set(invoice.id, invoice);
  }
  cache.invoiceProcesses = [...cache.InvoiceProcessById.values()];
};

const buildWorkStageInvoiceReviewActionUrl = (stage) => buildInvoiceProcessFormPageUrl({
  projectId: stage.project_id,
  workStageIds: [stage.id],
  invoiceScope: 'stage',
});

const buildProjectFinalInvoiceActionUrl = (projectId) => buildInvoiceProcessFormPageUrl({
  projectId,
  invoiceScope: 'final_project',
});

const buildInvoiceProcessActionUrl = (invoiceId) => buildInvoiceProcessFormPageUrl({
  invoiceProcessId: invoiceId,
});

const buildWorkStageInvoiceReviewReminderInput = (stage) => {
  const title = stage.title || 'ללא שם';

  return {
    title: `לבחון פתיחת תהליך חשבונית עבור שלב ${title}`,
    description: 'השלב הושלם ומסומן כנדרש לחשבונית. יש לבדוק האם לפתוח תהליך חשבונית עבורו או לכלול אותו בחשבונית כללית.',
    client_name: String(stage.client_name || stage.project_name || '').trim(),
    client_id: stage.client_id || '',
    project_name: stage.project_name || '',
    project_id: stage.project_id || '',
    source_type: 'work_stage',
    source_id: stage.id,
    action_url: buildWorkStageInvoiceReviewActionUrl(stage),
    action_label: 'פתח תהליך חשבונית',
    condition_key: getWorkStageNeedsInvoiceReviewConditionKey(stage.id),
    frequency: 'daily',
  };
};

const buildProjectCompletedInvoiceReviewReminderInput = (project, clientId = '', clientName = '') => {
  const projectName = project?.name || project?.project_name || 'ללא שם';

  return {
    title: `כל שלבי העבודה בפרויקט ${projectName} הושלמו - לבחון חשבונית`,
    description: 'כל שלבי העבודה בפרויקט הושלמו. יש לבדוק האם לפתוח תהליך חשבונית סופית או כללית.',
    client_name: String(clientName || projectName).trim(),
    client_id: clientId || project?.client_id || '',
    project_name: projectName,
    project_id: project.id,
    source_type: 'project',
    source_id: project.id,
    action_url: buildProjectFinalInvoiceActionUrl(project.id),
    action_label: 'פתח תהליך חשבונית',
    condition_key: getProjectCompletedNeedsInvoiceReviewConditionKey(project.id),
    frequency: 'daily',
  };
};

const buildInvoiceLifecycleReminderBase = (invoice) => ({
  client_name: String(invoice.client_name || invoice.project_name || '').trim(),
  client_id: invoice.client_id || '',
  project_name: invoice.project_name || '',
  project_id: invoice.project_id || '',
  source_type: 'invoice_process',
  source_id: invoice.id,
  action_url: buildInvoiceProcessActionUrl(invoice.id),
  action_label: 'פתח חשבונית',
  frequency: 'daily',
});

export async function runWorkStageNeedsInvoiceReviewRuleForStage(stage, cache = {}, options = {}) {
  const invoices = options.invoices ?? getInvoicesForProject(cache, stage?.project_id);

  const shouldOpen = Boolean(
    stage?.id
    && stage.status !== WORK_STAGE_STATUS.CANCELLED
    && isWorkStageCompletedForInvoiceReview(stage)
    && stage.invoice_required_on_completion === true
    && !isWorkStageCoveredByInvoices(stage, invoices),
  );

  const input = buildWorkStageInvoiceReviewReminderInput(stage);

  if (!input.client_name) {
    if (shouldOpen) return { action: 'skipped', reason: 'missing_client_name' };
    return resolveReminderByConditionKey(input.condition_key, 'condition_cleared', withReminderCache(cache, options));
  }

  return ensureReminderForCondition(
    shouldOpen,
    input,
    withReminderCache(cache, { ...options, immediate: true }),
  );
}

export async function runProjectCompletedNeedsInvoiceReviewRule(projectId, cache = {}, options = {}) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return { action: 'skipped', reason: 'missing_project_id' };

  const stages = options.stages ?? getWorkStagesForProject(cache, normalizedProjectId);
  const nonCancelledStages = stages.filter((stage) => stage?.status !== WORK_STAGE_STATUS.CANCELLED);

  if (nonCancelledStages.length === 0) {
    return resolveReminderByConditionKey(
      getProjectCompletedNeedsInvoiceReviewConditionKey(normalizedProjectId),
      'condition_cleared',
      withReminderCache(cache, options),
    );
  }

  const allCompleted = nonCancelledStages.every((stage) => isWorkStageCompletedForInvoiceReview(stage));
  const invoices = options.invoices ?? getInvoicesForProject(cache, normalizedProjectId);
  const fullyCovered = projectCompletedStagesAreFullyCovered(normalizedProjectId, stages, invoices);
  const shouldOpen = allCompleted && !fullyCovered;

  const project = getProjectFromCache(cache, normalizedProjectId) || {
    id: normalizedProjectId,
    name: nonCancelledStages[0]?.project_name || '',
    client_id: nonCancelledStages[0]?.client_id || '',
  };

  const input = buildProjectCompletedInvoiceReviewReminderInput(
    project,
    nonCancelledStages[0]?.client_id || project.client_id,
    nonCancelledStages[0]?.client_name || '',
  );

  if (!input.client_name) {
    if (shouldOpen) return { action: 'skipped', reason: 'missing_client_name' };
    return resolveReminderByConditionKey(input.condition_key, 'condition_cleared', withReminderCache(cache, options));
  }

  return ensureReminderForCondition(
    shouldOpen,
    input,
    withReminderCache(cache, { ...options, immediate: true }),
  );
}

export async function runWorkStageInvoiceReviewRulesForProject(projectId, cache = {}, options = {}) {
  if (!cache?.reminders) {
    await loadReminderEngineCache(cache);
  }

  const stages = options.stages ?? getWorkStagesForProject(cache, projectId);
  const invoices = options.invoices ?? getInvoicesForProject(cache, projectId);
  const stageResults = [];

  for (const stage of stages) {
    stageResults.push(await runWorkStageNeedsInvoiceReviewRuleForStage(stage, cache, {
      ...options,
      invoices,
    }));
  }

  const projectResult = await runProjectCompletedNeedsInvoiceReviewRule(projectId, cache, {
    ...options,
    stages,
    invoices,
  });

  return { wsi1: stageResults, wsi2: projectResult };
}

export async function runWorkStageInvoiceReviewRulesForAll(cache = {}, options = {}) {
  const summary = emptyBatchSummary();
  const maxMutations = Number.isFinite(options.maxMutations)
    ? Number(options.maxMutations)
    : Number.POSITIVE_INFINITY;

  try {
    await loadReminderEngineCache(cache);
  } catch (error) {
    summary.errors += 1;
    if (isRateLimitError(error)) summary.rateLimited = true;
    return summary;
  }

  let workStages = [];
  let invoiceProcesses = [];

  try {
    [workStages, invoiceProcesses] = await Promise.all([
      base44.entities.WorkStage.list(),
      base44.entities.InvoiceProcess.list(),
    ]);
  } catch (error) {
    summary.errors += 1;
    if (isRateLimitError(error)) summary.rateLimited = true;
    return summary;
  }

  cache.workStages = workStages;
  mergeInvoicesIntoCache(invoiceProcesses, cache);

  const projectIds = [...new Set(workStages.map((stage) => String(stage?.project_id || '').trim()).filter(Boolean))];

  for (const projectId of projectIds) {
    if (summary.rateLimited || summary.mutationCount >= maxMutations) {
      summary.hasMore = true;
      break;
    }

    summary.checked += 1;

    try {
      const result = await runWorkStageInvoiceReviewRulesForProject(projectId, cache);
      for (const stageResult of result.wsi1) tallyRuleAction(summary, classifyRuleAction(stageResult));
      tallyRuleAction(summary, classifyRuleAction(result.wsi2));
    } catch (error) {
      summary.errors += 1;
      if (isRateLimitError(error)) {
        summary.rateLimited = true;
        break;
      }
    }
  }

  return summary;
}

export async function runInvoiceLifecycleRulesForInvoice(invoice, cache = {}, options = {}) {
  if (!invoice?.id) return { inv1: null, inv2: null, inv3: null, inv4: null };

  const project = options.project ?? getProjectFromCache(cache, invoice.project_id);
  const submitted = isInvoiceProcessSubmitted(invoice);
  const amount = Number(invoice.amount);
  const hasAmount = Number.isFinite(amount) && amount > 0;

  const needsPaperless = submitted && invoice.invoice_created_in_paperless !== true;
  const needsSend = submitted && invoice.invoice_created_in_paperless === true && invoice.invoice_sent_to_client !== true;
  const needsReceipt = submitted && invoice.invoice_sent_to_client === true && invoice.client_confirmed_received !== true;
  const needsCollection = submitted
    && invoice.invoice_sent_to_client === true
    && hasAmount
    && !hasCollectionOpenedForInvoice(invoice, project);

  const base = buildInvoiceLifecycleReminderBase(invoice);
  const reminderOptions = withReminderCache(cache, { ...options, immediate: true });

  const inv1 = await ensureReminderForCondition(needsPaperless, {
    ...base,
    title: `ליצור חשבונית ב-Paperless עבור ${invoice.project_name || 'פרויקט'}`,
    description: 'תהליך החשבונית הוגש, אך עדיין לא סומן שהחשבונית נוצרה ב-Paperless.',
    condition_key: getInvoiceNeedsPaperlessConditionKey(invoice.id),
  }, reminderOptions);

  const inv2 = await ensureReminderForCondition(needsSend, {
    ...base,
    title: `לשלוח חשבונית ללקוח ${invoice.client_name || ''}`.trim(),
    description: 'החשבונית נוצרה ב-Paperless אך עדיין לא סומנה כנשלחה ללקוח.',
    condition_key: getInvoiceNeedsSendConditionKey(invoice.id),
  }, reminderOptions);

  const inv3 = await ensureReminderForCondition(needsReceipt, {
    ...base,
    title: 'לוודא שהלקוח קיבל את החשבונית',
    description: 'החשבונית סומנה כנשלחה ללקוח, אך עדיין לא סומן שהלקוח אישר קבלה.',
    condition_key: getInvoiceNeedsReceiptConfirmationConditionKey(invoice.id),
  }, reminderOptions);

  const referenceLabel = String(invoice.invoice_reference || invoice.project_name || 'פרויקט').trim();
  const inv4 = await ensureReminderForCondition(needsCollection, {
    ...base,
    title: `לפתוח גבייה עבור חשבונית ${referenceLabel}`,
    description: 'החשבונית נשלחה ללקוח ויש סכום לגבייה, אך עדיין לא נפתחה גבייה במערכת.',
    condition_key: getInvoiceNeedsCollectionConditionKey(invoice.id),
  }, reminderOptions);

  return { inv1, inv2, inv3, inv4 };
}

export async function runInvoiceReminderRulesForInvoice(invoice, cache = {}) {
  if (!cache?.reminders) {
    await loadReminderEngineCache(cache);
  }

  if (invoice?.id) {
    mergeInvoicesIntoCache([invoice], cache);
  }

  return runInvoiceLifecycleRulesForInvoice(invoice, cache);
}

export async function runInvoiceReminderRulesForProject(projectId, cache = {}) {
  if (!cache?.reminders) {
    await loadReminderEngineCache(cache);
  }

  const invoices = getInvoicesForProject(cache, projectId);
  const results = [];

  for (const invoice of invoices) {
    results.push(await runInvoiceLifecycleRulesForInvoice(invoice, cache));
  }

  return results;
}

export async function runInvoiceReminderRulesForAll(cache = {}, options = {}) {
  const summary = emptyBatchSummary();
  const maxMutations = Number.isFinite(options.maxMutations)
    ? Number(options.maxMutations)
    : Number.POSITIVE_INFINITY;

  try {
    await loadReminderEngineCache(cache);
  } catch (error) {
    summary.errors += 1;
    if (isRateLimitError(error)) summary.rateLimited = true;
    return summary;
  }

  let invoiceProcesses = [];

  try {
    invoiceProcesses = await base44.entities.InvoiceProcess.list();
  } catch (error) {
    summary.errors += 1;
    if (isRateLimitError(error)) summary.rateLimited = true;
    return summary;
  }

  mergeInvoicesIntoCache(invoiceProcesses, cache);

  for (const invoice of invoiceProcesses) {
    if (summary.rateLimited || summary.mutationCount >= maxMutations) {
      summary.hasMore = true;
      break;
    }

    summary.checked += 1;

    try {
      const result = await runInvoiceLifecycleRulesForInvoice(invoice, cache);
      for (const item of Object.values(result)) tallyRuleAction(summary, classifyRuleAction(item));
    } catch (error) {
      summary.errors += 1;
      if (isRateLimitError(error)) {
        summary.rateLimited = true;
        break;
      }
    }
  }

  return summary;
}

export async function cancelRemindersForInvoiceProcess(invoiceId, options = {}) {
  const normalizedId = String(invoiceId || '').trim();
  if (!normalizedId) return { cancelled: 0 };

  let cancelled = 0;

  for (const prefix of INVOICE_LIFECYCLE_PREFIXES) {
    const result = await resolveReminderByConditionKey(
      `${prefix}${normalizedId}`,
      'source_deleted',
      options,
    );
    if (result?.action === 'resolved') cancelled += 1;
  }

  return { cancelled };
}

export async function runAllInvoiceReminderRulesForProject(projectId, cache = {}, options = {}) {
  const lifecycle = await runInvoiceReminderRulesForProject(projectId, cache);
  const review = await runWorkStageInvoiceReviewRulesForProject(projectId, cache, options);
  return { lifecycle, review };
}
