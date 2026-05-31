import { base44 } from '@/api/base44Client';
import { isValidSignedProposal } from '@/lib/signedProposalValidation';
import {
  ensureReminderForCondition,
  isRateLimitError,
  loadReminderEngineCache,
} from '@/lib/reminderEngine';
import { buildWorkStagesPageUrl } from '@/lib/workflowNavigation';

export const SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX = 'signed_proposal_needs_work_stages:';

export function getSignedProposalNeedsWorkStagesConditionKey(signedProposalId) {
  return `${SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX}${signedProposalId}`;
}

export function hasNonCancelledWorkStageForProject(projectId, workStages = []) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return false;

  return workStages.some(
    (stage) => String(stage?.project_id || '').trim() === normalizedProjectId
      && stage?.status !== 'cancelled',
  );
}

const classifyRuleAction = (engineResult) => {
  const action = engineResult?.action;
  if (action === 'created') return 'created';
  if (action === 'updated' || action === 'reactivated') return 'updated';
  if (action === 'resolved' || action === 'already_resolved') return 'resolved';
  return 'skipped';
};

const withReminderCache = (cache, options = {}) => (
  cache?.reminders ? { ...options, cache } : options
);

const buildR7ReminderInput = (signedProposal) => {
  const projectName = String(signedProposal.project_name || '').trim();

  return {
    title: projectName
      ? `להגדיר שלבי עבודה לפרויקט ${projectName}`
      : 'להגדיר שלבי עבודה לפרויקט',
    description: 'קיימת הצעה/הזמנה חתומה, אך עדיין לא הוגדרו שלבי עבודה לפרויקט.',
    client_name: signedProposal.client_name || '',
    client_id: signedProposal.client_id || '',
    project_name: signedProposal.project_name || '',
    project_id: signedProposal.project_id || '',
    source_type: 'signed_proposal',
    source_id: signedProposal.id,
    condition_key: getSignedProposalNeedsWorkStagesConditionKey(signedProposal.id),
    action_url: buildWorkStagesPageUrl({
      projectId: signedProposal.project_id,
      signedProposalId: signedProposal.id,
    }),
    action_label: 'הגדר שלבי עבודה',
    frequency: 'daily',
  };
};

export async function runWorkStageReminderRulesForSignedProposal(signedProposal, cache = {}) {
  const conditionKey = getSignedProposalNeedsWorkStagesConditionKey(signedProposal?.id);

  if (!signedProposal?.id) {
    return { status: 'skipped', action: null, reason: 'no_signed_proposal_id', rule: 'r7' };
  }

  const workStages = cache.workStages ?? [];
  const projectId = String(signedProposal.project_id || '').trim();
  const conditionIsTrue = (
    isValidSignedProposal(signedProposal)
    && Boolean(projectId)
    && !hasNonCancelledWorkStageForProject(projectId, workStages)
  );

  const result = await ensureReminderForCondition(
    conditionIsTrue,
    conditionIsTrue ? buildR7ReminderInput(signedProposal) : { condition_key: conditionKey },
    withReminderCache(cache, { immediate: conditionIsTrue }),
  );

  return {
    status: conditionIsTrue ? 'applied' : 'cleared',
    action: classifyRuleAction(result),
    conditionKey,
    rule: 'r7',
  };
}

export async function runWorkStageReminderRulesForProject(projectId, cache = {}) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return [];

  let signedProposals = cache.signedProposals;
  if (!signedProposals) {
    signedProposals = await base44.entities.SignedProposal.list();
  }

  const related = signedProposals.filter(
    (item) => String(item.project_id || '').trim() === normalizedProjectId,
  );

  const results = [];
  for (const signedProposal of related) {
    results.push(await runWorkStageReminderRulesForSignedProposal(signedProposal, cache));
  }
  return results;
}

export async function runWorkStageReminderRulesForAll(cache = {}, options = {}) {
  const summary = {
    checked: 0,
    created: 0,
    updated: 0,
    resolved: 0,
    skipped: 0,
    errors: 0,
    rateLimited: false,
    mutationCount: 0,
    hasMore: false,
  };

  const maxMutations = Number.isFinite(options.maxMutations)
    ? Number(options.maxMutations)
    : Number.POSITIVE_INFINITY;

  try {
    await loadReminderEngineCache(cache);
  } catch (error) {
    summary.errors += 1;
    if (isRateLimitError(error)) summary.rateLimited = true;
    return summary;
  }

  let signedProposals = [];
  let workStages = [];

  try {
    [signedProposals, workStages] = await Promise.all([
      base44.entities.SignedProposal.list(),
      base44.entities.WorkStage.list(),
    ]);
  } catch (error) {
    summary.errors += 1;
    return summary;
  }

  cache.signedProposals = signedProposals;
  cache.workStages = workStages;

  for (const signedProposal of signedProposals) {
    if (summary.rateLimited || summary.mutationCount >= maxMutations) {
      summary.hasMore = true;
      break;
    }

    summary.checked += 1;

    try {
      const result = await runWorkStageReminderRulesForSignedProposal(signedProposal, cache);

      if (result.action === 'created') summary.created += 1;
      else if (result.action === 'updated') summary.updated += 1;
      else if (result.action === 'resolved') summary.resolved += 1;
      else summary.skipped += 1;

      if (result.action === 'created' || result.action === 'updated' || result.action === 'resolved') {
        summary.mutationCount += 1;
      }
    } catch (error) {
      summary.errors += 1;
      if (isRateLimitError(error)) {
        summary.rateLimited = true;
        break;
      }
    }
  }

  return summary;
}
