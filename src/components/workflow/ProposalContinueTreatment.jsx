import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '@/utils';
import {
  buildClientFormPageUrl,
  buildProjectCreatePageUrl,
  buildSignedProposalFormPageUrl,
} from '@/lib/workflowNavigation';

export default function ProposalContinueTreatment({
  formStatus,
  clientId = '',
  clientName = '',
  projectId = '',
  projectName = '',
  sourceInquiryId = '',
  proposalSentToClient = false,
  disabled = false,
}) {
  const navigate = useNavigate();
  const isSubmitted = formStatus === 'submitted';
  const canContinue = isSubmitted && !disabled;
  const trimmedClientName = clientName.trim();
  const canOpenSignedProposal = canContinue
    && proposalSentToClient
    && Boolean(projectId?.trim());

  const handleOpenClient = () => {
    if (!canContinue) return;

    if (clientId) {
      navigate(createPageUrl(`ClientDetails?id=${clientId}`));
      return;
    }

    navigate(buildClientFormPageUrl({
      name: trimmedClientName,
      sourceInquiryId: sourceInquiryId || undefined,
    }));
  };

  const handleOpenProject = () => {
    if (!canContinue) return;

    if (projectId) {
      navigate(createPageUrl(`ProjectDetails?id=${projectId}`));
      return;
    }

    navigate(buildProjectCreatePageUrl({
      clientId: clientId || undefined,
      clientName: trimmedClientName,
      projectName: projectName.trim() || trimmedClientName,
      sourceInquiryId: sourceInquiryId || undefined,
    }));
  };

  const signedProposalUrl = buildSignedProposalFormPageUrl({
    projectId: projectId || undefined,
    projectName: projectName.trim(),
    clientName: trimmedClientName,
    sourceInquiryId: sourceInquiryId || undefined,
  });

  return (
    <div className="rounded-md border p-4 space-y-3">
      <h3 className="text-sm font-semibold">המשך טיפול</h3>
      <p className="text-xs text-muted-foreground">
        {canContinue
          ? 'הצעת המחיר הוגשה, ניתן להמשיך טיפול.'
          : 'יש להגיש את הצעת המחיר לפני פתיחת לקוח או פרויקט.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleOpenClient}
          disabled={!canContinue}
        >
          {clientId ? 'פתח לקוח קיים' : 'פתח לקוח'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleOpenProject}
          disabled={!canContinue}
        >
          {projectId ? 'פתח פרויקט קיים' : 'פתח פרויקט'}
        </Button>
        {canOpenSignedProposal ? (
          <Button type="button" variant="outline" asChild>
            <Link to={signedProposalUrl}>פתח הצעה חתומה</Link>
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled>
            פתח הצעה חתומה
          </Button>
        )}
      </div>
      {canContinue && !projectId && (
        <p className="text-xs text-muted-foreground">
          יש לפתוח פרויקט לפני הצעה חתומה.
        </p>
      )}
    </div>
  );
}
