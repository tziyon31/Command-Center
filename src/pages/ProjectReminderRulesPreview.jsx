import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { runProjectReminderRulesPreview } from '@/lib/projectReminderRulesPreview';
import {
  APPLY_PRICING_PROPOSAL_REMINDERS_CONFIRM_TEXT,
  APPLY_PROJECT_REMINDER_RULES_CONFIRM_TEXT,
  runProjectLifecycleReminderRulesForAll,
} from '@/lib/projectLifecycleReminderRules';
import { isLocalDevEnvironment } from '@/lib/isLocalDev';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const PREVIEW_SECTIONS = [
  { key: 'staleProposalRemindersToResolve', title: 'תזכורות הצעת מחיר שייסגרו' },
  { key: 'pricingProposalRemindersToCreate', title: 'תזכורות הצעת מחיר שיווצרו לפרויקטים בתמחור (P2H)' },
  { key: 'waitingFollowupRemindersToCreate', title: 'תזכורות follow-up שיווצרו עבור waiting (ללא workflow)' },
  { key: 'workStageRemindersToCreate', title: 'תזכורות שלבי עבודה שיווצרו (SignedProposal או signed/execution)' },
  { key: 'projectWorkStageRemindersToResolve', title: 'תזכורות שייסגרו (יש WorkStages / אין מקור workflow)' },
  { key: 'duplicatesPrevented', title: 'כפילויות שנמנעו / כבר מכוסה' },
  { key: 'statusWorkflowMismatches', title: 'Project.status לא תואם ל-Workflow (דיווח בלבד — לא מבוצעת פעולה)' },
  { key: 'excludedWorkflowRemindersToResolve', title: 'תזכורות workflow פעילות על פרויקטים מוחרגים (ייסגרו ב-Apply)' },
  { key: 'workflowExcludedProjects', title: 'פרויקטים מוחרגים מ-Workflow (אישור אהרון — דיווח בלבד)' },
];

const ACCEPTED_CONFIRM_TEXTS = [
  APPLY_PRICING_PROPOSAL_REMINDERS_CONFIRM_TEXT,
  APPLY_PROJECT_REMINDER_RULES_CONFIRM_TEXT,
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

function PlannedActionsTable({ rows = [] }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">אין פעולות מתוכננות בקבוצה זו.</p>;
  }

  return (
    <div className="overflow-auto max-h-96 border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>פרויקט</TableHead>
            <TableHead>סטטוס</TableHead>
            <TableHead>condition_key</TableHead>
            <TableHead>פעולה</TableHead>
            <TableHead>כותרת תזכורת</TableHead>
            <TableHead>סיבה</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.project_id}-${row.reminder_kind}-${row.action}`}>
              <TableCell>
                <Link
                  to={createPageUrl(`ProjectDetails?id=${row.project_id}`)}
                  className="text-primary hover:underline"
                >
                  {row.project_name || row.project_id}
                </Link>
              </TableCell>
              <TableCell className="text-xs">{row.project_status}</TableCell>
              <TableCell className="text-xs font-mono" dir="ltr">
                {row.condition_key || row.workflow_state || '-'}
              </TableCell>
              <TableCell className="text-xs">
                {row.action === 'create' ? 'יצירה' : null}
                {row.action === 'resolve' ? 'סגירה' : null}
                {row.action === 'skip_duplicate' ? 'דילוג (כפילות)' : null}
                {row.action === 'report_only' ? 'דיווח בלבד' : null}
              </TableCell>
              <TableCell className="text-xs">
                {row.reminder_input?.title || row.reminder_title || '-'}
              </TableCell>
              <TableCell className="text-xs">{row.reason}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function ProjectReminderRulesPreview() {
  const [report, setReport] = useState(null);
  const [applyResult, setApplyResult] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const canAccess = useMemo(() => (
    isLocalDevEnvironment() || currentUser?.role === 'admin'
  ), [currentUser?.role]);

  const handleRunPreview = async () => {
    setRunning(true);
    setError('');
    setApplyResult(null);
    try {
      const result = await runProjectReminderRulesPreview();
      setReport(result);
    } catch (previewError) {
      console.error('[ProjectReminderRulesPreview] preview failed', previewError);
      setError('ה-Preview נכשל. בדוק את ה-console.');
    } finally {
      setRunning(false);
    }
  };

  const handleCopyReport = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
  };

  const confirmTextIsValid = ACCEPTED_CONFIRM_TEXTS.includes(confirmText);

  const handleApply = async () => {
    if (!confirmTextIsValid) {
      setError(`יש להקליד בדיוק את אחד מהטקסטים: ${ACCEPTED_CONFIRM_TEXTS.join(' / ')}`);
      return;
    }

    setApplying(true);
    setError('');
    try {
      const result = await runProjectLifecycleReminderRulesForAll({
        apply: true,
        dryRun: false,
        confirmText,
      });
      setApplyResult(result);
      setConfirmText('');
    } catch (applyError) {
      console.error('[ProjectReminderRulesPreview] apply failed', applyError);
      setError(applyError?.message || 'ה-Apply נכשל. בדוק את ה-console.');
    } finally {
      setApplying(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-2xl font-bold mb-4">Project Reminder Rules Preview</h1>
        <p className="text-muted-foreground">
          This page is available only in local development/admin mode.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-8" dir="rtl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">P2G - Preview התאמת חוקי תזכורות לפרויקטים</h1>
          <p className="text-muted-foreground mt-2">
            ה-Preview הוא read-only בלבד. mutation מתבצע רק דרך Apply עם אישור מפורש.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" asChild>
            <Link to={createPageUrl('ProjectPipeline')}>חזרה ל-Pipeline</Link>
          </Button>
          <Button type="button" onClick={handleRunPreview} disabled={running}>
            {running ? 'מריץ Preview...' : 'הרץ Preview'}
          </Button>
          <Button type="button" variant="outline" onClick={handleCopyReport} disabled={!report}>
            Copy JSON
          </Button>
        </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6 text-red-600">{error}</CardContent>
        </Card>
      ) : null}

      {applyResult ? (
        <Card className="border-emerald-300">
          <CardHeader>
            <CardTitle>תוצאת Apply</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>נסגרו: {applyResult.executed.resolved}</div>
            <div>נוצרו: {applyResult.executed.created}</div>
            <div>דולגו: {applyResult.executed.skipped}</div>
            <div>שגיאות: {applyResult.executed.errors.length}</div>
            {applyResult.rateLimited ? (
              <div className="text-amber-700">הופסק עקב rate limit — הרץ שוב להמשך.</div>
            ) : null}
            <div className="text-muted-foreground mt-2">
              מומלץ להריץ P2E שוב לאימות התוצאה.
            </div>
          </CardContent>
        </Card>
      ) : null}

      {report ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <SummaryCard label="פרויקטים נבדקו" value={report.projectsChecked} />
            <SummaryCard label="הצעות מחיר שייסגרו" value={report.counts.staleProposalRemindersToResolve} />
            <SummaryCard label="הצעות מחיר שיווצרו (pricing)" value={report.counts.pricingProposalRemindersToCreate ?? 0} />
            <SummaryCard label="follow-up שיווצרו" value={report.counts.waitingFollowupRemindersToCreate} />
            <SummaryCard label="שלבי עבודה שיווצרו" value={report.counts.workStageRemindersToCreate} />
            <SummaryCard label="תזכורות שייסגרו" value={report.counts.projectWorkStageRemindersToResolve} />
            <SummaryCard label="כפילויות שנמנעו" value={report.counts.duplicatesPrevented} />
            <SummaryCard label="סתירת status/workflow" value={report.counts.statusWorkflowMismatches ?? 0} />
            <SummaryCard label="מוחרגים מ-Workflow" value={report.counts.workflowExcludedProjectsCount ?? 0} />
            <SummaryCard label="תזכורות מוחרגות לסגירה" value={report.counts.excludedWorkflowRemindersToResolve ?? 0} />
          </div>

          {PREVIEW_SECTIONS.map((section) => (
            <Card key={section.key}>
              <CardHeader>
                <CardTitle>
                  {section.title}
                  {' '}
                  ({(report.groups[section.key] || []).length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PlannedActionsTable rows={report.groups[section.key] || []} />
              </CardContent>
            </Card>
          ))}

          <Card className="border-amber-300">
            <CardHeader>
              <CardTitle>Apply — ביצוע בפועל (admin בלבד)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                ליצירת תזכורות pricing חסרות (P2H) יש להקליד במדויק:
                {' '}
                <span className="font-mono" dir="ltr">{APPLY_PRICING_PROPOSAL_REMINDERS_CONFIRM_TEXT}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                ליישור מלא של כל החוקים (P2G) ניתן גם להקליד:
                {' '}
                <span className="font-mono" dir="ltr">{APPLY_PROJECT_REMINDER_RULES_CONFIRM_TEXT}</span>
              </p>
              <div className="flex gap-2 items-center">
                <Input
                  dir="ltr"
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  placeholder={APPLY_PRICING_PROPOSAL_REMINDERS_CONFIRM_TEXT}
                  className="max-w-md font-mono"
                />
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleApply}
                  disabled={applying || !confirmTextIsValid}
                >
                  {applying ? 'מבצע Apply...' : 'Apply with confirmation'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
