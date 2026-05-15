// TEMP DEBUG: read-only legacy collection migration verification. Remove after check.
import { base44 } from '@/api/base44Client';

const LEGACY_COLLECTION_TYPE = 'collection_paid_legacy';

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export async function verifyLegacyCollectionMigration() {
  const [projects, collectionEvents] = await Promise.all([
    base44.entities.Project.list(),
    base44.entities.CollectionEvent.list(),
  ]);

  const projectsWithCollectedAmount = projects.filter(
    (project) => toNumber(project.collected_amount) > 0
  );

  const totalProjectsCollectedAmount = projectsWithCollectedAmount.reduce(
    (sum, project) => sum + toNumber(project.collected_amount),
    0
  );

  const legacyEvents = collectionEvents.filter(
    (event) => event.type === LEGACY_COLLECTION_TYPE
  );

  const totalLegacyEventsAmount = legacyEvents.reduce(
    (sum, event) => sum + toNumber(event.amount),
    0
  );

  const legacyCountByProjectId = legacyEvents.reduce((counts, event) => {
    if (!event.project_id) return counts;

    counts.set(event.project_id, (counts.get(event.project_id) || 0) + 1);
    return counts;
  }, new Map());

  const duplicateLegacyEventsByProject = [...legacyCountByProjectId.entries()]
    .filter(([, count]) => count > 1)
    .map(([projectId]) => projectId);

  const summary = {
    projectsChecked: projects.length,
    projectsWithCollectedAmount: projectsWithCollectedAmount.length,
    totalProjectsCollectedAmount,
    legacyEventsCount: legacyEvents.length,
    totalLegacyEventsAmount,
    duplicateLegacyEventsByProject,
    isAmountMatch: totalProjectsCollectedAmount === totalLegacyEventsAmount,
  };

  console.log('[LegacyCollectionMigrationVerification]', summary);

  console.table(
    legacyEvents.map((event) => ({
      project_name: event.project_name,
      project_id: event.project_id,
      amount: event.amount,
      paid_at: event.paid_at,
      type: event.type,
      is_legacy: event.is_legacy,
      date_precision: event.date_precision,
    }))
  );

  return summary;
}
