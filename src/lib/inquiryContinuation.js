import { base44 } from '@/api/base44Client';

/** Matches new-project defaults in Projects.jsx (status: pricing). */
export const INQUIRY_PROJECT_BUSINESS_STATUS = 'pricing';

export async function findClientBySourceInquiryId(inquiryId) {
  if (!inquiryId) return null;

  const results = await base44.entities.Client.filter({ source_inquiry_id: inquiryId });
  return results?.[0] || null;
}

export async function findProjectBySourceInquiryId(inquiryId) {
  if (!inquiryId) return null;

  const results = await base44.entities.Project.filter({ source_inquiry_id: inquiryId });
  return results?.[0] || null;
}

export async function loadInquiryById(inquiryId) {
  if (!inquiryId) return null;

  const results = await base44.entities.Inquiry.filter({ id: inquiryId });
  return results?.[0] || null;
}

export async function createClientFromInquiry(inquiry) {
  return base44.entities.Client.create({
    name: inquiry.client_name.trim(),
    status: 'draft',
    source_inquiry_id: inquiry.id,
  });
}

export async function createProjectFromInquiry(inquiry, client) {
  return base44.entities.Project.create({
    name: inquiry.client_name.trim(),
    client_id: client.id,
    source_inquiry_id: inquiry.id,
    form_status: 'draft',
    status: INQUIRY_PROJECT_BUSINESS_STATUS,
    year: new Date().getFullYear(),
    total_amount: 0,
    collected_amount: 0,
  });
}

export async function openOrCreateClientFromInquiry(inquiry) {
  const existing = await findClientBySourceInquiryId(inquiry.id);

  if (existing) {
    return { client: existing, created: false };
  }

  const client = await createClientFromInquiry(inquiry);
  return { client, created: true };
}

export async function openOrCreateProjectFromInquiry(inquiry) {
  const existingProject = await findProjectBySourceInquiryId(inquiry.id);

  if (existingProject) {
    return { project: existingProject, client: null, createdProject: false, createdClient: false };
  }

  let client = await findClientBySourceInquiryId(inquiry.id);
  let createdClient = false;

  if (!client) {
    const clientResult = await openOrCreateClientFromInquiry(inquiry);
    client = clientResult.client;
    createdClient = clientResult.created;
  }

  const project = await createProjectFromInquiry(inquiry, client);

  return {
    project,
    client,
    createdProject: true,
    createdClient,
  };
}
