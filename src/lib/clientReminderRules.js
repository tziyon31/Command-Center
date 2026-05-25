import { base44 } from '@/api/base44Client';
import { ensureReminderForCondition } from '@/lib/reminderEngine';
import { buildProjectCreatePageUrl } from '@/lib/workflowNavigation';

export const CLIENT_NEEDS_PROJECT_CONDITION_PREFIX = 'client_needs_project:';

export function getClientNeedsProjectConditionKey(clientId) {
  return `${CLIENT_NEEDS_PROJECT_CONDITION_PREFIX}${clientId}`;
}

export async function hasClientProject(clientId, cache = {}) {
  if (!clientId) return false;

  const projects = cache.projects ?? await base44.entities.Project.list();
  return projects.some((project) => project.client_id === clientId);
}

const classifyRuleAction = (engineResult) => {
  const action = engineResult?.action;

  if (action === 'created') return 'created';
  if (action === 'updated' || action === 'reactivated') return 'updated';
  if (action === 'resolved' || action === 'already_resolved') return 'resolved';
  return 'skipped';
};

const shouldRunR4ForClient = (client) => {
  if (!client?.id) return false;
  if (client.status === 'archived') return false;
  if (client.source_inquiry_id) return false;
  return true;
};

const buildR4ReminderInput = (client) => ({
  title: `לפתוח פרויקט ללקוח ${client.name}`,
  description: 'הלקוח קיים במערכת, אך עדיין לא נפתח לו פרויקט.',
  client_name: client.name,
  client_id: client.id,
  project_name: '',
  project_id: '',
  source_type: 'client',
  source_id: client.id,
  condition_key: getClientNeedsProjectConditionKey(client.id),
  action_url: buildProjectCreatePageUrl({
    clientId: client.id,
    clientName: client.name,
    projectName: client.name,
    sourceInquiryId: client.source_inquiry_id || undefined,
  }),
  action_label: 'פתח פרויקט',
  frequency: 'daily',
});

/**
 * R4: remind to open a project for a standalone client (not from inquiry).
 */
export async function runClientReminderRulesForClient(client, cache = {}) {
  const conditionKey = getClientNeedsProjectConditionKey(client?.id);

  if (!client?.id) {
    return { status: 'skipped', action: null, reason: 'no_client_id', rule: 'r4' };
  }

  if (!shouldRunR4ForClient(client)) {
    const result = await ensureReminderForCondition(
      false,
      { condition_key: conditionKey },
      { immediate: false },
    );

    return {
      status: 'skipped',
      action: classifyRuleAction(result),
      reason: client.source_inquiry_id ? 'managed_by_inquiry_r2' : 'not_eligible',
      rule: 'r4',
    };
  }

  const hasProject = await hasClientProject(client.id, cache);
  const conditionIsTrue = !hasProject;
  const reminderInput = conditionIsTrue
    ? buildR4ReminderInput(client)
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
    rule: 'r4',
  };
}

export async function runClientReminderRulesForAll() {
  const summary = {
    checked: 0,
    created: 0,
    updated: 0,
    resolved: 0,
    skipped: 0,
    errors: 0,
  };

  let clients = [];
  let projects = [];

  try {
    [clients, projects] = await Promise.all([
      base44.entities.Client.list(),
      base44.entities.Project.list(),
    ]);
  } catch (error) {
    console.error('[ClientReminderRules] failed to load entities', error);
    summary.errors += 1;
    return summary;
  }

  const cache = { projects };

  for (const client of clients) {
    summary.checked += 1;

    try {
      const result = await runClientReminderRulesForClient(client, cache);

      if (result.status === 'skipped') {
        summary.skipped += 1;
      }
      if (result.action === 'created') summary.created += 1;
      else if (result.action === 'updated') summary.updated += 1;
      else if (result.action === 'resolved') summary.resolved += 1;
    } catch (error) {
      summary.errors += 1;
      console.error('[ClientReminderRules] failed for client', client?.id, error);
    }
  }

  return summary;
}
