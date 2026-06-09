import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CONSTRUCTION_STATUS_NOT_UPDATED,
  CONSTRUCTION_STATUS_OPTIONS,
  getConstructionStatusLabel,
  getConstructionStatusProgress,
  normalizeConstructionStatus,
} from '@/lib/constructionStatusUtils';

const formatDateTime = (value) => {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
};

function MilestoneProgress({ progress }) {
  if (!progress.isUpdated) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">לא עודכן</p>
        <div className="space-y-2">
          {progress.milestones.map((milestone) => (
            <div
              key={milestone.value}
              className="flex items-center gap-3 rounded-md border border-dashed border-slate-200 px-3 py-2 text-sm text-muted-foreground"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs">
                —
              </span>
              <span>{milestone.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {progress.milestones.map((milestone, index) => {
        const isCompleted = progress.currentIndex >= 0 && index < progress.currentIndex;
        const isCurrent = index === progress.currentIndex;

        return (
          <div
            key={milestone.value}
            className={[
              'flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors',
              isCurrent
                ? 'border-primary bg-primary/5 font-semibold text-primary'
                : isCompleted
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-slate-200 bg-slate-50 text-muted-foreground',
            ].join(' ')}
          >
            <span
              className={[
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs',
                isCurrent
                  ? 'bg-primary text-primary-foreground'
                  : isCompleted
                    ? 'bg-emerald-600 text-white'
                    : 'border border-slate-300 bg-white text-slate-400',
              ].join(' ')}
            >
              {isCompleted ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span>{milestone.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function ProjectConstructionStatusSection({ project, onSaved }) {
  const [selectedStatus, setSelectedStatus] = useState(CONSTRUCTION_STATUS_NOT_UPDATED);
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!project) return;

    setSelectedStatus(normalizeConstructionStatus(project.construction_status));
    setNote(project.construction_status_note || '');
  }, [project]);

  if (!project?.id) return null;

  const savedStatus = normalizeConstructionStatus(project.construction_status);
  const displayProgress = getConstructionStatusProgress(savedStatus);
  const updatedAtLabel = formatDateTime(project.construction_status_updated_at);

  const handleSave = async (event) => {
    event.preventDefault();

    if (selectedStatus === CONSTRUCTION_STATUS_NOT_UPDATED) {
      alert('יש לבחור סטטוס בנייה לשמירה');
      return;
    }

    setIsSaving(true);

    try {
      await base44.entities.Project.update(project.id, {
        construction_status: normalizeConstructionStatus(selectedStatus),
        construction_status_note: note.trim(),
        construction_status_updated_at: new Date().toISOString(),
      });

      await onSaved?.();
    } catch (error) {
      console.error('[ProjectConstructionStatus] save failed', error);
      alert('לא הצלחנו לשמור את סטטוס הבנייה');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle>סטטוס בנייה / מצב מתקן</CardTitle>
        <CardDescription>
          מעקב נפרד מסטטוס הפרויקט ומשלבי העבודה של אהרון.
          {' '}
          סטטוס נוכחי:
          {' '}
          <span className="font-medium text-foreground">
            {getConstructionStatusLabel(savedStatus)}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <MilestoneProgress progress={displayProgress} />

        {updatedAtLabel ? (
          <p className="text-xs text-muted-foreground">
            עודכן לאחרונה:
            {' '}
            {updatedAtLabel}
          </p>
        ) : null}

        <form onSubmit={handleSave} className="space-y-4 rounded-lg border bg-slate-50/80 p-4">
          <div className="space-y-2">
            <Label htmlFor="construction-status-select">עדכון סטטוס בנייה</Label>
            <Select
              value={selectedStatus === CONSTRUCTION_STATUS_NOT_UPDATED ? undefined : selectedStatus}
              onValueChange={setSelectedStatus}
              disabled={isSaving}
            >
              <SelectTrigger id="construction-status-select">
                <SelectValue placeholder="בחר סטטוס בנייה" />
              </SelectTrigger>
              <SelectContent>
                {CONSTRUCTION_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="construction-status-note">הערה לסטטוס בנייה</Label>
            <Textarea
              id="construction-status-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              disabled={isSaving}
              placeholder="הערה קצרה על מצב הבנייה / המתקן"
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'שומר...' : 'שמור סטטוס בנייה'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
