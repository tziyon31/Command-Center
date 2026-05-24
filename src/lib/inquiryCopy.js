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
