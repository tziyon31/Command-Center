import { api as base44 } from '@/api/apiClient';
import {
  cancelOrphanRemindersForSourceType,
  cancelReminder,
  ensureReminderForCondition,
  findReminderByConditionKey,
  hasOpenReminderForConditionKey,
  isRateLimitError,
  loadReminderEngineCache,
  REMINDER_STATUS,
  resolveReminder,
} from '@/lib/reminderEngine';
import { buildProposalFormPageUrl, buildSignedProposalFormPageUrl } from '@/lib/workflowNavigation';
import { isValidSignedProposal } from '@/lib/signedProposalValidation';

export const PROPOSAL_INCOMPLETE_CONDITION_PREFIX = 'proposal_incomplete:';
export const PROPOSAL_NOT_SENT_CONDITION_PREFIX = 'proposal_not_sent:';
export const PROPOSAL_NOT_SEEN_CONDITION_PREFIX = 'proposal_not_seen:';
export const PROJECT_NEEDS_PROPOSAL_CONDITION_PREFIX = 'project_needs_proposal:';
export const INQUIRY_NEEDS_PROPOSAL_CONDITION_PREFIX = 'inquiry_needs_proposal:';
export const PROPOSAL_NEEDS_SIGNED_PROPOSAL_CONDITION_PREFIX = 'proposal_needs_signed_proposal:';

/**
 * P2G: project_needs_proposal is valid only while the project is still in
 * pricing. Any other status (waiting/signed/execution/completed/rejected/
 * cancelled/...) resolves the reminder when the rule runs.
 */
const P2_ELIGIBLE_PROJECT_STATUSES = new Set(['pricing']);

export function getProposalIncompleteConditionKey(proposalId) {
  return `${PROPOSAL_INCOMPLETE_CONDITION_PREFIX}${proposalId}`;
}

export function getProposalNotSentConditionKey(proposalId) {
  return `${PROPOSAL_NOT_SENT_CONDITION_PREFIX}${proposalId}`;
}

export function getProposalNotSeenConditionKey(proposalId) {
  return `${PROPOSAL_NOT_SEEN_CONDITION_PREFIX}${proposalId}`;
}

export function getProjectNeedsProposalConditionKey(projectId) {
  return `${PROJECT_NEEDS_PROPOSAL_CONDITION_PREFIX}${projectId}`;
}

export function getInquiryNeedsProposalConditionKey(inquiryId) {
  return `${INQUIRY_NEEDS_PROPOSAL_CONDITION_PREFIX}${inquiryId}`;
}

export function getProposalNeedsSignedProposalConditionKey(proposalId) {
  return `${PROPOSAL_NEEDS_SIGNED_PROPOSAL_CONDITION_PREFIX}${proposalId}`;
}

const hasTrimmedClientName = (value) => Boolean(String(value || '').trim());
const normalize = (value) => String(value || '').trim().toLowerCase();

export function isSignedProposal(signedProposal) {
  return isValidSignedProposal(signedProposal);
}

export function hasSignedProposalForProject(project, signedProposals = []) {
  if (!project) return false;

  return signedProposals.some((signedProposal) => {
    if (!isSignedProposal(signedProposal)) return false;

    const sameProjectId = (
      signedProposal.project_id
      && project.id
      && signedProposal.project_id === project.id
    );

    const sameClientAndProjectName = (
      signedProposal.client_id
      && project.client_id
      && signedProposal.client_id === project.client_id
      && normalize(signedProposal.project_name) === normalize(project.project_name || project.name)
    );

    return sameProjectId || sameClientAndProjectName;
  });
}

const hasNonCancelledProposalForProject = (projectId, proposals = []) => (
  proposals.some(
    (proposal) => proposal.project_id === projectId && proposal.form_status !== 'cancelled',
  )
);

const hasNonCancelledProposalForInquiry = (inquiryId, proposals = []) => (
  proposals.some(
    (proposal) => proposal.source_inquiry_id === inquiryId && proposal.form_status !== 'cancelled',
  )
);

const hasNonCancelledSignedProposalForProposal = (proposal, signedProposals = []) => {
  if (!proposal?.id) return false;
  const projectId = String(proposal.project_id || '').trim();

  return signedProposals.some((signedProposal) => {
    if (signedProposal?.form_status === 'cancelled') return false;
    if (!isSignedProposal(signedProposal)) return false;
    if (String(signedProposal?.proposal_id || '').trim() === proposal.id) return true;
    return Boolean(projectId) && String(signedProposal?.project_id || '').trim() === projectId;
  });
};

const resolveClientNameForProject = (project, cache = {}) => {
  const clients = cache.clients ?? [];
  const linkedClient = clients.find((client) => client.id === project?.client_id);
  return linkedClient?.name || project?.client_name || '';
};

const toShortId = (value) => String(value || '').slice(0, 6);

const formatShortDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(date);
};

const buildProposalReminderContextDescription = (proposal, fallback) => {
  if (proposal?.project_name) {
    return `פרויקט: ${proposal.project_name}`;
  }

  if (proposal?.document_note) {
    return `הערה/מספר הצעה: ${proposal.document_note}`;
  }

  const dateLabel = formatShortDate(proposal?.created_date || proposal?.submitted_at);
  if (dateLabel) {
    return `הצעה מ-${dateLabel}`;
  }

  return `מזהה הצעה: ${toShortId(proposal?.id) || fallback || ''}`.trim();
};

const isProjectEligibleForP2 = (project) => (
  Boolean(project?.id)
  && Boolean(project?.client_id)
  && P2_ELIGIBLE_PROJECT_STATUSES.has(String(project?.status || '').trim())
);

const withReminderCache = (cache, options = {}) => (
  cache?.reminders ? { ...options, cache } : options
);

const classifyRuleAction = (engineResult) => {
  const action = engineResult?.action;

  if (action === 'created') return 'created';
  if (action === 'updated' || action === 'reactivated') return 'updated';
  if (action === 'resolved' || action === 'already_resolved') return 'resolved';
  if (action === 'unchanged' || action === 'not_found') return 'skipped';
  return 'skipped';
};

const tallyRuleResult = (summary, ruleResult) => {
  if (ruleResult?.status === 'skipped') {
    summary.skipped += 1;
  }

  if (ruleResult?.action === 'created') {
    summary.created += 1;
  } else if (ruleResult?.action === 'updated') {
    summary.updated += 1;
  } else if (ruleResult?.action === 'resolved') {
    summary.resolved += 1;
  }
};

const buildP0ReminderInput = (proposal) => {
  const clientName = proposal.client_name.trim();

  return {
    title: `להשלים הצעת מחיר עבור ${clientName}`,
    description: buildProposalReminderContextDescription(
      proposal,
      'טיוטה',
    ),
    client_name: clientName,
    client_id: proposal.client_id || '',
    project_name: proposal.project_name || '',
    project_id: proposal.project_id || '',
    source_type: 'proposal',
    source_id: proposal.id,
    condition_key: getProposalIncompleteConditionKey(proposal.id),
    action_url: buildProposalFormPageUrl({ proposalId: proposal.id }),
    action_label: 'פתח הצעת מחיר',
    frequency: 'daily',
  };
};

const buildP3ReminderInput = (proposal) => {
  const clientName = proposal.client_name.trim();

  return {
    title: `לשלוח הצעת מחיר ללקוח ${clientName}`,
    description: buildProposalReminderContextDescription(
      proposal,
      'טרם נשלחה',
    ),
    client_name: clientName,
    client_id: proposal.client_id || '',
    project_name: proposal.project_name || '',
    project_id: proposal.project_id || '',
    source_type: 'proposal',
    source_id: proposal.id,
    condition_key: getProposalNotSentConditionKey(proposal.id),
    action_url: buildProposalFormPageUrl({ proposalId: proposal.id }),
    action_label: 'פתח הצעת מחיר',
    frequency: 'daily',
  };
};

const buildP2ReminderInput = (project, cache = {}) => {
  const projectName = project.name || project.project_name || '';
  const clientName = resolveClientNameForProject(project, cache);

  return {
    title: `לפתוח הצעת מחיר לפרויקט ${projectName || 'ללא שם'}`,
    description: 'הפרויקט קיים אך עדיין לא נפתחה לו הצעת מחיר.',
    client_name: clientName,
    client_id: project.client_id || '',
    project_name: projectName,
    project_id: project.id,
    source_type: 'project',
    source_id: project.id,
    condition_key: getProjectNeedsProposalConditionKey(project.id),
    action_url: buildProposalFormPageUrl({
      projectId: project.id,
      projectName,
      clientId: project.client_id || '',
      clientName,
      sourceInquiryId: project.source_inquiry_id || '',
    }),
    action_label: 'פתח הצעת מחיר',
    frequency: 'daily',
  };
};

const buildP4ReminderInput = (proposal) => {
  const clientName = proposal.client_name.trim();

  return {
    title: `לוודא שהלקוח ראה את הצעת המחיר עבור ${clientName}`,
    description: buildProposalReminderContextDescription(
      proposal,
      'נשלחה וממתינה לאישור צפייה',
    ),
    client_name: clientName,
    client_id: proposal.client_id || '',
    project_name: proposal.project_name || '',
    project_id: proposal.project_id || '',
    source_type: 'proposal',
    source_id: proposal.id,
    condition_key: getProposalNotSeenConditionKey(proposal.id),
    action_url: buildProposalFormPageUrl({ proposalId: proposal.id }),
    action_label: 'פתח הצעת מחיר',
    frequency: 'daily',
  };
};

const buildP1ReminderInput = (inquiry) => {
  const clientName = inquiry.client_name.trim();

  return {
    title: `לפתוח הצעת מחיר עבור ${clientName}`,
    description: 'הפנייה הוגשה אך עדיין לא נפתחה לה הצעת מחיר.',
    client_name: clientName,
    client_id: '',
    project_name: '',
    project_id: '',
    source_type: 'inquiry',
    source_id: inquiry.id,
    condition_key: getInquiryNeedsProposalConditionKey(inquiry.id),
    action_url: `/ProposalForm?source_inquiry_id=${inquiry.id}&client_name=${encodeURIComponent(clientName)}`,
    action_label: 'פתח הצעת מחיר',
    frequency: 'daily',
  };
};

const buildSP1ReminderInput = (proposal) => {
  const clientName = String(proposal.client_name || '').trim();

  return {
    title: `לקבל חתימה / הזמנה חתומה עבור ${clientName}`,
    description: 'הצעת המחיר נשלחה, אך עדיין לא סומנה כהצעה או הזמנה חתומה.',
    client_name: clientName,
    client_id: proposal.client_id || '',
    project_name: proposal.project_name || '',
    project_id: proposal.project_id || '',
    source_type: 'proposal',
    source_id: proposal.id,
    condition_key: getProposalNeedsSignedProposalConditionKey(proposal.id),
    action_url: buildSignedProposalFormPageUrl({
      proposalId: proposal.id,
      projectId: proposal.project_id || '',
      projectName: proposal.project_name || '',
      clientName,
      sourceInquiryId: proposal.source_inquiry_id || '',
      documentNote: proposal.document_note || '',
    }),
    action_label: 'פתח הצעה חתומה',
    frequency: 'daily',
  };
};

async function runP0ReminderRuleForProposal(proposal, cache = {}) {
  const conditionKey = getProposalIncompleteConditionKey(proposal?.id);

  if (!proposal?.id) {
    return { status: 'skipped', action: null, reason: 'no_proposal_id', rule: 'p0' };
  }

  if (!hasTrimmedClientName(proposal?.client_name)) {
    const result = await ensureReminderForCondition(
      false,
      { condition_key: conditionKey },
      withReminderCache(cache, { immediate: false }),
    );

    return {
      status: 'skipped',
      action: classifyRuleAction(result),
      reason: 'no_client_name',
      rule: 'p0',
    };
  }

  const signedProposals = cache.signedProposals ?? await base44.entities.SignedProposal.list();
  const hasSignedForProject = hasSignedProposalForProject(
    { id: proposal.project_id, client_id: proposal.client_id, name: proposal.project_name },
    signedProposals,
  );

  const conditionIsTrue = (
    proposal.form_status !== 'submitted'
    && proposal.form_status !== 'cancelled'
    && !hasSignedForProject
  );

  const result = await ensureReminderForCondition(
    conditionIsTrue,
    conditionIsTrue ? buildP0ReminderInput(proposal) : { condition_key: conditionKey },
    withReminderCache(cache, { immediate: false }),
  );

  return {
    status: conditionIsTrue ? 'applied' : 'cleared',
    action: classifyRuleAction(result),
    conditionKey,
    rule: 'p0',
  };
}

async function runP3ReminderRuleForProposal(proposal, cache = {}) {
  const conditionKey = getProposalNotSentConditionKey(proposal?.id);

  if (!proposal?.id) {
    return { status: 'skipped', action: null, reason: 'no_proposal_id', rule: 'p3' };
  }

  if (!hasTrimmedClientName(proposal?.client_name)) {
    const result = await ensureReminderForCondition(
      false,
      { condition_key: conditionKey },
      withReminderCache(cache, { immediate: false }),
    );

    return {
      status: 'skipped',
      action: classifyRuleAction(result),
      reason: 'no_client_name',
      rule: 'p3',
    };
  }

  const signedProposals = cache.signedProposals ?? await base44.entities.SignedProposal.list();
  const hasSignedForProject = hasSignedProposalForProject(
    { id: proposal.project_id, client_id: proposal.client_id, name: proposal.project_name },
    signedProposals,
  );

  const conditionIsTrue = (
    proposal.form_status === 'submitted'
    && proposal.proposal_sent_to_client !== true
    && !hasSignedForProject
  );

  const result = await ensureReminderForCondition(
    conditionIsTrue,
    conditionIsTrue ? buildP3ReminderInput(proposal) : { condition_key: conditionKey },
    withReminderCache(cache, { immediate: conditionIsTrue }),
  );

  return {
    status: conditionIsTrue ? 'applied' : 'cleared',
    action: classifyRuleAction(result),
    conditionKey,
    rule: 'p3',
  };
}

async function runP4ReminderRuleForProposal(proposal, cache = {}) {
  const conditionKey = getProposalNotSeenConditionKey(proposal?.id);

  if (!proposal?.id) {
    return { status: 'skipped', action: null, reason: 'no_proposal_id', rule: 'p4' };
  }

  if (!hasTrimmedClientName(proposal?.client_name)) {
    const result = await ensureReminderForCondition(
      false,
      { condition_key: conditionKey },
      withReminderCache(cache, { immediate: false }),
    );

    return {
      status: 'skipped',
      action: classifyRuleAction(result),
      reason: 'no_client_name',
      rule: 'p4',
    };
  }

  const signedProposals = cache.signedProposals ?? await base44.entities.SignedProposal.list();
  const hasSignedForProject = hasSignedProposalForProject(
    { id: proposal.project_id, client_id: proposal.client_id, name: proposal.project_name },
    signedProposals,
  );

  const conditionIsTrue = (
    proposal.form_status === 'submitted'
    && proposal.proposal_sent_to_client === true
    && proposal.client_saw_proposal !== true
    && !hasSignedForProject
  );

  const result = await ensureReminderForCondition(
    conditionIsTrue,
    conditionIsTrue ? buildP4ReminderInput(proposal) : { condition_key: conditionKey },
    withReminderCache(cache, { immediate: conditionIsTrue }),
  );

  return {
    status: conditionIsTrue ? 'applied' : 'cleared',
    action: classifyRuleAction(result),
    conditionKey,
    rule: 'p4',
  };
}

async function runSP1ReminderRuleForProposal(proposal, cache = {}) {
  const conditionKey = getProposalNeedsSignedProposalConditionKey(proposal?.id);

  if (!proposal?.id) {
    return { status: 'skipped', action: null, reason: 'no_proposal_id', rule: 'sp1' };
  }

  const projectId = String(proposal.project_id || '').trim();
  const isEligible = (
    proposal.form_status === 'submitted'
    && proposal.proposal_sent_to_client === true
    && Boolean(projectId)
    && hasTrimmedClientName(proposal.client_name)
  );

  if (!isEligible) {
    const result = await ensureReminderForCondition(
      false,
      { condition_key: conditionKey },
      withReminderCache(cache, { immediate: false }),
    );

    return {
      status: 'skipped',
      action: classifyRuleAction(result),
      reason: 'proposal_not_eligible',
      rule: 'sp1',
    };
  }

  const signedProposals = cache.signedProposals ?? await base44.entities.SignedProposal.list();
  const hasSignedProposal = hasNonCancelledSignedProposalForProposal(proposal, signedProposals);
  const conditionIsTrue = !hasSignedProposal;

  const result = await ensureReminderForCondition(
    conditionIsTrue,
    conditionIsTrue ? buildSP1ReminderInput(proposal) : { condition_key: conditionKey },
    withReminderCache(cache, { immediate: conditionIsTrue }),
  );

  return {
    status: conditionIsTrue ? 'applied' : 'cleared',
    action: classifyRuleAction(result),
    conditionKey,
    rule: 'sp1',
  };
}

export async function runSignedProposalNeedReminderRuleForProposal(proposal, cache = {}) {
  return runSP1ReminderRuleForProposal(proposal, cache);
}

async function runP2ReminderRuleForProject(project, cache = {}) {
  const conditionKey = getProjectNeedsProposalConditionKey(project?.id);
  const proposals = cache.proposals ?? [];
  const signedProposals = cache.signedProposals ?? await base44.entities.SignedProposal.list();

  if (!project?.id) {
    return { status: 'skipped', action: null, reason: 'no_project_id', rule: 'p2' };
  }

  if (!isProjectEligibleForP2(project)) {
    if (
      cache?.reminders
      && !hasOpenReminderForConditionKey(cache, conditionKey)
    ) {
      return {
        status: 'skipped',
        action: 'not_found',
        reason: 'project_not_eligible',
        rule: 'p2',
      };
    }

    const result = await ensureReminderForCondition(
      false,
      { condition_key: conditionKey },
      withReminderCache(cache, { immediate: false }),
    );

    return {
      status: 'skipped',
      action: classifyRuleAction(result),
      reason: 'project_not_eligible',
      rule: 'p2',
    };
  }

  const hasProposal = hasNonCancelledProposalForProject(project.id, proposals);
  const hasSignedProposal = hasSignedProposalForProject(project, signedProposals);
  const conditionIsTrue = !hasProposal && !hasSignedProposal;

  if (!conditionIsTrue && cache?.reminders) {
    if (!hasOpenReminderForConditionKey(cache, conditionKey)) {
      return {
        status: 'cleared',
        action: 'not_found',
        conditionKey,
        rule: 'p2',
      };
    }
  }

  const result = await ensureReminderForCondition(
    conditionIsTrue,
    conditionIsTrue ? buildP2ReminderInput(project, cache) : { condition_key: conditionKey },
    withReminderCache(cache, { immediate: conditionIsTrue }),
  );

  return {
    status: conditionIsTrue ? 'applied' : 'cleared',
    action: classifyRuleAction(result),
    conditionKey,
    rule: 'p2',
  };
}

export async function runProposalReminderRulesForInquiry(inquiry, cache = {}) {
  if (!inquiry?.id) {
    return { status: 'skipped', action: null, reason: 'no_inquiry_id', rule: 'p1' };
  }

  const conditionKey = getInquiryNeedsProposalConditionKey(inquiry.id);
  const proposals = cache.proposals ?? await base44.entities.Proposal.list();
  const clientName = String(inquiry.client_name || '').trim();
  const isCancelledInquiry = inquiry.form_status === 'cancelled' || inquiry.status === 'cancelled';
  const hasProposal = hasNonCancelledProposalForInquiry(inquiry.id, proposals);

  const conditionIsTrue = (
    inquiry.form_status === 'submitted'
    && !isCancelledInquiry
    && Boolean(clientName)
    && !hasProposal
  );

  const result = await ensureReminderForCondition(
    conditionIsTrue,
    conditionIsTrue ? buildP1ReminderInput(inquiry) : { condition_key: conditionKey },
    withReminderCache(cache, { immediate: conditionIsTrue }),
  );

  return {
    status: conditionIsTrue ? 'applied' : 'cleared',
    action: classifyRuleAction(result),
    conditionKey,
    rule: 'p1',
  };
}

export async function runProposalReminderRulesForInquiries(
  inquiries = [],
  proposals = [],
  options = {},
) {
  const summary = {
    checked: 0,
    created: 0,
    updated: 0,
    resolved: 0,
    skipped: 0,
    errors: 0,
    rateLimited: false,
    hasMore: false,
    mutationCount: 0,
  };

  const maxMutations = Number.isFinite(options.maxMutations)
    ? Number(options.maxMutations)
    : Number.POSITIVE_INFINITY;
  const cache = options.cache || {};
  cache.proposals = proposals;

  for (const inquiry of inquiries) {
    if (summary.rateLimited) break;
    if (summary.mutationCount >= maxMutations) {
      summary.hasMore = true;
      break;
    }

    summary.checked += 1;

    try {
      const result = await runProposalReminderRulesForInquiry(inquiry, cache);
      tallyRuleResult(summary, result);

      if (result.action === 'created' || result.action === 'updated' || result.action === 'resolved') {
        summary.mutationCount += 1;
      }
    } catch (error) {
      summary.errors += 1;
      console.error('[ProposalReminderRules] P1 failed for inquiry', inquiry?.id, error);

      if (isRateLimitError(error)) {
        summary.rateLimited = true;
        break;
      }
    }
  }

  return summary;
}

export async function syncProposalReminderRulesAfterProjectSave(project) {
  try {
    return await runProposalReminderRulesForProject(project);
  } catch (error) {
    console.error('[ProposalReminderRules] failed after project save', error);
    return null;
  }
}

export async function runProposalReminderRulesForProject(project, cache = {}) {
  let proposals = cache.proposals;
  let clients = cache.clients;
  let signedProposals = cache.signedProposals;

  if (!proposals) {
    proposals = await base44.entities.Proposal.list();
  }

  if (!clients) {
    clients = await base44.entities.Client.list();
  }

  if (!signedProposals) {
    signedProposals = await base44.entities.SignedProposal.list();
  }

  return runP2ReminderRuleForProject(project, { proposals, clients, signedProposals });
}

export async function runProposalReminderRulesForProposal(proposal, cache = {}) {
  const p0 = await runP0ReminderRuleForProposal(proposal, cache);
  const p3 = await runP3ReminderRuleForProposal(proposal, cache);
  const p4 = await runP4ReminderRuleForProposal(proposal, cache);
  const sp1 = await runSP1ReminderRuleForProposal(proposal, cache);

  let p2 = null;

  if (proposal?.project_id) {
    let proposals = cache.proposals;
    let clients = cache.clients;
    let projects = cache.projects;

    if (!proposals) {
      proposals = await base44.entities.Proposal.list();
    }

    if (!clients) {
      clients = await base44.entities.Client.list();
    }

    if (!projects) {
      projects = await base44.entities.Project.list();
    }

    const project = projects.find((item) => item.id === proposal.project_id);

    if (project) {
      p2 = await runP2ReminderRuleForProject(project, { proposals, clients, projects });
    }
  }

  return { p0, p3, p4, p2, sp1 };
}

export async function runProposalReminderRulesForAll(cache = {}) {
  const summary = {
    checked: 0,
    created: 0,
    updated: 0,
    resolved: 0,
    skipped: 0,
    errors: 0,
    rateLimited: false,
  };

  let proposals = [];
  let projects = [];
  let clients = [];
  let inquiries = [];
  let signedProposals = [];

  try {
    [proposals, projects, clients, inquiries, signedProposals] = await Promise.all([
      base44.entities.Proposal.list(),
      base44.entities.Project.list(),
      base44.entities.Client.list(),
      base44.entities.Inquiry.list(),
      base44.entities.SignedProposal.list(),
    ]);
  } catch (error) {
    console.error('[ProposalReminderRules] failed to load entities', error);
    summary.errors += 1;
    return summary;
  }

  cache.proposals = proposals;
  cache.clients = clients;
  cache.projects = projects;
  cache.inquiries = inquiries;
  cache.signedProposals = signedProposals;

  try {
    await loadReminderEngineCache(cache);
  } catch (error) {
    console.error('[ProposalReminderRules] failed to load reminder cache', error);
    summary.errors += 1;

    if (isRateLimitError(error)) {
      summary.rateLimited = true;
      return summary;
    }
  }

  try {
    await cancelOrphanRemindersForSourceType(
      'proposal',
      proposals.map((proposal) => proposal.id).filter(Boolean),
      { cache },
    );
  } catch (error) {
    console.error('[ProposalReminderRules] failed to cancel orphan proposal reminders', error);
    summary.errors += 1;
  }

  for (const project of projects) {
    if (summary.rateLimited) break;

    summary.checked += 1;

    try {
      const result = await runP2ReminderRuleForProject(project, cache);
      tallyRuleResult(summary, result);
    } catch (error) {
      summary.errors += 1;
      console.error('[ProposalReminderRules] P2 failed for project', project?.id, error);

      if (isRateLimitError(error)) {
        summary.rateLimited = true;
        break;
      }
    }
  }

  const remainingMutationBudget = Number.isFinite(cache?.maxMutations)
    ? Math.max(cache.maxMutations - summary.created - summary.updated - summary.resolved, 0)
    : Number.POSITIVE_INFINITY;

  const p1Summary = await runProposalReminderRulesForInquiries(
    inquiries,
    proposals,
    {
      cache,
      maxMutations: remainingMutationBudget,
    },
  );
  summary.checked += p1Summary.checked;
  summary.created += p1Summary.created;
  summary.updated += p1Summary.updated;
  summary.resolved += p1Summary.resolved;
  summary.skipped += p1Summary.skipped;
  summary.errors += p1Summary.errors;
  if (p1Summary.rateLimited) {
    summary.rateLimited = true;
  }

  for (const proposal of proposals) {
    if (summary.rateLimited) break;

    summary.checked += 1;

    try {
      const result = await runProposalReminderRulesForProposal(proposal, cache);
      tallyRuleResult(summary, result.p0);
      tallyRuleResult(summary, result.p3);
      tallyRuleResult(summary, result.p4);
      tallyRuleResult(summary, result.sp1);

      if (result.p2) {
        tallyRuleResult(summary, result.p2);
      }
    } catch (error) {
      summary.errors += 1;
      console.error('[ProposalReminderRules] failed for proposal', proposal?.id, error);

      if (isRateLimitError(error)) {
        summary.rateLimited = true;
        break;
      }
    }
  }

  return summary;
}

export async function cancelRemindersForProposal(proposalId) {
  if (!proposalId) return { cancelled: 0 };

  const conditionKeys = [
    getProposalIncompleteConditionKey(proposalId),
    getProposalNotSentConditionKey(proposalId),
    getProposalNotSeenConditionKey(proposalId),
    getProposalNeedsSignedProposalConditionKey(proposalId),
  ];

  let cancelled = 0;

  for (const conditionKey of conditionKeys) {
    try {
      const reminder = await findReminderByConditionKey(conditionKey);
      if (
        reminder?.id
        && reminder.status !== 'resolved'
        && reminder.status !== 'cancelled'
      ) {
        await cancelReminder(reminder.id, 'source_deleted');
        cancelled += 1;
      }
    } catch (error) {
      console.error('[ProposalReminderRules] failed to cancel reminder', conditionKey, error);
    }
  }

  try {
    const reminders = await base44.entities.Reminder.list();
    for (const reminder of reminders) {
      if (
        reminder.source_type === 'proposal'
        && reminder.source_id === proposalId
        && reminder.status !== 'resolved'
        && reminder.status !== 'cancelled'
      ) {
        await cancelReminder(reminder.id, 'source_deleted');
        cancelled += 1;
      }
    }
  } catch (error) {
    console.error('[ProposalReminderRules] failed to cancel proposal source reminders', error);
  }

  return { cancelled };
}

export async function syncSignedProposalReminderRules(signedProposal, cache = {}) {
  const proposalId = String(signedProposal?.proposal_id || '').trim();
  const projectId = String(signedProposal?.project_id || '').trim();
  if (!proposalId && !projectId) return { checked: 0 };

  const isValid = isValidSignedProposal(signedProposal);

  let proposals = cache.proposals;
  let signedProposals = cache.signedProposals;
  let reminders = cache.reminders;

  if (!proposals) {
    proposals = await base44.entities.Proposal.list();
  }
  if (!signedProposals) {
    signedProposals = await base44.entities.SignedProposal.list();
  }
  if (!reminders) {
    const loadedCache = await loadReminderEngineCache(cache);
    reminders = loadedCache.reminders || [];
  }

  const candidates = proposals.filter((proposal) => (
    (proposalId && proposal.id === proposalId)
    || (projectId && proposal.project_id === projectId)
  ));

  for (const proposal of candidates) {
    await runSP1ReminderRuleForProposal(proposal, {
      ...cache,
      proposals,
      signedProposals,
    });
  }

  if (!isValid) {
    return { checked: candidates.length };
  }

  const proposalIds = new Set(candidates.map((proposal) => proposal.id));
  const projectIds = new Set(candidates.map((proposal) => proposal.project_id).filter(Boolean));
  const proposalPrefixes = [
    PROPOSAL_INCOMPLETE_CONDITION_PREFIX,
    PROPOSAL_NOT_SENT_CONDITION_PREFIX,
    PROPOSAL_NOT_SEEN_CONDITION_PREFIX,
    PROJECT_NEEDS_PROPOSAL_CONDITION_PREFIX,
  ];
  const shouldResolve = (reminder) => {
    if (!reminder?.condition_key) return false;
    if (reminder.status !== REMINDER_STATUS.ACTIVE && reminder.status !== REMINDER_STATUS.SNOOZED) {
      return false;
    }
    if (!proposalPrefixes.some((prefix) => reminder.condition_key.startsWith(prefix))) {
      return false;
    }
    if (proposalIds.has(reminder.source_id)) return true;
    return Boolean(reminder.project_id) && projectIds.has(reminder.project_id);
  };

  for (const reminder of reminders || []) {
    if (!shouldResolve(reminder)) continue;
    await resolveReminder(reminder.id, 'signed_proposal_exists');
  }

  return { checked: candidates.length };
}