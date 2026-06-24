import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api as base44 } from '@/api/apiClient';
import { createPageUrl } from '@/utils';
import { runProjectStatusTransitionAudit } from '@/lib/projectStatusTransitionAudit';
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

function StatusWriteTable({ rows = [] }) {
  return (
    <div className="overflow-auto max-h-96 border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>קובץ:שורה</TableHead>
            <TableHead>טריגר</TableHead>
            <TableHead>סטטוס שנכתב</TableHead>
            <TableHead>אוטומטי?</TableHead>
            <TableHead>הערות</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.file}:${row.line}`}>
              <TableCell className="text-xs font-mono" dir="ltr">{row.file}:{row.line}</TableCell>
              <TableCell className="text-xs">{row.trigger}</TableCell>
              <TableCell className="text-xs">{row.statusWritten}</TableCell>
              <TableCell>{row.automatic ? 'אוטומטי' : 'ידני'}</TableCell>
              <TableCell className="text-xs">{row.notes}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function UiActionsTable({ createLocations = [], updateLocations = [] }) {
  const uiRows = [
    ...createLocations.map((row) => ({ ...row, operation: 'Project.create' })),
    ...updateLocations.map((row) => ({ ...row, operation: 'Project.update' })),
  ].filter((row) => row.trigger.startsWith('UI'));

  return (
    <div className="overflow-auto max-h-96 border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>פעולה</TableHead>
            <TableHead>קובץ:שורה</TableHead>
            <TableHead>טריגר UI</TableHead>
            <TableHead>משנה סטטוס?</TableHead>
            <TableHead>הערות</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {uiRows.map((row) => (
            <TableRow key={`${row.operation}-${row.file}:${row.line}`}>
              <TableCell className="text-xs font-mono" dir="ltr">{row.operation}</TableCell>
              <TableCell className="text-xs font-mono" dir="ltr">{row.file}:{row.line}</TableCell>
              <TableCell className="text-xs">{row.trigger}</TableCell>
              <TableCell className="text-xs">
                {row.operation === 'Project.create' || row.writesStatus
                  ? row.statusWritten
                  : 'לא'}
              </TableCell>
              <TableCell className="text-xs">{row.notes}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ReminderRulesTable({ rows = [] }) {
  return (
    <div className="overflow-auto max-h-96 border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>condition_key</TableHead>
            <TableHead>חוק</TableHead>
            <TableHead>תלוי ב-Project.status?</TableHead>
            <TableHead>תלות בפועל</TableHead>
            <TableHead>סיכון</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.conditionKeyPrefix}>
              <TableCell className="text-xs font-mono" dir="ltr">{row.conditionKeyPrefix}</TableCell>
              <TableCell className="text-xs">{row.rule}</TableCell>
              <TableCell>{row.dependsOnProjectStatus ? 'כן' : 'לא'}</TableCell>
              <TableCell className="text-xs">{row.statusDependency}</TableCell>
              <TableCell className="text-xs">{row.riskNote}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EntityStatusWritesTable({ rows = [] }) {
  return (
    <div className="overflow-auto max-h-96 border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ישות</TableHead>
            <TableHead>כותבת Project.status?</TableHead>
            <TableHead>פירוט</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.entity}>
              <TableCell className="text-xs font-mono" dir="ltr">{row.entity}</TableCell>
              <TableCell>{row.writesProjectStatus ? 'כן' : 'לא'}</TableCell>
              <TableCell className="text-xs">{row.detail}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RiskFindingsTable({ rows = [] }) {
  return (
    <div className="overflow-auto max-h-96 border rounded-md">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>חומרה</TableHead>
            <TableHead>ממצא</TableHead>
            <TableHead>פירוט</TableHead>
            <TableHead>ראיות בקוד</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="text-xs font-mono">{row.id}</TableCell>
              <TableCell>{SEVERITY_LABELS[row.severity] || row.severity}</TableCell>
              <TableCell className="text-xs font-medium">{row.title}</TableCell>
              <TableCell className="text-xs">{row.detail}</TableCell>
              <TableCell className="text-xs font-mono" dir="ltr">{row.evidence}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ConclusionCard({ flow }) {
  if (!flow) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>מסקנה: איך עוברים בין סטטוסים בפועל</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="text-base font-semibold">{flow.conclusionLabel}</div>
        <div>
          <span className="font-medium">מעברים ידניים: </span>
          {flow.manualTransitions.mechanism}
          {' — '}
          {flow.manualTransitions.coveredTransitions}
        </div>
        <div>
          <span className="font-medium">מעברים אוטומטיים: </span>
          {flow.automaticTransitions.map((transition) => (
            <div key={transition.trigger} className="mt-1">
              {transition.from} → {transition.to}: {transition.trigger}
            </div>
          ))}
        </div>
        <div>
          <span className="font-medium">פערים בולטים:</span>
          <ul className="list-disc pr-5 mt-1 space-y-1">
            {flow.notableGaps.map((gap) => <li key={gap}>{gap}</li>)}
          </ul>
        </div>
        <div className="border rounded-md p-3 bg-amber-50 text-amber-900">
          <span className="font-medium">מגבלות data — נאמר במפורש:</span>
          <ul className="list-disc pr-5 mt-1 space-y-1">
            {flow.dataLimitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ProjectStatusTransitionAudit() {
  const [report, setReport] = useState(null);

  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const canAccessAudit = useMemo(
    () => canAccessAdminPage(currentUser),
    [currentUser],
  );

  const handleRunAudit = () => {
    setReport(runProjectStatusTransitionAudit());
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
          <h1 className="text-3xl font-bold">P2F - אבחון מעברי סטטוס פרויקט (Legacy)</h1>
          <p className="text-muted-foreground mt-2">
            code audit read-only בלבד. ממפה איפה Project.status נכתב בקוד, אילו פעולות UI מזיזות
            סטטוס ואילו חוקי תזכורות תלויים בו. ללא שום mutation.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" asChild>
            <Link to={createPageUrl('Projects')}>חזרה לפרויקטים</Link>
          </Button>
          <Button type="button" onClick={handleRunAudit}>הרץ אבחון</Button>
          <Button type="button" variant="outline" onClick={handleCopyReport} disabled={!report}>
            Copy JSON report
          </Button>
        </div>
      </div>

      {report ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard label="ערכי סטטוס בשימוש" value={report.counts.statusValuesCount} />
            <SummaryCard label="מקומות Project.create" value={report.counts.projectCreateLocationsCount} />
            <SummaryCard label="מקומות Project.update" value={report.counts.projectUpdateLocationsCount} />
            <SummaryCard label="כתיבות status" value={report.counts.statusWriteLocationsCount} />
            <SummaryCard label="כתיבות ידניות" value={report.counts.manualStatusWriteCount} />
            <SummaryCard label="כתיבות אוטומטיות" value={report.counts.automaticStatusWriteCount} />
            <SummaryCard label="חוקי תזכורת תלויי סטטוס" value={report.counts.reminderRulesDependingOnStatusCount} />
            <SummaryCard label="ממצאי סיכון" value={report.counts.riskFindingsCount} />
          </div>

          <ConclusionCard flow={report.suspectedLegacyManualStatusFlow} />

          <Card>
            <CardHeader>
              <CardTitle>
                איפה Project.status נכתב ({report.projectStatusWriteLocations.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <StatusWriteTable rows={report.projectStatusWriteLocations} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>פעולות UI שכותבות על Project (create/update)</CardTitle>
            </CardHeader>
            <CardContent>
              <UiActionsTable
                createLocations={report.projectCreateLocations}
                updateLocations={report.projectUpdateLocations}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                חוקי תזכורות מול Project.status ({report.reminderRulesThatDependOnProjectStatus.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ReminderRulesTable rows={report.reminderRulesThatDependOnProjectStatus} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>האם ישויות אחרות כותבות Project.status</CardTitle>
            </CardHeader>
            <CardContent>
              <EntityStatusWritesTable
                rows={[
                  ...report.proposalRelatedStatusWrites,
                  ...report.signedProposalRelatedStatusWrites,
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>ממצאי סיכון ({report.riskFindings.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <RiskFindingsTable rows={report.riskFindings} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>סדר תיקון מומלץ (המלצות בלבד — לא בוצע דבר)</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal pr-5 space-y-2 text-sm">
                {report.recommendedFixOrder.map((step) => (
                  <li key={step.order}>
                    <span className="font-medium">{step.title}</span>
                    {' — '}
                    {step.detail}
                    {step.mutation ? (
                      <span className="text-amber-700"> (דורש mutation — רק אחרי אישור)</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            לחץ &quot;הרץ אבחון&quot; להצגת דוח ה-code audit. הדוח סטטי (נבנה מתוך קריאת הקוד)
            ואינו ניגש ל-data ואינו מבצע שום שינוי.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
