import React, { useEffect, useState } from 'react';
import { api as base44 } from '@/api/apiClient';
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
  const currentStatusLabel = getConstructionStatusLabel(savedStatus);
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
      <CardHeader className="pb-3">
        <CardTitle>סטטוס בנייה / מצב מתקן</CardTitle>
        <CardDescription>
          מעקב נפרד מסטטוס הפרויקט ומשלבי העבודה של אהרון.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">
          <span className="text-muted-foreground">
            {savedStatus === CONSTRUCTION_STATUS_NOT_UPDATED ? 'סטטוס נוכחי: ' : 'שלב נוכחי: '}
          </span>
          <span className="font-medium">{currentStatusLabel}</span>
        </p>

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
