import { base44 } from '@/api/base44Client';
import {
  cancelRemindersForDeletedSource,
  resolveReminderByConditionKey,
} from '@/lib/reminderEngine';
import { cancelRemindersForInvoiceProcess } from '@/lib/invoiceReminderRules';
import {
  cancelRemindersForProposal,
  getProjectNeedsProposalConditionKey,
} from '@/lib/proposalReminderRules';
import { getProjectCompletedNeedsInvoiceReviewConditionKey } from '@/lib/invoiceReminderRules';
import { getSignedProposalNeedsWorkStagesConditionKey } from '@/lib/workStageReminderRules';
import {
  buildSourceRefsFromImpact,
  createDeletionSummary,
  findActiveRemindersForSourceRefs,
  listEntitiesByExactProjectId,
  normalizeEntityId,
  safeDeleteEntityRecord,
  trackDeletionResult,
} from '@/lib/deletionUtils';
import { cancelWorkStageRelatedReminders } from '@/lib/workProcessDeletionUtils';

function buildImpactCounts(impact) {
  return {
    proposals: impact.proposals.length,
    signedProposals: impact.signedProposals.length,
    workStages: impact.workStages.length,
    invoiceProcesses: impact.invoiceProcesses.length,
    collectionDues: impact.collectionDues.length,
    collectionEvents: impact.collectionEvents.length,
    activeReminders: impact.activeReminders.length,
  };
}

function buildDisplayLabels(items = [], labelField, fallback = 'רשומה') {
  return items.map((item) => String(item?.[labelField] || item?.id || fallback).trim()).filter(Boolean);
}

export async function buildProjectDeletionImpact(projectId, { entities = base44.entities } = {}) {
  const normalizedProjectId = normalizeEntityId(projectId);
  if (!normalizedProjectId) {
    throw new Error('MISSING_PROJECT_ID');
  }

  const [
    projectResults,
    proposals,
    signedProposals,
    workStages,
    invoiceProcesses,
    collectionDues,
    collectionEvents,
    reminders,
  ] = await Promise.all([
    entities.Project.filter({ id: normalizedProjectId }),
    listEntitiesByExactProjectId(entities.Proposal, normalizedProjectId),
    listEntitiesByExactProjectId(entities.SignedProposal, normalizedProjectId),
    listEntitiesByExactProjectId(entities.WorkStage, normalizedProjectId),
    listEntitiesByExactProjectId(entities.InvoiceProcess, normalizedProjectId),
    entities.CollectionDue
      ? listEntitiesByExactProjectId(entities.CollectionDue, normalizedProjectId)
      : Promise.resolve([]),
    entities.CollectionEvent
      ? listEntitiesByExactProjectId(entities.CollectionEvent, normalizedProjectId)
      : Promise.resolve([]),
    entities.Reminder?.list ? entities.Reminder.list() : Promise.resolve([]),
  ]);

  const project = projectResults?.[0] || null;
  const impact = {
    projectId: normalizedProjectId,
    project,
    projectName: project?.name || 'פרויקט',
    proposals,
    signedProposals,
    workStages,
    invoiceProcesses,
    collectionDues,
    collectionEvents,
    display: {
      proposalLabels: buildDisplayLabels(proposals, 'document_note'),
      signedProposalLabels: buildDisplayLabels(signedProposals, 'project_name'),
      workStageLabels: buildDisplayLabels(workStages, 'title', 'שלב'),
      invoiceLabels: buildDisplayLabels(invoiceProcesses, 'invoice_reference'),
      collectionDueLabels: buildDisplayLabels(collectionDues, 'invoice_reference'),
    },
    activeReminders: [],
    counts: {},
  };

  impact.activeReminders = findActiveRemindersForSourceRefs(
    reminders,
    buildSourceRefsFromImpact(impact),
  );
  impact.counts = buildImpactCounts(impact);

  return impact;
}

export async function cancelProjectRelatedReminders(impact, options = {}) {
  const reason = options.reason || 'project_deleted_cascade';
  let cancelled = 0;

  for (const stage of impact.workStages || []) {
    await cancelWorkStageRelatedReminders(stage.id);
    cancelled += 1;
  }

  for (const invoice of impact.invoiceProcesses || []) {
    await cancelRemindersForInvoiceProcess(invoice.id, options);
    await cancelRemindersForDeletedSource('invoice_process', invoice.id, options);
    cancelled += 1;
  }

  for (const proposal of impact.proposals || []) {
    await cancelRemindersForProposal(proposal.id);
    await cancelRemindersForDeletedSource('proposal', proposal.id, options);
    cancelled += 1;
  }

  for (const signedProposal of impact.signedProposals || []) {
    await resolveReminderByConditionKey(
      getSignedProposalNeedsWorkStagesConditionKey(signedProposal.id),
      reason,
      options,
    );
    await cancelRemindersForDeletedSource('signed_proposal', signedProposal.id, options);
    cancelled += 1;
  }

  if (impact.project?.id) {
    await resolveReminderByConditionKey(
      getProjectNeedsProposalConditionKey(impact.project.id),
      reason,
      options,
    );
    await resolveReminderByConditionKey(
      getProjectCompletedNeedsInvoiceReviewConditionKey(impact.project.id),
      reason,
      options,
    );
    await cancelRemindersForDeletedSource('project', impact.project.id, options);
    cancelled += 1;
  }

  return { cancelled };
}

export async function deleteProjectCascade(projectId, { entities = base44.entities } = {}) {
  const impact = await buildProjectDeletionImpact(projectId, { entities });
  const summary = createDeletionSummary();

  if (!impact.project?.id) {
    throw new Error('PROJECT_NOT_FOUND');
  }

  await cancelProjectRelatedReminders(impact);

  const deleteBuckets = [
    { bucket: 'collectionDues', entity: entities.CollectionDue, items: impact.collectionDues },
    { bucket: 'invoiceProcesses', entity: entities.InvoiceProcess, items: impact.invoiceProcesses },
    { bucket: 'workStages', entity: entities.WorkStage, items: impact.workStages },
    { bucket: 'signedProposals', entity: entities.SignedProposal, items: impact.signedProposals },
    { bucket: 'proposals', entity: entities.Proposal, items: impact.proposals },
    { bucket: 'collectionEvents', entity: entities.CollectionEvent, items: impact.collectionEvents },
  ];

  for (const { bucket, entity, items } of deleteBuckets) {
    if (!entity) continue;

    for (const item of items || []) {
      const result = await safeDeleteEntityRecord(entity, item.id);
      trackDeletionResult(summary, bucket, result);

      if (result.status === 'failed') {
        throw result.error instanceof Error
          ? result.error
          : new Error(String(result.error || `DELETE_FAILED:${bucket}`));
      }
    }
  }

  const projectDeleteResult = await safeDeleteEntityRecord(entities.Project, impact.project.id);
  trackDeletionResult(summary, 'projects', projectDeleteResult);

  if (projectDeleteResult.status === 'failed') {
    throw projectDeleteResult.error instanceof Error
      ? projectDeleteResult.error
      : new Error(String(projectDeleteResult.error || 'PROJECT_DELETE_FAILED'));
  }

  return { impact, summary };
}

export async function invalidateQueriesAfterProjectDeletion(queryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['projects'] }),
    queryClient.invalidateQueries({ queryKey: ['proposals'] }),
    queryClient.invalidateQueries({ queryKey: ['signed-proposals'] }),
    queryClient.invalidateQueries({ queryKey: ['work-stages'] }),
    queryClient.invalidateQueries({ queryKey: ['work-stages-all'] }),
    queryClient.invalidateQueries({ queryKey: ['invoice-processes'] }),
    queryClient.invalidateQueries({ queryKey: ['collection-dues'] }),
    queryClient.invalidateQueries({ queryKey: ['reminders'] }),
    queryClient.invalidateQueries({ queryKey: ['reminders', 'visible'] }),
  ]);
}
