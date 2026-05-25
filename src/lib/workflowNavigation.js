import { createPageUrl } from '@/utils';

export const normalizeName = (value) => (
  String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
);

export const namesMatch = (left, right) => {
  const a = normalizeName(left);
  const b = normalizeName(right);
  return a !== '' && a === b;
};

export const buildProjectCreatePageUrl = ({
  clientId,
  clientName,
  projectName,
  sourceInquiryId,
}) => {
  const query = new URLSearchParams();
  query.set('form_status', 'draft');

  if (clientId) query.set('client_id', clientId);
  if (clientName) query.set('client_name', clientName);

  const resolvedProjectName = projectName || clientName;
  if (resolvedProjectName) query.set('project_name', resolvedProjectName);
  if (sourceInquiryId) query.set('source_inquiry_id', sourceInquiryId);

  return createPageUrl(`ProjectDetails?${query.toString()}`);
};

export const buildSignedProposalFormPageUrl = ({
  projectId,
  projectName,
  clientName,
  sourceInquiryId,
  signedProposalId,
}) => {
  const query = new URLSearchParams();

  if (signedProposalId) {
    query.set('id', signedProposalId);
  } else {
    if (projectId) query.set('project_id', projectId);
    if (projectName) query.set('project_name', projectName);
    if (clientName) query.set('client_name', clientName);
    if (sourceInquiryId) query.set('source_inquiry_id', sourceInquiryId);
  }

  const queryString = query.toString();
  return createPageUrl(queryString ? `SignedProposalForm?${queryString}` : 'SignedProposalForm');
};

export const buildClientFormPageUrl = ({ name, sourceInquiryId }) => {
  const query = new URLSearchParams();

  if (name) query.set('name', name);
  if (sourceInquiryId) query.set('source_inquiry_id', sourceInquiryId);

  const queryString = query.toString();
  return createPageUrl(queryString ? `ClientForm?${queryString}` : 'ClientForm');
};

export const formatExistingProjectsSuffix = (projects, { maxNames = 3 } = {}) => {
  const names = (projects || [])
    .map((project) => project?.name?.trim())
    .filter(Boolean);

  if (!names.length) {
    return '';
  }

  if (names.length <= maxNames) {
    return ` (קיימים: ${names.join(', ')})`;
  }

  const shown = names.slice(0, maxNames).join(', ');
  return ` (קיימים: ${shown} ועוד ${names.length - maxNames})`;
};

export const findClientByName = (clients, clientName) => (
  (clients || []).find((client) => namesMatch(client.name, clientName)) || null
);

export const getProjectsForClient = (projects, { clientId, clientName }) => {
  const list = projects || [];

  if (clientId) {
    const byClientId = list.filter((project) => project.client_id === clientId);
    if (byClientId.length) return byClientId;
  }

  if (!clientName?.trim()) return [];

  return list.filter((project) => namesMatch(project.name, clientName));
};
