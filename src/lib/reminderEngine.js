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

/**
 * Temporary sanity check for upsert/resolve/reactivate flows. Requires live Base44 access.
 */
export async function debugReminderUpsertSanityCheck() {
  const timestamp = Date.now();
  const conditionKey = `debug:test_condition:${timestamp}`;
  const input = {
    title: 'Debug Reminder',
    description: 'Sanity check reminder',
    client_name: 'Debug Client',
    source_type: 'debug',
    source_id: `debug-source-${timestamp}`,
    condition_key: conditionKey,
    action_url: '/debug',
  };

  const results = [];

  const created = await upsertReminder(input, { immediate: true });
  results.push({ step: 'create', action: created.action });

  const updated = await upsertReminder(input, { immediate: true });
  results.push({ step: 'update', action: updated.action });

  const resolved = await resolveReminderByConditionKey(conditionKey);
  results.push({ step: 'resolve', action: resolved.action });

  const reactivated = await upsertReminder(input, { immediate: true });
  results.push({
    step: 'reactivate',
    action: reactivated.action,
    reactivation_count: reactivated.reminder?.reactivation_count,
    status: reactivated.reminder?.status,
  });

  await cancelReminder(reactivated.reminder.id);

  const skipped = await upsertReminder(input, { immediate: true });
  results.push({ step: 'cancelled_skip', action: skipped.action });

  const reminders = await base44.entities.Reminder.list();
  const duplicates = reminders.filter((reminder) => reminder.condition_key === conditionKey);

  const passed =
    created.action === 'created'
    && updated.action === 'updated'
    && resolved.action === 'resolved'
    && reactivated.action === 'reactivated'
    && reactivated.reminder?.status === REMINDER_STATUS.ACTIVE
    && Number(reactivated.reminder?.reactivation_count) >= 1
    && skipped.action === 'skipped_cancelled'
    && duplicates.length === 1;

  return {
    conditionKey,
    results,
    steps: results,
    duplicateCount: duplicates.length,
    passed,
  };
}
