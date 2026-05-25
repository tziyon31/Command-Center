import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { findClientByName } from '@/lib/workflowNavigation';
import CreateClientDialog from '@/components/workflow/CreateClientDialog';

export default function ProjectClientSection({
  clientId,
  clients = [],
  clientNameHint = '',
  sourceInquiryId = '',
  onClientChange,
  disabled = false,
}) {
  const [isCreateClientOpen, setIsCreateClientOpen] = useState(false);
  const linkedClient = clients.find((client) => client.id === clientId);
  const existingByName = !clientId && clientNameHint
    ? findClientByName(clients, clientNameHint)
    : null;

  const handleSelectClient = (selectedClientId) => {
    const client = clients.find((item) => item.id === selectedClientId);
    if (!client) return;

    onClientChange?.({
      clientId: client.id,
      clientName: client.name,
      sourceInquiryId: client.source_inquiry_id || sourceInquiryId || '',
      fillProjectName: true,
    });
  };

  const handleLinkExistingByName = () => {
    if (!existingByName) return;

    onClientChange?.({
      clientId: existingByName.id,
      clientName: existingByName.name,
      sourceInquiryId: existingByName.source_inquiry_id || sourceInquiryId || '',
      fillProjectName: true,
    });
  };

  const handleClientCreated = (client) => {
    onClientChange?.({
      clientId: client.id,
      clientName: client.name,
      sourceInquiryId: client.source_inquiry_id || sourceInquiryId || '',
      fillProjectName: true,
    });
  };

  if (linkedClient) {
    return (
      <div className="rounded-md border p-4 space-y-2">
        <h3 className="text-sm font-semibold">לקוח *</h3>
        <p className="text-sm text-muted-foreground">
          לקוח משויך: {linkedClient.name}
        </p>
        <Select
          value={clientId}
          onValueChange={handleSelectClient}
          disabled={disabled}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className="rounded-md border p-4 space-y-3">
      <h3 className="text-sm font-semibold">לקוח *</h3>
      <p className="text-xs text-muted-foreground">
        יש לבחור לקוח קיים או ליצור לקוח חדש לפני שמירת הפרויקט.
      </p>

      <div className="space-y-2">
        <Label>בחירת לקוח קיים</Label>
        <Select
          value={clientId || undefined}
          onValueChange={handleSelectClient}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="בחר לקוח" />
          </SelectTrigger>
          <SelectContent>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {existingByName && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            נמצא לקוח קיים בשם הזה: {existingByName.name}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleLinkExistingByName}
            disabled={disabled}
          >
            שייך ללקוח
          </Button>
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        onClick={() => setIsCreateClientOpen(true)}
        disabled={disabled}
      >
        צור לקוח חדש
      </Button>

      <CreateClientDialog
        open={isCreateClientOpen}
        onOpenChange={setIsCreateClientOpen}
        initialName={clientNameHint}
        sourceInquiryId={sourceInquiryId}
        onClientCreated={handleClientCreated}
      />
    </div>
  );
}
