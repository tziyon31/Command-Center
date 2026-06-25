import { api as base44 } from '@/api/apiClient';
import { COLLECTION_NEEDS_TAX_INVOICE_PREFIX, COLLECTION_PAYMENT_DUE_PREFIX } from '@/lib/collectionReminderRules';
import { CONSTRUCTION_STATUS_NOT_UPDATED } from '@/lib/constructionStatusUtils';
import {
  buildProjectPipelineRows,
  buildProjectReminderMap,
  getProjectWorkStatusLabel,
  parseProjectIdFromReminderUrl,
} from '@/lib/projectPipelineUtils';
import { getVisibleReminders, sortVisibleReminders } from '@/lib/reminderEngine';
import {
  INQUIRY_NEEDS_PROPOSAL_CONDITION_PREFIX,
  PROJECT_NEEDS_PROPOSAL_CONDITION_PREFIX,
} from '@/lib/proposalReminderRules';
import { CLIENT_NEEDS_PROJECT_CONDITION_PREFIX } from '@/lib/clientReminderRules';
import { INQUIRY_NEEDS_NEXT_STEP_CONDITION_PREFIX } from '@/lib/inquiryReminderRules';
import { SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX, hasNonCancelledWorkStageForProject } from '@/lib/workStageReminderRules';
import { isValidSignedProposal } from '@/lib/signedProposalValidation';
import {
  buildStatusWorkflowMismatch,
  evaluateProjectWorkflowState,
  PROJECT_NEEDS_WORK_STAGES_PREFIX,
  PROJECT_WAITING_FOLLOWUP_PREFIX,
} from '@/lib/projectLifecycleReminderRules';
import {
  getProjectWorkflowExclusion,
  isProjectExcludedFromWorkflowReminders,
} from '@/lib/projectWorkflowExclusions';
import { isCompletedNoRemindersEntry } from '@/lib/projectWorkflowOnboarding';

const INTAKE_CONDITION_PREFIXES = [
  CLIENT_NEEDS_PROJECT_CONDITION_PREFIX,
  INQUIRY_NEEDS_NEXT_STEP_CONDITION_PREFIX,
  INQUIRY_NEEDS_PROPOSAL_CONDITION_PREFIX,
];

const COLLECTION_CONDITION_PREFIXES = [
  COLLECTION_PAYMENT_DUE_PREFIX,
  COLLECTION_NEEDS_TAX_INVOICE_PREFIX,
];

const COLLECTION_OPEN_STATUSES = new Set(['open', 'partially_paid', 'unpaid', 'active', 'awaiting_tax_invoice']);
const COLLECTION_CLOSED_STATUSES = new Set(['paid', 'completed', 'resolved', 'cancelled', 'closed']);

const MISSING_REMINDER_CANDIDATE_STATUSES = new Set(['pricing', 'waiting', 'signed', 'execution']);
const EXCLUDED_MISSING_STATUSES = new Set(['rejected', 'cancelled', 'completed']);

const STALE_PROPOSAL_STATUSES = new Set([
  'waiting',
  'signed',
  'planning',
  'submission',
  'execution',
  'completed',
  'collection_completed',
  'rejected',
  'cancelled',
]);

const STALE_PROPOSAL_REASONS = {
  waiting: 'Project already waiting for client response; proposal reminder may be stale',
  signed: 'Project already accepted; proposal reminder is likely stale',
  planning: 'Project already in planning; proposal reminder is likely stale',
  submission: 'Project already in submission; proposal reminder is likely stale',
  execution: 'Project already in execution; proposal reminder is likely stale',
  completed: 'Project completed; proposal reminder is likely stale',
  collection_completed: 'Project collection completed; proposal reminder is likely stale',
  rejected: 'Project rejected/cancelled; active proposal reminder should probably be closed',
  cancelled: 'Project rejected/cancelled; active proposal reminder should probably be closed',
};

async function safeListEntity(entities, entityName, sortField) {
  if (!entities?.[entityName]?.list) {
    return { items: [], available: false };
  }

  try {
    const items = sortField
      ? await entities[entityName].list(sortField)
      : await entities[entityName].list();
    return { items: items || [], available: true };
  } catch (error) {
    console.warn(`[projectReminderIntegrityAudit] failed to load ${entityName}`, error);
    return { items: [], available: false };
  }
}

function parseIdFromConditionKey(conditionKey, prefix) {
  const normalizedKey = String(conditionKey || '').trim();
  if (!normalizedKey.startsWith(prefix)) return '';
  return normalizedKey.slice(prefix.length).trim();
}

function parseProjectIdFromReminderUrls(reminder) {
  return parseProjectIdFromReminderUrl(reminder?.action_url)
    || parseProjectIdFromReminderUrl(reminder?.target_url);
}

function matchesAnyPrefix(conditionKey, prefixes = []) {
  const normalizedKey = String(conditionKey || '').trim();
  return prefixes.some((prefix) => normalizedKey.startsWith(prefix));
}

function isCollectionDueOpen(status) {
  const normalizedStatus = String(status || '').trim();
  if (!normalizedStatus) return false;
  if (COLLECTION_CLOSED_STATUSES.has(normalizedStatus)) return false;
  return COLLECTION_OPEN_STATUSES.has(normalizedStatus);
}

function resolveProjectContext(projectId, projectsById) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) {
    return {
      project_id: '',
      project_name: '',
      project_status: '',
      project_status_label: '',
      project: null,
    };
  }

  const project = projectsById.get(normalizedProjectId) || null;
  return {
    project_id: normalizedProjectId,
    project_name: project?.name || '',
    project_status: String(project?.status || '').trim(),
    project_status_label: project ? getProjectWorkStatusLabel(project) : '',
    project,
  };
}

function buildBaseReminderRow(reminder) {
  const actionUrl = String(reminder?.action_url || '').trim();
  const targetUrl = String(reminder?.target_url || '').trim();

  return {
    reminder_id: reminder.id,
    reminder_title: reminder.title || '',
    condition_key: String(reminder?.condition_key || '').trim(),
    reminder_status: reminder.status,
    frequency: reminder.frequency || '',
    next_remind_at: reminder.next_remind_at || '',
    project_id: '',
    project_name: '',
    project_status: '',
    project_status_label: '',
    source_type: reminder.source_type || '',
    target_url: targetUrl || actionUrl,
    action_url: actionUrl,
    target_label: reminder.action_label || '',
    classification: '',
    severity: 'info',
    reason: '',
    recommended_action: '',
  };
}

function finalizeReminderRow(row, classification, {
  severity = 'info',
  reason = '',
  recommended_action = '',
  projectContext = {},
} = {}) {
  return {
    ...row,
    ...projectContext,
    classification,
    severity,
    reason,
    recommended_action,
  };
}

function classifyProjectNeedsProposal(reminder, context) {
  const row = buildBaseReminderRow(reminder);
  const projectId = parseIdFromConditionKey(row.condition_key, PROJECT_NEEDS_PROPOSAL_CONDITION_PREFIX);
  const projectContext = resolveProjectContext(projectId, context.projectsById);

  if (!projectId || !projectContext.project) {
    return finalizeReminderRow(row, 'missing_target_or_orphan', {
      severity: 'error',
      reason: 'Reminder points to missing project',
      recommended_action: 'Ask management whether to close this reminder',
      projectContext,
    });
  }

  if (projectContext.project_status === 'pricing') {
    return finalizeReminderRow(row, 'valid_project_reminder', {
      severity: 'info',
      reason: 'Project is still in pricing; proposal reminder is appropriate',
      recommended_action: 'Keep: active proposal reminder for pricing project',
      projectContext,
    });
  }

  if (STALE_PROPOSAL_STATUSES.has(projectContext.project_status)) {
    const staleSeverity = ['rejected', 'cancelled', 'completed'].includes(projectContext.project_status)
      ? 'warning_high'
      : 'warning_high';

    return finalizeReminderRow(row, 'stale_project_reminder', {
      severity: staleSeverity,
      reason: STALE_PROPOSAL_REASONS[projectContext.project_status]
        || 'Project status no longer matches proposal reminder',
      recommended_action: 'Likely stale: project already accepted',
      projectContext,
    });
  }

  return finalizeReminderRow(row, 'valid_project_reminder', {
    severity: 'info',
    reason: `Project status "${projectContext.project_status}" — no stale rule defined`,
    recommended_action: 'Review manually whether reminder is still needed',
    projectContext,
  });
}

function resolveSignedProposalProjectId(reminder, signedProposalId, context) {
  const signedProposal = context.signedProposalsById.get(signedProposalId);
  const fromSignedProposal = String(signedProposal?.project_id || '').trim();
  if (fromSignedProposal && context.projectsById.has(fromSignedProposal)) {
    return fromSignedProposal;
  }

  const fromUrl = parseProjectIdFromReminderUrls(reminder);
  if (fromUrl && context.projectsById.has(fromUrl)) {
    return fromUrl;
  }

  const fromReminder = String(reminder?.project_id || '').trim();
  if (fromReminder && context.projectsById.has(fromReminder)) {
    return fromReminder;
  }

  return '';
}

/** Active workflow reminder on a project excluded by policy → never valid. */
function classifyExcludedWorkflowReminder(row, projectContext) {
  return finalizeReminderRow(row, 'stale_project_reminder', {
    severity: 'warning',
    reason: 'Project is excluded from workflow reminders by management approval',
    recommended_action: 'Close via P2G apply; no workflow reminder needed unless management changes the policy',
    projectContext,
  });
}

/**
 * Workflow-first: a submitted SignedProposal without WorkStages keeps this
 * reminder VALID regardless of Project.status. Status contradictions are
 * reported via statusWorkflowMismatches, never as stale.
 */
function classifySignedProposalNeedsWorkStages(reminder, context) {
  const row = buildBaseReminderRow(reminder);
  const signedProposalId = parseIdFromConditionKey(
    row.condition_key,
    SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX,
  );
  const signedProposal = context.signedProposalsById.get(signedProposalId) || null;
  const projectId = resolveSignedProposalProjectId(reminder, signedProposalId, context);
  const projectContext = resolveProjectContext(projectId, context.projectsById);

  if (!projectId || !projectContext.project) {
    return finalizeReminderRow(row, 'missing_target_or_orphan', {
      severity: 'error',
      reason: 'Cannot resolve project or signed proposal target',
      recommended_action: 'Ask management whether to close this reminder',
      projectContext,
    });
  }

  if (isProjectExcludedFromWorkflowReminders(projectContext.project)) {
    return classifyExcludedWorkflowReminder(row, projectContext);
  }

  const hasWorkStages = hasNonCancelledWorkStageForProject(projectId, context.workStages);
  const status = projectContext.project_status;

  if (hasWorkStages) {
    return finalizeReminderRow(row, 'stale_project_reminder', {
      severity: 'warning_high',
      reason: 'Work stages already exist',
      recommended_action: 'Likely stale: work stages already configured',
      projectContext,
    });
  }

  if (context.supportsSignedProposal) {
    if (!signedProposal) {
      return finalizeReminderRow(row, 'stale_project_reminder', {
        severity: 'warning_high',
        reason: 'SignedProposal record not found; reminder workflow source is gone',
        recommended_action: 'Ask management whether to close this reminder',
        projectContext,
      });
    }

    if (signedProposal.form_status === 'cancelled' || !isValidSignedProposal(signedProposal)) {
      return finalizeReminderRow(row, 'stale_project_reminder', {
        severity: 'warning_high',
        reason: 'SignedProposal is cancelled or no longer valid',
        recommended_action: 'Ask management whether to close this reminder',
        projectContext,
      });
    }

    // Submitted SignedProposal + no WorkStages → valid workflow reminder.
    const statusLagsBehind = status === 'pricing' || status === 'waiting';
    return finalizeReminderRow(row, 'valid_project_reminder', {
      severity: 'info',
      reason: statusLagsBehind
        ? `Submitted signed proposal without work stages — valid workflow reminder (Project.status "${status}" lags behind; see statusWorkflowMismatches)`
        : 'Submitted signed proposal without work stages — valid workflow reminder',
      recommended_action: 'Keep: reminder until work stages are configured',
      projectContext,
    });
  }

  // SignedProposal entity unavailable — fall back to status, without claiming stale.
  if (status === 'signed' || status === 'execution') {
    return finalizeReminderRow(row, 'valid_project_reminder', {
      severity: 'info',
      reason: 'Accepted project without work stages; reminder is appropriate',
      recommended_action: 'Keep: reminder until work stages are configured',
      projectContext,
    });
  }

  return finalizeReminderRow(row, 'valid_project_reminder', {
    severity: 'warning',
    reason: `Cannot verify SignedProposal in this environment; project status is "${status}"`,
    recommended_action: 'Review manually whether reminder is still needed',
    projectContext,
  });
}

function classifyProjectWaitingFollowup(reminder, context) {
  const row = buildBaseReminderRow(reminder);
  const projectId = parseIdFromConditionKey(row.condition_key, PROJECT_WAITING_FOLLOWUP_PREFIX);
  const projectContext = resolveProjectContext(projectId, context.projectsById);

  if (!projectId || !projectContext.project) {
    return finalizeReminderRow(row, 'missing_target_or_orphan', {
      severity: 'error',
      reason: 'Reminder points to missing project',
      recommended_action: 'Ask management whether to close this reminder',
      projectContext,
    });
  }

  if (isProjectExcludedFromWorkflowReminders(projectContext.project)) {
    return classifyExcludedWorkflowReminder(row, projectContext);
  }

  const workflow = context.workflowByProjectId.get(projectId)
    || evaluateProjectWorkflowState(projectContext.project, context);
  const status = projectContext.project_status;

  if (status !== 'waiting') {
    return finalizeReminderRow(row, 'stale_project_reminder', {
      severity: 'warning',
      reason: `Project status is "${status}" (not waiting); follow-up reminder is no longer relevant`,
      recommended_action: 'Ask management whether to close this reminder',
      projectContext,
    });
  }

  if (workflow.workflowState !== 'none') {
    return finalizeReminderRow(row, 'stale_project_reminder', {
      severity: 'warning',
      reason: 'Workflow records exist (signed proposal / work stages); follow-up reminder is superseded',
      recommended_action: 'Likely stale: workflow already progressed past waiting',
      projectContext,
    });
  }

  return finalizeReminderRow(row, 'valid_project_reminder', {
    severity: 'info',
    reason: 'Waiting project with no workflow records; follow-up reminder is appropriate',
    recommended_action: 'Keep: active follow-up for waiting proposal',
    projectContext,
  });
}

function classifyProjectNeedsWorkStages(reminder, context) {
  const row = buildBaseReminderRow(reminder);
  const projectId = parseIdFromConditionKey(row.condition_key, PROJECT_NEEDS_WORK_STAGES_PREFIX);
  const projectContext = resolveProjectContext(projectId, context.projectsById);

  if (!projectId || !projectContext.project) {
    return finalizeReminderRow(row, 'missing_target_or_orphan', {
      severity: 'error',
      reason: 'Reminder points to missing project',
      recommended_action: 'Ask management whether to close this reminder',
      projectContext,
    });
  }

  if (isProjectExcludedFromWorkflowReminders(projectContext.project)) {
    return classifyExcludedWorkflowReminder(row, projectContext);
  }

  const workflow = context.workflowByProjectId.get(projectId)
    || evaluateProjectWorkflowState(projectContext.project, context);
  const status = projectContext.project_status;

  if (workflow.hasWorkStages) {
    return finalizeReminderRow(row, 'stale_project_reminder', {
      severity: 'warning_high',
      reason: 'Work stages already exist',
      recommended_action: 'Likely stale: work stages already configured',
      projectContext,
    });
  }

  if (workflow.hasSubmittedSignedProposal || status === 'signed' || status === 'execution') {
    return finalizeReminderRow(row, 'valid_project_reminder', {
      severity: 'info',
      reason: workflow.hasSubmittedSignedProposal
        ? 'Submitted signed proposal without work stages — valid workflow reminder'
        : 'Accepted/in-work project without work stages; reminder is appropriate',
      recommended_action: 'Keep: reminder until work stages are configured',
      projectContext,
    });
  }

  return finalizeReminderRow(row, 'stale_project_reminder', {
    severity: 'warning',
    reason: `No submitted signed proposal and status "${status}" is not signed/execution; work-stage reminder has no workflow source`,
    recommended_action: 'Ask management whether to close this reminder',
    projectContext,
  });
}

function classifyCollectionPaymentDue(reminder, context) {
  const row = buildBaseReminderRow(reminder);
  const collectionPrefix = COLLECTION_CONDITION_PREFIXES.find(
    (prefix) => row.condition_key.startsWith(prefix),
  );
  const collectionDueId = parseIdFromConditionKey(row.condition_key, collectionPrefix);
  const collectionDue = context.collectionDuesById.get(collectionDueId);

  if (!collectionDueId || !collectionDue) {
    return finalizeReminderRow(row, 'missing_target_or_orphan', {
      severity: 'error',
      reason: 'Reminder points to missing collection due',
      recommended_action: 'Ask management whether to close this reminder',
    });
  }

  const projectId = String(collectionDue?.project_id || '').trim();
  const projectContext = resolveProjectContext(projectId, context.projectsById);

  if (!projectId) {
    return finalizeReminderRow(row, 'missing_target_or_orphan', {
      severity: 'error',
      reason: 'Collection due has no project_id',
      recommended_action: 'Ask management whether to close this reminder',
      projectContext,
    });
  }

  const collectionStatus = String(collectionDue?.status || '').trim();

  if (COLLECTION_CLOSED_STATUSES.has(collectionStatus) || collectionStatus === 'cancelled') {
    return finalizeReminderRow(row, 'stale_project_reminder', {
      severity: 'warning_high',
      reason: 'Collection due is already closed/paid',
      recommended_action: 'Likely stale: collection due already closed',
      projectContext,
    });
  }

  if (isCollectionDueOpen(collectionStatus)) {
    return finalizeReminderRow(row, 'valid_project_reminder', {
      severity: 'info',
      reason: 'Collection due is open; payment reminder is appropriate',
      recommended_action: 'Keep: active collection reminder for open collection due',
      projectContext,
    });
  }

  return finalizeReminderRow(row, 'stale_project_reminder', {
    severity: 'warning',
    reason: `Collection due status "${collectionStatus}" may no longer need an active reminder`,
    recommended_action: 'Review manually whether to close this reminder',
    projectContext,
  });
}

function classifyIntakeReminder(reminder) {
  const row = buildBaseReminderRow(reminder);
  return finalizeReminderRow(row, 'intake_reminder', {
    severity: 'info',
    reason: 'Intake / lead reminder — not mapped to a project lifecycle bucket',
    recommended_action: 'Do not map to project; this is an intake reminder',
  });
}

function classifyUnknownConditionKey(reminder, context) {
  const row = buildBaseReminderRow(reminder);
  const projectId = parseProjectIdFromReminderUrls(reminder)
    || String(reminder?.project_id || '').trim();
  const projectContext = projectId
    ? resolveProjectContext(projectId, context.projectsById)
    : {};

  return finalizeReminderRow(row, 'unknown_condition_key', {
    severity: 'warning',
    reason: 'Unknown or unhandled condition_key for integrity rules',
    recommended_action: 'Review manually whether this reminder is still valid',
    projectContext,
  });
}

function classifyReminder(reminder, context) {
  const conditionKey = String(reminder?.condition_key || '').trim();

  if (conditionKey.startsWith(PROJECT_NEEDS_PROPOSAL_CONDITION_PREFIX)) {
    return classifyProjectNeedsProposal(reminder, context);
  }

  if (conditionKey.startsWith(SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX)) {
    return classifySignedProposalNeedsWorkStages(reminder, context);
  }

  if (conditionKey.startsWith(PROJECT_WAITING_FOLLOWUP_PREFIX)) {
    return classifyProjectWaitingFollowup(reminder, context);
  }

  if (conditionKey.startsWith(PROJECT_NEEDS_WORK_STAGES_PREFIX)) {
    return classifyProjectNeedsWorkStages(reminder, context);
  }

  if (matchesAnyPrefix(conditionKey, COLLECTION_CONDITION_PREFIXES)) {
    return classifyCollectionPaymentDue(reminder, context);
  }

  if (matchesAnyPrefix(conditionKey, INTAKE_CONDITION_PREFIXES)) {
    return classifyIntakeReminder(reminder);
  }

  return classifyUnknownConditionKey(reminder, context);
}

function buildMissingReminderCandidateRow(project, pipelineRow, activeRemindersCount) {
  const status = String(project?.status || '').trim();
  const statusReasons = {
    pricing: 'Pricing project has no active mapped reminder',
    waiting: 'Waiting project has no active mapped reminder',
    signed: 'Signed project has no active mapped reminder',
    execution: 'Execution project has no active mapped reminder',
  };

  return {
    project_id: project.id,
    project_name: project.name || '',
    project_status: status,
    project_status_label: getProjectWorkStatusLabel(project),
    work_number: project.work_number || '',
    bid_number: project.bid_number || '',
    active_reminders_count: activeRemindersCount,
    work_stage_count: pipelineRow?.work_stage_count || 0,
    has_open_collection_due: pipelineRow?.has_open_collection_due || false,
    classification: 'missing_reminder_candidate',
    severity: 'warning',
    reason: statusReasons[status] || `${status} project has no active mapped reminder`,
    recommended_action: 'Ask management whether this project needs a reminder',
  };
}

function buildCompletedNeedsPolicyRow(project, pipelineRow) {
  return {
    project_id: project.id,
    project_name: project.name || project.project_name || '',
    project_status: String(project?.status || '').trim(),
    project_status_label: getProjectWorkStatusLabel(project),
    construction_status: pipelineRow?.construction_status || CONSTRUCTION_STATUS_NOT_UPDATED,
    construction_status_label: pipelineRow?.construction_status_label || '',
    active_reminders_count: pipelineRow?.active_reminder_count || 0,
    classification: 'needs_business_policy',
    severity: 'info',
    reason: 'Completed project without construction status policy decision',
    recommended_action: 'Define business policy for construction/facility follow-up',
  };
}

function buildCompletedNoWorkflowNeededRow(project, pipelineRow) {
  return {
    project_id: project.id,
    project_name: project.name || project.project_name || '',
    project_status: String(project?.status || '').trim(),
    project_status_label: getProjectWorkStatusLabel(project),
    construction_status: pipelineRow?.construction_status || CONSTRUCTION_STATUS_NOT_UPDATED,
    construction_status_label: pipelineRow?.construction_status_label || '',
    active_reminders_count: pipelineRow?.active_reminder_count || 0,
    workflow_entry_stage: project.workflow_entry_stage,
    workflow_state: project.workflow_entry_stage,
    classification: 'completed_no_workflow_needed',
    severity: 'info',
    reason: 'Project already marked as completed_no_reminders',
    recommended_action: 'No workflow reminder needed at this stage',
  };
}

function buildRecommendations(groups, counts) {
  const recommendations = [];

  if (counts.staleProjectRemindersCount > 0) {
    recommendations.push({
      type: 'stale_project_reminders',
      count: counts.staleProjectRemindersCount,
      message: 'Review stale project reminders manually before closing anything.',
    });
  }

  if (counts.missingTargetOrOrphanCount > 0) {
    recommendations.push({
      type: 'missing_target_or_orphan',
      count: counts.missingTargetOrOrphanCount,
      message: 'Orphan reminders point to missing entities and likely need manual cleanup review.',
    });
  }

  if (counts.missingReminderCandidatesCount > 0) {
    recommendations.push({
      type: 'missing_reminder_candidates',
      count: counts.missingReminderCandidatesCount,
      message: 'Active projects without reminders may need new reminders — do not auto-create.',
    });
  }

  if (counts.completedNeedsPolicyCount > 0) {
    recommendations.push({
      type: 'completed_needs_policy',
      count: counts.completedNeedsPolicyCount,
      message: 'Completed projects need a business policy for construction/facility follow-up.',
    });
  }

  if (counts.completedNoWorkflowNeededCount > 0) {
    recommendations.push({
      type: 'completed_no_workflow_needed',
      count: counts.completedNoWorkflowNeededCount,
      message: 'Completed projects are already marked as no workflow reminders needed.',
    });
  }

  if (groups.unknownConditionKeys.length > 0) {
    recommendations.push({
      type: 'unknown_condition_keys',
      count: groups.unknownConditionKeys.length,
      message: 'Some reminders use condition keys not covered by integrity rules.',
    });
  }

  if (groups.statusWorkflowMismatches.length > 0) {
    recommendations.push({
      type: 'status_workflow_mismatches',
      count: groups.statusWorkflowMismatches.length,
      message: 'Project.status lags behind workflow records on some projects — review whether to update the status manually. Do NOT close workflow reminders because of this.',
    });
  }

  return recommendations;
}

export async function runProjectReminderIntegrityAudit({ entities = base44.entities } = {}) {
  const [
    projectResult,
    reminderResult,
    collectionDueResult,
    workStageResult,
    signedProposalResult,
    quoteResult,
  ] = await Promise.all([
    safeListEntity(entities, 'Project', '-year'),
    safeListEntity(entities, 'Reminder'),
    safeListEntity(entities, 'CollectionDue', '-created_date'),
    safeListEntity(entities, 'WorkStage'),
    safeListEntity(entities, 'SignedProposal'),
    safeListEntity(entities, 'Quote'),
  ]);

  const projects = projectResult.items;
  const allReminders = reminderResult.items;
  const collectionDues = collectionDueResult.items;
  const workStages = workStageResult.items;
  const signedProposals = signedProposalResult.items;
  const quotes = quoteResult.items;

  const activeReminders = sortVisibleReminders(
    getVisibleReminders(allReminders, new Date()),
    new Date(),
  );

  const projectsById = new Map(projects.map((project) => [String(project.id), project]));
  const signedProposalsById = new Map(
    signedProposals.map((item) => [String(item.id), item]),
  );
  const collectionDuesById = new Map(
    collectionDues.map((due) => [String(due.id), due]),
  );

  const pipelineRows = buildProjectPipelineRows(projects, workStages, collectionDues);
  const pipelineRowsByProjectId = new Map(
    pipelineRows.map((row) => [String(row.project_id), row]),
  );

  const reminderMapResult = buildProjectReminderMap(activeReminders, projects, collectionDues);

  const workflowByProjectId = new Map(
    projects.map((project) => [
      String(project.id),
      evaluateProjectWorkflowState(project, { workStages, signedProposals }),
    ]),
  );

  const context = {
    projectsById,
    signedProposalsById,
    collectionDuesById,
    workStages,
    signedProposals,
    quotes,
    workflowByProjectId,
    supportsSignedProposal: signedProposalResult.available,
  };

  const classifiedRows = activeReminders.map((reminder) => classifyReminder(reminder, context));

  const groups = {
    staleProjectReminders: classifiedRows.filter((row) => row.classification === 'stale_project_reminder'),
    missingReminderCandidates: [],
    missingTargetOrOrphan: classifiedRows.filter((row) => row.classification === 'missing_target_or_orphan'),
    intakeReminders: classifiedRows.filter((row) => row.classification === 'intake_reminder'),
    unknownConditionKeys: classifiedRows.filter((row) => row.classification === 'unknown_condition_key'),
    validProjectReminders: classifiedRows.filter((row) => row.classification === 'valid_project_reminder'),
    completedNeedsPolicy: [],
    completedNoWorkflowNeeded: [],
    statusWorkflowMismatches: [],
    workflowExcludedProjects: [],
  };

  for (const project of projects) {
    if (isProjectExcludedFromWorkflowReminders(project)) continue;
    const workflow = workflowByProjectId.get(String(project.id));
    const mismatch = buildStatusWorkflowMismatch(project, workflow);
    if (mismatch) {
      groups.statusWorkflowMismatches.push({
        ...mismatch,
        project_status_label: getProjectWorkStatusLabel(project),
      });
    }
  }

  for (const project of projects) {
    const projectId = String(project.id);
    const status = String(project?.status || '').trim();
    const pipelineRow = pipelineRowsByProjectId.get(projectId);
    const mappedReminders = reminderMapResult.byProjectId[projectId] || [];
    const activeMappedCount = mappedReminders.length;

    const exclusion = getProjectWorkflowExclusion(project);
    if (exclusion) {
      groups.workflowExcludedProjects.push({
        ...exclusion,
        project_status: status,
        project_status_label: getProjectWorkStatusLabel(project),
        classification: 'workflow_excluded_project',
        severity: 'info',
        recommended_action: 'No workflow reminder needed unless management changes the policy.',
      });
    }

    if (
      !exclusion
      && MISSING_REMINDER_CANDIDATE_STATUSES.has(status)
      && activeMappedCount === 0
      && !EXCLUDED_MISSING_STATUSES.has(status)
    ) {
      groups.missingReminderCandidates.push(
        buildMissingReminderCandidateRow(project, pipelineRow, activeMappedCount),
      );
    }

    if (
      status === 'completed'
      && pipelineRow?.construction_status === CONSTRUCTION_STATUS_NOT_UPDATED
    ) {
      if (isCompletedNoRemindersEntry(project)) {
        groups.completedNoWorkflowNeeded.push(
          buildCompletedNoWorkflowNeededRow(project, pipelineRow),
        );
      } else {
        groups.completedNeedsPolicy.push(buildCompletedNeedsPolicyRow(project, pipelineRow));
      }
    }
  }

  const counts = {
    projectsTotal: projects.length,
    remindersTotal: allReminders.length,
    activeRemindersTotal: activeReminders.length,
    validProjectRemindersCount: groups.validProjectReminders.length,
    staleProjectRemindersCount: groups.staleProjectReminders.length,
    missingTargetOrOrphanCount: groups.missingTargetOrOrphan.length,
    intakeRemindersCount: groups.intakeReminders.length,
    unknownConditionKeyCount: groups.unknownConditionKeys.length,
    missingReminderCandidatesCount: groups.missingReminderCandidates.length,
    pricingWithoutReminderCount: groups.missingReminderCandidates.filter(
      (row) => row.project_status === 'pricing',
    ).length,
    waitingWithoutReminderCount: groups.missingReminderCandidates.filter(
      (row) => row.project_status === 'waiting',
    ).length,
    signedWithoutReminderCount: groups.missingReminderCandidates.filter(
      (row) => row.project_status === 'signed',
    ).length,
    executionWithoutReminderCount: groups.missingReminderCandidates.filter(
      (row) => row.project_status === 'execution',
    ).length,
    completedNeedsPolicyCount: groups.completedNeedsPolicy.length,
    completedNoWorkflowNeededCount: groups.completedNoWorkflowNeeded.length,
    statusWorkflowMismatchesCount: groups.statusWorkflowMismatches.length,
    workflowExcludedProjectsCount: groups.workflowExcludedProjects.length,
  };

  const recommendations = buildRecommendations(groups, counts);

  return {
    status: 'completed',
    readOnly: true,
    generated_at: new Date().toISOString(),
    entityAvailability: {
      supportsSignedProposal: signedProposalResult.available,
      supportsQuote: quoteResult.available,
      signedProposalsLoaded: signedProposals.length,
      quotesLoaded: quotes.length,
    },
    counts,
    groups,
    recommendations,
  };
}
