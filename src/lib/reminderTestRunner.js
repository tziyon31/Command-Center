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
import {
  deleteSignedProposalWithLifecycle,
  linkProjectToValidSignedProposal,
} from '@/lib/signedProposalLifecycle';
import {
  getSignedProposalNeedsWorkStagesConditionKey,
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
  REMINDER_INTEGRATION_TEST_LOCK_KEY,
  REMINDER_STATUS,
} from '@/lib/reminderEngine';

export const TEST_REMINDER_FLOW_PREFIX = 'TEST_REMINDER_FLOW';

const OPEN_STATUSES = new Set([REMINDER_STATUS.ACTIVE, REMINDER_STATUS.SNOOZED]);
const MAX_CLEANUP_MUTATIONS_PER_BATCH = 5;
const CLEANUP_BATCH_DELAY_MS = 400;
const RATE_LIMIT_RETRY_DELAY_MS = 1500;

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

function isNotFoundError(error) {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;
  const message = error instanceof Error ? error.message : String(error || '');
  return status === 404 || /not found/i.test(message);
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
        summary.pending.push(item);
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
    total: 0,
  };

  const matchesPrefix = (value) => String(value || '').includes(TEST_REMINDER_FLOW_PREFIX);

  const scanEntities = async (entityName, bucket, fields) => {
    const entity = base44.entities[entityName];
    if (!entity?.list) return;

    const items = await entity.list();
    for (const item of items) {
      const matched = fields.some((field) => matchesPrefix(item?.[field]));
      if (matched && item?.id) {
        report[bucket].push({ id: item.id, label: fields.map((f) => item[f]).filter(Boolean).join(' / ') });
      }
    }
  };

  await Promise.all([
    scanEntities('Inquiry', 'inquiries', ['client_name']),
    scanEntities('Client', 'clients', ['name']),
    scanEntities('Project', 'projects', ['name']),
    scanEntities('Proposal', 'proposals', ['client_name']),
    scanEntities('SignedProposal', 'signedProposals', ['client_name', 'project_name']),
    scanEntities('WorkStage', 'workStages', ['title', 'project_name', 'client_name']),
  ]);

  const reminders = await base44.entities.Reminder.list();
  for (const reminder of reminders) {
    const matched = (
      matchesPrefix(reminder?.title)
      || matchesPrefix(reminder?.description)
      || matchesPrefix(reminder?.client_name)
      || matchesPrefix(reminder?.project_name)
      || matchesPrefix(reminder?.condition_key)
    );
    if (matched && reminder?.id) {
      report.reminders.push({
        id: reminder.id,
        condition_key: reminder.condition_key,
        status: reminder.status,
      });
    }
  }

  report.total = (
    report.inquiries.length
    + report.clients.length
    + report.projects.length
    + report.proposals.length
    + report.signedProposals.length
    + report.workStages.length
    + report.reminders.length
  );

  return report;
}

const emptyCreatedEntities = () => ({
  inquiries: [],
  clients: [],
  projects: [],
  proposals: [],
  signedProposals: [],
  workStages: [],
});

const isTestLabel = (value) => String(value || '').startsWith(TEST_REMINDER_FLOW_PREFIX);

const collectEntityIds = (createdEntities) => {
  const ids = new Set();
  for (const group of Object.values(createdEntities)) {
    for (const item of group) {
      if (item?.id) ids.add(item.id);
    }
  }
  return ids;
};

const isTrackedEntityId = (id, createdEntities) => collectEntityIds(createdEntities).has(id);

function applyTestEntitiesToCache(cache, createdEntities) {
  cache.inquiries = [...createdEntities.inquiries];
  cache.clients = [...createdEntities.clients];
  cache.projects = [...createdEntities.projects];
  cache.proposals = [...createdEntities.proposals];
  cache.signedProposals = [...createdEntities.signedProposals];
  cache.workStages = [...createdEntities.workStages];
}

async function refreshReminderSnapshot(ctx, reason = 'checkpoint') {
  if (ctx.rateLimited) return ctx.cache;
  ctx.cache.reminders = null;
  ctx.cache.remindersByConditionKey = null;
  await safeRequest(ctx, `refresh_reminders:${reason}`, () => loadReminderEngineCache(ctx.cache));
  return ctx.cache;
}

function trackConditionKey(ctx, conditionKey) {
  if (conditionKey) ctx.trackedConditionKeys.add(String(conditionKey).trim());
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

async function runRulesStep(ctx, fn, reason = 'rules') {
  if (ctx.rateLimited) return;
  applyTestEntitiesToCache(ctx.cache, ctx.createdEntities);
  await safeRequest(ctx, reason, fn);
  await refreshReminderSnapshot(ctx, reason);
}

async function cleanupTestReminders(ctx, createdEntities, trackedConditionKeys) {
  const summary = {
    passed: true,
    cancelled: 0,
    skipped: 0,
    alreadyDeleted: 0,
    failedIds: [],
    failedConditionKeys: [],
    pending: [],
  };

  if (ctx.rateLimited) {
    summary.passed = false;
    summary.skippedDueToRateLimit = true;
    return summary;
  }

  await refreshReminderSnapshot(ctx, 'cleanup_reminders_start');

  const testSourceIds = collectEntityIds(createdEntities);
  const reminders = (ctx.cache.reminders || []).filter((reminder) => {
    const conditionKey = String(reminder?.condition_key || '').trim();
    const sourceId = reminder?.source_id;
    const isTracked = (
      (conditionKey && trackedConditionKeys.has(conditionKey))
      || (sourceId && testSourceIds.has(sourceId))
    );
    return isTracked && reminder?.id && OPEN_STATUSES.has(reminder.status);
  });

  const batchSummary = await runBatchedCleanup(ctx, reminders, async (reminder) => {
    const conditionKey = String(reminder?.condition_key || '').trim();

    try {
      await safeRequest(ctx, 'cancel_test_reminder', () => cancelReminder(reminder.id, 'test_cleanup'));
      summary.cancelled += 1;
      return { ok: true, status: 'deleted', id: reminder.id };
    } catch (error) {
      if (isNotFoundError(error)) {
        return { ok: true, status: 'already_deleted', id: reminder.id };
      }
      if (isRateLimitError(error)) {
        markRateLimited(ctx, 'cleanup_reminders');
        return { ok: false, status: 'rate_limited', id: reminder.id };
      }
      summary.failedIds.push(reminder.id);
      if (conditionKey) summary.failedConditionKeys.push(conditionKey);
      return { ok: false, status: 'failed', id: reminder.id, error };
    }
  });

  summary.passed = batchSummary.passed && summary.failedIds.length === 0;
  summary.pending = batchSummary.pending.map((item) => item.id);
  summary.skipped = batchSummary.skipped;

  return summary;
}

async function cleanupTestEntities(ctx, createdEntities) {
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
    summary.skippedDueToRateLimit = true;
    return summary;
  }

  const deleteTrackedEntity = async (bucket, entityName, item, labelField) => {
    if (!item?.id || !isTrackedEntityId(item.id, createdEntities)) {
      return { ok: true, status: 'skipped', id: item?.id, entityName };
    }

    const label = item[labelField] || item.client_name || item.name || '';
    if (label && !isTestLabel(label)) {
      console.warn('[ReminderTestRunner] refusing to delete non-test entity', entityName, item.id, label);
      summary.passed = false;
      summary.failed[bucket]?.push(item.id);
      return { ok: false, status: 'failed', id: item.id, entityName };
    }

    return safeDeleteEntity(ctx, entityName, item.id);
  };

  const cleanupGroups = [
    { bucket: 'workStages', entityName: 'WorkStage', items: [...createdEntities.workStages].reverse(), labelField: 'title' },
    { bucket: 'signedProposals', entityName: 'SignedProposal', items: [...createdEntities.signedProposals].reverse(), labelField: 'client_name' },
    { bucket: 'proposals', entityName: 'Proposal', items: [...createdEntities.proposals].reverse(), labelField: 'client_name' },
    { bucket: 'projects', entityName: 'Project', items: [...createdEntities.projects].reverse(), labelField: 'name' },
    { bucket: 'inquiries', entityName: 'Inquiry', items: [...createdEntities.inquiries].reverse(), labelField: 'client_name' },
    { bucket: 'clients', entityName: 'Client', items: [...createdEntities.clients].reverse(), labelField: 'name' },
  ];

  for (const group of cleanupGroups) {
    const batchSummary = await runBatchedCleanup(ctx, group.items, async (item) => {
      const result = await deleteTrackedEntity(group.bucket, group.entityName, item, group.labelField);
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

async function runTest1(ctx) {
  const inquiry = await createTestInquiry(ctx, ctx.createdEntities, {
    client_name: `${TEST_REMINDER_FLOW_PREFIX} R1`,
    details: '',
    form_status: 'draft',
  });

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
    await runProposalReminderRulesForInquiry(inquiry, ctx.cache);
  });

  ctx.steps.push(assertReminderClosed(ctx, 'Test 4 – P1 closed after proposal', p1Key));
  ctx.steps.push(assertReminderExists(ctx, 'Test 4 – R2 not closed by P1', r2Key));
}

async function runTest5(ctx) {
  const r4Client = await createTestClient(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} P2 R4 guard`,
  });

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
    await runProposalReminderRulesForProposal(proposal, ctx.cache);
  });

  const p0Key = getProposalIncompleteConditionKey(proposal.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 6 – P0 created for draft proposal', p0Key));

  proposal = await updateTestProposal(ctx, ctx.createdEntities, proposal, {
    form_status: 'submitted',
    proposal_sent_to_client: false,
  });

  await runRulesStep(ctx, async () => {
    await runProposalReminderRulesForProposal(proposal, ctx.cache);
  });

  const p3Key = getProposalNotSentConditionKey(proposal.id);
  ctx.steps.push(assertReminderClosed(ctx, 'Test 6 – P0 closed after submit', p0Key));
  ctx.steps.push(assertReminderExists(ctx, 'Test 6 – P3 created after submit', p3Key));

  proposal = await updateTestProposal(ctx, ctx.createdEntities, proposal, {
    proposal_sent_to_client: true,
    client_saw_proposal: false,
  });

  await runRulesStep(ctx, async () => {
    await runProposalReminderRulesForProposal(proposal, ctx.cache);
  });

  const p4Key = getProposalNotSeenConditionKey(proposal.id);
  ctx.steps.push(assertReminderClosed(ctx, 'Test 6 – P3 closed after sent', p3Key));
  ctx.steps.push(assertReminderExists(ctx, 'Test 6 – P4 created after sent', p4Key));

  proposal = await updateTestProposal(ctx, ctx.createdEntities, proposal, {
    client_saw_proposal: true,
  });

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
    await runClientReminderRulesForClient(client, ctx.cache);
  });

  const r4Key = getClientNeedsProjectConditionKey(client.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 10 – R4 created before client delete', r4Key));

  await safeRequest(ctx, 'delete_orphan_client', () => base44.entities.Client.delete(client.id));
  ctx.createdEntities.clients = ctx.createdEntities.clients.filter((item) => item.id !== client.id);

  await safeRequest(ctx, 'cancel_orphan_reminders', () => cancelRemindersForDeletedSource('client', client.id, { cache: ctx.cache }));
  await refreshReminderSnapshot(ctx, 'test10_orphan');

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

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
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

  await safeRequest(ctx, 'delete_signed_proposal_lifecycle', () => deleteSignedProposalWithLifecycle(signedProposal.id));
  ctx.createdEntities.signedProposals = ctx.createdEntities.signedProposals.filter(
    (item) => item.id !== signedProposal.id,
  );

  linkedProject = await fetchTestProject(ctx, project.id);
  ctx.steps.push({
    name: 'Test 11 – project source_signed_proposal_id cleared after delete',
    passed: !linkedProject?.source_signed_proposal_id,
    expected: '(empty)',
    actual: linkedProject?.source_signed_proposal_id || '(empty)',
    details: { projectId: project.id },
  });

  applyTestEntitiesToCache(ctx.cache, ctx.createdEntities);
  await refreshReminderSnapshot(ctx, 'test11_after_delete');

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

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
    await runWorkStageReminderRulesForSignedProposal(signedProposal, ctx.cache);
  });

  ctx.steps.push(assertReminderClosed(ctx, 'Test 12 – R7 closed after work stage created', r7Key));
}

async function runTest13(ctx) {
  const project = await createTestProject(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} completion project`,
  });
  let stage = await createTestWorkStage(ctx, ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} completion stage`,
    project_id: project.id,
    project_name: project.name,
    order_index: 1,
  });

  await recalculateTestProjectWorkStages(ctx, project.id);
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
  await recalculateTestProjectWorkStages(ctx, project.id);
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
  await recalculateTestProjectWorkStages(ctx, project.id);
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

  await runRulesStep(ctx, async () => {
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

  await runRulesStep(ctx, async () => {
    await runWorkStageReminderRulesForSignedProposal(cancelledSignedProposal, ctx.cache);
  });

  ctx.steps.push(assertReminderClosed(
    ctx,
    'Test 14 – cancelled signed proposal does not create R7',
    getSignedProposalNeedsWorkStagesConditionKey(cancelledSignedProposal.id),
  ));
}

async function runTest15(ctx) {
  const project = await createTestProject(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} active project`,
  });

  const stage1 = await createTestWorkStage(ctx, ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} active 1`,
    project_id: project.id,
    order_index: 1,
  });
  const stage2 = await createTestWorkStage(ctx, ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} active 2`,
    project_id: project.id,
    order_index: 2,
  });
  const stage3 = await createTestWorkStage(ctx, ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} active 3`,
    project_id: project.id,
    order_index: 3,
  });

  await recalculateTestProjectWorkStages(ctx, project.id);
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
  await recalculateTestProjectWorkStages(ctx, project.id);
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
  const project = await createTestProject(ctx, ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} reorder project`,
  });

  const stage1 = await createTestWorkStage(ctx, ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} reorder A`,
    project_id: project.id,
    order_index: 1,
  });
  const stage2 = await createTestWorkStage(ctx, ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} reorder B`,
    project_id: project.id,
    order_index: 2,
  });
  const stage3 = await createTestWorkStage(ctx, ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} reorder C`,
    project_id: project.id,
    order_index: 3,
  });

  await recalculateTestProjectWorkStages(ctx, project.id);
  await updateTestWorkStage(ctx, ctx.createdEntities, stage3, { order_index: 1 });
  await updateTestWorkStage(ctx, ctx.createdEntities, stage1, { order_index: 2 });
  await updateTestWorkStage(ctx, ctx.createdEntities, stage2, { order_index: 3 });
  await recalculateTestProjectWorkStages(ctx, project.id);

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

  const ctx = {
    cache,
    createdEntities,
    trackedConditionKeys,
    steps,
    errors,
    rateLimited: false,
  };

  let cleanup = {
    passed: true,
    entities: null,
    reminders: null,
  };

  try {
    await safeRequest(ctx, 'initial_cache_load', () => loadReminderEngineCache(cache));

    const tests = [
      runTest1,
      runTest2,
      runTest3,
      runTest4,
      runTest5,
      runTest6,
      runTest7,
      runTest8,
      runTest9,
      runTest10,
      runTest11,
      runTest12,
      runTest13,
      runTest14,
      runTest15,
      runTest16,
    ];

    for (const testFn of tests) {
      if (ctx.rateLimited) break;

      try {
        await testFn(ctx);
      } catch (error) {
        await guardRateLimit(error, ctx);
        errors.push({
          test: testFn.name,
          message: error instanceof Error ? error.message : String(error),
        });
        break;
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
      if (!ctx.rateLimited) {
        cleanup.reminders = await cleanupTestReminders(ctx, createdEntities, trackedConditionKeys);
        cleanup.entities = await cleanupTestEntities(ctx, createdEntities);
      } else {
        cleanup.skippedDueToRateLimit = true;
        cleanup.pendingEntityIds = [...collectEntityIds(createdEntities)];
      }

      cleanup.passed = Boolean(
        (cleanup.reminders?.passed ?? true)
        && (cleanup.entities?.passed ?? true)
        && !(cleanup.reminders?.pending?.length)
        && !(cleanup.entities?.pending?.length),
      );

      if (!cleanup.passed) {
        console.warn('[ReminderTestRunner] cleanup incomplete', {
          reminderFailures: cleanup.reminders?.failedIds,
          reminderConditionKeys: cleanup.reminders?.failedConditionKeys,
          entityFailures: cleanup.entities?.failed,
          pending: {
            reminders: cleanup.reminders?.pending,
            entities: cleanup.entities?.pending,
            entityIds: cleanup.pendingEntityIds,
          },
        });
      }

      try {
        const leftovers = await findReminderTestLeftovers();
        if (leftovers.total > 0) {
          console.info('[ReminderTestRunner] leftover test data report (read-only)', leftovers);
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
    createdEntities,
    cleanup,
    errors,
    rateLimited: ctx.rateLimited,
  };
}
