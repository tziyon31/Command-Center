import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { runProjectReminderIntegrityAudit } from '@/lib/projectReminderIntegrityAudit';
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
  { key: 'staleProjectReminders', title: 'תזכורות חשודות / לא מתאימות לסטטוס' },
  { key: 'statusWorkflowMismatches', title: 'Project.status לא תואם ל-Workflow (דיווח בלבד)' },
  { key: 'missingReminderCandidates', title: 'פרויקטים פעילים בלי תזכורת' },
  { key: 'missingTargetOrOrphan', title: 'תזכורות עם יעד חסר / לא פתיר' },
  { key: 'intakeReminders', title: 'תזכורות Intake / לידים שאינן שייכות לפרויקט' },
  { key: 'unknownConditionKeys', title: 'condition_key לא מוכר' },
  { key: 'validProjectReminders', title: 'תזכורות תקינות' },
  { key: 'completedNeedsPolicy', title: 'פרויקטים שבוצעו ודורשים החלטת מדיניות להמשך מעקב בנייה / מתקן' },
  { key: 'completedNoWorkflowNeeded', title: 'פרויקטים שהושלמו — ללא צורך בתזכורות Workflow (דיווח בלבד)' },
  { key: 'workflowExcludedProjects', title: 'פרויקטים מוחרגים מ-Workflow (אישור אהרון)' },
];

const SEVERITY_LABELS = {
  info: 'מידע',
  warning: 'אזהרה',
  warning_high: 'אזהרה גבוהה',
  error: 'שגיאה',
};

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

function ReminderTable({ rows = [] }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">אין רשומות בקבוצה זו.</p>;
  }

  const isReminderRow = Boolean(rows[0]?.reminder_id);

  if (!isReminderRow) {
    return (
      <div className="overflow-auto max-h-96 border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>פרויקט</TableHead>
              <TableHead>סטטוס</TableHead>
              <TableHead>תזכורות / Workflow</TableHead>
              <TableHead>חומרה</TableHead>
              <TableHead>סיבה</TableHead>
              <TableHead>פעולה מומלצת</TableHead>
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
                <TableCell>{row.project_status_label || row.project_status}</TableCell>
                <TableCell>{row.workflow_state || row.active_reminders_count || '-'}</TableCell>
                <TableCell>{SEVERITY_LABELS[row.severity] || row.severity || '-'}</TableCell>
                <TableCell className="text-xs">{row.reason}</TableCell>
                <TableCell className="text-xs">{row.recommended_action}</TableCell>
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
            <TableHead>כותרת</TableHead>
            <TableHead>condition_key</TableHead>
            <TableHead>פרויקט</TableHead>
            <TableHead>סטטוס פרויקט</TableHead>
            <TableHead>חומרה</TableHead>
            <TableHead>סיבה</TableHead>
            <TableHead>פעולה מומלצת</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.reminder_id}>
              <TableCell>{row.reminder_title || '-'}</TableCell>
              <TableCell className="text-xs">{row.condition_key || '-'}</TableCell>
              <TableCell className="text-xs">
                {row.project_id ? (
                  <Link
                    to={createPageUrl(`ProjectDetails?id=${row.project_id}`)}
                    className="text-primary hover:underline"
                  >
                    {row.project_name || row.project_id}
                  </Link>
                ) : '-'}
              </TableCell>
              <TableCell className="text-xs">{row.project_status_label || row.project_status || '-'}</TableCell>
              <TableCell>{SEVERITY_LABELS[row.severity] || row.severity}</TableCell>
              <TableCell className="text-xs">{row.reason}</TableCell>
              <TableCell className="text-xs">{row.recommended_action}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function ProjectReminderIntegrityAudit() {
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
      const result = await runProjectReminderIntegrityAudit();
      setReport(result);
    } catch (auditError) {
      console.error('[ProjectReminderIntegrityAudit] audit failed', auditError);
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
          <h1 className="text-3xl font-bold">P2E - בדיקת תקינות תזכורות</h1>
          <p className="text-muted-foreground mt-2">
            אבחון read-only בלבד. בודק האם תזכורות פעילות עדיין מתאימות לסטטוס הנוכחי של הפרויקט.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" asChild>
            <Link to={createPageUrl('ProjectPipeline')}>חזרה ל-Pipeline</Link>
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
            <SummaryCard label="תזכורות פעילות" value={report.counts.activeRemindersTotal} />
            <SummaryCard label="תקינות" value={report.counts.validProjectRemindersCount} />
            <SummaryCard label="חשודות / stale" value={report.counts.staleProjectRemindersCount} />
            <SummaryCard label="חסרות יעד" value={report.counts.missingTargetOrOrphanCount} />
            <SummaryCard label="Intake" value={report.counts.intakeRemindersCount} />
            <SummaryCard label="חסרי תזכורת" value={report.counts.missingReminderCandidatesCount} />
            <SummaryCard label="דורשים policy" value={report.counts.completedNeedsPolicyCount} />
            <SummaryCard label="completed ללא Workflow" value={report.counts.completedNoWorkflowNeededCount ?? 0} />
            <SummaryCard label="סתירת status/workflow" value={report.counts.statusWorkflowMismatchesCount ?? 0} />
            <SummaryCard label="מוחרגים מ-Workflow" value={report.counts.workflowExcludedProjectsCount ?? 0} />
          </div>

          {report.entityAvailability ? (
            <Card>
              <CardHeader>
                <CardTitle>זמינות ישויות</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-1">
                <div>
                  SignedProposal:
                  {' '}
                  {report.entityAvailability.supportsSignedProposal ? 'זמין' : 'לא זמין'}
                  {report.entityAvailability.supportsSignedProposal
                    ? ` (${report.entityAvailability.signedProposalsLoaded} רשומות)`
                    : ''}
                </div>
                <div>
                  Quote:
                  {' '}
                  {report.entityAvailability.supportsQuote ? 'זמין' : 'לא זמין'}
                  {report.entityAvailability.supportsQuote
                    ? ` (${report.entityAvailability.quotesLoaded} רשומות)`
                    : ''}
                </div>
              </CardContent>
            </Card>
          ) : null}

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
                <ReminderTable rows={report.groups[section.key] || []} />
              </CardContent>
            </Card>
          ))}
        </>
      ) : null}
    </div>
  );
}
