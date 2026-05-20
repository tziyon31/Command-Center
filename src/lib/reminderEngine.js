import { base44 } from '@/api/base44Client';

export const REMINDER_STATUS = {
  ACTIVE: 'active',
  SNOOZED: 'snoozed',
  RESOLVED: 'resolved',
  CANCELLED: 'cancelled',
};

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
