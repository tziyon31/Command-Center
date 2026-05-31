import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { buildWorkStagesPageUrl } from '@/lib/workflowNavigation';
import { isValidSignedProposal } from '@/lib/signedProposalValidation';

export default function SignedProposalContinueTreatment({
  signedProposal = null,
  formStatus = 'draft',
  projectId = '',
  hasSignedOfferOrOrder = false,
}) {
  const canConfigureWorkStages = isValidSignedProposal({
    ...signedProposal,
    form_status: formStatus,
    project_id: projectId || signedProposal?.project_id,
    has_signed_offer_or_order: hasSignedOfferOrOrder ?? signedProposal?.has_signed_offer_or_order,
  });

  if (!canConfigureWorkStages) {
    return null;
  }

  const resolvedProjectId = String(projectId || signedProposal?.project_id || '').trim();
  const workStagesUrl = buildWorkStagesPageUrl({
    projectId: resolvedProjectId,
    signedProposalId: signedProposal?.id,
  });

  return (
    <div className="rounded-md border p-4 space-y-3">
      <h3 className="text-sm font-semibold">המשך טיפול</h3>
      <p className="text-xs text-muted-foreground">
        ההצעה/ההזמנה החתומה הוגשה. ניתן להגדיר שלבי עבודה לפרויקט.
      </p>
      <Button type="button" variant="outline" asChild>
        <Link to={workStagesUrl}>הגדר שלבי עבודה</Link>
      </Button>
    </div>
  );
}
