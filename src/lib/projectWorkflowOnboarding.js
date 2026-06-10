/**
 * Workflow onboarding model for Project entities.
 *
 * Runtime reminder rules use workflow_managed + workflow_entry_stage (and
 * workflow_historical_exemptions) — NOT form_status or Project.status.
 * Legacy bootstrap / onboarding preview may still infer entry stages from
 * status or active reminders for one-time migration.
 */

export const WORKFLOW_ENTRY_STAGE = {
  UNMANAGED: 'unmanaged',
  PROPOSAL: 'proposal',
  PROPOSAL_FOLLOWUP: 'proposal_followup',
  WORK_STAGES: 'work_stages',
  INVOICE: 'invoice',
  COLLECTION: 'collection',
  COMPLETED_NO_REMINDERS: 'completed_no_reminders',
};

export const WORKFLOW_ORIGIN = {
  NONE: 'none',
  NATIVE: 'native',
  LEGACY_BOOTSTRAP: 'legacy_bootstrap',
};

export const HISTORICAL_EXEMPTION_KEY = {
  PROPOSAL: 'proposal',
  SIGNED_PROPOSAL: 'signed_proposal',
  WORK_STAGES: 'work_stages',
};

export const APPLY_PROJECT_WORKFLOW_ONBOARDING_CONFIRM_TEXT = 'APPLY_PROJECT_WORKFLOW_ONBOARDING';

const WORKFLOW_ONBOARDING_FIELD_NAMES = [
  'workflow_managed',
  'workflow_origin',
  'workflow_entry_stage',
  'workflow_onboarded_at',
  'workflow_onboarding_note',
  'workflow_historical_exemptions',
];

/**
 * Runtime ownership: explicit workflow_managed === true only.
 * form_status / source_inquiry_id are NOT sufficient.
 */
export function isWorkflowManagedProject(project) {
  return project?.workflow_managed === true;
}

export function getWorkflowEntryStage(project) {
  const stage = String(project?.workflow_entry_stage || '').trim();
  return stage || WORKFLOW_ENTRY_STAGE.UNMANAGED;
}

export function parseHistoricalExemptions(project) {
  const raw = String(project?.workflow_historical_exemptions || '').trim();
  if (!raw) return new Set();
  return new Set(raw.split(',').map((part) => part.trim()).filter(Boolean));
}

export function formatHistoricalExemptions(keys = []) {
  return [...new Set(keys.filter(Boolean))].join(',');
}

/** @param {string} key — "proposal" | "signed_proposal" | "work_stages" */
export function hasHistoricalExemption(project, key) {
  return parseHistoricalExemptions(project).has(key);
}

export function isCompletedNoRemindersEntry(project) {
  return getWorkflowEntryStage(project) === WORKFLOW_ENTRY_STAGE.COMPLETED_NO_REMINDERS;
}

export function isProposalEntryStage(project) {
  return isWorkflowManagedProject(project)
    && getWorkflowEntryStage(project) === WORKFLOW_ENTRY_STAGE.PROPOSAL;
}

export function isProposalFollowupEntryStage(project) {
  return isWorkflowManagedProject(project)
    && getWorkflowEntryStage(project) === WORKFLOW_ENTRY_STAGE.PROPOSAL_FOLLOWUP;
}

export function isWorkStagesEntryStage(project) {
  return isWorkflowManagedProject(project)
    && getWorkflowEntryStage(project) === WORKFLOW_ENTRY_STAGE.WORK_STAGES;
}

export function buildWorkflowOnboardingPatch({
  workflow_managed,
  workflow_origin,
  workflow_entry_stage,
  workflow_historical_exemptions = '',
  workflow_onboarding_note = '',
  workflow_onboarded_at,
}) {
  return {
    workflow_managed,
    workflow_origin,
    workflow_entry_stage,
    workflow_historical_exemptions,
    workflow_onboarding_note,
    workflow_onboarded_at: workflow_onboarded_at || new Date().toISOString(),
  };
}

export function pickWorkflowOnboardingFields(project) {
  const picked = {};
  for (const field of WORKFLOW_ONBOARDING_FIELD_NAMES) {
    if (project?.[field] !== undefined) {
      picked[field] = project[field];
    }
  }
  return picked;
}
