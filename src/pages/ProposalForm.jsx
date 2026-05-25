import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ArrowRight } from 'lucide-react';
import ProposalContinueTreatment from '@/components/workflow/ProposalContinueTreatment';

const EMPTY_FORM = {
  client_id: '',
  client_name: '',
  project_id: '',
  project_name: '',
  source_inquiry_id: '',
  proposal_sent_to_client: false,
  proposal_sent_at: '',
  client_saw_proposal: false,
  client_saw_at: '',
  document_note: '',
};

const FORM_STATUS_LABELS = {
  draft: 'טיוטה',
  submitted: 'הוגש',
  cancelled: 'בוטל',
};

const DELETE_CONFIRM_MESSAGE = 'למחוק את הצעת המחיר? פעולה זו לא ניתנת לביטול.';

const SUBMIT_VALIDATION_MESSAGE = 'יש למלא שם לקוח ולאשר שהצעת המחיר נשלחה לפני הגשת הטופס';

const readSearchParams = () => {
  const params = new URLSearchParams(window.location.search);

  return {
    id: params.get('id') || '',
    prefill: {
      client_id: params.get('client_id') || '',
      client_name: params.get('client_name') || '',
      project_id: params.get('project_id') || '',
      project_name: params.get('project_name') || '',
      source_inquiry_id: params.get('source_inquiry_id') || '',
    },
  };
};

const toDatetimeLocalValue = (isoValue) => {
  if (!isoValue) return '';

  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const toIsoFromDatetimeLocal = (localValue) => {
  if (!localValue) return '';

  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

const proposalToForm = (record) => ({
  client_id: record?.client_id || '',
  client_name: record?.client_name || '',
  project_id: record?.project_id || '',
  project_name: record?.project_name || '',
  source_inquiry_id: record?.source_inquiry_id || '',
  proposal_sent_to_client: Boolean(record?.proposal_sent_to_client),
  proposal_sent_at: toDatetimeLocalValue(record?.proposal_sent_at),
  client_saw_proposal: Boolean(record?.client_saw_proposal),
  client_saw_at: toDatetimeLocalValue(record?.client_saw_at),
  document_note: record?.document_note || '',
});

const buildDraftPayload = (formData) => ({
  client_id: formData.client_id.trim(),
  client_name: formData.client_name.trim(),
  project_id: formData.project_id.trim(),
  project_name: formData.project_name.trim(),
  source_inquiry_id: formData.source_inquiry_id.trim(),
  proposal_sent_to_client: Boolean(formData.proposal_sent_to_client),
  proposal_sent_at: toIsoFromDatetimeLocal(formData.proposal_sent_at),
  client_saw_proposal: Boolean(formData.client_saw_proposal),
  client_saw_at: toIsoFromDatetimeLocal(formData.client_saw_at),
  document_note: formData.document_note.trim(),
  form_status: 'draft',
});

const canSubmitForm = (formData) => (
  Boolean(formData.client_name?.trim())
  && formData.proposal_sent_to_client === true
);

export default function ProposalForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [{ id: initialId, prefill }] = useState(readSearchParams);

  const [recordId, setRecordId] = useState(initialId);
  const [formData, setFormData] = useState({
    ...EMPTY_FORM,
    ...prefill,
  });
  const [formStatus, setFormStatus] = useState('draft');
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isEditMode = Boolean(recordId);
  const isSubmitted = formStatus === 'submitted';
  const isBusy = isSaving || isSubmitting || isDeleting;

  const { data: record, isLoading: isLoadingRecord } = useQuery({
    queryKey: ['proposal', recordId],
    queryFn: async () => {
      const results = await base44.entities.Proposal.filter({ id: recordId });
      return results?.[0] || null;
    },
    enabled: isEditMode,
  });

  useEffect(() => {
    if (!record) return;

    setFormData(proposalToForm(record));
    setFormStatus(record.form_status || 'draft');
  }, [record]);

  const persistRecord = async (payload) => {
    if (recordId) {
      return base44.entities.Proposal.update(recordId, payload);
    }

    const created = await base44.entities.Proposal.create(payload);
    const newId = created?.id;

    if (newId) {
      setRecordId(newId);
      navigate(createPageUrl(`ProposalForm?id=${newId}`), { replace: true });
    }

    return created;
  };

  const handleSaveDraft = async (event) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      const saved = await persistRecord(buildDraftPayload(formData));
      setFormStatus(saved?.form_status || 'draft');
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['proposal', recordId || saved?.id] });
      alert('הטיוטה נשמרה');
    } catch (error) {
      console.error('[ProposalForm] failed to save draft', error);
      alert('לא הצלחנו לשמור את הטיוטה');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmitForm = async () => {
    if (!canSubmitForm(formData)) {
      alert(SUBMIT_VALIDATION_MESSAGE);
      return;
    }

    setIsSubmitting(true);

    try {
      const now = new Date().toISOString();
      const payload = {
        ...buildDraftPayload(formData),
        proposal_sent_to_client: true,
        proposal_sent_at: toIsoFromDatetimeLocal(formData.proposal_sent_at) || now,
        client_saw_at: formData.client_saw_proposal
          ? (toIsoFromDatetimeLocal(formData.client_saw_at) || now)
          : toIsoFromDatetimeLocal(formData.client_saw_at),
        form_status: 'submitted',
        submitted_at: now,
      };

      const saved = await persistRecord(payload);
      setFormStatus(saved?.form_status || 'submitted');
      setFormData((prev) => ({
        ...prev,
        proposal_sent_to_client: true,
        proposal_sent_at: toDatetimeLocalValue(payload.proposal_sent_at),
        client_saw_at: payload.client_saw_at
          ? toDatetimeLocalValue(payload.client_saw_at)
          : prev.client_saw_at,
      }));
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['proposal', recordId || saved?.id] });
      alert('הטופס הוגש בהצלחה');
    } catch (error) {
      console.error('[ProposalForm] failed to submit form', error);
      alert('הגשת הטופס נכשלה');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!recordId) return;

    const confirmed = window.confirm(DELETE_CONFIRM_MESSAGE);
    if (!confirmed) return;

    setIsDeleting(true);

    try {
      await base44.entities.Proposal.delete(recordId);
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      navigate(createPageUrl('Proposals'));
    } catch (error) {
      console.error('[ProposalForm] failed to delete', error);
      alert('לא הצלחנו למחוק את הצעת המחיר');
    } finally {
      setIsDeleting(false);
    }
  };

  if (isEditMode && isLoadingRecord) {
    return (
      <div className="min-h-screen bg-background p-6" dir="rtl">
        <p className="text-sm text-muted-foreground">טוען הצעת מחיר...</p>
      </div>
    );
  }

  if (isEditMode && !isLoadingRecord && !record) {
    return (
      <div className="min-h-screen bg-background p-6" dir="rtl">
        <div className="max-w-2xl mx-auto space-y-4">
          <p className="text-sm text-muted-foreground">הצעת המחיר לא נמצאה.</p>
          <Button asChild variant="outline">
            <Link to={createPageUrl('Proposals')}>חזרה לרשימת הצעות מחיר</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6" dir="rtl">
      <div className="max-w-2xl mx-auto space-y-6">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to={createPageUrl('Proposals')}>
            <ArrowRight className="w-4 h-4" />
            חזרה לרשימת הצעות מחיר
          </Link>
        </Button>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>{isEditMode ? 'עריכת הצעת מחיר' : 'הצעת מחיר חדשה'}</CardTitle>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-muted-foreground">סטטוס טופס:</span>
              <Badge variant="outline">
                {FORM_STATUS_LABELS[formStatus] || formStatus || 'טיוטה'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveDraft} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="client_name">שם לקוח</Label>
                  <Input
                    id="client_name"
                    value={formData.client_name}
                    onChange={(e) => setFormData({ ...formData, client_name: e.target.value })}
                    disabled={isBusy || isSubmitted}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project_name">שם פרויקט</Label>
                  <Input
                    id="project_name"
                    value={formData.project_name}
                    onChange={(e) => setFormData({ ...formData, project_name: e.target.value })}
                    disabled={isBusy || isSubmitted}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="proposal_sent_to_client"
                  checked={formData.proposal_sent_to_client}
                  onCheckedChange={(checked) => setFormData({
                    ...formData,
                    proposal_sent_to_client: checked === true,
                  })}
                  disabled={isBusy || isSubmitted}
                />
                <Label htmlFor="proposal_sent_to_client" className="cursor-pointer">
                  הצעת המחיר נשלחה ללקוח
                </Label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="proposal_sent_at">תאריך שליחה</Label>
                <Input
                  id="proposal_sent_at"
                  type="datetime-local"
                  value={formData.proposal_sent_at}
                  onChange={(e) => setFormData({ ...formData, proposal_sent_at: e.target.value })}
                  disabled={isBusy || isSubmitted}
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="client_saw_proposal"
                  checked={formData.client_saw_proposal}
                  onCheckedChange={(checked) => setFormData({
                    ...formData,
                    client_saw_proposal: checked === true,
                  })}
                  disabled={isBusy || isSubmitted}
                />
                <Label htmlFor="client_saw_proposal" className="cursor-pointer">
                  הלקוח ראה את ההצעה
                </Label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="client_saw_at">תאריך צפייה / אישור שהלקוח ראה</Label>
                <Input
                  id="client_saw_at"
                  type="datetime-local"
                  value={formData.client_saw_at}
                  onChange={(e) => setFormData({ ...formData, client_saw_at: e.target.value })}
                  disabled={isBusy || isSubmitted}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="document_note">הערה / מספר הצעה / אסמכתא</Label>
                <Textarea
                  id="document_note"
                  value={formData.document_note}
                  onChange={(e) => setFormData({ ...formData, document_note: e.target.value })}
                  rows={3}
                  disabled={isBusy || isSubmitted}
                />
              </div>

              <div className="flex flex-wrap justify-end gap-3 pt-4">
                <Button type="button" variant="outline" asChild disabled={isBusy}>
                  <Link to={createPageUrl('Proposals')}>ביטול</Link>
                </Button>
                {isEditMode && (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={isBusy}
                    onClick={handleDelete}
                  >
                    {isDeleting ? 'מוחק...' : 'מחק'}
                  </Button>
                )}
                <Button type="submit" variant="outline" disabled={isBusy || isSubmitted}>
                  {isSaving ? 'שומר...' : 'שמור טיוטה'}
                </Button>
                <Button
                  type="button"
                  disabled={isBusy || isSubmitted}
                  onClick={handleSubmitForm}
                >
                  {isSubmitting ? 'מגיש...' : 'הגשת טופס'}
                </Button>
              </div>

              <ProposalContinueTreatment
                formStatus={formStatus}
                clientId={formData.client_id}
                clientName={formData.client_name}
                projectId={formData.project_id}
                projectName={formData.project_name}
                sourceInquiryId={formData.source_inquiry_id}
                proposalSentToClient={formData.proposal_sent_to_client}
                disabled={isBusy}
              />
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
