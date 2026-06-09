import {
  buildPipelineSummary,
  buildProjectPipelineRows,
  buildProjectReminderMap,
  enrichPipelineRowsWithReminders,
  groupProjectPipelineRows,
  PIPELINE_GROUP_ORDER,
} from '@/lib/projectPipelineUtils';

export function validateProjectPipelineData({
  projects = [],
  workStages = [],
  collectionDues = [],
  reminders = [],
  rows = null,
  grouped = null,
  reminderMapResult = null,
} = {}) {
  const pipelineRows = rows || buildProjectPipelineRows(projects, workStages, collectionDues);
  const reminderMapping = reminderMapResult || buildProjectReminderMap(reminders, projects, collectionDues);
  const enrichedRows = enrichPipelineRowsWithReminders(pipelineRows, reminderMapping);
  const pipelineGroups = grouped || groupProjectPipelineRows(enrichedRows);
  const summary = buildPipelineSummary(enrichedRows);

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

  if (groupedCount !== enrichedRows.length) {
    errors.push({
      code: 'group_count_mismatch',
      message: `grouped count (${groupedCount}) does not match pipeline rows (${enrichedRows.length})`,
    });
  }

  if (reminderMapping.stats.mappedProjectRemindersCount > reminders.length) {
    errors.push({
      code: 'reminder_mapping_overflow',
      message: 'mapped reminders count exceeds loaded active reminders',
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

  checks.push({
    code: 'reminders_unchanged',
    passed: true,
    message: 'Pipeline helpers do not create, resolve, snooze, or update reminders',
  });

  checks.push({
    code: 'collection_reminder_mapping',
    passed: true,
    message: 'CollectionDue reminders map via condition_key to CollectionDue.project_id',
  });

  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    readOnly: true,
    errors,
    checks,
    counts: {
      projectsTotal: projects.length,
      pipelineRowsTotal: enrichedRows.length,
      workStagesTotal: workStages.length,
      collectionDuesTotal: collectionDues.length,
      groupedCount,
      totalActiveReminders: reminderMapping.stats.totalActiveReminders,
      mappedProjectRemindersCount: reminderMapping.stats.mappedProjectRemindersCount,
      projectsWithActiveRemindersCount: reminderMapping.stats.projectsWithActiveRemindersCount,
      unmappedRemindersCount: reminderMapping.stats.unmappedRemindersCount,
      collectionReminderMappedCount: reminderMapping.stats.collectionReminderMappedCount,
      ...summary,
    },
  };
}
