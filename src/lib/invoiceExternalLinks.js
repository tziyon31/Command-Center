export function getPaperlessUrl() {
  const url = String(import.meta.env.VITE_PAPERLESS_URL || '').trim();
  return url || null;
}

export function getGmailUrl() {
  return 'https://mail.google.com';
}
