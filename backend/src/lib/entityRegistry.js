export const ENTITY_REGISTRY = {
  users: { model: 'user', sensitive: ['passwordHash'] },
  clients: { model: 'client' },
  inquiries: { model: 'inquiry' },
  projects: { model: 'project' },
  proposals: { model: 'proposal' },
  signed_proposals: { model: 'signedProposal' },
  work_stages: { model: 'workStage' },
  invoice_processes: { model: 'invoiceProcess' },
  invoices: { model: 'invoice' },
  collection_dues: { model: 'collectionDue' },
  collection_events: { model: 'collectionEvent' },
  reminders: { model: 'reminder' },
  reminder_settings: { model: 'reminderSettings' },
  tasks: { model: 'task' },
  quotes: { model: 'quote' },
  documents: { model: 'document' },
  conversations: { model: 'conversation' },
};

export function resolveEntity(entityName) {
  return ENTITY_REGISTRY[entityName] ?? null;
}

export function listEntityNames() {
  return Object.keys(ENTITY_REGISTRY);
}
