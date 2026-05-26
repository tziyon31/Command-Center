import { base44 } from '@/api/base44Client';
import {
  cancelOrphanRemindersForSourceType,
  cancelReminder,
  ensureReminderForCondition,
  findReminderByConditionKey,
} from '@/lib/reminderEngine';
import { buildProposalFormPageUrl } from '@/lib/workflowNavigation';

export const PROPOSAL_INCOMPLETE_CONDITION_PREFIX = 'proposal_incomplete:';
export const PROPOSAL_NOT_SENT_CONDITION_PREFIX = 'proposal_not_sent:';
export const PROPOSAL_NOT_SEEN_CONDITION_PREFIX = 'proposal_not_seen:';
export const PROJECT_NEEDS_PROPOSAL_CONDITION_PREFIX = 'project_needs_proposal:';

const INACTIVE_PROJECT_STATUSES = new Set(['cancelled']);

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

const hasTrimmedClientName = (value) => Boolean(String(value || '').trim());

const hasNonCancelledProposalForProject = (projectId, proposals = []) => (
  proposals.some(
    (proposal) => proposal.project_id === projectId && proposal.form_status !== 'cancelled',
  )
);

const resolveClientNameForProject = (project, cache = {}) => {
  const clients = cache.clients ?? [];
  const linkedClient = clients.find((client) => client.id === project?.client_id);
  return linkedClient?.name || project?.client_name || '';
};

const isProjectEligibleForP2 = (project) => (
  Boolean(project?.id)
  && Boolean(project?.client_id)
  && !INACTIVE_PROJECT_STATUSES.has(project?.status)
);

const classifyRuleAction = (engineResult) => {
  const action = engineResult?.action;

  if (action === 'created') return 'created';
  if (action === 'updated' || action === 'reactivated') return 'updated';
  if (action === 'resolved' || action === 'already_resolved') return 'resolved';
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
    description: 'הצעת המחיר נפתחה אך עדיין לא הוגשה.',
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
    description: 'הצעת המחיר קיימת במערכת אך עדיין לא סומן שנשלחה ללקוח.',
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
    description: 'הצעת המחיר נשלחה, אך עדיין אין סימון שהלקוח ראה אותה.',
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

async function runP0ReminderRuleForProposal(proposal) {
  const conditionKey = getProposalIncompleteConditionKey(proposal?.id);

  if (!proposal?.id) {
    return { status: 'skipped', action: null, reason: 'no_proposal_id', rule: 'p0' };
  }

  if (!hasTrimmedClientName(proposal?.client_name)) {
    const result = await ensureReminderForCondition(
      false,
      { condition_key: conditionKey },
      { immediate: false },
    );

    return {
      status: 'skipped',
      action: classifyRuleAction(result),
      reason: 'no_client_name',
      rule: 'p0',
    };
  }

  const conditionIsTrue = (
    proposal.form_status !== 'submitted'
    && proposal.form_status !== 'cancelled'
  );

  const result = await ensureReminderForCondition(
    conditionIsTrue,
    conditionIsTrue ? buildP0ReminderInput(proposal) : { condition_key: conditionKey },
    { immediate: false },
  );

  return {
    status: conditionIsTrue ? 'applied' : 'cleared',
    action: classifyRuleAction(result),
    conditionKey,
    rule: 'p0',
  };
}

async function runP3ReminderRuleForProposal(proposal) {
  const conditionKey = getProposalNotSentConditionKey(proposal?.id);

  if (!proposal?.id) {
    return { status: 'skipped', action: null, reason: 'no_proposal_id', rule: 'p3' };
  }

  if (!hasTrimmedClientName(proposal?.client_name)) {
    const result = await ensureReminderForCondition(
      false,
      { condition_key: conditionKey },
      { immediate: false },
    );

    return {
      status: 'skipped',
      action: classifyRuleAction(result),
      reason: 'no_client_name',
      rule: 'p3',
    };
  }

  const conditionIsTrue = (
    proposal.form_status === 'submitted'
    && proposal.proposal_sent_to_client !== true
  );

  const result = await ensureReminderForCondition(
    conditionIsTrue,
    conditionIsTrue ? buildP3ReminderInput(proposal) : { condition_key: conditionKey },
    { immediate: conditionIsTrue },
  );

  return {
    status: conditionIsTrue ? 'applied' : 'cleared',
    action: classifyRuleAction(result),
    conditionKey,
    rule: 'p3',
  };
}

async function runP4ReminderRuleForProposal(proposal) {
  const conditionKey = getProposalNotSeenConditionKey(proposal?.id);

  if (!proposal?.id) {
    return { status: 'skipped', action: null, reason: 'no_proposal_id', rule: 'p4' };
  }

  if (!hasTrimmedClientName(proposal?.client_name)) {
    const result = await ensureReminderForCondition(
      false,
      { condition_key: conditionKey },
      { immediate: false },
    );

    return {
      status: 'skipped',
      action: classifyRuleAction(result),
      reason: 'no_client_name',
      rule: 'p4',
    };
  }

  const conditionIsTrue = (
    proposal.form_status === 'submitted'
    && proposal.proposal_sent_to_client === true
    && proposal.client_saw_proposal !== true
  );

  const result = await ensureReminderForCondition(
    conditionIsTrue,
    conditionIsTrue ? buildP4ReminderInput(proposal) : { condition_key: conditionKey },
    { immediate: conditionIsTrue },
  );

  return {
    status: conditionIsTrue ? 'applied' : 'cleared',
    action: classifyRuleAction(result),
    conditionKey,
    rule: 'p4',
  };
}

async function runP2ReminderRuleForProject(project, cache = {}) {
  const conditionKey = getProjectNeedsProposalConditionKey(project?.id);
  const proposals = cache.proposals ?? [];

  if (!project?.id) {
    return { status: 'skipped', action: null, reason: 'no_project_id', rule: 'p2' };
  }

  if (!isProjectEligibleForP2(project)) {
    const result = await ensureReminderForCondition(
      false,
      { condition_key: conditionKey },
      { immediate: false },
    );

    return {
      status: 'skipped',
      action: classifyRuleAction(result),
      reason: 'project_not_eligible',
      rule: 'p2',
    };
  }

  const conditionIsTrue = !hasNonCancelledProposalForProject(project.id, proposals);

  const result = await ensureReminderForCondition(
    conditionIsTrue,
    conditionIsTrue ? buildP2ReminderInput(project, cache) : { condition_key: conditionKey },
    { immediate: conditionIsTrue },
  );

  return {
    status: conditionIsTrue ? 'applied' : 'cleared',
    action: classifyRuleAction(result),
    conditionKey,
    rule: 'p2',
  };
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

  if (!proposals) {
    proposals = await base44.entities.Proposal.list();
  }

  if (!clients) {
    clients = await base44.entities.Client.list();
  }

  return runP2ReminderRuleForProject(project, { proposals, clients });
}

export async function runProposalReminderRulesForProposal(proposal, cache = {}) {
  const p0 = await runP0ReminderRuleForProposal(proposal);
  const p3 = await runP3ReminderRuleForProposal(proposal);
  const p4 = await runP4ReminderRuleForProposal(proposal);

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

  return { p0, p3, p4, p2 };
}

export async function runProposalReminderRulesForAll() {
  const summary = {
    checked: 0,
    created: 0,
    updated: 0,
    resolved: 0,
    skipped: 0,
    errors: 0,
  };

  let proposals = [];
  let projects = [];
  let clients = [];

  try {
    [proposals, projects, clients] = await Promise.all([
      base44.entities.Proposal.list(),
      base44.entities.Project.list(),
      base44.entities.Client.list(),
    ]);
  } catch (error) {
    console.error('[ProposalReminderRules] failed to load entities', error);
    summary.errors += 1;
    return summary;
  }

  const cache = { proposals, clients, projects };

  try {
    await cancelOrphanRemindersForSourceType(
      'proposal',
      proposals.map((proposal) => proposal.id).filter(Boolean),
    );
  } catch (error) {
    console.error('[ProposalReminderRules] failed to cancel orphan proposal reminders', error);
    summary.errors += 1;
  }

  for (const project of projects) {
    summary.checked += 1;

    try {
      const result = await runP2ReminderRuleForProject(project, cache);
      tallyRuleResult(summary, result);
    } catch (error) {
      summary.errors += 1;
      console.error('[ProposalReminderRules] P2 failed for project', project?.id, error);
    }
  }

  for (const proposal of proposals) {
    summary.checked += 1;

    try {
      const result = await runProposalReminderRulesForProposal(proposal, cache);
      tallyRuleResult(summary, result.p0);
      tallyRuleResult(summary, result.p3);
      tallyRuleResult(summary, result.p4);
      if (result.p2) {
        tallyRuleResult(summary, result.p2);
      }
    } catch (error) {
      summary.errors += 1;
      console.error('[ProposalReminderRules] failed for proposal', proposal?.id, error);
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
