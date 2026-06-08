import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import CreateClientDialog from '@/components/workflow/CreateClientDialog';

export default function ProjectCreateFormFields({
  formData,
  setFormData,
  clients = [],
  disabled = false,
  clientNameHint = '',
  sourceInquiryId = '',
  onClientChange,
}) {
  const [isCreateClientOpen, setIsCreateClientOpen] = useState(false);
  const linkedClient = clients.find((client) => client.id === formData.client_id);

  const handleClientSelect = (selectedClientId) => {
    const client = clients.find((item) => item.id === selectedClientId);
    if (!client) return;

    onClientChange?.({
      clientId: client.id,
      clientName: client.name,
      sourceInquiryId: client.source_inquiry_id || sourceInquiryId || '',
      fillProjectName: true,
      createdClient: client,
    });
  };

  const handleNewClientCreated = (client) => {
    onClientChange?.({
      clientId: client.id,
      clientName: client.name,
      sourceInquiryId: client.source_inquiry_id || sourceInquiryId || '',
      fillProjectName: true,
    });
    setIsCreateClientOpen(false);
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>מספר BID</Label>
          <Input
            value={formData.bid_number}
            onChange={(e) => setFormData({ ...formData, bid_number: e.target.value })}
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label>מספר עבודה</Label>
          <Input
            value={formData.work_number}
            onChange={(e) => setFormData({ ...formData, work_number: e.target.value })}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>שם הפרויקט *</Label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            disabled={disabled}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>עיר</Label>
          <Input
            value={formData.city}
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>סוג פרויקט</Label>
          <Input
            value={formData.project_type}
            onChange={(e) => setFormData({ ...formData, project_type: e.target.value })}
            placeholder="מגורים / מסחר / ציבורי..."
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label>שטח / יח&quot;ד</Label>
          <Input
            value={formData.area}
            onChange={(e) => setFormData({ ...formData, area: e.target.value })}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>סטטוס</Label>
          <Select
            value={formData.status}
            onValueChange={(value) => setFormData({ ...formData, status: value })}
            disabled={disabled}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pricing">בתמחור</SelectItem>
              <SelectItem value="waiting">ממתין</SelectItem>
              <SelectItem value="signed">התקבלה</SelectItem>
              <SelectItem value="execution">בעבודה</SelectItem>
              <SelectItem value="completed">בוצע</SelectItem>
              <SelectItem value="cancelled">בוטלה</SelectItem>
              <SelectItem value="rejected">לא התקבלה</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>שכ&quot;ט ₪</Label>
          <Input
            type="number"
            value={formData.total_amount}
            onChange={(e) => setFormData({
              ...formData,
              total_amount: e.target.value,
            })}
            placeholder="לדוגמה: 4000"
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label>שנה</Label>
          <Input
            type="number"
            value={formData.year}
            onChange={(e) => setFormData({
              ...formData,
              year: parseInt(e.target.value, 10) || new Date().getFullYear(),
            })}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="project-client-select">לקוח *</Label>
        {linkedClient && (
          <p className="text-xs text-muted-foreground">
            לקוח משויך: {linkedClient.name}
          </p>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
          <Select
            value={formData.client_id || undefined}
            onValueChange={handleClientSelect}
            disabled={disabled}
          >
            <SelectTrigger id="project-client-select" className="w-full">
              <SelectValue placeholder="בחר לקוח" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 whitespace-nowrap min-w-[5.5rem]"
            onClick={() => setIsCreateClientOpen(true)}
            disabled={disabled}
          >
            לקוח חדש
          </Button>
        </div>
      </div>

      <CreateClientDialog
        open={isCreateClientOpen}
        onOpenChange={setIsCreateClientOpen}
        initialName={clientNameHint || formData.name}
        sourceInquiryId={formData.source_inquiry_id || sourceInquiryId}
        onClientCreated={handleNewClientCreated}
      />

      <div className="space-y-2">
        <Label>הערות</Label>
        <Textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          rows={2}
          disabled={disabled}
        />
      </div>
    </>
  );
}
