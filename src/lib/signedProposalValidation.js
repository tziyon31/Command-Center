export function isValidSignedProposal(signedProposal) {
  return Boolean(
    signedProposal
    && signedProposal.form_status === 'submitted'
    && signedProposal.has_signed_offer_or_order === true,
  );
}

/** Valid signed proposal for opening WorkStages (requires linked project). */
export function isValidSignedProposalForWorkStages(signedProposal) {
  return isValidSignedProposal(signedProposal)
    && Boolean(String(signedProposal?.project_id || '').trim());
}
