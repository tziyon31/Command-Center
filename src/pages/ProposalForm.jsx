import React, { useEffect, useMemo, useState } from 'react';
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
import ProposalOpenSignedProposal from '@/components/workflow/ProposalOpenSignedProposal';
import { formatProjectSelectLabel } from '@/lib/projectSelectLabel';
import {
  runProposalReminderRulesForProposal,
  syncProposalReminderRulesAfterProjectSave,
} from '@/lib/proposalReminderRules';
import { cancelRemindersForDeletedSource } from '@/lib/reminderEngine';

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

const SUBMIT_VALIDATION_MESSAGE = 'יש למלא שם לקוח לפני הגשת הטופס';

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

const canSubmitForm = (formData) => Boolean(formData.client_name?.trim());

const buildSubmittedUpdatePayload = (formData, submittedAt = '') => {
  const now = new Date().toISOString();

  return {
    client_id: formData.client_id.trim(),
    client_name: formData.client_name.trim(),
    project_id: formData.project_id.trim(),
    project_name: formData.project_name.trim(),
    source_inquiry_id: formData.source_inquiry_id.trim(),
    proposal_sent_to_client: Boolean(formData.proposal_sent_to_client),
    proposal_sent_at: formData.proposal_sent_to_client
      ? (toIsoFromDatetimeLocal(formData.proposal_sent_at) || now)
      : '',
    client_saw_proposal: Boolean(formData.client_saw_proposal),
    client_saw_at: formData.client_saw_proposal
      ? (toIsoFromDatetimeLocal(formData.client_saw_at) || now)
      : '',
    document_note: formData.document_note.trim(),
    form_status: 'submitted',
    submitted_at: submittedAt,
  };
};

const buildSubmitPayload = (formData) => {
  const now = new Date().toISOString();

  return {
    client_id: formData.client_id.trim(),
    client_name: formData.client_name.trim(),
    project_id: formData.project_id.trim(),
    project_name: formData.project_name.trim(),
    source_inquiry_id: formData.source_inquiry_id.trim(),
    proposal_sent_to_client: Boolean(formData.proposal_sent_to_client),
    proposal_sent_at: formData.proposal_sent_to_client
      ? (toIsoFromDatetimeLocal(formData.proposal_sent_at) || now)
      : '',
    client_saw_proposal: Boolean(formData.client_saw_proposal),
    client_saw_at: formData.client_saw_proposal
      ? (toIsoFromDatetimeLocal(formData.client_saw_at) || now)
      : '',
    document_note: formData.document_note.trim(),
    form_status: 'submitted',
    submitted_at: now,
  };
};

const applySourceInquiryId = (currentValue, nextValue) => (
  currentValue?.trim() ? currentValue : (nextValue || '')
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
  const [submittedAt, setSubmittedAt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreateClientOpen, setIsCreateClientOpen] = useState(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);

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

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => base44.entities.Client.list(),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-created_date'),
  });

  useEffect(() => {
    if (!record) return;

    setFormData(proposalToForm(record));
    setFormStatus(record.form_status || 'draft');
    setSubmittedAt(record.submitted_at || '');
  }, [record]);

  const filteredProjects = useMemo(() => {
    const list = Array.isArray(projects) ? projects : [];
    if (!formData.client_id) return list;

    return list.filter((project) => project.client_id === formData.client_id);
  }, [projects, formData.client_id]);

  const selectedProjectLabel = useMemo(() => {
    if (!formData.project_id) return null;

    const list = Array.isArray(projects) ? projects : [];
    const project = list.find((item) => item.id === formData.project_id);
    if (project) return formatProjectSelectLabel(project);

    return formData.project_name?.trim() || null;
  }, [projects, formData.project_id, formData.project_name]);

  const clearProjectIfNotForClient = (prev, clientId) => {
    if (!prev.project_id) return prev;

    const list = Array.isArray(projects) ? projects : [];
    const selectedProject = list.find((project) => project.id === prev.project_id);
    if (selectedProject && selectedProject.client_id === clientId) return prev;

    return {
      ...prev,
      project_id: '',
      project_name: '',
    };
  };

  const syncProposalReminders = async (saved) => {
    if (!saved?.id) return;

    try {
      await runProposalReminderRulesForProposal(saved);
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
    } catch (error) {
      console.error('[ProposalForm] failed to sync proposal reminder rules', error);
    }
  };

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

  const handleClientSelect = (selectedClientId) => {
    const client = clients.find((item) => item.id === selectedClientId);
    if (!client) return;

    setFormData((prev) => clearProjectIfNotForClient({
      ...prev,
      client_id: client.id,
      client_name: client.name,
      source_inquiry_id: applySourceInquiryId(prev.source_inquiry_id, client.source_inquiry_id),
    }, client.id));
  };

  const handleNewClientCreated = (client) => {
    setFormData((prev) => clearProjectIfNotForClient({
      ...prev,
      client_id: client.id,
      client_name: client.name,
      source_inquiry_id: applySourceInquiryId(prev.source_inquiry_id, client.source_inquiry_id),
    }, client.id));
    queryClient.invalidateQueries({ queryKey: ['clients'] });
    setIsCreateClientOpen(false);
  };

  const handleProjectSelect = (selectedProjectId) => {
    const project = projects.find((item) => item.id === selectedProjectId);
    if (!project) return;

    const linkedClient = clients.find((client) => client.id === project.client_id);

    setFormData((prev) => ({
      ...prev,
      project_id: project.id,
      project_name: project.name || '',
      client_id: project.client_id || prev.client_id,
      client_name: linkedClient?.name || prev.client_name,
      source_inquiry_id: applySourceInquiryId(
        prev.source_inquiry_id,
        project.source_inquiry_id || linkedClient?.source_inquiry_id,
      ),
    }));
  };

  const handleNewProjectCreated = async (project, client) => {
    await queryClient.invalidateQueries({ queryKey: ['projects'] });

    try {
      await syncProposalReminderRulesAfterProjectSave(project);
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
    } catch (error) {
      console.error('[ProposalForm] failed to run P2 proposal reminder rule for new project', error);
    }

    setFormData((prev) => ({
      ...prev,
      project_id: project.id,
      project_name: project.name || '',
      client_id: project.client_id || prev.client_id,
      client_name: client?.name || prev.client_name,
      source_inquiry_id: applySourceInquiryId(
        prev.source_inquiry_id,
        project.source_inquiry_id || client?.source_inquiry_id,
      ),
    }));
    setIsCreateProjectOpen(false);
  };

  const handleFormSubmit = async (event) => {
    event.preventDefault();

    if (isSubmitted) {
      await handleSaveSubmittedChanges();
      return;
    }

    await handleSaveDraft();
  };

  const handleSaveDraft = async () => {
    setIsSaving(true);

    try {
      const saved = await persistRecord(buildDraftPayload(formData));
      setFormStatus(saved?.form_status || 'draft');
      setSubmittedAt('');
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['proposal', recordId || saved?.id] });
      await syncProposalReminders(saved);
      alert('הטיוטה נשמרה');
    } catch (error) {
      console.error('[ProposalForm] failed to save draft', error);
      alert('לא הצלחנו לשמור את הטיוטה');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveSubmittedChanges = async () => {
    if (!recordId) {
      alert('יש לשמור את ההצעה לפני עדכון שינויים');
      return;
    }

    setIsSaving(true);

    try {
      const payload = buildSubmittedUpdatePayload(formData, submittedAt);
      const saved = await persistRecord(payload);

      setFormStatus(saved?.form_status || 'submitted');
      setSubmittedAt(saved?.submitted_at || submittedAt);
      setFormData((prev) => ({
        ...prev,
        proposal_sent_to_client: payload.proposal_sent_to_client,
        proposal_sent_at: payload.proposal_sent_at
          ? toDatetimeLocalValue(payload.proposal_sent_at)
          : '',
        client_saw_proposal: payload.client_saw_proposal,
        client_saw_at: payload.client_saw_at
          ? toDatetimeLocalValue(payload.client_saw_at)
          : '',
        document_note: payload.document_note,
      }));

      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['proposal', recordId] });
      await syncProposalReminders(saved);
      alert('השינויים נשמרו');
    } catch (error) {
      console.error('[ProposalForm] failed to save submitted proposal changes', error);
      alert('לא הצלחנו לשמור את השינויים');
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
      const payload = buildSubmitPayload(formData);

      const saved = await persistRecord(payload);
      setFormStatus(saved?.form_status || 'submitted');
      setSubmittedAt(saved?.submitted_at || payload.submitted_at);
      setFormData((prev) => ({
        ...prev,
        proposal_sent_to_client: payload.proposal_sent_to_client,
        proposal_sent_at: payload.proposal_sent_at
          ? toDatetimeLocalValue(payload.proposal_sent_at)
          : '',
        client_saw_proposal: payload.client_saw_proposal,
        client_saw_at: payload.client_saw_at
          ? toDatetimeLocalValue(payload.client_saw_at)
          : '',
      }));
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
      queryClient.invalidateQueries({ queryKey: ['proposal', recordId || saved?.id] });
      await syncProposalReminders(saved);
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

      try {
        await cancelRemindersForDeletedSource('proposal', recordId);
        queryClient.invalidateQueries({ queryKey: ['reminders'] });
      } catch (error) {
        console.error('[ProposalForm] failed to cancel proposal reminders', error);
      }

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
            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="proposal-client-select">לקוח</Label>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
                  <Select
                    value={formData.client_id || undefined}
                    onValueChange={handleClientSelect}
                    disabled={isBusy || isSubmitted}
                  >
                    <SelectTrigger id="proposal-client-select">
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
                    disabled={isBusy || isSubmitted}
                  >
                    לקוח חדש
                  </Button>
                </div>
                <Input
                  id="client_name"
                  value={formData.client_name}
                  onChange={(e) => {
                    const nextName = e.target.value;
                    const selectedClient = clients.find((client) => client.id === formData.client_id);

                    setFormData({
                      ...formData,
                      client_name: nextName,
                      client_id: selectedClient?.name === nextName ? formData.client_id : '',
                    });
                  }}
                  disabled={isBusy || isSubmitted}
                  placeholder="שם לקוח (ניתן להקליד ידנית)"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="proposal-project-select">פרויקט</Label>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
                  <Select
                    value={formData.project_id || undefined}
                    onValueChange={handleProjectSelect}
                    disabled={isBusy || isSubmitted}
                  >
                    <SelectTrigger id="proposal-project-select">
                      <SelectValue placeholder={formData.client_id ? 'בחר פרויקט של הלקוח' : 'בחר פרויקט קיים'}>
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
                    onClick={() => setIsCreateProjectOpen(true)}
                    disabled={isBusy || isSubmitted}
                  >
                    פרויקט חדש
                  </Button>
                </div>
                <Input
                  id="project_name"
                  value={formData.project_name}
                  onChange={(e) => {
                    const nextName = e.target.value;
                    const selectedProject = projects.find((project) => project.id === formData.project_id);

                    setFormData({
                      ...formData,
                      project_name: nextName,
                      project_id: selectedProject?.name === nextName ? formData.project_id : '',
                    });
                  }}
                  disabled={isBusy || isSubmitted}
                  placeholder="שם פרויקט (אופציונלי)"
                />
                <p className="text-xs text-muted-foreground">
                  שדה אופציונלי. אפשר להגיש הצעת מחיר גם בלי פרויקט, ובהמשך לקשר או לפתוח פרויקט.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="proposal_sent_to_client"
                    checked={formData.proposal_sent_to_client}
                    onCheckedChange={(checked) => setFormData({
                      ...formData,
                      proposal_sent_to_client: checked === true,
                    })}
                    disabled={isBusy}
                  />
                  <Label htmlFor="proposal_sent_to_client" className="cursor-pointer">
                    הצעת המחיר נשלחה ללקוח
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isSubmitted
                    ? 'ניתן לעדכן אחרי הגשה. אם מסמנים שנשלחה ולא מזינים תאריך, המערכת תמלא את הזמן הנוכחי בעת השמירה.'
                    : 'אם עדיין לא נשלחה, השאר ריק. לאחר הגשת הטופס תיווצר תזכורת לשלוח אותה.'}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="proposal_sent_at">תאריך שליחה</Label>
                <Input
                  id="proposal_sent_at"
                  type="datetime-local"
                  value={formData.proposal_sent_at}
                  onChange={(e) => setFormData({ ...formData, proposal_sent_at: e.target.value })}
                  disabled={isBusy}
                />
                <p className="text-xs text-muted-foreground">
                  {isSubmitted
                    ? 'אופציונלי. אם מסמנים שההצעה נשלחה ולא מזינים תאריך, המערכת תמלא את הזמן הנוכחי בעת שמירת השינויים.'
                    : 'אופציונלי. אם תסמן שההצעה נשלחה ולא תמלא תאריך, המערכת תמלא את הזמן הנוכחי בעת ההגשה.'}
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="client_saw_proposal"
                    checked={formData.client_saw_proposal}
                    onCheckedChange={(checked) => setFormData({
                      ...formData,
                      client_saw_proposal: checked === true,
                    })}
                    disabled={isBusy}
                  />
                  <Label htmlFor="client_saw_proposal" className="cursor-pointer">
                    הלקוח ראה את ההצעה
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isSubmitted
                    ? 'ניתן לעדכן אחרי הגשה. אם מסמנים שהלקוח ראה ולא מזינים תאריך, המערכת תמלא את הזמן הנוכחי בעת השמירה.'
                    : 'אם עדיין אין אישור שהלקוח ראה, השאר ריק. לאחר הגשת הטופס תיווצר תזכורת למעקב.'}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="client_saw_at">תאריך צפייה / אישור שהלקוח ראה</Label>
                <Input
                  id="client_saw_at"
                  type="datetime-local"
                  value={formData.client_saw_at}
                  onChange={(e) => setFormData({ ...formData, client_saw_at: e.target.value })}
                  disabled={isBusy}
                />
                <p className="text-xs text-muted-foreground">
                  {isSubmitted
                    ? 'אופציונלי. אם מסמנים שהלקוח ראה ולא מזינים תאריך, המערכת תמלא את הזמן הנוכחי בעת שמירת השינויים.'
                    : 'אופציונלי. אם תסמן שהלקוח ראה את ההצעה ולא תמלא תאריך, המערכת תמלא את הזמן הנוכחי בעת ההגשה.'}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="document_note">הערה / מספר הצעה / אסמכתא</Label>
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
                {isSubmitted ? (
                  <Button type="submit" disabled={isBusy}>
                    {isSaving ? 'שומר...' : 'שמור שינויים'}
                  </Button>
                ) : (
                  <>
                    <Button type="submit" variant="outline" disabled={isBusy}>
                      {isSaving ? 'שומר...' : 'שמור טיוטה'}
                    </Button>
                    <Button
                      type="button"
                      disabled={isBusy}
                      onClick={handleSubmitForm}
                    >
                      {isSubmitting ? 'מגיש...' : 'הגשת טופס'}
                    </Button>
                  </>
                )}
              </div>

              <ProposalOpenSignedProposal
                formStatus={formStatus}
                projectId={formData.project_id}
                projectName={formData.project_name}
                clientName={formData.client_name}
                sourceInquiryId={formData.source_inquiry_id}
                proposalSentToClient={formData.proposal_sent_to_client}
                disabled={isBusy}
              />
            </form>
          </CardContent>
        </Card>

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
        />
      </div>
    </div>
  );
}
