const MAX_INLINE_LABEL_LENGTH = 18;

function normalizeText(value) {
  return String(value || '').trim();
}

export function formatPipelineReminderShortDate(value) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('he-IL', {
    day: 'numeric',
    month: 'numeric',
  }).format(date);
}

export function getPipelineReminderShortLabel(reminder) {
  const title = normalizeText(reminder?.title);
  const conditionKey = normalizeText(reminder?.condition_key).toLowerCase();

  if (
    title.includes('האם הסתיים שלב')
    || conditionKey.startsWith('work_stage_needs_check:')
  ) {
    return 'בדיקת שלב';
  }

  if (
    title.includes('לקבל תשלום')
    || conditionKey.startsWith('collection_payment_due:')
  ) {
    return 'קבלת תשלום';
  }

  if (
    title.includes('חשבונית מס')
    || conditionKey.startsWith('collection_needs_tax_invoice:')
  ) {
    return 'חשבונית מס';
  }

  if (
    title.includes('להגדיר') && title.includes('שלב')
    || conditionKey.startsWith('project_needs_work_stages:')
    || conditionKey.startsWith('signed_proposal_needs_work_stages:')
  ) {
    return 'הגדרת שלבים';
  }

  if (
    title.includes('הצעת מחיר')
    || conditionKey.startsWith('proposal_')
  ) {
    return 'הצעת מחיר';
  }

  if (title.includes('מעקב')) {
    return 'מעקב';
  }

  if (title.length > MAX_INLINE_LABEL_LENGTH) {
    return `${title.slice(0, MAX_INLINE_LABEL_LENGTH - 1)}…`;
  }

  return title || 'תזכורת';
}

export function buildPipelineReminderCompactLine(reminder) {
  const label = getPipelineReminderShortLabel(reminder);
  const dateLabel = formatPipelineReminderShortDate(
    reminder?.next_remind_at || reminder?.snoozed_until,
  );

  return {
    id: reminder?.id,
    label,
    dateLabel,
    fullTitle: normalizeText(reminder?.title) || label,
    reminder,
    displayText: dateLabel ? `${label} · ${dateLabel}` : label,
  };
}

export function buildPipelineReminderCompactSummary(reminders = [], { maxLines = 2 } = {}) {
  const lines = reminders.map((reminder) => buildPipelineReminderCompactLine(reminder));
  const visibleLines = lines.slice(0, maxLines);
  const hiddenCount = Math.max(lines.length - visibleLines.length, 0);

  return {
    count: reminders.length,
    lines: visibleLines,
    hiddenCount,
    combinedText: visibleLines.length > 1
      ? visibleLines.map((line) => line.label).join(' + ')
      : visibleLines[0]?.label || '',
  };
}

export function buildPipelineCompactSummaryText(summary = {}) {
  const parts = [];

  const inWorkCount = Number(summary.inWorkWithActiveStageCount || 0);
  const withoutStagesCount = Number(summary.acceptedWithoutWorkflowCount || 0)
    + Number(summary.inWorkWithoutWorkflowCount || 0);
  const openCollectionCount = Number(summary.openCollectionCount || 0);
  const activeRemindersCount = Number(summary.activeRemindersCount || 0);

  if (inWorkCount > 0) parts.push(`${inWorkCount} בעבודה`);
  if (withoutStagesCount > 0) parts.push(`${withoutStagesCount} ללא שלבים`);
  if (openCollectionCount > 0) parts.push(`${openCollectionCount} גבייה פתוחה`);
  if (activeRemindersCount > 0) parts.push(`${activeRemindersCount} תזכורות`);

  if (!parts.length) return 'תמונת מצב: אין פרויקטים פעילים';

  return `תמונת מצב: ${parts.join(' · ')}`;
}
