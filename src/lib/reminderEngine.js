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

const isSnoozeExpired = (reminder, now) => {
  if (reminder?.status !== REMINDER_STATUS.SNOOZED) return false;
  const snoozeTime = toTimestamp(reminder.snoozed_until);
  if (snoozeTime === null) return true;
  return snoozeTime <= toTimestamp(now);
};

/**
 * Returns a reminder with consistent status/snooze fields (does not persist).
 */
export function normalizeReminderState(reminder, now = new Date()) {
  if (!reminder) return reminder;

  let next = { ...reminder };

  if (next.status === REMINDER_STATUS.SNOOZED && next.is_snoozed !== true) {
    next = { ...next, is_snoozed: true };
  }

  if (next.is_snoozed === true && next.status !== REMINDER_STATUS.SNOOZED) {
    next = { ...next, status: REMINDER_STATUS.SNOOZED };
  }

  if (next.status === REMINDER_STATUS.SNOOZED && isSnoozeExpired(next, now)) {
    next = {
      ...next,
      status: REMINDER_STATUS.ACTIVE,
      is_snoozed: false,
      snoozed_until: '',
    };
  }

  if (
    next.status === REMINDER_STATUS.RESOLVED
    || next.status === REMINDER_STATUS.CANCELLED
  ) {
    next = {
      ...next,
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
 * Reminders that should appear in the UI after state normalization.
 */
export function getVisibleReminders(reminders, now = new Date()) {
  if (!Array.isArray(reminders)) return [];

  return reminders
    .map((reminder) => normalizeReminderState(reminder, now))
    .filter((reminder) => reminder.status === REMINDER_STATUS.ACTIVE);
}
