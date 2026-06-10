/**
 * P2G — Read-only preview of the project reminder rules alignment.
 *
 * Wraps runProjectLifecycleReminderRulesForAll in dry-run mode, so the exact
 * same planner that the guarded apply uses produces the preview. Zero
 * mutations: dryRun=true, apply=false is enforced here and cannot be
 * overridden by callers.
 */
import { runProjectLifecycleReminderRulesForAll } from '@/lib/projectLifecycleReminderRules';

export async function runProjectReminderRulesPreview() {
  const plan = await runProjectLifecycleReminderRulesForAll({ dryRun: true, apply: false });

  return {
    status: 'completed',
    readOnly: true,
    generated_at: plan.generated_at,
    projectsChecked: plan.projectsChecked,
    counts: {
      staleProposalRemindersToResolve: plan.counts.staleProposalRemindersToResolve,
      pricingProposalRemindersToCreate: plan.counts.pricingProposalRemindersToCreate,
      waitingFollowupRemindersToCreate: plan.counts.waitingFollowupRemindersToCreate,
      workStageRemindersToCreate: plan.counts.workStageRemindersToCreate,
      projectWorkStageRemindersToResolve: plan.counts.projectWorkStageRemindersToResolve,
      duplicatesPrevented: plan.counts.duplicatesPrevented,
      statusWorkflowMismatches: plan.counts.statusWorkflowMismatches,
      excludedWorkflowRemindersToResolve: plan.counts.excludedWorkflowRemindersToResolve,
      workflowExcludedProjectsCount: plan.counts.workflowExcludedProjects,
    },
    groups: {
      staleProposalRemindersToResolve: plan.groups.staleProposalRemindersToResolve,
      pricingProposalRemindersToCreate: plan.groups.pricingProposalRemindersToCreate,
      waitingFollowupRemindersToCreate: plan.groups.waitingFollowupRemindersToCreate,
      workStageRemindersToCreate: plan.groups.workStageRemindersToCreate,
      projectWorkStageRemindersToResolve: plan.groups.projectWorkStageRemindersToResolve,
      duplicatesPrevented: plan.groups.duplicatesPrevented,
      statusWorkflowMismatches: plan.groups.statusWorkflowMismatches,
      excludedWorkflowRemindersToResolve: plan.groups.excludedWorkflowRemindersToResolve,
      workflowExcludedProjects: plan.groups.workflowExcludedProjects,
    },
  };
}
