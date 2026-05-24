import { base44 } from '@/api/base44Client';

const displayValue = (value) => {
  if (value === '' || value === null || value === undefined) return '-';
  const text = String(value).trim();
  return text || '-';
};

export const buildInquiryCopyText = (formData) => {
  const details = (formData?.details || '').trim() || '-';

  return `פנייה חדשה לניתוח:

שם לקוח: ${displayValue(formData?.client_name)}
סוג מבנה: ${displayValue(formData?.building_type)}
שטח: ${displayValue(formData?.area)}
טון קירור: ${displayValue(formData?.cooling_tons)}

פירוט נוסף:
${details}

משימה:
נתח את הפנייה, זהה מידע חסר, וסכם אילו צעדים נדרשים להמשך טיפול.`;
};

export const inquiryToCopyFormData = (inquiry) => ({
  client_name: inquiry?.client_name || '',
  building_type: inquiry?.building_type || '',
  area: inquiry?.area ?? '',
  cooling_tons: inquiry?.cooling_tons ?? '',
  details: inquiry?.details || '',
});

export const formatCopiedAt = (value) => {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

export const copyTextToClipboard = async (text) => {
  if (!navigator?.clipboard?.writeText) {
    throw new Error('Clipboard API is not available');
  }

  await navigator.clipboard.writeText(text);
};

export const markInquiryCopiedToAi = async (inquiryId) => {
  const copiedAt = new Date().toISOString();
  await base44.entities.Inquiry.update(inquiryId, { copied_to_ai_at: copiedAt });
  return copiedAt;
};

/**
 * Copies inquiry fields to clipboard and updates copied_to_ai_at only.
 * @returns {string} ISO timestamp written to copied_to_ai_at
 */
export const copyInquiryFieldsToClipboard = async (formData, inquiryId) => {
  if (!inquiryId) {
    throw new Error('Inquiry id is required to copy');
  }

  const text = buildInquiryCopyText(formData);
  await copyTextToClipboard(text);
  return markInquiryCopiedToAi(inquiryId);
};
