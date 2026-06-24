import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api as base44 } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import ProjectCreateFormFields from '@/components/workflow/ProjectCreateFormFields';
import { buildInitialProjectForm } from '@/lib/projectDefaults';
import { buildProjectCreatePayloadFromForm } from '@/lib/projectCreatePayload';
import { assertProjectHasClientId } from '@/lib/projectValidation';
import { runClientReminderRulesForClient } from '@/lib/clientReminderRules';
import { syncProposalReminderRulesAfterProjectSave } from '@/lib/proposalReminderRules';

export default function CreateProjectDialog({
  open,
  onOpenChange,
  initialClientId = '',
  initialClientName = '',
  initialProjectName = '',
  sourceInquiryId = '',
  onProjectCreated,
  onCreateProject,
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
      const payload = buildProjectCreatePayloadFromForm(formData, {
        sourceInquiryId: formData.source_inquiry_id || sourceInquiryId,
        formStatus: 'draft',
      });

      const project = onCreateProject
        ? await onCreateProject(payload)
        : await base44.entities.Project.create(payload);
      const client = clients.find((item) => item.id === project?.client_id);

      if (client) {
        try {
          await runClientReminderRulesForClient(client);
        } catch (error) {
          console.error('[CreateProjectDialog] failed to run client reminder rules', error);
        }
      }

      try {
        await syncProposalReminderRulesAfterProjectSave(project);
      } catch (error) {
        console.error('[CreateProjectDialog] failed to run P2 proposal reminder rule', error);
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
          <ProjectCreateFormFields
            formData={formData}
            setFormData={setFormData}
            clients={clients}
            disabled={isSaving}
            clientNameHint={initialClientName || formData.name}
            sourceInquiryId={formData.source_inquiry_id || sourceInquiryId}
            onClientChange={handleProjectClientChange}
          />
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
