/**
 * P2 reminder business validity check — extracted to keep reminderEngine.js small.
 * Checks: project exists, has no active Proposal, has no active SignedProposal.
 */
import { api as base44 } from '@/api/apiClient';
import { isValidSignedProposal } from '@/lib/signedProposalValidation';

const toTrimmedValue = (value) => String(value || '').trim();

const ensureEntityMapP2 = async (cache, entityName) => {
  const key = `${entityName}ById`;
  const statusKey = `${entityName}LoadStatus`;

  if (cache[key]) return cache[key];
  if (cache[statusKey] === 'failed') return null;

  try {
    const entity = base44.entities[entityName];
    const items = entity && typeof entity.list === 'function' ? await entity.list() : [];
    const map = new Map((items || []).map((item) => [item.id, item]));
    cache[key] = map;
    cache[statusKey] = 'loaded';
    return map;
  } catch (error) {
    cache[statusKey] = 'failed';
    console.warn('[ReminderEngineP2] failed to load entity map', { entityName }, error);
    return null;
  }
};

/**
 * Returns { valid, reason } for a P2 (project_needs_proposal) reminder.
 * valid=false when: project deleted, has active proposal, or has active signed proposal.
 */
export async function evaluateP2ReminderValidity(sourceId, cache) {
  const projectsById = await ensureEntityMapP2(cache, 'Project');
  if (!projectsById) return { valid: true, reason: 'project_loader_failed' };
  const project = projectsById.get(sourceId);
  if (!project) return { valid: false, reason: 'source_deleted' };

  const proposalsById = await ensureEntityMapP2(cache, 'Proposal');
  if (!proposalsById) return { valid: true, reason: 'proposal_loader_failed' };
  const hasProposal = [...proposalsById.values()].some(
    (proposal) => proposal.project_id === project.id && proposal.form_status !== 'cancelled',
  );
  if (hasProposal) return { valid: false, reason: 'condition_cleared' };

  // אם קיימת הצעה חתומה — הפרויקט כבר עבר שלב הצעת מחיר
  const signedProposalsById = await ensureEntityMapP2(cache, 'SignedProposal');
  if (!signedProposalsById) return { valid: true, reason: 'signed_proposal_loader_failed' };
  const hasSignedProposal = [...signedProposalsById.values()].some(
    (signedProposal) => (
      isValidSignedProposal(signedProposal)
      && toTrimmedValue(signedProposal.project_id) === project.id
    ),
  );

  return { valid: !hasSignedProposal, reason: hasSignedProposal ? 'condition_cleared' : 'valid' };
}