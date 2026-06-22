import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { runProjectReminderRulesPreview } from '@/lib/projectReminderRulesPreview';
import {
  applyProjectWorkflowOnboarding,
  runProjectWorkflowOnboardingPreview,
} from '@/lib/projectWorkflowOnboardingPreview';
import { APPLY_PROJECT_WORKFLOW_ONBOARDING_CONFIRM_TEXT } from '@/lib/projectWorkflowOnboarding';
import {
  APPLY_PRICING_PROPOSAL_REMINDERS_CONFIRM_TEXT,
  APPLY_PROJECT_REMINDER_RULES_CONFIRM_TEXT,
  PLANNER_MODE_LEGACY_BOOTSTRAP,
  PLANNER_MODE_RUNTIME,
  runProjectLifecycleReminderRulesForAll,
} from '@/lib/projectLifecycleReminderRules';
import { canAccessAdminPage, canRunAdminMutations } from '@/lib/adminAccess';
import AdminAccessDenied from '@/components/admin/AdminAccessDenied';
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
  { key: 'pricingProposalRemindersToCreate', title: 'תזכורות הצעת מחיר שיווצרו (P2H legacy / runtime לפי records)' },
  { key: 'waitingFollowupRemindersToCreate', title: 'תזכורות follow-up שיווצרו עבור waiting (legacy bootstrap בלבד)' },
  { key: 'proposalFollowupRemindersToCreate', title: 'תזכורות follow-up שיווצרו לפי Proposal submitted (runtime בלבד)' },
  { key: 'workStageRemindersToCreate', title: 'תזכורות שלבי עבודה שיווצרו' },
  { key: 'projectWorkStageRemindersToResolve', title: 'תזכורות שייסגרו (יש WorkStages / אין מקור workflow)' },
  { key: 'duplicatesPrevented', title: 'כפילויות שנמנעו / כבר מכוסה' },
  { key: 'statusWorkflowMismatches', title: 'Project.status לא תואם ל-Workflow (דיווח בלבד — לא מבוצעת פעולה)' },
  { key: 'excludedWorkflowRemindersToResolve', title: 'תזכורות workflow פעילות על פרויקטים מוחרגים (ייסגרו ב-Apply)' },
  { key: 'workflowExcludedProjects', title: 'פרויקטים מוחרגים מ-Workflow (אישור אהרון — דיווח בלבד)' },
  { key: 'runtimeEvidenceGaps', title: 'פערי ראיות ב-runtime — status ללא records (דיווח בלבד)' },
  { key: 'completedNoReminders', title: 'completed_no_reminders (דיווח בלבד)' },
  { key: 'closedProjectsNoWorkflow', title: 'פרויקטים rejected/cancelled (דיווח בלבד)' },
];

const ONBOARDING_SECTIONS = [
  { key: 'proposal', title: 'הצעת onboarding: entry_stage = proposal' },
  { key: 'proposal_followup', title: 'הצעת onboarding: entry_stage = proposal_followup' },
  { key: 'work_stages', title: 'הצעת onboarding: entry_stage = work_stages' },
  { key: 'completed_no_reminders', title: 'הצעת onboarding: completed_no_reminders' },
  { key: 'alreadyOnboarded', title: 'כבר onboarded' },
  { key: 'workflowExcludedProjects', title: 'פרויקטים מוחרגים' },
];

const MODE_LABELS = {
  [PLANNER_MODE_LEGACY_BOOTSTRAP]: 'Legacy Bootstrap (מיגרציה — מותר Project.status)',
  [PLANNER_MODE_RUNTIME]: 'Runtime (records בלבד — ללא Project.status)',
};

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

function OnboardingTable({ rows = [] }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">אין הצעות onboarding בקבוצה זו.</p>;
  }

  return (
    <div className="overflow-auto max-h-96 border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>פרויקט</TableHead>
            <TableHead>סטטוס</TableHead>
            <TableHead>entry_stage מוצע</TableHead>
            <TableHead>exemptions מוצעות</TableHead>
            <TableHead>סיבה</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.project_id}-${row.bucket}-${row.action}`}>
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
                {row.suggested_patch?.workflow_entry_stage || row.current_fields?.workflow_entry_stage || '-'}
              </TableCell>
              <TableCell className="text-xs font-mono" dir="ltr">
                {row.suggested_patch?.workflow_historical_exemptions || '-'}
              </TableCell>
              <TableCell className="text-xs">{row.reason}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
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
            <TableRow key={`${row.project_id}-${row.reminder_kind}-${row.action}-${row.condition_key || ''}`}>
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
  const [onboardingReport, setOnboardingReport] = useState(null);
  const [applyResult, setApplyResult] = useState(null);
  const [onboardingApplyResult, setOnboardingApplyResult] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [onboardingConfirmText, setOnboardingConfirmText] = useState('');
  const [running, setRunning] = useState(false);
  const [onboardingRunning, setOnboardingRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [onboardingApplying, setOnboardingApplying] = useState(false);
  const [error, setError] = useState('');

  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const canAccess = useMemo(
    () => canAccessAdminPage(currentUser),
    [currentUser],
  );

  const canMutate = useMemo(
    () => canRunAdminMutations(currentUser),
    [currentUser],
  );

  const handleRunPreview = async (mode = PLANNER_MODE_RUNTIME) => {
    setRunning(true);
    setError('');
    setApplyResult(null);
    setOnboardingReport(null);
    try {
      const previewOptions = mode === PLANNER_MODE_RUNTIME
        ? {}
        : { mode: PLANNER_MODE_LEGACY_BOOTSTRAP };
      const result = await runProjectReminderRulesPreview(previewOptions);
      setReport(result);
    } catch (previewError) {
      console.error('[ProjectReminderRulesPreview] preview failed', previewError);
      setError('ה-Preview נכשל. בדוק את ה-console.');
    } finally {
      setRunning(false);
    }
  };

  const handleCopyReport = async () => {
    const payload = onboardingReport || report;
    if (!payload) return;
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  };

  const handleRunOnboardingPreview = async () => {
    setOnboardingRunning(true);
    setError('');
    setOnboardingApplyResult(null);
    try {
      const result = await runProjectWorkflowOnboardingPreview();
      setOnboardingReport(result);
      setReport(null);
    } catch (previewError) {
      console.error('[ProjectReminderRulesPreview] onboarding preview failed', previewError);
      setError('ה-Onboarding Preview נכשל. בדוק את ה-console.');
    } finally {
      setOnboardingRunning(false);
    }
  };

  const handleOnboardingApply = async () => {
    if (!canMutate) return;

    if (onboardingConfirmText !== APPLY_PROJECT_WORKFLOW_ONBOARDING_CONFIRM_TEXT) {
      setError(`יש להקליד בדיוק: ${APPLY_PROJECT_WORKFLOW_ONBOARDING_CONFIRM_TEXT}`);
      return;
    }

    setOnboardingApplying(true);
    setError('');
    try {
      const result = await applyProjectWorkflowOnboarding(onboardingReport, {
        apply: true,
        dryRun: false,
        confirmText: onboardingConfirmText,
      });
      setOnboardingApplyResult(result);
      setOnboardingConfirmText('');
    } catch (applyError) {
      console.error('[ProjectReminderRulesPreview] onboarding apply failed', applyError);
      setError(applyError?.message || 'ה-Onboarding Apply נכשל. בדוק את ה-console.');
    } finally {
      setOnboardingApplying(false);
    }
  };

  const confirmTextIsValid = ACCEPTED_CONFIRM_TEXTS.includes(confirmText);

  const handleApply = async () => {
    if (!canMutate) return;

    if (report?.mode !== PLANNER_MODE_LEGACY_BOOTSTRAP) {
      setError('Apply מותר רק לאחר Preview במצב Legacy Bootstrap');
      return;
    }

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
        mode: PLANNER_MODE_LEGACY_BOOTSTRAP,
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

  if (userLoading) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-muted-foreground">טוען...</div>;
  }

  if (!canAccess) {
    return <AdminAccessDenied />;
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
            <Link to={createPageUrl('Projects')}>חזרה לפרויקטים</Link>
          </Button>
          <Button
            type="button"
            onClick={() => handleRunPreview(PLANNER_MODE_LEGACY_BOOTSTRAP)}
            disabled={running}
          >
            {running ? 'מריץ Preview...' : 'Preview — Legacy Bootstrap'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleRunPreview()}
            disabled={running || onboardingRunning}
          >
            Preview — Runtime (ברירת מחדל)
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleRunOnboardingPreview}
            disabled={running || onboardingRunning}
          >
            {onboardingRunning ? 'מריץ Onboarding...' : 'Preview — Workflow Onboarding'}
          </Button>
          <Button type="button" variant="outline" onClick={handleCopyReport} disabled={!report && !onboardingReport}>
            Copy JSON
          </Button>
        </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6 text-red-600">{error}</CardContent>
        </Card>
      ) : null}

      {onboardingApplyResult ? (
        <Card className="border-emerald-300">
          <CardHeader>
            <CardTitle>תוצאת Onboarding Apply</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>עודכנו: {onboardingApplyResult.updated}</div>
            <div>דולגו: {onboardingApplyResult.skipped}</div>
            <div>שגיאות: {onboardingApplyResult.errors.length}</div>
          </CardContent>
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

      {onboardingReport ? (
        <>
          <Card>
            <CardContent className="pt-6 text-sm">
              מצב הרצה:
              {' '}
              <span className="font-semibold">Workflow Onboarding Preview (read-only)</span>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <SummaryCard label="פרויקטים נבדקו" value={onboardingReport.projectsChecked} />
            <SummaryCard label="proposal" value={onboardingReport.counts.proposal} />
            <SummaryCard label="proposal_followup" value={onboardingReport.counts.proposal_followup} />
            <SummaryCard label="work_stages" value={onboardingReport.counts.work_stages} />
            <SummaryCard label="completed_no_reminders" value={onboardingReport.counts.completed_no_reminders} />
            <SummaryCard label="סה״כ הצעות" value={onboardingReport.counts.totalSuggestions} />
          </div>

          {ONBOARDING_SECTIONS.map((section) => (
            <Card key={section.key}>
              <CardHeader>
                <CardTitle>
                  {section.title}
                  {' '}
                  ({(onboardingReport.groups[section.key] || []).length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <OnboardingTable rows={onboardingReport.groups[section.key] || []} />
              </CardContent>
            </Card>
          ))}

          {canMutate ? (
            <Card className="border-amber-300">
              <CardHeader>
                <CardTitle>Onboarding Apply — עדכון שדות Project בלבד</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  מעדכן רק שדות workflow על Project. לא יוצר ולא סוגר Reminders.
                  יש להקליד במדויק:
                  {' '}
                  <span className="font-mono" dir="ltr">{APPLY_PROJECT_WORKFLOW_ONBOARDING_CONFIRM_TEXT}</span>
                </p>
                <div className="flex gap-2 items-center">
                  <Input
                    dir="ltr"
                    value={onboardingConfirmText}
                    onChange={(event) => setOnboardingConfirmText(event.target.value)}
                    placeholder={APPLY_PROJECT_WORKFLOW_ONBOARDING_CONFIRM_TEXT}
                    className="max-w-md font-mono"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleOnboardingApply}
                    disabled={
                      onboardingApplying
                      || onboardingConfirmText !== APPLY_PROJECT_WORKFLOW_ONBOARDING_CONFIRM_TEXT
                    }
                  >
                    {onboardingApplying ? 'מבצע Onboarding Apply...' : 'Onboarding Apply'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      {report ? (
        <>
          <Card>
            <CardContent className="pt-6 text-sm">
              מצב הרצה:
              {' '}
              <span className="font-semibold">{MODE_LABELS[report.mode] || report.mode}</span>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <SummaryCard label="פרויקטים נבדקו" value={report.projectsChecked} />
            <SummaryCard label="הצעות מחיר שייסגרו" value={report.counts.staleProposalRemindersToResolve} />
            <SummaryCard label="הצעות מחיר שיווצרו (pricing)" value={report.counts.pricingProposalRemindersToCreate ?? 0} />
            <SummaryCard label="follow-up שיווצרו (legacy)" value={report.counts.waitingFollowupRemindersToCreate} />
            <SummaryCard label="follow-up לפי Proposal (runtime)" value={report.counts.proposalFollowupRemindersToCreate ?? 0} />
            <SummaryCard label="שלבי עבודה שיווצרו" value={report.counts.workStageRemindersToCreate} />
            <SummaryCard label="תזכורות שייסגרו" value={report.counts.projectWorkStageRemindersToResolve} />
            <SummaryCard label="כפילויות שנמנעו" value={report.counts.duplicatesPrevented} />
            <SummaryCard label="סתירת status/workflow" value={report.counts.statusWorkflowMismatches ?? 0} />
            <SummaryCard label="מוחרגים מ-Workflow" value={report.counts.workflowExcludedProjectsCount ?? 0} />
            <SummaryCard label="תזכורות מוחרגות לסגירה" value={report.counts.excludedWorkflowRemindersToResolve ?? 0} />
            <SummaryCard label="פערי ראיות runtime" value={report.counts.runtimeEvidenceGaps ?? 0} />
            <SummaryCard label="completed_no_reminders" value={report.counts.completedNoReminders ?? 0} />
            <SummaryCard label="rejected/cancelled" value={report.counts.closedProjectsNoWorkflow ?? 0} />
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

          {report.mode === PLANNER_MODE_LEGACY_BOOTSTRAP && canMutate ? (
          <Card className="border-amber-300">
            <CardHeader>
              <CardTitle>Apply — ביצוע בפועל (admin בלבד, Legacy Bootstrap)</CardTitle>
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
          ) : (
            <Card className="border-sky-300">
              <CardContent className="pt-6 text-sm text-muted-foreground">
                Runtime mode — Apply חסום. Apply מותר רק לאחר Preview במצב
                Legacy Bootstrap (מיגרציה). הרץ Preview — Legacy Bootstrap כדי לבצע Apply.
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
