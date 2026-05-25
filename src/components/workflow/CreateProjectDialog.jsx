import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import ProjectClientSection from '@/components/workflow/ProjectClientSection';
import { buildInitialProjectForm } from '@/lib/projectDefaults';
import { assertProjectHasClientId } from '@/lib/projectValidation';
import { runClientReminderRulesForClient } from '@/lib/clientReminderRules';

export default function CreateProjectDialog({
  open,
  onOpenChange,
  initialClientId = '',
  initialClientName = '',
  initialProjectName = '',
  sourceInquiryId = '',
  onProjectCreated,
}) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState(() => buildInitialProjectForm());
  const [isSaving, setIsSaving] = useState(false);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-year'),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => base44.entities.Client.list(),
  });

  useEffect(() => {
    if (!open) return;

    setFormData(buildInitialProjectForm({
      projects,
      prefill: {
        client_id: initialClientId || '',
        name: initialProjectName || initialClientName || '',
        source_inquiry_id: sourceInquiryId || '',
      },
    }));
  }, [open, projects, initialClientId, initialClientName, initialProjectName, sourceInquiryId]);

  const handleProjectClientChange = (update) => {
    setFormData((prev) => ({
      ...prev,
      client_id: update.clientId,
      name: update.fillProjectName && !prev.name?.trim() ? update.clientName : prev.name,
      source_inquiry_id: prev.source_inquiry_id || update.sourceInquiryId || '',
    }));
    queryClient.invalidateQueries({ queryKey: ['clients'] });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!assertProjectHasClientId(formData.client_id)) return;

    const name = formData.name.trim();
    if (!name) {
      alert('יש למלא שם פרויקט');
      return;
    }

    setIsSaving(true);

    try {
      const payload = {
        client_id: formData.client_id,
        bid_number: formData.bid_number.trim(),
        work_number: formData.work_number.trim(),
        name,
        city: formData.city.trim(),
        project_type: formData.project_type.trim(),
        area: formData.area.trim(),
        description: formData.description.trim(),
        status: formData.status,
        total_amount: Number(formData.total_amount) || 0,
        year: Number(formData.year) || new Date().getFullYear(),
        notes: formData.notes.trim(),
        form_status: 'draft',
        collected_amount: 0,
      };

      if (formData.source_inquiry_id?.trim()) {
        payload.source_inquiry_id = formData.source_inquiry_id.trim();
      }

      const project = await base44.entities.Project.create(payload);
      const client = clients.find((item) => item.id === project?.client_id);

      if (client) {
        try {
          await runClientReminderRulesForClient(client);
        } catch (error) {
          console.error('[CreateProjectDialog] failed to run client reminder rules', error);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
      onProjectCreated?.(project, client);
      onOpenChange(false);
    } catch (error) {
      console.error('[CreateProjectDialog] failed to create project', error);
      alert('לא הצלחנו לשמור את הפרויקט');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>הוספת פרויקט חדש</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>מספר BID</Label>
              <Input
                value={formData.bid_number}
                onChange={(e) => setFormData({ ...formData, bid_number: e.target.value })}
                disabled={isSaving}
              />
            </div>
            <div className="space-y-2">
              <Label>מספר עבודה</Label>
              <Input
                value={formData.work_number}
                onChange={(e) => setFormData({ ...formData, work_number: e.target.value })}
                disabled={isSaving}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>שם הפרויקט *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={isSaving}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>עיר</Label>
              <Input
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                disabled={isSaving}
              />
            </div>
          </div>
          <ProjectClientSection
            clientId={formData.client_id}
            clients={clients}
            clientNameHint={initialClientName || formData.name}
            sourceInquiryId={formData.source_inquiry_id || sourceInquiryId}
            onClientChange={handleProjectClientChange}
            disabled={isSaving}
            compact
            createButtonLabel="לקוח חדש"
          />
          <div className="space-y-2">
            <Label>הערות</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={2}
              disabled={isSaving}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              ביטול
            </Button>
            <Button type="submit" disabled={isSaving || !formData.client_id}>
              {isSaving ? 'שומר...' : 'שמור'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
