/**
 * P2G/P2I — Read-only preview of the project reminder rules.
 *
 * Wraps runProjectLifecycleReminderRulesForAll in dry-run mode, so the exact
 * same planner that the guarded apply uses produces the preview. Zero
 * mutations: dryRun=true, apply=false is enforced here and cannot be
 * overridden by callers.
 *
 * mode:
 * - runtime (default): validation preview of the records-only rules.
 * - legacy_bootstrap (explicit): migration preview — may use Project.status.
 */
import {
  PLANNER_MODE_LEGACY_BOOTSTRAP,
  PLANNER_MODE_RUNTIME,
  runProjectLifecycleReminderRulesForAll,
} from '@/lib/projectLifecycleReminderRules';

const REPORTED_GROUP_KEYS = [
  'staleProposalRemindersToResolve',
  'pricingProposalRemindersToCreate',
  'waitingFollowupRemindersToCreate',
  'proposalFollowupRemindersToCreate',
  'workStageRemindersToCreate',
  'projectWorkStageRemindersToResolve',
  'duplicatesPrevented',
  'statusWorkflowMismatches',
  'excludedWorkflowRemindersToResolve',
  'workflowExcludedProjects',
  'runtimeEvidenceGaps',
];

export async function runProjectReminderRulesPreview({ mode = PLANNER_MODE_RUNTIME } = {}) {
  const plan = await runProjectLifecycleReminderRulesForAll({ dryRun: true, apply: false, mode });

  const counts = {};
  const groups = {};
  for (const key of REPORTED_GROUP_KEYS) {
    counts[key] = plan.counts[key] ?? 0;
    groups[key] = plan.groups[key] ?? [];
  }
  // Backwards-compatible alias used by the preview UI.
  counts.workflowExcludedProjectsCount = counts.workflowExcludedProjects;

  return {
    status: 'completed',
    readOnly: true,
    mode: plan.mode,
    generated_at: plan.generated_at,
    projectsChecked: plan.projectsChecked,
    counts,
    groups,
  };
}
