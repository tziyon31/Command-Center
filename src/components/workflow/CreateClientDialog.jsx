import React, { useEffect, useState } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const EMPTY_FORM = {
  name: '',
  email: '',
  phone: '',
  company: '',
  address: '',
  notes: '',
  rating: 'B',
};

export default function CreateClientDialog({
  open,
  onOpenChange,
  initialName = '',
  sourceInquiryId = '',
  onClientCreated,
}) {
  const [formData, setFormData] = useState({ ...EMPTY_FORM, name: initialName });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFormData({ ...EMPTY_FORM, name: initialName || '' });
  }, [open, initialName]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    const name = formData.name.trim();
    if (!name) {
      alert('יש למלא שם לקוח');
      return;
    }

    setIsSaving(true);

    try {
      const payload = {
        name,
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        company: formData.company.trim(),
        address: formData.address.trim(),
        notes: formData.notes.trim(),
        rating: formData.rating,
        status: 'draft',
      };

      if (sourceInquiryId) {
        payload.source_inquiry_id = sourceInquiryId;
      }

      const client = await base44.entities.Client.create(payload);
      onClientCreated?.(client);
      onOpenChange(false);
    } catch (error) {
      console.error('[CreateClientDialog] failed to create client', error);
      alert('לא הצלחנו לשמור את הלקוח');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>לקוח חדש</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="create-client-name">שם לקוח *</Label>
            <Input
              id="create-client-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="create-client-email">מייל</Label>
              <Input
                id="create-client-email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-client-phone">טלפון</Label>
              <Input
                id="create-client-phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-client-company">שם חברה</Label>
            <Input
              id="create-client-company"
              value={formData.company}
              onChange={(e) => setFormData({ ...formData, company: e.target.value })}
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
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'שומר...' : 'שמור'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
