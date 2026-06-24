import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api as base44 } from '@/api/apiClient';
import { createPageUrl } from '@/utils';
import { buildInvoiceProcessFormPageUrl } from '@/lib/workflowNavigation';
import {
  FORM_STATUS_LABELS,
  INVOICE_SCOPE_LABELS,
  formatInvoiceRelatedStagesDisplay,
} from '@/lib/invoiceProcessUtils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus } from 'lucide-react';

const DELETE_CONFIRM_MESSAGE = 'למחוק את תהליך החשבונית? פעולה זו לא ניתנת לביטול.';

const EMPTY_STATE_MESSAGE = 'אין עדיין תהליכי חשבונית.';

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

const formatBoolean = (value) => (value === true ? 'כן' : 'לא');

const formatAmount = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) return '-';
  return new Intl.NumberFormat('he-IL').format(amount);
};

const sortInvoiceProcesses = (items) => (
  [...items].sort((left, right) => {
    const leftTime = new Date(left.created_date || left.updated_date || 0).getTime();
    const rightTime = new Date(right.created_date || right.updated_date || 0).getTime();
    return rightTime - leftTime;
  })
);

export default function Invoices() {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState(null);

  const { data: invoiceProcesses = [], isLoading } = useQuery({
    queryKey: ['invoice-processes'],
    queryFn: async () => {
      const items = await base44.entities.InvoiceProcess.list('-created_date');
      return sortInvoiceProcesses(items);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.InvoiceProcess.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice-processes'] });
    },
  });

  const rows = useMemo(() => invoiceProcesses, [invoiceProcesses]);

  const handleDelete = async (id) => {
    const confirmed = window.confirm(DELETE_CONFIRM_MESSAGE);
    if (!confirmed) return;

    setDeletingId(id);

    try {
      await deleteMutation.mutateAsync(id);
    } catch (error) {
      console.error('[Invoices] failed to delete', error);
      alert('לא הצלחנו למחוק את תהליך החשבונית');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50" dir="rtl">
      <div className="max-w-[1600px] mx-auto px-8 py-10 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">חשבוניות</h1>
            <p className="text-muted-foreground mt-1">מעקב אחרי תהליכי חשבונית לפרויקטים ושלבי עבודה</p>
          </div>
          <Link to={createPageUrl('InvoiceProcessForm')}>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              תהליך חשבונית חדש
            </Button>
          </Link>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="p-6 text-sm text-muted-foreground">טוען תהליכי חשבונית...</p>
            ) : rows.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">{EMPTY_STATE_MESSAGE}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">לקוח</TableHead>
                      <TableHead className="text-right">פרויקט</TableHead>
                      <TableHead className="text-right">סוג חשבונית</TableHead>
                      <TableHead className="text-right">שלבים קשורים</TableHead>
                      <TableHead className="text-right">אסמכתא</TableHead>
                      <TableHead className="text-right">סכום</TableHead>
                      <TableHead className="text-right">נוצרה ב-Paperless?</TableHead>
                      <TableHead className="text-right">נשלחה ללקוח?</TableHead>
                      <TableHead className="text-right">הלקוח אישר קבלה?</TableHead>
                      <TableHead className="text-right">מצב טופס</TableHead>
                      <TableHead className="text-right">נוצר</TableHead>
                      <TableHead className="text-right">עודכן</TableHead>
                      <TableHead className="text-right">פעולות</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const scopeLabel = INVOICE_SCOPE_LABELS[row.invoice_scope] || row.invoice_scope || '-';
                      const stageTitles = formatInvoiceRelatedStagesDisplay(row);
                      const statusLabel = FORM_STATUS_LABELS[row.form_status] || row.form_status || '-';

                      return (
                        <TableRow key={row.id}>
                          <TableCell>{row.client_name || '-'}</TableCell>
                          <TableCell>{row.project_name || '-'}</TableCell>
                          <TableCell>{scopeLabel}</TableCell>
                          <TableCell className="max-w-[200px] truncate" title={stageTitles}>
                            {stageTitles || '-'}
                          </TableCell>
                          <TableCell>{row.invoice_reference || '-'}</TableCell>
                          <TableCell>{formatAmount(row.amount)}</TableCell>
                          <TableCell>{formatBoolean(row.invoice_created_in_paperless)}</TableCell>
                          <TableCell>{formatBoolean(row.invoice_sent_to_client)}</TableCell>
                          <TableCell>{formatBoolean(row.client_confirmed_received)}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="font-normal">
                              {statusLabel}
                            </Badge>
                          </TableCell>
                          <TableCell>{formatDateTime(row.created_date)}</TableCell>
                          <TableCell>{formatDateTime(row.updated_date)}</TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button asChild size="sm" variant="outline">
                                <Link to={buildInvoiceProcessFormPageUrl({ invoiceProcessId: row.id })}>
                                  פתח
                                </Link>
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                disabled={deletingId === row.id}
                                onClick={() => handleDelete(row.id)}
                              >
                                מחק
                              </Button>
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
    </div>
  );
}
