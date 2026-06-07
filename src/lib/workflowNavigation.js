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

export const buildProposalFormPageUrl = ({
  proposalId,
  sourceInquiryId,
  clientId,
  clientName,
  projectId,
  projectName,
}) => {
  const query = new URLSearchParams();

  if (proposalId) {
    query.set('id', proposalId);
  } else {
    if (sourceInquiryId) query.set('source_inquiry_id', sourceInquiryId);
    if (clientId) query.set('client_id', clientId);
    if (clientName) query.set('client_name', clientName);
    if (projectId) query.set('project_id', projectId);
    if (projectName) query.set('project_name', projectName);
  }

  const queryString = query.toString();
  return createPageUrl(queryString ? `ProposalForm?${queryString}` : 'ProposalForm');
};

export const buildSignedProposalFormPageUrl = ({
  projectId,
  projectName,
  clientName,
  sourceInquiryId,
  proposalId,
  documentNote,
  signedProposalId,
}) => {
  const query = new URLSearchParams();

  if (signedProposalId) {
    query.set('id', signedProposalId);
  } else {
    if (proposalId) query.set('proposal_id', proposalId);
    if (projectId) query.set('project_id', projectId);
    if (projectName) query.set('project_name', projectName);
    if (clientName) query.set('client_name', clientName);
    if (sourceInquiryId) query.set('source_inquiry_id', sourceInquiryId);
    if (documentNote) query.set('document_note', documentNote);
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

export const isSafeInternalReturnPath = (path) => {
  const value = String(path || '').trim();
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  if (value.includes('://')) return false;
  return true;
};

export const buildProjectFeeEditPageUrl = ({ projectId, returnTo } = {}) => {
  const query = new URLSearchParams();
  if (projectId) query.set('id', projectId);
  query.set('edit', 'fee');
  if (returnTo && isSafeInternalReturnPath(returnTo)) {
    query.set('return_to', returnTo);
  }
  const queryString = query.toString();
  return createPageUrl(queryString ? `ProjectDetails?${queryString}` : 'ProjectDetails');
};

export const buildInvoiceProcessFormPageUrl = ({
  invoiceProcessId,
  projectId,
  workStageIds = [],
  invoiceScope,
  clientId,
  clientName,
}) => {
  const query = new URLSearchParams();

  if (invoiceProcessId) {
    query.set('id', invoiceProcessId);
  } else {
    if (projectId) query.set('project_id', projectId);
    if (clientId) query.set('client_id', clientId);
    if (clientName) query.set('client_name', clientName);
    if (invoiceScope) query.set('invoice_scope', invoiceScope);
    if (workStageIds?.length) {
      const ids = [...new Set(workStageIds.map((id) => String(id).trim()).filter(Boolean))];
      if (ids.length) query.set('work_stage_ids', ids.join(','));
    }
  }

  const queryString = query.toString();
  return createPageUrl(queryString ? `InvoiceProcessForm?${queryString}` : 'InvoiceProcessForm');
};

export const buildWorkStagesPageUrl = ({ projectId, signedProposalId, stageId }) => {
  const query = new URLSearchParams();
  if (projectId) query.set('project_id', projectId);
  if (signedProposalId) query.set('signed_proposal_id', signedProposalId);
  if (stageId) query.set('stage_id', stageId);
  const queryString = query.toString();
  return createPageUrl(queryString ? `WorkStages?${queryString}` : 'WorkStages');
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
