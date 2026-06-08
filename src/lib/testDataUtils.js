export const TEST_REMINDER_FLOW_PREFIX = 'TEST_REMINDER_FLOW';

export function isTestReminderFlowLabel(value) {
  const text = String(value || '');
  if (!text) return false;
  if (text.startsWith(TEST_REMINDER_FLOW_PREFIX)) return true;
  return text.includes(`**${TEST_REMINDER_FLOW_PREFIX}**`);
}

export function recordContainsTestReminderFlow(record, fields = []) {
  if (!record || !fields.length) return false;
  return fields.some((field) => isTestReminderFlowLabel(record?.[field]));
}

export const COLLECTION_EVENT_TEST_SCAN_FIELDS = [
  'project_name',
  'client_name',
  'note',
  'title',
  'description',
];

export function isTestCollectionEvent(event) {
  return recordContainsTestReminderFlow(event, COLLECTION_EVENT_TEST_SCAN_FIELDS);
}

export function filterRealBusinessCollectionEvents(events) {
  return (events || []).filter((event) => !isTestCollectionEvent(event));
}
