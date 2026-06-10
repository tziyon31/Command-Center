import { REMINDER_STATUS } from '@/lib/reminderEngine';

export const DELETION_CONFIRM_WORD = 'מחק';

const CONDITION_PREFIXES_BY_SOURCE_TYPE = {
  project: [
    'project_needs_proposal:',
    'project_waiting_followup:',
    'project_needs_work_stages:',
    'project_completed_needs_invoice_review:',
  ],
  proposal: [
    'proposal_incomplete:',
    'proposal_not_sent:',
    'proposal_not_seen:',
    'proposal_needs_signed_proposal:',
    'proposal_waiting_followup:',
  ],
  signed_proposal: ['signed_proposal_needs_work_stages:'],
  work_stage: [
    'work_stage_needs_check:',
    'work_stage_target_date:',
    'work_stage_needs_invoice_review:',
  ],
  invoice_process: [
    'invoice_needs_paperless:',
    'invoice_needs_send:',
    'invoice_needs_receipt_confirmation:',
    'invoice_needs_collection:',
  ],
};

export const normalizeEntityId = (value) => String(value || '').trim();

export function matchesExactProjectId(record, projectId) {
  return normalizeEntityId(record?.project_id) === normalizeEntityId(projectId);
}

export function isNotFoundDeleteError(error) {
  const status = error?.status || error?.response?.status;
  const message = error instanceof Error ? error.message : String(error || '');
  return status === 404 || /not found|does not exist|doesn't exist/i.test(message);
}

export function createDeletionSummary() {
  return {
    deleted: {},
    alreadyDeleted: {},
    failed: [],
  };
}

export function trackDeletionResult(summary, bucket, result) {
  if (!summary || !bucket) return;
  if (!summary.deleted[bucket]) summary.deleted[bucket] = [];
  if (!summary.alreadyDeleted[bucket]) summary.alreadyDeleted[bucket] = [];

  if (result.status === 'deleted') {
    summary.deleted[bucket].push(result.id);
    return;
  }

  if (result.status === 'already_deleted') {
    summary.alreadyDeleted[bucket].push(result.id);
    return;
  }

  if (result.status === 'failed') {
    summary.failed.push({
      bucket,
      id: result.id,
      error: result.error instanceof Error ? result.error.message : String(result.error || ''),
    });
  }
}

export async function listEntitiesByExactProjectId(entity, projectId) {
  const normalizedProjectId = normalizeEntityId(projectId);
  if (!normalizedProjectId || !entity?.list) return [];

  const items = await entity.list();
  return (items || []).filter((item) => matchesExactProjectId(item, normalizedProjectId));
}

export async function safeDeleteEntityRecord(entity, id) {
  const normalizedId = normalizeEntityId(id);
  if (!normalizedId) {
    return { status: 'skipped', id: null };
  }

  if (!entity?.delete) {
    return { status: 'skipped', id: normalizedId };
  }

  try {
    await entity.delete(normalizedId);
    return { status: 'deleted', id: normalizedId };
  } catch (error) {
    if (isNotFoundDeleteError(error)) {
      return { status: 'already_deleted', id: normalizedId };
    }
    return { status: 'failed', id: normalizedId, error };
  }
}

function getEntityIdFromConditionKey(conditionKey, sourceType) {
  const prefixes = CONDITION_PREFIXES_BY_SOURCE_TYPE[sourceType] || [];
  const key = String(conditionKey || '');

  for (const prefix of prefixes) {
    if (key.startsWith(prefix)) {
      return key.slice(prefix.length);
    }
  }

  return null;
}

export function reminderMatchesDeletedSource(reminder, sourceType, sourceId) {
  const normalizedSourceId = normalizeEntityId(sourceId);
  if (!normalizedSourceId) return false;

  if (
    normalizeEntityId(reminder?.source_type) === normalizeEntityId(sourceType)
    && normalizeEntityId(reminder?.source_id) === normalizedSourceId
  ) {
    return true;
  }

  return getEntityIdFromConditionKey(reminder?.condition_key, sourceType) === normalizedSourceId;
}

export function isOpenReminderStatus(status) {
  return status === REMINDER_STATUS.ACTIVE || status === REMINDER_STATUS.SNOOZED;
}

export function findActiveRemindersForSourceRefs(reminders = [], sourceRefs = []) {
  const matched = new Map();

  for (const reminder of reminders || []) {
    if (!isOpenReminderStatus(reminder?.status)) continue;

    for (const [sourceType, sourceId] of sourceRefs) {
      if (reminderMatchesDeletedSource(reminder, sourceType, sourceId)) {
        matched.set(reminder.id, reminder);
        break;
      }
    }
  }

  return [...matched.values()];
}

export function buildSourceRefsFromImpact(impact) {
  const refs = [];

  if (impact?.project?.id) {
    refs.push(['project', impact.project.id]);
  }

  for (const item of impact?.proposals || []) {
    if (item?.id) refs.push(['proposal', item.id]);
  }

  for (const item of impact?.signedProposals || []) {
    if (item?.id) refs.push(['signed_proposal', item.id]);
  }

  for (const item of impact?.workStages || []) {
    if (item?.id) refs.push(['work_stage', item.id]);
  }

  for (const item of impact?.invoiceProcesses || []) {
    if (item?.id) refs.push(['invoice_process', item.id]);
  }

  return refs;
}
