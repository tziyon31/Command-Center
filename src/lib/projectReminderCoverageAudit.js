import { base44 } from '@/api/base44Client';
import { MONETARY_OPEN_COLLECTION_STATUSES } from '@/lib/collectionDueUtils';
import { COLLECTION_PAYMENT_DUE_PREFIX } from '@/lib/collectionReminderRules';
import { CONSTRUCTION_STATUS_NOT_UPDATED } from '@/lib/constructionStatusUtils';
import {
  buildProjectPipelineRows,
  buildProjectReminderMap,
  getProjectWorkStatusLabel,
  loadReadOnlyVisibleReminders,
} from '@/lib/projectPipelineUtils';

const SHOULD_HAVE_REMINDER_STATUSES = new Set([
  'pricing',
  'waiting',
  'signed',
  'planning',
  'submission',
  'execution',
]);

const NO_REMINDER_NEEDED_STATUSES = new Set(['rejected', 'cancelled']);

const CONSTRUCTION_POLICY_STATUSES = new Set(['signed', 'execution', 'completed']);

export const COVERAGE_STATUS_LABELS = {
  covered: 'מכוסה',
  missing_reminder_candidate: 'מועמד חסר תזכורת',
  no_reminder_needed_by_default: 'לא נדרשת תזכורת',
  needs_business_policy: 'דורש החלטת מדיניות',
  unmapped_possible: 'ייתכן קישור לא ברור',
};

function getOpenMonetaryCollectionDues(projectId, collectionDues = []) {
  return (collectionDues || []).filter((due) => (
    String(due?.project_id || '').trim() === String(projectId).trim()
    && due?.status !== 'cancelled'
    && MONETARY_OPEN_COLLECTION_STATUSES.has(due?.status)
  ));
}

function hasCollectionPaymentReminderForDue(activeReminders = [], collectionDueId) {
  const expectedKey = `${COLLECTION_PAYMENT_DUE_PREFIX}${collectionDueId}`;
  return activeReminders.some(
    (reminder) => String(reminder?.condition_key || '').trim() === expectedKey,
  );
}

function classifyProjectBucket(status, collectionSummary, constructionSummary) {
  if (NO_REMINDER_NEEDED_STATUSES.has(status)) {
    return 'noReminderNeededByDefault';
  }

  if (status === 'completed') {
    if (collectionSummary.has_open_collection_due || constructionSummary.is_not_updated) {
      return 'completedButMayNeedFollowup';
    }
    return 'completedLikelyClosed';
  }

  if (SHOULD_HAVE_REMINDER_STATUSES.has(status)) {
    return 'shouldHaveReminderCandidates';
  }

  return 'other';
}

function evaluateProjectCoverage({
  project,
  pipelineRow,
  activeReminders = [],
  openCollectionDues = [],
}) {
  const status = String(project?.status || '').trim();
  const constructionStatus = pipelineRow.construction_status;
  const constructionNotUpdated = constructionStatus === CONSTRUCTION_STATUS_NOT_UPDATED;
  const hasActiveReminder = activeReminders.length > 0;
  const missingCollectionPaymentReminder = openCollectionDues.some(
    (due) => !hasCollectionPaymentReminderForDue(activeReminders, due.id),
  );

  const reasons = [];
  const questions = [];
  let coverageStatus = 'covered';

  if (NO_REMINDER_NEEDED_STATUSES.has(status)) {
    return {
      coverage_status: 'no_reminder_needed_by_default',
      coverage_reason: 'Rejected or cancelled project',
      suggested_business_question: '',
      missing_collection_payment_reminder: false,
      project_bucket: 'noReminderNeededByDefault',
    };
  }

  if (missingCollectionPaymentReminder) {
    coverageStatus = 'missing_reminder_candidate';
    reasons.push('Open collection due has no mapped payment reminder');
    questions.push('האם צריך תזכורת גבייה לכל CollectionDue פתוח?');
  }

  if (status === 'pricing' && !hasActiveReminder) {
    coverageStatus = 'missing_reminder_candidate';
    reasons.push('Proposal pricing project has no active reminder');
    questions.push('האם פרויקט בתמחור צריך תזכורת פעילה?');
  }

  if (status === 'waiting' && !hasActiveReminder) {
    coverageStatus = 'missing_reminder_candidate';
    reasons.push('Waiting proposal has no active follow-up reminder');
    questions.push('האם הצעה ממתינה לתגובה צריכה תזכורת מעקב?');
  }

  if (status === 'signed' && !hasActiveReminder) {
    coverageStatus = 'missing_reminder_candidate';
    reasons.push('Accepted project has no active reminder');
    questions.push('האם פרויקט שהתקבל צריך תזכורת פעילה?');
  }

  if (status === 'execution' && !hasActiveReminder) {
    coverageStatus = 'missing_reminder_candidate';
    reasons.push('In-work project has no active reminder');
    questions.push('האם פרויקט בעבודה צריך תזכורת פעילה?');
  }

  if (
    SHOULD_HAVE_REMINDER_STATUSES.has(status)
    && !hasActiveReminder
    && !['pricing', 'waiting', 'signed', 'execution'].includes(status)
  ) {
    coverageStatus = 'missing_reminder_candidate';
    reasons.push(`${status} project has no active reminder`);
    questions.push('האם לפרויקט הפעיל הזה צריכה להיות תזכורת?');
  }

  if (status === 'completed' && !hasActiveReminder) {
    if (coverageStatus === 'covered') {
      coverageStatus = 'needs_business_policy';
    }
    reasons.push('Completed planning project may or may not need construction/facility follow-up policy');
    questions.push('האם פרויקט שבוצע צריך תזכורת המשך לסטטוס בנייה / מתקן?');
  }

  if (constructionNotUpdated && CONSTRUCTION_POLICY_STATUSES.has(status)) {
    if (coverageStatus === 'covered') {
      coverageStatus = 'needs_business_policy';
    }
    reasons.push('Construction status not updated - business policy needed');
    questions.push('האם לעדכן סטטוס בנייה / מתקן או להגדיר תזכורת?');
  }

  if (reasons.length === 0 && hasActiveReminder) {
    coverageStatus = 'covered';
    reasons.push('Project has active mapped reminder(s)');
  } else if (reasons.length === 0 && classifyProjectBucket(
    status,
    pipelineRow,
    { is_not_updated: constructionNotUpdated },
  ) === 'completedLikelyClosed') {
    coverageStatus = 'covered';
    reasons.push('Completed project likely closed - no open collection or construction follow-up required');
  }

  return {
    coverage_status: coverageStatus,
    coverage_reason: reasons.join(' · ') || 'No coverage issue detected',
    suggested_business_question: [...new Set(questions.filter(Boolean))].join(' · '),
    missing_collection_payment_reminder: missingCollectionPaymentReminder,
    project_bucket: classifyProjectBucket(
      status,
      pipelineRow,
      { is_not_updated: constructionNotUpdated },
    ),
  };
}

function summarizeUnmappedReminder(reminder) {
  return {
    id: reminder.id,
    title: reminder.title || '',
    status: reminder.status,
    condition_key: reminder.condition_key || '',
    source_type: reminder.source_type || '',
    source_id: reminder.source_id || '',
    project_id: reminder.project_id || '',
    action_url: reminder.action_url || '',
  };
}

function buildCoverageRow(project, pipelineRow, activeReminders, openCollectionDues) {
  const coverage = evaluateProjectCoverage({
    project,
    pipelineRow,
    activeReminders,
    openCollectionDues,
  });

  return {
    project_id: project.id,
    project_name: project.name || '',
    status: pipelineRow.status,
    status_label: getProjectWorkStatusLabel(project),
    work_number: project.work_number || '',
    bid_number: project.bid_number || '',

    active_reminders_count: activeReminders.length,
    active_reminders: activeReminders,
    mapped_reminders_count: activeReminders.length,

    has_open_collection_due: pipelineRow.has_open_collection_due,
    open_collection_due_amount: pipelineRow.open_collection_due_amount,

    has_work_stages: pipelineRow.work_stage_count > 0,
    work_stage_count: pipelineRow.work_stage_count,

    construction_status: pipelineRow.construction_status,
    construction_status_label: pipelineRow.construction_status_label,

    project_bucket: coverage.project_bucket,
    missing_collection_payment_reminder: coverage.missing_collection_payment_reminder,
    coverage_status: coverage.coverage_status,
    coverage_reason: coverage.coverage_reason,
    suggested_business_question: coverage.suggested_business_question,
  };
}

function buildCounts(rows, reminderMapResult, remindersTotal) {
  const shouldHaveReminderCandidates = rows.filter(
    (row) => row.project_bucket === 'shouldHaveReminderCandidates',
  );

  return {
    projectsTotal: rows.length,
    remindersTotal,
    activeRemindersTotal: reminderMapResult.stats.totalActiveReminders,
    mappedRemindersCount: reminderMapResult.stats.mappedProjectRemindersCount,
    unmappedRemindersCount: reminderMapResult.stats.unmappedRemindersCount,

    shouldHaveReminderCandidatesCount: shouldHaveReminderCandidates.length,
    coveredActiveProjectsCount: shouldHaveReminderCandidates.filter(
      (row) => row.coverage_status === 'covered' && row.active_reminders_count > 0,
    ).length,
    missingReminderCandidatesCount: rows.filter(
      (row) => row.coverage_status === 'missing_reminder_candidate',
    ).length,

    pricingWithoutReminderCount: rows.filter(
      (row) => row.status === 'pricing' && row.active_reminders_count === 0,
    ).length,
    waitingWithoutReminderCount: rows.filter(
      (row) => row.status === 'waiting' && row.active_reminders_count === 0,
    ).length,
    signedWithoutReminderCount: rows.filter(
      (row) => row.status === 'signed' && row.active_reminders_count === 0,
    ).length,
    executionWithoutReminderCount: rows.filter(
      (row) => row.status === 'execution' && row.active_reminders_count === 0,
    ).length,

    openCollectionDueWithoutReminderCount: rows.filter(
      (row) => row.missing_collection_payment_reminder,
    ).length,
    completedNeedsPolicyCount: rows.filter(
      (row) => row.coverage_status === 'needs_business_policy',
    ).length,
  };
}

export async function runProjectReminderCoverageAudit({ entities = base44.entities } = {}) {
  const [
    projects,
    allReminders,
    collectionDues,
    workStages,
  ] = await Promise.all([
    entities.Project?.list ? entities.Project.list('-year') : Promise.resolve([]),
    entities.Reminder?.list ? entities.Reminder.list() : Promise.resolve([]),
    entities.CollectionDue?.list ? entities.CollectionDue.list('-created_date') : Promise.resolve([]),
    entities.WorkStage?.list ? entities.WorkStage.list() : Promise.resolve([]),
  ]);

  const activeReminders = await loadReadOnlyVisibleReminders();
  const pipelineRows = buildProjectPipelineRows(projects, workStages, collectionDues);
  const pipelineRowsByProjectId = new Map(
    pipelineRows.map((row) => [String(row.project_id), row]),
  );
  const reminderMapResult = buildProjectReminderMap(activeReminders, projects, collectionDues);

  const rows = projects.map((project) => {
    const projectId = String(project.id);
    const pipelineRow = pipelineRowsByProjectId.get(projectId) || buildProjectPipelineRows(
      [project],
      workStages.filter((stage) => String(stage?.project_id) === projectId),
      collectionDues.filter((due) => String(due?.project_id) === projectId),
    )[0];
    const activeProjectReminders = reminderMapResult.byProjectId[projectId] || [];
    const openCollectionDues = getOpenMonetaryCollectionDues(projectId, collectionDues);

    return buildCoverageRow(project, pipelineRow, activeProjectReminders, openCollectionDues);
  });

  const mappedReminders = Object.entries(reminderMapResult.byProjectId).flatMap(
    ([projectId, reminders]) => reminders.map((reminder) => ({
      ...reminder,
      mapped_project_id: projectId,
    })),
  );

  const unmappedReminders = reminderMapResult.unmappedReminders.map(summarizeUnmappedReminder);

  const groups = {
    activeProjectsWithoutReminder: rows.filter(
      (row) => row.project_bucket === 'shouldHaveReminderCandidates'
        && row.active_reminders_count === 0,
    ),
    openCollectionDueWithoutReminder: rows.filter(
      (row) => row.missing_collection_payment_reminder,
    ),
    completedNeedsPolicy: rows.filter(
      (row) => row.coverage_status === 'needs_business_policy',
    ),
    unmappedReminders,
  };

  const counts = buildCounts(rows, reminderMapResult, allReminders.length);

  return {
    status: 'completed',
    readOnly: true,
    generated_at: new Date().toISOString(),
    counts,
    rows,
    groups,
    mappedReminders,
    unmappedReminders,
  };
}
