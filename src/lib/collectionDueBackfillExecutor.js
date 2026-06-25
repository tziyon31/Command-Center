import { api as base44 } from '@/api/apiClient';
import { runCollectionDueBackfillPreview } from '@/lib/collectionDueBackfillPreview';
import { isRateLimitError } from '@/lib/reminderEngine';

export const BACKFILL_APPROVED_CONFIRM_TEXT = 'CREATE_COLLECTION_DUE_BACKFILL_APPROVED';

const REAL_BACKFILL_APPROVAL_MESSAGE = (
  'Real backfill execution requires explicit business approval confirmation.'
);

const MERLOG_PROJECT_ID = '69eb6b5f9ae59e23cdf769ad';
const MERLOG_REAL_EVENT_ID = '6a063b51354cb9a5b178aa1e';
const MERLOG_LEGACY_EVENT_ID = '6a06d69264bf214f0935064f';
const MERLOG_PAID_AT = '2026-05-14T21:14:56.656Z';

const MERLOG_MANUAL_MIGRATION_NOTE = (
  'Manual migration resolution approved by business owner: Merlog reflected correctly as 6000 collected. '
  + 'Non-legacy CollectionEvent migrated; legacy duplicate intentionally skipped.'
);

const CREATE_DELAY_MS = 750;

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

function canExecuteRealBackfill(options = {}) {
  return options.dryRun === false
    && options.businessApproval === true
    && options.confirmText === BACKFILL_APPROVED_CONFIRM_TEXT;
}

function getManualApprovedPaidCandidates(project = null) {
  return [{
    kind: 'paid_from_collection_event_manual_resolution',
    willCreate: true,
    confidence: 'high',
    source_entity_type: 'collection_event',
    source_entity_id: MERLOG_REAL_EVENT_ID,
    project_id: MERLOG_PROJECT_ID,
    project_name: project?.name || 'מרלוג גבעת ברנר (מגרש 201)',
    client_id: project?.client_id || '',
    client_name: project?.client_name || '',
    amount_due: 6000,
    amount_paid: 6000,
    remaining_amount: 0,
    status: 'paid',
    payment_received: true,
    payment_received_at: MERLOG_PAID_AT,
    tax_invoice_sent_to_client: true,
    tax_invoice_sent_at: MERLOG_PAID_AT,
    paid_at: MERLOG_PAID_AT,
    source_type: 'collection_event',
    notes: '',
    migration_note: MERLOG_MANUAL_MIGRATION_NOTE,
  }];
}

function getManualSkippedDuplicates() {
  return [{
    source_entity_type: 'collection_event',
    source_entity_id: MERLOG_LEGACY_EVENT_ID,
    project_id: MERLOG_PROJECT_ID,
    project_name: 'מרלוג גבעת ברנר (מגרש 201)',
    reason: 'Legacy duplicate skipped after business approval. Project collected_amount is 6000.',
  }];
}

function buildExistingSourceIndex(collectionDues = []) {
  const bySourceKey = new Map();

  for (const record of collectionDues || []) {
    const sourceType = String(record?.source_entity_type || '').trim();
    const sourceId = String(record?.source_entity_id || '').trim();
    if (!sourceType || !sourceId) continue;
    bySourceKey.set(`${sourceType}:${sourceId}`, record);
  }

  return bySourceKey;
}

function validateSafeCandidate(candidate, label) {
  const reasons = [];

  if (candidate?.willCreate !== true) {
    reasons.push(`${label}: willCreate is not true`);
  }
  if (candidate?.confidence !== 'high') {
    reasons.push(`${label}: confidence is not high`);
  }
  if (!String(candidate?.project_id || '').trim()) {
    reasons.push(`${label}: missing project_id`);
  }
  if (toNumber(candidate?.amount_due) <= 0) {
    reasons.push(`${label}: amount_due is not positive`);
  }
  if (!String(candidate?.source_entity_type || '').trim()) {
    reasons.push(`${label}: missing source_entity_type`);
  }
  if (!String(candidate?.source_entity_id || '').trim()) {
    reasons.push(`${label}: missing source_entity_id`);
  }

  return reasons;
}

function runPreviewSafetyChecks(preview) {
  const blockReasons = [];

  if ((preview?.invalidCandidates || []).length > 0) {
    blockReasons.push(`invalidCandidates.length=${preview.invalidCandidates.length} (expected 0)`);
  }
  if ((preview?.excludedAsTest || []).length > 0) {
    blockReasons.push(`excludedAsTest.length=${preview.excludedAsTest.length} (expected 0)`);
  }
  if ((preview?.skippedExisting || []).length > 0) {
    blockReasons.push(`preview.skippedExisting.length=${preview.skippedExisting.length} (expected 0 before execution)`);
  }

  return blockReasons;
}

function buildPlannedPaidPayload(candidate, migratedAt) {
  const paidAt = candidate.paid_at || candidate.payment_received_at || '';

  return {
    invoice_process_id: '',
    invoice_reference: '',
    project_id: candidate.project_id,
    project_name: candidate.project_name || '',
    client_id: candidate.client_id || '',
    client_name: candidate.client_name || '',
    amount_due: toNumber(candidate.amount_due),
    amount_paid: toNumber(candidate.amount_paid),
    remaining_amount: 0,
    due_date: '',
    opened_at: paidAt,
    paid_at: paidAt,
    status: 'paid',
    source_type: candidate.source_type || 'collection_event',
    work_stage_ids: '',
    work_stage_titles: '',
    notes: candidate.notes || '',
    form_status: 'submitted',
    payment_received: true,
    payment_received_at: candidate.payment_received_at || paidAt,
    tax_invoice_sent_to_client: true,
    tax_invoice_sent_at: candidate.tax_invoice_sent_at || paidAt,
    tax_invoice_reference: '',
    source_entity_type: candidate.source_entity_type || 'collection_event',
    source_entity_id: candidate.source_entity_id,
    migrated_at: migratedAt,
    migration_note: candidate.migration_note || '',
  };
}

function buildPlannedOpenPayload(candidate, migratedAt) {
  const overdue = candidate.overdue === true;

  return {
    invoice_process_id: '',
    invoice_reference: '',
    project_id: candidate.project_id,
    project_name: candidate.project_name || '',
    client_id: candidate.client_id || '',
    client_name: candidate.client_name || '',
    amount_due: toNumber(candidate.amount_due),
    amount_paid: 0,
    remaining_amount: toNumber(candidate.remaining_amount),
    due_date: candidate.due_date || '',
    opened_at: candidate.opened_at || migratedAt,
    paid_at: '',
    status: 'open',
    source_type: 'project_legacy_open',
    work_stage_ids: '',
    work_stage_titles: '',
    notes: candidate.notes || '',
    form_status: 'submitted',
    payment_received: false,
    payment_received_at: '',
    tax_invoice_sent_to_client: false,
    tax_invoice_sent_at: '',
    tax_invoice_reference: '',
    source_entity_type: 'project_legacy_open',
    source_entity_id: candidate.source_entity_id,
    migrated_at: migratedAt,
    migration_note: overdue
      ? 'Open legacy collection migrated from Project collection_due fields. Original due date is overdue.'
      : 'Open legacy collection migrated from Project collection_due fields.',
  };
}

function buildRequiresReviewUntouched(preview) {
  const review = preview?.requiresReview || {};
  return [
    ...(review.duplicateOrMismatchedCollectionEvents || []).map((item) => ({
      category: 'duplicateOrMismatchedCollectionEvents',
      ...item,
    })),
    ...(review.ambiguousCollectedAmountCandidates || []).map((item) => ({
      category: 'ambiguousCollectedAmountCandidates',
      ...item,
    })),
    ...(review.invoiceToCollectionCandidates || []).map((item) => ({
      category: 'invoiceToCollectionCandidates',
      ...item,
    })),
  ];
}

function filterRequiresReviewUntouched(items, includeApprovedManualResolutions) {
  if (!includeApprovedManualResolutions) return items;
  return items.filter((item) => item.project_id !== MERLOG_PROJECT_ID);
}

function printBackfillReport(result, { dryRun }) {
  const title = dryRun ? 'CollectionDue Backfill Dry Run' : 'CollectionDue Backfill Execution';
  console.group(title);

  if (result.manualApprovedPaidCreates?.length) {
    console.table(result.manualApprovedPaidCreates.map((item) => ({
      source_entity_id: item.source_entity_id,
      project_id: item.project_id,
      project_name: item.project_name,
      amount_due: item.amount_due,
      status: item.status,
      kind: item.kind,
    })));
  }

  console.table((result.plannedPaidCreates || []).map((item) => ({
    source_entity_type: item.source_entity_type,
    source_entity_id: item.source_entity_id,
    project_id: item.project_id,
    project_name: item.project_name,
    amount_due: item.amount_due,
    status: item.status,
  })));

  console.table((result.plannedOpenCreates || []).map((item) => ({
    source_entity_type: item.source_entity_type,
    source_entity_id: item.source_entity_id,
    project_id: item.project_id,
    project_name: item.project_name,
    amount_due: item.amount_due,
    status: item.status,
    migration_note: item.migration_note,
  })));

  if (result.manualSkippedDuplicates?.length) {
    console.table(result.manualSkippedDuplicates);
  }

  if (result.skippedExisting?.length) {
    console.table(result.skippedExisting);
  }

  if (result.requiresReviewUntouched?.length) {
    console.table(result.requiresReviewUntouched.map((item) => ({
      category: item.category,
      project_id: item.project_id,
      project_name: item.project_name,
      reason: item.reason,
    })));
  }

  if (result.created?.length) {
    console.table(result.created);
  }

  if (result.failed?.length) {
    console.warn('failed', result.failed);
    console.table(result.failed);
  }

  console.log('summary', result.summary);
  console.groupEnd();
}

function buildEmptyResult(overrides = {}) {
  return {
    status: 'blocked',
    realExecutionEnabled: false,
    dryRun: true,
    plannedCreates: [],
    plannedPaidCreates: [],
    plannedOpenCreates: [],
    manualApprovedPaidCreates: [],
    manualSkippedDuplicates: [],
    skippedExisting: [],
    created: [],
    failed: [],
    stoppedBecauseRateLimit: false,
    blocked: true,
    blockReasons: [],
    requiresReviewUntouched: [],
    summary: {
      plannedCreatesCount: 0,
      plannedPaidCreatesCount: 0,
      plannedPaidCreatesTotal: 0,
      plannedOpenCreatesCount: 0,
      plannedOpenCreatesTotal: 0,
      manualApprovedCreatesCount: 0,
      manualSkippedDuplicatesCount: 0,
      skippedExistingCount: 0,
      requiresReviewCount: 0,
      requiresReviewUntouchedCount: 0,
      createdCount: 0,
      failedCount: 0,
      invalidCandidatesCount: 0,
      excludedAsTestCount: 0,
    },
    ...overrides,
  };
}

function applyMaxCreates(plannedPaid, plannedOpen, maxCreates) {
  let paid = [...plannedPaid];
  let open = [...plannedOpen];
  let combined = [...paid, ...open];

  if (maxCreates !== null && maxCreates >= 0 && combined.length > maxCreates) {
    combined = combined.slice(0, maxCreates);
    paid = combined.filter((item) => item.status === 'paid');
    open = combined.filter((item) => item.status === 'open');
  }

  return {
    plannedPaid: paid,
    plannedOpen: open,
    plannedCreates: [...paid, ...open],
  };
}

function buildSummary({
  plannedCreates,
  plannedPaid,
  plannedOpen,
  manualApprovedPaidCreates,
  manualSkippedDuplicates,
  skippedExisting,
  requiresReviewUntouched,
  preview,
  created = [],
  failed = [],
}) {
  const plannedPaidCreatesTotal = plannedPaid.reduce(
    (sum, item) => sum + toNumber(item.amount_due),
    0,
  );
  const plannedOpenCreatesTotal = plannedOpen.reduce(
    (sum, item) => sum + toNumber(item.amount_due),
    0,
  );

  return {
    plannedCreatesCount: plannedCreates.length,
    plannedPaidCreatesCount: plannedPaid.length,
    plannedPaidCreatesTotal,
    plannedOpenCreatesCount: plannedOpen.length,
    plannedOpenCreatesTotal,
    manualApprovedCreatesCount: manualApprovedPaidCreates.length,
    manualSkippedDuplicatesCount: manualSkippedDuplicates.length,
    skippedExistingCount: skippedExisting.length,
    requiresReviewCount: requiresReviewUntouched.length,
    requiresReviewUntouchedCount: requiresReviewUntouched.length,
    createdCount: created.length,
    failedCount: failed.length,
    invalidCandidatesCount: (preview?.invalidCandidates || []).length,
    excludedAsTestCount: (preview?.excludedAsTest || []).length,
  };
}

async function buildBackfillPlan(options = {}) {
  const dryRun = options.dryRun !== false;
  const includeApprovedManualResolutions = options.includeApprovedManualResolutions === true;
  const maxCreates = Number.isFinite(options.maxCreates) ? options.maxCreates : null;

  const preview = await runCollectionDueBackfillPreview({ entities: base44.entities });
  const allRequiresReview = buildRequiresReviewUntouched(preview);
  const requiresReviewUntouched = filterRequiresReviewUntouched(
    allRequiresReview,
    includeApprovedManualResolutions,
  );

  const blockReasons = [...runPreviewSafetyChecks(preview)];
  const candidateBlockReasons = [];

  for (const candidate of preview.safeToMigrate?.paidFromCollectionEvents || []) {
    candidateBlockReasons.push(
      ...validateSafeCandidate(candidate, `paid:${candidate.source_entity_id}`),
    );
  }
  for (const candidate of preview.safeToMigrate?.openFromProjectLegacy || []) {
    candidateBlockReasons.push(
      ...validateSafeCandidate(candidate, `open:${candidate.source_entity_id}`),
    );
  }

  if (includeApprovedManualResolutions) {
    for (const candidate of getManualApprovedPaidCandidates()) {
      candidateBlockReasons.push(
        ...validateSafeCandidate(candidate, `manual:${candidate.source_entity_id}`),
      );
    }

    const merlogInReview = allRequiresReview.some(
      (item) => item.project_id === MERLOG_PROJECT_ID,
    );
    if (!merlogInReview) {
      blockReasons.push('includeApprovedManualResolutions=true but Merlog is not in requiresReview');
    }

    if (requiresReviewUntouched.length > 0) {
      blockReasons.push(
        `requiresReviewUntouched.length=${requiresReviewUntouched.length} after Merlog resolution`,
      );
    }
  }

  if (!dryRun && !includeApprovedManualResolutions) {
    blockReasons.push('Real execution requires includeApprovedManualResolutions: true');
  }

  if (!dryRun && requiresReviewUntouched.length > 0) {
    blockReasons.push(
      `requiresReviewUntouched.length=${requiresReviewUntouched.length} must be 0 before execution`,
    );
  }

  blockReasons.push(...candidateBlockReasons);

  if (blockReasons.length > 0) {
    return {
      blocked: true,
      blockReasons,
      preview,
      requiresReviewUntouched,
      allRequiresReview,
    };
  }

  const existingCollectionDues = base44.entities.CollectionDue?.list
    ? await base44.entities.CollectionDue.list()
    : [];
  const existingSourceIndex = buildExistingSourceIndex(existingCollectionDues);
  const migratedAt = new Date().toISOString();

  const skippedExisting = [];
  const plannedPaidCreates = [];
  const plannedOpenCreates = [];
  const manualApprovedPaidCreates = [];
  const manualSkippedDuplicates = includeApprovedManualResolutions
    ? getManualSkippedDuplicates()
    : [];

  const planCandidate = (candidate, builder, targetList) => {
    const sourceKey = `${candidate.source_entity_type}:${candidate.source_entity_id}`;
    const existing = existingSourceIndex.get(sourceKey);

    if (existing) {
      skippedExisting.push({
        source_entity_type: candidate.source_entity_type,
        source_entity_id: candidate.source_entity_id,
        project_id: candidate.project_id,
        existing_collection_due_id: existing.id,
        reason: 'CollectionDue already exists for source',
      });
      return;
    }

    targetList.push(builder(candidate, migratedAt));
  };

  for (const candidate of preview.safeToMigrate?.paidFromCollectionEvents || []) {
    planCandidate(candidate, buildPlannedPaidPayload, plannedPaidCreates);
  }

  if (includeApprovedManualResolutions) {
    const merlogProject = (await base44.entities.Project.list())
      .find((project) => project.id === MERLOG_PROJECT_ID);

    for (const candidate of getManualApprovedPaidCandidates(merlogProject)) {
      const payload = buildPlannedPaidPayload(candidate, migratedAt);
      manualApprovedPaidCreates.push({
        ...candidate,
        plannedPayload: payload,
      });
      planCandidate(candidate, buildPlannedPaidPayload, plannedPaidCreates);
    }
  }

  for (const candidate of preview.safeToMigrate?.openFromProjectLegacy || []) {
    planCandidate(candidate, buildPlannedOpenPayload, plannedOpenCreates);
  }

  const trimmed = applyMaxCreates(plannedPaidCreates, plannedOpenCreates, maxCreates);

  return {
    blocked: false,
    preview,
    requiresReviewUntouched,
    allRequiresReview,
    skippedExisting,
    manualApprovedPaidCreates,
    manualSkippedDuplicates,
    plannedPaidCreates: trimmed.plannedPaid,
    plannedOpenCreates: trimmed.plannedOpen,
    plannedCreates: trimmed.plannedCreates,
  };
}

async function executeCreates(plannedCreates, { entities = base44.entities } = {}) {
  const created = [];
  const failed = [];
  let stoppedBecauseRateLimit = false;

  for (const payload of plannedCreates) {
    try {
      const record = await entities.CollectionDue.create(payload);
      created.push({
        id: record?.id,
        source_entity_type: payload.source_entity_type,
        source_entity_id: payload.source_entity_id,
        project_id: payload.project_id,
        project_name: payload.project_name,
        amount_due: payload.amount_due,
        status: payload.status,
      });
      await delay(CREATE_DELAY_MS);
    } catch (error) {
      if (isRateLimitError(error)) {
        stoppedBecauseRateLimit = true;
        failed.push({
          source_entity_type: payload.source_entity_type,
          source_entity_id: payload.source_entity_id,
          project_id: payload.project_id,
          error: error instanceof Error ? error.message : String(error),
          rateLimited: true,
        });
        break;
      }

      failed.push({
        source_entity_type: payload.source_entity_type,
        source_entity_id: payload.source_entity_id,
        project_id: payload.project_id,
        error: error instanceof Error ? error.message : String(error),
        rateLimited: false,
      });
    }
  }

  return { created, failed, stoppedBecauseRateLimit };
}

export async function runCollectionDueBackfill(options = {}) {
  const dryRun = options.dryRun !== false;
  const realExecutionApproved = canExecuteRealBackfill(options);

  if (!dryRun && !realExecutionApproved) {
    const result = buildEmptyResult({
      blockReasons: [REAL_BACKFILL_APPROVAL_MESSAGE],
      dryRunRequested: false,
    });
    console.warn('[CollectionDueBackfill]', REAL_BACKFILL_APPROVAL_MESSAGE);
    return result;
  }

  const plan = await buildBackfillPlan({ ...options, dryRun });

  if (plan.blocked) {
    const result = buildEmptyResult({
      blockReasons: plan.blockReasons,
      requiresReviewUntouched: plan.requiresReviewUntouched || [],
      previewSummary: plan.preview?.summary,
      summary: {
        plannedCreatesCount: 0,
        plannedPaidCreatesCount: 0,
        plannedPaidCreatesTotal: 0,
        plannedOpenCreatesCount: 0,
        plannedOpenCreatesTotal: 0,
        manualApprovedCreatesCount: 0,
        manualSkippedDuplicatesCount: 0,
        skippedExistingCount: 0,
        requiresReviewCount: (plan.requiresReviewUntouched || []).length,
        requiresReviewUntouchedCount: (plan.requiresReviewUntouched || []).length,
        createdCount: 0,
        failedCount: 0,
        invalidCandidatesCount: (plan.preview?.invalidCandidates || []).length,
        excludedAsTestCount: (plan.preview?.excludedAsTest || []).length,
      },
    });
    console.warn('[CollectionDueBackfill] blocked', plan.blockReasons);
    return result;
  }

  const {
    preview,
    requiresReviewUntouched,
    skippedExisting,
    manualApprovedPaidCreates,
    manualSkippedDuplicates,
    plannedPaidCreates,
    plannedOpenCreates,
    plannedCreates,
  } = plan;

  if (dryRun) {
    const result = {
      status: 'dry_run',
      realExecutionEnabled: realExecutionApproved,
      dryRun: true,
      plannedCreates,
      plannedPaidCreates,
      plannedOpenCreates,
      manualApprovedPaidCreates,
      manualSkippedDuplicates,
      skippedExisting,
      created: [],
      failed: [],
      stoppedBecauseRateLimit: false,
      blocked: false,
      blockReasons: [],
      requiresReviewUntouched,
      previewSummary: preview.summary,
      summary: buildSummary({
        plannedCreates,
        plannedPaid: plannedPaidCreates,
        plannedOpen: plannedOpenCreates,
        manualApprovedPaidCreates,
        manualSkippedDuplicates,
        skippedExisting,
        requiresReviewUntouched,
        preview,
      }),
    };

    printBackfillReport(result, { dryRun: true });
    return result;
  }

  const { created, failed, stoppedBecauseRateLimit } = await executeCreates(plannedCreates);

  const result = {
    status: stoppedBecauseRateLimit ? 'rate_limited' : 'completed',
    realExecutionEnabled: true,
    dryRun: false,
    plannedCreates,
    plannedPaidCreates,
    plannedOpenCreates,
    manualApprovedPaidCreates,
    manualSkippedDuplicates,
    skippedExisting,
    created,
    failed,
    stoppedBecauseRateLimit,
    blocked: false,
    blockReasons: [],
    requiresReviewUntouched,
    previewSummary: preview.summary,
    summary: buildSummary({
      plannedCreates,
      plannedPaid: plannedPaidCreates,
      plannedOpen: plannedOpenCreates,
      manualApprovedPaidCreates,
      manualSkippedDuplicates,
      skippedExisting,
      requiresReviewUntouched,
      preview,
      created,
      failed,
    }),
  };

  printBackfillReport(result, { dryRun: false });
  return result;
}
