const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export function sumCollectedFromCollectionDues(collectionDues = []) {
  return (collectionDues || [])
    .filter((item) => item?.status !== 'cancelled')
    .reduce((sum, item) => sum + Math.max(toNumber(item.amount_paid), 0), 0);
}

export function calculateProjectFinancialSummary(project, collectionDues = []) {
  const projectTotalFee = toNumber(project?.total_amount);
  const activeCollections = (collectionDues || []).filter((item) => item?.status !== 'cancelled');
  const usesCollectionDue = activeCollections.length > 0;

  const collectedAmount = usesCollectionDue
    ? sumCollectedFromCollectionDues(activeCollections)
    : toNumber(project?.collected_amount);

  const outstandingAmount = Math.max(projectTotalFee - collectedAmount, 0);

  const openRemainingAmount = activeCollections
    .filter((item) => item.status === 'open' || item.status === 'partially_paid')
    .reduce((sum, item) => sum + Math.max(toNumber(item.remaining_amount), 0), 0);

  const awaitingTaxInvoiceCount = activeCollections
    .filter((item) => item.status === 'awaiting_tax_invoice').length;

  const paidCollectionsCount = activeCollections
    .filter((item) => item.status === 'paid').length;

  return {
    projectTotalFee,
    collectedAmount,
    outstandingAmount,
    usesCollectionDue,
    breakdown: usesCollectionDue
      ? {
        paidCollectionsCount,
        openRemainingAmount,
        awaitingTaxInvoiceCount,
      }
      : null,
  };
}
