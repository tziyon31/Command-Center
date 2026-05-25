import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { ArrowRight } from 'lucide-react';
import ClientContinueToProject from '@/components/workflow/ClientContinueToProject';
import { runClientReminderRulesForClient } from '@/lib/clientReminderRules';
import { buildProposalFormPageUrl } from '@/lib/workflowNavigation';

const EMPTY_FORM = {
  name: '',
  email: '',
  phone: '',
  company: '',
  address: '',
  notes: '',
  rating: 'B',
};

const readPrefillFromSearch = () => {
  const params = new URLSearchParams(window.location.search);

  return {
    sourceInquiryId: params.get('source_inquiry_id') || '',
    form: {
      ...EMPTY_FORM,
      name: params.get('name') || '',
    },
  };
};

export default function ClientForm() {
  const navigate = useNavigate();
  const [{ sourceInquiryId, form: initialForm }] = useState(readPrefillFromSearch);
  const [formData, setFormData] = useState(initialForm);
  const [savedClientId, setSavedClientId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

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
      setSavedClientId(client.id);

      try {
        await runClientReminderRulesForClient(client);
      } catch (rulesError) {
        console.error('[ClientForm] failed to run client reminder rules', rulesError);
      }
    } catch (error) {
      console.error('[ClientForm] failed to create client', error);
      alert('לא הצלחנו לשמור את הלקוח');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to={createPageUrl('Clients')}>
            <ArrowRight className="w-4 h-4" />
            חזרה ללקוחות
          </Link>
        </Button>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>לקוח חדש</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">שם לקוח *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company">שם חברה</Label>
                  <Input
                    id="company"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">מייל</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">טלפון</Label>
                  <Input
                    id="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">כתובת</Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rating">דירוג</Label>
                <Select
                  value={formData.rating}
                  onValueChange={(value) => setFormData({ ...formData, rating: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">A - לקוח מצוין</SelectItem>
                    <SelectItem value="B">B - לקוח טוב</SelectItem>
                    <SelectItem value="C">C - לקוח בינוני</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">הערות</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" asChild disabled={isSaving}>
                  <Link to={createPageUrl('Clients')}>ביטול</Link>
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? 'שומר...' : 'שמור'}
                </Button>
              </div>

              <ClientContinueToProject
                clientId={savedClientId}
                clientName={formData.name}
                sourceInquiryId={sourceInquiryId}
                statusMessage={
                  savedClientId
                    ? 'הלקוח נשמר, ניתן להמשיך לפתיחת פרויקט.'
                    : 'יש לשמור את הלקוח לפני פתיחת פרויקט.'
                }
              />

              <div className="rounded-md border p-4 space-y-3">
                <h3 className="text-sm font-semibold">הצעת מחיר</h3>
                <p className="text-xs text-muted-foreground">
                  {savedClientId
                    ? 'ניתן לפתוח טופס הצעת מחיר עם מילוי מקדים.'
                    : 'יש לשמור את הלקוח לפני פתיחת הצעת מחיר.'}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  asChild={Boolean(savedClientId)}
                  disabled={!savedClientId || isSaving}
                >
                  {savedClientId ? (
                    <Link
                      to={buildProposalFormPageUrl({
                        clientId: savedClientId,
                        clientName: formData.name.trim(),
                        sourceInquiryId: sourceInquiryId || undefined,
                      })}
                    >
                      פתח הצעת מחיר
                    </Link>
                  ) : (
                    <span>פתח הצעת מחיר</span>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
