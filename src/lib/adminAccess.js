/**
 * Central admin access checks for audit / preview / migration tooling.
 * Uses an explicit email allowlist — not open to all users with role=admin in production.
 */

export const ADMIN_ACCESS_DENIED_MESSAGE = 'אין הרשאה לצפייה בדף זה';

/** Full admin: audit pages, production mutations, and reminder test tooling */
const ADMIN_EMAIL_ALLOWLIST = [
  'tziyon31@gmail.com',
  'tziyon31@hotmail.com',
  'aronaron81@gmail.com',
];

/** Production operator: apply / backfill / cleanup — no reminder test tooling */
const OPERATOR_EMAIL_ALLOWLIST = [];

function normalizeAdminEmail(user) {
  return String(user?.email || user?.created_by || '').trim().toLowerCase();
}

function isEmailOnAllowlist(user, allowlist) {
  const email = normalizeAdminEmail(user);
  if (!email) return false;
  return allowlist.includes(email);
}

export function isAdminUser(user) {
  return isEmailOnAllowlist(user, ADMIN_EMAIL_ALLOWLIST);
}

export function isOperatorUser(user) {
  return isEmailOnAllowlist(user, OPERATOR_EMAIL_ALLOWLIST);
}

/** Read-only audit / preview pages */
export function canAccessAdminPage(user) {
  return isAdminUser(user);
}

/** Apply / backfill / cleanup mutation controls (no reminder integration tests) */
export function canRunAdminMutations(user) {
  return isAdminUser(user) || isOperatorUser(user);
}

/** Dashboard "Test Reminders" menu and integration test runner */
export function canRunReminderTests(user) {
  return isAdminUser(user);
}
