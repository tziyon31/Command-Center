import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { buildInvoiceProcessFormPageUrl, buildProjectFeeEditPageUrl } from '@/lib/workflowNavigation';
import { getGmailUrl, getPaperlessUrl } from '@/lib/invoiceExternalLinks';
import {
  buildInvoiceCollectionNote,
  getInvoiceAmountCollectionValidation,
  openProjectCollectionDue,
} from '@/lib/projectCollectionDue';
import {
  FORM_STATUS_LABELS,
  INVOICE_SCOPE_LABELS,
  applyInvoiceProcessTimestampFields,
  buildWorkStagePersistenceFields,
  calculateAmountFromProjectPercent,
  getProjectFeeAmount,
  isWorkStageEligibleForInvoice,
  parseWorkStageIds,
  parseWorkStageIdsFromQueryParam,
  resolveInvoiceScopeFromSelection,
  showsWorkStageSelection,
  validateInvoiceProcessSubmit,
} from '@/lib/invoiceProcessUtils';
import { formatProjectSelectLabel } from '@/lib/projectSelectLabel';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ArrowRight, ExternalLink } from 'lucide-react';

const EMPTY_FORM = {
  project_id: '',
  project_name: '',
  client_id: '',
  client_name: '',
  invoice_scope: 'general',
  project_percent: '',
  invoice_reference: '',
  amount: '',
  invoice_created_in_paperless: false,
  invoice_sent_to_client: false,
  client_confirmed_received: false,
  notes: '',
};

const DELETE_CONFIRM_MESSAGE = 'למחוק את תהליך החשבונית? פעולה זו לא ניתנת לביטול.';

const COLLECTION_DISABLED_HINT = 'יש לסמן שהחשבונית נשלחה ללקוח לפני פתיחת גבייה.';

const readSearchParams = () => {
  const params = new URLSearchParams(window.location.search);

  return {
    id: params.get('id') || '',
    prefill: {
      project_id: params.get('project_id') || '',
      project_name: params.get('project_name') || '',
      client_id: params.get('client_id') || '',
      client_name: params.get('client_name') || '',
      invoice_scope: params.get('invoice_scope') || '',
      work_stage_ids: parseWorkStageIdsFromQueryParam(params.get('work_stage_ids') || ''),
    },
  };
};

const invoiceProcessToForm = (record) => ({
  project_id: record?.project_id || '',
  project_name: record?.project_name || '',
  client_id: record?.client_id || '',
  client_name: record?.client_name || '',
  invoice_scope: record?.invoice_scope || 'general',
  project_percent: record?.project_percent != null && record.project_percent !== ''
    ? String(record.project_percent)
    : '',
  invoice_reference: record?.invoice_reference || '',
  amount: record?.amount != null && record.amount !== '' ? String(record.amount) : '',
  invoice_created_in_paperless: Boolean(record?.invoice_created_in_paperless),
  invoice_sent_to_client: Boolean(record?.invoice_sent_to_client),
  client_confirmed_received: Boolean(record?.client_confirmed_received),
  notes: record?.notes || '',
});

const buildPayload = ({
  formData,
  selectedStageIds,
  eligibleStages,
  formStatus,
  submittedAt,
}) => {
  const amountValue = String(formData.amount || '').trim();
  const parsedAmount = amountValue === '' ? 0 : Number(amountValue);
  const percentValue = String(formData.project_percent || '').trim();
  const parsedPercent = percentValue === '' ? null : Number(percentValue);
  const stageFields = buildWorkStagePersistenceFields(
    formData.invoice_scope,
    selectedStageIds,
    eligibleStages,
  );

  return {
    project_id: formData.project_id.trim(),
    project_name: formData.project_name.trim(),
    client_id: formData.client_id.trim(),
    client_name: formData.client_name.trim(),
    invoice_scope: formData.invoice_scope,
    project_percent: Number.isFinite(parsedPercent) ? parsedPercent : null,
    ...stageFields,
    invoice_reference: formData.invoice_reference.trim(),
    amount: Number.isFinite(parsedAmount) ? parsedAmount : 0,
    invoice_created_in_paperless: Boolean(formData.invoice_created_in_paperless),
    invoice_sent_to_client: Boolean(formData.invoice_sent_to_client),
    client_confirmed_received: Boolean(formData.client_confirmed_received),
    notes: formData.notes.trim(),
    form_status: formStatus,
    submitted_at: submittedAt,
  };
};

export default function InvoiceProcessForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [{ id: initialId, prefill }] = useState(readSearchParams);
  const paperlessUrl = getPaperlessUrl();

  const [recordId, setRecordId] = useState(initialId);
  const [formData, setFormData] = useState(() => ({
    ...EMPTY_FORM,
    invoice_scope: prefill.invoice_scope || EMPTY_FORM.invoice_scope,
    project_id: prefill.project_id,
    project_name: prefill.project_name,
    client_id: prefill.client_id,
    client_name: prefill.client_name,
  }));
  const [selectedStageIds, setSelectedStageIds] = useState(() => [...prefill.work_stage_ids]);
  const [formStatus, setFormStatus] = useState('draft');
  const [submittedAt, setSubmittedAt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingCollection, setIsSubmittingCollection] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [prefillApplied, setPrefillApplied] = useState(false);

  const isEditMode = Boolean(recordId);
  const isSubmitted = formStatus === 'submitted';
  const isBusy = isSaving || isSubmitting || isSubmittingCollection || isDeleting;

  const parsedInvoiceAmount = useMemo(() => {
    const amountValue = String(formData.amount || '').trim();
    const parsed = amountValue === '' ? 0 : Number(amountValue);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [formData.amount]);

  const { data: record, isLoading: isLoadingRecord } = useQuery({
    queryKey: ['invoice-process', recordId],
    queryFn: async () => {
      const results = await base44.entities.InvoiceProcess.filter({ id: recordId });
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

  const projectIdForStages = formData.project_id || prefill.project_id;

  const { data: workStages = [], isLoading: isLoadingStages } = useQuery({
    queryKey: ['work-stages', projectIdForStages],
    queryFn: async () => {
      const items = await base44.entities.WorkStage.filter({ project_id: projectIdForStages });
      return items || [];
    },
    enabled: Boolean(projectIdForStages) && showsWorkStageSelection(formData.invoice_scope),
  });

  const { data: prefillProject } = useQuery({
    queryKey: ['project', prefill.project_id],
    queryFn: async () => {
      const results = await base44.entities.Project.filter({ id: prefill.project_id });
      return results?.[0] || null;
    },
    enabled: !isEditMode && Boolean(prefill.project_id) && !prefillApplied,
  });

  const { data: selectedProjectRecord } = useQuery({
    queryKey: ['project', formData.project_id],
    queryFn: async () => {
      const results = await base44.entities.Project.filter({ id: formData.project_id });
      return results?.[0] || null;
    },
    enabled: Boolean(formData.project_id),
    refetchOnWindowFocus: true,
  });

  const selectedProject = useMemo(() => {
    if (selectedProjectRecord) return selectedProjectRecord;
    return projects.find((item) => item.id === formData.project_id) || null;
  }, [selectedProjectRecord, projects, formData.project_id]);

  const eligibleStages = useMemo(
    () => workStages.filter((stage) => isWorkStageEligibleForInvoice(stage)),
    [workStages],
  );

  const selectedProjectLabel = useMemo(() => {
    if (!formData.project_id) return null;
    return selectedProject
      ? formatProjectSelectLabel(selectedProject)
      : (formData.project_name || null);
  }, [selectedProject, formData.project_id, formData.project_name]);

  const filteredProjects = useMemo(() => {
    if (!formData.client_id) return projects;
    return projects.filter((project) => project.client_id === formData.client_id);
  }, [projects, formData.client_id]);

  const projectFeeAmount = getProjectFeeAmount(selectedProject);
  const amountCollectionValidation = useMemo(
    () => getInvoiceAmountCollectionValidation({
      project: selectedProject,
      amountValue: parsedInvoiceAmount,
    }),
    [selectedProject, parsedInvoiceAmount],
  );
  const showEditProjectFeeButton = Boolean(
    formData.project_id
    && parsedInvoiceAmount > 0
    && amountCollectionValidation.hasIssue,
  );
  const canOpenCollection = (
    formData.invoice_sent_to_client === true
    && parsedInvoiceAmount > 0
    && !amountCollectionValidation.hasIssue
  );

  const applyCalculatedAmount = (project, percentValue) => {
    const calculated = calculateAmountFromProjectPercent(project, percentValue);
    if (calculated == null) return;

    setFormData((prev) => ({
      ...prev,
      amount: String(calculated),
    }));
  };

  useEffect(() => {
    if (!record) return;

    setFormData(invoiceProcessToForm(record));
    setSelectedStageIds(parseWorkStageIds(record.work_stage_ids));
    setFormStatus(record.form_status || 'draft');
    setSubmittedAt(record.submitted_at || '');
  }, [record]);

  useEffect(() => {
    if (isEditMode || prefillApplied || !prefillProject) return;

    const linkedClient = clients.find((client) => client.id === prefillProject.client_id);

    setFormData((prev) => ({
      ...prev,
      project_id: prefillProject.id,
      project_name: prefillProject.name || prev.project_name,
      client_id: prefillProject.client_id || prev.client_id,
      client_name: linkedClient?.name || prefillProject.client_name || prev.client_name,
      invoice_scope: prefill.invoice_scope || resolveInvoiceScopeFromSelection(prefill.work_stage_ids, prev.invoice_scope),
    }));

    if (prefill.work_stage_ids.length) {
      setSelectedStageIds(prefill.work_stage_ids);
    }

    setPrefillApplied(true);
  }, [isEditMode, prefillApplied, prefillProject, clients, prefill]);

  const applyProjectSelection = (projectId) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;

    const linkedClient = clients.find((client) => client.id === project.client_id);
    const percentValue = String(formData.project_percent || '').trim();

    setFormData((prev) => ({
      ...prev,
      project_id: project.id,
      project_name: project.name || prev.project_name,
      client_id: project.client_id || prev.client_id,
      client_name: linkedClient?.name || prev.client_name,
    }));
    setSelectedStageIds([]);

    if (percentValue) {
      applyCalculatedAmount(project, percentValue);
    }
  };

  const handleClientSelect = (selectedClientId) => {
    const client = clients.find((item) => item.id === selectedClientId);
    if (!client) return;

    setFormData((prev) => ({
      ...prev,
      client_id: client.id,
      client_name: client.name || prev.client_name,
      project_id: '',
      project_name: '',
    }));
    setSelectedStageIds([]);
  };

  const handleScopeChange = (scope) => {
    setFormData((prev) => ({ ...prev, invoice_scope: scope }));

    if (scope === 'stage' && selectedStageIds.length > 1) {
      setSelectedStageIds(selectedStageIds.slice(0, 1));
    }

    if (!showsWorkStageSelection(scope)) {
      setSelectedStageIds([]);
    }
  };

  const handlePercentChange = (value) => {
    setFormData((prev) => ({ ...prev, project_percent: value }));

    if (!String(value || '').trim()) return;
    applyCalculatedAmount(selectedProject, value);
  };

  const handleAmountChange = (value) => {
    setFormData((prev) => ({ ...prev, amount: value }));
  };

  const toggleStageSelection = (stageId, checked) => {
    const scope = formData.invoice_scope;

    if (scope === 'stage') {
      setSelectedStageIds(checked ? [stageId] : []);
      return;
    }

    setSelectedStageIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(stageId);
      else next.delete(stageId);
      return [...next];
    });
  };

  const persistRecord = async ({ asSubmit }) => {
    const validationError = asSubmit
      ? validateInvoiceProcessSubmit({
        projectId: formData.project_id,
        clientId: formData.client_id,
        clientName: formData.client_name,
        invoiceScope: formData.invoice_scope,
        selectedStageIds,
      })
      : null;

    if (validationError) {
      alert(validationError);
      return false;
    }

    const nextStatus = asSubmit ? 'submitted' : (formStatus === 'submitted' ? 'submitted' : 'draft');
    const nextSubmittedAt = asSubmit
      ? (submittedAt || new Date().toISOString())
      : submittedAt;

    const basePayload = buildPayload({
      formData,
      selectedStageIds,
      eligibleStages,
      formStatus: nextStatus,
      submittedAt: nextSubmittedAt,
    });

    const payload = applyInvoiceProcessTimestampFields(basePayload, record || {});

    let savedId = recordId;

    if (recordId) {
      await base44.entities.InvoiceProcess.update(recordId, payload);
    } else {
      const created = await base44.entities.InvoiceProcess.create(payload);
      if (created?.id) {
        savedId = created.id;
        setRecordId(created.id);
        window.history.replaceState(
          {},
          '',
          buildInvoiceProcessFormPageUrl({ invoiceProcessId: created.id }),
        );
      }
    }

    setFormStatus(nextStatus);
    if (asSubmit) setSubmittedAt(nextSubmittedAt);

    await queryClient.invalidateQueries({ queryKey: ['invoice-processes'] });
    if (savedId) {
      await queryClient.invalidateQueries({ queryKey: ['invoice-process', savedId] });
    }

    return true;
  };

  const handleSaveDraft = async () => {
    if (isSubmitted) {
      await handleSaveChanges();
      return;
    }

    setIsSaving(true);
    try {
      const saved = await persistRecord({ asSubmit: false });
      if (saved) alert('הטיוטה נשמרה');
    } catch (error) {
      console.error('[InvoiceProcessForm] save draft failed', error);
      alert('לא הצלחנו לשמור את הטיוטה');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveChanges = async () => {
    setIsSaving(true);
    try {
      const saved = await persistRecord({ asSubmit: false });
      if (saved) alert('השינויים נשמרו');
    } catch (error) {
      console.error('[InvoiceProcessForm] save changes failed', error);
      alert('לא הצלחנו לשמור את השינויים');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (isSubmitted) return;

    setIsSubmitting(true);
    try {
      const saved = await persistRecord({ asSubmit: true });
      if (saved) alert('הטופס הוגש');
    } catch (error) {
      console.error('[InvoiceProcessForm] submit failed', error);
      alert('לא הצלחנו להגיש את הטופס');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitAndOpenCollection = async () => {
    if (!canOpenCollection) return;

    if (!formData.project_id) return;

    setIsSubmittingCollection(true);

    try {
      const saved = await persistRecord({ asSubmit: true });
      if (!saved) return;

      const projectResults = await base44.entities.Project.filter({ id: formData.project_id });
      const project = projectResults?.[0] || selectedProject;

      if (!project) {
        console.error('[InvoiceProcessForm] project not found for collection');
        return;
      }

      const amount = parsedInvoiceAmount;

      const stageFields = buildWorkStagePersistenceFields(
        formData.invoice_scope,
        selectedStageIds,
        eligibleStages,
      );

      const collectionNote = buildInvoiceCollectionNote({
        invoiceReference: formData.invoice_reference,
        workStageTitles: stageFields.work_stage_titles,
        invoiceScope: formData.invoice_scope,
      });

      try {
        await openProjectCollectionDue({
          project,
          amount,
          note: collectionNote,
          updateProject: (id, payload) => base44.entities.Project.update(id, payload),
        });
      } catch (error) {
        console.error('[InvoiceProcessForm] open collection failed', error);
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ['project', formData.project_id] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });

      alert('הטופס הוגש ונפתחה גבייה.');
      navigate(createPageUrl(`ProjectDetails?id=${formData.project_id}`));
    } catch (error) {
      console.error('[InvoiceProcessForm] submit and open collection failed', error);
      alert('לא הצלחנו להגיש את הטופס ולפתוח גבייה');
    } finally {
      setIsSubmittingCollection(false);
    }
  };

  const handleDelete = async () => {
    if (!recordId) return;

    const confirmed = window.confirm(DELETE_CONFIRM_MESSAGE);
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await base44.entities.InvoiceProcess.delete(recordId);
      await queryClient.invalidateQueries({ queryKey: ['invoice-processes'] });
      navigate(createPageUrl('Invoices'));
    } catch (error) {
      console.error('[InvoiceProcessForm] delete failed', error);
      alert('לא הצלחנו למחוק את תהליך החשבונית');
    } finally {
      setIsDeleting(false);
    }
  };

  if (isEditMode && isLoadingRecord && !record) {
    return (
      <div className="min-h-screen bg-background p-6" dir="rtl">
        <p className="text-sm text-muted-foreground">טוען תהליך חשבונית...</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50" dir="rtl">
        <div className="max-w-[900px] mx-auto px-8 py-10 space-y-6">
          <div className="flex items-center gap-2 flex-wrap">
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link to={createPageUrl('Invoices')}>
                <ArrowRight className="w-4 h-4" />
                חזרה לרשימת חשבוניות
              </Link>
            </Button>
          </div>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle>{isEditMode ? 'עריכת תהליך חשבונית' : 'תהליך חשבונית חדש'}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    מעקב ידני אחרי יצירה ב-Paperless, שליחה ללקוח ואישור קבלה
                  </p>
                </div>
                {formStatus ? (
                  <Badge variant="secondary">{FORM_STATUS_LABELS[formStatus] || formStatus}</Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>לקוח</Label>
                  <Select
                    value={formData.client_id || undefined}
                    onValueChange={handleClientSelect}
                    disabled={isBusy || isSubmitted}
                  >
                    <SelectTrigger>
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
                  <Input
                    value={formData.client_name}
                    onChange={(event) => setFormData((prev) => ({ ...prev, client_name: event.target.value }))}
                    placeholder="או שם לקוח ידני"
                    disabled={isBusy}
                  />
                </div>

                <div className="space-y-2">
                  <Label>פרויקט</Label>
                  <Select
                    value={formData.project_id || undefined}
                    onValueChange={applyProjectSelection}
                    disabled={isBusy || isSubmitted}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="בחר פרויקט" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredProjects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {formatProjectSelectLabel(project)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedProjectLabel ? (
                    <p className="text-xs text-muted-foreground">{selectedProjectLabel}</p>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-3">
                  <Label>סוג חשבונית</Label>
                  <RadioGroup
                    value={formData.invoice_scope}
                    onValueChange={handleScopeChange}
                    className="flex flex-col gap-2"
                    disabled={isBusy}
                  >
                    {Object.entries(INVOICE_SCOPE_LABELS).map(([value, label]) => (
                      <div key={value} className="flex items-center gap-2">
                        <RadioGroupItem value={value} id={`invoice-scope-${value}`} />
                        <Label htmlFor={`invoice-scope-${value}`} className="font-normal cursor-pointer">
                          {label}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="project_percent">אחוז מהפרויקט</Label>
                  <Input
                    id="project_percent"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={formData.project_percent}
                    onChange={(event) => handlePercentChange(event.target.value)}
                    disabled={isBusy || !formData.project_id}
                    placeholder="לדוגמה: 70"
                  />
                  <p className="text-xs text-muted-foreground">מחושב לפי שכ״ט הפרויקט</p>
                  {Boolean(String(formData.project_percent || '').trim())
                    && Boolean(formData.project_id)
                    && projectFeeAmount <= 0 ? (
                      <p className="text-xs text-amber-700">לא נמצא סכום פרויקט לחישוב אוטומטי.</p>
                    ) : null}
                  {projectFeeAmount > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      שכ״ט פרויקט:
                      {' '}
                      {new Intl.NumberFormat('he-IL').format(projectFeeAmount)}
                      {' '}
                      ₪
                    </p>
                  ) : null}
                </div>
              </div>

              {formData.invoice_scope === 'general' ? (
                <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-3">
                  חשבונית כללית - לא משויכת לשלבי עבודה מסוימים.
                </p>
              ) : null}

              {showsWorkStageSelection(formData.invoice_scope) ? (
                <div className="space-y-3 rounded-lg border p-4">
                  <Label>שלבי עבודה שהושלמו (אופציונלי)</Label>
                  <p className="text-xs text-muted-foreground">
                    ניתן לציין על אילו שלבים הופקה החשבונית. אין חובה לבחור שלבים.
                  </p>

                  {!formData.project_id ? (
                    <p className="text-sm text-muted-foreground">בחר פרויקט כדי לטעון שלבי עבודה.</p>
                  ) : isLoadingStages ? (
                    <p className="text-sm text-muted-foreground">טוען שלבי עבודה...</p>
                  ) : eligibleStages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">אין שלבים שהושלמו לפרויקט זה.</p>
                  ) : (
                    <div className="space-y-2">
                      {eligibleStages.map((stage) => {
                        const isChecked = selectedStageIds.includes(stage.id);

                        return (
                          <label
                            key={stage.id}
                            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer"
                          >
                            <Checkbox
                              checked={isChecked}
                              disabled={isBusy}
                              onCheckedChange={(checked) => toggleStageSelection(stage.id, checked === true)}
                            />
                            <span className="font-medium">{stage.title || 'שלב ללא שם'}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {formData.invoice_scope === 'stage' ? (
                    <p className="text-xs text-muted-foreground">ניתן לבחור שלב אחד בלבד.</p>
                  ) : null}
                  {formData.invoice_scope === 'multiple_stages' ? (
                    <p className="text-xs text-muted-foreground">ניתן לבחור כמה שלבים.</p>
                  ) : null}
                </div>
              ) : null}

              {formData.invoice_scope === 'final_project' ? (
                <p className="text-xs text-muted-foreground rounded-lg border p-3">
                  לחשבונית סופית אין חובה לבחור שלבים.
                </p>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="invoice_reference">אסמכתא / מספר חשבונית</Label>
                  <Input
                    id="invoice_reference"
                    value={formData.invoice_reference}
                    onChange={(event) => setFormData((prev) => ({ ...prev, invoice_reference: event.target.value }))}
                    disabled={isBusy}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="amount">סכום</Label>
                  <Input
                    id="amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.amount}
                    onChange={(event) => handleAmountChange(event.target.value)}
                    disabled={isBusy}
                    aria-invalid={amountCollectionValidation.hasIssue || undefined}
                  />
                  {amountCollectionValidation.hasIssue ? (
                    <p className="text-xs text-amber-700">
                      {amountCollectionValidation.message}
                    </p>
                  ) : null}
                  {showEditProjectFeeButton ? (
                    <Button asChild type="button" variant="outline" size="sm" className="h-7 text-xs">
                      <Link to={buildProjectFeeEditPageUrl(formData.project_id)}>
                        ערוך שכ״ט פרויקט
                      </Link>
                    </Button>
                  ) : null}
                  {formData.project_id && parsedInvoiceAmount > 0 && !amountCollectionValidation.hasIssue ? (
                    <p className="text-xs text-muted-foreground">
                      יתרת גבייה זמינה:
                      {' '}
                      {new Intl.NumberFormat('he-IL').format(amountCollectionValidation.outstandingAmount)}
                      {' '}
                      ₪
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {paperlessUrl ? (
                      <Button asChild type="button" variant="outline" size="sm" className="h-7 text-xs gap-1">
                        <a href={paperlessUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3 w-3" />
                          פתח Paperless
                        </a>
                      </Button>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled>
                              פתח Paperless
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>יש להגדיר קישור ל-Paperless</TooltipContent>
                      </Tooltip>
                    )}
                    <Button asChild type="button" variant="outline" size="sm" className="h-7 text-xs gap-1">
                      <a href={getGmailUrl()} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3 w-3" />
                        פתח Gmail
                      </a>
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm font-medium">מעקב ידני</p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={formData.invoice_created_in_paperless}
                    disabled={isBusy}
                    onCheckedChange={(checked) => setFormData((prev) => ({
                      ...prev,
                      invoice_created_in_paperless: checked === true,
                    }))}
                  />
                  <span>חשבונית נוצרה ב-Paperless</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={formData.invoice_sent_to_client}
                    disabled={isBusy}
                    onCheckedChange={(checked) => setFormData((prev) => ({
                      ...prev,
                      invoice_sent_to_client: checked === true,
                    }))}
                  />
                  <span>חשבונית נשלחה ללקוח</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={formData.client_confirmed_received}
                    disabled={isBusy}
                    onCheckedChange={(checked) => setFormData((prev) => ({
                      ...prev,
                      client_confirmed_received: checked === true,
                    }))}
                  />
                  <span>הלקוח אישר קבלה</span>
                </label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">הערות</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={(event) => setFormData((prev) => ({ ...prev, notes: event.target.value }))}
                  disabled={isBusy}
                  rows={4}
                />
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                {isSubmitted ? (
                  <Button type="button" onClick={handleSaveChanges} disabled={isBusy}>
                    שמור שינויים
                  </Button>
                ) : (
                  <>
                    <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={isBusy}>
                      שמור טיוטה
                    </Button>
                    <Button type="button" onClick={handleSubmit} disabled={isBusy}>
                      הגש טופס
                    </Button>
                  </>
                )}
                {isEditMode ? (
                  <Button type="button" variant="destructive" onClick={handleDelete} disabled={isBusy}>
                    מחק
                  </Button>
                ) : null}
              </div>

              <div className="rounded-lg border border-dashed bg-muted/20 p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold">המשך טיפול</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    לאחר סימון שהחשבונית נשלחה ללקוח, ניתן להגיש ולפתוח גבייה על הפרויקט.
                  </p>
                </div>
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isBusy || !canOpenCollection}
                    onClick={handleSubmitAndOpenCollection}
                  >
                    הגש טופס ופתח גבייה
                  </Button>
                  {!canOpenCollection ? (
                    <p className="text-xs text-muted-foreground">
                      {!formData.invoice_sent_to_client
                        ? COLLECTION_DISABLED_HINT
                        : parsedInvoiceAmount <= 0
                          ? 'יש למלא סכום לפני פתיחת גבייה.'
                          : amountCollectionValidation.hasIssue
                            ? 'יש לתקן את הסכום או את שכ״ט הפרויקט לפני פתיחת גבייה.'
                            : COLLECTION_DISABLED_HINT}
                    </p>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </TooltipProvider>
  );
}
