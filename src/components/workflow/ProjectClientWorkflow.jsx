import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  buildClientFormPageUrl,
  findClientByName,
} from '@/lib/workflowNavigation';

export default function ProjectClientWorkflow({
  clientId,
  clientName,
  sourceInquiryId,
  clients = [],
}) {
  const navigate = useNavigate();
  const trimmedClientName = (clientName || '').trim();

  if (clientId) {
    const linkedClient = clients.find((client) => client.id === clientId);

    return (
      <div className="rounded-md border p-4 space-y-2">
        <h3 className="text-sm font-semibold">לקוח</h3>
        <p className="text-sm text-muted-foreground">
          לקוח משויך{linkedClient?.name ? `: ${linkedClient.name}` : ''}
        </p>
      </div>
    );
  }

  if (!trimmedClientName) {
    return null;
  }

  const existingClient = findClientByName(clients, trimmedClientName);

  const handleOpenClientForm = () => {
    if (!trimmedClientName) {
      alert('יש למלא שם לקוח לפני פתיחת טופס לקוח');
      return;
    }

    navigate(buildClientFormPageUrl({
      name: trimmedClientName,
      sourceInquiryId: sourceInquiryId || undefined,
    }));
  };

  return (
    <div className="rounded-md border p-4 space-y-3">
      <h3 className="text-sm font-semibold">לקוח</h3>
      {existingClient ? (
        <p className="text-sm text-muted-foreground">
          נמצא לקוח קיים בשם הזה
        </p>
      ) : (
        <Button type="button" variant="outline" onClick={handleOpenClientForm}>
          פתח טופס לקוח
        </Button>
      )}
    </div>
  );
}
