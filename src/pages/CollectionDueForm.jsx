import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { buildCollectionDueFormPageUrl } from '@/lib/workflowNavigation';
import {
  ACTIVE_COLLECTION_STATUSES,
  COLLECTION_DUE_STATUS_LABELS,
  PAPERLESS_INVOICE_URL,
  buildGmailSearchUrl,
  buildCollectionDueFormPrefillFromInvoice,
  cancelCollectionDue,
  completeCollectionDue,
  computeCollectionDueStatus,
  syncProjectLegacyCollectionFields,
} from '@/lib/collectionDueUtils';
import CompleteCollectionDueDialog from '@/components/collection/CompleteCollectionDueDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ArrowRight } from 'lucide-react';

const CANCEL_CONFIRM = 'לבטל את הגבייה?';

const EMPTY_FORM = {
  invoice_process_id: '',
  invoice_reference: '',
  project_id: '',
  project_name: '',
  client_id: '',
  client_name: '',
  amount_due: '',
  amount_paid: '',
  remaining_amount: '',
  due_date: '',
  opened_at: '',
  paid_at: '',
  payment_received: false,
  payment_received_at: '',
  tax_invoice_sent_to_client: false,
  tax_invoice_sent_at: '',
  tax_invoice_reference: '',
  status: 'open',
  source_type: '',
  work_stage_ids: '',
  work_stage_titles: '',
  notes: '',
  form_status: 'submitted',
};

const readSearchParams = () => {
  const params = new URLSearchParams(window.location.search);
  return {
    id: params.get('id') || '',
    invoiceProcessId: params.get('invoice_process_id') || '',
  };
};

const recordToForm = (record) => ({
  invoice_process_id: record?.invoice_process_id || '',
  invoice_reference: record?.invoice_reference || '',
  project_id: record?.project_id || '',
  project_name: record?.project_name || '',
  client_id: record?.client_id || '',
  client_name: record?.client_name || '',
  amount_due: record?.amount_due != null ? String(record.amount_due) : '',
  amount_paid: record?.amount_paid != null ? String(record.amount_paid) : '',
  remaining_amount: record?.remaining_amount != null ? String(record.remaining_amount) : '',
  due_date: record?.due_date || '',
  opened_at: record?.opened_at || '',
  paid_at: record?.paid_at || '',
  payment_received: record?.payment_received === true,
  payment_received_at: record?.payment_received_at || '',
  tax_invoice_sent_to_client: record?.tax_invoice_sent_to_client === true,
  tax_invoice_sent_at: record?.tax_invoice_sent_at || '',
  tax_invoice_reference: record?.tax_invoice_reference || '',
  status: record?.status || 'open',
  source_type: record?.source_type || '',
  work_stage_ids: record?.work_stage_ids || '',
  work_stage_titles: record?.work_stage_titles || '',
  notes: record?.notes || '',
  form_status: record?.form_status || 'submitted',
});

const buildPayload = (formData) => {
  const amountDue = Number(String(formData.amount_due || '').trim() || 0);
  const amountPaid = Number(String(formData.amount_paid || '').trim() || 0);
  const statusFields = computeCollectionDueStatus({
    amount_due: amountDue,
    amount_paid: amountPaid,
    payment_received: formData.payment_received === true,
    tax_invoice_sent_to_client: formData.tax_invoice_sent_to_client === true,
    payment_received_at: formData.payment_received_at || '',
    tax_invoice_sent_at: formData.tax_invoice_sent_at || '',
    paid_at: formData.paid_at || '',
    status: formData.status,
  });

  return {
    invoice_process_id: formData.invoice_process_id || '',
    invoice_reference: formData.invoice_reference || '',
    project_id: formData.project_id,
    project_name: formData.project_name || '',
    client_id: formData.client_id || '',
    client_name: formData.client_name || '',
    amount_due: amountDue,
    ...statusFields,
    tax_invoice_reference: formData.tax_invoice_reference || '',
    due_date: formData.due_date || '',
    opened_at: formData.opened_at || new Date().toISOString(),
    source_type: formData.source_type || 'manual',
    work_stage_ids: formData.work_stage_ids || '',
    work_stage_titles: formData.work_stage_titles || '',
    notes: formData.notes || '',
    form_status: formData.form_status || 'submitted',
  };
};

export default function CollectionDueForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id: initialId, invoiceProcessId } = readSearchParams();

  const [recordId, setRecordId] = useState(initialId);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [isActionBusy, setIsActionBusy] = useState(false);
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);

  const isEditMode = Boolean(recordId);

  const { data: record, isLoading: isLoadingRecord } = useQuery({
    queryKey: ['collection-due', recordId],
    queryFn: async () => {
      const results = await base44.entities.CollectionDue.filter({ id: recordId });
      return results?.[0] || null;
    },
    enabled: Boolean(recordId),
  });

  const { data: sourceInvoice, isLoading: isLoadingInvoice } = useQuery({
    queryKey: ['invoice-process', 'collection-prefill', invoiceProcessId],
    queryFn: async () => {
      const results = await base44.entities.InvoiceProcess.filter({ id: invoiceProcessId });
      return results?.[0] || null;
    },
    enabled: !recordId && Boolean(invoiceProcessId),
  });

  useEffect(() => {
    if (!record) return;
    setFormData(recordToForm(record));
  }, [record]);

  useEffect(() => {
    if (recordId || prefillApplied || !sourceInvoice) return;
    setFormData(recordToForm(buildCollectionDueFormPrefillFromInvoice(sourceInvoice)));
    setPrefillApplied(true);
  }, [recordId, prefillApplied, sourceInvoice]);

  const parsedAmountDue = useMemo(
    () => Number(String(formData.amount_due || '').trim() || 0),
    [formData.amount_due],
  );

  const parsedAmountPaid = useMemo(
    () => Number(String(formData.amount_paid || '').trim() || 0),
    [formData.amount_paid],
  );

  const previewPayment = useMemo(
    () => computeCollectionDueStatus({
      amount_due: parsedAmountDue,
      amount_paid: parsedAmountPaid,
      payment_received: formData.payment_received,
      tax_invoice_sent_to_client: formData.tax_invoice_sent_to_client,
      paid_at: formData.paid_at || null,
      status: formData.status,
    }),
    [
      parsedAmountDue,
      parsedAmountPaid,
      formData.payment_received,
      formData.tax_invoice_sent_to_client,
      formData.paid_at,
      formData.status,
    ],
  );

  const isClosed = formData.status === 'paid' || formData.status === 'cancelled';
  const canComplete = ACTIVE_COLLECTION_STATUSES.has(formData.status);
  const statusLabel = COLLECTION_DUE_STATUS_LABELS[formData.status] || formData.status || '-';
  const gmailUrl = useMemo(
    () => buildGmailSearchUrl({
      clientName: formData.client_name,
      invoiceReference: formData.invoice_reference,
    }),
    [formData.client_name, formData.invoice_reference],
  );

  const invalidateQueries = async (projectId) => {
    await queryClient.invalidateQueries({ queryKey: ['collection-dues'] });
    await queryClient.invalidateQueries({ queryKey: ['reminders'] });
    if (recordId) {
      await queryClient.invalidateQueries({ queryKey: ['collection-due', recordId] });
    }
    if (projectId) {
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    }
  };

  const handleSave = async () => {
    if (!formData.project_id) {
      alert('חסר פרויקט');
      return;
    }

    if (parsedAmountDue <= 0) {
      alert('יש להזין סכום לגבייה');
      return;
    }

    setIsSaving(true);

    try {
      const payload = buildPayload(formData);
      let savedId = recordId;
      let savedRecord = null;

      if (recordId) {
        await base44.entities.CollectionDue.update(recordId, payload);
        savedRecord = { ...(record || {}), ...payload, id: recordId };
      } else {
        const created = await base44.entities.CollectionDue.create(payload);
        if (created?.id) {
          savedId = created.id;
          setRecordId(created.id);
          savedRecord = { ...created, ...payload };
          window.history.replaceState(
            {},
            '',
            buildCollectionDueFormPageUrl({ collectionDueId: created.id }),
          );
        }
      }

      if (payload.project_id) {
        const lastPaidAt = payload.status === 'paid' ? (payload.paid_at || new Date().toISOString()) : null;
        await syncProjectLegacyCollectionFields(payload.project_id, {
          lastPaidAt,
          freshCollections: savedRecord ? [savedRecord] : [],
        });
      }

      if (savedRecord) {
        const { runCollectionReminderRulesForCollection } = await import('@/lib/collectionReminderRules');
        await runCollectionReminderRulesForCollection(savedRecord);
      }

      setFormData(recordToForm({ ...formData, ...payload }));
      await invalidateQueries(formData.project_id);
      alert(recordId ? 'השינויים נשמרו' : 'הגבייה נשמרה');
    } catch (error) {
      console.error('[CollectionDueForm] save failed', error);
      alert('לא הצלחנו לשמור את הגבייה');
    } finally {
      setIsSaving(false);
    }
  };

  const handleComplete = async ({ paymentReceived, taxInvoiceSent, taxInvoiceReference }) => {
    if (!recordId || !canComplete) return;

    setIsActionBusy(true);

    try {
      const current = record || { ...formData, id: recordId, amount_due: parsedAmountDue };
      const updated = await completeCollectionDue(current, {
        paymentReceived,
        taxInvoiceSent,
        taxInvoiceReference,
      });
      setFormData(recordToForm(updated));
      setCompleteDialogOpen(false);
      await invalidateQueries(formData.project_id);
    } catch (error) {
      console.error('[CollectionDueForm] complete collection failed', error);
      alert('לא הצלחנו לשמור את סיום הגבייה');
    } finally {
      setIsActionBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!recordId || isClosed) return;

    const confirmed = window.confirm(CANCEL_CONFIRM);
    if (!confirmed) return;

    setIsActionBusy(true);

    try {
      await cancelCollectionDue(record || { id: recordId, project_id: formData.project_id });
      setFormData((prev) => ({ ...prev, status: 'cancelled', form_status: 'cancelled' }));
      await invalidateQueries(formData.project_id);
    } catch (error) {
      console.error('[CollectionDueForm] cancel failed', error);
      alert('לא הצלחנו לבטל את הגבייה');
    } finally {
      setIsActionBusy(false);
    }
  };

  const isLoading = (recordId && isLoadingRecord) || (!recordId && invoiceProcessId && isLoadingInvoice);
  const isBusy = isSaving || isActionBusy;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50" dir="rtl">
      <div className="max-w-4xl mx-auto px-8 py-10 space-y-6">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="gap-2">
            <Link to={createPageUrl('Collections')}>
              <ArrowRight className="w-4 h-4" />
              חזרה לגבייה
            </Link>
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {isEditMode ? 'גבייה' : 'גבייה חדשה'}
            </h1>
            <p className="text-muted-foreground mt-1">צפייה ועריכת פרטי גבייה</p>
          </div>
          <Badge variant="secondary">{statusLabel}</Badge>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">טוען...</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>פרטי גבייה</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>לקוח</Label>
                    <Input value={formData.client_name} disabled />
                  </div>
                  <div className="space-y-2">
                    <Label>פרויקט</Label>
                    <Input value={formData.project_name} disabled />
                  </div>
                  <div className="space-y-2">
                    <Label>אסמכתא / חשבונית</Label>
                    <Input
                      value={formData.invoice_reference}
                      disabled={Boolean(formData.invoice_process_id)}
                      onChange={(event) => setFormData((prev) => ({
                        ...prev,
                        invoice_reference: event.target.value,
                      }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>תאריך יעד</Label>
                    <Input
                      type="date"
                      value={formData.due_date ? formData.due_date.slice(0, 10) : ''}
                      disabled={isClosed}
                      onChange={(event) => setFormData((prev) => ({
                        ...prev,
                        due_date: event.target.value,
                      }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>סכום לגבייה</Label>
                    <Input
                      type="number"
                      min="0"
                      value={formData.amount_due}
                      disabled={isClosed || Boolean(formData.invoice_process_id && isEditMode)}
                      onChange={(event) => setFormData((prev) => ({
                        ...prev,
                        amount_due: event.target.value,
                      }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>סכום ששולם</Label>
                    <Input
                      type="number"
                      min="0"
                      value={formData.amount_paid}
                      disabled={isClosed}
                      onChange={(event) => setFormData((prev) => ({
                        ...prev,
                        amount_paid: event.target.value,
                      }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>יתרה (מחושב)</Label>
                    <Input value={String(previewPayment.remaining_amount)} disabled />
                  </div>
                  <div className="space-y-2">
                    <Label>חשבונית מס נשלחה?</Label>
                    <Input
                      value={formData.tax_invoice_sent_to_client ? 'כן' : 'לא'}
                      disabled
                    />
                  </div>
                </div>

                {formData.work_stage_titles ? (
                  <div className="space-y-2">
                    <Label>שלבי עבודה</Label>
                    <Input value={formData.work_stage_titles} disabled />
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label>הערות</Label>
                  <Textarea
                    value={formData.notes}
                    disabled={isClosed}
                    onChange={(event) => setFormData((prev) => ({
                      ...prev,
                      notes: event.target.value,
                    }))}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm" className="gap-1">
                    <a href={PAPERLESS_INVOICE_URL} target="_blank" rel="noopener noreferrer">
                      פתח Paperless
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="gap-1">
                    <a href={gmailUrl} target="_blank" rel="noopener noreferrer">
                      פתח Gmail
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-wrap gap-3">
              <Button type="button" disabled={isBusy || isClosed} onClick={() => { void handleSave(); }}>
                {isEditMode ? 'שמור שינויים' : 'שמור גבייה'}
              </Button>
              {isEditMode && canComplete ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isBusy}
                  onClick={() => setCompleteDialogOpen(true)}
                >
                  סיום גבייה
                </Button>
              ) : null}
              {isEditMode && !isClosed ? (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isBusy}
                  onClick={() => { void handleCancel(); }}
                >
                  בטל
                </Button>
              ) : null}
              <Button type="button" variant="outline" disabled={isBusy} onClick={() => navigate(createPageUrl('Collections'))}>
                חזרה לרשימה
              </Button>
            </div>
          </>
        )}
      </div>

      <CompleteCollectionDueDialog
        open={completeDialogOpen}
        onOpenChange={setCompleteDialogOpen}
        collectionDue={record || { ...formData, id: recordId, amount_due: parsedAmountDue }}
        onComplete={handleComplete}
        isSaving={isActionBusy}
      />
    </div>
  );
}
