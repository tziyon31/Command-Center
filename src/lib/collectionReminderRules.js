import { api as base44 } from '@/api/apiClient';
import { buildCollectionDueFormPageUrl } from '@/lib/workflowNavigation';
import {
  ensureReminderForCondition,
  isRateLimitError,
  loadReminderEngineCache,
} from '@/lib/reminderEngine';
import {
  MONETARY_OPEN_COLLECTION_STATUSES,
} from '@/lib/collectionDueUtils';

export const COLLECTION_PAYMENT_DUE_PREFIX = 'collection_payment_due:';
export const COLLECTION_NEEDS_TAX_INVOICE_PREFIX = 'collection_needs_tax_invoice:';

export const COLLECTION_REMINDER_PREFIXES = [
  COLLECTION_PAYMENT_DUE_PREFIX,
  COLLECTION_NEEDS_TAX_INVOICE_PREFIX,
];

export function getCollectionPaymentDueConditionKey(collectionId) {
  return `${COLLECTION_PAYMENT_DUE_PREFIX}${collectionId}`;
}

export function getCollectionNeedsTaxInvoiceConditionKey(collectionId) {
  return `${COLLECTION_NEEDS_TAX_INVOICE_PREFIX}${collectionId}`;
}

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const parseDateOnly = (value) => {
  if (!value) return null;
  const raw = String(value).trim().slice(0, 10);
  const date = new Date(`${raw}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfDay = (date) => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

const subtractDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
};

const daysUntilDueDate = (dueDateValue, now = new Date()) => {
  const dueDate = parseDateOnly(dueDateValue);
  if (!dueDate) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((startOfDay(dueDate).getTime() - startOfDay(now).getTime()) / msPerDay);
};

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

const buildCollectionReminderBase = (collection) => ({
  client_name: String(collection?.client_name || collection?.project_name || '').trim(),
  client_id: collection?.client_id || '',
  project_name: collection?.project_name || '',
  project_id: collection?.project_id || '',
  source_type: 'collection_due',
  source_id: collection.id,
  action_url: buildCollectionDueFormPageUrl({ collectionDueId: collection.id }),
  action_label: 'פתח גבייה',
});

export function needsCollectionPaymentReminder(collection) {
  if (!collection?.id) return false;
  if (collection.status === 'cancelled') return false;
  if (!MONETARY_OPEN_COLLECTION_STATUSES.has(collection.status)) return false;
  if (toNumber(collection.remaining_amount) <= 0) return false;
  if (!parseDateOnly(collection.due_date)) return false;
  return true;
}

export function needsCollectionTaxInvoiceReminder(collection) {
  if (!collection?.id) return false;
  if (collection.status === 'cancelled' || collection.status === 'paid') return false;
  if (collection.tax_invoice_sent_to_client === true) return false;

  const amountDue = toNumber(collection.amount_due);
  const amountPaid = toNumber(collection.amount_paid);
  const paymentReceived = collection.payment_received === true
    || amountPaid >= amountDue
    || collection.status === 'awaiting_tax_invoice';

  return paymentReceived;
}

export function computeCollectionPaymentReminderSchedule(collection, now = new Date()) {
  const daysUntil = daysUntilDueDate(collection?.due_date, now);
  if (daysUntil === null) return null;

  if (daysUntil > 5) {
    const dueDate = parseDateOnly(collection.due_date);
    return {
      frequency: 'due_date_based',
      next_remind_at: subtractDays(dueDate, 5).toISOString(),
      immediate: false,
    };
  }

  return {
    frequency: 'daily',
    next_remind_at: now.toISOString(),
    immediate: true,
  };
}

export async function runCollectionReminderRulesForCollection(collection, options = {}) {
  if (!collection?.id) return { col1: null, col2: null };

  const cache = options.cache;
  const reminderOptions = withReminderCache(cache, options);
  const now = options.now || new Date();
  const clientName = String(collection.client_name || collection.project_name || 'לקוח').trim();

  const paymentCondition = needsCollectionPaymentReminder(collection);
  const paymentSchedule = paymentCondition
    ? computeCollectionPaymentReminderSchedule(collection, now)
    : null;

  let col1 = null;
  try {
    col1 = await ensureReminderForCondition(
      paymentCondition && Boolean(paymentSchedule),
      {
        ...buildCollectionReminderBase(collection),
        title: `לקבל תשלום עבור גבייה ${clientName}`,
        description: 'יש גבייה פתוחה עבור חשבונית/פרויקט. יש לעקוב אחרי קבלת התשלום מהלקוח.',
        condition_key: getCollectionPaymentDueConditionKey(collection.id),
        frequency: paymentSchedule?.frequency || 'daily',
        next_remind_at: paymentSchedule?.next_remind_at,
      },
      {
        ...reminderOptions,
        immediate: paymentSchedule?.immediate === true,
      },
    );
  } catch (error) {
    if (isRateLimitError(error)) throw error;
    console.error('[collectionReminderRules] COL1 failed', error);
  }

  const taxInvoiceCondition = needsCollectionTaxInvoiceReminder(collection);

  let col2 = null;
  try {
    col2 = await ensureReminderForCondition(
      taxInvoiceCondition,
      {
        ...buildCollectionReminderBase(collection),
        title: `לשלוח חשבונית מס ללקוח ${clientName}`,
        description: 'התשלום התקבל, אך עדיין לא סומן שנשלחה חשבונית מס ללקוח.',
        condition_key: getCollectionNeedsTaxInvoiceConditionKey(collection.id),
        frequency: 'daily',
        next_remind_at: now.toISOString(),
      },
      {
        ...reminderOptions,
        immediate: true,
      },
    );
  } catch (error) {
    if (isRateLimitError(error)) throw error;
    console.error('[collectionReminderRules] COL2 failed', error);
  }

  return { col1, col2 };
}

export async function runCollectionReminderRulesForAll(cache, options = {}) {
  const summary = emptyBatchSummary();
  const maxMutations = Number.isFinite(options.maxMutations) ? options.maxMutations : Infinity;

  const collectionsById = cache?.CollectionDueById;
  const collections = collectionsById
    ? [...collectionsById.values()]
    : await base44.entities.CollectionDue.list();

  for (const collection of collections || []) {
    if (summary.mutationCount >= maxMutations) {
      summary.hasMore = true;
      break;
    }

    summary.checked += 1;

    try {
      const result = await runCollectionReminderRulesForCollection(collection, {
        cache,
        now: options.now,
      });

      tallyRuleAction(summary, classifyRuleAction(result.col1));
      if (summary.mutationCount >= maxMutations) {
        summary.hasMore = true;
        break;
      }

      tallyRuleAction(summary, classifyRuleAction(result.col2));
      if (summary.mutationCount >= maxMutations) {
        summary.hasMore = true;
        break;
      }
    } catch (error) {
      summary.errors += 1;
      if (isRateLimitError(error)) {
        summary.rateLimited = true;
        break;
      }
      console.error('[collectionReminderRules] batch failed', error);
    }
  }

  return summary;
}

export async function cancelRemindersForCollectionDue(collectionId, options = {}) {
  const { resolveReminderByConditionKey } = await import('@/lib/reminderEngine');
  const reminderOptions = withReminderCache(options.cache, options);

  await resolveReminderByConditionKey(
    getCollectionPaymentDueConditionKey(collectionId),
    'source_deleted',
    reminderOptions,
  );
  await resolveReminderByConditionKey(
    getCollectionNeedsTaxInvoiceConditionKey(collectionId),
    'source_deleted',
    reminderOptions,
  );
}

export async function runCollectionReminderRulesWithCache(collection, options = {}) {
  const cache = options.cache || {};
  if (!cache.reminders) {
    await loadReminderEngineCache(cache);
  }
  return runCollectionReminderRulesForCollection(collection, { ...options, cache });
}
