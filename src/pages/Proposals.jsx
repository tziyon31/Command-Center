import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { cancelRemindersForDeletedSource } from '@/lib/reminderEngine';
import { createPageUrl } from '@/utils';
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

const DELETE_CONFIRM_MESSAGE = 'למחוק את הצעת המחיר? פעולה זו לא ניתנת לביטול.';

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

const formatBoolean = (value) => (value ? 'כן' : 'לא');

const sortProposals = (items) => (
  [...items].sort((left, right) => {
    const leftTime = new Date(left.created_date || left.updated_date || 0).getTime();
    const rightTime = new Date(right.created_date || right.updated_date || 0).getTime();
    return rightTime - leftTime;
  })
);

export default function Proposals() {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState(null);

  const { data: proposals = [], isLoading } = useQuery({
    queryKey: ['proposals'],
    queryFn: async () => {
      const items = await base44.entities.Proposal.list('-created_date');
      return sortProposals(items);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Proposal.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proposals'] });
    },
  });

  const rows = useMemo(() => proposals, [proposals]);

  const handleDelete = async (id) => {
    const confirmed = window.confirm(DELETE_CONFIRM_MESSAGE);
    if (!confirmed) return;

    setDeletingId(id);

    try {
      await deleteMutation.mutateAsync(id);
      await cancelRemindersForDeletedSource('proposal', id);
    } catch (error) {
      console.error('[Proposals] failed to delete', error);
      alert('לא הצלחנו למחוק את הצעת המחיר');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50" dir="rtl">
      <div className="max-w-[1400px] mx-auto px-8 py-10 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">הצעות מחיר</h1>
            <p className="text-muted-foreground mt-1">מעקב אחרי הצעות מחיר שנשלחו ללקוחות</p>
          </div>
          <Link to={createPageUrl('ProposalForm')}>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              הצעת מחיר חדשה
            </Button>
          </Link>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="p-6 text-sm text-muted-foreground">טוען הצעות מחיר...</p>
            ) : rows.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">אין הצעות מחיר להצגה</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">לקוח</TableHead>
                    <TableHead className="text-right">פרויקט</TableHead>
                    <TableHead className="text-right">סטטוס</TableHead>
                    <TableHead className="text-right">נשלחה?</TableHead>
                    <TableHead className="text-right">תאריך שליחה</TableHead>
                    <TableHead className="text-right">נראתה?</TableHead>
                    <TableHead className="text-right">תאריך צפייה</TableHead>
                    <TableHead className="text-right">נוצר</TableHead>
                    <TableHead className="text-right">עודכן</TableHead>
                    <TableHead className="text-right w-[180px]">פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.client_name?.trim() || '-'}
                      </TableCell>
                      <TableCell>{item.project_name?.trim() || '-'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {FORM_STATUS_LABELS[item.form_status] || item.form_status || 'טיוטה'}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatBoolean(item.proposal_sent_to_client)}</TableCell>
                      <TableCell>{formatDateTime(item.proposal_sent_at)}</TableCell>
                      <TableCell>{formatBoolean(item.client_saw_proposal)}</TableCell>
                      <TableCell>{formatDateTime(item.client_saw_at)}</TableCell>
                      <TableCell>{formatDateTime(item.created_date)}</TableCell>
                      <TableCell>{formatDateTime(item.updated_date)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 justify-end">
                          <Link to={createPageUrl(`ProposalForm?id=${item.id}`)}>
                            <Button type="button" variant="outline" size="sm">
                              פתח
                            </Button>
                          </Link>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={deletingId === item.id}
                            onClick={() => handleDelete(item.id)}
                          >
                            {deletingId === item.id ? 'מוחק...' : 'מחק'}
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
