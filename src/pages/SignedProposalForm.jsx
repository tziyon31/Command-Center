import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { cancelRemindersForDeletedSource } from '@/lib/reminderEngine';
import { syncSignedProposalReminderRules } from '@/lib/proposalReminderRules';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowRight } from 'lucide-react';
import CreateClientDialog from '@/components/workflow/CreateClientDialog';
import CreateProjectDialog from '@/components/workflow/CreateProjectDialog';
import { formatProjectSelectLabel } from '@/lib/projectSelectLabel';

const EMPTY_FORM = {
  proposal_id: '',
  client_id: '',
  project_id: '',
  project_name: '',
  client_name: '',
  has_signed_offer_or_order: false,
  signed_at: '',
  document_note: '',
  source_inquiry_id: '',
};

const FORM_STATUS_LABELS = {
  draft: 'טיוטה',
  submitted: 'הוגש',
  cancelled: 'בוטל',
};

const DELETE_CONFIRM_MESSAGE = 'למחוק את ההצעה החתומה? פעולה זו לא ניתנת לביטול.';

const SUBMIT_VALIDATION_MESSAGE = 'יש לבחור פרויקט ולאשר שיש הצעה או הזמנה חתומה לפני הגשת הטופס';

const readSearchParams = () => {
  const params = new URLSearchParams(window.location.search);

  return {
    id: params.get('id') || '',
    prefill: {
      proposal_id: params.get('proposal_id') || '',
      client_id: params.get('client_id') || '',
      project_id: params.get('project_id') || '',
      project_name: params.get('project_name') || '',
      client_name: params.get('client_name') || '',
      source_inquiry_id: params.get('source_inquiry_id') || '',
      document_note: params.get('document_note') || '',
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

const signedProposalToForm = (record) => ({
  proposal_id: record?.proposal_id || '',
  client_id: record?.client_id || '',
  project_id: record?.project_id || '',
  project_name: record?.project_name || '',
  client_name: record?.client_name || '',
  has_signed_offer_or_order: Boolean(record?.has_signed_offer_or_order),
  signed_at: toDatetimeLocalValue(record?.signed_at),
  document_note: record?.document_note || '',
  source_inquiry_id: record?.source_inquiry_id || '',
});

const buildDraftPayload = (formData) => ({
  proposal_id: formData.proposal_id.trim(),
  client_id: formData.client_id.trim(),
  project_id: formData.project_id.trim(),
  project_name: formData.project_name.trim(),
  client_name: formData.client_name.trim(),
  has_signed_offer_or_order: Boolean(formData.has_signed_offer_or_order),
  signed_at: toIsoFromDatetimeLocal(formData.signed_at),
  document_note: formData.document_note.trim(),
  form_status: 'draft',
  source_inquiry_id: formData.source_inquiry_id.trim(),
});

const canSubmitForm = (formData) => (
  Boolean(formData.project_id?.trim())
  && Boolean(formData.project_name?.trim())
  && Boolean(formData.client_name?.trim())
  && formData.has_signed_offer_or_order === true
);

export default function SignedProposalForm() {
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
  const [isCreateClientOpen, setIsCreateClientOpen] = useState(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);

  const isEditMode = Boolean(recordId);
  const isSubmitted = formStatus === 'submitted';
  const isBusy = isSaving || isSubmitting || isDeleting;
  const [submittedAt, setSubmittedAt] = useState('');

  const { data: record, isLoading: isLoadingRecord } = useQuery({
    queryKey: ['signed-proposal', recordId],
    queryFn: async () => {
      const results = await base44.entities.SignedProposal.filter({ id: recordId });
      return results?.[0] || null;
    },
    enabled: isEditMode,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-created_date'),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => base44.entities.Client.list(),
  });

  const selectedProjectLabel = React.useMemo(() => {
    if (!formData.project_id) return null;
    const project = projects.find((item) => item.id === formData.project_id);
    return project ? formatProjectSelectLabel(project) : (formData.project_name || null);
  }, [projects, formData.project_id, formData.project_name]);

  const filteredProjects = React.useMemo(() => {
    if (!formData.client_id) return projects;
    return projects.filter((project) => project.client_id === formData.client_id);
  }, [projects, formData.client_id]);

  useEffect(() => {
    if (!record) return;

    setFormData(signedProposalToForm(record));
    setFormStatus(record.form_status || 'draft');
    setSubmittedAt(record.submitted_at || '');
  }, [record]);

  const applyProjectSelection = (projectId) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;

    const linkedClient = clients.find((client) => client.id === project.client_id);

    setFormData((prev) => ({
      ...prev,
      project_id: project.id,
      project_name: project.name || prev.project_name,
      client_id: project.client_id || prev.client_id,
      client_name: linkedClient?.name || prev.client_name,
      source_inquiry_id: prev.source_inquiry_id || project.source_inquiry_id || '',
    }));
  };

  const handleClientSelect = (selectedClientId) => {
    const client = clients.find((item) => item.id === selectedClientId);
    if (!client) return;

    setFormData((prev) => ({
      ...prev,
      client_id: client.id,
      client_name: client.name,
      project_id: '',
      project_name: '',
      source_inquiry_id: prev.source_inquiry_id || client.source_inquiry_id || '',
    }));
  };

  const handleNewClientCreated = async (client) => {
    setFormData((prev) => ({
      ...prev,
      client_id: client.id,
      client_name: client.name,
      project_id: '',
      project_name: '',
      source_inquiry_id: prev.source_inquiry_id || client.source_inquiry_id || '',
    }));

    await queryClient.invalidateQueries({ queryKey: ['clients'] });
    await queryClient.invalidateQueries({ queryKey: ['client-details', client.id] });
    await queryClient.invalidateQueries({ queryKey: ['signed-proposals'] });
    setIsCreateClientOpen(false);
  };

  const handleNewProjectCreated = async (project, client) => {
    setFormData((prev) => ({
      ...prev,
      project_id: project.id,
      project_name: project.name || '',
      client_id: project.client_id || prev.client_id,
      client_name: client?.name || prev.client_name,
      source_inquiry_id: prev.source_inquiry_id || project.source_inquiry_id || client?.source_inquiry_id || '',
    }));

    await queryClient.invalidateQueries({ queryKey: ['projects'] });
    await queryClient.invalidateQueries({ queryKey: ['project', project.id] });
    await queryClient.invalidateQueries({ queryKey: ['project-details', project.id] });
    await queryClient.invalidateQueries({ queryKey: ['signed-proposals'] });
    setIsCreateProjectOpen(false);
  };

  const persistRecord = async (payload) => {
    if (recordId) {
      return base44.entities.SignedProposal.update(recordId, payload);
    }

    const created = await base44.entities.SignedProposal.create(payload);
    const newId = created?.id;

    if (newId) {
      setRecordId(newId);
      navigate(createPageUrl(`SignedProposalForm?id=${newId}`), { replace: true });
    }

    return created;
  };

  const syncSignedProposalReminders = async (savedRecord) => {
    try {
      await syncSignedProposalReminderRules(savedRecord);
      await queryClient.invalidateQueries({ queryKey: ['reminders'] });
      await queryClient.invalidateQueries({ queryKey: ['reminders', 'visible'] });
    } catch (error) {
      console.error('[SignedProposalForm] failed to sync signed-proposal reminder rules', error);
    }
  };

  const buildSubmittedUpdatePayload = () => ({
    ...buildDraftPayload(formData),
    has_signed_offer_or_order: Boolean(formData.has_signed_offer_or_order),
    form_status: 'submitted',
    submitted_at: submittedAt || record?.submitted_at || nowIso(),
    signed_at: toIsoFromDatetimeLocal(formData.signed_at) || record?.signed_at || nowIso(),
  });

  const nowIso = () => new Date().toISOString();

  const handleSaveDraft = async (event) => {
    event.preventDefault();
    if (isSubmitted) {
      setIsSaving(true);

      try {
        const saved = await persistRecord(buildSubmittedUpdatePayload());
        if (saved?.id && saved?.project_id) {
          await base44.entities.Project.update(saved.project_id, {
            source_signed_proposal_id: saved.id,
          });
        }
        setFormStatus(saved?.form_status || 'submitted');
        setSubmittedAt(saved?.submitted_at || submittedAt || '');
        queryClient.invalidateQueries({ queryKey: ['signed-proposals'] });
        queryClient.invalidateQueries({ queryKey: ['signed-proposal', recordId || saved?.id] });
        queryClient.invalidateQueries({ queryKey: ['projects'] });
        queryClient.invalidateQueries({ queryKey: ['proposals'] });
        await syncSignedProposalReminders(saved);
        alert('השינויים נשמרו');
      } catch (error) {
        console.error('[SignedProposalForm] failed to save submitted changes', error);
        alert('לא הצלחנו לשמור את השינויים');
      } finally {
        setIsSaving(false);
      }
      return;
    }

    setIsSaving(true);

    try {
      const saved = await persistRecord(buildDraftPayload(formData));
      setFormStatus(saved?.form_status || 'draft');
      queryClient.invalidateQueries({ queryKey: ['signed-proposals'] });
      queryClient.invalidateQueries({ queryKey: ['signed-proposal', recordId || saved?.id] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      await syncSignedProposalReminders(saved);
      alert('הטיוטה נשמרה');
    } catch (error) {
      console.error('[SignedProposalForm] failed to save draft', error);
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
        has_signed_offer_or_order: true,
        form_status: 'submitted',
        submitted_at: submittedAt || now,
        signed_at: toIsoFromDatetimeLocal(formData.signed_at) || now,
      };

      const saved = await persistRecord(payload);
      if (saved?.id && saved?.project_id) {
        await base44.entities.Project.update(saved.project_id, {
          source_signed_proposal_id: saved.id,
        });
      }
      setFormStatus(saved?.form_status || 'submitted');
      setSubmittedAt(saved?.submitted_at || payload.submitted_at || '');
      setFormData((prev) => ({
        ...prev,
        signed_at: toDatetimeLocalValue(payload.signed_at),
        has_signed_offer_or_order: true,
      }));
      queryClient.invalidateQueries({ queryKey: ['signed-proposals'] });
      queryClient.invalidateQueries({ queryKey: ['signed-proposal', recordId || saved?.id] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['project', saved?.project_id || formData.project_id] });
      queryClient.invalidateQueries({ queryKey: ['project-details', saved?.project_id || formData.project_id] });
      await syncSignedProposalReminders(saved);
      alert('הטופס הוגש בהצלחה');
    } catch (error) {
      console.error('[SignedProposalForm] failed to submit form', error);
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
      await base44.entities.SignedProposal.delete(recordId);
      await cancelRemindersForDeletedSource('signed_proposal', recordId);
      queryClient.invalidateQueries({ queryKey: ['signed-proposals'] });
      navigate(createPageUrl('SignedProposals'));
    } catch (error) {
      console.error('[SignedProposalForm] failed to delete', error);
      alert('לא הצלחנו למחוק את ההצעה החתומה');
    } finally {
      setIsDeleting(false);
    }
  };

  if (isEditMode && isLoadingRecord) {
    return (
      <div className="min-h-screen bg-background p-6" dir="rtl">
        <p className="text-sm text-muted-foreground">טוען הצעה חתומה...</p>
      </div>
    );
  }

  if (isEditMode && !isLoadingRecord && !record) {
    return (
      <div className="min-h-screen bg-background p-6" dir="rtl">
        <div className="max-w-2xl mx-auto space-y-4">
          <p className="text-sm text-muted-foreground">ההצעה החתומה לא נמצאה.</p>
          <Button asChild variant="outline">
            <Link to={createPageUrl('SignedProposals')}>חזרה לרשימת הצעות חתומות</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6" dir="rtl">
      <div className="max-w-2xl mx-auto space-y-6">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to={createPageUrl('SignedProposals')}>
            <ArrowRight className="w-4 h-4" />
            חזרה לרשימת הצעות חתומות
          </Link>
        </Button>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>{isEditMode ? 'עריכת הצעה חתומה' : 'הצעה חתומה חדשה'}</CardTitle>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-muted-foreground">סטטוס טופס:</span>
              <Badge variant="outline">
                {FORM_STATUS_LABELS[formStatus] || formStatus || 'טיוטה'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveDraft} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signed-client-select">לקוח</Label>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
                  <Select
                    value={formData.client_id || undefined}
                    onValueChange={handleClientSelect}
                    disabled={isBusy}
                  >
                    <SelectTrigger id="signed-client-select">
                      <SelectValue placeholder="בחר לקוח קיים" />
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
                    className="shrink-0 whitespace-nowrap"
                    onClick={() => setIsCreateClientOpen(true)}
                    disabled={isBusy}
                  >
                    לקוח חדש
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="project-select">פרויקט</Label>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
                <Select
                  value={formData.project_id || undefined}
                  onValueChange={applyProjectSelection}
                  disabled={isBusy}
                >
                  <SelectTrigger id="project-select">
                    <SelectValue placeholder={formData.client_id ? 'בחר פרויקט של הלקוח' : 'בחר פרויקט'}>
                      {selectedProjectLabel}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {filteredProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {formatProjectSelectLabel(project)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 whitespace-nowrap"
                  onClick={() => {
                    if (!formData.client_id?.trim()) {
                      alert('יש לבחור או ליצור לקוח לפני יצירת פרויקט');
                      return;
                    }
                    setIsCreateProjectOpen(true);
                  }}
                  disabled={isBusy}
                >
                  פרויקט חדש
                </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="project_name">שם פרויקט</Label>
                  <Input
                    id="project_name"
                    value={formData.project_name}
                    onChange={(e) => setFormData({ ...formData, project_name: e.target.value })}
                    disabled={isBusy}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client_name">שם לקוח</Label>
                  <Input
                    id="client_name"
                    value={formData.client_name}
                    onChange={(e) => setFormData({ ...formData, client_name: e.target.value })}
                    disabled={isBusy}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="has_signed_offer_or_order"
                  checked={formData.has_signed_offer_or_order}
                  onCheckedChange={(checked) => setFormData({
                    ...formData,
                    has_signed_offer_or_order: checked === true,
                  })}
                  disabled={isBusy}
                />
                <Label htmlFor="has_signed_offer_or_order" className="cursor-pointer">
                  יש הצעה או הזמנה חתומה
                </Label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="signed_at">תאריך חתימה</Label>
                <Input
                  id="signed_at"
                  type="datetime-local"
                  value={formData.signed_at}
                  onChange={(e) => setFormData({ ...formData, signed_at: e.target.value })}
                  disabled={isBusy}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="document_note">הערה / אסמכתא / מספר מסמך</Label>
                <Textarea
                  id="document_note"
                  value={formData.document_note}
                  onChange={(e) => setFormData({ ...formData, document_note: e.target.value })}
                  rows={3}
                  disabled={isBusy}
                />
              </div>

              <div className="flex flex-wrap justify-end gap-3 pt-4">
                <Button type="button" variant="outline" asChild disabled={isBusy}>
                  <Link to={createPageUrl('SignedProposals')}>ביטול</Link>
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
                <Button type="submit" variant="outline" disabled={isBusy}>
                  {isSaving ? 'שומר...' : (isSubmitted ? 'שמור שינויים' : 'שמור טיוטה')}
                </Button>
                <Button
                  type="button"
                  disabled={isBusy || isSubmitted}
                  onClick={handleSubmitForm}
                >
                  {isSubmitting ? 'מגיש...' : 'הגשת טופס'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
      <CreateClientDialog
        open={isCreateClientOpen}
        onOpenChange={setIsCreateClientOpen}
        initialName={formData.client_name}
        sourceInquiryId={formData.source_inquiry_id}
        onClientCreated={handleNewClientCreated}
      />

      <CreateProjectDialog
        open={isCreateProjectOpen}
        onOpenChange={setIsCreateProjectOpen}
        initialClientId={formData.client_id}
        initialClientName={formData.client_name}
        initialProjectName={formData.project_name || formData.client_name}
        sourceInquiryId={formData.source_inquiry_id}
        onProjectCreated={handleNewProjectCreated}
        onCreateProject={async (payload) => {
          const projectPayload = {
            ...payload,
            client_name: formData.client_name || '',
          };
          if (recordId) {
            projectPayload.source_signed_proposal_id = recordId;
          }
          return base44.entities.Project.create(projectPayload);
        }}
      />
    </div>
  );
}
