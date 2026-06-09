import { base44 } from '@/api/base44Client';
import { buildDashboardCollectionMetrics } from '@/lib/dashboardCollectionMetrics';

const MERLOG_PROJECT_ID = '69eb6b5f9ae59e23cdf769ad';
const EXPECTED_OPEN_COUNT = 9;
const EXPECTED_OPEN_AMOUNT = 42432;
const EXPECTED_PAID_AMOUNT = 109643;
const EXPECTED_AWAITING_TAX_INVOICE = 0;
const EXPECTED_MERLOG_COLLECTED = 6000;

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

  if (
    metrics.usesCollectionDuePrimary
    && amountsEqual(metrics.recordedCollection, metrics.collectionEventRawPaidTotal)
    && !amountsEqual(metrics.recordedCollection, metrics.paidCollectionAmount)
    && metrics.collectionEventRawPaidTotal > metrics.paidCollectionAmount
  ) {
    addIssue(
      issues,
      'kpi_source',
      'Recorded collection KPI still follows CollectionEvent raw total instead of CollectionDue',
      {
        recordedCollection: metrics.recordedCollection,
        collectionEventRawPaidTotal: metrics.collectionEventRawPaidTotal,
        paidCollectionAmount: metrics.paidCollectionAmount,
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
    awaitingTaxInvoiceCount: metrics.awaitingTaxInvoiceCount,
    merlogCollected: merlogSummary?.collectedAmount ?? null,
    recordedCollectionSource: metrics.recordedCollectionSource,
    legacyFallbackProjectsCount: metrics.legacyFallbackUsedProjects.length,
    usesCollectionDuePrimary: metrics.usesCollectionDuePrimary,
    dashboardChanged: true,
    issuesCount: issues.length,
    readOnly: true,
  };

  const report = {
    status: summary.status,
    metrics,
    issues,
    summary,
    generatedAt: new Date().toISOString(),
    readOnly: true,
  };

  printValidationReport(report);
  return report;
}
