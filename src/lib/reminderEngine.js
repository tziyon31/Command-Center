import { base44 } from '@/api/base44Client';

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

const isTerminalReminderStatus = (status) =>
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

const INQUIRY_REMINDER_CONDITION_PREFIXES = [
  'inquiry_missing_fields:',
  'inquiry_needs_next_step:',
];

const emptyCancelRemindersSummary = () => ({
  checked: 0,
  matched: 0,
  cancelled: 0,
  skipped: 0,
  errors: 0,
});

const getInquiryIdFromConditionKey = (conditionKey) => {
  if (!conditionKey) return null;

  for (const prefix of INQUIRY_REMINDER_CONDITION_PREFIXES) {
    if (conditionKey.startsWith(prefix)) {
      return conditionKey.slice(prefix.length);
    }
  }

  return null;
};

const matchesDeletedSource = (reminder, sourceType, sourceId) => {
  if (reminder?.source_type === sourceType && reminder?.source_id === sourceId) {
    return true;
  }

  if (sourceType !== 'inquiry') {
    return false;
  }

  const inquiryIdFromKey = getInquiryIdFromConditionKey(reminder?.condition_key);
  return inquiryIdFromKey === sourceId;
};

/**
 * Cancels all non-cancelled reminders linked to a deleted source (soft cancel, not hard delete).
 */
export async function cancelRemindersForDeletedSource(sourceType, sourceId) {
  if (!sourceType || !sourceId) {
    return {
      ...emptyCancelRemindersSummary(),
      status: 'skipped',
      reason: 'missing_source',
    };
  }

  const summary = emptyCancelRemindersSummary();

  let reminders = [];

  try {
    reminders = await base44.entities.Reminder.list();
  } catch (error) {
    summary.errors += 1;
    throw error;
  }

  summary.checked = reminders.length;

  const matched = reminders.filter((reminder) => (
    matchesDeletedSource(reminder, sourceType, sourceId)
  ));

  summary.matched = matched.length;

  for (const reminder of matched) {
    if (reminder.status === REMINDER_STATUS.CANCELLED) {
      summary.skipped += 1;
      continue;
    }

    if (!reminder?.id) {
      summary.errors += 1;
      continue;
    }

    try {
      await cancelReminder(reminder.id, 'source_deleted');
      summary.cancelled += 1;
    } catch (error) {
      summary.errors += 1;
      console.error(
        '[ReminderEngine] failed to cancel reminder for deleted source',
        { sourceType, sourceId, reminderId: reminder.id },
        error,
      );
    }
  }

  return summary;
}

/**
 * Cancels inquiry reminders whose source_id or condition_key points at a missing inquiry.
 */
export async function cancelOrphanRemindersForSourceType(sourceType, existingSourceIds = []) {
  if (!sourceType) {
    return {
      ...emptyCancelRemindersSummary(),
      status: 'skipped',
      reason: 'missing_source_type',
    };
  }

  const existingIds = new Set(
    (existingSourceIds || []).filter(Boolean),
  );

  const summary = emptyCancelRemindersSummary();

  let reminders = [];

  try {
    reminders = await base44.entities.Reminder.list();
  } catch (error) {
    summary.errors += 1;
    throw error;
  }

  summary.checked = reminders.length;

  const remindersToCancel = new Map();

  for (const reminder of reminders) {
    if (isTerminalReminderStatus(reminder?.status)) {
      continue;
    }

    let isOrphan = false;

    if (reminder?.source_type === sourceType && reminder?.source_id) {
      isOrphan = !existingIds.has(reminder.source_id);
    }

    if (!isOrphan && sourceType === 'inquiry') {
      const inquiryIdFromKey = getInquiryIdFromConditionKey(reminder?.condition_key);
      if (inquiryIdFromKey && !existingIds.has(inquiryIdFromKey)) {
        isOrphan = true;
      }
    }

    if (isOrphan && reminder?.id) {
      remindersToCancel.set(reminder.id, reminder);
    }
  }

  summary.matched = remindersToCancel.size;

  for (const reminder of remindersToCancel.values()) {
    try {
      await cancelReminder(reminder.id, 'source_deleted');
      summary.cancelled += 1;
    } catch (error) {
      summary.errors += 1;
      console.error(
        '[ReminderEngine] failed to cancel orphan reminder',
        { sourceType, reminderId: reminder.id },
        error,
      );
    }
  }

  return summary;
}

const ALLOWED_SCHEDULE_FIELDS = new Set(['frequency', 'next_remind_at', 'default_time']);
const VALID_REMINDER_FREQUENCIES = new Set([
  'immediate',
  'daily',
  'weekly',
  'due_date_based',
  'custom',
]);

const assertFutureScheduleDate = (value, fieldName) => {
  const timestamp = toTimestamp(value);
  if (timestamp === null) {
    throw new Error(`${fieldName} must be a valid future date`);
  }
  if (timestamp <= Date.now()) {
    throw new Error(`${fieldName} must be in the future`);
  }
};

export async function updateReminderSchedule(reminderId, schedulePatch) {
  assertReminderId(reminderId);

  if (!schedulePatch || typeof schedulePatch !== 'object') {
    throw new Error('schedulePatch is required');
  }

  const allowedPatch = {};

  for (const field of Object.keys(schedulePatch)) {
    if (!ALLOWED_SCHEDULE_FIELDS.has(field)) {
      throw new Error(`Invalid schedule field: ${field}`);
    }
  }

  if (schedulePatch.frequency !== undefined) {
    if (!VALID_REMINDER_FREQUENCIES.has(schedulePatch.frequency)) {
      throw new Error(`Invalid frequency: ${schedulePatch.frequency}`);
    }
    allowedPatch.frequency = schedulePatch.frequency;
  }

  if (schedulePatch.next_remind_at !== undefined) {
    assertFutureScheduleDate(schedulePatch.next_remind_at, 'next_remind_at');
    allowedPatch.next_remind_at = new Date(schedulePatch.next_remind_at).toISOString();
  }

  if (schedulePatch.default_time !== undefined) {
    allowedPatch.default_time = String(schedulePatch.default_time).trim();
  }

  if (Object.keys(allowedPatch).length === 0) {
    throw new Error('schedulePatch must include at least one allowed field');
  }

  return persistReminderUpdate(reminderId, allowedPatch);
}

/**
 * Reminders that should appear in the UI after state normalization (in-memory only).
 */
export function getVisibleReminders(reminders, now = new Date()) {
  if (!Array.isArray(reminders)) return [];

  return reminders
    .map((reminder) => normalizeReminderState(reminder, now))
    .filter(Boolean)
    .filter((reminder) => reminder.status === REMINDER_STATUS.ACTIVE);
}

const getDateKey = (value) => {
  if (!value) return null;
  const date = parseReminderDate(value);
  if (!date) return null;
  return date.toISOString().split('T')[0];
};

/**
 * Sorts visible reminders: overdue, due today, no next_remind_at, then by active_since (oldest first).
 */
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

/**
 * Loads reminders, persists expired snoozes, and returns visible sorted reminders.
 */
export async function loadVisibleReminders(now = new Date()) {
  let reminders = await base44.entities.Reminder.list();
  const summary = await normalizeAndPersistExpiredSnoozes(reminders, now);

  if (summary.updated > 0) {
    reminders = await base44.entities.Reminder.list();
  }

  const visible = getVisibleReminders(reminders, now);
  return sortVisibleReminders(visible, now);
}

const CONDITION_KEY_PREFIXES = [
  'inquiry_missing_fields',
  'inquiry_needs_next_step',
  'client_needs_project',
  'inquiry_needs_proposal',
  'project_needs_proposal',
  'proposal_incomplete',
  'proposal_not_sent',
  'proposal_not_seen',
];

/**
 * Debug helper: summarize reminder DB state (console diagnostics only).
 */
export function summarizeRemindersForDebug(reminders) {
  const list = Array.isArray(reminders) ? reminders : [];
  const byStatus = {
    active: 0,
    snoozed: 0,
    resolved: 0,
    cancelled: 0,
    other: 0,
  };
  const byPrefix = Object.fromEntries(
    CONDITION_KEY_PREFIXES.map((prefix) => [prefix, 0]),
  );
  const superseded = [];

  for (const reminder of list) {
    const status = reminder?.status || 'other';
    if (status in byStatus) {
      byStatus[status] += 1;
    } else {
      byStatus.other += 1;
    }

    const key = String(reminder?.condition_key || '');
    for (const prefix of CONDITION_KEY_PREFIXES) {
      if (key.startsWith(prefix)) {
        byPrefix[prefix] += 1;
        break;
      }
    }

    if (reminder?.resolved_reason === 'superseded_by_proposal_flow') {
      superseded.push({
        title: reminder.title,
        status: reminder.status,
        condition_key: reminder.condition_key,
        source_type: reminder.source_type,
        source_id: reminder.source_id,
        resolved_reason: reminder.resolved_reason,
        action_url: reminder.action_url,
      });
    }
  }

  return {
    total: list.length,
    byStatus,
    byPrefix,
    supersededCount: superseded.length,
    superseded,
  };
}

export async function logReminderDbSummary(label = 'reminder-db') {
  const reminders = await base44.entities.Reminder.list();
  const summary = summarizeRemindersForDebug(reminders);
  const visible = getVisibleReminders(reminders);
  console.log(`[${label}]`, { ...summary, visibleCount: visible.length });
  return summary;
}

/**
 * Finds reminders with expired snooze and persists active state to the DB.
 * Idempotent: skips reminders already active with cleared snooze fields.
 */
export async function normalizeAndPersistExpiredSnoozes(reminders, now = new Date()) {
  if (!Array.isArray(reminders)) {
    return emptyPersistSummary();
  }

  const summary = {
    checked: reminders.length,
    expiredSnoozesFound: 0,
    updated: 0,
    errors: [],
  };

  for (const reminder of reminders) {
    if (!hasExpiredSnooze(reminder, now)) continue;

    summary.expiredSnoozesFound += 1;

    const reminderId = reminder?.id;
    if (!reminderId) {
      summary.errors.push({
        reminderId: null,
        error: 'reminder id is required',
      });
      continue;
    }

    try {
      await persistReminderUpdate(reminderId, ACTIVE_SNOOZE_CLEAR_PATCH);
      summary.updated += 1;
    } catch (error) {
      summary.errors.push({
        reminderId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}

export function getDefaultReminderSettings() {
  return {
    daily_reminder_time: DEFAULT_DAILY_REMINDER_TIME,
    daily_reminders_enabled: true,
  };
}

const normalizeSettingsUserId = (userId) => (userId ? String(userId).trim() : '');

const isGlobalReminderSettings = (settings) =>
  !normalizeSettingsUserId(settings?.user_id);

const matchesReminderSettingsUser = (settings, userId) =>
  normalizeSettingsUserId(settings?.user_id) === normalizeSettingsUserId(userId);

const findReminderSettingsInList = (settingsList, userId) => {
  if (!Array.isArray(settingsList) || settingsList.length === 0) {
    return null;
  }

  const normalizedUserId = normalizeSettingsUserId(userId);

  if (normalizedUserId) {
    return settingsList.find((settings) => matchesReminderSettingsUser(settings, normalizedUserId)) || null;
  }

  return settingsList.find(isGlobalReminderSettings) || null;
};

export function getDailyReminderTime(settings) {
  const time = settings?.daily_reminder_time;
  return time ? String(time).trim() : DEFAULT_DAILY_REMINDER_TIME;
}

export function areDailyRemindersEnabled(settings) {
  return settings?.daily_reminders_enabled !== false;
}

export async function getOrCreateReminderSettings(userId) {
  const defaults = getDefaultReminderSettings();
  const normalizedUserId = normalizeSettingsUserId(userId);

  const settingsList = await base44.entities.ReminderSettings.list();
  const existing = findReminderSettingsInList(settingsList, normalizedUserId);

  if (existing) {
    return existing;
  }

  return base44.entities.ReminderSettings.create({
    ...defaults,
    user_id: normalizedUserId,
  });
}

const REQUIRED_REMINDER_INPUT_FIELDS = [
  'title',
  'client_name',
  'source_type',
  'source_id',
  'condition_key',
  'action_url',
];

const hasValue = (value) =>
  value !== undefined && value !== null && String(value).trim() !== '';

function validateReminderInput(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('reminder input is required');
  }

  for (const field of REQUIRED_REMINDER_INPUT_FIELDS) {
    if (!hasValue(input[field])) {
      throw new Error(`${field} is required`);
    }
  }

  if (hasValue(input.project_id) && !hasValue(input.project_name)) {
    throw new Error('project_name is required when project_id exists');
  }
}

const parseDailyReminderTimeParts = (timeValue) => {
  const [hoursPart, minutesPart] = String(timeValue || DEFAULT_DAILY_REMINDER_TIME).split(':');
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);

  return {
    hours: Number.isFinite(hours) ? hours : 7,
    minutes: Number.isFinite(minutes) ? minutes : 0,
  };
};

function computeNextReminderAt({
  frequency = 'daily',
  immediate = false,
  settings = null,
  now = new Date(),
  next_remind_at: nextRemindAt,
} = {}) {
  if (immediate) {
    return now.toISOString();
  }

  if (frequency === 'daily') {
    const dailyTime = getDailyReminderTime(settings);
    const { hours, minutes } = parseDailyReminderTimeParts(dailyTime);
    const candidate = new Date(now);
    candidate.setHours(hours, minutes, 0, 0);

    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }

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

export async function findReminderByConditionKey(conditionKey) {
  const normalizedKey = conditionKey ? String(conditionKey).trim() : '';

  if (!normalizedKey) {
    throw new Error('conditionKey is required');
  }

  const reminders = await base44.entities.Reminder.list();
  return reminders.find((reminder) => reminder.condition_key === normalizedKey) || null;
}

export async function upsertReminder(input, options = {}) {
  validateReminderInput(input);

  const now = new Date();
  const timestamp = now.toISOString();
  const settings = await getOrCreateReminderSettings(options.userId);
  const frequency = input.frequency || 'daily';
  const existing = await findReminderByConditionKey(input.condition_key);

  const nextRemindAt = input.next_remind_at || computeNextReminderAt({
    frequency,
    immediate: options.immediate === true,
    settings,
    now,
    next_remind_at: input.next_remind_at,
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

    return {
      action: 'created',
      reminder: createdReminder,
    };
  }

  if (existing.status === REMINDER_STATUS.CANCELLED) {
    return {
      action: 'skipped_cancelled',
      reminder: existing,
    };
  }

  if (existing.status === REMINDER_STATUS.RESOLVED) {
    await reactivateReminder(existing);

    const reactivatedReminder = await persistReminderUpdate(existing.id, {
      ...buildReminderContentPatch(input),
      next_remind_at: nextRemindAt,
    });

    return {
      action: 'reactivated',
      reminder: reactivatedReminder,
    };
  }

  const updatedReminder = await persistReminderUpdate(existing.id, buildReminderContentPatch(input));

  return {
    action: 'updated',
    reminder: updatedReminder,
  };
}

export async function resolveReminderByConditionKey(conditionKey, reason) {
  const existing = await findReminderByConditionKey(conditionKey);

  if (!existing) {
    return { action: 'not_found' };
  }

  if (existing.status === REMINDER_STATUS.RESOLVED) {
    return {
      action: 'already_resolved',
      reminder: existing,
    };
  }

  if (existing.status === REMINDER_STATUS.CANCELLED) {
    return {
      action: 'skipped_cancelled',
      reminder: existing,
    };
  }

  const resolvedReminder = await resolveReminder(existing.id, reason || 'condition_cleared');

  return {
    action: 'resolved',
    reminder: resolvedReminder,
  };
}

export async function ensureReminderForCondition(conditionIsTrue, reminderInput, options = {}) {
  if (conditionIsTrue === true) {
    return upsertReminder(reminderInput, options);
  }

  const conditionKey = reminderInput?.condition_key;
  return resolveReminderByConditionKey(conditionKey, 'condition_cleared');
}

const buildFoundationTestInput = (conditionKey) => ({
  title: 'בדיקת Foundation תזכורות',
  description: 'בדיקת מנוע תזכורות מלאה',
  client_name: 'לקוח בדיקה',
  project_name: 'פרויקט בדיקה',
  source_type: 'debug',
  source_id: 'foundation-test',
  condition_key: conditionKey,
  action_url: '/Projects',
  action_label: 'פתח פרויקטים',
  frequency: 'daily',
});

/**
 * Full Foundation layer test against live Base44. For developer debug only.
 */
export async function debugReminderFoundationTest() {
  const timestamp = Date.now();
  const conditionKey = `debug:foundation:${timestamp}`;
  const input = buildFoundationTestInput(conditionKey);
  const steps = [];
  const errors = [];
  let passed = true;
  let settingsOk = false;
  let reminder = null;

  const recordStep = (name, stepPassed, extra = {}) => {
    steps.push({ name, passed: stepPassed, ...extra });
    if (!stepPassed) passed = false;
  };

  const recordError = (stepName, error) => {
    const message = error instanceof Error ? error.message : String(error);
    errors.push({ step: stepName, error: message });
    console.error('[ReminderFoundationTest]', stepName, error);
  };

  const reloadReminder = async () => findReminderByConditionKey(conditionKey);

  const countDuplicates = async () => {
    const reminders = await base44.entities.Reminder.list();
    return reminders.filter((item) => item.condition_key === conditionKey).length;
  };

  // 1. ReminderSettings
  try {
    const settings = await getOrCreateReminderSettings();
    const dailyTime = getDailyReminderTime(settings);
    settingsOk = Boolean(dailyTime) && areDailyRemindersEnabled(settings);
    recordStep('settings', settingsOk, {
      settingsOk,
      daily_reminder_time: dailyTime,
      daily_reminders_enabled: settings?.daily_reminders_enabled,
    });
  } catch (error) {
    recordStep('settings', false, { settingsOk: false });
    recordError('settings', error);
  }

  // 2. upsert create
  try {
    const created = await upsertReminder(input, { immediate: true });
    reminder = created.reminder;
    const stepPassed =
      created.action === 'created'
      && reminder?.status === REMINDER_STATUS.ACTIVE;
    recordStep('created', stepPassed, {
      action: created.action,
      status: reminder?.status,
    });
  } catch (error) {
    recordStep('created', false);
    recordError('created', error);
  }

  // 3. duplicate prevention
  try {
    const updated = await upsertReminder(input, { immediate: true });
    reminder = updated.reminder || reminder;
    const duplicateCount = await countDuplicates();
    const stepPassed = updated.action === 'updated' && duplicateCount === 1;
    recordStep('duplicate_prevention', stepPassed, {
      action: updated.action,
      duplicateCount,
    });
  } catch (error) {
    recordStep('duplicate_prevention', false);
    recordError('duplicate_prevention', error);
  }

  // 4. resolve
  try {
    const resolved = await resolveReminderByConditionKey(conditionKey);
    reminder = resolved.reminder || await reloadReminder();
    const stepPassed =
      resolved.action === 'resolved'
      && reminder?.status === REMINDER_STATUS.RESOLVED;
    recordStep('resolved', stepPassed, {
      action: resolved.action,
      status: reminder?.status,
    });
  } catch (error) {
    recordStep('resolved', false);
    recordError('resolved', error);
  }

  // 5. reactivation
  try {
    const reactivated = await upsertReminder(input, { immediate: true });
    reminder = reactivated.reminder;
    const stepPassed =
      reactivated.action === 'reactivated'
      && reminder?.status === REMINDER_STATUS.ACTIVE
      && Number(reminder?.reactivation_count) >= 1;
    recordStep('reactivated', stepPassed, {
      action: reactivated.action,
      status: reminder?.status,
      reactivation_count: reminder?.reactivation_count,
    });
  } catch (error) {
    recordStep('reactivated', false);
    recordError('reactivated', error);
  }

  // 6. snooze
  try {
    if (!reminder?.id) throw new Error('reminder id is missing');

    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await snoozeReminder(reminder.id, futureIso);
    reminder = await reloadReminder();

    const snoozeTime = toTimestamp(reminder?.snoozed_until);
    const stepPassed =
      reminder?.status === REMINDER_STATUS.SNOOZED
      && reminder?.is_snoozed === true
      && snoozeTime !== null
      && snoozeTime > Date.now();

    recordStep('snoozed', stepPassed, {
      status: reminder?.status,
      is_snoozed: reminder?.is_snoozed,
      snoozed_until: reminder?.snoozed_until,
    });
  } catch (error) {
    recordStep('snoozed', false);
    recordError('snoozed', error);
  }

  // 7. hidden while snoozed
  try {
    const reminders = await base44.entities.Reminder.list();
    const visible = getVisibleReminders(reminders);
    const isHidden = !visible.some((item) => item.condition_key === conditionKey);
    recordStep('hidden_while_snoozed', isHidden, {
      visibleCount: visible.length,
    });
  } catch (error) {
    recordStep('hidden_while_snoozed', false);
    recordError('hidden_while_snoozed', error);
  }

  // 8. expired snooze persisted as active
  try {
    if (!reminder?.id) throw new Error('reminder id is missing');

    const expiredSnoozedUntil = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await base44.entities.Reminder.update(reminder.id, {
      status: REMINDER_STATUS.SNOOZED,
      is_snoozed: true,
      snoozed_until: expiredSnoozedUntil,
    });

    const remindersBefore = await base44.entities.Reminder.list();
    const summary = await normalizeAndPersistExpiredSnoozes(remindersBefore);
    reminder = await reloadReminder();

    const stepPassed =
      summary.updated >= 1
      && reminder?.status === REMINDER_STATUS.ACTIVE
      && reminder?.is_snoozed === false
      && !reminder?.snoozed_until;

    recordStep('expired_snooze_reactivated', stepPassed, {
      updated: summary.updated,
      status: reminder?.status,
      is_snoozed: reminder?.is_snoozed,
      snoozed_until: reminder?.snoozed_until,
    });
  } catch (error) {
    recordStep('expired_snooze_reactivated', false);
    recordError('expired_snooze_reactivated', error);
  }

  // 9. updateReminderSchedule
  try {
    if (!reminder?.id) throw new Error('reminder id is missing');

    const futureNextRemindAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await updateReminderSchedule(reminder.id, {
      frequency: 'weekly',
      next_remind_at: futureNextRemindAt,
    });
    reminder = await reloadReminder();

    let invalidRejected = false;
    try {
      await updateReminderSchedule(reminder.id, { condition_key: 'bad' });
    } catch (invalidError) {
      invalidRejected = String(invalidError?.message || '').includes('Invalid schedule field');
    }

    const stepPassed =
      reminder?.frequency === 'weekly'
      && Boolean(reminder?.next_remind_at)
      && invalidRejected;

    recordStep('schedule_update', stepPassed, {
      frequency: reminder?.frequency,
      next_remind_at: reminder?.next_remind_at,
      invalidRejected,
      scheduleTestSkipped: false,
    });
  } catch (error) {
    recordStep('schedule_update', false, { scheduleTestSkipped: false });
    recordError('schedule_update', error);
  }

  // 10. cancel + skipped_cancelled
  try {
    if (!reminder?.id) throw new Error('reminder id is missing');

    await cancelReminder(reminder.id, 'foundation_test_done');
    const skipped = await upsertReminder(input, { immediate: true });
    reminder = skipped.reminder || await reloadReminder();

    const stepPassed =
      skipped.action === 'skipped_cancelled'
      && reminder?.status === REMINDER_STATUS.CANCELLED;

    recordStep('cancelled_skip', stepPassed, {
      action: skipped.action,
      status: reminder?.status,
    });
  } catch (error) {
    recordStep('cancelled_skip', false);
    recordError('cancelled_skip', error);
  }

  return {
    passed,
    conditionKey,
    settingsOk,
    steps,
    errors,
  };
}

/** @deprecated Use debugReminderFoundationTest */
export async function debugReminderUpsertSanityCheck() {
  return debugReminderFoundationTest();
}
