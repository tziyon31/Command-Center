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
