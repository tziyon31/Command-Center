/**
 * Central admin access checks for audit / preview / migration tooling.
 * Uses an explicit email allowlist — not open to all users with role=admin in production.
 */

export const ADMIN_ACCESS_DENIED_MESSAGE = 'אין הרשאה לצפייה בדף זה';

const ADMIN_EMAIL_ALLOWLIST = [
  'tziyon31@gmail.com',
  'tziyon31@hotmail.com',
  'aronaron81@gmail.com',
];

function normalizeAdminEmail(user) {
  return String(user?.email || user?.created_by || '').trim().toLowerCase();
}

export function isAdminUser(user) {
  const email = normalizeAdminEmail(user);
  if (!email) return false;
  return ADMIN_EMAIL_ALLOWLIST.includes(email);
}

/** Read-only audit / preview pages */
export function canAccessAdminPage(user) {
  return isAdminUser(user);
}

/** Apply / backfill / cleanup / test mutation controls */
export function canRunAdminMutations(user) {
  return isAdminUser(user);
}
