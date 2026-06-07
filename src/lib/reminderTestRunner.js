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
  runWorkStageActiveReminderRulesForStage,
  runWorkStageReminderRulesForProject,
  runWorkStageReminderRulesForSignedProposal,
} from '@/lib/workStageReminderRules';
import {
  getInvoiceNeedsCollectionConditionKey,
  getInvoiceNeedsPaperlessConditionKey,
  getInvoiceNeedsReceiptConfirmationConditionKey,
  getInvoiceNeedsSendConditionKey,
  getProjectCompletedNeedsInvoiceReviewConditionKey,
  getWorkStageNeedsInvoiceReviewConditionKey,
  runInvoiceReminderRulesForInvoice,
  runWorkStageInvoiceReviewRulesForProject,
} from '@/lib/invoiceReminderRules';
import {
  buildInvoiceCollectionNote,
  getProjectCumulativeInvoiceAmountValidation,
  openProjectCollectionDue,
  sumExistingProjectInvoiceAmounts,
} from '@/lib/projectCollectionDue';
import {
  markCollectionDuePaid,
  openCollectionDueFromInvoice,
} from '@/lib/collectionDueUtils';
import {
  buildProjectDeletionImpact,
  deleteProjectCascade,
} from '@/lib/projectDeletionUtils';
import {
  buildWorkProcessDeletionImpact,
  deleteWorkProcessForProject,
} from '@/lib/workProcessDeletionUtils';
import { matchesExactProjectId } from '@/lib/deletionUtils';
import { serializeWorkStageIds } from '@/lib/invoiceProcessUtils';
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
  findReminderByConditionKey,
  findReminderByConditionKeyInCache,
  hasOpenReminderForConditionKey,
  isRateLimitError,
  loadReminderEngineCache,
  reloadRemindersInCache,
  REMINDER_INTEGRATION_TEST_LOCK_KEY,
  REMINDER_STATUS,
  REMINDER_TEST_CLEANUP_RUNNING_KEY,
  REMINDER_TEST_RATE_LIMIT_AT_KEY,
  REMINDER_TEST_RATE_LIMIT_COOLDOWN_MS,
  upsertReminderInCache,
} from '@/lib/reminderEngine';

export const TEST_REMINDER_FLOW_PREFIX = 'TEST_REMINDER_FLOW';
export const REMINDER_TEST_RUN_STATE_KEY = 'reminderTestRunState';
export const REMINDER_TEST_CLEANUP_RATE_LIMIT_KEY = 'reminderTestCleanupRateLimitedAt';

export const TEST_GROUP = {
  CORE: 'core',
  WORKSTAGES: 'workstages',
  INVOICE: 'invoice',
  COLLECTION: 'collection',
  DELETION: 'deletion',
  DELETION_BASIC: 'deletion_basic',
  DELETION_REMINDER: 'deletion_reminder',
  DELETION_SAFETY: 'deletion_safety',
};

export const TEST_GROUP_LABELS = {
  [TEST_GROUP.CORE]: 'Core Tests',
  [TEST_GROUP.WORKSTAGES]: 'WorkStage Tests',
  [TEST_GROUP.INVOICE]: 'Invoice Tests',
  [TEST_GROUP.COLLECTION]: 'Collection Tests',
  [TEST_GROUP.DELETION]: 'Deletion Tests',
  [TEST_GROUP.DELETION_BASIC]: 'Deletion Basic Tests',
  [TEST_GROUP.DELETION_REMINDER]: 'Deletion E4 Only',
  [TEST_GROUP.DELETION_SAFETY]: 'Deletion E5 Only',
};

const DELETION_TEST_SHORT_LABELS = {
  'Test 40': 'E1',
  'Test 41': 'E2',
  'Test 42': 'E3',
  'Test 43': 'E4',
  'Test 44': 'E5',
};

function isDeletionTestGroup(group) {
  return group === TEST_GROUP.DELETION
    || group === TEST_GROUP.DELETION_BASIC
    || group === TEST_GROUP.DELETION_REMINDER
    || group === TEST_GROUP.DELETION_SAFETY;
}

function isLightweightDeletionTestGroup(group) {
  return group === TEST_GROUP.DELETION_REMINDER
    || group === TEST_GROUP.DELETION_SAFETY;
}

function buildDeletionNotCompleted(testDefinitions = [], testsRan = []) {
  const ran = new Set(testsRan);
  return testDefinitions
    .filter((test) => !ran.has(test.name))
    .map((test) => DELETION_TEST_SHORT_LABELS[test.name] || test.name);
}

function buildDeletionRateLimitRecommendation(group, summary) {
  if (!summary.abortedBecauseRateLimit) return '';

  const notCompleted = summary.notCompleted || [];

  if (group === TEST_GROUP.DELETION) {
    if (notCompleted.includes('E4') || notCompleted.includes('E5')) {
      return 'Wait 2 minutes and run Deletion E4 Only, then E5 Only.';
    }
    return 'Wait 2 minutes and rerun only the failed deletion subgroup.';
  }

  if (group === TEST_GROUP.DELETION_BASIC) {
    return 'Wait 2 minutes and run Deletion E4 Only, then E5 Only.';
  }

  if (group === TEST_GROUP.DELETION_REMINDER) {
    return 'Wait 2 minutes and rerun Deletion E4 Only, then run E5 Only.';
  }

  if (group === TEST_GROUP.DELETION_SAFETY) {
    return 'Wait 2 minutes and rerun Deletion E5 Only.';
  }

  return 'Wait 2 minutes and rerun only the failed group.';
}

const OPEN_STATUSES = new Set([REMINDER_STATUS.ACTIVE, REMINDER_STATUS.SNOOZED]);
const MAX_CLEANUP_MUTATIONS_PER_BATCH = 2;
const CLEANUP_BATCH_DELAY_MS = 1000;
const CLEANUP_SUCCESS_PAUSE_EVERY = 5;
const CLEANUP_SUCCESS_PAUSE_MS = 2000;
const RUN_ALL_SLOW_GROUP_DELAY_MS = 75000;
const STALE_TEST_RUN_THRESHOLD_MS = 30 * 1000;
const CLEANUP_RATE_LIMIT_COOLDOWN_MS = REMINDER_TEST_RATE_LIMIT_COOLDOWN_MS;

const TEST_ENTITY_SCAN_FIELDS = {
  Inquiry: ['client_name', 'notes'],
  Client: ['name'],
  Project: ['name'],
  Proposal: ['client_name', 'project_name', 'document_note', 'notes'],
  SignedProposal: ['client_name', 'project_name', 'notes'],
  WorkStage: ['title', 'project_name', 'client_name', 'notes'],
  InvoiceProcess: ['project_name', 'client_name', 'notes', 'invoice_reference'],
  CollectionDue: ['project_name', 'client_name', 'notes', 'invoice_reference'],
};

const TEST_ENTITY_BUCKETS = [
  { bucket: 'inquiries', entityName: 'Inquiry', labelField: 'client_name' },
  { bucket: 'clients', entityName: 'Client', labelField: 'name' },
  { bucket: 'projects', entityName: 'Project', labelField: 'name' },
  { bucket: 'proposals', entityName: 'Proposal', labelField: 'client_name' },
  { bucket: 'signedProposals', entityName: 'SignedProposal', labelField: 'client_name' },
  { bucket: 'workStages', entityName: 'WorkStage', labelField: 'title' },
  { bucket: 'invoiceProcesses', entityName: 'InvoiceProcess', labelField: 'project_name' },
  { bucket: 'collectionDues', entityName: 'CollectionDue', labelField: 'project_name' },
];

const TEST_ENTITY_DELETE_ORDER = [
  { bucket: 'collectionDues', entityName: 'CollectionDue', labelField: 'project_name' },
  { bucket: 'invoiceProcesses', entityName: 'InvoiceProcess', labelField: 'project_name' },
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

function acquireReminderTestCleanupLock() {
  if (!hasBrowserStorage()) return true;
  try {
    if (globalThis.localStorage.getItem(REMINDER_TEST_CLEANUP_RUNNING_KEY) === 'true') return false;
    globalThis.localStorage.setItem(REMINDER_TEST_CLEANUP_RUNNING_KEY, 'true');
    return true;
  } catch (_error) {
    return true;
  }
}

function releaseReminderTestCleanupLock() {
  if (!hasBrowserStorage()) return;
  try {
    globalThis.localStorage.removeItem(REMINDER_TEST_CLEANUP_RUNNING_KEY);
  } catch (_error) {}
}

export function isReminderTestCleanupRunningLocal() {
  if (!hasBrowserStorage()) return false;
  try {
    return globalThis.localStorage.getItem(REMINDER_TEST_CLEANUP_RUNNING_KEY) === 'true';
  } catch (_error) {
    return false;
  }
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
    invoiceProcesses: [],
    collectionDues: [],
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
      group: parsed.group || null,
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

export function startReminderTestRunRegistry(group = null) {
  const state = {
    runId: createTestRunId(),
    group: group || null,
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

function saveReminderTestRateLimitTimestamp() {
  if (!hasBrowserStorage()) return;
  try {
    const now = String(Date.now());
    globalThis.localStorage.setItem(REMINDER_TEST_RATE_LIMIT_AT_KEY, now);
    globalThis.localStorage.setItem(REMINDER_TEST_CLEANUP_RATE_LIMIT_KEY, now);
  } catch (_error) {}
}

function saveCleanupRateLimitTimestamp() {
  saveReminderTestRateLimitTimestamp();
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
  if (!ctx.rateLimitedAt) ctx.rateLimitedAt = stage;
  if (!ctx.errors.some((item) => item.type === 'rate_limit')) {
    ctx.errors.push({ stage, type: 'rate_limit', message: 'Rate limit hit; wait 2 minutes and rerun' });
  }
  saveReminderTestRateLimitTimestamp();
}

async function safeRequest(ctx, label, fn) {
  if (ctx.rateLimited) {
    throw new Error('Rate limit already hit');
  }

  try {
    return await fn();
  } catch (error) {
    if (isRateLimitError(error)) {
      markRateLimited(ctx, label);
    }
    throw error;
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

  let successCount = 0;

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
        successCount += 1;
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
      successCount += 1;

      if (successCount > 0 && successCount % CLEANUP_SUCCESS_PAUSE_EVERY === 0) {
        await delay(CLEANUP_SUCCESS_PAUSE_MS);
      }
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
    invoiceProcesses: [],
    collectionDues: [],
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
    invoiceProcesses: mergeEntityRecordsById(
      registryIdsToEntityRecords(registryIds.invoiceProcesses, prefixScan?.invoiceProcesses),
      sessionLists.invoiceProcesses,
      prefixScan?.invoiceProcesses,
    ),
    collectionDues: mergeEntityRecordsById(
      registryIdsToEntityRecords(registryIds.collectionDues, prefixScan?.collectionDues),
      sessionLists.collectionDues,
      prefixScan?.collectionDues,
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
  const emptyBucketSummary = () => ({
    collectionDues: [],
    workStages: [],
    signedProposals: [],
    proposals: [],
    projects: [],
    inquiries: [],
    clients: [],
    invoiceProcesses: [],
  });

  const summary = {
    passed: true,
    deleted: emptyBucketSummary(),
    alreadyDeleted: emptyBucketSummary(),
    failed: emptyBucketSummary(),
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

async function runReminderTestCleanupInternal(options = {}) {
  const ctx = createCleanupContext();
  const deepScan = options.deepScan === true;
  const skipLeftoverScan = options.skipLeftoverScan === true;

  if (isReminderTestCleanupRateLimitCooldownActive()) {
    return {
      passed: false,
      rateLimited: true,
      skippedDueToRateLimit: true,
      cleanupStatus: 'pending',
      message: 'Rate limit reached. Cleanup is pending. Wait 2 minutes and run cleanup again.',
      entities: null,
      reminders: null,
    };
  }

  if (!acquireReminderTestCleanupLock()) {
    return {
      passed: false,
      skipped: true,
      message: 'Cleanup already running',
      entities: null,
      reminders: null,
    };
  }

  markReminderTestRunStatus('cleanup_pending');

  const registryState = loadReminderTestRunState();
  let prefixScan = null;

  try {
    if (deepScan) {
      try {
        prefixScan = await scanTestEntitiesByPrefix(ctx);
      } catch (error) {
        if (isRateLimitError(error)) {
          saveCleanupRateLimitTimestamp();
          return {
            passed: false,
            rateLimited: true,
            cleanupStatus: 'pending',
            message: 'Rate limit reached. Cleanup paused. Wait 2 minutes and press Clean Pending Test Data.',
            errors: ctx.errors,
          };
        }
        throw error;
      }
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
          cleanupStatus: 'pending',
          message: 'Rate limit reached. Cleanup paused. Wait 2 minutes and press Clean Pending Test Data.',
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
          cleanupStatus: 'pending',
          message: 'Rate limit reached. Cleanup paused. Wait 2 minutes and press Clean Pending Test Data.',
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
    if (!skipLeftoverScan && !ctx.rateLimited) {
      try {
        leftovers = await findReminderTestLeftovers();
      } catch (leftoverError) {
        console.warn('[ReminderTestRunner] failed to scan leftovers after cleanup', leftoverError);
      }
    }

    return {
      passed,
      rateLimited: ctx.rateLimited,
      cleanupStatus: ctx.rateLimited || !passed ? 'pending' : 'completed',
      message: ctx.rateLimited
        ? 'Rate limit reached. Cleanup paused. Wait 2 minutes and press Clean Pending Test Data.'
        : (passed ? 'Cleanup completed' : 'Cleanup incomplete'),
      reminders,
      entities,
      leftovers,
      errors: ctx.errors,
    };
  } finally {
    releaseReminderTestCleanupLock();
  }
}

export async function cleanupPendingReminderTestData(options = {}) {
  return runReminderTestCleanupInternal({
    ...options,
    deepScan: false,
    skipLeftoverScan: options.skipLeftoverScan ?? false,
  });
}

export async function deepCleanReminderTestData(options = {}) {
  return runReminderTestCleanupInternal({
    ...options,
    deepScan: true,
    skipLeftoverScan: options.skipLeftoverScan ?? false,
  });
}

export async function cleanupAllReminderTestData(options = {}) {
  if (options.deepScan === true) {
    return deepCleanReminderTestData(options);
  }
  return cleanupPendingReminderTestData(options);
}

const emptyCreatedEntities = () => ({
  inquiries: [],
  clients: [],
  projects: [],
  proposals: [],
  signedProposals: [],
  workStages: [],
  invoiceProcesses: [],
  collectionDues: [],
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
  cache.invoiceProcesses = [...createdEntities.invoiceProcesses];
}

function initializeTestRunnerCache(cache) {
  cache.clients = cache.clients ?? [];
  cache.projects = cache.projects ?? [];
  cache.inquiries = cache.inquiries ?? [];
  cache.proposals = cache.proposals ?? [];
  cache.signedProposals = cache.signedProposals ?? [];
  cache.workStages = cache.workStages ?? [];
  cache.invoiceProcesses = cache.invoiceProcesses ?? [];
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

async function runWorkStageInvoiceReviewRules(ctx, projectId, reason = 'work_stage_invoice_review_rules') {
  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runWorkStageInvoiceReviewRulesForProject(projectId, ctx.cache);
  }, reason);
}

async function runInvoiceRulesForRecord(ctx, invoice, reason = 'invoice_rules') {
  await runRuleAndRefreshRemindersOnce(ctx, async () => {
    await runInvoiceReminderRulesForInvoice(invoice, ctx.cache);
  }, reason);
}

async function createTestInvoiceProcess(ctx, createdEntities, overrides = {}) {
  const invoice = await safeRequest(ctx, 'create_invoice_process', () => base44.entities.InvoiceProcess.create({
    project_id: overrides.project_id || '',
    project_name: overrides.project_name || '',
    client_id: overrides.client_id || '',
    client_name: overrides.client_name || `${TEST_REMINDER_FLOW_PREFIX} client`,
    invoice_scope: 'general',
    form_status: 'draft',
    amount: 0,
    invoice_created_in_paperless: false,
    invoice_sent_to_client: false,
    client_confirmed_received: false,
    work_stage_ids: '',
    work_stage_titles: '',
    ...overrides,
  }));
  createdEntities.invoiceProcesses.push(invoice);
  registerTestEntity('invoiceProcesses', invoice.id);
  return invoice;
}

async function updateTestInvoiceProcess(ctx, createdEntities, invoice, patch) {
  const updated = await safeRequest(
    ctx,
    'update_invoice_process',
    () => base44.entities.InvoiceProcess.update(invoice.id, patch),
  );
  const merged = { ...invoice, ...updated, ...patch };
  const index = createdEntities.invoiceProcesses.findIndex((item) => item.id === invoice.id);
  if (index >= 0) createdEntities.invoiceProcesses[index] = merged;
  return merged;
}

async function createTestProjectWithClient(ctx, label, projectOverrides = {}) {
  const client = await createTestClient(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} ${label} client`,
  });
  const project = await createTestProject(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} ${label} project`,
    client_id: client.id,
    client_name: client.name,
    ...projectOverrides,
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

async function prepareInvoiceGroupFixture(ctx) {
  if (ctx.invoiceGroupFixture) return ctx.invoiceGroupFixture;

  const client = await createTestClient(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} invoice-group client`,
  });

  ctx.invoiceGroupFixture = {
    client,
    lifecycleProject: null,
  };

  return ctx.invoiceGroupFixture;
}

async function getInvoiceGroupClient(ctx) {
  const fixture = await prepareInvoiceGroupFixture(ctx);
  return fixture.client;
}

async function createInvoiceGroupProject(ctx, label, overrides = {}) {
  const client = await getInvoiceGroupClient(ctx);
  return createTestProject(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} ${label} project`,
    client_id: client.id,
    client_name: client.name,
    total_amount: 50000,
    collected_amount: 0,
    ...overrides,
  });
}

async function getInvoiceLifecycleProject(ctx) {
  const fixture = await prepareInvoiceGroupFixture(ctx);
  if (!fixture.lifecycleProject) {
    fixture.lifecycleProject = await createInvoiceGroupProject(ctx, 'invoice-lifecycle');
  }
  return { client: fixture.client, project: fixture.lifecycleProject };
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

async function runTest23(ctx) {
  const client = await getInvoiceGroupClient(ctx);
  const project = await createInvoiceGroupProject(ctx, 'WSI1');
  const stage = await createTestWorkStageForProject(ctx, project, client, {
    title: `${TEST_REMINDER_FLOW_PREFIX} invoice required stage`,
    status: 'completed',
    aaron_approved: true,
    client_approved: true,
    draftsman_approved: true,
    invoice_required_on_completion: true,
    completed_at: new Date().toISOString(),
  });

  await syncTestProjectStages(ctx, project.id);
  await runWorkStageInvoiceReviewRules(ctx, project.id, 'test23_before_invoice');

  const wsi1Key = getWorkStageNeedsInvoiceReviewConditionKey(stage.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 23 – WSI1 created for completed stage', wsi1Key));

  await createTestInvoiceProcess(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    invoice_scope: 'stage',
    work_stage_ids: serializeWorkStageIds([stage.id]),
    work_stage_titles: stage.title,
    form_status: 'submitted',
    submitted_at: new Date().toISOString(),
  });

  await runWorkStageInvoiceReviewRules(ctx, project.id, 'test23_after_stage_invoice');
  ctx.steps.push(assertReminderClosed(ctx, 'Test 23 – WSI1 closed after stage invoice', wsi1Key));
}

async function runTest24(ctx) {
  const client = await getInvoiceGroupClient(ctx);
  const project = await createInvoiceGroupProject(ctx, 'general coverage');
  const invoiceSubmittedAt = new Date().toISOString();

  const stageA = await createTestWorkStageForProject(ctx, project, client, {
    title: `${TEST_REMINDER_FLOW_PREFIX} stage A general`,
    status: 'completed',
    aaron_approved: true,
    client_approved: true,
    draftsman_approved: true,
    invoice_required_on_completion: true,
    completed_at: invoiceSubmittedAt,
    order_index: 1,
  });

  await syncTestProjectStages(ctx, project.id);

  await createTestInvoiceProcess(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    invoice_scope: 'general',
    work_stage_titles: 'כללי',
    form_status: 'submitted',
    submitted_at: invoiceSubmittedAt,
  });

  await runWorkStageInvoiceReviewRules(ctx, project.id, 'test24_after_general_invoice');
  ctx.steps.push(assertReminderClosed(
    ctx,
    'Test 24 – stage A covered by general invoice',
    getWorkStageNeedsInvoiceReviewConditionKey(stageA.id),
  ));

  const laterCompletedAt = new Date(Date.now() + 120000).toISOString();
  const stageB = await createTestWorkStageForProject(ctx, project, client, {
    title: `${TEST_REMINDER_FLOW_PREFIX} stage B after general`,
    status: 'completed',
    aaron_approved: true,
    client_approved: true,
    draftsman_approved: true,
    invoice_required_on_completion: true,
    completed_at: laterCompletedAt,
    order_index: 2,
  });

  await syncTestProjectStages(ctx, project.id);
  await runWorkStageInvoiceReviewRules(ctx, project.id, 'test24_stage_b_completed');

  ctx.steps.push(assertReminderExists(
    ctx,
    'Test 24 – stage B needs review after general invoice',
    getWorkStageNeedsInvoiceReviewConditionKey(stageB.id),
  ));
}

async function runTest25(ctx) {
  const client = await getInvoiceGroupClient(ctx);
  const project = await createInvoiceGroupProject(ctx, 'WSI2 final');
  const completedAt = new Date().toISOString();

  await createTestWorkStageForProject(ctx, project, client, {
    title: `${TEST_REMINDER_FLOW_PREFIX} final stage 1`,
    status: 'completed',
    aaron_approved: true,
    client_approved: true,
    draftsman_approved: true,
    completed_at: completedAt,
    order_index: 1,
  });

  await createTestWorkStageForProject(ctx, project, client, {
    title: `${TEST_REMINDER_FLOW_PREFIX} final stage 2`,
    status: 'completed',
    aaron_approved: true,
    client_approved: true,
    draftsman_approved: true,
    completed_at: completedAt,
    order_index: 2,
  });

  await syncTestProjectStages(ctx, project.id);
  await runWorkStageInvoiceReviewRules(ctx, project.id, 'test25_all_completed');

  const wsi2Key = getProjectCompletedNeedsInvoiceReviewConditionKey(project.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 25 – WSI2 created when all stages completed', wsi2Key));

  await createTestInvoiceProcess(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    invoice_scope: 'final_project',
    work_stage_titles: 'חשבונית סופית',
    form_status: 'submitted',
    submitted_at: new Date(Date.now() + 60000).toISOString(),
  });

  await runWorkStageInvoiceReviewRules(ctx, project.id, 'test25_after_final_invoice');
  ctx.steps.push(assertReminderClosed(ctx, 'Test 25 – WSI2 closed after final invoice', wsi2Key));
}

async function runTest26(ctx) {
  const { client, project } = await getInvoiceLifecycleProject(ctx);
  let invoice = await createTestInvoiceProcess(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    form_status: 'submitted',
    submitted_at: new Date().toISOString(),
    invoice_created_in_paperless: false,
  });

  const inv1Key = getInvoiceNeedsPaperlessConditionKey(invoice.id);
  await runInvoiceRulesForRecord(ctx, invoice, 'test26_before_paperless');
  ctx.steps.push(assertReminderExists(ctx, 'Test 26 – INV1 active before Paperless', inv1Key));

  invoice = await updateTestInvoiceProcess(ctx, ctx.createdEntities, invoice, {
    invoice_created_in_paperless: true,
  });
  await runInvoiceRulesForRecord(ctx, invoice, 'test26_after_paperless');
  ctx.steps.push(assertReminderClosed(ctx, 'Test 26 – INV1 closed after Paperless', inv1Key));
}

async function runTest27(ctx) {
  const { client, project } = await getInvoiceLifecycleProject(ctx);
  let invoice = await createTestInvoiceProcess(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    form_status: 'submitted',
    submitted_at: new Date().toISOString(),
    invoice_created_in_paperless: true,
    invoice_sent_to_client: false,
  });

  const inv2Key = getInvoiceNeedsSendConditionKey(invoice.id);
  await runInvoiceRulesForRecord(ctx, invoice, 'test27_before_send');
  ctx.steps.push(assertReminderExists(ctx, 'Test 27 – INV2 active before send', inv2Key));

  invoice = await updateTestInvoiceProcess(ctx, ctx.createdEntities, invoice, {
    invoice_sent_to_client: true,
  });
  await runInvoiceRulesForRecord(ctx, invoice, 'test27_after_send');
  ctx.steps.push(assertReminderClosed(ctx, 'Test 27 – INV2 closed after send', inv2Key));
}

async function runTest28(ctx) {
  const { client, project } = await getInvoiceLifecycleProject(ctx);
  let invoice = await createTestInvoiceProcess(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    form_status: 'submitted',
    submitted_at: new Date().toISOString(),
    invoice_created_in_paperless: true,
    invoice_sent_to_client: true,
    client_confirmed_received: false,
  });

  const inv3Key = getInvoiceNeedsReceiptConfirmationConditionKey(invoice.id);
  await runInvoiceRulesForRecord(ctx, invoice, 'test28_before_confirm');
  ctx.steps.push(assertReminderExists(ctx, 'Test 28 – INV3 active before receipt confirmation', inv3Key));

  invoice = await updateTestInvoiceProcess(ctx, ctx.createdEntities, invoice, {
    client_confirmed_received: true,
  });
  await runInvoiceRulesForRecord(ctx, invoice, 'test28_after_confirm');
  ctx.steps.push(assertReminderClosed(ctx, 'Test 28 – INV3 closed after receipt confirmation', inv3Key));
}

async function runTest29(ctx) {
  const { client, project } = await getInvoiceLifecycleProject(ctx);
  let invoice = await createTestInvoiceProcess(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    form_status: 'submitted',
    submitted_at: new Date().toISOString(),
    invoice_created_in_paperless: true,
    invoice_sent_to_client: true,
    amount: 2500,
    invoice_reference: `${TEST_REMINDER_FLOW_PREFIX}-INV4`,
  });

  const inv4Key = getInvoiceNeedsCollectionConditionKey(invoice.id);
  await runInvoiceRulesForRecord(ctx, invoice, 'test29_before_collection');
  ctx.steps.push(assertReminderExists(ctx, 'Test 29 – INV4 active before collection', inv4Key));

  const collectionNote = buildInvoiceCollectionNote({
    invoiceReference: invoice.invoice_reference,
    workStageTitles: invoice.work_stage_titles,
    invoiceScope: invoice.invoice_scope,
  });

  await safeRequest(ctx, 'open_collection', () => openProjectCollectionDue({
    project,
    amount: invoice.amount,
    note: collectionNote,
    updateProject: (id, payload) => base44.entities.Project.update(id, payload),
  }));

  const updatedProject = await fetchTestProject(ctx, project.id);
  if (updatedProject) {
    const projectIndex = ctx.createdEntities.projects.findIndex((item) => item.id === project.id);
    if (projectIndex >= 0) ctx.createdEntities.projects[projectIndex] = updatedProject;
    applyTestEntitiesToCache(ctx.cache, ctx.createdEntities);
  }

  await runInvoiceRulesForRecord(ctx, invoice, 'test29_after_collection');
  ctx.steps.push(assertReminderClosed(ctx, 'Test 29 – INV4 closed after collection opened', inv4Key));
}

async function runTest30(ctx) {
  const { client, project } = await getInvoiceLifecycleProject(ctx);

  const draftInvoice = await createTestInvoiceProcess(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    form_status: 'draft',
  });

  await runInvoiceRulesForRecord(ctx, draftInvoice, 'test30_draft');
  ctx.steps.push(assertReminderClosed(ctx, 'Test 30 – no INV1 for draft', getInvoiceNeedsPaperlessConditionKey(draftInvoice.id)));
  ctx.steps.push(assertReminderClosed(ctx, 'Test 30 – no INV2 for draft', getInvoiceNeedsSendConditionKey(draftInvoice.id)));
  ctx.steps.push(assertReminderClosed(ctx, 'Test 30 – no INV3 for draft', getInvoiceNeedsReceiptConfirmationConditionKey(draftInvoice.id)));
  ctx.steps.push(assertReminderClosed(ctx, 'Test 30 – no INV4 for draft', getInvoiceNeedsCollectionConditionKey(draftInvoice.id)));

  const cancelledInvoice = await createTestInvoiceProcess(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    form_status: 'cancelled',
    submitted_at: new Date().toISOString(),
    invoice_created_in_paperless: true,
    invoice_sent_to_client: true,
    amount: 1000,
  });

  await runInvoiceRulesForRecord(ctx, cancelledInvoice, 'test30_cancelled');
  ctx.steps.push(assertReminderClosed(ctx, 'Test 30 – no INV1 for cancelled', getInvoiceNeedsPaperlessConditionKey(cancelledInvoice.id)));
  ctx.steps.push(assertReminderClosed(ctx, 'Test 30 – no INV2 for cancelled', getInvoiceNeedsSendConditionKey(cancelledInvoice.id)));
  ctx.steps.push(assertReminderClosed(ctx, 'Test 30 – no INV3 for cancelled', getInvoiceNeedsReceiptConfirmationConditionKey(cancelledInvoice.id)));
  ctx.steps.push(assertReminderClosed(ctx, 'Test 30 – no INV4 for cancelled', getInvoiceNeedsCollectionConditionKey(cancelledInvoice.id)));
}

async function runTest31(ctx) {
  const { client, project } = await getInvoiceLifecycleProject(ctx);

  let invoice = await createTestInvoiceProcess(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    form_status: 'submitted',
    submitted_at: new Date().toISOString(),
    invoice_created_in_paperless: false,
    amount: 1500,
  });

  const inv1Key = getInvoiceNeedsPaperlessConditionKey(invoice.id);
  const inv2Key = getInvoiceNeedsSendConditionKey(invoice.id);
  const inv3Key = getInvoiceNeedsReceiptConfirmationConditionKey(invoice.id);
  const inv4Key = getInvoiceNeedsCollectionConditionKey(invoice.id);

  await runInvoiceRulesForRecord(ctx, invoice, 'test31_step1');
  ctx.steps.push(assertReminderExists(ctx, 'Test 31 – only INV1 open initially', inv1Key));
  ctx.steps.push(assertReminderClosed(ctx, 'Test 31 – INV2 closed initially', inv2Key));
  ctx.steps.push(assertReminderClosed(ctx, 'Test 31 – INV3 closed initially', inv3Key));
  ctx.steps.push(assertReminderClosed(ctx, 'Test 31 – INV4 closed before sent', inv4Key));

  invoice = await updateTestInvoiceProcess(ctx, ctx.createdEntities, invoice, {
    invoice_created_in_paperless: true,
  });
  await runInvoiceRulesForRecord(ctx, invoice, 'test31_step2');
  ctx.steps.push(assertReminderClosed(ctx, 'Test 31 – INV1 closed after created', inv1Key));
  ctx.steps.push(assertReminderExists(ctx, 'Test 31 – only INV2 open after created', inv2Key));
  ctx.steps.push(assertReminderClosed(ctx, 'Test 31 – INV3 still closed after created', inv3Key));

  invoice = await updateTestInvoiceProcess(ctx, ctx.createdEntities, invoice, {
    invoice_sent_to_client: true,
  });
  await runInvoiceRulesForRecord(ctx, invoice, 'test31_step3');
  ctx.steps.push(assertReminderClosed(ctx, 'Test 31 – INV2 closed after sent', inv2Key));
  ctx.steps.push(assertReminderExists(ctx, 'Test 31 – INV3 open after sent', inv3Key));
  ctx.steps.push(assertReminderExists(ctx, 'Test 31 – INV4 open in parallel after sent', inv4Key));
}

async function runTest32(ctx) {
  const project = { id: 'test-project-fee-32', total_amount: 4000 };
  const existingInvoices = [
    {
      id: 'test-invoice-existing-32',
      project_id: project.id,
      form_status: 'submitted',
      amount: 3000,
    },
  ];

  const result = getProjectCumulativeInvoiceAmountValidation({
    project,
    currentAmountValue: 2000,
    projectInvoices: existingInvoices,
    currentInvoiceId: null,
  });

  ctx.steps.push({
    name: 'Test 32 – cumulative invoice amount exceeds project fee',
    passed: result.exceedsProjectFee === true
      && result.existingProjectInvoiceTotal === 3000
      && result.currentAmount === 2000
      && result.overBy === 1000,
    expected: 'exceedsProjectFee=true, existingTotal=3000, currentAmount=2000, overBy=1000',
    actual: JSON.stringify({
      exceedsProjectFee: result.exceedsProjectFee,
      existingProjectInvoiceTotal: result.existingProjectInvoiceTotal,
      currentAmount: result.currentAmount,
      overBy: result.overBy,
    }),
  });
}

async function runTest33(ctx) {
  const project = { id: 'test-project-fee-33', total_amount: 4000 };
  const invoiceId = 'test-invoice-edit-33';
  const existingInvoices = [
    {
      id: invoiceId,
      project_id: project.id,
      form_status: 'submitted',
      amount: 3000,
    },
  ];

  const result = getProjectCumulativeInvoiceAmountValidation({
    project,
    currentAmountValue: 3500,
    projectInvoices: existingInvoices,
    currentInvoiceId: invoiceId,
  });

  ctx.steps.push({
    name: 'Test 33 – editing invoice excludes current invoice from total',
    passed: result.existingProjectInvoiceTotal === 0
      && result.currentAmount === 3500
      && result.exceedsProjectFee === false
      && result.hasIssue === false,
    expected: 'existingTotal=0, currentAmount=3500, no exceed',
    actual: JSON.stringify({
      existingProjectInvoiceTotal: result.existingProjectInvoiceTotal,
      currentAmount: result.currentAmount,
      exceedsProjectFee: result.exceedsProjectFee,
      hasIssue: result.hasIssue,
    }),
  });
}

async function runTest34(ctx) {
  const project = { id: 'test-project-fee-34', total_amount: 4000 };
  const existingInvoices = [
    {
      id: 'test-invoice-cancelled-34',
      project_id: project.id,
      form_status: 'cancelled',
      amount: 3000,
    },
  ];

  const existingTotal = sumExistingProjectInvoiceAmounts(existingInvoices);
  const result = getProjectCumulativeInvoiceAmountValidation({
    project,
    currentAmountValue: 2000,
    projectInvoices: existingInvoices,
    currentInvoiceId: null,
  });

  ctx.steps.push({
    name: 'Test 34 – cancelled invoice ignored in project total',
    passed: existingTotal === 0
      && result.existingProjectInvoiceTotal === 0
      && result.exceedsProjectFee === false,
    expected: 'cancelled invoice not counted, no exceed for 2000',
    actual: JSON.stringify({
      existingTotal,
      existingProjectInvoiceTotal: result.existingProjectInvoiceTotal,
      exceedsProjectFee: result.exceedsProjectFee,
    }),
  });
}

function trackTestCollectionDue(ctx, collectionDue) {
  if (!collectionDue?.id) return;
  ctx.createdEntities.collectionDues.push(collectionDue);
  registerTestEntity('collectionDues', collectionDue.id);
}

async function runTest35(ctx) {
  const { client, project } = await getInvoiceLifecycleProject(ctx);
  const invoice = await createTestInvoiceProcess(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    form_status: 'submitted',
    submitted_at: new Date().toISOString(),
    invoice_created_in_paperless: true,
    invoice_sent_to_client: true,
    amount: 1000,
    invoice_reference: `${TEST_REMINDER_FLOW_PREFIX}-D1`,
  });

  const result = await safeRequest(ctx, 'open_collection_d35', () => openCollectionDueFromInvoice({ invoice }));
  const collectionDue = result?.collectionDue;
  trackTestCollectionDue(ctx, collectionDue);

  const refreshed = await safeRequest(
    ctx,
    'fetch_invoice_d35',
    () => base44.entities.InvoiceProcess.filter({ id: invoice.id }),
  );
  const updatedInvoice = refreshed?.[0];

  ctx.steps.push({
    name: 'Test 35 – Collection D1: open from invoice creates CollectionDue',
    passed: Boolean(collectionDue?.id) && collectionDue.status === 'open',
    expected: 'CollectionDue with status open',
    actual: JSON.stringify({ id: collectionDue?.id, status: collectionDue?.status }),
  });
  ctx.steps.push({
    name: 'Test 35 – Collection D1: invoice.collection_due_id populated',
    passed: String(updatedInvoice?.collection_due_id || '') === String(collectionDue?.id || ''),
    expected: collectionDue?.id || '',
    actual: updatedInvoice?.collection_due_id || '',
  });
  ctx.steps.push({
    name: 'Test 35 – Collection D1: amount_due and remaining_amount',
    passed: Number(collectionDue?.amount_due) === 1000 && Number(collectionDue?.remaining_amount) === 1000,
    expected: 'amount_due=1000, remaining_amount=1000',
    actual: JSON.stringify({
      amount_due: collectionDue?.amount_due,
      remaining_amount: collectionDue?.remaining_amount,
    }),
  });
}

async function runTest36(ctx) {
  const { client, project } = await getInvoiceLifecycleProject(ctx);
  let invoice = await createTestInvoiceProcess(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    form_status: 'submitted',
    submitted_at: new Date().toISOString(),
    invoice_created_in_paperless: true,
    invoice_sent_to_client: true,
    amount: 2500,
    invoice_reference: `${TEST_REMINDER_FLOW_PREFIX}-D2`,
  });

  const inv4Key = getInvoiceNeedsCollectionConditionKey(invoice.id);
  await runInvoiceRulesForRecord(ctx, invoice, 'test36_before_collection');
  ctx.steps.push(assertReminderExists(ctx, 'Test 36 – Collection D2: INV4 active before collection', inv4Key));

  const { collectionDue } = await safeRequest(
    ctx,
    'open_collection_d36',
    () => openCollectionDueFromInvoice({ invoice }),
  );
  trackTestCollectionDue(ctx, collectionDue);

  invoice = await updateTestInvoiceProcess(ctx, ctx.createdEntities, invoice, {
    collection_due_id: collectionDue.id,
  });

  await runInvoiceRulesForRecord(ctx, invoice, 'test36_after_collection');
  ctx.steps.push(assertReminderClosed(ctx, 'Test 36 – Collection D2: INV4 closed after CollectionDue', inv4Key));
}

async function runTest37(ctx) {
  const { client, project } = await getInvoiceLifecycleProject(ctx);
  const invoice = await createTestInvoiceProcess(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    form_status: 'submitted',
    submitted_at: new Date().toISOString(),
    invoice_created_in_paperless: true,
    invoice_sent_to_client: true,
    amount: 1500,
    invoice_reference: `${TEST_REMINDER_FLOW_PREFIX}-D3`,
  });

  const first = await safeRequest(ctx, 'open_collection_d37_first', () => openCollectionDueFromInvoice({ invoice }));
  trackTestCollectionDue(ctx, first?.collectionDue);

  const second = await safeRequest(ctx, 'open_collection_d37_second', () => openCollectionDueFromInvoice({ invoice }));

  const allCollections = await safeRequest(
    ctx,
    'list_collections_d37',
    () => base44.entities.CollectionDue.filter({ invoice_process_id: invoice.id }),
  );
  const nonCancelled = (allCollections || []).filter((item) => item.status !== 'cancelled');

  ctx.steps.push({
    name: 'Test 37 – Collection D3: no duplicate CollectionDue for invoice',
    passed: nonCancelled.length === 1 && second?.collectionDue?.id === first?.collectionDue?.id,
    expected: 'single non-cancelled CollectionDue reused',
    actual: JSON.stringify({
      count: nonCancelled.length,
      firstId: first?.collectionDue?.id,
      secondId: second?.collectionDue?.id,
    }),
  });
}

async function runTest38(ctx) {
  const { client, project } = await getInvoiceLifecycleProject(ctx);
  const invoice = await createTestInvoiceProcess(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    form_status: 'submitted',
    submitted_at: new Date().toISOString(),
    invoice_created_in_paperless: true,
    invoice_sent_to_client: true,
    amount: 1000,
    invoice_reference: `${TEST_REMINDER_FLOW_PREFIX}-D4`,
  });

  const { collectionDue } = await safeRequest(
    ctx,
    'open_collection_d38',
    () => openCollectionDueFromInvoice({ invoice }),
  );
  trackTestCollectionDue(ctx, collectionDue);

  const paid = await safeRequest(ctx, 'mark_collection_paid_d38', () => markCollectionDuePaid(collectionDue));

  ctx.steps.push({
    name: 'Test 38 – Collection D4: mark collection paid',
    passed: paid?.status === 'paid'
      && Number(paid?.amount_paid) === 1000
      && Number(paid?.remaining_amount) === 0
      && Boolean(paid?.paid_at),
    expected: 'status=paid, amount_paid=1000, remaining_amount=0, paid_at set',
    actual: JSON.stringify({
      status: paid?.status,
      amount_paid: paid?.amount_paid,
      remaining_amount: paid?.remaining_amount,
      paid_at: paid?.paid_at,
    }),
  });
}

async function runTest39(ctx) {
  const { client, project } = await getInvoiceLifecycleProject(ctx);
  const invoice = await createTestInvoiceProcess(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    form_status: 'submitted',
    submitted_at: new Date().toISOString(),
    invoice_created_in_paperless: true,
    invoice_sent_to_client: true,
    amount: 1200,
    invoice_reference: `${TEST_REMINDER_FLOW_PREFIX}-D5`,
  });

  await safeRequest(ctx, 'open_collection_d39', () => openCollectionDueFromInvoice({ invoice }));

  let linkedProject = await fetchTestProject(ctx, project.id);
  ctx.steps.push({
    name: 'Test 39 – Collection D5: project.collection_due_now true after open',
    passed: linkedProject?.collection_due_now === true,
    expected: 'collection_due_now=true',
    actual: String(linkedProject?.collection_due_now),
  });

  const collectionsAfterOpen = await safeRequest(
    ctx,
    'list_open_collections_d39',
    () => base44.entities.CollectionDue.filter({ project_id: project.id }),
  );
  const openCollection = (collectionsAfterOpen || []).find(
    (item) => item.status === 'open' || item.status === 'partially_paid',
  );
  if (openCollection) {
    trackTestCollectionDue(ctx, openCollection);
    await safeRequest(ctx, 'mark_collection_paid_d39', () => markCollectionDuePaid(openCollection));
  }

  linkedProject = await fetchTestProject(ctx, project.id);
  const collectionsAfterPaid = await safeRequest(
    ctx,
    'list_collections_after_paid_d39',
    () => base44.entities.CollectionDue.filter({ project_id: project.id }),
  );
  const remainingOpen = (collectionsAfterPaid || []).filter(
    (item) => item.status === 'open' || item.status === 'partially_paid',
  );

  ctx.steps.push({
    name: 'Test 39 – Collection D5: project.collection_due_now false when no open collections',
    passed: remainingOpen.length === 0 ? linkedProject?.collection_due_now === false : true,
    expected: remainingOpen.length === 0 ? 'collection_due_now=false' : 'skipped due to other open collections',
    actual: String(linkedProject?.collection_due_now),
  });
}

async function listTestWorkStagesForProject(projectId) {
  const items = await base44.entities.WorkStage.list();
  return (items || []).filter((item) => matchesExactProjectId(item, projectId));
}

async function createDeletionRichProject(ctx, label) {
  const { client, project, signedProposal } = await createTestProjectWithSignedProposal(ctx, label);
  const proposal = await createTestProposal(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    form_status: 'submitted',
  });
  const stage = await createTestWorkStageForProject(ctx, project, client, {
    title: `${TEST_REMINDER_FLOW_PREFIX} ${label} stage`,
  });
  const invoice = await createTestInvoiceProcess(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    form_status: 'submitted',
    submitted_at: new Date().toISOString(),
    amount: 500,
  });

  const collectionResult = await safeRequest(
    ctx,
    `open_collection_${label}`,
    () => openCollectionDueFromInvoice({ invoice }),
  );
  if (collectionResult?.collectionDue?.id) {
    ctx.createdEntities.collectionDues.push(collectionResult.collectionDue);
    registerTestEntity('collectionDues', collectionResult.collectionDue.id);
  }

  return {
    client,
    project,
    proposal,
    signedProposal,
    stage,
    invoice,
    collectionDue: collectionResult?.collectionDue || null,
  };
}

async function runTest40(ctx) {
  const { client, project: projectA } = await createTestProjectWithClient(ctx, 'deletion-e1-a');
  const { project: projectB } = await createTestProjectWithClient(ctx, 'deletion-e1-b', {
    client_id: client.id,
    client_name: client.name,
  });

  await createTestWorkStageForProject(ctx, projectA, client, {
    title: `${TEST_REMINDER_FLOW_PREFIX} E1-A`,
  });
  await createTestWorkStageForProject(ctx, projectB, client, {
    title: `${TEST_REMINDER_FLOW_PREFIX} E1-B`,
  });

  await safeRequest(ctx, 'delete_work_process_e1', () => deleteWorkProcessForProject(projectA.id));

  const projectAStages = await listTestWorkStagesForProject(projectA.id);
  const projectBStages = await listTestWorkStagesForProject(projectB.id);
  const projectAAfter = await fetchTestProject(ctx, projectA.id);

  ctx.steps.push({
    name: 'Test 40 – Deletion E1: Project A work stages removed',
    passed: projectAStages.length === 0,
    expected: '0 work stages for project A',
    actual: String(projectAStages.length),
  });
  ctx.steps.push({
    name: 'Test 40 – Deletion E1: Project B work stages remain',
    passed: projectBStages.length >= 1,
    expected: 'at least 1 work stage for project B',
    actual: String(projectBStages.length),
  });
  ctx.steps.push({
    name: 'Test 40 – Deletion E1: Project A still exists',
    passed: Boolean(projectAAfter?.id),
    expected: projectA.id,
    actual: projectAAfter?.id || '',
  });
}

async function runTest41(ctx) {
  const fixture = await createDeletionRichProject(ctx, 'deletion-e2');
  const impact = await buildProjectDeletionImpact(fixture.project.id);

  ctx.steps.push({
    name: 'Test 41 – Deletion E2: impact proposal count',
    passed: impact.counts.proposals >= 1,
    expected: '>=1',
    actual: String(impact.counts.proposals),
  });
  ctx.steps.push({
    name: 'Test 41 – Deletion E2: impact signed proposal count',
    passed: impact.counts.signedProposals >= 1,
    expected: '>=1',
    actual: String(impact.counts.signedProposals),
  });
  ctx.steps.push({
    name: 'Test 41 – Deletion E2: impact work stage count',
    passed: impact.counts.workStages >= 1,
    expected: '>=1',
    actual: String(impact.counts.workStages),
  });
  ctx.steps.push({
    name: 'Test 41 – Deletion E2: impact invoice count',
    passed: impact.counts.invoiceProcesses >= 1,
    expected: '>=1',
    actual: String(impact.counts.invoiceProcesses),
  });
  ctx.steps.push({
    name: 'Test 41 – Deletion E2: impact collection due count',
    passed: impact.counts.collectionDues >= 1,
    expected: '>=1',
    actual: String(impact.counts.collectionDues),
  });
}

async function runTest42(ctx) {
  const fixtureA = await createDeletionRichProject(ctx, 'deletion-e3-a');
  const fixtureB = await createDeletionRichProject(ctx, 'deletion-e3-b');

  await safeRequest(ctx, 'cascade_delete_e3', () => deleteProjectCascade(fixtureA.project.id));

  const projectAAfter = await fetchTestProject(ctx, fixtureA.project.id);
  const projectBAfter = await fetchTestProject(ctx, fixtureB.project.id);
  const proposalsA = (await base44.entities.Proposal.list()).filter((item) => matchesExactProjectId(item, fixtureA.project.id));
  const proposalsB = (await base44.entities.Proposal.list()).filter((item) => matchesExactProjectId(item, fixtureB.project.id));
  const stagesA = await listTestWorkStagesForProject(fixtureA.project.id);
  const stagesB = await listTestWorkStagesForProject(fixtureB.project.id);

  ctx.steps.push({
    name: 'Test 42 – Deletion E3: Project A deleted',
    passed: !projectAAfter?.id,
    expected: 'project A missing',
    actual: projectAAfter?.id || 'missing',
  });
  ctx.steps.push({
    name: 'Test 42 – Deletion E3: Project A linked entities removed',
    passed: proposalsA.length === 0 && stagesA.length === 0,
    expected: 'no proposals/work stages for project A',
    actual: JSON.stringify({ proposals: proposalsA.length, stages: stagesA.length }),
  });
  ctx.steps.push({
    name: 'Test 42 – Deletion E3: Project B remains with linked entities',
    passed: Boolean(projectBAfter?.id) && proposalsB.length >= 1 && stagesB.length >= 1,
    expected: 'project B and linked entities remain',
    actual: JSON.stringify({
      projectId: projectBAfter?.id || '',
      proposals: proposalsB.length,
      stages: stagesB.length,
    }),
  });
}

async function runTest43(ctx) {
  const { client, project } = await createTestProjectWithClient(ctx, 'deletion-e4');
  const stage = await createTestWorkStageForProject(ctx, project, client, {
    title: `${TEST_REMINDER_FLOW_PREFIX} E4 stage`,
    status: 'active',
    client_name: client.name,
  });
  const invoice = await createTestInvoiceProcess(ctx, ctx.createdEntities, {
    project_id: project.id,
    project_name: project.name,
    client_id: client.id,
    client_name: client.name,
    form_status: 'submitted',
    submitted_at: new Date().toISOString(),
    invoice_created_in_paperless: true,
    invoice_sent_to_client: true,
    amount: 1000,
  });

  const ws1Key = getWorkStageNeedsCheckConditionKey(stage.id);
  const inv4Key = getInvoiceNeedsCollectionConditionKey(invoice.id);

  trackConditionKey(ctx, ws1Key);
  trackConditionKey(ctx, inv4Key);

  await safeRequest(ctx, 'test43_ws1_only', () => runWorkStageActiveReminderRulesForStage(stage, ctx.cache, {
    activeStageId: stage.id,
  }));
  await safeRequest(ctx, 'test43_inv4_only', () => runInvoiceReminderRulesForInvoice(invoice, ctx.cache));

  const ws1Before = await safeRequest(ctx, 'fetch_ws1_before_e4', () => findReminderByConditionKey(ws1Key));
  const inv4Before = await safeRequest(ctx, 'fetch_inv4_before_e4', () => findReminderByConditionKey(inv4Key));
  const isOpen = (reminder) => (
    reminder?.status === REMINDER_STATUS.ACTIVE || reminder?.status === REMINDER_STATUS.SNOOZED
  );

  ctx.steps.push({
    name: 'Test 43 – Deletion E4: WS1 active before cascade',
    passed: isOpen(ws1Before),
    expected: 'open reminder (active or snoozed)',
    actual: ws1Before?.status || 'not found',
  });
  ctx.steps.push({
    name: 'Test 43 – Deletion E4: INV4 active before cascade',
    passed: isOpen(inv4Before),
    expected: 'open reminder (active or snoozed)',
    actual: inv4Before?.status || 'not found',
  });

  await safeRequest(ctx, 'cascade_delete_e4', () => deleteProjectCascade(project.id));

  const ws1After = await safeRequest(ctx, 'fetch_ws1_e4', () => findReminderByConditionKey(ws1Key));
  const inv4After = await safeRequest(ctx, 'fetch_inv4_e4', () => findReminderByConditionKey(inv4Key));
  const isClosed = (reminder) => (
    reminder?.status === REMINDER_STATUS.RESOLVED || reminder?.status === REMINDER_STATUS.CANCELLED
  );

  ctx.steps.push({
    name: 'Test 43 – Deletion E4: WS1 closed after cascade',
    passed: isClosed(ws1After),
    expected: 'resolved or cancelled',
    actual: ws1After?.status || 'missing',
  });
  ctx.steps.push({
    name: 'Test 43 – Deletion E4: INV4 closed after cascade',
    passed: isClosed(inv4After),
    expected: 'resolved or cancelled',
    actual: inv4After?.status || 'missing',
  });
}

async function runTest44(ctx) {
  const inquiry = await createTestInquiry(ctx, ctx.createdEntities, {
    client_name: `${TEST_REMINDER_FLOW_PREFIX} E5 inquiry`,
    form_status: 'submitted',
  });
  const client = await createTestClient(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} E5 client`,
    source_inquiry_id: inquiry.id,
  });
  const project = await createTestProject(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} E5 project`,
    client_id: client.id,
    client_name: client.name,
  });

  await safeRequest(ctx, 'cascade_delete_e5', () => deleteProjectCascade(project.id));

  const clientsAfter = await safeRequest(ctx, 'fetch_client_e5', () => base44.entities.Client.filter({ id: client.id }));
  const inquiriesAfter = await safeRequest(ctx, 'fetch_inquiry_e5', () => base44.entities.Inquiry.filter({ id: inquiry.id }));

  ctx.steps.push({
    name: 'Test 44 – Deletion E5: client remains after project cascade',
    passed: Boolean(clientsAfter?.[0]?.id),
    expected: client.id,
    actual: clientsAfter?.[0]?.id || '',
  });
  ctx.steps.push({
    name: 'Test 44 – Deletion E5: inquiry remains after project cascade',
    passed: Boolean(inquiriesAfter?.[0]?.id),
    expected: inquiry.id,
    actual: inquiriesAfter?.[0]?.id || '',
  });
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
  { name: 'Test 23', fn: runTest23 },
  { name: 'Test 24', fn: runTest24 },
  { name: 'Test 25', fn: runTest25 },
  { name: 'Test 26', fn: runTest26 },
  { name: 'Test 27', fn: runTest27 },
  { name: 'Test 28', fn: runTest28 },
  { name: 'Test 29', fn: runTest29 },
  { name: 'Test 30', fn: runTest30 },
  { name: 'Test 31', fn: runTest31 },
  { name: 'Test 32', fn: runTest32 },
  { name: 'Test 33', fn: runTest33 },
  { name: 'Test 34', fn: runTest34 },
  { name: 'Test 35', fn: runTest35 },
  { name: 'Test 36', fn: runTest36 },
  { name: 'Test 37', fn: runTest37 },
  { name: 'Test 38', fn: runTest38 },
  { name: 'Test 39', fn: runTest39 },
  { name: 'Test 40', fn: runTest40 },
  { name: 'Test 41', fn: runTest41 },
  { name: 'Test 42', fn: runTest42 },
  { name: 'Test 43', fn: runTest43 },
  { name: 'Test 44', fn: runTest44 },
];

export const REMINDER_TEST_GROUP_DEFINITIONS = {
  [TEST_GROUP.CORE]: {
    key: TEST_GROUP.CORE,
    label: TEST_GROUP_LABELS[TEST_GROUP.CORE],
    tests: REMINDER_INTEGRATION_TEST_DEFINITIONS.slice(0, 11),
  },
  [TEST_GROUP.WORKSTAGES]: {
    key: TEST_GROUP.WORKSTAGES,
    label: TEST_GROUP_LABELS[TEST_GROUP.WORKSTAGES],
    tests: REMINDER_INTEGRATION_TEST_DEFINITIONS.slice(11, 22),
  },
  [TEST_GROUP.INVOICE]: {
    key: TEST_GROUP.INVOICE,
    label: TEST_GROUP_LABELS[TEST_GROUP.INVOICE],
    tests: REMINDER_INTEGRATION_TEST_DEFINITIONS.slice(22, 34),
  },
  [TEST_GROUP.COLLECTION]: {
    key: TEST_GROUP.COLLECTION,
    label: TEST_GROUP_LABELS[TEST_GROUP.COLLECTION],
    tests: REMINDER_INTEGRATION_TEST_DEFINITIONS.slice(34, 39),
  },
  [TEST_GROUP.DELETION]: {
    key: TEST_GROUP.DELETION,
    label: TEST_GROUP_LABELS[TEST_GROUP.DELETION],
    tests: REMINDER_INTEGRATION_TEST_DEFINITIONS.slice(39),
  },
  [TEST_GROUP.DELETION_BASIC]: {
    key: TEST_GROUP.DELETION_BASIC,
    label: TEST_GROUP_LABELS[TEST_GROUP.DELETION_BASIC],
    tests: REMINDER_INTEGRATION_TEST_DEFINITIONS.slice(39, 42),
  },
  [TEST_GROUP.DELETION_REMINDER]: {
    key: TEST_GROUP.DELETION_REMINDER,
    label: TEST_GROUP_LABELS[TEST_GROUP.DELETION_REMINDER],
    tests: REMINDER_INTEGRATION_TEST_DEFINITIONS.slice(42, 43),
  },
  [TEST_GROUP.DELETION_SAFETY]: {
    key: TEST_GROUP.DELETION_SAFETY,
    label: TEST_GROUP_LABELS[TEST_GROUP.DELETION_SAFETY],
    tests: REMINDER_INTEGRATION_TEST_DEFINITIONS.slice(43),
  },
};

/** Groups included in Run All Slowly (Deletion excluded to reduce 429 risk). */
export const REMINDER_TEST_RUN_GROUPS_SLOW = [
  TEST_GROUP.CORE,
  TEST_GROUP.WORKSTAGES,
  TEST_GROUP.INVOICE,
  TEST_GROUP.COLLECTION,
];

/** Primary workflow groups shown first in the test dropup. */
export const REMINDER_TEST_RUN_GROUPS = [...REMINDER_TEST_RUN_GROUPS_SLOW];

/** Deletion groups — run separately to avoid rate limits. */
export const REMINDER_TEST_DELETION_RUN_GROUPS = [
  TEST_GROUP.DELETION,
  TEST_GROUP.DELETION_BASIC,
  TEST_GROUP.DELETION_REMINDER,
  TEST_GROUP.DELETION_SAFETY,
];

/** All runnable groups for Dashboard dropup. */
export const REMINDER_TEST_DASHBOARD_RUN_GROUPS = [
  ...REMINDER_TEST_RUN_GROUPS,
  ...REMINDER_TEST_DELETION_RUN_GROUPS,
];

function buildTestRunSummary(steps, testDefinitions, ctx = {}, group = '') {
  const testRunLog = ctx.testRunLog || [];
  const passedSteps = steps.filter((step) => step.passed).length;
  const failedAssertions = steps.filter((step) => !step.passed).length;
  const stepsByTest = {};

  for (const step of steps) {
    const match = String(step.name || '').match(/^(Test \d+)/);
    if (!match) continue;
    if (!stepsByTest[match[1]]) stepsByTest[match[1]] = [];
    stepsByTest[match[1]].push(step);
  }

  const skippedDueToRateLimit = testRunLog
    .filter((entry) => entry.status === 'skipped_rate_limit')
    .map((entry) => entry.name);

  const runtimeErrors = (ctx.errors || []).filter((item) => item.type !== 'rate_limit');
  const testsRan = testRunLog.filter((entry) => entry.status === 'ran').map((entry) => entry.name);
  const notCompleted = isDeletionTestGroup(group)
    ? buildDeletionNotCompleted(testDefinitions, testsRan)
    : testDefinitions
      .filter((test) => !testsRan.includes(test.name) && !skippedDueToRateLimit.includes(test.name))
      .map((test) => test.name);

  const summary = {
    totalSteps: steps.length,
    passedSteps,
    failedSteps: failedAssertions,
    failedAssertions,
    businessFailures: failedAssertions,
    runtimeErrors: runtimeErrors.length,
    skippedDueToRateLimit,
    abortedBecauseRateLimit: Boolean(ctx.rateLimited),
    rateLimitedAt: ctx.rateLimitedAt || null,
    testNames: testDefinitions.map((test) => test.name),
    testsWithSteps: Object.keys(stepsByTest),
    testsRan,
    testsSkipped: skippedDueToRateLimit,
    testsErrored: testRunLog.filter((entry) => entry.status === 'error').map((entry) => entry.name),
    notCompleted,
    recommendation: '',
  };

  if (isDeletionTestGroup(group)) {
    summary.recommendation = buildDeletionRateLimitRecommendation(group, summary);
  }

  return summary;
}

function buildTestRunResult({
  group,
  startedAtMs,
  steps,
  errors,
  createdEntities,
  cleanup,
  ctx,
  testDefinitions,
  skipped = false,
  message = '',
}) {
  const finishedAtMs = Date.now();
  const summary = buildTestRunSummary(steps, testDefinitions, ctx, group);
  const hasFailedAssertions = summary.failedAssertions > 0;
  const abortedBecauseRateLimit = Boolean(ctx.rateLimited);

  let status = 'passed';
  if (skipped) status = 'skipped';
  else if (abortedBecauseRateLimit) status = 'aborted_rate_limited';
  else if (hasFailedAssertions || summary.runtimeErrors > 0) status = 'failed';

  const passed = status === 'passed';
  const resolvedMessage = message || (
    abortedBecauseRateLimit && isDeletionTestGroup(group)
      ? summary.recommendation
      : abortedBecauseRateLimit
        ? 'Rate limit reached. Wait 2 minutes and rerun only the failed group.'
        : ''
  );

  console.info('[ReminderTestRunner] summary', { group, status, ...summary });

  return {
    passed,
    status,
    group,
    skipped,
    message: resolvedMessage,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    steps,
    summary,
    createdEntities,
    cleanup,
    errors,
    rateLimited: abortedBecauseRateLimit,
    rateLimitedAt: ctx.rateLimitedAt || null,
    cleanupStatus: cleanup?.cleanupStatus || cleanup?.status || (cleanup?.passed ? 'completed' : 'pending'),
  };
}

async function executeReminderTestGroup(group, options = {}) {
  const groupDefinition = REMINDER_TEST_GROUP_DEFINITIONS[group];
  if (!groupDefinition) {
    throw new Error(`Unknown reminder test group: ${group}`);
  }

  const acquireLock = options.acquireLock !== false;
  if (acquireLock && !acquireReminderIntegrationTestLock()) {
    return buildTestRunResult({
      group,
      startedAtMs: Date.now(),
      steps: [],
      errors: [{ stage: 'lock', message: 'Reminder tests already running' }],
      createdEntities: emptyCreatedEntities(),
      cleanup: { passed: true, skipped: true },
      ctx: { testRunLog: [], errors: [], rateLimited: false },
      testDefinitions: groupDefinition.tests,
      skipped: true,
      message: 'Reminder tests already running',
    });
  }

  const startedAtMs = Date.now();
  const steps = [];
  const errors = [];
  const createdEntities = emptyCreatedEntities();
  const trackedConditionKeys = new Set();
  const cache = createReminderEngineCache();

  startReminderTestRunRegistry(group);

  const ctx = {
    cache,
    createdEntities,
    trackedConditionKeys,
    steps,
    errors,
    rateLimited: false,
    rateLimitedAt: null,
    testRunLog: [],
    skippedDueToRateLimit: [],
    invoiceGroupFixture: null,
  };

  let cleanup = {
    passed: true,
    cleanupStatus: 'completed',
    entities: null,
    reminders: null,
  };

  const tests = groupDefinition.tests;
  const lightweightDeletionGroup = isLightweightDeletionTestGroup(group);

  try {
    if (!lightweightDeletionGroup) {
      await safeRequest(ctx, 'initial_cache_load', () => loadReminderEngineCache(cache));
    }
    initializeTestRunnerCache(cache);

    if (group === TEST_GROUP.INVOICE || group === TEST_GROUP.COLLECTION) {
      await prepareInvoiceGroupFixture(ctx);
    }

    for (const test of tests) {
      if (ctx.rateLimited) {
        ctx.testRunLog.push({ name: test.name, status: 'skipped_rate_limit' });
        ctx.skippedDueToRateLimit.push(test.name);
        continue;
      }

      try {
        await test.fn(ctx);
        ctx.testRunLog.push({ name: test.name, status: 'ran' });
      } catch (error) {
        if (isRateLimitError(error) || ctx.rateLimited) {
          markRateLimited(ctx, test.name);
          ctx.testRunLog.push({ name: test.name, status: 'error_rate_limit' });
          errors.push({
            test: test.name,
            type: 'rate_limit',
            message: error instanceof Error ? error.message : String(error),
          });
          break;
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
          type: 'runtime',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    if (isRateLimitError(error)) {
      markRateLimited(ctx, 'setup');
      errors.push({ stage: 'setup', type: 'rate_limit', message: error instanceof Error ? error.message : String(error) });
    } else {
      errors.push({
        stage: 'runner',
        type: 'runtime',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    try {
      if (ctx.rateLimited) {
        markReminderTestRunStatus('cleanup_pending');
        cleanup = {
          passed: false,
          skippedDueToRateLimit: true,
          cleanupStatus: 'pending',
          pendingEntityIds: [...collectEntityIds(createdEntities)],
          message: isDeletionTestGroup(group)
            ? 'Rate limit reached. Wait 2 minutes and rerun only the failed deletion subgroup.'
            : 'Rate limit reached. Cleanup paused. Wait 2 minutes and press Clean Pending Test Data.',
        };
      } else {
        if (!lightweightDeletionGroup) {
          await refreshReminderSnapshot(ctx, 'pre_cleanup');
        }

        const cleanupResult = await cleanupPendingReminderTestData({
          sessionEntities: createdEntities,
          trackedConditionKeys: [...trackedConditionKeys],
          cache,
          skipLeftoverScan: true,
        });

        cleanup = {
          passed: cleanupResult.passed,
          reminders: cleanupResult.reminders,
          entities: cleanupResult.entities,
          skippedDueToRateLimit: cleanupResult.rateLimited,
          cleanupStatus: cleanupResult.cleanupStatus,
          pendingEntityIds: cleanupResult.rateLimited
            ? [...collectEntityIds(createdEntities)]
            : cleanupResult.entities?.pending,
          message: cleanupResult.message,
        };

        if (!cleanup.passed) {
          console.warn('[ReminderTestRunner] cleanup incomplete', {
            group,
            message: cleanupResult.message,
            reminderFailures: cleanup.reminders?.failedIds,
            entityFailures: cleanup.entities?.failed,
          });
        }
      }
    } catch (error) {
      cleanup.passed = false;
      cleanup.cleanupStatus = 'pending';
      cleanup.error = error instanceof Error ? error.message : String(error);
      console.warn('[ReminderTestRunner] cleanup threw', error);
    } finally {
      if (acquireLock) releaseReminderIntegrationTestLock();
    }
  }

  return buildTestRunResult({
    group,
    startedAtMs,
    steps,
    errors,
    createdEntities,
    cleanup,
    ctx,
    testDefinitions: tests,
  });
}

export async function runReminderIntegrationTestGroup(group, options = {}) {
  return executeReminderTestGroup(group, options);
}

export async function runCollectionReminderIntegrationTests(options = {}) {
  return runReminderIntegrationTestGroup(TEST_GROUP.COLLECTION, options);
}

export async function runDeletionReminderIntegrationTests(options = {}) {
  return runReminderIntegrationTestGroup(TEST_GROUP.DELETION, options);
}

export async function runDeletionBasicIntegrationTests(options = {}) {
  return runReminderIntegrationTestGroup(TEST_GROUP.DELETION_BASIC, options);
}

export async function runDeletionReminderOnlyIntegrationTests(options = {}) {
  return runReminderIntegrationTestGroup(TEST_GROUP.DELETION_REMINDER, options);
}

export async function runDeletionSafetyIntegrationTests(options = {}) {
  return runReminderIntegrationTestGroup(TEST_GROUP.DELETION_SAFETY, options);
}

export async function runReminderIntegrationTestsSlowly() {
  if (!acquireReminderIntegrationTestLock()) {
    return buildTestRunResult({
      group: 'all_slow',
      startedAtMs: Date.now(),
      steps: [],
      errors: [{ stage: 'lock', message: 'Reminder tests already running' }],
      createdEntities: emptyCreatedEntities(),
      cleanup: { passed: true, skipped: true },
      ctx: { testRunLog: [], errors: [], rateLimited: false },
      testDefinitions: REMINDER_INTEGRATION_TEST_DEFINITIONS,
      skipped: true,
      message: 'Reminder tests already running',
    });
  }

  const startedAtMs = Date.now();
  const combinedSteps = [];
  const combinedErrors = [];
  const groupResults = [];
  const groupOrder = [...REMINDER_TEST_RUN_GROUPS_SLOW];

  try {
    for (let index = 0; index < groupOrder.length; index += 1) {
      const group = groupOrder[index];
      const result = await executeReminderTestGroup(group, { acquireLock: false });
      groupResults.push(result);
      combinedSteps.push(...result.steps);
      combinedErrors.push(...result.errors);

      if (result.rateLimited || result.status === 'aborted_rate_limited') {
        return {
          ...result,
          group: 'all_slow',
          groupResults,
          steps: combinedSteps,
          errors: combinedErrors,
          message: 'Rate limit reached. Wait 2 minutes and rerun only the failed group.',
          startedAt: new Date(startedAtMs).toISOString(),
          durationMs: Date.now() - startedAtMs,
        };
      }

      const cleanupResult = await cleanupPendingReminderTestData({ skipLeftoverScan: true });
      if (cleanupResult.rateLimited) {
        saveReminderTestRateLimitTimestamp();
        return buildTestRunResult({
          group: 'all_slow',
          startedAtMs,
          steps: combinedSteps,
          errors: [...combinedErrors, {
            stage: `cleanup_${group}`,
            type: 'rate_limit',
            message: cleanupResult.message,
          }],
          createdEntities: emptyCreatedEntities(),
          cleanup: cleanupResult,
          ctx: {
            testRunLog: [],
            errors: combinedErrors,
            rateLimited: true,
            rateLimitedAt: `cleanup_after_${group}`,
          },
          testDefinitions: REMINDER_INTEGRATION_TEST_DEFINITIONS,
          message: 'Rate limit reached. Wait 2 minutes and rerun only the failed group.',
        });
      }

      if (index < groupOrder.length - 1) {
        await delay(RUN_ALL_SLOW_GROUP_DELAY_MS);
      }
    }
  } finally {
    releaseReminderIntegrationTestLock();
  }

  const allPassed = groupResults.every((result) => result.passed);
  return buildTestRunResult({
    group: 'all_slow',
    startedAtMs,
    steps: combinedSteps,
    errors: combinedErrors,
    createdEntities: emptyCreatedEntities(),
    cleanup: { passed: allPassed, cleanupStatus: allPassed ? 'completed' : 'pending' },
    ctx: {
      testRunLog: groupResults.flatMap((result) => result.summary?.testsRan?.map((name) => ({ name, status: 'ran' })) || []),
      errors: combinedErrors,
      rateLimited: false,
    },
    testDefinitions: REMINDER_INTEGRATION_TEST_DEFINITIONS,
  });
}

export async function runReminderIntegrationTests() {
  return runReminderIntegrationTestsSlowly();
}
