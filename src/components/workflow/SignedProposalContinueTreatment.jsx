import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { buildWorkStagesPageUrl } from '@/lib/workflowNavigation';
import { isValidSignedProposalForWorkStages } from '@/lib/signedProposalValidation';

export default function SignedProposalContinueTreatment({
  signedProposal = null,
  formStatus = 'draft',
  projectId = '',
  hasSignedOfferOrOrder = false,
}) {
  const resolvedProjectId = String(projectId || signedProposal?.project_id || '').trim();
  const candidate = {
    ...signedProposal,
    form_status: formStatus,
    project_id: resolvedProjectId,
    has_signed_offer_or_order: hasSignedOfferOrOrder ?? signedProposal?.has_signed_offer_or_order,
  };

  const canConfigureWorkStages = isValidSignedProposalForWorkStages(candidate);

  const workStagesUrl = buildWorkStagesPageUrl({
    projectId: resolvedProjectId,
    signedProposalId: signedProposal?.id || '',
  });

  return (
    <div className="rounded-md border p-4 space-y-3">
      <h3 className="text-sm font-semibold">המשך טיפול</h3>
      {canConfigureWorkStages ? (
        <>
          <p className="text-xs text-muted-foreground">
            ההצעה/ההזמנה החתומה הוגשה. ניתן להגדיר שלבי עבודה לפרויקט.
          </p>
          <Button type="button" variant="outline" asChild>
            <Link to={workStagesUrl}>הגדר שלבי עבודה</Link>
          </Button>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            יש להגיש הצעה/הזמנה חתומה ולשייך פרויקט לפני הגדרת שלבי עבודה.
          </p>
          <Button type="button" variant="outline" disabled>
            הגדר שלבי עבודה
          </Button>
        </>
      )}
    </div>
  );
}
