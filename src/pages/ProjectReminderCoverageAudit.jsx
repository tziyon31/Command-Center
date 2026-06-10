import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import {
  COVERAGE_STATUS_LABELS,
  runProjectReminderCoverageAudit,
} from '@/lib/projectReminderCoverageAudit';
import { canAccessAdminPage } from '@/lib/adminAccess';
import AdminAccessDenied from '@/components/admin/AdminAccessDenied';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const AUDIT_SECTIONS = [
  { key: 'activeProjectsWithoutReminder', title: 'פרויקטים פעילים בלי תזכורת' },
  { key: 'openCollectionDueWithoutReminder', title: 'גביות פתוחות בלי תזכורת גבייה' },
  { key: 'completedNeedsPolicy', title: 'completed שדורשים policy לסטטוס בנייה / מתקן' },
  { key: 'unmappedReminders', title: 'תזכורות שלא ממופות לפרויקט' },
];

function SummaryCard({ label, value }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

function CoverageTable({ rows = [] }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">אין רשומות בקבוצה זו.</p>;
  }

  const isProjectRow = Boolean(rows[0]?.project_id);

  if (!isProjectRow) {
    return (
      <div className="overflow-auto max-h-96 border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>כותרת</TableHead>
              <TableHead>condition_key</TableHead>
              <TableHead>source</TableHead>
              <TableHead>action_url</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.title || '-'}</TableCell>
                <TableCell className="text-xs">{row.condition_key || '-'}</TableCell>
                <TableCell className="text-xs">
                  {row.source_type || '-'}
                  {row.source_id ? ` / ${row.source_id}` : ''}
                </TableCell>
                <TableCell className="text-xs">{row.action_url || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="overflow-auto max-h-96 border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>פרויקט</TableHead>
            <TableHead>סטטוס</TableHead>
            <TableHead>תזכורות</TableHead>
            <TableHead>כיסוי</TableHead>
            <TableHead>סיבה</TableHead>
            <TableHead>שאלה עסקית</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.project_id}>
              <TableCell>
                <Link
                  to={createPageUrl(`ProjectDetails?id=${row.project_id}`)}
                  className="text-primary hover:underline"
                >
                  {row.project_name || row.project_id}
                </Link>
              </TableCell>
              <TableCell>{row.status_label}</TableCell>
              <TableCell>{row.active_reminders_count}</TableCell>
              <TableCell>{COVERAGE_STATUS_LABELS[row.coverage_status] || row.coverage_status}</TableCell>
              <TableCell className="text-xs">{row.coverage_reason}</TableCell>
              <TableCell className="text-xs">{row.suggested_business_question || '-'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function ProjectReminderCoverageAudit() {
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const canAccessAudit = useMemo(
    () => canAccessAdminPage(currentUser),
    [currentUser],
  );

  const handleRunAudit = async () => {
    setRunning(true);
    setError('');
    try {
      const result = await runProjectReminderCoverageAudit();
      setReport(result);
    } catch (auditError) {
      console.error('[ProjectReminderCoverageAudit] audit failed', auditError);
      setError('האבחון נכשל. בדוק את ה-console.');
    } finally {
      setRunning(false);
    }
  };

  const handleCopyReport = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
  };

  if (userLoading) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-muted-foreground">טוען...</div>;
  }

  if (!canAccessAudit) {
    return <AdminAccessDenied />;
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-8" dir="rtl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">P2D - בדיקת כיסוי תזכורות</h1>
          <p className="text-muted-foreground mt-2">
            אבחון read-only בלבד. בודק האם לפרויקטים רלוונטיים יש תזכורת פעילה או סיבה ברורה לחוסר.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" asChild>
            <Link to={createPageUrl('ProjectPipeline')}>חזרה ל-Pipeline</Link>
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link to={createPageUrl('ProjectReminderIntegrityAudit')}>בדוק תקינות תזכורות</Link>
          </Button>
          <Button type="button" onClick={handleRunAudit} disabled={running}>
            {running ? 'מריץ אבחון...' : 'הרץ אבחון'}
          </Button>
          <Button type="button" variant="outline" onClick={handleCopyReport} disabled={!report}>
            Copy JSON report
          </Button>
        </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6 text-red-600">{error}</CardContent>
        </Card>
      ) : null}

      {report ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard label="פרויקטים" value={report.counts.projectsTotal} />
            <SummaryCard label="תזכורות (כלל)" value={report.counts.remindersTotal} />
            <SummaryCard label="תזכורות פעילות" value={report.counts.activeRemindersTotal} />
            <SummaryCard label="ממופות לפרויקט" value={report.counts.mappedRemindersCount} />
            <SummaryCard label="לא ממופות" value={report.counts.unmappedRemindersCount} />
            <SummaryCard label="מועמדים לתזכורת" value={report.counts.shouldHaveReminderCandidatesCount} />
            <SummaryCard label="חסרי תזכורת" value={report.counts.missingReminderCandidatesCount} />
            <SummaryCard label="גבייה פתוחה בלי תזכורת" value={report.counts.openCollectionDueWithoutReminderCount} />
            <SummaryCard label="בתמחור בלי תזכורת" value={report.counts.pricingWithoutReminderCount} />
            <SummaryCard label="ממתינים בלי תזכורת" value={report.counts.waitingWithoutReminderCount} />
            <SummaryCard label="התקבלה בלי תזכורת" value={report.counts.signedWithoutReminderCount} />
            <SummaryCard label="בעבודה בלי תזכורת" value={report.counts.executionWithoutReminderCount} />
            <SummaryCard label="דורשים policy" value={report.counts.completedNeedsPolicyCount} />
          </div>

          {AUDIT_SECTIONS.map((section) => (
            <Card key={section.key}>
              <CardHeader>
                <CardTitle>
                  {section.title}
                  {' '}
                  ({(report.groups[section.key] || []).length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CoverageTable rows={report.groups[section.key] || []} />
              </CardContent>
            </Card>
          ))}
        </>
      ) : null}
    </div>
  );
}
