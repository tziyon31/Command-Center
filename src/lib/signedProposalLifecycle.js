import { api as base44 } from '@/api/apiClient';
import {
  createReminderEngineCache,
  loadReminderEngineCache,
} from '@/lib/reminderEngine';
import {
  runProposalReminderRulesForProject,
  runProposalReminderRulesForProposal,
  runSignedProposalNeedReminderRuleForProposal,
} from '@/lib/proposalReminderRules';

import { isValidSignedProposal as isValidSignedProposalRecord } from '@/lib/signedProposalValidation';

export { isValidSignedProposalRecord as isValidSignedProposal };

export async function clearProjectSourceSignedProposalLinks(signedProposalId, projectIdHint = '') {
  const clearedProjectIds = [];

  if (!signedProposalId) {
    return clearedProjectIds;
  }

  const clearProjectLink = async (project) => {
    if (!project?.id) return;
    if (String(project.source_signed_proposal_id || '') !== String(signedProposalId)) return;

    await base44.entities.Project.update(project.id, {
      source_signed_proposal_id: '',
    });
    clearedProjectIds.push(project.id);
  };

  const hintedProjectId = String(projectIdHint || '').trim();

  if (hintedProjectId) {
    const results = await base44.entities.Project.filter({ id: hintedProjectId });
    await clearProjectLink(results?.[0]);
  }

  const projects = await base44.entities.Project.list();
  for (const project of projects) {
    if (hintedProjectId && project.id === hintedProjectId) continue;
    await clearProjectLink(project);
  }

  return clearedProjectIds;
}

export async function linkProjectToValidSignedProposal(signedProposal) {
  if (!isValidSignedProposalRecord(signedProposal)) return null;

  const projectId = String(signedProposal.project_id || '').trim();
  if (!projectId || !signedProposal.id) return null;

  await base44.entities.Project.update(projectId, {
    source_signed_proposal_id: signedProposal.id,
  });

  return projectId;
}

export async function syncRulesAfterSignedProposalInvalidation(signedProposal, options = {}) {
  const signedProposalId = String(signedProposal?.id || '').trim();
  const projectId = String(signedProposal?.project_id || '').trim();
  const proposalId = String(signedProposal?.proposal_id || '').trim();

  const clearedProjectIds = await clearProjectSourceSignedProposalLinks(
    signedProposalId,
    projectId,
  );

  const cache = options.cache || createReminderEngineCache();
  await loadReminderEngineCache(cache);

  let proposals = cache.proposals;
  let projects = cache.projects;
  let signedProposals = cache.signedProposals;

  if (!proposals) {
    proposals = await base44.entities.Proposal.list();
  }

  if (!projects) {
    projects = await base44.entities.Project.list();
  }

  if (!signedProposals) {
    signedProposals = await base44.entities.SignedProposal.list();
  }

  if (signedProposalId) {
    signedProposals = signedProposals.filter((item) => item.id !== signedProposalId);
  }

  cache.proposals = proposals;
  cache.projects = projects;
  cache.signedProposals = signedProposals;

  const relatedProposals = proposals.filter((proposal) => (
    (proposalId && proposal.id === proposalId)
    || (projectId && proposal.project_id === projectId)
  ));

  for (const proposal of relatedProposals) {
    await runSignedProposalNeedReminderRuleForProposal(proposal, cache);
    await runProposalReminderRulesForProposal(proposal, cache);
  }

  if (projectId) {
    const project = projects.find((item) => item.id === projectId);
    if (project) {
      await runProposalReminderRulesForProject(project, cache);
    }
  }

  return {
    clearedProjectIds,
    syncedProposalCount: relatedProposals.length,
  };
}

export async function deleteSignedProposalWithLifecycle(signedProposalId) {
  const results = await base44.entities.SignedProposal.filter({ id: signedProposalId });
  const signedProposal = results?.[0] || { id: signedProposalId };

  await base44.entities.SignedProposal.delete(signedProposalId);

  return syncRulesAfterSignedProposalInvalidation(signedProposal);
}

export async function cancelSignedProposalWithLifecycle(signedProposalId) {
  const updated = await base44.entities.SignedProposal.update(signedProposalId, {
    form_status: 'cancelled',
  });

  return syncRulesAfterSignedProposalInvalidation(updated);
}
