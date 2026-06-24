import { api as base44 } from '@/api/apiClient';
import {
  buildDashboardCollectionMetrics,
  COLLECTION_RELEVANT_STATUSES,
  isOutstandingEligibleProject,
} from '@/lib/dashboardCollectionMetrics';

const MERLOG_PROJECT_ID = '69eb6b5f9ae59e23cdf769ad';
const EXPECTED_OPEN_COUNT = 9;
const EXPECTED_OPEN_AMOUNT = 42432;
const EXPECTED_PAID_AMOUNT = 109643;
const EXPECTED_EVENT_RAW_PAID_TOTAL = 115643;
const EXPECTED_PAID_DIFFERENCE = 6000;
const EXPECTED_AWAITING_TAX_INVOICE = 0;
const EXPECTED_MERLOG_COLLECTED = 6000;
const SUSPICIOUS_OUTSTANDING_PROJECT_COUNT = 40;

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

function amountsEqual(left, right, epsilon = 0.01) {
  return Math.abs(toNumber(left) - toNumber(right)) <= epsilon;
}

function addIssue(issues, check, message, details = null) {
  issues.push({ check, severity: 'error', message, details });
}

function printValidationReport(report) {
  console.group('H2 Dashboard CollectionDue migration validation');
  if (report.outstandingBreakdown?.includedProjects?.length) {
    console.table(report.outstandingBreakdown.includedProjects);
  }
  if (report.issues.length > 0) {
    console.table(report.issues);
  } else {
    console.info('No issues found');
  }
  console.log('summary', report.summary);
  console.groupEnd();
}

export async function runDashboardCollectionDueMigrationValidation({
  entities = base44.entities,
  collectionPeriod = 'all',
} = {}) {
  const issues = [];

  const [projects, collectionDues, collectionEvents] = await Promise.all([
    entities.Project.list(),
    entities.CollectionDue?.list ? entities.CollectionDue.list() : Promise.resolve([]),
    entities.CollectionEvent?.list ? entities.CollectionEvent.list() : Promise.resolve([]),
  ]);

  const metrics = buildDashboardCollectionMetrics({
    projects,
    collectionDues,
    collectionEvents,
    collectionPeriod,
  });

  const {
    outstandingBreakdown,
    recordedCollectionComparison,
  } = metrics;

  const openCountFromCollectionDue = metrics.openCollectionDues.length;
  const openAmountFromCollectionDue = metrics.openCollectionDues.reduce(
    (sum, record) => sum + toNumber(record.remaining_amount),
    0,
  );

  if (openCountFromCollectionDue !== EXPECTED_OPEN_COUNT) {
    addIssue(
      issues,
      'open_count',
      `Expected ${EXPECTED_OPEN_COUNT} open CollectionDue records, got ${openCountFromCollectionDue}`,
      { openCountFromCollectionDue },
    );
  }

  if (!amountsEqual(openAmountFromCollectionDue, EXPECTED_OPEN_AMOUNT)) {
    addIssue(
      issues,
      'open_amount',
      `Expected open amount ${EXPECTED_OPEN_AMOUNT}, got ${openAmountFromCollectionDue}`,
      { openAmountFromCollectionDue },
    );
  }

  if (!amountsEqual(metrics.paidCollectionAmount, EXPECTED_PAID_AMOUNT)) {
    addIssue(
      issues,
      'paid_amount',
      `Expected paid amount ${EXPECTED_PAID_AMOUNT}, got ${metrics.paidCollectionAmount}`,
      {
        paidCollectionAmount: metrics.paidCollectionAmount,
        collectionEventRawPaidTotal: metrics.collectionEventRawPaidTotal,
      },
    );
  }

  if (!amountsEqual(metrics.collectionEventRawPaidTotal, EXPECTED_EVENT_RAW_PAID_TOTAL)) {
    addIssue(
      issues,
      'collection_event_raw',
      `Expected CollectionEvent raw paid total ${EXPECTED_EVENT_RAW_PAID_TOTAL}, got ${metrics.collectionEventRawPaidTotal}`,
      { collectionEventRawPaidTotal: metrics.collectionEventRawPaidTotal },
    );
  }

  if (!amountsEqual(recordedCollectionComparison.difference, EXPECTED_PAID_DIFFERENCE)) {
    addIssue(
      issues,
      'paid_difference',
      `Expected paid difference ${EXPECTED_PAID_DIFFERENCE}, got ${recordedCollectionComparison.difference}`,
      recordedCollectionComparison,
    );
  }

  if (recordedCollectionComparison.unapprovedMissingEvents.length > 0) {
    addIssue(
      issues,
      'missing_collection_due',
      'CollectionEvent records exist without matching CollectionDue and without approved skip',
      recordedCollectionComparison.unapprovedMissingEvents,
    );
  }

  if (metrics.awaitingTaxInvoiceCount !== EXPECTED_AWAITING_TAX_INVOICE) {
    addIssue(
      issues,
      'awaiting_tax_invoice',
      `Expected awaiting tax invoice count ${EXPECTED_AWAITING_TAX_INVOICE}, got ${metrics.awaitingTaxInvoiceCount}`,
      { awaitingTaxInvoiceCount: metrics.awaitingTaxInvoiceCount },
    );
  }

  const merlogSummary = metrics.projectFinancialSummaries.find(
    (summary) => summary.project_id === MERLOG_PROJECT_ID,
  );

  if (!merlogSummary) {
    addIssue(issues, 'merlog', 'Merlog project financial summary not found');
  } else if (!amountsEqual(merlogSummary.collectedAmount, EXPECTED_MERLOG_COLLECTED)) {
    addIssue(
      issues,
      'merlog',
      `Merlog collected should be ${EXPECTED_MERLOG_COLLECTED}, got ${merlogSummary.collectedAmount}`,
      merlogSummary,
    );
  }

  if (metrics.recordedCollectionSource !== 'collection_due') {
    addIssue(
      issues,
      'kpi_source',
      'Dashboard KPI should use CollectionDue as primary source when paid records exist',
      { recordedCollectionSource: metrics.recordedCollectionSource },
    );
  }

  const ineligibleIncluded = outstandingBreakdown.includedProjects.filter(
    (project) => !isOutstandingEligibleProject({ status: project.status }),
  );
  if (ineligibleIncluded.length > 0) {
    addIssue(
      issues,
      'outstanding_status_filter',
      'Outstanding breakdown includes projects outside collection-relevant statuses',
      ineligibleIncluded,
    );
  }

  const wronglyEligibleStatuses = ['pricing', 'waiting', 'rejected', 'cancelled'];
  const excludedWrongStatusesStillOutstanding = outstandingBreakdown.excludedProjectsWithAmount.filter(
    (project) => wronglyEligibleStatuses.includes(project.status) && toNumber(project.potential_outstanding) > 0,
  );

  if (outstandingBreakdown.outstandingProjectCount >= SUSPICIOUS_OUTSTANDING_PROJECT_COUNT) {
    addIssue(
      issues,
      'outstanding_count',
      `Outstanding project count looks too high (${outstandingBreakdown.outstandingProjectCount}); likely missing status filter`,
      {
        outstandingProjectCount: outstandingBreakdown.outstandingProjectCount,
        totalOutstandingAmount: outstandingBreakdown.totalOutstandingAmount,
        excludedProjectsWithAmountCount: outstandingBreakdown.excludedProjectsWithAmount.length,
        excludedWrongStatusesStillOutstanding,
      },
    );
  }

  const duplicateSourceRisk = metrics.projectFinancialSummaries.filter(
    (summary) => summary.usesCollectionDue && summary.usesLegacyFallback,
  );
  if (duplicateSourceRisk.length > 0) {
    addIssue(
      issues,
      'duplicate_source',
      'Project financial summary mixes CollectionDue and legacy flags',
      duplicateSourceRisk,
    );
  }

  const summary = {
    status: issues.length === 0 ? 'passed' : 'failed',
    openCountFromCollectionDue,
    openAmountFromCollectionDue,
    paidCollectionAmount: metrics.paidCollectionAmount,
    collectionEventRawPaidTotal: metrics.collectionEventRawPaidTotal,
    paidDifference: recordedCollectionComparison.difference,
    awaitingTaxInvoiceCount: metrics.awaitingTaxInvoiceCount,
    merlogCollected: merlogSummary?.collectedAmount ?? null,
    recordedCollectionSource: metrics.recordedCollectionSource,
    legacyFallbackProjectsCount: metrics.legacyFallbackUsedProjects.length,
    usesCollectionDuePrimary: metrics.usesCollectionDuePrimary,
    totalOutstandingAmount: outstandingBreakdown.totalOutstandingAmount,
    outstandingProjectCount: outstandingBreakdown.outstandingProjectCount,
    excludedProjectsWithAmountCount: outstandingBreakdown.excludedProjectsWithAmount.length,
    collectionRelevantStatuses: COLLECTION_RELEVANT_STATUSES,
    recordedCollectionComparison,
    dashboardChanged: true,
    issuesCount: issues.length,
    readOnly: true,
  };

  const report = {
    status: summary.status,
    metrics,
    outstandingBreakdown,
    recordedCollectionComparison,
    issues,
    summary,
    generatedAt: new Date().toISOString(),
    readOnly: true,
  };

  printValidationReport(report);
  return report;
}
