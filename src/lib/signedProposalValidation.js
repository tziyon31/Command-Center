export function isValidSignedProposal(signedProposal) {
  return Boolean(
    signedProposal
    && signedProposal.form_status === 'submitted'
    && signedProposal.has_signed_offer_or_order === true,
  );
}
