import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  // Load all projects and existing legacy events in parallel
  const [projects, existingLegacyEvents] = await Promise.all([
    base44.asServiceRole.entities.Project.list(),
    base44.asServiceRole.entities.CollectionEvent.filter({ type: 'collection_paid_legacy' }),
  ]);

  const existingLegacyProjectIds = new Set(
    (existingLegacyEvents || []).map((e) => e.project_id)
  );

  const projectsWithCollection = projects.filter(
    (p) => Number(p.collected_amount) > 0
  );

  const toCreate = projectsWithCollection.filter(
    (p) => !existingLegacyProjectIds.has(p.id)
  );

  let created = 0;
  for (const project of toCreate) {
    await base44.asServiceRole.entities.CollectionEvent.create({
      project_id: project.id,
      project_name: project.name || '',
      amount: Number(project.collected_amount) || 0,
      note: 'גביית עבר לפני הפעלת מנגנון הגבייה',
      opened_at: '',
      paid_at: '2026-01-01T00:00:00.000Z',
      type: 'collection_paid_legacy',
      is_legacy: true,
      date_precision: 'agreed',
    });
    created++;
  }

  return Response.json({
    summary: {
      projects_checked: projects.length,
      projects_with_collection: projectsWithCollection.length,
      legacy_events_already_existed: existingLegacyEvents.length,
      legacy_events_created_now: created,
    },
  });
});