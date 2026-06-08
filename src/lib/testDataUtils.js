export const TEST_REMINDER_FLOW_PREFIX = 'TEST_REMINDER_FLOW';
export const CLEARLY_TEST_PROJECT_NAME = 'בדיקה';
export const CLEARLY_TEST_CLIENT_NAME = 'בדיקה';

export function isTestReminderFlowLabel(value) {
  const text = String(value || '');
  if (!text) return false;
  if (text.startsWith(TEST_REMINDER_FLOW_PREFIX)) return true;
  return text.includes(`**${TEST_REMINDER_FLOW_PREFIX}**`);
}

export function isClearlyTestProjectOrClientName(value) {
  const trimmed = String(value || '').trim();
  return trimmed === CLEARLY_TEST_PROJECT_NAME || trimmed === CLEARLY_TEST_CLIENT_NAME;
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

export const PROJECT_TEST_SCAN_FIELDS = ['name', 'notes'];
export const INVOICE_TEST_SCAN_FIELDS = ['project_name', 'client_name', 'invoice_reference', 'notes'];
export const COLLECTION_DUE_TEST_SCAN_FIELDS = ['project_name', 'client_name', 'invoice_reference', 'notes'];

export function isClearlyTestRecord(record, options = {}) {
  if (!record) return false;

  const {
    fields = [],
    projectNameField = 'project_name',
    clientNameField = 'client_name',
    nameField = 'name',
    linkedProject = null,
  } = options;

  const scanFields = [...new Set([
    ...fields,
    projectNameField,
    clientNameField,
    nameField,
    'notes',
    'title',
    'description',
    'note',
    'invoice_reference',
  ])];

  if (recordContainsTestReminderFlow(record, scanFields)) return true;

  if (isClearlyTestProjectOrClientName(record?.[projectNameField])) return true;
  if (isClearlyTestProjectOrClientName(record?.[clientNameField])) return true;
  if (isClearlyTestProjectOrClientName(record?.[nameField])) return true;

  if (linkedProject) {
    if (isClearlyTestProjectOrClientName(linkedProject.name)) return true;
    if (recordContainsTestReminderFlow(linkedProject, PROJECT_TEST_SCAN_FIELDS)) return true;
  }

  return false;
}

export function isTestCollectionEvent(event, linkedProject = null) {
  return isClearlyTestRecord(event, {
    fields: COLLECTION_EVENT_TEST_SCAN_FIELDS,
    linkedProject,
  });
}

export function filterRealBusinessCollectionEvents(events) {
  return (events || []).filter((event) => !isTestCollectionEvent(event));
}
