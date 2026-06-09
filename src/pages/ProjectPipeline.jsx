import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import {
  buildPipelineSummary,
  buildProjectPipelineRows,
  groupProjectPipelineRows,
  PIPELINE_GROUP_ORDER,
  PROJECT_WORK_STATUS_LABELS,
} from '@/lib/projectPipelineUtils';
import {
  buildCollectionDueFormPageUrl,
  buildWorkStagesPageUrl,
} from '@/lib/workflowNavigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const STATUS_FILTER_OPTIONS = Object.entries(PROJECT_WORK_STATUS_LABELS);

const formatCurrency = (value) => (
  new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0)
);

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

function matchesSearch(row, searchTerm, clientName) {
  if (!searchTerm) return true;

  const haystack = [
    row.project_name,
    row.bid_number,
    row.work_number,
    clientName,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .join(' ');

  return haystack.includes(searchTerm);
}

function PipelineGroupCard({
  group,
  clientsById,
  defaultCollapsed = false,
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (!group.count) return null;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>{group.group_label}</CardTitle>
          <CardDescription>
            {group.count}
            {' '}
            פרויקטים · שכ"ט כולל
            {' '}
            {formatCurrency(group.total_amount)}
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? 'הצג קבוצה' : 'הסתר קבוצה'}
        </Button>
      </CardHeader>

      {!collapsed ? (
        <CardContent className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>פרויקט</TableHead>
                <TableHead>BID</TableHead>
                <TableHead>מס&apos; עבודה</TableHead>
                <TableHead>לקוח</TableHead>
                <TableHead>שכ&quot;ט</TableHead>
                <TableHead>סטטוס עבודה</TableHead>
                <TableHead>שלבי עבודה</TableHead>
                <TableHead>סטטוס בנייה</TableHead>
                <TableHead>גבייה פתוחה</TableHead>
                <TableHead>פעולה</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.rows.map((row) => {
                const clientName = clientsById.get(row.client_id)?.name || '-';
                const projectUrl = createPageUrl(`ProjectDetails?id=${row.project_id}`);
                const workStagesUrl = buildWorkStagesPageUrl({ projectId: row.project_id });
                const collectionUrl = row.primary_open_collection_due_id
                  ? buildCollectionDueFormPageUrl({ collectionDueId: row.primary_open_collection_due_id })
                  : null;

                return (
                  <TableRow key={row.project_id}>
                    <TableCell className="font-medium">{row.project_name || '-'}</TableCell>
                    <TableCell>{row.bid_number || '-'}</TableCell>
                    <TableCell>{row.work_number || '-'}</TableCell>
                    <TableCell>{clientName}</TableCell>
                    <TableCell>{formatCurrency(row.total_amount)}</TableCell>
                    <TableCell>{row.status_label}</TableCell>
                    <TableCell className="text-xs">{row.work_progress_label}</TableCell>
                    <TableCell>{row.construction_status_label}</TableCell>
                    <TableCell>
                      {row.has_open_collection_due ? (
                        <Badge variant="outline">
                          גבייה פתוחה
                          {' '}
                          {formatCurrency(row.open_collection_due_amount)}
                        </Badge>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild variant="outline" size="sm">
                          <Link to={projectUrl}>פתח פרויקט</Link>
                        </Button>
                        <Button asChild variant="outline" size="sm">
                          <Link to={workStagesUrl}>נהל שלבי עבודה</Link>
                        </Button>
                        {collectionUrl ? (
                          <Button asChild variant="outline" size="sm">
                            <Link to={collectionUrl}>פתח גבייה</Link>
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      ) : null}
    </Card>
  );
}

export default function ProjectPipeline() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showRejectedCancelled, setShowRejectedCancelled] = useState(false);
  const [onlyWithoutWorkStages, setOnlyWithoutWorkStages] = useState(false);
  const [onlyOpenCollection, setOnlyOpenCollection] = useState(false);
  const [onlyConstructionNotUpdated, setOnlyConstructionNotUpdated] = useState(false);

  const { data: projects = [], isLoading: isLoadingProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-year'),
  });

  const { data: workStages = [], isLoading: isLoadingWorkStages } = useQuery({
    queryKey: ['work-stages'],
    queryFn: () => base44.entities.WorkStage.list(),
  });

  const { data: collectionDues = [], isLoading: isLoadingCollectionDues } = useQuery({
    queryKey: ['collection-dues'],
    queryFn: () => base44.entities.CollectionDue.list('-created_date'),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => base44.entities.Client.list(),
  });

  const clientsById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );

  const pipelineRows = useMemo(
    () => buildProjectPipelineRows(projects, workStages, collectionDues),
    [projects, workStages, collectionDues],
  );

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredRows = useMemo(() => (
    pipelineRows.filter((row) => {
      const clientName = clientsById.get(row.client_id)?.name || '';

      if (!showRejectedCancelled && row.group_key === 'rejected_cancelled') {
        return false;
      }

      if (statusFilter !== 'all' && row.status !== statusFilter) {
        return false;
      }

      if (onlyWithoutWorkStages && row.work_stage_count > 0) {
        return false;
      }

      if (onlyOpenCollection && !row.has_open_collection_due) {
        return false;
      }

      if (
        onlyConstructionNotUpdated
        && !(
          row.construction_status === 'not_updated'
          && ['signed', 'execution', 'completed'].includes(row.status)
        )
      ) {
        return false;
      }

      return matchesSearch(row, normalizedSearch, clientName);
    })
  ), [
    pipelineRows,
    clientsById,
    showRejectedCancelled,
    statusFilter,
    onlyWithoutWorkStages,
    onlyOpenCollection,
    onlyConstructionNotUpdated,
    normalizedSearch,
  ]);

  const grouped = useMemo(
    () => groupProjectPipelineRows(filteredRows),
    [filteredRows],
  );

  const summary = useMemo(
    () => buildPipelineSummary(pipelineRows),
    [pipelineRows],
  );

  const isLoading = isLoadingProjects || isLoadingWorkStages || isLoadingCollectionDues;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-[1400px] mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Pipeline פרויקטים</h1>
          <p className="text-muted-foreground mt-2">
            תמונת מצב לפי סטטוס עבודה, שלבי עבודה, סטטוס בנייה וגבייה.
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center min-h-[240px]">
            <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryCard label="פרויקטים פעילים/עסקיים" value={summary.businessActiveCount} />
              <SummaryCard label="בתמחור" value={summary.pricingCount} />
              <SummaryCard label="ממתינות" value={summary.waitingCount} />
              <SummaryCard label="התקבלה ללא workflow" value={summary.acceptedWithoutWorkflowCount} />
              <SummaryCard label="בעבודה ללא workflow" value={summary.inWorkWithoutWorkflowCount} />
              <SummaryCard label="בוצע" value={summary.completedCount} />
              <SummaryCard label="גבייה פתוחה" value={summary.openCollectionCount} />
              <SummaryCard label="סטטוס בנייה לא עודכן" value={summary.constructionNotUpdatedCount} />
            </div>

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>סינון</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="pipeline-search">חיפוש</Label>
                    <Input
                      id="pipeline-search"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="שם / BID / מספר עבודה / לקוח"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pipeline-status-filter">סטטוס פרויקט</Label>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger id="pipeline-status-filter">
                        <SelectValue placeholder="כל הסטטוסים" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">כל הסטטוסים</SelectItem>
                        {STATUS_FILTER_OPTIONS.map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={showRejectedCancelled}
                      onCheckedChange={(value) => setShowRejectedCancelled(value === true)}
                    />
                    הצג גם בוטלו / לא התקבלו
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={onlyWithoutWorkStages}
                      onCheckedChange={(value) => setOnlyWithoutWorkStages(value === true)}
                    />
                    הצג רק פרויקטים ללא WorkStages
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={onlyOpenCollection}
                      onCheckedChange={(value) => setOnlyOpenCollection(value === true)}
                    />
                    הצג רק פרויקטים עם גבייה פתוחה
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={onlyConstructionNotUpdated}
                      onCheckedChange={(value) => setOnlyConstructionNotUpdated(value === true)}
                    />
                    הצג רק סטטוס בנייה לא עודכן
                  </label>
                </div>
              </CardContent>
            </Card>

            {PIPELINE_GROUP_ORDER.map((groupKey) => (
              <PipelineGroupCard
                key={groupKey}
                group={grouped[groupKey]}
                clientsById={clientsById}
                defaultCollapsed={grouped[groupKey].collapsed_by_default}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
