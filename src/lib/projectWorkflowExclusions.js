/**
 * Reminder-policy exclusion layer (approved by Aharon).
 *
 * Excluded projects must NOT receive workflow reminders:
 *   - project_needs_work_stages
 *   - project_waiting_followup
 *   - signed_proposal_needs_work_stages (if one points at an excluded project)
 *
 * The exclusion does NOT affect: CollectionDue reminders, intake/inquiry/client
 * reminders, manual reminders, collection flows, or Dashboard metrics.
 * It is a reminder policy only — it does not change workflow-first truth
 * evaluation (evaluateProjectWorkflowState stays untouched).
 *
 * Matching is by project id only; names below are documentation.
 */
export const WORKFLOW_REMINDER_EXCLUDED_PROJECT_IDS = new Set([
  '69a3812797833658f7e298bb', // טרמודן
  '69a3812797833658f7e298be', // מרכז מסחרי דימונה
]);

export const WORKFLOW_REMINDER_EXCLUSION_REASONS = {
  '69a3812797833658f7e298bb': 'הוחרג לפי אישור אהרון — לא לנהל Workflow לפרויקט זה.',
  '69a3812797833658f7e298be': 'הוחרג לפי אישור אהרון — לא לנהל Workflow לפרויקט זה.',
};

export function isProjectExcludedFromWorkflowReminders(project) {
  return Boolean(project?.id && WORKFLOW_REMINDER_EXCLUDED_PROJECT_IDS.has(String(project.id)));
}

export function getProjectWorkflowExclusion(project) {
  if (!isProjectExcludedFromWorkflowReminders(project)) return null;

  return {
    project_id: project.id,
    project_name: project.name || project.project_name || '',
    reason: WORKFLOW_REMINDER_EXCLUSION_REASONS[String(project.id)]
      || 'Project excluded from workflow reminders.',
  };
}
