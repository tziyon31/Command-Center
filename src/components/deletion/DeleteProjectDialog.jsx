import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DELETION_CONFIRM_WORD } from '@/lib/deletionUtils';
import {
  buildProjectDeletionImpact,
  deleteProjectCascade,
} from '@/lib/projectDeletionUtils';

const formatLabels = (labels = [], max = 5) => {
  if (!labels.length) return '';
  const visible = labels.slice(0, max);
  const suffix = labels.length > max ? ` (+${labels.length - max})` : '';
  return `${visible.join(', ')}${suffix}`;
};

function ImpactRow({ label, count, detail }) {
  if (!count) return null;

  return (
    <div className="flex flex-col gap-0.5 border-b pb-2 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <strong>{count}</strong>
      </div>
      {detail ? (
        <span className="text-xs text-muted-foreground">{detail}</span>
      ) : null}
    </div>
  );
}

export default function DeleteProjectDialog({
  projectId,
  open,
  onOpenChange,
  onDeleted,
}) {
  const [impact, setImpact] = useState(null);
  const [isLoadingImpact, setIsLoadingImpact] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    if (!open || !projectId) {
      setImpact(null);
      setLoadError('');
      setConfirmed(false);
      setConfirmText('');
      return;
    }

    let cancelled = false;
    setIsLoadingImpact(true);
    setLoadError('');

    void buildProjectDeletionImpact(projectId)
      .then((result) => {
        if (cancelled) return;
        if (!result.project?.id) {
          setLoadError('הפרויקט לא נמצא');
          return;
        }
        setImpact(result);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[DeleteProjectDialog] failed to load impact', error);
        setLoadError('לא הצלחנו לטעון את פרטי המחיקה');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingImpact(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const canDelete = (
    confirmed
    && confirmText.trim() === DELETION_CONFIRM_WORD
    && !isDeleting
    && !isLoadingImpact
    && !loadError
    && impact?.project?.id
  );

  const handleDelete = async () => {
    if (!canDelete || !projectId) return;

    setIsDeleting(true);
    try {
      await deleteProjectCascade(projectId);
      onOpenChange(false);
      onDeleted?.();
    } catch (error) {
      console.error('[DeleteProjectDialog] cascade delete failed', error);
      alert('מחיקת הפרויקט נכשלה');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" dir="rtl">
        <DialogHeader>
          <DialogTitle>מחיקת פרויקט וכל המידע שתלוי בו</DialogTitle>
        </DialogHeader>

        {isLoadingImpact ? (
          <p className="text-sm text-muted-foreground">טוען השפעת מחיקה...</p>
        ) : loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : (
          <div className="space-y-4 text-sm">
            <p>
              מחיקת הפרויקט תמחק גם את כל הישויות שנבנו עליו. הפעולה תשפיע רק על נתונים
              שמקושרים ישירות לפרויקט הזה לפי project_id.
            </p>

            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <ImpactRow
                label="פרויקט"
                count={impact?.project?.id ? 1 : 0}
                detail={impact?.projectName}
              />
              <ImpactRow
                label="הצעות מחיר"
                count={impact?.counts?.proposals}
                detail={formatLabels(impact?.display?.proposalLabels)}
              />
              <ImpactRow
                label="הצעות חתומות"
                count={impact?.counts?.signedProposals}
                detail={formatLabels(impact?.display?.signedProposalLabels)}
              />
              <ImpactRow
                label="שלבי עבודה"
                count={impact?.counts?.workStages}
                detail={formatLabels(impact?.display?.workStageLabels)}
              />
              <ImpactRow
                label="תהליכי חשבונית"
                count={impact?.counts?.invoiceProcesses}
                detail={formatLabels(impact?.display?.invoiceLabels)}
              />
              <ImpactRow
                label="גביות"
                count={impact?.counts?.collectionDues}
                detail={formatLabels(impact?.display?.collectionDueLabels)}
              />
              <ImpactRow
                label="אירועי גבייה"
                count={impact?.counts?.collectionEvents}
              />
              <ImpactRow
                label="תזכורות פעילות שייסגרו"
                count={impact?.counts?.activeReminders}
              />
            </div>

            <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">
              לקוח ופנייה מקורית לא יימחקו.
            </p>

            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(value) => setConfirmed(value === true)}
              />
              <span>אני מבין שהפעולה תמחק את הפרויקט ואת כל הישויות שתלויות בו</span>
            </label>

            <div className="space-y-2">
              <Label htmlFor="delete-project-confirm-input">
                הקלד
                {' '}
                {DELETION_CONFIRM_WORD}
                {' '}
                לאישור
              </Label>
              <Input
                id="delete-project-confirm-input"
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                placeholder={DELETION_CONFIRM_WORD}
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-start">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
            ביטול
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!canDelete}
            onClick={() => { void handleDelete(); }}
          >
            {isDeleting ? 'מוחק...' : 'מחק פרויקט וכל הנתונים התלויים'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
