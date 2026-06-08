const parseNumericSequence = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return 0;

  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const EMPTY_PROJECT_FORM = {
  client_id: '',
  bid_number: '',
  work_number: '',
  name: '',
  city: '',
  project_type: '',
  area: '',
  description: '',
  status: 'pricing',
  total_amount: '',
  year: new Date().getFullYear(),
  notes: '',
  source_inquiry_id: '',
};

export const getNextProjectDefaults = (projects = []) => {
  let maxBid = 0;
  let maxWork = 0;

  for (const project of projects) {
    const bidValue = parseNumericSequence(project?.bid_number);
    const workValue = parseNumericSequence(project?.work_number);

    if (bidValue > maxBid) maxBid = bidValue;
    if (workValue > maxWork) maxWork = workValue;
  }

  const nextBid = maxBid + 1;
  const nextWork = maxWork + 1;

  return {
    bid_number: String(nextBid).padStart(5, '0'),
    work_number: String(nextWork),
    year: new Date().getFullYear(),
    status: 'pricing',
    total_amount: '',
  };
};

export const buildProjectCreateFormFromSearchParams = (params, projects = []) => {
  const readParam = (key) => {
    const value = params.get(key);
    if (!value) return '';

    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  return buildInitialProjectForm({
    projects,
    prefill: {
      name: readParam('project_name') || readParam('client_name'),
      client_id: params.get('client_id') || '',
      source_inquiry_id: params.get('source_inquiry_id') || '',
    },
  });
};

export const buildInitialProjectForm = ({ projects = [], prefill = {} } = {}) => {
  const defaults = getNextProjectDefaults(projects);

  return {
    ...EMPTY_PROJECT_FORM,
    ...defaults,
    ...prefill,
    bid_number: prefill.bid_number?.trim() || defaults.bid_number,
    work_number: prefill.work_number?.trim() || defaults.work_number,
    year: prefill.year ?? defaults.year,
    status: prefill.status || defaults.status,
    total_amount: prefill.total_amount ?? defaults.total_amount,
  };
};
