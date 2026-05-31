import { base44 } from '@/api/base44Client';
import { evaluateP2ReminderValidity } from '@/lib/reminderEngineP2';
import { isValidSignedProposal } from '@/lib/signedProposalValidation';
import { hasNonCancelledWorkStageForProject } from '@/lib/workStageReminderRules';

export const REMINDER_STATUS = {
  ACTIVE: 'active',
  SNOOZED: 'snoozed',
  RESOLVED: 'resolved',
  CANCELLED: 'cancelled',
};

export const DEFAULT_DAILY_REMINDER_TIME = '07:00';

const nowIso = () => new Date().toISOString();

const parseReminderDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toTimestamp = (value) => {
  const date = value instanceof Date ? value : parseReminderDate(value);
  return date ? date.getTime() : null;
};

const assertReminderId = (reminderId) => {
  if (!reminderId) {
    throw new Error('reminderId is required');
  }
};

const assertFutureSnoozeDate = (snoozedUntil, now = new Date()) => {
  const snoozeTime = toTimestamp(snoozedUntil);
  if (snoozeTime === null) {
    throw new Error('snoozedUntil must be a valid future date');
  }
  if (snoozeTime <= now.getTime()) {
    throw new Error('snoozedUntil must be in the future');
  }
};

const persistReminderUpdate = (reminderId, patch) =>
  base44.entities.Reminder.update(reminderId, patch);

const ACTIVE_SNOOZE_CLEAR_PATCH = {
  status: REMINDER_STATUS.ACTIVE,
  is_snoozed: false,
  snoozed_until: '',
};

const emptyPersistSummary = () => ({
  checked: 0,
  expiredSnoozesFound: 0,
  updated: 0,
  errors: [],
});

export const isTerminalReminderStatus = (status) =>
  status === REMINDER_STATUS.RESOLVED || status === REMINDER_STATUS.CANCELLED;

const isAlreadyActiveWithClearedSnooze = (reminder) =>
  reminder?.status === REMINDER_STATUS.ACTIVE
  && reminder?.is_snoozed === false
  && !reminder?.snoozed_until;

const hasExpiredSnooze = (reminder, now) => {
  if (!reminder || isTerminalReminderStatus(reminder.status)) {
    return false;
  }

  const isSnoozedState =
    reminder.status === REMINDER_STATUS.SNOOZED
    || reminder.is_snoozed === true;

  if (!isSnoozedState || isAlreadyActiveWithClearedSnooze(reminder)) {
    return false;
  }

  const snoozeTime = toTimestamp(reminder.snoozed_until);
  const nowTime = toTimestamp(now);
  const hasFutureSnooze = snoozeTime !== null && snoozeTime > nowTime;

  return !hasFutureSnooze;
};

/**
 * Returns a reminder with consistent status/snooze fields (does not persist).
 * Terminal states (resolved/cancelled) always win over snooze flags.
 */
export function normalizeReminderState(reminder, now = new Date()) {
  if (!reminder) return reminder;

  const next = { ...reminder };

  if (
    next.status === REMINDER_STATUS.RESOLVED
    || next.status === REMINDER_STATUS.CANCELLED
  ) {
    return {
      ...next,
      is_snoozed: false,
      snoozed_until: '',
    };
  }

  const snoozeTime = toTimestamp(next.snoozed_until);
  const nowTime = toTimestamp(now);
  const hasFutureSnooze = snoozeTime !== null && snoozeTime > nowTime;

  if (next.status === REMINDER_STATUS.SNOOZED || next.is_snoozed === true) {
    if (hasFutureSnooze) {
      return {
        ...next,
        status: REMINDER_STATUS.SNOOZED,
        is_snoozed: true,
      };
    }

    return {
      ...next,
      status: REMINDER_STATUS.ACTIVE,
      is_snoozed: false,
      snoozed_until: '',
    };
  }

  return next;
}

export async function snoozeReminder(reminderId, snoozedUntil) {
  assertReminderId(reminderId);
  assertFutureSnoozeDate(snoozedUntil);

  return persistReminderUpdate(reminderId, {
    status: REMINDER_STATUS.SNOOZED,
    is_snoozed: true,
    snoozed_until: snoozedUntil,
  });
}

export async function resolveReminder(reminderId, reason) {
  assertReminderId(reminderId);

  return persistReminderUpdate(reminderId, {
    status: REMINDER_STATUS.RESOLVED,
    is_snoozed: false,
    snoozed_until: '',
    resolved_at: nowIso(),
    resolved_reason: reason || 'condition_cleared',
  });
}

export async function reactivateReminder(reminder) {
  const reminderId = reminder?.id;
  assertReminderId(reminderId);

  const currentCount = Number(reminder?.reactivation_count);
  const reactivationCount = Number.isFinite(currentCount) ? currentCount + 1 : 1;
  const timestamp = nowIso();

  return persistReminderUpdate(reminderId, {
    status: REMINDER_STATUS.ACTIVE,
    is_snoozed: false,
    snoozed_until: '',
    active_since: timestamp,
    reactivated_at: timestamp,
    reactivation_count: reactivationCount,
    resolved_at: '',
    resolved_reason: '',
  });
}

export async function cancelReminder(reminderId, reason) {
  assertReminderId(reminderId);

  return persistReminderUpdate(reminderId, {
    status: REMINDER_STATUS.CANCELLED,
    is_snoozed: false,
    snoozed_until: '',
    resolved_at: nowIso(),
    resolved_reason: reason || 'cancelled',
  });
}

const REMINDER_CONDITION_PREFIX_BY_ENTITY_TYPE = {
  inquiry: [
    'inquiry_missing_fields:',
    'inquiry_needs_next_step:',
    'inquiry_needs_proposal:',
  ],
  client: ['client_needs_project:'],
  project: ['project_needs_proposal:'],
  proposal: [
    'proposal_incomplete:',
    'proposal_not_sent:',
    'proposal_not_seen:',
    'proposal_needs_signed_proposal:',
  ],
  signed_proposal: ['signed_proposal_needs_work_stages:'],
};

const ORPHAN_ENTITY_LOADERS = [
  { sourceType: 'inquiry', entityName: 'Inquiry' },
  { sourceType: 'client', entityName: 'Client' },
  { sourceType: 'project', entityName: 'Project' },
  { sourceType: 'proposal', entityName: 'Proposal' },
  { sourceType: 'signed_proposal', entityName: 'SignedProposal' },
];

const KNOWN_ORPHAN_SOURCE_TYPES = new Set(
  ORPHAN_ENTITY_LOADERS.map((loader) => loader.sourceType),
);

const CONDITION_KEY_PREFIX_COUNTS = [
  { label: 'inquiry_missing_fields', prefix: 'inquiry_missing_fields:' },
  { label: 'inquiry_needs_next_step', prefix: 'inquiry_needs_next_step:' },
  { label: 'inquiry_needs_proposal', prefix: 'inquiry_needs_proposal:' },
  { label: 'client_needs_project', prefix: 'client_needs_project:' },
  { label: 'project_needs_proposal', prefix: 'project_needs_proposal:' },
  { label: 'proposal_incomplete', prefix: 'proposal_incomplete:' },
  { label: 'proposal_not_sent', prefix: 'proposal_not_sent:' },
  { label: 'proposal_not_seen', prefix: 'proposal_not_seen:' },
  { label: 'proposal_needs_signed_proposal', prefix: 'proposal_needs_signed_proposal:' },
  { label: 'signed_proposal_needs_work_stages', prefix: 'signed_proposal_needs_work_stages:' },
];

/** Default true: Dashboard must not mutate reminders until dry-run is verified. */
export const REMINDER_CLEANUP_DRY_RUN_DEFAULT = true;

const RECONCILIATION_COOLDOWN_MS = 10 * 60 * 1000;
const RECONCILIATION_RATE_LIMIT_COOLDOWN_MS = 2 * 60 * 1000;
const RECONCILIATION_STALE_LOCK_MS = 5 * 60 * 1000;
const RECONCILIATION_HAS_MORE_COOLDOWN_MS = 90 * 1000;
const RECONCILIATION_MAX_MUTATIONS_PER_RUN = 25;

const RECONCILIATION_STORAGE_KEYS = {
  LAST_RUN_AT: 'lastReminderReconciliationAt',
  LAST_ERROR_AT: 'lastReminderReconciliationErrorAt',
  LAST_ERROR_TYPE: 'lastReminderReconciliationErrorType',
  LOCK: 'reminderReconciliationLock',
  HAS_MORE: 'reminderReconciliationHasMore',
};

export const REMINDER_INTEGRATION_TEST_LOCK_KEY = 'reminderIntegrationTestRunning';

export function isReminderIntegrationTestRunning() {
  if (typeof globalThis === 'undefined' || !globalThis.localStorage) return false;
  try {
    return globalThis.localStorage.getItem(REMINDER_INTEGRATION_TEST_LOCK_KEY) === 'true';
  } catch (_error) {
    return false;
  }
}

const REMINDER_PREFIXES = {
  R1: 'inquiry_missing_fields:',
  R2: 'inquiry_needs_next_step:',
  P1: 'inquiry_needs_proposal:',
  R4: 'client_needs_project:',
  P2: 'project_needs_proposal:',
  P0: 'proposal_incomplete:',
  P3: 'proposal_not_sent:',
  P4: 'proposal_not_seen:',
  SP1: 'proposal_needs_signed_proposal:',
  R7: 'signed_proposal_needs_work_stages:',
};

const DATE_LIKE_CONDITION_KEY_PATTERN =
  /\d{4}[-/]\d{2}[-/]\d{2}|\d{4}-\d{2}-\d{2}|:20\d{2}|:today|:tomorrow|:date/i;

const emptyCancelRemindersSummary = () => ({
  checked: 0,
  matched: 0,
  cancelled: 0,
  skipped: 0,
  errors: 0,
});

const getEntityIdFromConditionKey = (conditionKey, entityType = null) => {
  if (!conditionKey) return null;

  const typesToCheck = entityType
    ? [entityType]
    : Object.keys(REMINDER_CONDITION_PREFIX_BY_ENTITY_TYPE);

  for (const type of typesToCheck) {
    const prefixes = REMINDER_CONDITION_PREFIX_BY_ENTITY_TYPE[type] || [];

    for (const prefix of prefixes) {
      if (conditionKey.startsWith(prefix)) {
        return { entityType: type, entityId: conditionKey.slice(prefix.length) };
      }
    }
  }

  return null;
};

const getEntityIdFromConditionKeyForSource = (conditionKey, sourceType) => {
  const parsed = getEntityIdFromConditionKey(conditionKey, sourceType);
  return parsed?.entityId || null;
};

const matchesDeletedSource = (reminder, sourceType, sourceId) => {
  if (reminder?.source_type === sourceType && reminder?.source_id === sourceId) {
    return true;
  }

  const entityIdFromKey = getEntityIdFromConditionKeyForSource(
    reminder?.condition_key,
    sourceType,
  );

  return entityIdFromKey === sourceId;
};

const isOpenReminderStatus = (status) =>
  status === REMINDER_STATUS.ACTIVE || status === REMINDER_STATUS.SNOOZED;

const loadEntityIdsForOrphanSourceType = async ({ sourceType, entityName }) => {
  try {
    const entity = base44.entities[entityName];

    if (!entity || typeof entity.list !== 'function') {
      return { sourceType, entityName, success: false, ids: null, idCount: 0, error: 'entity_not_available' };
    }

    const items = await entity.list();
    const ids = new Set((items || []).map((item) => item?.id).filter(Boolean));

    return { sourceType, entityName, success: true, ids, idCount: ids.size, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ReminderEngine] failed to load entity ids', { entityName, sourceType }, error);
    return { sourceType, entityName, success: false, ids: null, idCount: 0, error: message };
  }
};

const loadEntityIdSetsForOrphanCleanup = async () => {
  const entityIdSets = {};
  const loaderStatus = {};

  const results = await Promise.all(
    ORPHAN_ENTITY_LOADERS.map((loader) => loadEntityIdsForOrphanSourceType(loader)),
  );

  for (const result of results) {
    loaderStatus[result.sourceType] = {
      success: result.success,
      idCount: result.idCount,
      error: result.error,
      entityName: result.entityName,
    };

    if (result.success && result.ids) {
      entityIdSets[result.sourceType] = result.ids;
    }
  }

  return { entityIdSets, loaderStatus };
};

const isOrphanOpenReminderBySource = (reminder, entityIdSets, loaderStatus) => {
  if (!reminder || isTerminalReminderStatus(reminder.status)) return false;

  const sourceType = reminder.source_type ? String(reminder.source_type).trim() : '';
  const sourceId = reminder.source_id ? String(reminder.source_id).trim() : '';

  if (!sourceType || !sourceId) return false;
  if (!KNOWN_ORPHAN_SOURCE_TYPES.has(sourceType)) return false;

  const loadResult = loaderStatus[sourceType];
  if (!loadResult?.success) return false;

  const idsForSourceType = entityIdSets[sourceType];
  if (!idsForSourceType) return false;

  return !idsForSourceType.has(sourceId);
};

const getReminderRecencyTimestamp = (reminder) => (
  toTimestamp(reminder?.updated_date || reminder?.updated_at)
  ?? toTimestamp(reminder?.created_date || reminder?.created_at)
  ?? 0
);

export function pickPrimaryReminderForConditionKey(reminders, now = new Date()) {
  if (!Array.isArray(reminders) || reminders.length === 0) return null;

  const openReminders = reminders.filter((reminder) => isOpenReminderStatus(reminder?.status));
  const pool = openReminders.length > 0 ? openReminders : reminders;

  const rankReminder = (reminder) => {
    const normalized = normalizeReminderState(reminder, now);
    let priority = 0;

    if (normalized.status === REMINDER_STATUS.ACTIVE) {
      priority = 3;
    } else if (normalized.status === REMINDER_STATUS.SNOOZED) {
      const snoozeTime = toTimestamp(reminder.snoozed_until);
      const hasValidSnooze = snoozeTime !== null && snoozeTime > toTimestamp(now);
      priority = hasValidSnooze ? 2 : 3;
    } else if (reminder.status === REMINDER_STATUS.RESOLVED) {
      priority = 1;
    }

    return { priority, recency: getReminderRecencyTimestamp(reminder) };
  };

  const sorted = [...pool].sort((left, right) => {
    const leftRank = rankReminder(left);
    const rightRank = rankReminder(right);
    if (leftRank.priority !== rightRank.priority) return rightRank.priority - leftRank.priority;
    return rightRank.recency - leftRank.recency;
  });

  return sorted[0] || null;
}

export async function cancelRemindersForDeletedSource(sourceType, sourceId, options = {}) {
  if (!sourceType || !sourceId) {
    return { ...emptyCancelRemindersSummary(), status: 'skipped', reason: 'missing_source' };
  }

  const summary = emptyCancelRemindersSummary();
  let reminders = options.cache?.reminders ?? null;

  try {
    if (!reminders) reminders = await base44.entities.Reminder.list();
  } catch (error) {
    summary.errors += 1;
    throw error;
  }

  summary.checked = reminders.length;
  const matched = reminders.filter((reminder) => matchesDeletedSource(reminder, sourceType, sourceId));
  summary.matched = matched.length;

  for (const reminder of matched) {
    if (reminder.status === REMINDER_STATUS.CANCELLED) { summary.skipped += 1; continue; }
    if (!reminder?.id) { summary.errors += 1; continue; }

    try {
      await cancelReminder(reminder.id, 'source_deleted');
      summary.cancelled += 1;
    } catch (error) {
      summary.errors += 1;
      console.error('[ReminderEngine] failed to cancel reminder for deleted source', { sourceType, sourceId, reminderId: reminder.id }, error);
    }
  }

  return summary;
}

export async function cancelOrphanRemindersForSourceType(sourceType, existingSourceIds = [], options = {}) {
  if (!sourceType) {
    return { ...emptyCancelRemindersSummary(), status: 'skipped', reason: 'missing_source_type' };
  }

  const existingIds = new Set((existingSourceIds || []).filter(Boolean));
  const summary = emptyCancelRemindersSummary();
  let reminders = options.cache?.reminders ?? null;

  try {
    if (!reminders) reminders = await base44.entities.Reminder.list();
  } catch (error) {
    summary.errors += 1;
    throw error;
  }

  summary.checked = reminders.length;
  const remindersToCancel = new Map();

  for (const reminder of reminders) {
    if (isTerminalReminderStatus(reminder?.status)) continue;

    if (reminder?.source_type === sourceType && reminder?.source_id && !existingIds.has(reminder.source_id)) {
      if (reminder?.id) remindersToCancel.set(reminder.id, reminder);
    }
  }

  summary.matched = remindersToCancel.size;

  for (const reminder of remindersToCancel.values()) {
    try {
      await cancelReminder(reminder.id, 'source_deleted');
      summary.cancelled += 1;
    } catch (error) {
      summary.errors += 1;
      console.error('[ReminderEngine] failed to cancel orphan reminder', { sourceType, reminderId: reminder.id }, error);
    }
  }

  return summary;
}

export async function cleanupOrphanReminders(options = {}) {
  const dryRun = options.dryRun ?? REMINDER_CLEANUP_DRY_RUN_DEFAULT;
  const maxMutations = Number.isFinite(options.maxMutations) ? Number(options.maxMutations) : Number.POSITIVE_INFINITY;

  const summary = {
    dryRun, checked: 0, cancelled: 0, wouldCancel: 0, skipped: 0,
    skippedUnknownSourceTypes: 0, skippedMissingSourceId: 0, skippedFailedLoader: 0,
    loaderStatus: {}, errors: [], wouldCancelReminders: [], hasMore: false,
  };

  let reminders = options.cache?.reminders ?? null;

  try {
    if (!reminders) reminders = await base44.entities.Reminder.list();
  } catch (error) {
    summary.errors.push({ stage: 'list_reminders', error: error instanceof Error ? error.message : String(error) });
    return summary;
  }

  summary.checked = reminders.length;
  const { entityIdSets, loaderStatus } = await loadEntityIdSetsForOrphanCleanup();
  summary.loaderStatus = loaderStatus;

  for (const reminder of reminders) {
    if (!isOpenReminderStatus(reminder?.status)) { summary.skipped += 1; continue; }

    const sourceType = reminder.source_type ? String(reminder.source_type).trim() : '';
    const sourceId = reminder.source_id ? String(reminder.source_id).trim() : '';

    if (!sourceType || !sourceId) { summary.skippedMissingSourceId += 1; continue; }
    if (!KNOWN_ORPHAN_SOURCE_TYPES.has(sourceType)) { summary.skippedUnknownSourceTypes += 1; continue; }
    if (!loaderStatus[sourceType]?.success) { summary.skippedFailedLoader += 1; continue; }
    if (!isOrphanOpenReminderBySource(reminder, entityIdSets, loaderStatus)) continue;
    if (!reminder?.id) { summary.errors.push({ reminderId: null, error: 'reminder id is required' }); continue; }

    const cancelEntry = { id: reminder.id, title: reminder.title, condition_key: reminder.condition_key, source_type: reminder.source_type, source_id: reminder.source_id, status: reminder.status };

    if (dryRun) { summary.wouldCancel += 1; summary.wouldCancelReminders.push(cancelEntry); continue; }

    try {
      await cancelReminder(reminder.id, 'source_deleted');
      summary.cancelled += 1;
      if (summary.cancelled >= maxMutations) { summary.hasMore = true; break; }
    } catch (error) {
      summary.errors.push({ reminderId: reminder.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (dryRun && summary.wouldCancel > 0) {
    console.info('[ReminderEngine] cleanupOrphanReminders dry-run', { wouldCancel: summary.wouldCancel, loaderStatus: summary.loaderStatus, sample: summary.wouldCancelReminders.slice(0, 10) });
  }

  return summary;
}

export async function cleanupDuplicateConditionKeyReminders(options = {}) {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? REMINDER_CLEANUP_DRY_RUN_DEFAULT;
  const maxMutations = Number.isFinite(options.maxMutations) ? Number(options.maxMutations) : Number.POSITIVE_INFINITY;

  const summary = {
    dryRun, checkedConditionKeys: 0, duplicateGroups: 0, cancelledDuplicates: 0,
    wouldCancelDuplicates: 0, skippedEmptyConditionKey: 0, errors: [], wouldCancelReminders: [], hasMore: false,
  };

  let reminders = options.cache?.reminders ?? null;

  try {
    if (!reminders) reminders = await base44.entities.Reminder.list();
  } catch (error) {
    summary.errors.push({ stage: 'list_reminders', error: error instanceof Error ? error.message : String(error) });
    return summary;
  }

  const openByConditionKey = new Map();

  for (const reminder of reminders) {
    const conditionKey = reminder?.condition_key ? String(reminder.condition_key).trim() : '';

    if (!conditionKey) {
      if (isOpenReminderStatus(reminder?.status)) summary.skippedEmptyConditionKey += 1;
      continue;
    }

    if (!isOpenReminderStatus(reminder?.status)) continue;

    if (!openByConditionKey.has(conditionKey)) openByConditionKey.set(conditionKey, []);
    openByConditionKey.get(conditionKey).push(reminder);
  }

  summary.checkedConditionKeys = openByConditionKey.size;

  for (const [conditionKey, group] of openByConditionKey.entries()) {
    if (group.length <= 1) continue;

    summary.duplicateGroups += 1;
    const keeper = pickPrimaryReminderForConditionKey(group, now);

    for (const reminder of group) {
      if (!reminder?.id || reminder.id === keeper?.id) continue;

      const cancelEntry = { id: reminder.id, title: reminder.title, condition_key: conditionKey, source_type: reminder.source_type, source_id: reminder.source_id, status: reminder.status, keeperId: keeper?.id };

      if (dryRun) { summary.wouldCancelDuplicates += 1; summary.wouldCancelReminders.push(cancelEntry); continue; }

      try {
        await cancelReminder(reminder.id, 'duplicate_condition_key_cleanup');
        summary.cancelledDuplicates += 1;
        if (summary.cancelledDuplicates >= maxMutations) { summary.hasMore = true; break; }
      } catch (error) {
        summary.errors.push({ reminderId: reminder.id, conditionKey, error: error instanceof Error ? error.message : String(error) });
      }
    }

    if (summary.hasMore) break;
  }

  if (dryRun && summary.wouldCancelDuplicates > 0) {
    console.info('[ReminderEngine] cleanupDuplicateConditionKeyReminders dry-run', { wouldCancelDuplicates: summary.wouldCancelDuplicates, duplicateGroups: summary.duplicateGroups, sample: summary.wouldCancelReminders.slice(0, 10) });
  }

  return summary;
}

const countByField = (items, getValue) => {
  const counts = {};
  for (const item of items) {
    const key = getValue(item) || '(empty)';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
};

const countByConditionKeyPrefix = (reminders) => {
  const counts = Object.fromEntries(CONDITION_KEY_PREFIX_COUNTS.map(({ label }) => [label, 0]));
  for (const reminder of reminders) {
    const conditionKey = reminder?.condition_key ? String(reminder.condition_key).trim() : '';
    for (const { label, prefix } of CONDITION_KEY_PREFIX_COUNTS) {
      if (conditionKey.startsWith(prefix)) counts[label] += 1;
    }
  }
  return counts;
};

const getTerminalReminderSortTime = (reminder) => (
  toTimestamp(reminder?.resolved_at)
  ?? toTimestamp(reminder?.updated_date || reminder?.updated_at)
  ?? toTimestamp(reminder?.created_date || reminder?.created_at)
  ?? 0
);

export async function summarizeReminderDbState() {
  const summary = { statusCounts: {}, resolvedReasonCounts: {}, conditionKeyPrefixCounts: {}, uniqueSourceTypes: [], recentTerminalReminders: [], totals: { reminders: 0 }, error: null };

  let reminders = [];
  try {
    reminders = await base44.entities.Reminder.list();
  } catch (error) {
    summary.error = error instanceof Error ? error.message : String(error);
    console.error('[ReminderDbSummary] failed to list reminders', error);
    return summary;
  }

  summary.totals.reminders = reminders.length;
  summary.statusCounts = countByField(reminders, (item) => item?.status);
  summary.resolvedReasonCounts = countByField(reminders, (item) => item?.resolved_reason);
  summary.conditionKeyPrefixCounts = countByConditionKeyPrefix(reminders);
  summary.uniqueSourceTypes = [...new Set(reminders.map((item) => item?.source_type).filter(Boolean))].sort();

  const terminalReminders = reminders
    .filter((item) => isTerminalReminderStatus(item?.status))
    .sort((left, right) => getTerminalReminderSortTime(right) - getTerminalReminderSortTime(left))
    .slice(0, 30)
    .map((item) => ({ title: item.title, status: item.status, condition_key: item.condition_key, source_type: item.source_type, source_id: item.source_id, resolved_reason: item.resolved_reason, resolved_at: item.resolved_at, updated_date: item.updated_date, action_url: item.action_url }));

  summary.recentTerminalReminders = terminalReminders;
  console.info('[ReminderDbSummary]', summary);
  return summary;
}

export async function analyzeReminderLifecycle() {
  const dbSummary = await summarizeReminderDbState();
  const report = { readOnly: true, dbSummary, duplicateConditionKeys: [], dateLikeConditionKeys: [], orphanRemindersBySource: [], counts: { orphanRemindersBySource: 0, duplicateConditionKeys: 0, dateLikeConditionKeys: 0 }, loaderStatus: {}, uniqueSourceTypes: dbSummary.uniqueSourceTypes || [] };

  if (dbSummary.error) { report.error = dbSummary.error; console.info('[ReminderLifecycleAnalysis]', report); return report; }

  let reminders = [];
  try {
    reminders = await base44.entities.Reminder.list();
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    console.info('[ReminderLifecycleAnalysis]', report);
    return report;
  }

  const byConditionKey = new Map();

  for (const reminder of reminders) {
    const conditionKey = reminder?.condition_key ? String(reminder.condition_key).trim() : '';
    if (!conditionKey) continue;

    if (DATE_LIKE_CONDITION_KEY_PATTERN.test(conditionKey)) {
      report.dateLikeConditionKeys.push({ condition_key: conditionKey, status: reminder.status, title: reminder.title });
    }

    if (!byConditionKey.has(conditionKey)) byConditionKey.set(conditionKey, []);
    byConditionKey.get(conditionKey).push(reminder);
  }

  report.counts.dateLikeConditionKeys = report.dateLikeConditionKeys.length;

  for (const [conditionKey, group] of byConditionKey.entries()) {
    const openGroup = group.filter((item) => isOpenReminderStatus(item?.status));
    if (openGroup.length <= 1) continue;

    report.duplicateConditionKeys.push({ condition_key: conditionKey, openCount: openGroup.length, count: group.length, statuses: group.map((item) => item.status), titles: group.map((item) => item.title), source_types: group.map((item) => item.source_type), source_ids: group.map((item) => item.source_id), next_remind_at: group.map((item) => item.next_remind_at), created_date: group.map((item) => item.created_date), updated_date: group.map((item) => item.updated_date), resolved_reason: group.map((item) => item.resolved_reason) });
  }

  report.counts.duplicateConditionKeys = report.duplicateConditionKeys.length;
  const { entityIdSets, loaderStatus } = await loadEntityIdSetsForOrphanCleanup();
  report.loaderStatus = loaderStatus;

  for (const reminder of reminders) {
    if (!isOpenReminderStatus(reminder?.status)) continue;
    if (!isOrphanOpenReminderBySource(reminder, entityIdSets, loaderStatus)) continue;
    report.orphanRemindersBySource.push({ title: reminder.title, condition_key: reminder.condition_key, source_type: reminder.source_type, source_id: reminder.source_id, status: reminder.status, action_url: reminder.action_url });
  }

  report.counts.orphanRemindersBySource = report.orphanRemindersBySource.length;
  console.info('[ReminderLifecycleAnalysis]', report);
  return report;
}

const ALLOWED_SCHEDULE_FIELDS = new Set(['frequency', 'next_remind_at', 'default_time']);
const VALID_REMINDER_FREQUENCIES = new Set(['immediate', 'daily', 'weekly', 'due_date_based', 'custom']);

const assertFutureScheduleDate = (value, fieldName) => {
  const timestamp = toTimestamp(value);
  if (timestamp === null) throw new Error(`${fieldName} must be a valid future date`);
  if (timestamp <= Date.now()) throw new Error(`${fieldName} must be in the future`);
};

export async function updateReminderSchedule(reminderId, schedulePatch) {
  assertReminderId(reminderId);
  if (!schedulePatch || typeof schedulePatch !== 'object') throw new Error('schedulePatch is required');

  const allowedPatch = {};

  for (const field of Object.keys(schedulePatch)) {
    if (!ALLOWED_SCHEDULE_FIELDS.has(field)) throw new Error(`Invalid schedule field: ${field}`);
  }

  if (schedulePatch.frequency !== undefined) {
    if (!VALID_REMINDER_FREQUENCIES.has(schedulePatch.frequency)) throw new Error(`Invalid frequency: ${schedulePatch.frequency}`);
    allowedPatch.frequency = schedulePatch.frequency;
  }

  if (schedulePatch.next_remind_at !== undefined) {
    assertFutureScheduleDate(schedulePatch.next_remind_at, 'next_remind_at');
    allowedPatch.next_remind_at = new Date(schedulePatch.next_remind_at).toISOString();
  }

  if (schedulePatch.default_time !== undefined) {
    allowedPatch.default_time = String(schedulePatch.default_time).trim();
  }

  if (Object.keys(allowedPatch).length === 0) throw new Error('schedulePatch must include at least one allowed field');

  return persistReminderUpdate(reminderId, allowedPatch);
}

export function getVisibleReminders(reminders, now = new Date()) {
  if (!Array.isArray(reminders)) return [];
  return reminders.map((reminder) => normalizeReminderState(reminder, now)).filter(Boolean).filter((reminder) => reminder.status === REMINDER_STATUS.ACTIVE);
}

const getDateKey = (value) => {
  if (!value) return null;
  const date = parseReminderDate(value);
  if (!date) return null;
  return date.toISOString().split('T')[0];
};

export function sortVisibleReminders(reminders, now = new Date()) {
  if (!Array.isArray(reminders)) return [];

  const todayKey = getDateKey(now);
  const nowTime = toTimestamp(now);

  const getSortBucket = (reminder) => {
    const nextTime = toTimestamp(reminder.next_remind_at);
    if (nextTime !== null) {
      if (nextTime < nowTime) return 0;
      if (getDateKey(reminder.next_remind_at) === todayKey) return 1;
      return 3;
    }
    return 2;
  };

  return [...reminders].sort((left, right) => {
    const bucketDiff = getSortBucket(left) - getSortBucket(right);
    if (bucketDiff !== 0) return bucketDiff;
    const leftActiveSince = toTimestamp(left.active_since) ?? 0;
    const rightActiveSince = toTimestamp(right.active_since) ?? 0;
    return leftActiveSince - rightActiveSince;
  });
}

export async function loadVisibleReminders(options = {}) {
  const now = options.now ?? new Date();
  let reminders = options.cache?.reminders;

  if (!reminders) reminders = await base44.entities.Reminder.list();

  const summary = await normalizeAndPersistExpiredSnoozes(reminders, now);

  if (summary.updated > 0) {
    reminders = await base44.entities.Reminder.list();
    if (options.cache) { options.cache.reminders = reminders; rebuildReminderConditionKeyIndex(options.cache); }
  } else if (options.cache) {
    options.cache.reminders = reminders;
  }

  const visible = getVisibleReminders(reminders, now);
  return sortVisibleReminders(visible, now);
}

export async function normalizeAndPersistExpiredSnoozes(reminders, now = new Date()) {
  if (!Array.isArray(reminders)) return emptyPersistSummary();

  const summary = { checked: reminders.length, expiredSnoozesFound: 0, updated: 0, errors: [] };

  for (const reminder of reminders) {
    if (!hasExpiredSnooze(reminder, now)) continue;
    summary.expiredSnoozesFound += 1;

    const reminderId = reminder?.id;
    if (!reminderId) { summary.errors.push({ reminderId: null, error: 'reminder id is required' }); continue; }

    try {
      await persistReminderUpdate(reminderId, ACTIVE_SNOOZE_CLEAR_PATCH);
      summary.updated += 1;
    } catch (error) {
      summary.errors.push({ reminderId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return summary;
}

export function getDefaultReminderSettings() {
  return { daily_reminder_time: DEFAULT_DAILY_REMINDER_TIME, daily_reminders_enabled: true };
}

const normalizeSettingsUserId = (userId) => (userId ? String(userId).trim() : '');
const isGlobalReminderSettings = (settings) => !normalizeSettingsUserId(settings?.user_id);
const matchesReminderSettingsUser = (settings, userId) => normalizeSettingsUserId(settings?.user_id) === normalizeSettingsUserId(userId);

const findReminderSettingsInList = (settingsList, userId) => {
  if (!Array.isArray(settingsList) || settingsList.length === 0) return null;
  const normalizedUserId = normalizeSettingsUserId(userId);
  if (normalizedUserId) return settingsList.find((settings) => matchesReminderSettingsUser(settings, normalizedUserId)) || null;
  return settingsList.find(isGlobalReminderSettings) || null;
};

export function getDailyReminderTime(settings) {
  const time = settings?.daily_reminder_time;
  return time ? String(time).trim() : DEFAULT_DAILY_REMINDER_TIME;
}

export function areDailyRemindersEnabled(settings) {
  return settings?.daily_reminders_enabled !== false;
}

export function isRateLimitError(error) {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;
  return status === 429 || message.includes('Rate limit');
}

export function createReminderEngineCache() {
  return { reminders: null, remindersByConditionKey: null, settings: null, settingsList: null };
}

const indexRemindersByConditionKey = (reminders) => {
  const map = new Map();
  for (const reminder of reminders || []) {
    const key = reminder?.condition_key ? String(reminder.condition_key).trim() : '';
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(reminder);
  }
  return map;
};

export function rebuildReminderConditionKeyIndex(cache) {
  if (!cache?.reminders) return;
  cache.remindersByConditionKey = indexRemindersByConditionKey(cache.reminders);
}

export function upsertReminderInCache(cache, reminder) {
  if (!cache?.reminders || !reminder?.id) return;
  const existingIndex = cache.reminders.findIndex((item) => item.id === reminder.id);
  if (existingIndex >= 0) { cache.reminders[existingIndex] = reminder; } else { cache.reminders.push(reminder); }
  rebuildReminderConditionKeyIndex(cache);
}

export async function loadReminderEngineCache(cache = null, options = {}) {
  const target = cache || createReminderEngineCache();
  if (target.reminders) return target;

  const [reminders, settingsList] = await Promise.all([
    base44.entities.Reminder.list(),
    base44.entities.ReminderSettings.list(),
  ]);

  target.reminders = reminders;
  target.settingsList = settingsList;
  target.settings = findReminderSettingsInList(settingsList, normalizeSettingsUserId(options.userId));
  rebuildReminderConditionKeyIndex(target);
  return target;
}

const hasBrowserStorage = () => (
  typeof globalThis !== 'undefined' && globalThis.localStorage && typeof globalThis.localStorage.getItem === 'function'
);

const readStorage = (key) => {
  if (!hasBrowserStorage()) return null;
  try { return globalThis.localStorage.getItem(key); } catch (_error) { return null; }
};

const writeStorage = (key, value) => {
  if (!hasBrowserStorage()) return;
  try { globalThis.localStorage.setItem(key, value); } catch (_error) {}
};

const removeStorage = (key) => {
  if (!hasBrowserStorage()) return;
  try { globalThis.localStorage.removeItem(key); } catch (_error) {}
};

const parseStorageTimestamp = (value) => {
  if (!value) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const nowMs = () => Date.now();

const conditionKeyStartsWith = (conditionKey, prefix) => String(conditionKey || '').startsWith(prefix);

const ensureEntityMap = async (cache, entityName) => {
  const key = `${entityName}ById`;
  const statusKey = `${entityName}LoadStatus`;

  if (cache[key]) return cache[key];
  if (cache[statusKey] === 'failed') return null;

  try {
    const entity = base44.entities[entityName];
    const items = entity && typeof entity.list === 'function' ? await entity.list() : [];
    const map = new Map((items || []).map((item) => [item.id, item]));
    cache[key] = map;
    cache[statusKey] = 'loaded';
    return map;
  } catch (error) {
    cache[statusKey] = 'failed';
    console.warn('[ReminderEngine] failed to load entity map', { entityName }, error);
    return null;
  }
};

export function findReminderByConditionKeyInCache(cache, conditionKey, now = new Date()) {
  const normalizedKey = conditionKey ? String(conditionKey).trim() : '';
  if (!normalizedKey || !cache?.remindersByConditionKey) return null;
  const reminders = cache.remindersByConditionKey.get(normalizedKey) || [];
  return pickPrimaryReminderForConditionKey(reminders, now);
}

export function hasOpenReminderForConditionKey(cache, conditionKey, now = new Date()) {
  const reminder = findReminderByConditionKeyInCache(cache, conditionKey, now);
  return Boolean(reminder && isOpenReminderStatus(reminder.status));
}

export async function getOrCreateReminderSettings(userId, options = {}) {
  const defaults = getDefaultReminderSettings();
  const normalizedUserId = normalizeSettingsUserId(userId);
  const cache = options.cache;

  if (cache?.settings) return cache.settings;

  const settingsList = cache?.settingsList ?? await base44.entities.ReminderSettings.list();
  if (cache && !cache.settingsList) cache.settingsList = settingsList;

  const existing = findReminderSettingsInList(settingsList, normalizedUserId);
  if (existing) { if (cache) cache.settings = existing; return existing; }

  const created = await base44.entities.ReminderSettings.create({ ...defaults, user_id: normalizedUserId });
  if (cache) { cache.settings = created; if (cache.settingsList) cache.settingsList.push(created); }
  return created;
}

const REQUIRED_REMINDER_INPUT_FIELDS = ['title', 'client_name', 'source_type', 'source_id', 'condition_key', 'action_url'];
const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';

function validateReminderInput(input) {
  if (!input || typeof input !== 'object') throw new Error('reminder input is required');
  for (const field of REQUIRED_REMINDER_INPUT_FIELDS) {
    if (!hasValue(input[field])) throw new Error(`${field} is required`);
  }
  if (hasValue(input.project_id) && !hasValue(input.project_name)) throw new Error('project_name is required when project_id exists');
}

const parseDailyReminderTimeParts = (timeValue) => {
  const [hoursPart, minutesPart] = String(timeValue || DEFAULT_DAILY_REMINDER_TIME).split(':');
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  return { hours: Number.isFinite(hours) ? hours : 7, minutes: Number.isFinite(minutes) ? minutes : 0 };
};

function computeNextReminderAt(params = {}) {
  const { frequency = 'daily', immediate = false, settings = null, now = new Date(), nextRemindAt } = params;
  if (immediate) return now.toISOString();

  if (frequency === 'daily') {
    const dailyTime = getDailyReminderTime(settings);
    const { hours, minutes } = parseDailyReminderTimeParts(dailyTime);
    const candidate = new Date(now);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1);
    return candidate.toISOString();
  }

  if (frequency === 'weekly') {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + 7);
    return candidate.toISOString();
  }

  if (frequency === 'due_date_based' || frequency === 'custom') {
    return hasValue(nextRemindAt) ? String(nextRemindAt).trim() : now.toISOString();
  }

  return now.toISOString();
}

const buildReminderContentPatch = (input) => ({
  title: input.title,
  description: input.description || '',
  client_name: input.client_name,
  client_id: input.client_id || '',
  project_name: input.project_name || '',
  project_id: input.project_id || '',
  assigned_to_user_id: input.assigned_to_user_id || '',
  assigned_to_name: input.assigned_to_name || '',
  source_type: input.source_type,
  source_id: input.source_id,
  action_url: input.action_url,
  action_label: input.action_label || 'פתח',
  frequency: input.frequency || 'daily',
});

const REMINDER_CONTENT_PATCH_FIELDS = Object.keys(buildReminderContentPatch({}));

const isSameReminderContent = (existing, input) => {
  const patch = buildReminderContentPatch(input);
  return REMINDER_CONTENT_PATCH_FIELDS.every((field) => String(existing?.[field] ?? '') === String(patch[field] ?? ''));
};

export async function findRemindersByConditionKey(conditionKey, options = {}) {
  const normalizedKey = conditionKey ? String(conditionKey).trim() : '';
  if (!normalizedKey) throw new Error('conditionKey is required');

  if (options.cache?.remindersByConditionKey) return options.cache.remindersByConditionKey.get(normalizedKey) || [];

  const reminders = await base44.entities.Reminder.list();
  return reminders.filter((reminder) => reminder.condition_key === normalizedKey);
}

export async function findReminderByConditionKey(conditionKey, options = {}) {
  const now = options.now ?? new Date();
  const reminders = await findRemindersByConditionKey(conditionKey, options);
  return pickPrimaryReminderForConditionKey(reminders, now);
}

export async function upsertReminder(input, options = {}) {
  validateReminderInput(input);

  const now = new Date();
  const timestamp = now.toISOString();
  const settings = await getOrCreateReminderSettings(options.userId, options);
  const frequency = input.frequency || 'daily';
  const existing = await findReminderByConditionKey(input.condition_key, options);

  const nextRemindAt = input.next_remind_at || computeNextReminderAt({
    frequency, immediate: options.immediate === true, settings, now, nextRemindAt: input.next_remind_at,
  });

  if (!existing) {
    const createdReminder = await base44.entities.Reminder.create({
      ...buildReminderContentPatch(input),
      condition_key: input.condition_key,
      status: REMINDER_STATUS.ACTIVE,
      default_time: getDailyReminderTime(settings),
      next_remind_at: nextRemindAt,
      active_since: timestamp,
      is_snoozed: false,
      snoozed_until: '',
      reactivation_count: 0,
      future_email_enabled: false,
    });
    upsertReminderInCache(options.cache, createdReminder);
    return { action: 'created', reminder: createdReminder };
  }

  if (existing.status === REMINDER_STATUS.CANCELLED || existing.status === REMINDER_STATUS.RESOLVED) {
    await reactivateReminder(existing);
    const reactivatedReminder = await persistReminderUpdate(existing.id, { ...buildReminderContentPatch(input), next_remind_at: nextRemindAt });
    upsertReminderInCache(options.cache, reactivatedReminder);
    return { action: 'reactivated', reminder: reactivatedReminder };
  }

  if (isSameReminderContent(existing, input) && String(existing.next_remind_at || '') === String(nextRemindAt || '')) {
    return { action: 'unchanged', reminder: existing };
  }

  const updatedReminder = await persistReminderUpdate(existing.id, { ...buildReminderContentPatch(input), next_remind_at: nextRemindAt });
  upsertReminderInCache(options.cache, updatedReminder);
  return { action: 'updated', reminder: updatedReminder };
}

export async function resolveReminderByConditionKey(conditionKey, reason, options = {}) {
  const existing = await findReminderByConditionKey(conditionKey, options);
  if (!existing) return { action: 'not_found' };
  if (existing.status === REMINDER_STATUS.RESOLVED) return { action: 'already_resolved', reminder: existing };
  if (existing.status === REMINDER_STATUS.CANCELLED) return { action: 'skipped_cancelled', reminder: existing };

  const resolvedReminder = await resolveReminder(existing.id, reason || 'condition_cleared');
  upsertReminderInCache(options.cache, resolvedReminder);
  return { action: 'resolved', reminder: resolvedReminder };
}

export async function ensureReminderForCondition(conditionIsTrue, reminderInput, options = {}) {
  if (conditionIsTrue === true) return upsertReminder(reminderInput, options);

  const conditionKey = reminderInput?.condition_key;

  if (options.cache?.remindersByConditionKey && conditionKey) {
    const existing = findReminderByConditionKeyInCache(options.cache, conditionKey);
    if (!existing || isTerminalReminderStatus(existing.status)) return { action: 'not_found' };
  }

  return resolveReminderByConditionKey(conditionKey, 'condition_cleared', options);
}

const toTrimmedValue = (value) => String(value || '').trim();
const normalizeReminderValue = (value) => String(value || '').trim().toLowerCase();

const isSignedProposalRecord = (signedProposal) => isValidSignedProposal(signedProposal);

const hasSignedProposalForProjectRecord = (project, signedProposals = []) => (
  signedProposals.some((signedProposal) => {
    if (!isSignedProposalRecord(signedProposal)) return false;
    if (signedProposal.form_status === 'cancelled') return false;

    const sameProjectId = (
      toTrimmedValue(signedProposal.project_id)
      && toTrimmedValue(project?.id)
      && toTrimmedValue(signedProposal.project_id) === toTrimmedValue(project?.id)
    );

    const sameClientAndProjectName = (
      toTrimmedValue(signedProposal.client_id)
      && toTrimmedValue(project?.client_id)
      && toTrimmedValue(signedProposal.client_id) === toTrimmedValue(project?.client_id)
      && normalizeReminderValue(signedProposal.project_name) === normalizeReminderValue(project?.name || project?.project_name)
    );

    return sameProjectId || sameClientAndProjectName;
  })
);

const evaluateReminderBusinessValidity = async (reminder, cache) => {
  const conditionKey = toTrimmedValue(reminder?.condition_key);
  const sourceType = toTrimmedValue(reminder?.source_type);
  const sourceId = toTrimmedValue(reminder?.source_id);

  if (!conditionKey || !sourceType || !sourceId) return { valid: true, reason: 'missing_fields_skip' };

  if (conditionKeyStartsWith(conditionKey, REMINDER_PREFIXES.P0)) {
    const proposalsById = await ensureEntityMap(cache, 'Proposal');
    if (!proposalsById) return { valid: true, reason: 'proposal_loader_failed' };
    const proposal = proposalsById.get(sourceId);
    if (!proposal) return { valid: false, reason: 'source_deleted' };
    const signedProposalsById = await ensureEntityMap(cache, 'SignedProposal');
    const signedProposals = signedProposalsById ? [...signedProposalsById.values()] : [];
    const hasSignedProposal = hasSignedProposalForProjectRecord({
      id: proposal.project_id,
      client_id: proposal.client_id,
      name: proposal.project_name,
    }, signedProposals);

    const invalid = proposal.form_status === 'submitted' || proposal.form_status === 'cancelled' || hasSignedProposal;
    return { valid: !invalid, reason: invalid ? 'condition_cleared' : 'valid' };
  }

  if (conditionKeyStartsWith(conditionKey, REMINDER_PREFIXES.P3)) {
    const proposalsById = await ensureEntityMap(cache, 'Proposal');
    if (!proposalsById) return { valid: true, reason: 'proposal_loader_failed' };
    const proposal = proposalsById.get(sourceId);
    if (!proposal) return { valid: false, reason: 'source_deleted' };
    const signedProposalsById = await ensureEntityMap(cache, 'SignedProposal');
    const signedProposals = signedProposalsById ? [...signedProposalsById.values()] : [];
    const hasSignedProposal = hasSignedProposalForProjectRecord({
      id: proposal.project_id,
      client_id: proposal.client_id,
      name: proposal.project_name,
    }, signedProposals);
    const invalid = proposal.proposal_sent_to_client === true || hasSignedProposal;
    return { valid: !invalid, reason: invalid ? 'condition_cleared' : 'valid' };
  }

  if (conditionKeyStartsWith(conditionKey, REMINDER_PREFIXES.P4)) {
    const proposalsById = await ensureEntityMap(cache, 'Proposal');
    if (!proposalsById) return { valid: true, reason: 'proposal_loader_failed' };
    const proposal = proposalsById.get(sourceId);
    if (!proposal) return { valid: false, reason: 'source_deleted' };
    const signedProposalsById = await ensureEntityMap(cache, 'SignedProposal');
    const signedProposals = signedProposalsById ? [...signedProposalsById.values()] : [];
    const hasSignedProposal = hasSignedProposalForProjectRecord({
      id: proposal.project_id,
      client_id: proposal.client_id,
      name: proposal.project_name,
    }, signedProposals);
    const invalid = proposal.client_saw_proposal === true || hasSignedProposal;
    return { valid: !invalid, reason: invalid ? 'condition_cleared' : 'valid' };
  }

  if (conditionKeyStartsWith(conditionKey, REMINDER_PREFIXES.SP1)) {
    const proposalsById = await ensureEntityMap(cache, 'Proposal');
    if (!proposalsById) return { valid: true, reason: 'proposal_loader_failed' };
    const proposal = proposalsById.get(sourceId);
    if (!proposal) return { valid: false, reason: 'source_deleted' };

    if (proposal.form_status !== 'submitted' || proposal.form_status === 'cancelled' || proposal.proposal_sent_to_client !== true || !toTrimmedValue(proposal.project_id)) {
      return { valid: false, reason: 'condition_cleared' };
    }

    const signedProposalsById = await ensureEntityMap(cache, 'SignedProposal');
    if (!signedProposalsById) return { valid: true, reason: 'signed_proposal_loader_failed' };

    const hasSignedProposal = [...signedProposalsById.values()].some((signedProposal) => {
      if (!isValidSignedProposal(signedProposal)) return false;
      if (toTrimmedValue(signedProposal.proposal_id) === proposal.id) return true;
      return toTrimmedValue(signedProposal.project_id) === toTrimmedValue(proposal.project_id);
    });

    return { valid: !hasSignedProposal, reason: hasSignedProposal ? 'condition_cleared' : 'valid' };
  }

  if (conditionKeyStartsWith(conditionKey, REMINDER_PREFIXES.R7)) {
    const signedProposalsById = await ensureEntityMap(cache, 'SignedProposal');
    if (!signedProposalsById) return { valid: true, reason: 'signed_proposal_loader_failed' };
    const signedProposal = signedProposalsById.get(sourceId);
    if (!signedProposal) return { valid: false, reason: 'source_deleted' };
    if (!isValidSignedProposal(signedProposal)) return { valid: false, reason: 'condition_cleared' };

    const workStagesById = await ensureEntityMap(cache, 'WorkStage');
    const workStages = workStagesById ? [...workStagesById.values()] : [];
    const hasWorkStages = hasNonCancelledWorkStageForProject(signedProposal.project_id, workStages);
    return { valid: !hasWorkStages, reason: hasWorkStages ? 'condition_cleared' : 'valid' };
  }

  // P2: פרויקט צריך הצעת מחיר — מאמת גם שאין SignedProposal
  if (conditionKeyStartsWith(conditionKey, REMINDER_PREFIXES.P2)) {
    return evaluateP2ReminderValidity(sourceId, cache);
  }

  if (conditionKeyStartsWith(conditionKey, REMINDER_PREFIXES.R4)) {
    const clientsById = await ensureEntityMap(cache, 'Client');
    if (!clientsById) return { valid: true, reason: 'client_loader_failed' };
    const client = clientsById.get(sourceId);
    if (!client) return { valid: false, reason: 'source_deleted' };
    const projectsById = await ensureEntityMap(cache, 'Project');
    if (!projectsById) return { valid: true, reason: 'project_loader_failed' };
    const hasProject = [...projectsById.values()].some((project) => project.client_id === client.id);
    return { valid: !hasProject, reason: hasProject ? 'condition_cleared' : 'valid' };
  }

  if (conditionKeyStartsWith(conditionKey, REMINDER_PREFIXES.R1)) {
    const inquiriesById = await ensureEntityMap(cache, 'Inquiry');
    if (!inquiriesById) return { valid: true, reason: 'inquiry_loader_failed' };
    const inquiry = inquiriesById.get(sourceId);
    if (!inquiry) return { valid: false, reason: 'source_deleted' };
    const clientName = toTrimmedValue(inquiry.client_name);
    const detailsMissing = !toTrimmedValue(inquiry.details);
    const invalid = !clientName || inquiry.form_status === 'submitted' || inquiry.form_status === 'cancelled' || !detailsMissing;
    return { valid: !invalid, reason: invalid ? 'condition_cleared' : 'valid' };
  }

  if (conditionKeyStartsWith(conditionKey, REMINDER_PREFIXES.R2)) {
    const inquiriesById = await ensureEntityMap(cache, 'Inquiry');
    if (!inquiriesById) return { valid: true, reason: 'inquiry_loader_failed' };
    const inquiry = inquiriesById.get(sourceId);
    if (!inquiry) return { valid: false, reason: 'source_deleted' };
    const clientName = toTrimmedValue(inquiry.client_name);
    if (!clientName || inquiry.form_status !== 'submitted') return { valid: false, reason: 'condition_cleared' };
    const clientsById = await ensureEntityMap(cache, 'Client');
    const projectsById = await ensureEntityMap(cache, 'Project');
    if (!clientsById || !projectsById) return { valid: true, reason: 'related_loader_failed' };
    const hasClient = [...clientsById.values()].some((client) => client.source_inquiry_id === inquiry.id);
    const hasProject = [...projectsById.values()].some((project) => project.source_inquiry_id === inquiry.id);
    return { valid: !(hasClient && hasProject), reason: hasClient && hasProject ? 'condition_cleared' : 'valid' };
  }

  if (conditionKeyStartsWith(conditionKey, REMINDER_PREFIXES.P1)) {
    const inquiriesById = await ensureEntityMap(cache, 'Inquiry');
    if (!inquiriesById) return { valid: true, reason: 'inquiry_loader_failed' };
    const inquiry = inquiriesById.get(sourceId);
    if (!inquiry) return { valid: false, reason: 'source_deleted' };
    if (inquiry.form_status !== 'submitted' || inquiry.form_status === 'cancelled' || inquiry.status === 'cancelled' || !toTrimmedValue(inquiry.client_name)) {
      return { valid: false, reason: 'condition_cleared' };
    }
    const proposalsById = await ensureEntityMap(cache, 'Proposal');
    if (!proposalsById) return { valid: true, reason: 'proposal_loader_failed' };
    const hasProposal = [...proposalsById.values()].some((proposal) => proposal.source_inquiry_id === inquiry.id && proposal.form_status !== 'cancelled');
    return { valid: !hasProposal, reason: hasProposal ? 'condition_cleared' : 'valid' };
  }

  return { valid: true, reason: 'unsupported_condition_key' };
};

export async function validateVisibleReminders(reminders, options = {}) {
  const summary = { checked: 0, hiddenInvalid: 0, closed: 0, errors: [], hasMutations: false };

  if (!Array.isArray(reminders) || reminders.length === 0) return { ...summary, visible: [] };

  const cache = options.cache || {};
  const visible = [];

  for (const reminder of reminders) {
    summary.checked += 1;
    try {
      const verdict = await evaluateReminderBusinessValidity(reminder, cache);
      if (verdict.valid) { visible.push(reminder); continue; }
      summary.hiddenInvalid += 1;
      if (!reminder?.id || options.applyMutations !== true) continue;
      const resolvedReason = verdict.reason === 'source_deleted' ? 'source_deleted' : 'condition_cleared';
      await cancelReminder(reminder.id, resolvedReason);
      summary.closed += 1;
      summary.hasMutations = true;
    } catch (error) {
      summary.errors.push({ reminderId: reminder?.id || null, error: error instanceof Error ? error.message : String(error) });
      visible.push(reminder);
      console.warn('[ReminderEngine] validateVisibleReminders skipped reminder on error', { reminderId: reminder?.id, condition_key: reminder?.condition_key }, error);
    }
  }

  return { ...summary, visible };
}

let reminderReconciliationPromise = null;

const getLockPayload = () => {
  const raw = readStorage(RECONCILIATION_STORAGE_KEYS.LOCK);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_error) { return null; }
};

const isLockActive = (payload, now = nowMs()) => {
  if (!payload?.startedAt) return false;
  return now - payload.startedAt < RECONCILIATION_STALE_LOCK_MS;
};

const acquireReconciliationLock = (reason) => {
  const now = nowMs();
  const current = getLockPayload();
  if (current && isLockActive(current, now)) return false;
  writeStorage(RECONCILIATION_STORAGE_KEYS.LOCK, JSON.stringify({ startedAt: now, reason }));
  return true;
};

const releaseReconciliationLock = () => removeStorage(RECONCILIATION_STORAGE_KEYS.LOCK);

const shouldSkipReconciliationByCooldown = (now = nowMs()) => {
  const lastRunAt = parseStorageTimestamp(readStorage(RECONCILIATION_STORAGE_KEYS.LAST_RUN_AT));
  const lastErrorAt = parseStorageTimestamp(readStorage(RECONCILIATION_STORAGE_KEYS.LAST_ERROR_AT));
  const lastErrorType = readStorage(RECONCILIATION_STORAGE_KEYS.LAST_ERROR_TYPE);
  const hasMore = readStorage(RECONCILIATION_STORAGE_KEYS.HAS_MORE) === '1';

  if (lastErrorType === 'rate_limit' && lastErrorAt && now - lastErrorAt < RECONCILIATION_RATE_LIMIT_COOLDOWN_MS) return true;
  if (hasMore && lastRunAt && now - lastRunAt < RECONCILIATION_HAS_MORE_COOLDOWN_MS) return true;
  if (lastRunAt && now - lastRunAt < RECONCILIATION_COOLDOWN_MS) return true;
  return false;
};

const countMutationsFromSummary = (result) => {
  if (!result || typeof result !== 'object') return 0;
  return Number(result.cancelled || 0) + Number(result.cancelledDuplicates || 0);
};

export async function runReminderReconciliationNow(reason = 'manual') {
  const result = { reason, startedAt: nowIso(), skipped: false, skipReason: null, mutationCount: 0, maxMutationsPerRun: RECONCILIATION_MAX_MUTATIONS_PER_RUN, hasMore: false, errors: [] };

  if (!acquireReconciliationLock(reason)) { result.skipped = true; result.skipReason = 'lock_active'; return result; }

  const cache = {};

  try {
    await loadReminderEngineCache(cache);
    await Promise.all([
      ensureEntityMap(cache, 'Inquiry'),
      ensureEntityMap(cache, 'Client'),
      ensureEntityMap(cache, 'Project'),
      ensureEntityMap(cache, 'Proposal'),
      ensureEntityMap(cache, 'SignedProposal'),
      ensureEntityMap(cache, 'WorkStage'),
    ]);

    const inquiriesById = cache.InquiryById;
    const proposalsById = cache.ProposalById;
    const signedProposalsById = cache.SignedProposalById;
    cache.signedProposals = signedProposalsById ? [...signedProposalsById.values()] : [];
    const remainingBeforeP1 = Math.max(RECONCILIATION_MAX_MUTATIONS_PER_RUN - result.mutationCount, 0);

    if (remainingBeforeP1 > 0 && inquiriesById && proposalsById) {
      const { runProposalReminderRulesForInquiries } = await import('@/lib/proposalReminderRules');
      const p1Summary = await runProposalReminderRulesForInquiries([...inquiriesById.values()], [...proposalsById.values()], { cache, maxMutations: remainingBeforeP1 });
      result.mutationCount += Number(p1Summary.mutationCount || 0);
      if (p1Summary.hasMore || p1Summary.rateLimited || result.mutationCount >= RECONCILIATION_MAX_MUTATIONS_PER_RUN) { result.hasMore = true; return result; }
    }

    if (proposalsById && result.mutationCount < RECONCILIATION_MAX_MUTATIONS_PER_RUN) {
      const { runSignedProposalNeedReminderRuleForProposal } = await import('@/lib/proposalReminderRules');
      for (const proposal of proposalsById.values()) {
        if (result.mutationCount >= RECONCILIATION_MAX_MUTATIONS_PER_RUN) { result.hasMore = true; break; }
        const verdict = await runSignedProposalNeedReminderRuleForProposal(proposal, cache);
        if (verdict?.action === 'created' || verdict?.action === 'updated' || verdict?.action === 'resolved') result.mutationCount += 1;
      }
    }

    const remainingBeforeR7 = Math.max(RECONCILIATION_MAX_MUTATIONS_PER_RUN - result.mutationCount, 0);
    if (remainingBeforeR7 > 0 && signedProposalsById) {
      const { runWorkStageReminderRulesForAll } = await import('@/lib/workStageReminderRules');
      const r7Summary = await runWorkStageReminderRulesForAll(cache, { maxMutations: remainingBeforeR7 });
      result.mutationCount += Number(r7Summary.mutationCount || 0);
      if (r7Summary.hasMore || r7Summary.rateLimited || result.mutationCount >= RECONCILIATION_MAX_MUTATIONS_PER_RUN) {
        result.hasMore = true;
        if (result.mutationCount >= RECONCILIATION_MAX_MUTATIONS_PER_RUN) return result;
      }
    }

    const openReminders = (cache.reminders || []).filter((reminder) => isOpenReminderStatus(reminder?.status));

    for (const reminder of openReminders) {
      if (result.mutationCount >= RECONCILIATION_MAX_MUTATIONS_PER_RUN) { result.hasMore = true; break; }
      const verdict = await evaluateReminderBusinessValidity(reminder, cache);
      if (verdict.valid) continue;
      await cancelReminder(reminder.id, verdict.reason === 'source_deleted' ? 'source_deleted' : 'condition_cleared');
      result.mutationCount += 1;
    }

    if (result.hasMore) return result;

    const orphanResult = await cleanupOrphanReminders({ dryRun: false, cache, maxMutations: Math.max(RECONCILIATION_MAX_MUTATIONS_PER_RUN - result.mutationCount, 0) });
    result.mutationCount += countMutationsFromSummary(orphanResult);
    if (orphanResult.hasMore || result.mutationCount >= RECONCILIATION_MAX_MUTATIONS_PER_RUN) { result.hasMore = true; return result; }

    await loadReminderEngineCache(cache);
    const remainingBudget = Math.max(RECONCILIATION_MAX_MUTATIONS_PER_RUN - result.mutationCount, 0);
    const duplicateResult = await cleanupDuplicateConditionKeyReminders({ dryRun: false, cache, maxMutations: remainingBudget });
    result.mutationCount += countMutationsFromSummary(duplicateResult);
    if (duplicateResult.hasMore || result.mutationCount >= RECONCILIATION_MAX_MUTATIONS_PER_RUN) { result.hasMore = true; return result; }
  } catch (error) {
    const errorType = isRateLimitError(error) ? 'rate_limit' : 'unknown';
    writeStorage(RECONCILIATION_STORAGE_KEYS.LAST_ERROR_AT, String(nowMs()));
    writeStorage(RECONCILIATION_STORAGE_KEYS.LAST_ERROR_TYPE, errorType);
    result.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    writeStorage(RECONCILIATION_STORAGE_KEYS.LAST_RUN_AT, String(nowMs()));
    writeStorage(RECONCILIATION_STORAGE_KEYS.HAS_MORE, result.hasMore ? '1' : '0');
    releaseReconciliationLock();
  }

  return result;
}

export function runReminderReconciliationInBackground(reason = 'dashboard_load') {
  const now = nowMs();

  if (isReminderIntegrationTestRunning()) {
    return Promise.resolve({ skipped: true, skipReason: 'integration_test_running' });
  }

  if (reminderReconciliationPromise) return reminderReconciliationPromise;
  if (shouldSkipReconciliationByCooldown(now)) return Promise.resolve({ skipped: true, skipReason: 'cooldown' });

  reminderReconciliationPromise = new Promise((resolve) => {
    const runner = async () => {
      try {
        const result = await runReminderReconciliationNow(reason);
        resolve(result);
      } finally {
        reminderReconciliationPromise = null;
      }
    };

    if (typeof globalThis !== 'undefined' && typeof globalThis.requestIdleCallback === 'function') {
      globalThis.requestIdleCallback(() => { void runner(); }, { timeout: 1500 });
      return;
    }

    setTimeout(() => { void runner(); }, 0);
  });

  return reminderReconciliationPromise;
}

export async function inspectReminderByTitle(title) {
  const normalizedTitle = toTrimmedValue(title);
  if (!normalizedTitle) return null;

  const reminders = await base44.entities.Reminder.list();
  const reminder = reminders.find((item) => toTrimmedValue(item.title) === normalizedTitle);
  if (!reminder) return null;

  const result = { title: reminder.title, condition_key: reminder.condition_key, source_type: reminder.source_type, source_id: reminder.source_id, status: reminder.status, action_url: reminder.action_url, stale: null, reason: null };

  if (reminder.source_type === 'proposal' && reminder.source_id) {
    const proposals = await base44.entities.Proposal.filter({ id: reminder.source_id });
    const proposal = proposals?.[0] || null;
    if (proposal) {
      const verdict = await evaluateReminderBusinessValidity(reminder, {});
      result.stale = verdict.valid === false;
      result.reason = verdict.reason;
      result.proposal = { id: proposal.id, form_status: proposal.form_status, proposal_sent_to_client: proposal.proposal_sent_to_client, client_saw_proposal: proposal.client_saw_proposal };
    }
  }

  return result;
}

const buildFoundationTestInput = (conditionKey) => ({
  title: 'בדיקת Foundation תזכורות', description: 'בדיקת מנוע תזכורות מלאה', client_name: 'לקוח בדיקה', project_name: 'פרויקט בדיקה', source_type: 'debug', source_id: 'foundation-test', condition_key: conditionKey, action_url: '/Projects', action_label: 'פתח פרויקטים', frequency: 'daily',
});

export async function debugReminderFoundationTest() {
  const timestamp = Date.now();
  const conditionKey = `debug:foundation:${timestamp}`;
  const input = buildFoundationTestInput(conditionKey);
  const steps = [];
  const errors = [];
  let passed = true;
  let settingsOk = false;
  let reminder = null;

  const recordStep = (name, stepPassed, extra = {}) => { steps.push({ name, passed: stepPassed, ...extra }); if (!stepPassed) passed = false; };
  const recordError = (stepName, error) => { const message = error instanceof Error ? error.message : String(error); errors.push({ step: stepName, error: message }); console.error('[ReminderFoundationTest]', stepName, error); };
  const reloadReminder = async () => findReminderByConditionKey(conditionKey);
  const countDuplicates = async () => { const reminders = await base44.entities.Reminder.list(); return reminders.filter((item) => item.condition_key === conditionKey).length; };

  try {
    const settings = await getOrCreateReminderSettings();
    const dailyTime = getDailyReminderTime(settings);
    settingsOk = Boolean(dailyTime) && areDailyRemindersEnabled(settings);
    recordStep('settings', settingsOk, { settingsOk, daily_reminder_time: dailyTime, daily_reminders_enabled: settings?.daily_reminders_enabled });
  } catch (error) { recordStep('settings', false, { settingsOk: false }); recordError('settings', error); }

  try {
    const created = await upsertReminder(input, { immediate: true });
    reminder = created.reminder;
    recordStep('created', created.action === 'created' && reminder?.status === REMINDER_STATUS.ACTIVE, { action: created.action, status: reminder?.status });
  } catch (error) { recordStep('created', false); recordError('created', error); }

  try {
    const updated = await upsertReminder(input, { immediate: true });
    reminder = updated.reminder || reminder;
    const duplicateCount = await countDuplicates();
    recordStep('duplicate_prevention', updated.action === 'updated' && duplicateCount === 1, { action: updated.action, duplicateCount });
  } catch (error) { recordStep('duplicate_prevention', false); recordError('duplicate_prevention', error); }

  try {
    const resolved = await resolveReminderByConditionKey(conditionKey);
    reminder = resolved.reminder || await reloadReminder();
    recordStep('resolved', resolved.action === 'resolved' && reminder?.status === REMINDER_STATUS.RESOLVED, { action: resolved.action, status: reminder?.status });
  } catch (error) { recordStep('resolved', false); recordError('resolved', error); }

  try {
    const reactivated = await upsertReminder(input, { immediate: true });
    reminder = reactivated.reminder;
    recordStep('reactivated', reactivated.action === 'reactivated' && reminder?.status === REMINDER_STATUS.ACTIVE && Number(reminder?.reactivation_count) >= 1, { action: reactivated.action, status: reminder?.status, reactivation_count: reminder?.reactivation_count });
  } catch (error) { recordStep('reactivated', false); recordError('reactivated', error); }

  try {
    if (!reminder?.id) throw new Error('reminder id is missing');
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await snoozeReminder(reminder.id, futureIso);
    reminder = await reloadReminder();
    const snoozeTime = toTimestamp(reminder?.snoozed_until);
    recordStep('snoozed', reminder?.status === REMINDER_STATUS.SNOOZED && reminder?.is_snoozed === true && snoozeTime !== null && snoozeTime > Date.now(), { status: reminder?.status, is_snoozed: reminder?.is_snoozed, snoozed_until: reminder?.snoozed_until });
  } catch (error) { recordStep('snoozed', false); recordError('snoozed', error); }

  try {
    const reminders = await base44.entities.Reminder.list();
    const visible = getVisibleReminders(reminders);
    recordStep('hidden_while_snoozed', !visible.some((item) => item.condition_key === conditionKey), { visibleCount: visible.length });
  } catch (error) { recordStep('hidden_while_snoozed', false); recordError('hidden_while_snoozed', error); }

  try {
    if (!reminder?.id) throw new Error('reminder id is missing');
    const expiredSnoozedUntil = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await base44.entities.Reminder.update(reminder.id, { status: REMINDER_STATUS.SNOOZED, is_snoozed: true, snoozed_until: expiredSnoozedUntil });
    const remindersBefore = await base44.entities.Reminder.list();
    const summary = await normalizeAndPersistExpiredSnoozes(remindersBefore);
    reminder = await reloadReminder();
    recordStep('expired_snooze_reactivated', summary.updated >= 1 && reminder?.status === REMINDER_STATUS.ACTIVE && reminder?.is_snoozed === false && !reminder?.snoozed_until, { updated: summary.updated, status: reminder?.status, is_snoozed: reminder?.is_snoozed, snoozed_until: reminder?.snoozed_until });
  } catch (error) { recordStep('expired_snooze_reactivated', false); recordError('expired_snooze_reactivated', error); }

  try {
    if (!reminder?.id) throw new Error('reminder id is missing');
    const futureNextRemindAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await updateReminderSchedule(reminder.id, { frequency: 'weekly', next_remind_at: futureNextRemindAt });
    reminder = await reloadReminder();
    let invalidRejected = false;
    try { await updateReminderSchedule(reminder.id, { condition_key: 'bad' }); } catch (invalidError) { invalidRejected = String(invalidError?.message || '').includes('Invalid schedule field'); }
    recordStep('schedule_update', reminder?.frequency === 'weekly' && Boolean(reminder?.next_remind_at) && invalidRejected, { frequency: reminder?.frequency, next_remind_at: reminder?.next_remind_at, invalidRejected, scheduleTestSkipped: false });
  } catch (error) { recordStep('schedule_update', false, { scheduleTestSkipped: false }); recordError('schedule_update', error); }

  try {
    if (!reminder?.id) throw new Error('reminder id is missing');
    await cancelReminder(reminder.id, 'foundation_test_done');
    const skipped = await upsertReminder(input, { immediate: true });
    reminder = skipped.reminder || await reloadReminder();
    recordStep('cancelled_skip', skipped.action === 'skipped_cancelled' && reminder?.status === REMINDER_STATUS.CANCELLED, { action: skipped.action, status: reminder?.status });
  } catch (error) { recordStep('cancelled_skip', false); recordError('cancelled_skip', error); }

  return { passed, conditionKey, settingsOk, steps, errors };
}

/** @deprecated Use debugReminderFoundationTest */
export async function debugReminderUpsertSanityCheck() {
  return debugReminderFoundationTest();
}