import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api as base44 } from '@/api/apiClient';
import { Button } from '@/components/ui/button';
import {
  buildProjectCreatePageUrl,
  formatExistingProjectsSuffix,
  getProjectsForClient,
} from '@/lib/workflowNavigation';

export default function ClientContinueToProject({
  clientId,
  clientName,
  sourceInquiryId,
  existingProjects,
  disabled = false,
  statusMessage,
}) {
  const navigate = useNavigate();
  const trimmedName = (clientName || '').trim();
  const canOpenProject = Boolean(clientId) && !disabled;

  const shouldLoadProjects = existingProjects === undefined && Boolean(clientId);

  const { data: allProjects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list(),
    enabled: shouldLoadProjects,
  });

  const projects = shouldLoadProjects
    ? getProjectsForClient(allProjects, {
      clientId,
      clientName: trimmedName,
    })
    : existingProjects;
  const projectsSuffix = canOpenProject
    ? formatExistingProjectsSuffix(projects)
    : '';

  const handleOpenProject = () => {
    if (!clientId) {
      alert('יש לשמור את הלקוח לפני פתיחת פרויקט');
      return;
    }

    navigate(buildProjectCreatePageUrl({
      clientId,
      clientName: trimmedName,
      projectName: trimmedName,
      sourceInquiryId: sourceInquiryId || undefined,
    }));
  };

  return (
    <div className="rounded-md border p-4 space-y-3">
      <h3 className="text-sm font-semibold">המשך טיפול</h3>
      {statusMessage && (
        <p className="text-xs text-muted-foreground">{statusMessage}</p>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={handleOpenProject}
        disabled={!canOpenProject}
      >
        פתח פרויקט ללקוח{projectsSuffix}
      </Button>
    </div>
  );
}
