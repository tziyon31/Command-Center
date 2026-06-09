import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { runProjectLifecycleAlignmentAudit } from '@/lib/projectLifecycleAlignmentAudit';
import { isLocalDevEnvironment } from '@/lib/isLocalDev';
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

const GROUP_SECTIONS = [
  { key: 'proposalPricing', title: 'הצעות בתמחור' },
  { key: 'proposalWaiting', title: 'הצעות ממתינות לתגובה' },
  { key: 'proposalRejected', title: 'הצעות שלא התקבלו' },
  { key: 'proposalCancelled', title: 'הצעות שבוטלו' },
  { key: 'acceptedProjectsWithoutWorkflow', title: 'התקבלה - דורש workflow' },
  { key: 'acceptedProjectsWithWorkflow', title: 'התקבלה - עם שלבי עבודה' },
  { key: 'inWorkProjectsWithoutWorkflow', title: 'בעבודה - ללא שלבי עבודה' },
  { key: 'inWorkProjectsWithWorkflow', title: 'בעבודה - עם שלב פעיל' },
  { key: 'planningDoneProjects', title: 'בוצע - תכנון הושלם' },
  { key: 'intermediateWorkStatusProjects', title: 'סטטוסי ביניים (תכנון/הגשה)' },
  { key: 'collectionCompletedProjects', title: 'גבייה הושלמה' },
  { key: 'leads', title: 'לידים' },
  { key: 'constructionStatusCandidates', title: 'מועמדים לעדכון סטטוס בנייה' },
  { key: 'deliveredFacilityCandidates', title: 'מועמדים למסירה ללקוח' },
  { key: 'duplicateProjectProposalCandidates', title: 'כפילויות / אי התאמות אמיתיים' },
  { key: 'relatedNameCandidates', title: 'שמות דומים / קשורים' },
  { key: 'versionOrMergedHistoryCandidates', title: 'מועמדים למאוחד / גרסה / היסטוריה' },
  { key: 'dataQualityWarnings', title: 'אזהרות איכות נתונים' },
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

function ProjectGroupTable({ rows = [] }) {
  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">אין רשומות בקבוצה זו.</p>;
  }

  const isProjectRow = Boolean(
    rows[0]?.project_id
    || rows[0]?.current_project_status
    || rows[0]?.candidate_project_id
    || rows[0]?.other_project_id,
  );

  if (!isProjectRow) {
    return (
      <pre className="text-xs bg-slate-50 border rounded-md p-3 overflow-auto max-h-80">
        {JSON.stringify(rows, null, 2)}
      </pre>
    );
  }

  return (
    <div className="overflow-auto max-h-96 border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>פרויקט</TableHead>
            <TableHead>סטטוס</TableHead>
            <TableHead>חומרה</TableHead>
            <TableHead>עבודה / שלבים</TableHead>
            <TableHead>סיבה</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.project_id || row.proposal_id || row.quote_id || row.other_project_id}>
              <TableCell>
                {row.project_name || row.candidate_project_name || row.project_id}
                {row.other_project_name ? ` ↔ ${row.other_project_name}` : ''}
              </TableCell>
              <TableCell>
                {row.current_project_status || row.status || row.candidate_project_status || '-'}
                {row.other_status ? ` / ${row.other_status}` : ''}
              </TableCell>
              <TableCell>{row.severity || row.issues?.[0]?.severity || '-'}</TableCell>
              <TableCell>{row.work_progress_label || (row.work_stage_count ?? '-')}</TableCell>
              <TableCell className="text-xs">
                {row.reason || row.recommended_action || row.migration_reason || '-'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function ProjectLifecycleAudit() {
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const canAccessAudit = useMemo(() => (
    isLocalDevEnvironment() || currentUser?.role === 'admin'
  ), [currentUser?.role]);

  const handleRunAudit = async () => {
    setRunning(true);
    setError('');
    try {
      const result = await runProjectLifecycleAlignmentAudit();
      setReport(result);
    } catch (auditError) {
      console.error('[ProjectLifecycleAudit] audit failed', auditError);
      setError('האבחון נכשל. בדוק את ה-console.');
    } finally {
      setRunning(false);
    }
  };

  const handleCopyReport = async () => {
    if (!report) return;
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
  };

  if (!canAccessAudit) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-2xl font-bold mb-4">Project Lifecycle Audit</h1>
        <p className="text-muted-foreground">
          Audit page is available only in local development/admin mode.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">P0 - Project Lifecycle Audit</h1>
          <p className="text-muted-foreground mt-2">
            אבחון read-only בלבד. ללא migration, ללא עדכון records, ללא יצירת WorkStages.
          </p>
        </div>
        <div className="flex gap-2">
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
            <SummaryCard label="בתמחור" value={report.counts.projectPricingCount} />
            <SummaryCard label="ממתינות" value={report.counts.projectWaitingCount} />
            <SummaryCard label="התקבלה ללא workflow" value={report.counts.acceptedProjectsWithoutWorkflow} />
            <SummaryCard label="בעבודה ללא workflow" value={report.counts.inWorkProjectsWithoutWorkflow} />
            <SummaryCard label="בוצע" value={report.counts.planningDoneProjects} />
            <SummaryCard label="מועמדים לבנייה" value={report.counts.constructionStatusCandidates} />
            <SummaryCard label="מועמדים למסירה" value={report.counts.deliveredFacilityCandidates} />
            <SummaryCard label="כפילויות אמיתיות" value={report.counts.duplicateCandidatesCount} />
            <SummaryCard label="שמות דומים" value={report.counts.relatedNameCandidatesCount} />
            <SummaryCard label="אזהרות נתונים" value={report.counts.dataQualityWarningsCount} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Schema</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div>Quote entity: {report.schema.quoteEntityAvailable ? 'זמין' : 'לא זמין'}</div>
              <div>Construction status ב-schema: {report.schema.supportsConstructionStatus ? 'כן' : 'לא'}</div>
              <div>Proposal business status: לא קיים (רק form_status)</div>
            </CardContent>
          </Card>

          {GROUP_SECTIONS.map((section) => (
            <Card key={section.key}>
              <CardHeader>
                <CardTitle>
                  {section.title}
                  {' '}
                  ({(report.groups[section.key] || []).length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ProjectGroupTable rows={report.groups[section.key] || []} />
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader>
              <CardTitle>המלצות</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm mb-3">{report.recommendations.suggestedNextStep}</p>
              <pre className="text-xs bg-slate-50 border rounded-md p-3 overflow-auto max-h-80">
                {JSON.stringify(report.recommendations, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
