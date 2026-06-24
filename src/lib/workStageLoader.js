import { api as base44 } from '@/api/apiClient';
import { getNonCancelledWorkStages } from '@/lib/workStageLogic';

const DEFAULT_PAGE_SIZE = 5000;
const DEFAULT_PROJECT_ID_BATCH_SIZE = 25;
const DEFAULT_BATCH_CONCURRENCY = 4;

const PROJECT_NEEDS_WORK_STAGES_PREFIX = 'project_needs_work_stages:';
const WATCHED_PIPELINE_PROJECT_NAMES = [
  'ייעוץ ומפרטי אחזקה',
  'קופת חולים לאומית בית צפפה',
];

export async function fetchEntityPages(fetchPage, { pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const all = [];
  let skip = 0;

  while (true) {
    const page = await fetchPage(pageSize, skip);
    if (!page?.length) break;
    all.push(...page);
    if (page.length < pageSize) break;
    skip += pageSize;
  }

  return all;
}

export async function fetchWorkStagesForProject(
  projectId,
  { entities = base44.entities, pageSize = DEFAULT_PAGE_SIZE } = {},
) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return [];

  return fetchEntityPages(
    (limit, skip) => entities.WorkStage.filter(
      { project_id: normalizedProjectId },
      'order_index',
      limit,
      skip,
    ),
    { pageSize },
  );
}

async function fetchWorkStagesForProjectIdBatch(
  projectIds,
  { entities, pageSize },
) {
  if (!projectIds.length) return [];

  const query = projectIds.length === 1
    ? { project_id: projectIds[0] }
    : { project_id: { $in: projectIds } };

  return fetchEntityPages(
    (limit, skip) => entities.WorkStage.filter(query, 'order_index', limit, skip),
    { pageSize },
  );
}

function dedupeWorkStagesById(stages = []) {
  const byId = new Map();
  for (const stage of stages) {
    if (stage?.id) byId.set(stage.id, stage);
  }
  return [...byId.values()];
}

export async function fetchWorkStagesForProjects(
  projects = [],
  {
    entities = base44.entities,
    pageSize = DEFAULT_PAGE_SIZE,
    projectIdBatchSize = DEFAULT_PROJECT_ID_BATCH_SIZE,
    batchConcurrency = DEFAULT_BATCH_CONCURRENCY,
  } = {},
) {
  const projectIds = [...new Set(
    projects
      .map((project) => String(project?.id || '').trim())
      .filter(Boolean),
  )];

  if (!projectIds.length) return [];

  const batches = [];
  for (let index = 0; index < projectIds.length; index += projectIdBatchSize) {
    batches.push(projectIds.slice(index, index + projectIdBatchSize));
  }

  const allStages = [];
  for (let index = 0; index < batches.length; index += batchConcurrency) {
    const concurrentBatches = batches.slice(index, index + batchConcurrency);
    const batchResults = await Promise.all(
      concurrentBatches.map((batch) => fetchWorkStagesForProjectIdBatch(batch, { entities, pageSize })),
    );
    for (const stages of batchResults) {
      allStages.push(...stages);
    }
  }

  return dedupeWorkStagesById(allStages);
}

function groupWorkStagesByProjectId(workStages = []) {
  const byProjectId = new Map();

  for (const stage of workStages) {
    const projectId = String(stage?.project_id || '').trim();
    if (!projectId) continue;
    if (!byProjectId.has(projectId)) byProjectId.set(projectId, []);
    byProjectId.get(projectId).push(stage);
  }

  return byProjectId;
}

function isOpenReminderStatus(status) {
  return status === 'active' || status === 'snoozed';
}

function isNeedsWorkStagesReminder(reminder) {
  const conditionKey = String(reminder?.condition_key || '').trim();
  return (
    conditionKey.startsWith(PROJECT_NEEDS_WORK_STAGES_PREFIX)
    || conditionKey.startsWith('signed_proposal_needs_work_stages:')
  );
}

export function logPipelineWorkStageConsistencyDiagnostics({
  projects = [],
  workStages = [],
  pipelineRows = [],
  reminders = [],
  watchedProjectNames = WATCHED_PIPELINE_PROJECT_NAMES,
} = {}) {
  if (!import.meta.env.DEV) return;

  const workStagesByProjectId = groupWorkStagesByProjectId(workStages);
  const rowsByProjectId = new Map(
    pipelineRows.map((row) => [String(row.project_id || '').trim(), row]),
  );

  const mismatches = [];
  const watchedReports = [];

  for (const project of projects) {
    const projectId = String(project?.id || '').trim();
    if (!projectId) continue;

    const projectName = String(project?.name || '').trim();
    const loadedStages = workStagesByProjectId.get(projectId) || [];
    const actualCount = getNonCancelledWorkStages(loadedStages).length;
    const row = rowsByProjectId.get(projectId);
    const pipelineCount = Number(row?.work_stage_count ?? 0);
    const projectReminders = reminders.filter(
      (reminder) => String(reminder?.project_id || '').trim() === projectId
        && isOpenReminderStatus(reminder?.status),
    );
    const reminderTitles = projectReminders.map((reminder) => reminder.title || '').filter(Boolean);
    const staleNeedsStagesReminder = actualCount > 0
      && projectReminders.some((reminder) => isNeedsWorkStagesReminder(reminder));

    const report = {
      project_id: projectId,
      project_name: projectName,
      actual_non_cancelled_stages: actualCount,
      pipeline_work_stage_count: pipelineCount,
      reminder_titles: reminderTitles,
      stale_needs_work_stages_reminder: staleNeedsStagesReminder,
      project_id_mismatch: loadedStages.some(
        (stage) => String(stage?.project_id || '').trim() !== projectId,
      ),
    };

    if (actualCount !== pipelineCount || staleNeedsStagesReminder) {
      mismatches.push(report);
    }

    if (watchedProjectNames.some((name) => projectName.includes(name))) {
      watchedReports.push(report);
    }
  }

  if (watchedReports.length) {
    console.info('[ProjectPipeline] watched project work-stage consistency', watchedReports);
  }

  if (mismatches.length) {
    console.warn('[ProjectPipeline] work-stage consistency mismatches', mismatches);
  } else if (pipelineRows.length) {
    console.info('[ProjectPipeline] work-stage consistency check passed', {
      project_count: projects.length,
      work_stage_count: workStages.length,
    });
  }
}
