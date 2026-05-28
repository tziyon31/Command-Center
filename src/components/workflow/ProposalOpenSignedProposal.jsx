import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { buildSignedProposalFormPageUrl } from '@/lib/workflowNavigation';

export default function ProposalOpenSignedProposal({
  proposalId = '',
  formStatus,
  projectId = '',
  projectName = '',
  clientName = '',
  sourceInquiryId = '',
  documentNote = '',
  proposalSentToClient = false,
  disabled = false,
}) {
  const isSubmitted = formStatus === 'submitted';
  const hasProjectId = Boolean(projectId?.trim());
  const canOpenSigned = isSubmitted
    && proposalSentToClient
    && hasProjectId
    && !disabled;

  const signedProposalUrl = buildSignedProposalFormPageUrl({
    proposalId: proposalId || undefined,
    projectId: projectId || undefined,
    projectName: projectName.trim(),
    clientName: clientName.trim(),
    sourceInquiryId: sourceInquiryId || undefined,
    documentNote: documentNote.trim(),
  });

  return (
    <div className="rounded-md border p-4 space-y-3">
      <h3 className="text-sm font-semibold">המשך טיפול</h3>
      {!isSubmitted && (
        <p className="text-xs text-muted-foreground">
          יש להגיש את הצעת המחיר לפני פתיחת הצעה חתומה.
        </p>
      )}
      {isSubmitted && !hasProjectId && (
        <p className="text-xs text-muted-foreground">
          יש לשייך פרויקט לפני פתיחת הצעה חתומה.
        </p>
      )}
      {canOpenSigned ? (
        <Button type="button" variant="outline" asChild>
          <Link to={signedProposalUrl}>פתח הצעה חתומה</Link>
        </Button>
      ) : (
        <Button type="button" variant="outline" disabled>
          פתח הצעה חתומה
        </Button>
      )}
    </div>
  );
}
