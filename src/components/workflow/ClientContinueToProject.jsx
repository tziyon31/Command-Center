import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
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
}) {
  const navigate = useNavigate();
  const trimmedName = (clientName || '').trim();

  const shouldLoadProjects = existingProjects === undefined;

  const { data: allProjects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list(),
    enabled: shouldLoadProjects && Boolean(trimmedName || clientId),
  });

  const projects = shouldLoadProjects
    ? getProjectsForClient(allProjects, {
    clientId,
    clientName: trimmedName,
  })
    : existingProjects;
  const projectsSuffix = formatExistingProjectsSuffix(projects);

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
      <Button type="button" variant="outline" onClick={handleOpenProject}>
        פתח פרויקט ללקוח{projectsSuffix}
      </Button>
    </div>
  );
}
