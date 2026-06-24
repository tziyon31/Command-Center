import { base44 } from '@/api/base44Client';
import { buildDashboardCollectionMetrics } from '@/lib/dashboardCollectionMetrics';
import { filterRealBusinessCollectionEvents } from '@/lib/testDataUtils';

const COLLECTION_PERIOD = 'year';

export async function fetchCollectionCelebrationKpis() {
  const [projects, collectionDues, collectionEvents] = await Promise.all([
    base44.entities.Project.list(),
    base44.entities.CollectionDue.list('-created_date'),
    base44.entities.CollectionEvent.list(),
  ]);

  const metrics = buildDashboardCollectionMetrics({
    projects,
    collectionDues,
    collectionEvents: filterRealBusinessCollectionEvents(collectionEvents),
    collectionPeriod: COLLECTION_PERIOD,
  });

  return {
    openCollectionAmount: metrics.openCollectionAmount,
    recordedCollection: metrics.recordedCollection,
  };
}
