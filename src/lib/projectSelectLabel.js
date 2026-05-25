/**
 * Builds a display label for a project in select dropdowns.
 * Uses entity fields: name, bid_number, work_number.
 */
export const formatProjectSelectLabel = (project) => {
  const name = String(project?.name || '').trim();
  const bid = String(project?.bid_number || '').trim();
  const work = String(project?.work_number || '').trim();
  const displayName = name || 'פרויקט ללא שם';

  if (!bid) {
    return `${displayName} · ללא BID`;
  }

  let label = `${displayName} · BID ${bid}`;
  if (work) {
    label += ` · עבודה ${work}`;
  }

  return label;
};
