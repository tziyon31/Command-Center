import { base44 } from '@/api/base44Client';
import { isValidSignedProposal } from '@/lib/signedProposalValidation';
import {
  getActiveWorkStage,
  isWorkStageCompleted,
  normalizeWorkStageStatuses,
  WORK_STAGE_STATUS,
} from '@/lib/workStageLogic';
import {
  ensureReminderForCondition,
  isRateLimitError,
  loadReminderEngineCache,
} from '@/lib/reminderEngine';
import { buildWorkStagesPageUrl } from '@/lib/workflowNavigation';

export const SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX = 'signed_proposal_needs_work_stages:';
export const WORK_STAGE_NEEDS_CHECK_PREFIX = 'work_stage_needs_check:';
export const WORK_STAGE_TARGET_DATE_PREFIX = 'work_stage_target_date:';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function getSignedProposalNeedsWorkStagesConditionKey(signedProposalId) {
  return `${SIGNED_PROPOSAL_NEEDS_WORK_STAGES_PREFIX}${signedProposalId}`;
}

export function getWorkStageNeedsCheckConditionKey(stageId) {
  return `${WORK_STAGE_NEEDS_CHECK_PREFIX}${stageId}`;
}

export function getWorkStageTargetDateConditionKey(stageId) {
  return `${WORK_STAGE_TARGET_DATE_PREFIX}${stageId}`;
}

export function hasNonCancelledWorkStageForProject(projectId, workStages = []) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return false;

  return workStages.some(
    (stage) => String(stage?.project_id || '').trim() === normalizedProjectId
      && stage?.status !== WORK_STAGE_STATUS.CANCELLED,
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

const tallyRuleAction = (summary, action) => {
  if (action === 'created') summary.created += 1;
  else if (action === 'updated') summary.updated += 1;
  else if (action === 'resolved') summary.resolved += 1;
  else summary.skipped += 1;

  if (action === 'created' || action === 'updated' || action === 'resolved') {
    summary.mutationCount += 1;
  }
};

const parseTargetDate = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const dateOnly = raw.split('T')[0];
  const parsed = new Date(dateOnly);
  if (Number.isNaN(parsed.getTime())) return null;

  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const startOfToday = (now = new Date()) => {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return today;
};

const daysUntilTargetDate = (targetDateRaw, now = new Date()) => {
  const target = parseTargetDate(targetDateRaw);
  if (!target) return null;

  const today = startOfToday(now);
  return Math.round((target.getTime() - today.getTime()) / MS_PER_DAY);
};

const subtractDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
};

const buildWorkStageActionUrl = (stage) => buildWorkStagesPageUrl({
  projectId: stage.project_id,
  signedProposalId: stage.signed_proposal_id,
  stageId: stage.id,
});

const buildWorkStageReminderBase = (stage) => ({
  client_name: String(stage.client_name || stage.project_name || '').trim(),
  client_id: stage.client_id || '',
  project_name: stage.project_name || '',
  project_id: stage.project_id || '',
  source_type: 'work_stage',
  source_id: stage.id,
  action_url: buildWorkStageActionUrl(stage),
  action_label: 'פתח שלבי עבודה',
});

const hasWorkStageReminderClientName = (stage) => (
  Boolean(String(stage?.client_name || stage?.project_name || '').trim())
);

const buildWS1ReminderInput = (stage) => {
  const title = stage.title || 'ללא שם';

  return {
    ...buildWorkStageReminderBase(stage),
    title: `האם הסתיים שלב העבודה ${title}?`,
    description: 'שלב העבודה הפעיל בפרויקט עדיין ללא תאריך יעד. יש לבדוק אם השלב הסתיים או לקבוע לו תאריך יעד.',
    condition_key: getWorkStageNeedsCheckConditionKey(stage.id),
    frequency: 'weekly',
  };
};

export function computeWS2ReminderSchedule(stage, now = new Date()) {
  const title = stage.title || 'ללא שם';
  const days = daysUntilTargetDate(stage.target_date, now);

  if (days === null) {
    return {
      frequency: 'due_date_based',
      next_remind_at: now.toISOString(),
      title: `שלב העבודה ${title} מתקרב לתאריך היעד`,
      description: 'שלב העבודה הפעיל בפרויקט כולל תאריך יעד. יש לבדוק התקדמות או להשלים את האישורים הנדרשים.',
      immediate: true,
    };
  }

  if (days > 7) {
    const target = parseTargetDate(stage.target_date);
    return {
      frequency: 'due_date_based',
      next_remind_at: subtractDays(target, 7).toISOString(),
      title: `שלב העבודה ${title} מתקרב לתאריך היעד`,
      description: 'שלב העבודה הפעיל בפרויקט כולל תאריך יעד. יש לבדוק התקדמות או להשלים את האישורים הנדרשים.',
      immediate: false,
    };
  }

  if (days <= 0) {
    return {
      frequency: 'daily',
      next_remind_at: now.toISOString(),
      title: `שלב העבודה ${title} עבר את תאריך היעד. האם הסתיים?`,
      description: 'שלב העבודה הפעיל בפרויקט כולל תאריך יעד. יש לבדוק התקדמות או להשלים את האישורים הנדרשים.',
      immediate: true,
    };
  }

  if (days === 1) {
    return {
      frequency: 'due_date_based',
      next_remind_at: now.toISOString(),
      title: `שלב העבודה ${title} מתקרב לתאריך היעד מחר`,
      description: 'שלב העבודה הפעיל בפרויקט כולל תאריך יעד. יש לבדוק התקדמות או להשלים את האישורים הנדרשים.',
      immediate: true,
    };
  }

  return {
    frequency: 'due_date_based',
    next_remind_at: now.toISOString(),
    title: `שלב העבודה ${title} מתקרב לתאריך היעד`,
    description: 'שלב העבודה הפעיל בפרויקט כולל תאריך יעד. יש לבדוק התקדמות או להשלים את האישורים הנדרשים.',
    immediate: true,
  };
};

const buildWS2ReminderInput = (stage, now = new Date()) => {
  const schedule = computeWS2ReminderSchedule(stage, now);

  return {
    input: {
      ...buildWorkStageReminderBase(stage),
      title: schedule.title,
      description: schedule.description,
      condition_key: getWorkStageTargetDateConditionKey(stage.id),
      frequency: schedule.frequency,
      next_remind_at: schedule.next_remind_at,
    },
    immediate: schedule.immediate,
  };
};

const isStageCompleted = (stage) => (
  stage?.status === WORK_STAGE_STATUS.COMPLETED || isWorkStageCompleted(stage)
);

const getProjectWorkStages = (projectId, cache = {}) => {
  const normalizedProjectId = String(projectId || '').trim();
  const workStages = cache.workStages ?? [];

  return workStages.filter(
    (stage) => String(stage?.project_id || '').trim() === normalizedProjectId,
  );
};

const mergeProjectStagesIntoCache = (projectId, normalizedStages, cache = {}) => {
  const normalizedProjectId = String(projectId || '').trim();
  const workStages = cache.workStages ?? [];
  const otherStages = workStages.filter(
    (stage) => String(stage?.project_id || '').trim() !== normalizedProjectId,
  );
  cache.workStages = [...otherStages, ...normalizedStages];
  return cache.workStages;
};

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

async function runR7ReminderRulesForProject(projectId, cache = {}) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return [];

  let signedProposals = cache.signedProposals;
  if (!signedProposals) {
    signedProposals = await base44.entities.SignedProposal.list();
    cache.signedProposals = signedProposals;
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

export async function runWorkStageActiveReminderRulesForStage(stage, cache = {}, options = {}) {
  const activeStageId = options.activeStageId ?? null;
  const ws1Key = getWorkStageNeedsCheckConditionKey(stage?.id);
  const ws2Key = getWorkStageTargetDateConditionKey(stage?.id);

  if (!stage?.id) {
    return {
      status: 'skipped',
      ws1: { action: null },
      ws2: { action: null },
      rule: 'ws',
    };
  }

  const cancelled = stage.status === WORK_STAGE_STATUS.CANCELLED;
  const completed = isStageCompleted(stage);
  const isActive = !cancelled && !completed && stage.id === activeStageId;
  const hasTargetDate = Boolean(String(stage.target_date || '').trim());
  const canCreateReminder = hasWorkStageReminderClientName(stage);

  const ws1ShouldBeOpen = isActive && !hasTargetDate && canCreateReminder;
  const ws2ShouldBeOpen = isActive && hasTargetDate && canCreateReminder;

  const ws1Result = await ensureReminderForCondition(
    ws1ShouldBeOpen,
    ws1ShouldBeOpen ? buildWS1ReminderInput(stage) : { condition_key: ws1Key },
    withReminderCache(cache, { immediate: ws1ShouldBeOpen }),
  );

  const ws2Built = ws2ShouldBeOpen ? buildWS2ReminderInput(stage) : null;
  const ws2Result = await ensureReminderForCondition(
    ws2ShouldBeOpen,
    ws2Built?.input || { condition_key: ws2Key },
    withReminderCache(cache, {
      immediate: ws2ShouldBeOpen ? ws2Built?.immediate === true : false,
    }),
  );

  return {
    status: ws1ShouldBeOpen || ws2ShouldBeOpen ? 'applied' : 'cleared',
    ws1: { action: classifyRuleAction(ws1Result), conditionKey: ws1Key, rule: 'ws1' },
    ws2: { action: classifyRuleAction(ws2Result), conditionKey: ws2Key, rule: 'ws2' },
    rule: 'ws',
    skippedReason: !canCreateReminder && isActive ? 'missing_client_name' : null,
  };
}

export async function runWorkStageActiveReminderRulesForProject(projectId, cache = {}) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return { ws: [] };

  const projectStages = getProjectWorkStages(normalizedProjectId, cache);
  const normalized = normalizeWorkStageStatuses(projectStages);
  mergeProjectStagesIntoCache(normalizedProjectId, normalized, cache);

  const activeStage = getActiveWorkStage(normalized);
  const wsResults = [];

  for (const stage of normalized) {
    wsResults.push(await runWorkStageActiveReminderRulesForStage(stage, cache, {
      activeStageId: activeStage?.id || null,
    }));
  }

  return { ws: wsResults };
}

export async function runWorkStageReminderRulesForProject(projectId, cache = {}) {
  const r7 = await runR7ReminderRulesForProject(projectId, cache);
  const active = await runWorkStageActiveReminderRulesForProject(projectId, cache);
  return { r7, ws: active.ws };
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
      tallyRuleAction(summary, result.action);
    } catch (error) {
      summary.errors += 1;
      if (isRateLimitError(error)) {
        summary.rateLimited = true;
        break;
      }
    }
  }

  const projectIds = [...new Set(
    workStages
      .map((stage) => String(stage?.project_id || '').trim())
      .filter(Boolean),
  )];

  for (const projectId of projectIds) {
    if (summary.rateLimited || summary.mutationCount >= maxMutations) {
      summary.hasMore = true;
      break;
    }

    summary.checked += 1;

    try {
      const { ws } = await runWorkStageActiveReminderRulesForProject(projectId, cache);

      for (const result of ws) {
        if (summary.mutationCount >= maxMutations) {
          summary.hasMore = true;
          break;
        }

        tallyRuleAction(summary, result.ws1?.action);
        if (summary.mutationCount >= maxMutations) {
          summary.hasMore = true;
          break;
        }

        tallyRuleAction(summary, result.ws2?.action);
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
