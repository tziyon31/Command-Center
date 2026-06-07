import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { buildWorkProcessDeletionImpact, deleteWorkProcessForProject } from '@/lib/workProcessDeletionUtils';

export default function DeleteWorkProcessDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
  onDeleted,
}) {
  const [impact, setImpact] = useState(null);
  const [isLoadingImpact, setIsLoadingImpact] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!open || !projectId) {
      setImpact(null);
      setLoadError('');
      setConfirmed(false);
      return;
    }

    let cancelled = false;
    setIsLoadingImpact(true);
    setLoadError('');

    void buildWorkProcessDeletionImpact(projectId)
      .then((result) => {
        if (cancelled) return;
        setImpact(result);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[DeleteWorkProcessDialog] failed to load impact', error);
        setLoadError('לא הצלחנו לטעון את פרטי תהליך העבודה למחיקה');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingImpact(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const handleDelete = async () => {
    if (!projectId || !confirmed || isDeleting) return;

    setIsDeleting(true);
    try {
      await deleteWorkProcessForProject(projectId);
      onOpenChange(false);
      onDeleted?.();
    } catch (error) {
      console.error('[DeleteWorkProcessDialog] delete failed', error);
      alert('מחיקת תהליך העבודה נכשלה');
    } finally {
      setIsDeleting(false);
    }
  };

  const displayName = impact?.projectName || projectName || 'פרויקט';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>מחיקת תהליך עבודה</DialogTitle>
        </DialogHeader>

        {isLoadingImpact ? (
          <p className="text-sm text-muted-foreground">טוען פרטי מחיקה...</p>
        ) : loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : (
          <div className="space-y-4 text-sm">
            <p>
              פעולה זו תמחק את כל שלבי העבודה של הפרויקט:
              {' '}
              <strong>{displayName}</strong>
            </p>

            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <p>
                מספר שלבים:
                {' '}
                <strong>{impact?.counts?.totalStages ?? 0}</strong>
              </p>
              <p>
                שלבים שהושלמו:
                {' '}
                <strong>{impact?.counts?.completedStages ?? 0}</strong>
              </p>
              <p>
                תזכורות פעילות שייסגרו:
                {' '}
                <strong>{impact?.counts?.activeReminders ?? 0}</strong>
              </p>
            </div>

            {impact?.workStages?.length ? (
              <div className="space-y-1">
                <p className="font-medium">שלבים שיימחקו:</p>
                <ul className="list-disc pr-5 space-y-1 text-muted-foreground">
                  {impact.workStages.map((stage) => (
                    <li key={stage.id}>{stage.title || 'שלב ללא שם'}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-muted-foreground">לא נמצאו שלבי עבודה למחיקה.</p>
            )}

            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox
                checked={confirmed}
                onCheckedChange={(value) => setConfirmed(value === true)}
              />
              <span>אני מבין שכל שלבי העבודה של הפרויקט יימחקו</span>
            </label>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-start">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
            ביטול
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!confirmed || isDeleting || isLoadingImpact || Boolean(loadError) || !impact?.workStages?.length}
            onClick={() => { void handleDelete(); }}
          >
            {isDeleting ? 'מוחק...' : 'מחק תהליך עבודה'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteWorkProcessTriggerButton({ onClick, disabled }) {
  return (
    <Button
      type="button"
      size="sm"
      variant="destructive"
      className="gap-1"
      disabled={disabled}
      onClick={onClick}
    >
      <Trash2 className="w-3.5 h-3.5" />
      מחק תהליך עבודה
    </Button>
  );
}
