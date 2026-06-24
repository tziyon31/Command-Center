import React, { useEffect, useState } from 'react';
import { api as base44 } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { buildWorkStagePayloadWithStatus, isWorkStageCompleted } from '@/lib/workStageLogic';
import { getNextWorkStageOrderIndex } from '@/lib/workStageSync';

const EMPTY_FORM = {
  title: '',
  target_date: '',
  invoice_required_on_completion: false,
  notes: '',
  aaron_approved: false,
  client_approved: false,
  draftsman_approved: false,
};

export default function WorkStageDialog({
  open,
  onOpenChange,
  stage = null,
  project = null,
  signedProposalId = '',
  existingStages = [],
  onSaved,
}) {
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    if (stage) {
      setFormData({
        title: stage.title || '',
        target_date: stage.target_date ? String(stage.target_date).split('T')[0] : '',
        invoice_required_on_completion: stage.invoice_required_on_completion === true,
        notes: stage.notes || '',
        aaron_approved: stage.aaron_approved === true,
        client_approved: stage.client_approved === true,
        draftsman_approved: stage.draftsman_approved === true,
      });
      return;
    }

    setFormData(EMPTY_FORM);
  }, [open, stage]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    const title = formData.title.trim();
    if (!title) {
      alert('יש למלא שם שלב');
      return;
    }

    if (!project?.id) {
      alert('חסר פרויקט');
      return;
    }

    setIsSaving(true);

    try {
      const basePayload = {
        title,
        target_date: formData.target_date || '',
        invoice_required_on_completion: formData.invoice_required_on_completion === true,
        notes: formData.notes.trim(),
        aaron_approved: formData.aaron_approved === true,
        client_approved: formData.client_approved === true,
        draftsman_approved: formData.draftsman_approved === true,
        project_id: project.id,
        project_name: project.name || '',
        client_id: project.client_id || '',
        client_name: project.client_name || '',
        signed_proposal_id: signedProposalId || stage?.signed_proposal_id || '',
      };

      let savedStage;

      if (stage?.id) {
        const wasCompleted = isWorkStageCompleted(stage);
        const willBeCompleted = formData.aaron_approved === true
          && formData.client_approved === true
          && formData.draftsman_approved === true;

        if (wasCompleted && !willBeCompleted) {
          const confirmed = window.confirm(
            'ביטול האישור יחזיר את השלב למצב פתוח. אם זה השלב הראשון בסדר שלא הושלם, התזכורות יחזרו אליו. האם להמשיך?',
          );
          if (!confirmed) {
            return;
          }
        }

        const merged = buildWorkStagePayloadWithStatus(
          { ...stage, ...basePayload },
          existingStages,
        );
        savedStage = await base44.entities.WorkStage.update(stage.id, {
          ...basePayload,
          status: merged.status,
          completed_at: merged.completed_at || '',
        });
      } else {
        const orderIndex = await getNextWorkStageOrderIndex(project.id);
        savedStage = await base44.entities.WorkStage.create({
          ...basePayload,
          order_index: orderIndex,
          status: 'pending',
          completed_at: '',
        });
      }

      await onSaved?.(savedStage);
      onOpenChange(false);
    } catch (error) {
      console.error('[WorkStageDialog] failed to save work stage', error);
      alert('שמירת שלב העבודה נכשלה');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{stage ? 'עריכת שלב עבודה' : 'הוספת שלב עבודה'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="work-stage-title">שם השלב</Label>
            <Input
              id="work-stage-title"
              value={formData.title}
              onChange={(event) => setFormData((current) => ({
                ...current,
                title: event.target.value,
              }))}
              disabled={isSaving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="work-stage-target-date">תאריך יעד</Label>
            <Input
              id="work-stage-target-date"
              type="date"
              value={formData.target_date}
              onChange={(event) => setFormData((current) => ({
                ...current,
                target_date: event.target.value,
              }))}
              disabled={isSaving}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="work-stage-invoice-required"
              checked={formData.invoice_required_on_completion}
              onCheckedChange={(checked) => setFormData((current) => ({
                ...current,
                invoice_required_on_completion: checked === true,
              }))}
              disabled={isSaving}
            />
            <Label htmlFor="work-stage-invoice-required" className="cursor-pointer">
              נדרשת חשבונית בסיום השלב
            </Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="work-stage-notes">הערות</Label>
            <Textarea
              id="work-stage-notes"
              value={formData.notes}
              onChange={(event) => setFormData((current) => ({
                ...current,
                notes: event.target.value,
              }))}
              rows={3}
              disabled={isSaving}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={formData.aaron_approved}
                onCheckedChange={(checked) => setFormData((current) => ({
                  ...current,
                  aaron_approved: checked === true,
                }))}
                disabled={isSaving}
              />
              אישור אהרון
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={formData.client_approved}
                onCheckedChange={(checked) => setFormData((current) => ({
                  ...current,
                  client_approved: checked === true,
                }))}
                disabled={isSaving}
              />
              אישור לקוח
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={formData.draftsman_approved}
                onCheckedChange={(checked) => setFormData((current) => ({
                  ...current,
                  draftsman_approved: checked === true,
                }))}
                disabled={isSaving}
              />
              אישור שרטט
            </label>
          </div>

          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              ביטול
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'שומר...' : 'שמור'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
