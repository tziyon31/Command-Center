import { api as base44 } from '@/api/apiClient';

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
