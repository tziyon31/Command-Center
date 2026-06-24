import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import {
  buildCollectionDueFormPageUrl,
  buildInvoiceProcessFormPageUrl,
} from '@/lib/workflowNavigation';
import {
  ACTIVE_COLLECTION_STATUSES,
  COLLECTION_DUE_STATUS_LABELS,
  cancelCollectionDue,
} from '@/lib/collectionDueUtils';
import CompleteCollectionDueDialog from '@/components/collection/CompleteCollectionDueDialog';
import { useCollectionCelebration } from '@/context/CollectionCelebrationContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const EMPTY_STATE_MESSAGE = 'אין גביות להצגה.';
const CANCEL_CONFIRM = 'לבטל את הגבייה?';

const formatDateTime = (value) => {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const formatDate = (value) => {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

const formatAmount = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  return new Intl.NumberFormat('he-IL').format(amount);
};

const sortCollectionDues = (items) => (
  [...items].sort((left, right) => {
    const leftTime = new Date(left.opened_at || left.created_date || 0).getTime();
    const rightTime = new Date(right.opened_at || right.created_date || 0).getTime();
    return rightTime - leftTime;
  })
);

const formatTaxInvoiceSent = (record) => {
  if (record.tax_invoice_sent_to_client === true) return 'כן';
  if (record.status === 'awaiting_tax_invoice') return 'לא';
  return '-';
};

export default function Collections() {
  const queryClient = useQueryClient();
  const { completeCollectionDueWithCelebration } = useCollectionCelebration();
  const [showClosed, setShowClosed] = useState(false);
  const [actionId, setActionId] = useState(null);
  const [completeTarget, setCompleteTarget] = useState(null);

  const { data: collectionDues = [], isLoading } = useQuery({
    queryKey: ['collection-dues'],
    queryFn: async () => {
      const items = await base44.entities.CollectionDue.list('-created_date');
      return sortCollectionDues(items);
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['collection-dues'] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['reminders'] });
  };

  const cancelMutation = useMutation({
    mutationFn: (record) => cancelCollectionDue(record),
    onSuccess: invalidate,
  });

  const rows = useMemo(() => {
    if (showClosed) return collectionDues;
    return collectionDues.filter((item) => ACTIVE_COLLECTION_STATUSES.has(item.status));
  }, [collectionDues, showClosed]);

  const handleComplete = async ({ paymentReceived, taxInvoiceSent, taxInvoiceReference }) => {
    if (!completeTarget) return;

    setActionId(completeTarget.id);
    try {
      await completeCollectionDueWithCelebration(completeTarget, {
        paymentReceived,
        taxInvoiceSent,
        taxInvoiceReference,
      });
      setCompleteTarget(null);
      invalidate();
    } catch (error) {
      console.error('[Collections] complete collection failed', error);
      alert('לא הצלחנו לשמור את סיום הגבייה');
    } finally {
      setActionId(null);
    }
  };

  const handleCancel = async (record) => {
    if (record.status === 'paid' || record.status === 'cancelled') return;
    const confirmed = window.confirm(CANCEL_CONFIRM);
    if (!confirmed) return;

    setActionId(record.id);
    try {
      await cancelMutation.mutateAsync(record);
    } catch (error) {
      console.error('[Collections] cancel failed', error);
      alert('לא הצלחנו לבטל את הגבייה');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50" dir="rtl">
      <div className="max-w-[1600px] mx-auto px-8 py-10 space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">גבייה</h1>
            <p className="text-muted-foreground mt-1">מעקב אחרי גביות פתוחות וסגורות</p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button asChild>
              <Link to={buildInvoiceProcessFormPageUrl({ from: 'collections' })}>
                פתח חשבונית וגבייה
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={buildCollectionDueFormPageUrl({ mode: 'historical_payment' })}>
                הוסף גבייה ישנה
              </Link>
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="show-closed-collections"
            checked={showClosed}
            onCheckedChange={(value) => setShowClosed(value === true)}
          />
          <Label htmlFor="show-closed-collections" className="cursor-pointer">
            הצג גם גביות ששולמו / בוטלו
          </Label>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="p-6 text-sm text-muted-foreground">טוען גביות...</p>
            ) : rows.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">{EMPTY_STATE_MESSAGE}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">לקוח</TableHead>
                      <TableHead className="text-right">פרויקט</TableHead>
                      <TableHead className="text-right">חשבונית / אסמכתא</TableHead>
                      <TableHead className="text-right">סכום לגבייה</TableHead>
                      <TableHead className="text-right">שולם</TableHead>
                      <TableHead className="text-right">יתרה</TableHead>
                      <TableHead className="text-right">נשלחה חשבונית מס?</TableHead>
                      <TableHead className="text-right">תאריך פתיחה</TableHead>
                      <TableHead className="text-right">תאריך יעד</TableHead>
                      <TableHead className="text-right">סטטוס</TableHead>
                      <TableHead className="text-right">הערות</TableHead>
                      <TableHead className="text-right">פעולות</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const statusLabel = COLLECTION_DUE_STATUS_LABELS[row.status] || row.status || '-';
                      const isActive = ACTIVE_COLLECTION_STATUSES.has(row.status);
                      const isBusy = actionId === row.id;

                      return (
                        <TableRow key={row.id}>
                          <TableCell>{row.client_name || '-'}</TableCell>
                          <TableCell>{row.project_name || '-'}</TableCell>
                          <TableCell>{row.invoice_reference || '-'}</TableCell>
                          <TableCell>{formatAmount(row.amount_due)}</TableCell>
                          <TableCell>{formatAmount(row.amount_paid)}</TableCell>
                          <TableCell>{formatAmount(row.remaining_amount)}</TableCell>
                          <TableCell>{formatTaxInvoiceSent(row)}</TableCell>
                          <TableCell>{formatDateTime(row.opened_at)}</TableCell>
                          <TableCell>{formatDate(row.due_date)}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="font-normal">
                              {statusLabel}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[220px] truncate" title={row.notes || ''}>
                            {row.notes || '-'}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              <Button asChild size="sm" variant="outline">
                                <Link to={buildCollectionDueFormPageUrl({ collectionDueId: row.id })}>
                                  פתח
                                </Link>
                              </Button>
                              {isActive ? (
                                <>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    disabled={isBusy}
                                    onClick={() => setCompleteTarget(row)}
                                  >
                                    סיום גבייה
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="destructive"
                                    disabled={isBusy}
                                    onClick={() => { void handleCancel(row); }}
                                  >
                                    בטל
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <CompleteCollectionDueDialog
        open={Boolean(completeTarget)}
        onOpenChange={(open) => {
          if (!open) setCompleteTarget(null);
        }}
        collectionDue={completeTarget}
        onComplete={handleComplete}
        isSaving={Boolean(completeTarget && actionId === completeTarget.id)}
      />
    </div>
  );
}
