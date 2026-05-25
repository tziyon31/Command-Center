import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import {
  deleteInquiry,
  INQUIRY_DELETE_CONFIRM_MESSAGE,
  isInquiryVisibleInList,
} from '@/lib/inquiryDelete';
import { buildInquiryCopyText, copyTextToClipboard } from '@/lib/inquiryCopy';
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

const FORM_STATUS_LABELS = {
  draft: 'טיוטה',
  submitted: 'הוגש',
  cancelled: 'בוטל',
};

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

const COPY_SUCCESS_MESSAGE = 'הפנייה הועתקה ללוח';

const inquiryRowToCopyFields = (inquiry) => ({
  client_name: inquiry?.client_name || '',
  building_type: inquiry?.building_type || '',
  area: inquiry?.area ?? '',
  cooling_tons: inquiry?.cooling_tons ?? '',
  details: inquiry?.details || '',
});

const sortInquiries = (inquiries) => {
  return [...inquiries].sort((left, right) => {
    const leftTime = new Date(left.created_date || left.updated_date || 0).getTime();
    const rightTime = new Date(right.created_date || right.updated_date || 0).getTime();
    return rightTime - leftTime;
  });
};

export default function Inquiries() {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState(null);
  const [copyingId, setCopyingId] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState(null);

  const { data: inquiries = [], isLoading } = useQuery({
    queryKey: ['inquiries'],
    queryFn: async () => {
      const items = await base44.entities.Inquiry.list('-created_date');
      return sortInquiries(items.filter(isInquiryVisibleInList));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteInquiry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inquiries'] });
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
    },
  });

  const handleCopyInquiry = async (inquiry) => {
    setCopyingId(inquiry.id);
    setCopyFeedback(null);

    try {
      const text = buildInquiryCopyText(inquiryRowToCopyFields(inquiry));
      await copyTextToClipboard(text);
      await base44.entities.Inquiry.update(inquiry.id, {
        copied_to_ai_at: new Date().toISOString(),
      });
      setCopyFeedback(COPY_SUCCESS_MESSAGE);
      queryClient.invalidateQueries({ queryKey: ['inquiries'] });
    } catch (error) {
      console.error('[Inquiries] failed to copy inquiry', error);
      alert('לא הצלחתי להעתיק את הפנייה');
    } finally {
      setCopyingId(null);
    }
  };

  const handleDeleteInquiry = async (inquiryId) => {
    const confirmed = window.confirm(INQUIRY_DELETE_CONFIRM_MESSAGE);
    if (!confirmed) return;

    setDeletingId(inquiryId);

    try {
      await deleteMutation.mutateAsync(inquiryId);
    } catch (error) {
      console.error('[Inquiry] failed to delete inquiry', error);
      alert('לא הצלחתי למחוק את הפנייה');
    } finally {
      setDeletingId(null);
    }
  };

  const rows = useMemo(() => inquiries, [inquiries]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50" dir="rtl">
      <div className="max-w-[1400px] mx-auto px-8 py-10 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">פניות</h1>
            <p className="text-muted-foreground mt-1">רשימת פניות וטפסים</p>
          </div>
          <Link to={createPageUrl('InquiryForm')}>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              פנייה חדשה
            </Button>
          </Link>
        </div>

        {copyFeedback && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {copyFeedback}
          </p>
        )}

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="p-6 text-sm text-muted-foreground">טוען פניות...</p>
            ) : rows.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">אין פניות להצגה</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">שם לקוח</TableHead>
                    <TableHead className="text-right">סוג מבנה</TableHead>
                    <TableHead className="text-right">סטטוס</TableHead>
                    <TableHead className="text-right">נוצר</TableHead>
                    <TableHead className="text-right">עודכן</TableHead>
                    <TableHead className="text-right w-[240px]">פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((inquiry) => (
                    <TableRow key={inquiry.id}>
                      <TableCell className="font-medium">
                        {inquiry.client_name?.trim() || 'ללא שם לקוח'}
                      </TableCell>
                      <TableCell>{inquiry.building_type || '-'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {FORM_STATUS_LABELS[inquiry.form_status] || inquiry.form_status || 'טיוטה'}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDateTime(inquiry.created_date)}</TableCell>
                      <TableCell>{formatDateTime(inquiry.updated_date)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 justify-end">
                          <Link to={createPageUrl(`InquiryForm?id=${inquiry.id}`)}>
                            <Button type="button" variant="outline" size="sm">
                              פתח
                            </Button>
                          </Link>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={copyingId === inquiry.id || deletingId === inquiry.id}
                            onClick={() => handleCopyInquiry(inquiry)}
                          >
                            {copyingId === inquiry.id ? 'מעתיק...' : 'העתק'}
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={deletingId === inquiry.id || copyingId === inquiry.id}
                            onClick={() => handleDeleteInquiry(inquiry.id)}
                          >
                            {deletingId === inquiry.id ? 'מוחק...' : 'מחק'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
