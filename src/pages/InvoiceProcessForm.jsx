import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { buildInvoiceProcessFormPageUrl } from '@/lib/workflowNavigation';
import {
  FORM_STATUS_LABELS,
  INVOICE_SCOPE_LABELS,
  applyInvoiceProcessTimestampFields,
  isWorkStageEligibleForInvoice,
  parseWorkStageIds,
  parseWorkStageIdsFromQueryParam,
  resolveInvoiceScopeFromSelection,
  serializeWorkStageIds,
  serializeWorkStageTitles,
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
import { ArrowRight } from 'lucide-react';

const EMPTY_FORM = {
  project_id: '',
  project_name: '',
  client_id: '',
  client_name: '',
  invoice_scope: 'stage',
  invoice_reference: '',
  amount: '',
  invoice_created_in_paperless: false,
  invoice_sent_to_client: false,
  client_confirmed_received: false,
  notes: '',
};

const DELETE_CONFIRM_MESSAGE = 'למחוק את תהליך החשבונית? פעולה זו לא ניתנת לביטול.';

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
  invoice_scope: record?.invoice_scope || 'stage',
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
  const selectedStages = eligibleStages.filter((stage) => selectedStageIds.includes(stage.id));
  const amountValue = String(formData.amount || '').trim();
  const parsedAmount = amountValue === '' ? 0 : Number(amountValue);

  return {
    project_id: formData.project_id.trim(),
    project_name: formData.project_name.trim(),
    client_id: formData.client_id.trim(),
    client_name: formData.client_name.trim(),
    invoice_scope: formData.invoice_scope,
    work_stage_ids: serializeWorkStageIds(selectedStageIds),
    work_stage_titles: serializeWorkStageTitles(selectedStages),
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
  const [isDeleting, setIsDeleting] = useState(false);
  const [prefillApplied, setPrefillApplied] = useState(false);

  const isEditMode = Boolean(recordId);
  const isSubmitted = formStatus === 'submitted';
  const isBusy = isSaving || isSubmitting || isDeleting;

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
    enabled: Boolean(projectIdForStages),
  });

  const { data: prefillProject, isLoading: isLoadingPrefillProject } = useQuery({
    queryKey: ['project', prefill.project_id],
    queryFn: async () => {
      const results = await base44.entities.Project.filter({ id: prefill.project_id });
      return results?.[0] || null;
    },
    enabled: !isEditMode && Boolean(prefill.project_id) && !prefillApplied,
  });

  const eligibleStages = useMemo(
    () => workStages.filter((stage) => isWorkStageEligibleForInvoice(stage)),
    [workStages],
  );

  const selectedProjectLabel = useMemo(() => {
    if (!formData.project_id) return null;
    const project = projects.find((item) => item.id === formData.project_id);
    return project ? formatProjectSelectLabel(project) : (formData.project_name || null);
  }, [projects, formData.project_id, formData.project_name]);

  const filteredProjects = useMemo(() => {
    if (!formData.client_id) return projects;
    return projects.filter((project) => project.client_id === formData.client_id);
  }, [projects, formData.client_id]);

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

    setFormData((prev) => ({
      ...prev,
      project_id: project.id,
      project_name: project.name || prev.project_name,
      client_id: project.client_id || prev.client_id,
      client_name: linkedClient?.name || prev.client_name,
    }));
    setSelectedStageIds([]);
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

  const handleScopeChange = (scope) => {
    setFormData((prev) => ({ ...prev, invoice_scope: scope }));
    if (scope === 'stage' && selectedStageIds.length > 1) {
      setSelectedStageIds(selectedStageIds.slice(0, 1));
    }
    if (scope === 'final_project') {
      setSelectedStageIds([]);
    }
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
      return;
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
  };

  const handleSaveDraft = async () => {
    if (isSubmitted) {
      await handleSaveChanges();
      return;
    }

    setIsSaving(true);
    try {
      await persistRecord({ asSubmit: false });
      alert('הטיוטה נשמרה');
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
      await persistRecord({ asSubmit: false });
      alert('השינויים נשמרו');
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
      await persistRecord({ asSubmit: true });
      alert('הטופס הוגש');
    } catch (error) {
      console.error('[InvoiceProcessForm] submit failed', error);
      alert('לא הצלחנו להגיש את הטופס');
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

  const showStageSelection = formData.invoice_scope !== 'final_project';

  if (isEditMode && isLoadingRecord && !record) {
    return (
      <div className="min-h-screen bg-background p-6" dir="rtl">
        <p className="text-sm text-muted-foreground">טוען תהליך חשבונית...</p>
      </div>
    );
  }

  return (
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

            {formData.project_id ? (
              <div className="space-y-3 rounded-lg border p-4">
                <Label>שלבי עבודה שהושלמו</Label>
                {formData.invoice_scope === 'final_project' ? (
                  <p className="text-xs text-muted-foreground">
                    לחשבונית סופית אין חובה לבחור שלבים. אפשר לסמן שלבים להקשר בלבד.
                  </p>
                ) : null}

                {isLoadingStages ? (
                  <p className="text-sm text-muted-foreground">טוען שלבי עבודה...</p>
                ) : eligibleStages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">אין שלבים שהושלמו לפרויקט זה.</p>
                ) : (
                  <div className="space-y-2">
                    {eligibleStages.map((stage) => {
                      const isChecked = selectedStageIds.includes(stage.id);
                      const checkboxDisabled = isBusy
                        || (formData.invoice_scope === 'final_project' && false);

                      return (
                        <label
                          key={stage.id}
                          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer"
                        >
                          <Checkbox
                            checked={isChecked}
                            disabled={checkboxDisabled}
                            onCheckedChange={(checked) => toggleStageSelection(stage.id, checked === true)}
                          />
                          <span className="font-medium">{stage.title || 'שלב ללא שם'}</span>
                        </label>
                      );
                    })}
                  </div>
                )}

                {showStageSelection && formData.invoice_scope === 'stage' ? (
                  <p className="text-xs text-muted-foreground">ניתן לבחור שלב אחד בלבד.</p>
                ) : null}
                {showStageSelection && formData.invoice_scope === 'multiple_stages' ? (
                  <p className="text-xs text-muted-foreground">ניתן לבחור כמה שלבים.</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">בחר פרויקט כדי לטעון שלבי עבודה.</p>
            )}

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
                  onChange={(event) => setFormData((prev) => ({ ...prev, amount: event.target.value }))}
                  disabled={isBusy}
                />
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
                {record?.invoice_created_at ? (
                  <span className="text-xs text-muted-foreground">
                    (
                    {new Intl.DateTimeFormat('he-IL').format(new Date(record.invoice_created_at))}
                    )
                  </span>
                ) : null}
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
