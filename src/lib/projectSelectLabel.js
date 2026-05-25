/**
 * Builds a display label for a project in select dropdowns.
 * Uses entity fields: name, bid_number, work_number.
 */
export const formatProjectSelectLabel = (project) => {
  if (!project || typeof project !== 'object') {
    return 'פרויקט ללא שם · ללא BID';
  }

  const name = String(project.name || project.project_name || '').trim();
  const bid = String(
    project.bid_number || project.bid || project.BID || project.bidNumber || '',
  ).trim();
  const work = String(
    project.work_number || project.workNumber || project.work_num || '',
  ).trim();
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
