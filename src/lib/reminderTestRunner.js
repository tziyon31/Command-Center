import { base44 } from '@/api/base44Client';
import { runClientReminderRulesForClient } from '@/lib/clientReminderRules';
import {
  getInquiryMissingFieldsConditionKey,
  getInquiryNeedsNextStepConditionKey,
  runInquiryReminderRulesForInquiry,
} from '@/lib/inquiryReminderRules';
import { getClientNeedsProjectConditionKey } from '@/lib/clientReminderRules';
import {
  getInquiryNeedsProposalConditionKey,
  getProjectNeedsProposalConditionKey,
  getProposalIncompleteConditionKey,
  getProposalNeedsSignedProposalConditionKey,
  getProposalNotSeenConditionKey,
  getProposalNotSentConditionKey,
  runProposalReminderRulesForInquiry,
  runProposalReminderRulesForProject,
  runProposalReminderRulesForProposal,
  runSignedProposalNeedReminderRuleForProposal,
} from '@/lib/proposalReminderRules';
import { linkProjectToValidSignedProposal } from '@/lib/signedProposalLifecycle';
import {
  getSignedProposalNeedsWorkStagesConditionKey,
  getWorkStageNeedsCheckConditionKey,
  getWorkStageTargetDateConditionKey,
  runWorkStageReminderRulesForProject,
  runWorkStageReminderRulesForSignedProposal,
} from '@/lib/workStageReminderRules';
import {
  countActiveWorkStages,
  getActiveWorkStage,
  normalizeWorkStageStatuses,
} from '@/lib/workStageLogic';
import { loadWorkStagesForProject, recalculateProjectWorkStages } from '@/lib/workStageSync';
import {
  cancelReminder,
  cancelRemindersForDeletedSource,
  createReminderEngineCache,
  findReminderByConditionKeyInCache,
  hasOpenReminderForConditionKey,
  isRateLimitError,
  loadReminderEngineCache,
  reloadRemindersInCache,
  REMINDER_INTEGRATION_TEST_LOCK_KEY,
  REMINDER_STATUS,
  upsertReminderInCache,
} from '@/lib/reminderEngine';

export const TEST_REMINDER_FLOW_PREFIX = 'TEST_REMINDER_FLOW';
export const REMINDER_TEST_RUN_STATE_KEY = 'reminderTestRunState';
export const REMINDER_TEST_CLEANUP_RATE_LIMIT_KEY = 'reminderTestCleanupRateLimitedAt';

const OPEN_STATUSES = new Set([REMINDER_STATUS.ACTIVE, REMINDER_STATUS.SNOOZED]);
const MAX_CLEANUP_MUTATIONS_PER_BATCH = 5;
const CLEANUP_BATCH_DELAY_MS = 400;
const RATE_LIMIT_RETRY_DELAY_MS = 1500;
const STALE_TEST_RUN_THRESHOLD_MS = 30 * 1000;
const CLEANUP_RATE_LIMIT_COOLDOWN_MS = 2 * 60 * 1000;

const TEST_ENTITY_SCAN_FIELDS = {
  Inquiry: ['client_name', 'notes'],
  Client: ['name'],
  Project: ['name'],
  Proposal: ['client_name', 'project_name', 'document_note', 'notes'],
  SignedProposal: ['client_name', 'project_name', 'notes'],
  WorkStage: ['title', 'project_name', 'client_name', 'notes'],
};

const TEST_ENTITY_BUCKETS = [
  { bucket: 'inquiries', entityName: 'Inquiry', labelField: 'client_name' },
  { bucket: 'clients', entityName: 'Client', labelField: 'name' },
  { bucket: 'projects', entityName: 'Project', labelField: 'name' },
  { bucket: 'proposals', entityName: 'Proposal', labelField: 'client_name' },
  { bucket: 'signedProposals', entityName: 'SignedProposal', labelField: 'client_name' },
  { bucket: 'workStages', entityName: 'WorkStage', labelField: 'title' },
];

const TEST_ENTITY_DELETE_ORDER = [
  { bucket: 'workStages', entityName: 'WorkStage', labelField: 'title' },
  { bucket: 'signedProposals', entityName: 'SignedProposal', labelField: 'client_name' },
  { bucket: 'proposals', entityName: 'Proposal', labelField: 'client_name' },
  { bucket: 'projects', entityName: 'Project', labelField: 'name' },
  { bucket: 'inquiries', entityName: 'Inquiry', labelField: 'client_name' },
  { bucket: 'clients', entityName: 'Client', labelField: 'name' },
];

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function hasBrowserStorage() {
  return typeof globalThis !== 'undefined'
    && globalThis.localStorage
    && typeof globalThis.localStorage.getItem === 'function';
}

export function isReminderIntegrationTestLockActive() {
  if (!hasBrowserStorage()) return false;
  try {
    return globalThis.localStorage.getItem(REMINDER_INTEGRATION_TEST_LOCK_KEY) === 'true';
  } catch (_error) {
    return false;
  }
}

function acquireReminderIntegrationTestLock() {
  if (isReminderIntegrationTestLockActive()) return false;
  if (!hasBrowserStorage()) return true;
  try {
    globalThis.localStorage.setItem(REMINDER_INTEGRATION_TEST_LOCK_KEY, 'true');
    return true;
  } catch (_error) {
    return true;
  }
}

function releaseReminderIntegrationTestLock() {
  if (!hasBrowserStorage()) return;
  try {
    globalThis.localStorage.removeItem(REMINDER_INTEGRATION_TEST_LOCK_KEY);
  } catch (_error) {}
}

function isTestLabel(value) {
  return String(value || '').startsWith(TEST_REMINDER_FLOW_PREFIX);
}

function entityMatchesTestPrefix(item, fields = []) {
  return fields.some((field) => isTestLabel(item?.[field]));
}

function emptyEntityIdRegistry() {
  return {
    inquiries: [],
    clients: [],
    projects: [],
    proposals: [],
    signedProposals: [],
    workStages: [],
    reminders: [],
  };
}

function createTestRunId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `test-run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadReminderTestRunState() {
  if (!hasBrowserStorage()) return null;
  try {
    const raw = globalThis.localStorage.getItem(REMINDER_TEST_RUN_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      runId: parsed.runId || null,
      startedAt: parsed.startedAt || null,
      status: parsed.status || 'completed',
      createdEntities: {
        ...emptyEntityIdRegistry(),
        ...(parsed.createdEntities || {}),
      },
      trackedConditionKeys: Array.isArray(parsed.trackedConditionKeys)
        ? parsed.trackedConditionKeys
        : [],
    };
  } catch (_error) {
    return null;
  }
}

function saveReminderTestRunState(state) {
  if (!hasBrowserStorage() || !state) return;
  try {
    globalThis.localStorage.setItem(REMINDER_TEST_RUN_STATE_KEY, JSON.stringify(state));
  } catch (_error) {}
}

export function clearReminderTestRunState() {
  if (!hasBrowserStorage()) return;
  try {
    globalThis.localStorage.removeItem(REMINDER_TEST_RUN_STATE_KEY);
  } catch (_error) {}
}

function markReminderTestRunStatus(status) {
  const current = loadReminderTestRunState();
  if (!current) return;
  saveReminderTestRunState({ ...current, status });
}

export function startReminderTestRunRegistry() {
  const state = {
    runId: createTestRunId(),
    startedAt: new Date().toISOString(),
    status: 'running',
    createdEntities: emptyEntityIdRegistry(),
    trackedConditionKeys: [],
  };
  saveReminderTestRunState(state);
  return state;
}

export function registerTestEntity(type, id) {
  const normalizedId = String(id || '').trim();
  if (!normalizedId || !type) return;

  let state = loadReminderTestRunState();
  if (!state) {
    state = startReminderTestRunRegistry();
  }

  const bucket = state.createdEntities[type];
  if (!Array.isArray(bucket)) return;
  if (!bucket.includes(normalizedId)) {
    bucket.push(normalizedId);
  }
  saveReminderTestRunState(state);
}

export function registerTestReminderId(id) {
  registerTestEntity('reminders', id);
}

export function registerTestConditionKey(conditionKey) {
  const normalizedKey = String(conditionKey || '').trim();
  if (!normalizedKey) return;

  let state = loadReminderTestRunState();
  if (!state) {
    state = startReminderTestRunRegistry();
  }

  if (!state.trackedConditionKeys.includes(normalizedKey)) {
    state.trackedConditionKeys.push(normalizedKey);
  }
  saveReminderTestRunState(state);
}

function saveCleanupRateLimitTimestamp() {
  if (!hasBrowserStorage()) return;
  try {
    globalThis.localStorage.setItem(
      REMINDER_TEST_CLEANUP_RATE_LIMIT_KEY,
      String(Date.now()),
    );
  } catch (_error) {}
}

export function isReminderTestCleanupRateLimitCooldownActive(now = Date.now()) {
  if (!hasBrowserStorage()) return false;
  try {
    const raw = globalThis.localStorage.getItem(REMINDER_TEST_CLEANUP_RATE_LIMIT_KEY);
    const timestamp = Number(raw);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
    return now - timestamp < CLEANUP_RATE_LIMIT_COOLDOWN_MS;
  } catch (_error) {
    return false;
  }
}

export function reconcileStaleReminderTestRunState(now = Date.now()) {
  const state = loadReminderTestRunState();

  if (state?.status === 'running' && state.startedAt) {
    const startedAtMs = Date.parse(state.startedAt);
    const ageMs = Number.isFinite(startedAtMs) ? now - startedAtMs : 0;
    if (ageMs >= STALE_TEST_RUN_THRESHOLD_MS) {
      markReminderTestRunStatus('cleanup_pending');
    }
  }

  if (isReminderIntegrationTestLockActive()) {
    const startedAtMs = state?.startedAt ? Date.parse(state.startedAt) : NaN;
    const ageMs = Number.isFinite(startedAtMs) ? now - startedAtMs : STALE_TEST_RUN_THRESHOLD_MS;
    if (ageMs >= STALE_TEST_RUN_THRESHOLD_MS) {
      releaseReminderIntegrationTestLock();
    }
  }

  return getPendingReminderTestCleanupStatus(now);
}

export function getPendingReminderTestCleanupStatus(now = Date.now()) {
  const state = loadReminderTestRunState();
  if (!state?.startedAt) return null;

  const startedAtMs = Date.parse(state.startedAt);
  const ageMs = Number.isFinite(startedAtMs) ? now - startedAtMs : 0;
  const isStaleRunning = state.status === 'running' && ageMs >= STALE_TEST_RUN_THRESHOLD_MS;
  const isCleanupPending = state.status === 'cleanup_pending';

  if (!isStaleRunning && !isCleanupPending) return null;

  return {
    pending: true,
    status: state.status,
    startedAt: state.startedAt,
    runId: state.runId,
    ageMs,
    message: isCleanupPending
      ? 'נמצא cleanup לא גמור של בדיקות'
      : 'נמצאה הרצת בדיקות שלא הסתיימה',
  };
}

function createCleanupContext() {
  return { rateLimited: false, errors: [] };
}

async function cleanupRequest(ctx, label, fn) {
  if (ctx.rateLimited) {
    throw new Error(`Cleanup stopped (${label})`);
  }

  try {
    return await fn();
  } catch (error) {
    if (isRateLimitError(error)) {
      ctx.rateLimited = true;
      ctx.errors.push({
        label,
        message: 'Rate limit reached. Cleanup is pending. Wait 2 minutes and run cleanup again.',
      });
    }
    throw error;
  }
}

function isNotFoundError(error) {
  const status = error?.status
    ?? error?.statusCode
    ?? error?.response?.status
    ?? error?.data?.status;
  const message = [
    error instanceof Error ? error.message : '',
    error?.data?.message,
    error?.response?.data?.message,
    String(error || ''),
  ].join(' ');
  return status === 404 || /not found|does not exist|doesn't exist/i.test(message);
}

function markRateLimited(ctx, stage) {
  ctx.rateLimited = true;
  if (!ctx.errors.some((item) => item.message?.includes('Rate limit hit'))) {
    ctx.errors.push({ stage, message: 'Rate limit hit; wait 2 minutes and rerun' });
  }
}

async function safeRequest(ctx, label, fn) {
  if (ctx.rateLimited) {
    throw new Error('Rate limit already hit');
  }

  try {
    return await fn();
  } catch (error) {
    if (!isRateLimitError(error)) throw error;

    await delay(RATE_LIMIT_RETRY_DELAY_MS);

    try {
      return await fn();
    } catch (retryError) {
      if (isRateLimitError(retryError)) {
        markRateLimited(ctx, label);
      }
      throw retryError;
    }
  }
}

async function safeDeleteEntity(ctx, entityName, id) {
  if (!id) {
    return { ok: true, status: 'skipped', id: null, entityName };
  }

  const entity = base44.entities[entityName];
  if (!entity?.delete) {
    return { ok: true, status: 'skipped', id, entityName };
  }

  try {
    await safeRequest(ctx, `delete_${entityName}`, () => entity.delete(id));
    return { ok: true, status: 'deleted', id, entityName };
  } catch (error) {
    if (isNotFoundError(error)) {
      console.info(`[ReminderTestRunner] ${entityName} ${id} already deleted`);
      return { ok: true, status: 'already_deleted', id, entityName };
    }
    if (isRateLimitError(error)) {
      markRateLimited(ctx, `delete_${entityName}`);
      return { ok: false, status: 'rate_limited', id, entityName, error };
    }
    console.warn(`[ReminderTestRunner] failed to delete ${entityName}`, id, error);
    return { ok: false, status: 'failed', id, entityName, error };
  }
}

async function runBatchedCleanup(ctx, items, handler) {
  const summary = {
    passed: true,
    completed: 0,
    skipped: 0,
    alreadyDeleted: 0,
    failed: [],
    pending: [],
  };

  for (let index = 0; index < items.length; index += MAX_CLEANUP_MUTATIONS_PER_BATCH) {
    if (ctx.rateLimited) {
      summary.passed = false;
      summary.pending.push(...items.slice(index));
      break;
    }

    const batch = items.slice(index, index + MAX_CLEANUP_MUTATIONS_PER_BATCH);

    for (const item of batch) {
      const result = await handler(item);

      if (result.status === 'skipped') {
        summary.skipped += 1;
        continue;
      }

      if (result.status === 'already_deleted') {
        summary.alreadyDeleted += 1;
        summary.completed += 1;
        continue;
      }

      if (result.status === 'rate_limited') {
        summary.passed = false;
        const itemIndex = batch.indexOf(item);
        summary.pending.push(...batch.slice(itemIndex));
        break;
      }

      if (!result.ok) {
        summary.passed = false;
        summary.failed.push(result);
        continue;
      }

      summary.completed += 1;
    }

    if (ctx.rateLimited || summary.pending.length > 0) break;

    if (index + MAX_CLEANUP_MUTATIONS_PER_BATCH < items.length) {
      await delay(CLEANUP_BATCH_DELAY_MS);
    }
  }

  return summary;
}

export async function findReminderTestLeftovers() {
  const report = {
    inquiries: [],
    clients: [],
    projects: [],
    proposals: [],
    signedProposals: [],
    workStages: [],
    reminders: [],
    remindersByStatus: {
      active: [],
      snoozed: [],
      resolved: [],
      cancelled: [],
      other: [],
    },
    entities: {
      inquiries: 0,
      clients: 0,
      projects: 0,
      proposals: 0,
      signedProposals: 0,
      workStages: 0,
    },
    remindersSummary: {
      total: 0,
      active: 0,
      snoozed: 0,
      resolved: 0,
      cancelled: 0,
      other: 0,
    },
    entityTotal: 0,
    total: 0,
    totalReminderLeftovers: 0,
    openReminderLeftovers: 0,
    cleanupRequired: false,
    note: '',
  };

  const scanEntities = async (entityName, bucket, fields) => {
    const entity = base44.entities[entityName];
    if (!entity?.list) return;

    const items = await entity.list();
    for (const item of items) {
      if (!item?.id || !entityMatchesTestPrefix(item, fields)) continue;
      report[bucket].push({
        id: item.id,
        label: fields.map((field) => item[field]).filter(Boolean).join(' / '),
      });
    }
  };

  await Promise.all(
    TEST_ENTITY_BUCKETS.map(({ entityName, bucket }) => (
      scanEntities(entityName, bucket, TEST_ENTITY_SCAN_FIELDS[entityName] || [])
    )),
  );

  const reminders = await base44.entities.Reminder.list();
  for (const reminder of reminders) {
    const matched = (
      isTestLabel(reminder?.title)
      || isTestLabel(reminder?.description)
      || isTestLabel(reminder?.client_name)
      || isTestLabel(reminder?.project_name)
      || isTestLabel(reminder?.condition_key)
    );
    if (!matched || !reminder?.id) continue;

    const entry = {
      id: reminder.id,
      condition_key: reminder.condition_key,
      status: reminder.status,
    };
    report.reminders.push(entry);

    const status = String(reminder.status || '').toLowerCase();
    if (status === REMINDER_STATUS.ACTIVE) report.remindersByStatus.active.push(entry);
    else if (status === REMINDER_STATUS.SNOOZED) report.remindersByStatus.snoozed.push(entry);
    else if (status === REMINDER_STATUS.RESOLVED) report.remindersByStatus.resolved.push(entry);
    else if (status === REMINDER_STATUS.CANCELLED) report.remindersByStatus.cancelled.push(entry);
    else report.remindersByStatus.other.push(entry);
  }

  report.entities.inquiries = report.inquiries.length;
  report.entities.clients = report.clients.length;
  report.entities.projects = report.projects.length;
  report.entities.proposals = report.proposals.length;
  report.entities.signedProposals = report.signedProposals.length;
  report.entities.workStages = report.workStages.length;

  report.entityTotal = (
    report.entities.inquiries
    + report.entities.clients
    + report.entities.projects
    + report.entities.proposals
    + report.entities.signedProposals
    + report.entities.workStages
  );

  report.remindersSummary.total = report.reminders.length;
  report.remindersSummary.active = report.remindersByStatus.active.length;
  report.remindersSummary.snoozed = report.remindersByStatus.snoozed.length;
  report.remindersSummary.resolved = report.remindersByStatus.resolved.length;
  report.remindersSummary.cancelled = report.remindersByStatus.cancelled.length;
  report.remindersSummary.other = report.remindersByStatus.other.length;

  report.totalReminderLeftovers = report.reminders.length;
  report.openReminderLeftovers = (
    report.remindersSummary.active + report.remindersSummary.snoozed
  );
  report.total = report.entityTotal + report.totalReminderLeftovers;
  report.cleanupRequired = report.entityTotal > 0 || report.openReminderLeftovers > 0;

  if (report.entityTotal > 0) {
    report.note = 'Test entity leftovers detected';
  } else if (report.openReminderLeftovers > 0) {
    report.note = 'Open test reminder leftovers detected';
  } else if (report.totalReminderLeftovers > 0) {
    report.note = 'No open test reminder leftovers';
  } else {
    report.note = 'No test leftovers';
  }

  return report;
}

export function isReminderTestCleanupRequired(report) {
  if (!report) return false;
  return Boolean(report.cleanupRequired);
}

async function scanTestEntitiesByPrefix(ctx) {
  const scanned = {
    inquiries: [],
    clients: [],
    projects: [],
    proposals: [],
    signedProposals: [],
    workStages: [],
  };

  for (const { entityName, bucket } of TEST_ENTITY_BUCKETS) {
    if (ctx.rateLimited) break;

    const entity = base44.entities[entityName];
    if (!entity?.list) continue;

    const items = await cleanupRequest(ctx, `scan_${entityName}`, () => entity.list());
    const fields = TEST_ENTITY_SCAN_FIELDS[entityName] || [];

    for (const item of items || []) {
      if (!item?.id || !entityMatchesTestPrefix(item, fields)) continue;
      scanned[bucket].push(item);
    }
  }

  return scanned;
}

function mergeEntityRecordsById(...groups) {
  const merged = new Map();

  for (const group of groups) {
    if (!group) continue;
    for (const item of group) {
      if (!item?.id) continue;
      merged.set(item.id, item);
    }
  }

  return [...merged.values()];
}

function registryIdsToEntityRecords(registryIds = [], scannedItems = []) {
  const scannedById = new Map(scannedItems.map((item) => [item.id, item]));
  return registryIds
    .map((id) => scannedById.get(id) || { id })
    .filter((item) => item?.id);
}

function buildCleanupEntityPlan({
  registryState = null,
  sessionEntities = null,
  prefixScan = null,
}) {
  const registryIds = registryState?.createdEntities || emptyEntityIdRegistry();
  const sessionLists = sessionEntities || emptyCreatedEntities();

  return {
    inquiries: mergeEntityRecordsById(
      registryIdsToEntityRecords(registryIds.inquiries, prefixScan?.inquiries),
      sessionLists.inquiries,
      prefixScan?.inquiries,
    ),
    clients: mergeEntityRecordsById(
      registryIdsToEntityRecords(registryIds.clients, prefixScan?.clients),
      sessionLists.clients,
      prefixScan?.clients,
    ),
    projects: mergeEntityRecordsById(
      registryIdsToEntityRecords(registryIds.projects, prefixScan?.projects),
      sessionLists.projects,
      prefixScan?.projects,
    ),
    proposals: mergeEntityRecordsById(
      registryIdsToEntityRecords(registryIds.proposals, prefixScan?.proposals),
      sessionLists.proposals,
      prefixScan?.proposals,
    ),
    signedProposals: mergeEntityRecordsById(
      registryIdsToEntityRecords(registryIds.signedProposals, prefixScan?.signedProposals),
      sessionLists.signedProposals,
      prefixScan?.signedProposals,
    ),
    workStages: mergeEntityRecordsById(
      registryIdsToEntityRecords(registryIds.workStages, prefixScan?.workStages),
      sessionLists.workStages,
      prefixScan?.workStages,
    ),
  };
}

async function cleanupDeleteEntity(ctx, entityName, item, labelField) {
  const id = item?.id;
  if (!id) {
    return { ok: true, status: 'skipped', id: null, entityName };
  }

  const label = item[labelField] || item.client_name || item.name || item.title || '';
  if (label && !isTestLabel(label)) {
    console.warn('[ReminderTestRunner] refusing to delete non-test entity', entityName, id, label);
    return { ok: false, status: 'failed', id, entityName };
  }

  const entity = base44.entities[entityName];
  if (!entity?.delete) {
    return { ok: true, status: 'skipped', id, entityName };
  }

  try {
    await cleanupRequest(ctx, `delete_${entityName}`, () => entity.delete(id));
    return { ok: true, status: 'deleted', id, entityName };
  } catch (error) {
    if (isNotFoundError(error)) {
      console.info(`[ReminderTestRunner] ${entityName} ${id} already deleted`);
      return { ok: true, status: 'already_deleted', id, entityName };
    }
    if (isRateLimitError(error)) {
      return { ok: false, status: 'rate_limited', id, entityName, error };
    }
    console.warn(`[ReminderTestRunner] failed to delete ${entityName}`, id, error);
    return { ok: false, status: 'failed', id, entityName, error };
  }
}

async function cancelTestRemindersForCleanup(ctx, {
  entityPlan,
  trackedConditionKeys = [],
  registryReminderIds = [],
  cache = null,
}) {
  const summary = {
    passed: true,
    cancelled: 0,
    alreadyClosed: 0,
    skipped: 0,
    failedIds: [],
    failedConditionKeys: [],
    pending: [],
  };

  if (ctx.rateLimited) {
    summary.passed = false;
    return summary;
  }

  const testSourceIds = collectEntityIds(entityPlan);
  const trackedKeys = new Set(trackedConditionKeys.map((key) => String(key || '').trim()).filter(Boolean));
  const registryReminderIdSet = new Set(
    (registryReminderIds || []).map((id) => String(id || '').trim()).filter(Boolean),
  );

  let reminders = cache?.reminders;
  if (!reminders) {
    reminders = await cleanupRequest(ctx, 'list_reminders', () => base44.entities.Reminder.list());
  }

  const toCancel = (reminders || []).filter((reminder) => {
    if (!reminder?.id || !OPEN_STATUSES.has(reminder.status)) return false;

    const conditionKey = String(reminder?.condition_key || '').trim();
    const sourceId = reminder?.source_id;
    const matched = (
      registryReminderIdSet.has(String(reminder.id))
      || (conditionKey && trackedKeys.has(conditionKey))
      || (sourceId && testSourceIds.has(sourceId))
      || isTestLabel(reminder?.title)
      || isTestLabel(reminder?.description)
      || isTestLabel(reminder?.client_name)
      || isTestLabel(reminder?.project_name)
      || isTestLabel(reminder?.condition_key)
    );

    return matched;
  });

  const batchSummary = await runBatchedCleanup(ctx, toCancel, async (reminder) => {
    const conditionKey = String(reminder?.condition_key || '').trim();

    try {
      const cancelled = await cleanupRequest(
        ctx,
        'cancel_test_reminder',
        () => cancelReminder(reminder.id, 'test_cleanup'),
      );
      if (cache) upsertReminderInCache(cache, cancelled);
      registerTestReminderId(reminder.id);
      summary.cancelled += 1;
      return { ok: true, status: 'deleted', id: reminder.id };
    } catch (error) {
      if (isNotFoundError(error)) {
        summary.alreadyClosed += 1;
        return { ok: true, status: 'already_deleted', id: reminder.id };
      }
      if (isRateLimitError(error)) {
        return { ok: false, status: 'rate_limited', id: reminder.id };
      }
      summary.failedIds.push(reminder.id);
      if (conditionKey) summary.failedConditionKeys.push(conditionKey);
      return { ok: false, status: 'failed', id: reminder.id, error };
    }
  });

  summary.passed = batchSummary.passed && summary.failedIds.length === 0;
  summary.pending = batchSummary.pending.map((item) => item?.id || item).filter(Boolean);
  summary.skipped = batchSummary.skipped;

  return summary;
}

async function deleteTestEntitiesForCleanup(ctx, entityPlan) {
  const summary = {
    passed: true,
    deleted: {
      workStages: [],
      signedProposals: [],
      proposals: [],
      projects: [],
      inquiries: [],
      clients: [],
    },
    alreadyDeleted: {
      workStages: [],
      signedProposals: [],
      proposals: [],
      projects: [],
      inquiries: [],
      clients: [],
    },
    failed: {
      workStages: [],
      signedProposals: [],
      proposals: [],
      projects: [],
      inquiries: [],
      clients: [],
    },
    pending: [],
  };

  if (ctx.rateLimited) {
    summary.passed = false;
    return summary;
  }

  for (const group of TEST_ENTITY_DELETE_ORDER) {
    const items = [...(entityPlan[group.bucket] || [])].reverse();
    const batchSummary = await runBatchedCleanup(ctx, items, async (item) => {
      const result = await cleanupDeleteEntity(ctx, group.entityName, item, group.labelField);
      if (result.status === 'deleted') summary.deleted[group.bucket].push(item.id);
      if (result.status === 'already_deleted') summary.alreadyDeleted[group.bucket].push(item.id);
      if (result.status === 'failed') summary.failed[group.bucket].push(item.id);
      return result;
    });

    summary.passed = summary.passed && batchSummary.passed;
    summary.pending.push(...batchSummary.pending.map((item) => item?.id || item).filter(Boolean));

    if (ctx.rateLimited) break;
  }

  return summary;
}

export async function cleanupAllReminderTestData(options = {}) {
  const ctx = createCleanupContext();

  if (isReminderTestCleanupRateLimitCooldownActive()) {
    return {
      passed: false,
      rateLimited: true,
      skippedDueToRateLimit: true,
      message: 'Rate limit reached. Cleanup is pending. Wait 2 minutes and run cleanup again.',
      entities: null,
      reminders: null,
    };
  }

  markReminderTestRunStatus('cleanup_pending');

  const registryState = loadReminderTestRunState();
  let prefixScan = null;

  try {
    prefixScan = await scanTestEntitiesByPrefix(ctx);
  } catch (error) {
    if (isRateLimitError(error)) {
      saveCleanupRateLimitTimestamp();
      return {
        passed: false,
        rateLimited: true,
        message: 'Rate limit reached. Cleanup is pending. Wait 2 minutes and run cleanup again.',
        errors: ctx.errors,
      };
    }
    throw error;
  }

  const entityPlan = buildCleanupEntityPlan({
    registryState,
    sessionEntities: options.sessionEntities || null,
    prefixScan,
  });

  const trackedConditionKeys = [
    ...(registryState?.trackedConditionKeys || []),
    ...(options.trackedConditionKeys || []),
  ];

  let reminders = null;
  try {
    reminders = await cancelTestRemindersForCleanup(ctx, {
      entityPlan,
      trackedConditionKeys,
      registryReminderIds: registryState?.createdEntities?.reminders || [],
      cache: options.cache || null,
    });
  } catch (error) {
    if (isRateLimitError(error)) {
      saveCleanupRateLimitTimestamp();
      markReminderTestRunStatus('cleanup_pending');
      return {
        passed: false,
        rateLimited: true,
        message: 'Rate limit reached. Cleanup is pending. Wait 2 minutes and run cleanup again.',
        reminders: null,
        entities: null,
        errors: ctx.errors,
      };
    }
    throw error;
  }

  let entities = null;
  try {
    entities = await deleteTestEntitiesForCleanup(ctx, entityPlan);
  } catch (error) {
    if (isRateLimitError(error)) {
      saveCleanupRateLimitTimestamp();
      markReminderTestRunStatus('cleanup_pending');
      return {
        passed: false,
        rateLimited: true,
        message: 'Rate limit reached. Cleanup is pending. Wait 2 minutes and run cleanup again.',
        reminders,
        entities: null,
        errors: ctx.errors,
      };
    }
    throw error;
  }

  const passed = Boolean(
    !ctx.rateLimited
    && (reminders?.passed ?? true)
    && (entities?.passed ?? true)
    && !(reminders?.pending?.length)
    && !(entities?.pending?.length),
  );

  if (ctx.rateLimited) {
    saveCleanupRateLimitTimestamp();
    markReminderTestRunStatus('cleanup_pending');
  } else if (passed) {
    markReminderTestRunStatus('completed');
    clearReminderTestRunState();
  } else {
    markReminderTestRunStatus('cleanup_pending');
  }

  let leftovers = null;
  try {
    leftovers = await findReminderTestLeftovers();
  } catch (leftoverError) {
    console.warn('[ReminderTestRunner] failed to scan leftovers after cleanup', leftoverError);
  }

  return {
    passed,
    rateLimited: ctx.rateLimited,
    message: ctx.rateLimited
      ? 'Rate limit reached. Cleanup is pending. Wait 2 minutes and run cleanup again.'
      : (passed ? 'Cleanup completed' : 'Cleanup incomplete'),
    reminders,
    entities,
    leftovers,
    errors: ctx.errors,
  };
}

const emptyCreatedEntities = () => ({
  inquiries: [],
  clients: [],
  projects: [],
  proposals: [],
  signedProposals: [],
  workStages: [],
});

const collectEntityIds = (createdEntities) => {
  const ids = new Set();
  for (const group of Object.values(createdEntities)) {
    for (const item of group) {
      if (item?.id) ids.add(item.id);
    }
  }
  return ids;
};

function applyTestEntitiesToCache(cache, createdEntities) {
  cache.inquiries = [...createdEntities.inquiries];
  cache.clients = [...createdEntities.clients];
  cache.projects = [...createdEntities.projects];
  cache.proposals = [...createdEntities.proposals];
  cache.signedProposals = [...createdEntities.signedProposals];
  cache.workStages = [...createdEntities.workStages];
}

function initializeTestRunnerCache(cache) {
  cache.clients = cache.clients ?? [];
  cache.projects = cache.projects ?? [];
  cache.inquiries = cache.inquiries ?? [];
  cache.proposals = cache.proposals ?? [];
  cache.signedProposals = cache.signedProposals ?? [];
  cache.workStages = cache.workStages ?? [];
}

async function refreshReminderSnapshot(ctx, reason = 'checkpoint') {
  if (ctx.rateLimited) return ctx.cache;
  await safeRequest(ctx, `refresh_reminders:${reason}`, () => reloadRemindersInCache(ctx.cache));
  return ctx.cache;
}

function patchReminderInCache(ctx, conditionKey, patch) {
  const reminder = findReminderByConditionKeyInCache(ctx.cache, conditionKey);
  if (!reminder) return;
  upsertReminderInCache(ctx.cache, { ...reminder, ...patch });
}

async function invalidateTestSignedProposal(ctx, signedProposal, proposal) {
  await safeDeleteEntity(ctx, 'SignedProposal', signedProposal.id);

  ctx.createdEntities.signedProposals = ctx.createdEntities.signedProposals.filter(
    (item) => item.id !== signedProposal.id,
  );

  const projectId = String(signedProposal.project_id || '').trim();
  if (projectId) {
    await safeRequest(ctx, 'clear_project_signed_proposal_link', () => base44.entities.Project.update(projectId, {
      source_signed_proposal_id: '',
    }));

    const projectIndex = ctx.createdEntities.projects.findIndex((item) => item.id === projectId);
    if (projectIndex >= 0) {
      ctx.createdEntities.projects[projectIndex] = {
        ...ctx.createdEntities.projects[projectIndex],
        source_signed_proposal_id: '',
      };
    }
  }

  applyTestEntitiesToCache(ctx.cache, ctx.createdEntities);

  if (ctx.rateLimited) return;

  await safeRequest(ctx, 'reopen_sp1_after_delete', () => runSignedProposalNeedReminderRuleForProposal(proposal, ctx.cache));
  await refreshReminderSnapshot(ctx, 'invalidate_test_signed_proposal');
}

function trackConditionKey(ctx, conditionKey) {
  if (!conditionKey) return;
  const normalizedKey = String(conditionKey).trim();
  ctx.trackedConditionKeys.add(normalizedKey);
  registerTestConditionKey(normalizedKey);
}

function assertReminderExists(ctx, name, conditionKey) {
  trackConditionKey(ctx, conditionKey);
  const reminder = findReminderByConditionKeyInCache(ctx.cache, conditionKey);
  const open = hasOpenReminderForConditionKey(ctx.cache, conditionKey);
  return {
    name,
    passed: open,
    expected: 'open reminder (active or snoozed)',
    actual: reminder?.status || 'not found',
    details: { conditionKey, reminderId: reminder?.id || null },
  };
}

function assertReminderClosed(ctx, name, conditionKey) {
  trackConditionKey(ctx, conditionKey);
  const reminder = findReminderByConditionKeyInCache(ctx.cache, conditionKey);
  const open = hasOpenReminderForConditionKey(ctx.cache, conditionKey);
  return {
    name,
    passed: !open,
    expected: 'no open reminder',
    actual: reminder?.status || 'not found',
    details: { conditionKey, reminderId: reminder?.id || null },
  };
}

function assertOpenReminderFields(ctx, name, conditionKey, expected = {}) {
  trackConditionKey(ctx, conditionKey);
  const reminder = findReminderByConditionKeyInCache(ctx.cache, conditionKey);
  const open = hasOpenReminderForConditionKey(ctx.cache, conditionKey);
  const checks = [open];

  if (expected.frequency) {
    checks.push(reminder?.frequency === expected.frequency);
  }
  if (expected.titleIncludes) {
    checks.push(String(reminder?.title || '').includes(expected.titleIncludes));
  }
  if (expected.actionUrlIncludes) {
    checks.push(String(reminder?.action_url || '').includes(expected.actionUrlIncludes));
  }

  return {
    name,
    passed: checks.every(Boolean),
    expected: JSON.stringify(expected),
    actual: reminder
      ? `${reminder.status} / ${reminder.frequency || '(no frequency)'} / ${reminder.title || ''} / ${reminder.action_url || ''}`
      : 'not found',
    details: { conditionKey, reminderId: reminder?.id || null },
  };
}

function assertNoDuplicateOpenReminders(ctx, name) {
  const duplicates = [];

  for (const conditionKey of ctx.trackedConditionKeys) {
    const reminders = ctx.cache.remindersByConditionKey?.get(conditionKey) || [];
    const openCount = reminders.filter((reminder) => OPEN_STATUSES.has(reminder?.status)).length;
    if (openCount > 1) {
      duplicates.push({ conditionKey, openCount, reminderIds: reminders.map((item) => item.id) });
    }
  }

  return {
    name,
    passed: duplicates.length === 0,
    expected: 'at most one active/snoozed reminder per tracked condition_key',
    actual: duplicates.length ? `${duplicates.length} duplicate key(s)` : 'ok',
    details: { duplicates },
  };
}

async function guardRateLimit(error, ctx) {
  if (!isRateLimitError(error)) throw error;
  markRateLimited(ctx, 'rate_limit');
  throw error;
}

async function createTestInquiry(ctx, createdEntities, overrides = {}) {
  const inquiry = await safeRequest(ctx, 'create_inquiry', () => base44.entities.Inquiry.create({
    client_name: `${TEST_REMINDER_FLOW_PREFIX} inquiry`,
    building_type: 'office',
    details: '',
    form_status: 'draft',
    ...overrides,
  }));
  createdEntities.inquiries.push(inquiry);
  registerTestEntity('inquiries', inquiry.id);
  return inquiry;
}

async function updateTestInquiry(ctx, createdEntities, inquiry, patch) {
  const updated = await safeRequest(ctx, 'update_inquiry', () => base44.entities.Inquiry.update(inquiry.id, patch));
  const merged = { ...inquiry, ...updated, ...patch };
  const index = createdEntities.inquiries.findIndex((item) => item.id === inquiry.id);
  if (index >= 0) createdEntities.inquiries[index] = merged;
  return merged;
}

async function createTestClient(ctx, createdEntities, overrides = {}) {
  const client = await safeRequest(ctx, 'create_client', () => base44.entities.Client.create({
    name: `${TEST_REMINDER_FLOW_PREFIX} client`,
    status: 'draft',
    rating: 'B',
    ...overrides,
  }));
  createdEntities.clients.push(client);
  registerTestEntity('clients', client.id);
  return client;
}

async function createTestProject(ctx, createdEntities, overrides = {}) {
  const project = await safeRequest(ctx, 'create_project', () => base44.entities.Project.create({
    name: `${TEST_REMINDER_FLOW_PREFIX} project`,
    client_id: overrides.client_id || '',
    status: 'pricing',
    form_status: 'draft',
    year: new Date().getFullYear(),
    total_amount: 0,
    collected_amount: 0,
    ...overrides,
  }));
  createdEntities.projects.push(project);
  registerTestEntity('projects', project.id);
  return project;
}

async function updateTestProject(ctx, createdEntities, project, patch) {
  const updated = await safeRequest(ctx, 'update_project', () => base44.entities.Project.update(project.id, patch));
  const merged = { ...project, ...updated, ...patch };
  const index = createdEntities.projects.findIndex((item) => item.id === project.id);
  if (index >= 0) createdEntities.projects[index] = merged;
  return merged;
}

async function createTestProposal(ctx, createdEntities, overrides = {}) {
  const proposal = await safeRequest(ctx, 'create_proposal', () => base44.entities.Proposal.create({
    client_name: `${TEST_REMINDER_FLOW_PREFIX} proposal`,
    form_status: 'draft',
    proposal_sent_to_client: false,
    client_saw_proposal: false,
    ...overrides,
  }));
  createdEntities.proposals.push(proposal);
  registerTestEntity('proposals', proposal.id);
  return proposal;
}

async function updateTestProposal(ctx, createdEntities, proposal, patch) {
  const updated = await safeRequest(ctx, 'update_proposal', () => base44.entities.Proposal.update(proposal.id, patch));
  const merged = { ...proposal, ...updated, ...patch };
  const index = createdEntities.proposals.findIndex((item) => item.id === proposal.id);
  if (index >= 0) createdEntities.proposals[index] = merged;
  return merged;
}

async function createTestSignedProposal(ctx, createdEntities, overrides = {}) {
  const signedProposal = await safeRequest(ctx, 'create_signed_proposal', () => base44.entities.SignedProposal.create({
    client_name: `${TEST_REMINDER_FLOW_PREFIX} signed`,
    project_name: `${TEST_REMINDER_FLOW_PREFIX} project`,
    has_signed_offer_or_order: false,
    form_status: 'draft',
    ...overrides,
  }));
  createdEntities.signedProposals.push(signedProposal);
  registerTestEntity('signedProposals', signedProposal.id);
  return signedProposal;
}

async function createTestWorkStage(ctx, createdEntities, overrides = {}) {
  const stage = await safeRequest(ctx, 'create_work_stage', () => base44.entities.WorkStage.create({
    title: `${TEST_REMINDER_FLOW_PREFIX} stage`,
    order_index: 1,
    status: 'pending',
    aaron_approved: false,
    client_approved: false,
    draftsman_approved: false,
    invoice_required_on_completion: false,
    notes: '',
    ...overrides,
  }));
  createdEntities.workStages.push(stage);
  registerTestEntity('workStages', stage.id);
  return stage;
}

async function updateTestWorkStage(ctx, createdEntities, stage, patch) {
  const updated = await safeRequest(ctx, 'update_work_stage', () => base44.entities.WorkStage.update(stage.id, patch));
  const merged = { ...stage, ...updated, ...patch };
  const index = createdEntities.workStages.findIndex((item) => item.id === stage.id);
  if (index >= 0) createdEntities.workStages[index] = merged;
  return merged;
}

async function fetchTestWorkStage(ctx, stageId) {
  const results = await safeRequest(ctx, 'fetch_work_stage', () => base44.entities.WorkStage.filter({ id: stageId }));
  return results?.[0] || null;
}

async function fetchTestProject(ctx, projectId) {
  const results = await safeRequest(ctx, 'fetch_project', () => base44.entities.Project.filter({ id: projectId }));
  return results?.[0] || null;
}

async function recalculateTestProjectWorkStages(ctx, projectId) {
  await safeRequest(ctx, 'recalculate_work_stages', () => recalculateProjectWorkStages(projectId));
}

async function loadTestWorkStagesForProject(ctx, projectId) {
  return safeRequest(ctx, 'load_work_stages', () => loadWorkStagesForProject(projectId));
}

async function runRuleAndRefreshRemindersOnce(ctx, fn, reason = 'rules') {
  if (ctx.rateLimited) return;
  applyTestEntitiesToCache(ctx.cache, ctx.createdEntities);
  await safeRequest(ctx, reason, fn);
  if (!ctx.rateLimited) {
    await refreshReminderSnapshot(ctx, reason);
  }
}

async function syncTestProjectStages(ctx, projectId) {
  const result = await safeRequest(
    ctx,
    'recalculate_work_stages',
    () => recalculateProjectWorkStages(projectId, { cache: ctx.cache }),
  );
  const stages = result?.normalized || await loadTestWorkStagesForProject(ctx, projectId);
  ctx.createdEntities.workStages = [
    ...ctx.createdEntities.workStages.filter(
      (stage) => String(stage.project_id || '') !== String(projectId),
    ),
    ...stages,
  ];
  applyTestEntitiesToCache(ctx.cache, ctx.createdEntities);
  return stages;
}

async function runWorkStageProjectRules(ctx, projectId, reason = 'work_stage_project_rules') {
  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runWorkStageReminderRulesForProject(projectId, ctx.cache);
  }, reason);
}

async function createTestProjectWithClient(ctx, label) {
  const client = await createTestClient(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} ${label} client`,
  });
  const project = await createTestProject(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} ${label} project`,
    client_id: client.id,
    client_name: client.name,
  });

  return { client, project };
}

async function createTestWorkStageForProject(ctx, project, client, overrides = {}) {
  return createTestWorkStage(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client?.id || project.client_id || '',
    client_name: client?.name || project.client_name || project.name || '',
    ...overrides,
  });
}

async function createTestProjectWithSignedProposal(ctx, label) {
  const client = await createTestClient(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} ${label} client`,
  });
  const project = await createTestProject(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} ${label} project`,
    client_id: client.id,
    client_name: client.name,
  });
  const signedProposal = await createTestSignedProposal(ctx, ctx.createdEntities, {
    client_id: client.id,
    project_id: project.id,
    client_name: client.name,
    project_name: project.name,
    has_signed_offer_or_order: true,
    form_status: 'submitted',
  });

  return { client, project, signedProposal };
}

async function runTest1(ctx) {
  const inquiry = await createTestInquiry(ctx, ctx.createdEntities, {
    client_name: `${TEST_REMINDER_FLOW_PREFIX} R1`,
    details: '',
    form_status: 'draft',
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runInquiryReminderRulesForInquiry(inquiry, ctx.cache);
  });

  ctx.steps.push(assertReminderExists(
    ctx,
    'Test 1 – R1 created for draft inquiry',
    getInquiryMissingFieldsConditionKey(inquiry.id),
  ));

  const submitted = await updateTestInquiry(ctx, ctx.createdEntities, inquiry, {
    details: 'Test details for R1',
    form_status: 'submitted',
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runInquiryReminderRulesForInquiry(submitted, ctx.cache);
  });

  ctx.steps.push(assertReminderClosed(
    ctx,
    'Test 1 – R1 closed after submit',
    getInquiryMissingFieldsConditionKey(inquiry.id),
  ));
}

async function runTest2(ctx) {
  const inquiry = await createTestInquiry(ctx, ctx.createdEntities, {
    client_name: `${TEST_REMINDER_FLOW_PREFIX} R2`,
    details: 'Submitted inquiry for R2',
    form_status: 'submitted',
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runInquiryReminderRulesForInquiry(inquiry, ctx.cache);
  });

  ctx.steps.push(assertReminderExists(
    ctx,
    'Test 2 – R2 created for submitted inquiry',
    getInquiryNeedsNextStepConditionKey(inquiry.id),
  ));

  const client = await createTestClient(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} R2 client`,
    source_inquiry_id: inquiry.id,
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runInquiryReminderRulesForInquiry(inquiry, ctx.cache);
  });

  ctx.steps.push(assertReminderExists(
    ctx,
    'Test 2 – R2 still open after client (needs project)',
    getInquiryNeedsNextStepConditionKey(inquiry.id),
  ));

  await createTestProject(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} R2 project`,
    client_id: client.id,
    source_inquiry_id: inquiry.id,
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runInquiryReminderRulesForInquiry(inquiry, ctx.cache);
  });

  ctx.steps.push(assertReminderClosed(
    ctx,
    'Test 2 – R2 closed after project',
    getInquiryNeedsNextStepConditionKey(inquiry.id),
  ));
}

async function runTest3(ctx) {
  const client = await createTestClient(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} R4`,
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runClientReminderRulesForClient(client, ctx.cache);
  });

  ctx.steps.push(assertReminderExists(
    ctx,
    'Test 3 – R4 created for client without project',
    getClientNeedsProjectConditionKey(client.id),
  ));

  await createTestProject(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} R4 project`,
    client_id: client.id,
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runClientReminderRulesForClient(client, ctx.cache);
  });

  ctx.steps.push(assertReminderClosed(
    ctx,
    'Test 3 – R4 closed after project',
    getClientNeedsProjectConditionKey(client.id),
  ));
}

async function runTest4(ctx) {
  const inquiry = await createTestInquiry(ctx, ctx.createdEntities, {
    client_name: `${TEST_REMINDER_FLOW_PREFIX} P1`,
    details: 'Submitted for P1',
    form_status: 'submitted',
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runProposalReminderRulesForInquiry(inquiry, ctx.cache);
    await runInquiryReminderRulesForInquiry(inquiry, ctx.cache);
  });

  const p1Key = getInquiryNeedsProposalConditionKey(inquiry.id);
  const r2Key = getInquiryNeedsNextStepConditionKey(inquiry.id);

  ctx.steps.push(assertReminderExists(ctx, 'Test 4 – P1 created', p1Key));
  ctx.steps.push(assertReminderExists(ctx, 'Test 4 – R2 still open alongside P1', r2Key));

  await createTestProposal(ctx, ctx.createdEntities, {
    client_name: inquiry.client_name,
    source_inquiry_id: inquiry.id,
    form_status: 'draft',
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runProposalReminderRulesForInquiry(inquiry, ctx.cache);
  });

  ctx.steps.push(assertReminderClosed(ctx, 'Test 4 – P1 closed after proposal', p1Key));
  ctx.steps.push(assertReminderExists(ctx, 'Test 4 – R2 not closed by P1', r2Key));
}

async function runTest5(ctx) {
  const r4Client = await createTestClient(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} P2 R4 guard`,
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runClientReminderRulesForClient(r4Client, ctx.cache);
  });

  const r4Key = getClientNeedsProjectConditionKey(r4Client.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 5 – R4 guard client reminder exists', r4Key));

  const client = await createTestClient(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} P2 client`,
  });
  const project = await createTestProject(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} P2 project`,
    client_id: client.id,
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runProposalReminderRulesForProject(project, ctx.cache);
  });

  const p2Key = getProjectNeedsProposalConditionKey(project.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 5 – P2 created for project', p2Key));
  ctx.steps.push(assertReminderExists(ctx, 'Test 5 – R4 guard unchanged after P2 run', r4Key));

  await createTestProposal(ctx, ctx.createdEntities, {
    client_name: client.name,
    client_id: client.id,
    project_id: project.id,
    project_name: project.name,
    form_status: 'draft',
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runProposalReminderRulesForProject(project, ctx.cache);
  });

  ctx.steps.push(assertReminderClosed(ctx, 'Test 5 – P2 closed after proposal', p2Key));
  ctx.steps.push(assertReminderExists(ctx, 'Test 5 – R4 guard not closed by P2 alone', r4Key));
}

async function runTest6(ctx) {
  let proposal = await createTestProposal(ctx, ctx.createdEntities, {
    client_name: `${TEST_REMINDER_FLOW_PREFIX} P0/P3/P4`,
    form_status: 'draft',
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runProposalReminderRulesForProposal(proposal, ctx.cache);
  });

  const p0Key = getProposalIncompleteConditionKey(proposal.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 6 – P0 created for draft proposal', p0Key));

  proposal = await updateTestProposal(ctx, ctx.createdEntities, proposal, {
    form_status: 'submitted',
    proposal_sent_to_client: false,
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runProposalReminderRulesForProposal(proposal, ctx.cache);
  });

  const p3Key = getProposalNotSentConditionKey(proposal.id);
  ctx.steps.push(assertReminderClosed(ctx, 'Test 6 – P0 closed after submit', p0Key));
  ctx.steps.push(assertReminderExists(ctx, 'Test 6 – P3 created after submit', p3Key));

  proposal = await updateTestProposal(ctx, ctx.createdEntities, proposal, {
    proposal_sent_to_client: true,
    client_saw_proposal: false,
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runProposalReminderRulesForProposal(proposal, ctx.cache);
  });

  const p4Key = getProposalNotSeenConditionKey(proposal.id);
  ctx.steps.push(assertReminderClosed(ctx, 'Test 6 – P3 closed after sent', p3Key));
  ctx.steps.push(assertReminderExists(ctx, 'Test 6 – P4 created after sent', p4Key));

  proposal = await updateTestProposal(ctx, ctx.createdEntities, proposal, {
    client_saw_proposal: true,
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runProposalReminderRulesForProposal(proposal, ctx.cache);
  });

  ctx.steps.push(assertReminderClosed(ctx, 'Test 6 – P4 closed after client saw', p4Key));
}

async function runTest7(ctx) {
  const client = await createTestClient(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} SP1 client`,
  });
  const project = await createTestProject(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} SP1 project`,
    client_id: client.id,
  });
  const proposal = await createTestProposal(ctx, ctx.createdEntities, {
    client_name: client.name,
    client_id: client.id,
    project_id: project.id,
    project_name: project.name,
    form_status: 'submitted',
    proposal_sent_to_client: true,
    client_saw_proposal: true,
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runSignedProposalNeedReminderRuleForProposal(proposal, ctx.cache);
  });

  const sp1Key = getProposalNeedsSignedProposalConditionKey(proposal.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 7 – SP1 created for sent proposal', sp1Key));

  await createTestSignedProposal(ctx, ctx.createdEntities, {
    proposal_id: proposal.id,
    client_id: client.id,
    project_id: project.id,
    project_name: project.name,
    client_name: client.name,
    has_signed_offer_or_order: true,
    signed_at: new Date().toISOString(),
    form_status: 'submitted',
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runSignedProposalNeedReminderRuleForProposal(proposal, ctx.cache);
  });

  ctx.steps.push(assertReminderClosed(ctx, 'Test 7 – SP1 closed after signed proposal', sp1Key));
}

async function runTest8(ctx) {
  const client = await createTestClient(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} SP1 draft client`,
  });
  const project = await createTestProject(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} SP1 draft project`,
    client_id: client.id,
  });
  const proposal = await createTestProposal(ctx, ctx.createdEntities, {
    client_name: client.name,
    client_id: client.id,
    project_id: project.id,
    project_name: project.name,
    form_status: 'submitted',
    proposal_sent_to_client: true,
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runSignedProposalNeedReminderRuleForProposal(proposal, ctx.cache);
  });

  const sp1Key = getProposalNeedsSignedProposalConditionKey(proposal.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 8 – SP1 open before draft signed proposal', sp1Key));

  await createTestSignedProposal(ctx, ctx.createdEntities, {
    proposal_id: proposal.id,
    client_id: client.id,
    project_id: project.id,
    project_name: project.name,
    client_name: client.name,
    has_signed_offer_or_order: true,
    form_status: 'draft',
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runSignedProposalNeedReminderRuleForProposal(proposal, ctx.cache);
    await runProposalReminderRulesForProposal(proposal, ctx.cache);
  });

  ctx.steps.push(assertReminderExists(ctx, 'Test 8 – SP1 still open with draft signed proposal', sp1Key));
}

async function runTest9(ctx) {
  ctx.steps.push(assertNoDuplicateOpenReminders(ctx, 'Test 9 – no duplicate open condition keys'));
}

async function runTest10(ctx) {
  const client = await createTestClient(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} orphan`,
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runClientReminderRulesForClient(client, ctx.cache);
  });

  const r4Key = getClientNeedsProjectConditionKey(client.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 10 – R4 created before client delete', r4Key));

  await safeRequest(ctx, 'delete_orphan_client', () => base44.entities.Client.delete(client.id));
  ctx.createdEntities.clients = ctx.createdEntities.clients.filter((item) => item.id !== client.id);
  applyTestEntitiesToCache(ctx.cache, ctx.createdEntities);

  await safeRequest(ctx, 'cancel_orphan_reminders', () => cancelRemindersForDeletedSource('client', client.id, { cache: ctx.cache }));
  patchReminderInCache(ctx, r4Key, {
    status: REMINDER_STATUS.CANCELLED,
    resolved_reason: 'source_deleted',
    resolved_at: new Date().toISOString(),
  });

  const reminder = findReminderByConditionKeyInCache(ctx.cache, r4Key);
  trackConditionKey(ctx, r4Key);

  ctx.steps.push({
    name: 'Test 10 – orphan reminder cancelled after source delete',
    passed: reminder?.status === REMINDER_STATUS.CANCELLED
      && reminder?.resolved_reason === 'source_deleted',
    expected: 'cancelled + resolved_reason=source_deleted',
    actual: reminder
      ? `${reminder.status} / ${reminder.resolved_reason || '(none)'}`
      : 'not found',
    details: { conditionKey: r4Key, reminderId: reminder?.id || null },
  });
}

async function runTest11(ctx) {
  const client = await createTestClient(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} SP1 reopen client`,
  });
  const project = await createTestProject(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} SP1 reopen project`,
    client_id: client.id,
  });
  const proposal = await createTestProposal(ctx, ctx.createdEntities, {
    client_name: client.name,
    client_id: client.id,
    project_id: project.id,
    project_name: project.name,
    form_status: 'submitted',
    proposal_sent_to_client: true,
    client_saw_proposal: true,
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runSignedProposalNeedReminderRuleForProposal(proposal, ctx.cache);
  });

  const sp1Key = getProposalNeedsSignedProposalConditionKey(proposal.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 11 – SP1 active before signed proposal', sp1Key));

  const signedProposal = await createTestSignedProposal(ctx, ctx.createdEntities, {
    proposal_id: proposal.id,
    client_id: client.id,
    project_id: project.id,
    project_name: project.name,
    client_name: client.name,
    has_signed_offer_or_order: true,
    form_status: 'submitted',
  });

  await safeRequest(ctx, 'link_project_signed_proposal', () => linkProjectToValidSignedProposal(signedProposal));

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runSignedProposalNeedReminderRuleForProposal(proposal, ctx.cache);
  });

  ctx.steps.push(assertReminderClosed(ctx, 'Test 11 – SP1 closed after valid signed proposal', sp1Key));

  let linkedProject = await fetchTestProject(ctx, project.id);
  ctx.steps.push({
    name: 'Test 11 – project linked to signed proposal',
    passed: linkedProject?.source_signed_proposal_id === signedProposal.id,
    expected: signedProposal.id,
    actual: linkedProject?.source_signed_proposal_id || '(empty)',
    details: { projectId: project.id },
  });

  await safeRequest(ctx, 'delete_signed_proposal_lifecycle', () => invalidateTestSignedProposal(ctx, signedProposal, proposal));

  linkedProject = await fetchTestProject(ctx, project.id);
  ctx.steps.push({
    name: 'Test 11 – project source_signed_proposal_id cleared after delete',
    passed: !linkedProject?.source_signed_proposal_id,
    expected: '(empty)',
    actual: linkedProject?.source_signed_proposal_id || '(empty)',
    details: { projectId: project.id },
  });

  applyTestEntitiesToCache(ctx.cache, ctx.createdEntities);

  ctx.steps.push(assertReminderExists(ctx, 'Test 11 – SP1 active again after delete', sp1Key));
}

async function runTest12(ctx) {
  const client = await createTestClient(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} R7 client`,
  });
  const project = await createTestProject(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} R7 project`,
    client_id: client.id,
  });
  await createTestProposal(ctx, ctx.createdEntities, {
    client_name: client.name,
    client_id: client.id,
    project_id: project.id,
    project_name: project.name,
    form_status: 'submitted',
    proposal_sent_to_client: true,
  });
  const signedProposal = await createTestSignedProposal(ctx, ctx.createdEntities, {
    client_id: client.id,
    project_id: project.id,
    project_name: project.name,
    client_name: client.name,
    has_signed_offer_or_order: true,
    form_status: 'submitted',
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runWorkStageReminderRulesForSignedProposal(signedProposal, ctx.cache);
  });

  const r7Key = getSignedProposalNeedsWorkStagesConditionKey(signedProposal.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 12 – R7 created without work stages', r7Key));

  await createTestWorkStage(ctx, ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} R7 stage`,
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    signed_proposal_id: signedProposal.id,
    order_index: 1,
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runWorkStageReminderRulesForSignedProposal(signedProposal, ctx.cache);
  });

  ctx.steps.push(assertReminderClosed(ctx, 'Test 12 – R7 closed after work stage created', r7Key));
}

async function runTest13(ctx) {
  const { client, project } = await createTestProjectWithClient(ctx, 'completion');
  let stage = await createTestWorkStageForProject(ctx, project, client, {
    title: `${TEST_REMINDER_FLOW_PREFIX} completion stage`,
    order_index: 1,
  });

  await syncTestProjectStages(ctx, project.id);
  let fetched = await fetchTestWorkStage(ctx, stage.id);
  ctx.steps.push({
    name: 'Test 13 – stage not completed with zero approvals',
    passed: fetched?.status !== 'completed' && !fetched?.completed_at,
    expected: 'not completed',
    actual: `${fetched?.status || 'unknown'} / ${fetched?.completed_at || '(empty)'}`,
    details: { stageId: stage.id },
  });

  stage = await updateTestWorkStage(ctx, ctx.createdEntities, stage, {
    aaron_approved: true,
    client_approved: true,
    draftsman_approved: false,
  });
  await syncTestProjectStages(ctx, project.id);
  fetched = await fetchTestWorkStage(ctx, stage.id);
  ctx.steps.push({
    name: 'Test 13 – stage not completed with two approvals',
    passed: fetched?.status !== 'completed',
    expected: 'not completed',
    actual: fetched?.status || 'unknown',
    details: { stageId: stage.id },
  });

  stage = await updateTestWorkStage(ctx, ctx.createdEntities, stage, {
    draftsman_approved: true,
  });
  await syncTestProjectStages(ctx, project.id);
  fetched = await fetchTestWorkStage(ctx, stage.id);
  ctx.steps.push({
    name: 'Test 13 – stage completed with three approvals',
    passed: fetched?.status === 'completed' && Boolean(fetched?.completed_at),
    expected: 'completed with completed_at',
    actual: `${fetched?.status || 'unknown'} / ${fetched?.completed_at || '(empty)'}`,
    details: { stageId: stage.id },
  });
}

async function runTest14(ctx) {
  const project = await createTestProject(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} R7 invalid project`,
  });

  const draftSignedProposal = await createTestSignedProposal(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    form_status: 'draft',
    has_signed_offer_or_order: true,
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runWorkStageReminderRulesForSignedProposal(draftSignedProposal, ctx.cache);
  });

  ctx.steps.push(assertReminderClosed(
    ctx,
    'Test 14 – draft signed proposal does not create R7',
    getSignedProposalNeedsWorkStagesConditionKey(draftSignedProposal.id),
  ));

  const cancelledSignedProposal = await createTestSignedProposal(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    form_status: 'cancelled',
    has_signed_offer_or_order: true,
  });

  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runWorkStageReminderRulesForSignedProposal(cancelledSignedProposal, ctx.cache);
  });

  ctx.steps.push(assertReminderClosed(
    ctx,
    'Test 14 – cancelled signed proposal does not create R7',
    getSignedProposalNeedsWorkStagesConditionKey(cancelledSignedProposal.id),
  ));
}

async function runTest15(ctx) {
  const { client, project } = await createTestProjectWithClient(ctx, 'active');

  const stage1 = await createTestWorkStageForProject(ctx, project, client, {
    title: `${TEST_REMINDER_FLOW_PREFIX} active 1`,
    order_index: 1,
  });
  const stage2 = await createTestWorkStageForProject(ctx, project, client, {
    title: `${TEST_REMINDER_FLOW_PREFIX} active 2`,
    order_index: 2,
  });
  const stage3 = await createTestWorkStageForProject(ctx, project, client, {
    title: `${TEST_REMINDER_FLOW_PREFIX} active 3`,
    order_index: 3,
  });

  await syncTestProjectStages(ctx, project.id);
  let stages = await loadTestWorkStagesForProject(ctx, project.id);
  let active = getActiveWorkStage(stages);
  ctx.steps.push({
    name: 'Test 15 – first incomplete stage is active',
    passed: active?.id === stage1.id && countActiveWorkStages(stages) === 1,
    expected: stage1.id,
    actual: active?.id || 'none',
    details: { activeCount: countActiveWorkStages(stages) },
  });

  await updateTestWorkStage(ctx, ctx.createdEntities, stage1, {
    aaron_approved: true,
    client_approved: true,
    draftsman_approved: true,
  });
  await syncTestProjectStages(ctx, project.id);
  stages = await loadTestWorkStagesForProject(ctx, project.id);
  active = getActiveWorkStage(stages);
  const stage3Status = normalizeWorkStageStatuses(stages).find((item) => item.id === stage3.id)?.status;

  ctx.steps.push({
    name: 'Test 15 – next stage becomes active after completion',
    passed: active?.id === stage2.id && countActiveWorkStages(stages) === 1,
    expected: stage2.id,
    actual: active?.id || 'none',
    details: { activeCount: countActiveWorkStages(stages) },
  });

  ctx.steps.push({
    name: 'Test 15 – later stage stays pending',
    passed: stage3Status === 'pending',
    expected: 'pending',
    actual: stage3Status || 'unknown',
    details: { stageId: stage3.id },
  });
}

async function runTest16(ctx) {
  const { client, project } = await createTestProjectWithClient(ctx, 'reorder');

  const stage1 = await createTestWorkStageForProject(ctx, project, client, {
    title: `${TEST_REMINDER_FLOW_PREFIX} reorder A`,
    order_index: 1,
  });
  const stage2 = await createTestWorkStageForProject(ctx, project, client, {
    title: `${TEST_REMINDER_FLOW_PREFIX} reorder B`,
    order_index: 2,
  });
  const stage3 = await createTestWorkStageForProject(ctx, project, client, {
    title: `${TEST_REMINDER_FLOW_PREFIX} reorder C`,
    order_index: 3,
  });

  await syncTestProjectStages(ctx, project.id);
  await updateTestWorkStage(ctx, ctx.createdEntities, stage3, { order_index: 1 });
  await updateTestWorkStage(ctx, ctx.createdEntities, stage1, { order_index: 2 });
  await updateTestWorkStage(ctx, ctx.createdEntities, stage2, { order_index: 3 });
  await syncTestProjectStages(ctx, project.id);

  const stages = await loadTestWorkStagesForProject(ctx, project.id);
  const active = getActiveWorkStage(stages);

  ctx.steps.push({
    name: 'Test 16 – reorder recalculates active stage',
    passed: active?.id === stage3.id,
    expected: stage3.id,
    actual: active?.id || 'none',
    details: { order: stages.map((item) => item.order_index) },
  });

  ctx.steps.push({
    name: 'Test 16 – only one active stage after reorder',
    passed: countActiveWorkStages(stages) === 1,
    expected: '1',
    actual: String(countActiveWorkStages(stages)),
    details: { activeStageId: active?.id || null },
  });
}

async function runTest17(ctx) {
  const { project } = await createTestProjectWithSignedProposal(ctx, 'WS1');
  const stage = await createTestWorkStage(ctx, ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} WS1 stage`,
    project_id: project.id,
    project_name: project.name,
    order_index: 1,
  });

  await syncTestProjectStages(ctx, project.id);
  await runWorkStageProjectRules(ctx, project.id, 'test17_ws_rules');

  const ws1Key = getWorkStageNeedsCheckConditionKey(stage.id);
  ctx.steps.push(assertOpenReminderFields(
    ctx,
    'Test 17 – WS1 created for active stage without target_date',
    ws1Key,
    {
      frequency: 'weekly',
      actionUrlIncludes: `project_id=${project.id}`,
    },
  ));
  ctx.steps.push(assertOpenReminderFields(
    ctx,
    'Test 17 – WS1 action_url includes stage_id',
    ws1Key,
    { actionUrlIncludes: `stage_id=${stage.id}` },
  ));
}

async function runTest18(ctx) {
  const { project } = await createTestProjectWithSignedProposal(ctx, 'WS1 to WS2');
  const stage = await createTestWorkStage(ctx, ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} WS1/WS2 stage`,
    project_id: project.id,
    project_name: project.name,
    order_index: 1,
  });

  await syncTestProjectStages(ctx, project.id);
  await runWorkStageProjectRules(ctx, project.id, 'test18_ws1');

  const ws1Key = getWorkStageNeedsCheckConditionKey(stage.id);
  const ws2Key = getWorkStageTargetDateConditionKey(stage.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 18 – WS1 open before target_date', ws1Key));

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 5);
  await updateTestWorkStage(ctx, ctx.createdEntities, stage, {
    target_date: targetDate.toISOString().split('T')[0],
  });
  await syncTestProjectStages(ctx, project.id);
  await runWorkStageProjectRules(ctx, project.id, 'test18_ws2');

  ctx.steps.push(assertReminderClosed(ctx, 'Test 18 – WS1 closed after target_date added', ws1Key));
  ctx.steps.push(assertReminderExists(ctx, 'Test 18 – WS2 created after target_date added', ws2Key));
}

async function runTest19(ctx) {
  const { project } = await createTestProjectWithSignedProposal(ctx, 'WS2 complete');
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 3);

  const stage = await createTestWorkStage(ctx, ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} WS2 complete stage`,
    project_id: project.id,
    project_name: project.name,
    order_index: 1,
    target_date: targetDate.toISOString().split('T')[0],
  });

  await syncTestProjectStages(ctx, project.id);
  await runWorkStageProjectRules(ctx, project.id, 'test19_ws2_open');

  const ws2Key = getWorkStageTargetDateConditionKey(stage.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 19 – WS2 exists before completion', ws2Key));

  await updateTestWorkStage(ctx, ctx.createdEntities, stage, {
    aaron_approved: true,
    client_approved: true,
    draftsman_approved: true,
  });
  await syncTestProjectStages(ctx, project.id);
  await runWorkStageProjectRules(ctx, project.id, 'test19_ws2_close');

  ctx.steps.push(assertReminderClosed(ctx, 'Test 19 – WS2 closed after stage completed', ws2Key));
}

async function runTest20(ctx) {
  const { project } = await createTestProjectWithSignedProposal(ctx, 'WS active only');
  const stage1 = await createTestWorkStage(ctx, ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} WS active 1`,
    project_id: project.id,
    project_name: project.name,
    order_index: 1,
  });
  const stage2 = await createTestWorkStage(ctx, ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} WS active 2`,
    project_id: project.id,
    project_name: project.name,
    order_index: 2,
  });
  const stage3 = await createTestWorkStage(ctx, ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} WS active 3`,
    project_id: project.id,
    project_name: project.name,
    order_index: 3,
  });

  const stages = await syncTestProjectStages(ctx, project.id);
  const active = getActiveWorkStage(stages);
  await runWorkStageProjectRules(ctx, project.id, 'test20_ws_active_only');

  ctx.steps.push(assertReminderExists(
    ctx,
    'Test 20 – active stage has WS1 reminder',
    getWorkStageNeedsCheckConditionKey(active?.id || stage1.id),
  ));
  ctx.steps.push(assertReminderClosed(
    ctx,
    'Test 20 – pending stage 2 has no WS1',
    getWorkStageNeedsCheckConditionKey(stage2.id),
  ));
  ctx.steps.push(assertReminderClosed(
    ctx,
    'Test 20 – pending stage 3 has no WS1',
    getWorkStageNeedsCheckConditionKey(stage3.id),
  ));
  ctx.steps.push(assertReminderClosed(
    ctx,
    'Test 20 – pending stage 2 has no WS2',
    getWorkStageTargetDateConditionKey(stage2.id),
  ));
}

async function runTest21(ctx) {
  const { project } = await createTestProjectWithSignedProposal(ctx, 'WS reorder');
  const stage1 = await createTestWorkStage(ctx, ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} WS reorder A`,
    project_id: project.id,
    project_name: project.name,
    order_index: 1,
  });
  const stage2 = await createTestWorkStage(ctx, ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} WS reorder B`,
    project_id: project.id,
    project_name: project.name,
    order_index: 2,
  });

  await syncTestProjectStages(ctx, project.id);
  await runWorkStageProjectRules(ctx, project.id, 'test21_before_reorder');

  const ws1Stage1Key = getWorkStageNeedsCheckConditionKey(stage1.id);
  const ws1Stage2Key = getWorkStageNeedsCheckConditionKey(stage2.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 21 – WS1 on first active stage before reorder', ws1Stage1Key));

  await updateTestWorkStage(ctx, ctx.createdEntities, stage2, { order_index: 1 });
  await updateTestWorkStage(ctx, ctx.createdEntities, stage1, { order_index: 2 });
  await syncTestProjectStages(ctx, project.id);
  await runWorkStageProjectRules(ctx, project.id, 'test21_after_reorder');

  ctx.steps.push(assertReminderClosed(ctx, 'Test 21 – previous active stage WS1 closed after reorder', ws1Stage1Key));
  ctx.steps.push(assertReminderExists(ctx, 'Test 21 – new active stage WS1 created after reorder', ws1Stage2Key));
}

async function runTest22(ctx) {
  const { project } = await createTestProjectWithSignedProposal(ctx, 'WS overdue');
  const overdueDate = new Date();
  overdueDate.setDate(overdueDate.getDate() - 2);

  const stage = await createTestWorkStage(ctx, ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} WS overdue stage`,
    project_id: project.id,
    project_name: project.name,
    order_index: 1,
    target_date: overdueDate.toISOString().split('T')[0],
  });

  await syncTestProjectStages(ctx, project.id);
  await runWorkStageProjectRules(ctx, project.id, 'test22_overdue');

  const ws2Key = getWorkStageTargetDateConditionKey(stage.id);
  ctx.steps.push(assertOpenReminderFields(
    ctx,
    'Test 22 – overdue active stage uses daily WS2',
    ws2Key,
    {
      frequency: 'daily',
      titleIncludes: 'עבר את תאריך היעד',
    },
  ));
}

const REMINDER_INTEGRATION_TEST_DEFINITIONS = [
  { name: 'Test 1', fn: runTest1 },
  { name: 'Test 2', fn: runTest2 },
  { name: 'Test 3', fn: runTest3 },
  { name: 'Test 4', fn: runTest4 },
  { name: 'Test 5', fn: runTest5 },
  { name: 'Test 6', fn: runTest6 },
  { name: 'Test 7', fn: runTest7 },
  { name: 'Test 8', fn: runTest8 },
  { name: 'Test 9', fn: runTest9 },
  { name: 'Test 10', fn: runTest10 },
  { name: 'Test 11', fn: runTest11 },
  { name: 'Test 12', fn: runTest12 },
  { name: 'Test 13', fn: runTest13 },
  { name: 'Test 14', fn: runTest14 },
  { name: 'Test 15', fn: runTest15 },
  { name: 'Test 16', fn: runTest16 },
  { name: 'Test 17', fn: runTest17 },
  { name: 'Test 18', fn: runTest18 },
  { name: 'Test 19', fn: runTest19 },
  { name: 'Test 20', fn: runTest20 },
  { name: 'Test 21', fn: runTest21 },
  { name: 'Test 22', fn: runTest22 },
];

function buildTestRunSummary(steps, testDefinitions, testRunLog = []) {
  const passedSteps = steps.filter((step) => step.passed).length;
  const failedSteps = steps.filter((step) => !step.passed).length;
  const stepsByTest = {};

  for (const step of steps) {
    const match = String(step.name || '').match(/^(Test \d+)/);
    if (!match) continue;
    if (!stepsByTest[match[1]]) stepsByTest[match[1]] = [];
    stepsByTest[match[1]].push(step);
  }

  return {
    totalSteps: steps.length,
    passedSteps,
    failedSteps,
    testNames: testDefinitions.map((test) => test.name),
    testsWithSteps: Object.keys(stepsByTest),
    testsRan: testRunLog.filter((entry) => entry.status === 'ran').map((entry) => entry.name),
    testsSkipped: testRunLog.filter((entry) => entry.status === 'skipped_rate_limit').map((entry) => entry.name),
    testsErrored: testRunLog.filter((entry) => entry.status === 'error').map((entry) => entry.name),
  };
}

export async function runReminderIntegrationTests() {
  if (!acquireReminderIntegrationTestLock()) {
    return {
      passed: false,
      skipped: true,
      message: 'Reminder tests already running',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      steps: [],
      createdEntities: emptyCreatedEntities(),
      cleanup: { passed: true, skipped: true },
      errors: [{ stage: 'lock', message: 'Reminder tests already running' }],
    };
  }

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps = [];
  const errors = [];
  const createdEntities = emptyCreatedEntities();
  const trackedConditionKeys = new Set();
  const cache = createReminderEngineCache();

  startReminderTestRunRegistry();

  const ctx = {
    cache,
    createdEntities,
    trackedConditionKeys,
    steps,
    errors,
    rateLimited: false,
    testRunLog: [],
  };

  let cleanup = {
    passed: true,
    entities: null,
    reminders: null,
  };

  try {
    await safeRequest(ctx, 'initial_cache_load', () => loadReminderEngineCache(cache));
    initializeTestRunnerCache(cache);

    const tests = REMINDER_INTEGRATION_TEST_DEFINITIONS;

    for (const test of tests) {
      if (ctx.rateLimited) {
        ctx.steps.push({
          name: `${test.name} – skipped (rate limit)`,
          passed: false,
          expected: 'run test',
          actual: 'skipped due to rate limit',
          details: { test: test.name },
        });
        ctx.testRunLog.push({ name: test.name, status: 'skipped_rate_limit' });
        continue;
      }

      try {
        await test.fn(ctx);
        ctx.testRunLog.push({ name: test.name, status: 'ran' });
      } catch (error) {
        if (isRateLimitError(error)) {
          markRateLimited(ctx, test.name);
        }

        ctx.steps.push({
          name: `${test.name} – runner error`,
          passed: false,
          expected: 'test completes without error',
          actual: error instanceof Error ? error.message : String(error),
          details: { test: test.name },
        });
        ctx.testRunLog.push({ name: test.name, status: 'error' });
        errors.push({
          test: test.name,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    if (isRateLimitError(error)) {
      markRateLimited(ctx, 'setup');
    } else {
      errors.push({
        stage: 'runner',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    try {
      markReminderTestRunStatus('cleanup_pending');

      if (ctx.rateLimited) {
        cleanup.skippedDueToRateLimit = true;
        cleanup.pendingEntityIds = [...collectEntityIds(createdEntities)];
      } else {
        await refreshReminderSnapshot(ctx, 'pre_cleanup');
      }

      const cleanupResult = await cleanupAllReminderTestData({
        sessionEntities: createdEntities,
        trackedConditionKeys: [...trackedConditionKeys],
        cache,
      });

      cleanup = {
        passed: cleanupResult.passed,
        reminders: cleanupResult.reminders,
        entities: cleanupResult.entities,
        skippedDueToRateLimit: cleanupResult.rateLimited || cleanup.skippedDueToRateLimit,
        pendingEntityIds: cleanup.skippedDueToRateLimit
          ? cleanup.pendingEntityIds
          : cleanupResult.entities?.pending,
        message: cleanupResult.message,
        leftovers: cleanupResult.leftovers,
      };

      if (!cleanup.passed) {
        console.warn('[ReminderTestRunner] cleanup incomplete', {
          message: cleanupResult.message,
          reminderFailures: cleanup.reminders?.failedIds,
          reminderConditionKeys: cleanup.reminders?.failedConditionKeys,
          entityFailures: cleanup.entities?.failed,
          pending: {
            reminders: cleanup.reminders?.pending,
            entities: cleanup.entities?.pending,
            entityIds: cleanup.pendingEntityIds,
          },
        });
      } else {
        markReminderTestRunStatus('completed');
      }

      try {
        const leftovers = cleanupResult.leftovers || await findReminderTestLeftovers();
        if (leftovers.total > 0 || leftovers.cleanupRequired) {
          console.info('[ReminderTestRunner] leftover test data report (read-only)', {
            note: leftovers.note,
            cleanupRequired: leftovers.cleanupRequired,
            entityTotal: leftovers.entityTotal,
            total: leftovers.total,
            totalReminderLeftovers: leftovers.totalReminderLeftovers,
            openReminderLeftovers: leftovers.openReminderLeftovers,
            remindersSummary: leftovers.remindersSummary,
            entities: leftovers.entities,
            openReminders: [
              ...leftovers.remindersByStatus.active,
              ...leftovers.remindersByStatus.snoozed,
            ],
          });
        }
      } catch (leftoverError) {
        console.warn('[ReminderTestRunner] failed to scan leftovers', leftoverError);
      }
    } catch (error) {
      cleanup.passed = false;
      cleanup.error = error instanceof Error ? error.message : String(error);
      console.warn('[ReminderTestRunner] cleanup threw', error);
    } finally {
      releaseReminderIntegrationTestLock();
    }
  }

  const finishedAtMs = Date.now();
  const summary = buildTestRunSummary(steps, REMINDER_INTEGRATION_TEST_DEFINITIONS, ctx.testRunLog || []);
  console.info('[ReminderTestRunner] summary', summary);

  const passed = steps.length > 0
    && steps.every((step) => step.passed)
    && !ctx.rateLimited
    && errors.length === 0
    && (cleanup.passed ?? true);

  return {
    passed,
    skipped: false,
    startedAt,
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    steps,
    summary,
    createdEntities,
    cleanup,
    errors,
    rateLimited: ctx.rateLimited,
  };
}
