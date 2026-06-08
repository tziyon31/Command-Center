import { base44 } from '@/api/base44Client';
import { runCollectionDueBackfillPreview } from '@/lib/collectionDueBackfillPreview';

/** Must remain false until explicit business approval for real migration. */
const REAL_BACKFILL_ENABLED = false;

const REAL_BACKFILL_DISABLED_MESSAGE = (
  'Real backfill execution is disabled until explicit business approval.'
);

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

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
    blockReasons.push(`excludedAsTest.length=${preview.excludedAsTest.length} (expected 0 for dry-run gate)`);
  }
  if ((preview?.skippedExisting || []).length > 0) {
    blockReasons.push(`skippedExisting.length=${preview.skippedExisting.length} (expected 0)`);
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
    source_entity_type: 'collection_event',
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

function printDryRunReport(result) {
  console.group('CollectionDue Backfill Dry Run');
  console.table(result.plannedPaidCreates.map((item) => ({
    source_entity_type: item.source_entity_type,
    source_entity_id: item.source_entity_id,
    project_id: item.project_id,
    project_name: item.project_name,
    amount_due: item.amount_due,
    status: item.status,
  })));
  console.table(result.plannedOpenCreates.map((item) => ({
    source_entity_type: item.source_entity_type,
    source_entity_id: item.source_entity_id,
    project_id: item.project_id,
    project_name: item.project_name,
    amount_due: item.amount_due,
    status: item.status,
    migration_note: item.migration_note,
  })));
  if (result.skippedExisting.length > 0) {
    console.table(result.skippedExisting);
  }
  if (result.requiresReviewUntouched.length > 0) {
    console.table(result.requiresReviewUntouched.map((item) => ({
      category: item.category,
      project_id: item.project_id,
      project_name: item.project_name,
      reason: item.reason,
    })));
  }
  console.log('summary', result.summary);
  console.groupEnd();
}

function buildEmptyResult(overrides = {}) {
  return {
    status: 'dry_run',
    realExecutionEnabled: REAL_BACKFILL_ENABLED,
    plannedCreates: [],
    plannedPaidCreates: [],
    plannedOpenCreates: [],
    skippedExisting: [],
    blocked: false,
    blockReasons: [],
    requiresReviewUntouched: [],
    summary: {
      plannedCreatesCount: 0,
      plannedPaidCreatesCount: 0,
      plannedPaidCreatesTotal: 0,
      plannedOpenCreatesCount: 0,
      plannedOpenCreatesTotal: 0,
      skippedExistingCount: 0,
      requiresReviewCount: 0,
      invalidCandidatesCount: 0,
      excludedAsTestCount: 0,
    },
    ...overrides,
  };
}

export async function runCollectionDueBackfill(options = {}) {
  const dryRun = options.dryRun !== false;
  const maxCreates = Number.isFinite(options.maxCreates) ? options.maxCreates : null;

  if (!dryRun) {
    const result = buildEmptyResult({
      status: 'blocked',
      blocked: true,
      blockReasons: [REAL_BACKFILL_DISABLED_MESSAGE],
      dryRunRequested: false,
    });
    console.warn('[CollectionDueBackfill]', REAL_BACKFILL_DISABLED_MESSAGE);
    return result;
  }

  const preview = await runCollectionDueBackfillPreview({ entities: base44.entities });
  const requiresReviewUntouched = buildRequiresReviewUntouched(preview);

  const previewSafetyBlockReasons = runPreviewSafetyChecks(preview);
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

  const blockReasons = [...previewSafetyBlockReasons, ...candidateBlockReasons];

  if (blockReasons.length > 0) {
    const result = buildEmptyResult({
      status: 'blocked',
      blocked: true,
      blockReasons,
      requiresReviewUntouched,
      previewSummary: preview.summary,
      summary: {
        plannedCreatesCount: 0,
        plannedPaidCreatesCount: 0,
        plannedPaidCreatesTotal: 0,
        plannedOpenCreatesCount: 0,
        plannedOpenCreatesTotal: 0,
        skippedExistingCount: 0,
        requiresReviewCount: requiresReviewUntouched.length,
        invalidCandidatesCount: (preview.invalidCandidates || []).length,
        excludedAsTestCount: (preview.excludedAsTest || []).length,
      },
    });
    console.warn('[CollectionDueBackfill] blocked', blockReasons);
    return result;
  }

  const existingCollectionDues = base44.entities.CollectionDue?.list
    ? await base44.entities.CollectionDue.list()
    : [];
  const existingSourceIndex = buildExistingSourceIndex(existingCollectionDues);

  const migratedAt = new Date().toISOString();
  const skippedExisting = [];
  const plannedPaidCreates = [];
  const plannedOpenCreates = [];

  for (const candidate of preview.safeToMigrate?.paidFromCollectionEvents || []) {
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
      continue;
    }

    plannedPaidCreates.push(buildPlannedPaidPayload(candidate, migratedAt));
  }

  for (const candidate of preview.safeToMigrate?.openFromProjectLegacy || []) {
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
      continue;
    }

    plannedOpenCreates.push(buildPlannedOpenPayload(candidate, migratedAt));
  }

  let plannedPaid = [...plannedPaidCreates];
  let plannedOpen = [...plannedOpenCreates];
  let plannedCreates = [...plannedPaid, ...plannedOpen];

  if (maxCreates !== null && maxCreates >= 0 && plannedCreates.length > maxCreates) {
    plannedCreates = plannedCreates.slice(0, maxCreates);
    plannedPaid = plannedCreates.filter((item) => item.status === 'paid');
    plannedOpen = plannedCreates.filter((item) => item.status === 'open');
  }

  const plannedPaidCreatesTotal = plannedPaid.reduce(
    (sum, item) => sum + toNumber(item.amount_due),
    0,
  );
  const plannedOpenCreatesTotal = plannedOpen.reduce(
    (sum, item) => sum + toNumber(item.amount_due),
    0,
  );

  const result = {
    status: 'dry_run',
    realExecutionEnabled: REAL_BACKFILL_ENABLED,
    dryRun: true,
    plannedCreates,
    plannedPaidCreates: plannedPaid,
    plannedOpenCreates: plannedOpen,
    skippedExisting,
    blocked: false,
    blockReasons: [],
    requiresReviewUntouched,
    previewSummary: preview.summary,
    summary: {
      plannedCreatesCount: plannedCreates.length,
      plannedPaidCreatesCount: plannedPaid.length,
      plannedPaidCreatesTotal,
      plannedOpenCreatesCount: plannedOpen.length,
      plannedOpenCreatesTotal,
      skippedExistingCount: skippedExisting.length,
      requiresReviewCount: requiresReviewUntouched.length,
      invalidCandidatesCount: (preview.invalidCandidates || []).length,
      excludedAsTestCount: (preview.excludedAsTest || []).length,
    },
  };

  printDryRunReport(result);
  return result;
}
