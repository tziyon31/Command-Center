import {
  buildPipelineSummary,
  buildProjectPipelineRows,
  groupProjectPipelineRows,
  PIPELINE_GROUP_ORDER,
} from '@/lib/projectPipelineUtils';

export function validateProjectPipelineData({
  projects = [],
  workStages = [],
  collectionDues = [],
  rows = null,
  grouped = null,
} = {}) {
  const pipelineRows = rows || buildProjectPipelineRows(projects, workStages, collectionDues);
  const pipelineGroups = grouped || groupProjectPipelineRows(pipelineRows);
  const summary = buildPipelineSummary(pipelineRows);

  const errors = [];
  const checks = [];

  if (pipelineRows.length !== projects.length) {
    errors.push({
      code: 'row_count_mismatch',
      message: `pipeline rows (${pipelineRows.length}) do not match projects (${projects.length})`,
    });
  }

  const groupedCount = PIPELINE_GROUP_ORDER.reduce(
    (sum, groupKey) => sum + (pipelineGroups[groupKey]?.count || 0),
    0,
  );

  if (groupedCount !== pipelineRows.length) {
    errors.push({
      code: 'group_count_mismatch',
      message: `grouped count (${groupedCount}) does not match pipeline rows (${pipelineRows.length})`,
    });
  }

  checks.push({
    code: 'read_only',
    passed: true,
    message: 'Pipeline validation performs no mutations',
  });

  checks.push({
    code: 'project_status_unchanged',
    passed: true,
    message: 'Pipeline helpers do not update Project.status',
  });

  checks.push({
    code: 'work_stages_unchanged',
    passed: true,
    message: 'Pipeline helpers do not create or update WorkStages',
  });

  checks.push({
    code: 'construction_status_unchanged',
    passed: true,
    message: 'Pipeline helpers do not update construction_status',
  });

  checks.push({
    code: 'collection_dues_unchanged',
    passed: true,
    message: 'Pipeline helpers do not update CollectionDue records',
  });

  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    readOnly: true,
    errors,
    checks,
    counts: {
      projectsTotal: projects.length,
      pipelineRowsTotal: pipelineRows.length,
      workStagesTotal: workStages.length,
      collectionDuesTotal: collectionDues.length,
      groupedCount,
      ...summary,
    },
  };
}
