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
  REMINDER_STATUS,
} from '@/lib/reminderEngine';

export const TEST_REMINDER_FLOW_PREFIX = 'TEST_REMINDER_FLOW';

const OPEN_STATUSES = new Set([REMINDER_STATUS.ACTIVE, REMINDER_STATUS.SNOOZED]);

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

async function refreshReminderSnapshot(cache) {
  cache.reminders = null;
  cache.remindersByConditionKey = null;
  await loadReminderEngineCache(cache);
  return cache;
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
  ctx.rateLimited = true;
  ctx.errors.push({ stage: 'rate_limit', message: 'Rate limit (429) – tests stopped' });
  throw error;
}

async function createTestInquiry(createdEntities, overrides = {}) {
  const inquiry = await base44.entities.Inquiry.create({
    client_name: `${TEST_REMINDER_FLOW_PREFIX} inquiry`,
    building_type: 'office',
    details: '',
    form_status: 'draft',
    ...overrides,
  });
  createdEntities.inquiries.push(inquiry);
  return inquiry;
}

async function updateTestInquiry(createdEntities, inquiry, patch) {
  const updated = await base44.entities.Inquiry.update(inquiry.id, patch);
  const merged = { ...inquiry, ...updated, ...patch };
  const index = createdEntities.inquiries.findIndex((item) => item.id === inquiry.id);
  if (index >= 0) createdEntities.inquiries[index] = merged;
  return merged;
}

async function createTestClient(createdEntities, overrides = {}) {
  const client = await base44.entities.Client.create({
    name: `${TEST_REMINDER_FLOW_PREFIX} client`,
    status: 'draft',
    rating: 'B',
    ...overrides,
  });
  createdEntities.clients.push(client);
  return client;
}

async function createTestProject(createdEntities, overrides = {}) {
  const project = await base44.entities.Project.create({
    name: `${TEST_REMINDER_FLOW_PREFIX} project`,
    client_id: overrides.client_id || '',
    status: 'pricing',
    form_status: 'draft',
    year: new Date().getFullYear(),
    total_amount: 0,
    collected_amount: 0,
    ...overrides,
  });
  createdEntities.projects.push(project);
  return project;
}

async function updateTestProject(createdEntities, project, patch) {
  const updated = await base44.entities.Project.update(project.id, patch);
  const merged = { ...project, ...updated, ...patch };
  const index = createdEntities.projects.findIndex((item) => item.id === project.id);
  if (index >= 0) createdEntities.projects[index] = merged;
  return merged;
}

async function createTestProposal(createdEntities, overrides = {}) {
  const proposal = await base44.entities.Proposal.create({
    client_name: `${TEST_REMINDER_FLOW_PREFIX} proposal`,
    form_status: 'draft',
    proposal_sent_to_client: false,
    client_saw_proposal: false,
    ...overrides,
  });
  createdEntities.proposals.push(proposal);
  return proposal;
}

async function updateTestProposal(createdEntities, proposal, patch) {
  const updated = await base44.entities.Proposal.update(proposal.id, patch);
  const merged = { ...proposal, ...updated, ...patch };
  const index = createdEntities.proposals.findIndex((item) => item.id === proposal.id);
  if (index >= 0) createdEntities.proposals[index] = merged;
  return merged;
}

async function createTestSignedProposal(createdEntities, overrides = {}) {
  const signedProposal = await base44.entities.SignedProposal.create({
    client_name: `${TEST_REMINDER_FLOW_PREFIX} signed`,
    project_name: `${TEST_REMINDER_FLOW_PREFIX} project`,
    has_signed_offer_or_order: false,
    form_status: 'draft',
    ...overrides,
  });
  createdEntities.signedProposals.push(signedProposal);
  return signedProposal;
}

async function createTestWorkStage(createdEntities, overrides = {}) {
  const stage = await base44.entities.WorkStage.create({
    title: `${TEST_REMINDER_FLOW_PREFIX} stage`,
    order_index: 1,
    status: 'pending',
    aaron_approved: false,
    client_approved: false,
    draftsman_approved: false,
    invoice_required_on_completion: false,
    notes: '',
    ...overrides,
  });
  createdEntities.workStages.push(stage);
  return stage;
}

async function updateTestWorkStage(createdEntities, stage, patch) {
  const updated = await base44.entities.WorkStage.update(stage.id, patch);
  const merged = { ...stage, ...updated, ...patch };
  const index = createdEntities.workStages.findIndex((item) => item.id === stage.id);
  if (index >= 0) createdEntities.workStages[index] = merged;
  return merged;
}

async function fetchTestWorkStage(stageId) {
  const results = await base44.entities.WorkStage.filter({ id: stageId });
  return results?.[0] || null;
}

async function runRulesStep(ctx, fn) {
  applyTestEntitiesToCache(ctx.cache, ctx.createdEntities);
  await fn();
  await refreshReminderSnapshot(ctx.cache);
}

async function cleanupTestReminders(createdEntities, trackedConditionKeys, cache) {
  const summary = {
    passed: true,
    cancelled: 0,
    skipped: 0,
    failedIds: [],
    failedConditionKeys: [],
  };

  try {
    await refreshReminderSnapshot(cache);
  } catch (error) {
    summary.passed = false;
    summary.error = error instanceof Error ? error.message : String(error);
    return summary;
  }

  const testSourceIds = collectEntityIds(createdEntities);
  const reminders = cache.reminders || [];

  for (const reminder of reminders) {
    const conditionKey = String(reminder?.condition_key || '').trim();
    const sourceId = reminder?.source_id;
    const isTracked = (
      (conditionKey && trackedConditionKeys.has(conditionKey))
      || (sourceId && testSourceIds.has(sourceId))
    );

    if (!isTracked || !reminder?.id) {
      summary.skipped += 1;
      continue;
    }

    if (!OPEN_STATUSES.has(reminder.status)) {
      summary.skipped += 1;
      continue;
    }

    try {
      await cancelReminder(reminder.id, 'test_cleanup');
      summary.cancelled += 1;
    } catch (error) {
      summary.passed = false;
      summary.failedIds.push(reminder.id);
      if (conditionKey) summary.failedConditionKeys.push(conditionKey);
      console.warn('[ReminderTestRunner] failed to cancel test reminder', reminder.id, error);
    }
  }

  return summary;
}

async function cleanupTestEntities(createdEntities) {
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
    failed: {
      workStages: [],
      signedProposals: [],
      proposals: [],
      projects: [],
      inquiries: [],
      clients: [],
    },
  };

  const deleteEntity = async (bucket, entityName, item, labelField) => {
    if (!item?.id || !isTrackedEntityId(item.id, createdEntities)) return;

    const label = item[labelField] || item.client_name || item.name || '';
    if (label && !isTestLabel(label)) {
      console.warn('[ReminderTestRunner] refusing to delete non-test entity', entityName, item.id, label);
      summary.passed = false;
      summary.failed[bucket]?.push(item.id);
      return;
    }

    try {
      const entity = base44.entities[entityName];
      if (!entity?.delete) return;
      await entity.delete(item.id);
      summary.deleted[bucket]?.push(item.id);
    } catch (error) {
      summary.passed = false;
      summary.failed[bucket]?.push(item.id);
      console.warn('[ReminderTestRunner] failed to delete test entity', entityName, item.id, error);
    }
  };

  for (const item of [...createdEntities.workStages].reverse()) {
    await deleteEntity('workStages', 'WorkStage', item, 'title');
  }

  for (const item of [...createdEntities.signedProposals].reverse()) {
    await deleteEntity('signedProposals', 'SignedProposal', item, 'client_name');
  }

  for (const item of [...createdEntities.proposals].reverse()) {
    await deleteEntity('proposals', 'Proposal', item, 'client_name');
  }

  for (const item of [...createdEntities.projects].reverse()) {
    await deleteEntity('projects', 'Project', item, 'name');
  }

  for (const item of [...createdEntities.inquiries].reverse()) {
    await deleteEntity('inquiries', 'Inquiry', item, 'client_name');
  }

  for (const item of [...createdEntities.clients].reverse()) {
    await deleteEntity('clients', 'Client', item, 'name');
  }

  return summary;
}

async function runTest1(ctx) {
  const inquiry = await createTestInquiry(ctx.createdEntities, {
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

  const submitted = await updateTestInquiry(ctx.createdEntities, inquiry, {
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
  const inquiry = await createTestInquiry(ctx.createdEntities, {
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

  const client = await createTestClient(ctx.createdEntities, {
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

  await createTestProject(ctx.createdEntities, {
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
  const client = await createTestClient(ctx.createdEntities, {
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

  await createTestProject(ctx.createdEntities, {
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
  const inquiry = await createTestInquiry(ctx.createdEntities, {
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

  await createTestProposal(ctx.createdEntities, {
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
  const r4Client = await createTestClient(ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} P2 R4 guard`,
  });

  await runRulesStep(ctx, async () => {
    await runClientReminderRulesForClient(r4Client, ctx.cache);
  });

  const r4Key = getClientNeedsProjectConditionKey(r4Client.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 5 – R4 guard client reminder exists', r4Key));

  const client = await createTestClient(ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} P2 client`,
  });
  const project = await createTestProject(ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} P2 project`,
    client_id: client.id,
  });

  await runRulesStep(ctx, async () => {
    await runProposalReminderRulesForProject(project, ctx.cache);
  });

  const p2Key = getProjectNeedsProposalConditionKey(project.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 5 – P2 created for project', p2Key));
  ctx.steps.push(assertReminderExists(ctx, 'Test 5 – R4 guard unchanged after P2 run', r4Key));

  await createTestProposal(ctx.createdEntities, {
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
  let proposal = await createTestProposal(ctx.createdEntities, {
    client_name: `${TEST_REMINDER_FLOW_PREFIX} P0/P3/P4`,
    form_status: 'draft',
  });

  await runRulesStep(ctx, async () => {
    await runProposalReminderRulesForProposal(proposal, ctx.cache);
  });

  const p0Key = getProposalIncompleteConditionKey(proposal.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 6 – P0 created for draft proposal', p0Key));

  proposal = await updateTestProposal(ctx.createdEntities, proposal, {
    form_status: 'submitted',
    proposal_sent_to_client: false,
  });

  await runRulesStep(ctx, async () => {
    await runProposalReminderRulesForProposal(proposal, ctx.cache);
  });

  const p3Key = getProposalNotSentConditionKey(proposal.id);
  ctx.steps.push(assertReminderClosed(ctx, 'Test 6 – P0 closed after submit', p0Key));
  ctx.steps.push(assertReminderExists(ctx, 'Test 6 – P3 created after submit', p3Key));

  proposal = await updateTestProposal(ctx.createdEntities, proposal, {
    proposal_sent_to_client: true,
    client_saw_proposal: false,
  });

  await runRulesStep(ctx, async () => {
    await runProposalReminderRulesForProposal(proposal, ctx.cache);
  });

  const p4Key = getProposalNotSeenConditionKey(proposal.id);
  ctx.steps.push(assertReminderClosed(ctx, 'Test 6 – P3 closed after sent', p3Key));
  ctx.steps.push(assertReminderExists(ctx, 'Test 6 – P4 created after sent', p4Key));

  proposal = await updateTestProposal(ctx.createdEntities, proposal, {
    client_saw_proposal: true,
  });

  await runRulesStep(ctx, async () => {
    await runProposalReminderRulesForProposal(proposal, ctx.cache);
  });

  ctx.steps.push(assertReminderClosed(ctx, 'Test 6 – P4 closed after client saw', p4Key));
}

async function runTest7(ctx) {
  const client = await createTestClient(ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} SP1 client`,
  });
  const project = await createTestProject(ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} SP1 project`,
    client_id: client.id,
  });
  const proposal = await createTestProposal(ctx.createdEntities, {
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

  await createTestSignedProposal(ctx.createdEntities, {
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
  const client = await createTestClient(ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} SP1 draft client`,
  });
  const project = await createTestProject(ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} SP1 draft project`,
    client_id: client.id,
  });
  const proposal = await createTestProposal(ctx.createdEntities, {
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

  await createTestSignedProposal(ctx.createdEntities, {
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
  const client = await createTestClient(ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} orphan`,
  });

  await runRulesStep(ctx, async () => {
    await runClientReminderRulesForClient(client, ctx.cache);
  });

  const r4Key = getClientNeedsProjectConditionKey(client.id);
  ctx.steps.push(assertReminderExists(ctx, 'Test 10 – R4 created before client delete', r4Key));

  await base44.entities.Client.delete(client.id);
  ctx.createdEntities.clients = ctx.createdEntities.clients.filter((item) => item.id !== client.id);

  await cancelRemindersForDeletedSource('client', client.id, { cache: ctx.cache });
  await refreshReminderSnapshot(ctx.cache);

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

async function fetchTestProject(projectId) {
  const results = await base44.entities.Project.filter({ id: projectId });
  return results?.[0] || null;
}

async function runTest11(ctx) {
  const client = await createTestClient(ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} SP1 reopen client`,
  });
  const project = await createTestProject(ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} SP1 reopen project`,
    client_id: client.id,
  });
  const proposal = await createTestProposal(ctx.createdEntities, {
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

  const signedProposal = await createTestSignedProposal(ctx.createdEntities, {
    proposal_id: proposal.id,
    client_id: client.id,
    project_id: project.id,
    project_name: project.name,
    client_name: client.name,
    has_signed_offer_or_order: true,
    form_status: 'submitted',
  });

  await linkProjectToValidSignedProposal(signedProposal);

  await runRulesStep(ctx, async () => {
    await runSignedProposalNeedReminderRuleForProposal(proposal, ctx.cache);
  });

  ctx.steps.push(assertReminderClosed(ctx, 'Test 11 – SP1 closed after valid signed proposal', sp1Key));

  let linkedProject = await fetchTestProject(project.id);
  ctx.steps.push({
    name: 'Test 11 – project linked to signed proposal',
    passed: linkedProject?.source_signed_proposal_id === signedProposal.id,
    expected: signedProposal.id,
    actual: linkedProject?.source_signed_proposal_id || '(empty)',
    details: { projectId: project.id },
  });

  await deleteSignedProposalWithLifecycle(signedProposal.id);
  ctx.createdEntities.signedProposals = ctx.createdEntities.signedProposals.filter(
    (item) => item.id !== signedProposal.id,
  );

  linkedProject = await fetchTestProject(project.id);
  ctx.steps.push({
    name: 'Test 11 – project source_signed_proposal_id cleared after delete',
    passed: !linkedProject?.source_signed_proposal_id,
    expected: '(empty)',
    actual: linkedProject?.source_signed_proposal_id || '(empty)',
    details: { projectId: project.id },
  });

  applyTestEntitiesToCache(ctx.cache, ctx.createdEntities);
  await refreshReminderSnapshot(ctx.cache);

  ctx.steps.push(assertReminderExists(ctx, 'Test 11 – SP1 active again after delete', sp1Key));
}

async function runTest12(ctx) {
  const client = await createTestClient(ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} R7 client`,
  });
  const project = await createTestProject(ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} R7 project`,
    client_id: client.id,
  });
  await createTestProposal(ctx.createdEntities, {
    client_name: client.name,
    client_id: client.id,
    project_id: project.id,
    project_name: project.name,
    form_status: 'submitted',
    proposal_sent_to_client: true,
  });
  const signedProposal = await createTestSignedProposal(ctx.createdEntities, {
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

  await createTestWorkStage(ctx.createdEntities, {
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
  const project = await createTestProject(ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} completion project`,
  });
  let stage = await createTestWorkStage(ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} completion stage`,
    project_id: project.id,
    project_name: project.name,
    order_index: 1,
  });

  await recalculateProjectWorkStages(project.id);
  let fetched = await fetchTestWorkStage(stage.id);
  ctx.steps.push({
    name: 'Test 13 – stage not completed with zero approvals',
    passed: fetched?.status !== 'completed' && !fetched?.completed_at,
    expected: 'not completed',
    actual: `${fetched?.status || 'unknown'} / ${fetched?.completed_at || '(empty)'}`,
    details: { stageId: stage.id },
  });

  stage = await updateTestWorkStage(ctx.createdEntities, stage, {
    aaron_approved: true,
    client_approved: true,
    draftsman_approved: false,
  });
  await recalculateProjectWorkStages(project.id);
  fetched = await fetchTestWorkStage(stage.id);
  ctx.steps.push({
    name: 'Test 13 – stage not completed with two approvals',
    passed: fetched?.status !== 'completed',
    expected: 'not completed',
    actual: fetched?.status || 'unknown',
    details: { stageId: stage.id },
  });

  stage = await updateTestWorkStage(ctx.createdEntities, stage, {
    draftsman_approved: true,
  });
  await recalculateProjectWorkStages(project.id);
  fetched = await fetchTestWorkStage(stage.id);
  ctx.steps.push({
    name: 'Test 13 – stage completed with three approvals',
    passed: fetched?.status === 'completed' && Boolean(fetched?.completed_at),
    expected: 'completed with completed_at',
    actual: `${fetched?.status || 'unknown'} / ${fetched?.completed_at || '(empty)'}`,
    details: { stageId: stage.id },
  });
}

async function runTest14(ctx) {
  const project = await createTestProject(ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} R7 invalid project`,
  });

  const draftSignedProposal = await createTestSignedProposal(ctx.createdEntities, {
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

  const cancelledSignedProposal = await createTestSignedProposal(ctx.createdEntities, {
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
  const project = await createTestProject(ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} active project`,
  });

  const stage1 = await createTestWorkStage(ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} active 1`,
    project_id: project.id,
    order_index: 1,
  });
  const stage2 = await createTestWorkStage(ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} active 2`,
    project_id: project.id,
    order_index: 2,
  });
  const stage3 = await createTestWorkStage(ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} active 3`,
    project_id: project.id,
    order_index: 3,
  });

  await recalculateProjectWorkStages(project.id);
  let stages = await loadWorkStagesForProject(project.id);
  let active = getActiveWorkStage(stages);
  ctx.steps.push({
    name: 'Test 15 – first incomplete stage is active',
    passed: active?.id === stage1.id && countActiveWorkStages(stages) === 1,
    expected: stage1.id,
    actual: active?.id || 'none',
    details: { activeCount: countActiveWorkStages(stages) },
  });

  await updateTestWorkStage(ctx.createdEntities, stage1, {
    aaron_approved: true,
    client_approved: true,
    draftsman_approved: true,
  });
  await recalculateProjectWorkStages(project.id);
  stages = await loadWorkStagesForProject(project.id);
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
  const project = await createTestProject(ctx.createdEntities, {
    name: `${TEST_REMINDER_FLOW_PREFIX} reorder project`,
  });

  const stage1 = await createTestWorkStage(ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} reorder A`,
    project_id: project.id,
    order_index: 1,
  });
  const stage2 = await createTestWorkStage(ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} reorder B`,
    project_id: project.id,
    order_index: 2,
  });
  const stage3 = await createTestWorkStage(ctx.createdEntities, {
    title: `${TEST_REMINDER_FLOW_PREFIX} reorder C`,
    project_id: project.id,
    order_index: 3,
  });

  await recalculateProjectWorkStages(project.id);
  await updateTestWorkStage(ctx.createdEntities, stage3, { order_index: 1 });
  await updateTestWorkStage(ctx.createdEntities, stage1, { order_index: 2 });
  await updateTestWorkStage(ctx.createdEntities, stage2, { order_index: 3 });
  await recalculateProjectWorkStages(project.id);

  const stages = await loadWorkStagesForProject(project.id);
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
    await loadReminderEngineCache(cache);

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
      ctx.rateLimited = true;
      errors.push({ stage: 'setup', message: 'Rate limit (429)' });
    } else {
      errors.push({
        stage: 'runner',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    try {
      cleanup.reminders = await cleanupTestReminders(
        createdEntities,
        trackedConditionKeys,
        cache,
      );
      cleanup.entities = await cleanupTestEntities(createdEntities);
      cleanup.passed = Boolean(cleanup.reminders?.passed && cleanup.entities?.passed);

      if (!cleanup.passed) {
        console.warn('[ReminderTestRunner] cleanup incomplete', {
          reminderFailures: cleanup.reminders?.failedIds,
          reminderConditionKeys: cleanup.reminders?.failedConditionKeys,
          entityFailures: cleanup.entities?.failed,
        });
      }
    } catch (error) {
      cleanup.passed = false;
      cleanup.error = error instanceof Error ? error.message : String(error);
      console.warn('[ReminderTestRunner] cleanup threw', error);
    }
  }

  const finishedAtMs = Date.now();
  const passed = steps.length > 0
    && steps.every((step) => step.passed)
    && !ctx.rateLimited
    && errors.length === 0;

  return {
    passed,
    startedAt,
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    steps,
    createdEntities,
    cleanup,
    errors,
  };
}
