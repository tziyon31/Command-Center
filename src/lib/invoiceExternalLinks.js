/** Default Paperless invoices admin — https://www.paperless.tax/admin/invoice */
export const DEFAULT_PAPERLESS_URL = 'https://www.paperless.tax/admin/invoice';

export function getPaperlessUrl() {
  const envUrl = String(import.meta.env.VITE_PAPERLESS_URL || '').trim();
  return envUrl || DEFAULT_PAPERLESS_URL;
}

export function getGmailUrl() {
  return 'https://mail.google.com';
}
