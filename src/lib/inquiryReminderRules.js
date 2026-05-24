import { base44 } from '@/api/base44Client';
import {
  ensureReminderForCondition,
} from '@/lib/reminderEngine';

export const INQUIRY_MISSING_FIELDS_CONDITION_PREFIX = 'inquiry_missing_fields:';
export const INQUIRY_NEEDS_NEXT_STEP_CONDITION_PREFIX = 'inquiry_needs_next_step:';

export function getInquiryMissingFieldsConditionKey(inquiryId) {
  return `${INQUIRY_MISSING_FIELDS_CONDITION_PREFIX}${inquiryId}`;
}

export function getInquiryNeedsNextStepConditionKey(inquiryId) {
  return `${INQUIRY_NEEDS_NEXT_STEP_CONDITION_PREFIX}${inquiryId}`;
}

const hasClientName = (inquiry) => Boolean(inquiry?.client_name?.trim());

const isDetailsMissing = (inquiry) => !inquiry?.details?.trim();

const shouldHaveR1Reminder = (inquiry) => {
  if (!hasClientName(inquiry)) {
    return false;
  }

  if (inquiry.form_status === 'submitted') {
    return false;
  }

  return inquiry.form_status !== 'submitted' || isDetailsMissing(inquiry);
};

const shouldHaveR2Reminder = async (inquiry, cache = {}) => {
  if (!inquiry?.id || !hasClientName(inquiry)) {
    return false;
  }

  if (inquiry.form_status !== 'submitted') {
    return false;
  }

  const hasContinuation = await hasInquiryNextStep(inquiry.id, cache);
  return !hasContinuation;
};

const buildR1ReminderInput = (inquiry) => {
  const clientName = inquiry.client_name.trim();

  return {
    title: `להשלים פנייה עבור ${clientName}`,
    description: 'יש להשלים את פרטי הפנייה ולהגיש את הטופס.',
    client_name: clientName,
    client_id: '',
    project_name: '',
    project_id: '',
    source_type: 'inquiry',
    source_id: inquiry.id,
    condition_key: getInquiryMissingFieldsConditionKey(inquiry.id),
    action_url: `/InquiryForm?id=${inquiry.id}`,
    action_label: 'פתח פנייה',
    frequency: 'daily',
  };
};

const buildR2ReminderInput = (inquiry) => {
  const clientName = inquiry.client_name.trim();

  return {
    title: `לפתוח המשך תהליך עבור ${clientName}`,
    description: 'הפנייה הוגשה, אך עדיין לא נפתח לה לקוח או פרויקט.',
    client_name: clientName,
    client_id: '',
    project_name: '',
    project_id: '',
    source_type: 'inquiry',
    source_id: inquiry.id,
    condition_key: getInquiryNeedsNextStepConditionKey(inquiry.id),
    action_url: `/InquiryForm?id=${inquiry.id}`,
    action_label: 'פתח פנייה',
    frequency: 'daily',
  };
};

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

/**
 * Returns true when a Client or Project is linked to the inquiry via source_inquiry_id.
 */
export async function hasInquiryNextStep(inquiryId, cache = {}) {
  if (!inquiryId) return false;

  const clients = cache.clients ?? await base44.entities.Client.list();
  const projects = cache.projects ?? await base44.entities.Project.list();

  const hasLinkedClient = clients.some((client) => client.source_inquiry_id === inquiryId);
  const hasLinkedProject = projects.some((project) => project.source_inquiry_id === inquiryId);

  return hasLinkedClient || hasLinkedProject;
}

/**
 * R1: remind to complete and submit an inquiry when it is not submitted.
 */
async function runR1ReminderRuleForInquiry(inquiry) {
  if (!inquiry?.id) {
    return { status: 'skipped', action: null, reason: 'no_inquiry_id', rule: 'r1' };
  }

  const conditionKey = getInquiryMissingFieldsConditionKey(inquiry.id);

  if (!hasClientName(inquiry)) {
    const result = await ensureReminderForCondition(
      false,
      { condition_key: conditionKey },
      { immediate: false },
    );

    return {
      status: 'skipped',
      action: classifyRuleAction(result),
      reason: 'no_client_name',
      rule: 'r1',
    };
  }

  const conditionIsTrue = shouldHaveR1Reminder(inquiry);
  const reminderInput = buildR1ReminderInput(inquiry);

  const result = await ensureReminderForCondition(
    conditionIsTrue,
    reminderInput,
    { immediate: false },
  );

  return {
    status: conditionIsTrue ? 'applied' : 'cleared',
    action: classifyRuleAction(result),
    conditionKey,
    rule: 'r1',
  };
}

/**
 * R2: remind to open client/project continuation after inquiry was submitted.
 */
async function runR2ReminderRuleForInquiry(inquiry, cache = {}) {
  if (!inquiry?.id) {
    return { status: 'skipped', action: null, reason: 'no_inquiry_id', rule: 'r2' };
  }

  const conditionKey = getInquiryNeedsNextStepConditionKey(inquiry.id);

  if (!hasClientName(inquiry)) {
    const result = await ensureReminderForCondition(
      false,
      { condition_key: conditionKey },
      { immediate: false },
    );

    return {
      status: 'skipped',
      action: classifyRuleAction(result),
      reason: 'no_client_name',
      rule: 'r2',
    };
  }

  const conditionIsTrue = await shouldHaveR2Reminder(inquiry, cache);
  const reminderInput = conditionIsTrue
    ? buildR2ReminderInput(inquiry)
    : { condition_key: conditionKey };

  const result = await ensureReminderForCondition(
    conditionIsTrue,
    reminderInput,
    { immediate: false },
  );

  return {
    status: conditionIsTrue ? 'applied' : 'cleared',
    action: classifyRuleAction(result),
    conditionKey,
    rule: 'r2',
  };
}

export async function runInquiryReminderRulesForInquiry(inquiry, cache = {}) {
  const r1 = await runR1ReminderRuleForInquiry(inquiry);
  const r2 = await runR2ReminderRuleForInquiry(inquiry, cache);

  return {
    ...r1,
    r1,
    r2,
  };
}

export async function runInquiryReminderRulesForAll() {
  const summary = {
    checked: 0,
    created: 0,
    updated: 0,
    resolved: 0,
    skipped: 0,
    errors: 0,
  };

  let inquiries = [];
  let clients = [];
  let projects = [];

  try {
    [inquiries, clients, projects] = await Promise.all([
      base44.entities.Inquiry.list(),
      base44.entities.Client.list(),
      base44.entities.Project.list(),
    ]);
  } catch (error) {
    console.error('[InquiryReminderRules] failed to load entities', error);
    summary.errors += 1;
    return summary;
  }

  const cache = { clients, projects };

  for (const inquiry of inquiries) {
    summary.checked += 1;

    try {
      const result = await runInquiryReminderRulesForInquiry(inquiry, cache);
      tallyRuleResult(summary, result.r1);
      tallyRuleResult(summary, result.r2);
    } catch (error) {
      summary.errors += 1;
      console.error(
        '[InquiryReminderRules] failed for inquiry',
        inquiry?.id,
        error,
      );
    }
  }

  return summary;
}
