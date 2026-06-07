const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export const getTodayDateString = () => {
  const today = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
};

export function getProjectOutstandingAmount(project) {
  const totalAmount = toNumber(project?.total_amount);
  const collectedAmount = toNumber(project?.collected_amount);
  return Math.max(totalAmount - collectedAmount, 0);
}

export function getProjectFeeAmount(project) {
  return toNumber(project?.total_amount);
}

export function sumExistingProjectInvoiceAmounts(
  invoices = [],
  { excludeInvoiceId = null } = {},
) {
  const excludedId = excludeInvoiceId ? String(excludeInvoiceId).trim() : '';

  return (invoices || []).reduce((sum, invoice) => {
    if (!invoice) return sum;
    if (invoice.form_status === 'cancelled') return sum;
    if (excludedId && String(invoice.id || '').trim() === excludedId) return sum;

    const amount = toNumber(invoice.amount);
    if (amount <= 0) return sum;

    return sum + amount;
  }, 0);
}

export function getProjectCumulativeInvoiceAmountValidation({
  project,
  currentAmountValue,
  projectInvoices = [],
  currentInvoiceId = null,
}) {
  const projectFee = getProjectFeeAmount(project);
  const currentAmount = toNumber(currentAmountValue);
  const existingProjectInvoiceTotal = sumExistingProjectInvoiceAmounts(
    projectInvoices,
    { excludeInvoiceId: currentInvoiceId },
  );
  const projectInvoiceTotalAfterCurrent = existingProjectInvoiceTotal + currentAmount;
  const remainingBeforeCurrent = Math.max(projectFee - existingProjectInvoiceTotal, 0);
  const overBy = Math.max(projectInvoiceTotalAfterCurrent - projectFee, 0);
  const missingProjectFee = currentAmount > 0 && (!project?.id || projectFee <= 0);
  const exceedsProjectFee = projectFee > 0 && projectInvoiceTotalAfterCurrent > projectFee;

  let message = '';
  if (missingProjectFee) {
    message = 'לא הוגדר שכ״ט לפרויקט. יש לעדכן שכ״ט לפני הגשת חשבונית או פתיחת גבייה.';
  } else if (exceedsProjectFee) {
    message = 'סך תהליכי החשבונית לפרויקט יהיה גבוה משכ״ט הפרויקט.';
  }

  return {
    hasIssue: missingProjectFee || exceedsProjectFee,
    missingProjectFee,
    exceedsProjectFee,
    projectFee,
    existingProjectInvoiceTotal,
    currentAmount,
    projectInvoiceTotalAfterCurrent,
    remainingBeforeCurrent,
    overBy,
    message,
  };
}

export function getInvoiceProcessAmountValidation({
  project,
  amountValue,
  projectInvoices = [],
  currentInvoiceId = null,
}) {
  const cumulative = getProjectCumulativeInvoiceAmountValidation({
    project,
    currentAmountValue: amountValue,
    projectInvoices,
    currentInvoiceId,
  });
  const collection = getInvoiceAmountCollectionValidation({
    project,
    amountValue,
  });

  const blocksSubmit = cumulative.hasIssue;
  const blocksCollection = cumulative.hasIssue || collection.hasIssue;

  return {
    ...cumulative,
    outstandingAmount: collection.outstandingAmount,
    exceedsOutstanding: collection.exceedsOutstanding,
    blocksSubmit,
    blocksCollection,
  };
}

export function getInvoiceAmountCollectionValidation({ project, amountValue }) {
  const amount = toNumber(amountValue);
  const outstandingAmount = getProjectOutstandingAmount(project);
  const projectFee = getProjectFeeAmount(project);

  if (amount <= 0) {
    return {
      hasIssue: false,
      missingProjectFee: false,
      exceedsOutstanding: false,
      message: '',
      outstandingAmount,
      projectFee,
    };
  }

  if (!project?.id || projectFee <= 0) {
    return {
      hasIssue: true,
      missingProjectFee: true,
      exceedsOutstanding: false,
      message: 'לא הוגדר שכ״ט לפרויקט. יש לעדכן שכ״ט פרויקט לפני פתיחת גבייה.',
      outstandingAmount,
      projectFee,
    };
  }

  if (amount > outstandingAmount) {
    return {
      hasIssue: true,
      missingProjectFee: false,
      exceedsOutstanding: true,
      message: 'סכום החשבונית גבוה מיתרת הגבייה / שכ״ט הפרויקט. יש לעדכן את שכ״ט הפרויקט או להקטין את הסכום.',
      outstandingAmount,
      projectFee,
    };
  }

  return {
    hasIssue: false,
    missingProjectFee: false,
    exceedsOutstanding: false,
    message: '',
    outstandingAmount,
    projectFee,
  };
}

export function buildInvoiceCollectionNote({
  invoiceReference = '',
  workStageTitles = '',
  invoiceScope = '',
}) {
  let note = 'גבייה עבור חשבונית';
  const reference = String(invoiceReference || '').trim();
  const titles = String(workStageTitles || '').trim();

  if (reference) {
    note += ` ${reference}`;
  }

  if (titles) {
    note += ` · ${titles}`;
  } else if (invoiceScope === 'general') {
    note += ' · כללי';
  }

  return note;
}

export async function openProjectCollectionDue({ project, amount, note, updateProject }) {
  if (!project?.id) {
    throw new Error('PROJECT_NOT_FOUND');
  }

  const dueAmount = toNumber(amount);
  if (dueAmount <= 0) {
    throw new Error('INVALID_AMOUNT');
  }

  const outstandingAmount = getProjectOutstandingAmount(project);
  if (dueAmount > outstandingAmount) {
    throw new Error('AMOUNT_EXCEEDS_OUTSTANDING');
  }

  const isEditingExistingCollection = (
    project.collection_due_now === true && toNumber(project.collection_due_amount) > 0
  );

  const payload = {
    collection_due_now: true,
    collection_due_amount: dueAmount,
    collection_due_note: note,
    collection_due_target_date: getTodayDateString(),
    collection_due_date: isEditingExistingCollection
      ? project.collection_due_date
      : new Date().toISOString(),
  };

  await updateProject(project.id, payload);
}
