import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import {
  buildPipelineSummary,
  buildProjectPipelineRows,
  buildProjectReminderMap,
  enrichPipelineRowsWithReminders,
  getWorkStagesCompactDisplay,
  groupProjectPipelineRows,
  loadReadOnlyVisibleReminders,
  matchesQuickFilter,
  PIPELINE_GROUP_ORDER,
  PIPELINE_QUICK_FILTER_KEYS,
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
import { cn } from '@/lib/utils';

const STATUS_FILTER_OPTIONS = Object.entries(PROJECT_WORK_STATUS_LABELS);

const QUICK_FILTER_BUTTONS = [
  { key: PIPELINE_QUICK_FILTER_KEYS.PROPOSALS, label: 'הצעות' },
  { key: PIPELINE_QUICK_FILTER_KEYS.ACCEPTED, label: 'התקבלה' },
  { key: PIPELINE_QUICK_FILTER_KEYS.IN_WORK, label: 'בעבודה' },
  { key: PIPELINE_QUICK_FILTER_KEYS.NO_WORK_STAGES, label: 'ללא שלבי עבודה' },
  { key: PIPELINE_QUICK_FILTER_KEYS.OPEN_COLLECTION, label: 'גבייה פתוחה' },
  { key: PIPELINE_QUICK_FILTER_KEYS.CONSTRUCTION_NOT_UPDATED, label: 'סטטוס בנייה לא עודכן' },
  { key: PIPELINE_QUICK_FILTER_KEYS.COMPLETED, label: 'בוצע' },
  { key: PIPELINE_QUICK_FILTER_KEYS.ACTIVE_REMINDERS, label: 'עם תזכורות פעילות' },
];

const SUMMARY_CARDS = [
  {
    label: 'בתמחור',
    countKey: 'pricingCount',
    quickFilter: PIPELINE_QUICK_FILTER_KEYS.PRICING,
    groupKey: 'proposal_pricing',
  },
  {
    label: 'ממתינות לתגובה',
    countKey: 'waitingCount',
    quickFilter: PIPELINE_QUICK_FILTER_KEYS.WAITING,
    groupKey: 'proposal_waiting',
  },
  {
    label: 'התקבלה ללא שלבים',
    countKey: 'acceptedWithoutWorkflowCount',
    quickFilter: PIPELINE_QUICK_FILTER_KEYS.ACCEPTED_NO_STAGES,
    groupKey: 'accepted_without_workflow',
  },
  {
    label: 'בעבודה ללא שלבים',
    countKey: 'inWorkWithoutWorkflowCount',
    quickFilter: PIPELINE_QUICK_FILTER_KEYS.IN_WORK_NO_STAGES,
    groupKey: 'in_work_without_workflow',
  },
  {
    label: 'גבייה פתוחה',
    countKey: 'openCollectionCount',
    quickFilter: PIPELINE_QUICK_FILTER_KEYS.OPEN_COLLECTION,
    groupKey: null,
  },
  {
    label: 'סטטוס בנייה לא עודכן',
    countKey: 'constructionNotUpdatedCount',
    quickFilter: PIPELINE_QUICK_FILTER_KEYS.CONSTRUCTION_NOT_UPDATED,
    groupKey: null,
  },
  {
    label: 'בוצע',
    countKey: 'completedCount',
    quickFilter: PIPELINE_QUICK_FILTER_KEYS.COMPLETED,
    groupKey: 'planning_completed',
  },
  {
    label: 'תזכורות פעילות',
    countKey: 'activeRemindersCount',
    quickFilter: PIPELINE_QUICK_FILTER_KEYS.ACTIVE_REMINDERS,
    groupKey: null,
  },
];

const formatCurrency = (value) => (
  new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0)
);

const formatReminderDateTime = (value) => {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
};

const formatReminderCountLabel = (count) => (
  count === 1 ? 'תזכורת אחת' : `${count} תזכורות`
);

function navigateToReminderTarget(navigate, reminder) {
  const targetUrl = String(reminder?.target_url || '').trim();
  if (!targetUrl) return;

  if (/^https?:\/\//i.test(targetUrl)) {
    window.location.href = targetUrl;
    return;
  }

  navigate(targetUrl.startsWith('/') ? targetUrl : `/${targetUrl}`);
}

function PipelineRemindersCell({ reminders = [] }) {
  const navigate = useNavigate();

  if (!reminders.length) {
    return <span className="text-muted-foreground">-</span>;
  }

  const visibleReminders = reminders.slice(0, 2);
  const remainingCount = reminders.length - visibleReminders.length;

  return (
    <div className="space-y-1 min-w-[150px]">
      <NeutralBadge>{formatReminderCountLabel(reminders.length)}</NeutralBadge>
      <div className="space-y-1">
        {visibleReminders.map((reminder) => {
          const nextLabel = formatReminderDateTime(reminder.next_remind_at);
          const title = reminder.title || 'תזכורת';

          if (!reminder.has_navigation_target) {
            return (
              <div
                key={reminder.id}
                className="text-xs text-muted-foreground"
                title="אין יעד פתיחה ברור"
              >
                {title}
                {nextLabel ? ` · ${nextLabel}` : ''}
              </div>
            );
          }

          return (
            <button
              key={reminder.id}
              type="button"
              className="block text-right text-xs text-primary hover:underline"
              title="לחץ לפתיחת היעד של התזכורת"
              onClick={() => navigateToReminderTarget(navigate, reminder)}
            >
              {title}
              {nextLabel ? ` · ${nextLabel}` : ''}
            </button>
          );
        })}
        {remainingCount > 0 ? (
          <div className="text-xs text-muted-foreground">
            ועוד
            {' '}
            {remainingCount}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function scrollToGroup(groupKey) {
  if (!groupKey) return;
  const element = document.getElementById(`pipeline-group-${groupKey}`);
  element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function SummaryCard({ label, value, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-right rounded-lg border bg-card text-card-foreground shadow-sm transition-colors w-full',
        active ? 'border-primary ring-1 ring-primary/30' : 'hover:bg-accent/40',
      )}
    >
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
      </CardContent>
    </button>
  );
}

function NeutralBadge({ children }) {
  return (
    <Badge variant="secondary" className="font-normal text-xs">
      {children}
    </Badge>
  );
}

function matchesSearch(row, searchTerm, clientName) {
  if (!searchTerm) return true;

  const haystack = [
    row.project_name,
    row.bid_number,
    row.work_number,
    clientName,
    row.city,
    row.project_type,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .join(' ');

  return haystack.includes(searchTerm);
}

function PipelineProjectRow({ row }) {
  const projectUrl = createPageUrl(`ProjectDetails?id=${row.project_id}`);
  const workStagesUrl = buildWorkStagesPageUrl({ projectId: row.project_id });
  const collectionUrl = row.primary_open_collection_due_id
    ? buildCollectionDueFormPageUrl({ collectionDueId: row.primary_open_collection_due_id })
    : null;
  const workStagesDisplay = getWorkStagesCompactDisplay(row);
  const projectMeta = [row.city, row.project_type].filter(Boolean).join(' · ');

  return (
    <TableRow>
      <TableCell className="min-w-[180px]">
        <div className="space-y-1">
          <Link
            to={projectUrl}
            className="font-medium text-primary hover:underline"
          >
            {row.project_name || '-'}
          </Link>
          {projectMeta ? (
            <div className="text-xs text-muted-foreground">{projectMeta}</div>
          ) : null}
          {row.status_badges?.length ? (
            <div className="flex flex-wrap gap-1 pt-1">
              {row.status_badges.map((badge) => (
                <NeutralBadge key={badge.code}>{badge.label}</NeutralBadge>
              ))}
            </div>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="min-w-[110px]">
        <div className="text-sm">{row.bid_number || '-'}</div>
        <div className="text-xs text-muted-foreground">{row.work_number || '-'}</div>
      </TableCell>
      <TableCell className="whitespace-nowrap">{formatCurrency(row.total_amount)}</TableCell>
      <TableCell>{row.status_display_label}</TableCell>
      <TableCell className="min-w-[140px]">
        <div className="text-sm">{workStagesDisplay.primary}</div>
        {workStagesDisplay.secondary ? (
          <div className="text-xs text-muted-foreground">{workStagesDisplay.secondary}</div>
        ) : null}
      </TableCell>
      <TableCell>{row.construction_status_label}</TableCell>
      <TableCell>
        <PipelineRemindersCell reminders={row.reminders} />
      </TableCell>
      <TableCell>
        {row.has_open_collection_due ? (
          <NeutralBadge>
            גבייה פתוחה
            {' '}
            {formatCurrency(row.open_collection_due_amount)}
          </NeutralBadge>
        ) : (
          '-'
        )}
      </TableCell>
      <TableCell className="min-w-[180px]">
        <div className="flex flex-col sm:flex-row flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link to={projectUrl}>פתח פרויקט</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link to={workStagesUrl}>
              {row.work_stage_count > 0 ? 'נהל שלבי עבודה' : 'הגדר שלבי עבודה'}
            </Link>
          </Button>
          {collectionUrl ? (
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link to={collectionUrl}>פתח גבייה</Link>
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function PipelineGroupCard({
  group,
  forceExpanded = false,
  hasActiveFilters = false,
}) {
  const defaultCollapsed = forceExpanded
    ? false
    : !group.expanded_by_default;

  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (!group.count) {
    if (hasActiveFilters) return null;
    return null;
  }

  const isExpanded = forceExpanded ? true : !collapsed;

  return (
    <Card id={`pipeline-group-${group.group_key}`} className="border-0 shadow-sm scroll-mt-6">
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
          className="shrink-0"
          onClick={() => setCollapsed((value) => !value)}
        >
          {isExpanded ? 'הסתר קבוצה' : 'הצג קבוצה'}
        </Button>
      </CardHeader>

      {isExpanded ? (
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>פרויקט</TableHead>
                <TableHead>BID / מס&apos; עבודה</TableHead>
                <TableHead>שכ&quot;ט</TableHead>
                <TableHead>סטטוס עבודה</TableHead>
                <TableHead>שלבי עבודה</TableHead>
                <TableHead>סטטוס בנייה</TableHead>
                <TableHead>תזכורות</TableHead>
                <TableHead>גבייה</TableHead>
                <TableHead>פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.rows.map((row) => (
                <PipelineProjectRow key={row.project_id} row={row} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      ) : null}
    </Card>
  );
}

const INITIAL_FILTERS = {
  searchTerm: '',
  statusFilter: 'all',
  showRejectedCancelled: false,
  onlyWithoutWorkStages: false,
  onlyOpenCollection: false,
  onlyConstructionNotUpdated: false,
  quickFilter: null,
};

export default function ProjectPipeline() {
  const [filters, setFilters] = useState(INITIAL_FILTERS);

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

  const { data: visibleReminders = [], isLoading: isLoadingReminders } = useQuery({
    queryKey: ['reminders', 'pipeline-visible'],
    queryFn: () => loadReadOnlyVisibleReminders(),
  });

  const clientsById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );

  const reminderMapResult = useMemo(
    () => buildProjectReminderMap(visibleReminders, projects, collectionDues),
    [visibleReminders, projects, collectionDues],
  );

  const pipelineRows = useMemo(
    () => enrichPipelineRowsWithReminders(
      buildProjectPipelineRows(projects, workStages, collectionDues),
      reminderMapResult,
    ),
    [projects, workStages, collectionDues, reminderMapResult],
  );

  const normalizedSearch = filters.searchTerm.trim().toLowerCase();

  const hasActiveFilters = Boolean(
    normalizedSearch
    || filters.statusFilter !== 'all'
    || filters.showRejectedCancelled
    || filters.onlyWithoutWorkStages
    || filters.onlyOpenCollection
    || filters.onlyConstructionNotUpdated
    || filters.quickFilter,
  );

  const filteredRows = useMemo(() => (
    pipelineRows.filter((row) => {
      const clientName = clientsById.get(row.client_id)?.name || '';

      if (!filters.showRejectedCancelled && row.group_key === 'rejected_cancelled') {
        return false;
      }

      if (filters.statusFilter !== 'all' && row.status !== filters.statusFilter) {
        return false;
      }

      if (filters.onlyWithoutWorkStages && row.work_stage_count > 0) {
        return false;
      }

      if (filters.onlyOpenCollection && !row.has_open_collection_due) {
        return false;
      }

      if (
        filters.onlyConstructionNotUpdated
        && !(
          row.construction_status === 'not_updated'
          && ['signed', 'execution', 'completed'].includes(row.status)
        )
      ) {
        return false;
      }

      if (!matchesQuickFilter(row, filters.quickFilter)) {
        return false;
      }

      return matchesSearch(row, normalizedSearch, clientName);
    })
  ), [pipelineRows, clientsById, filters, normalizedSearch]);

  const grouped = useMemo(
    () => groupProjectPipelineRows(filteredRows),
    [filteredRows],
  );

  const summary = useMemo(
    () => buildPipelineSummary(pipelineRows),
    [pipelineRows],
  );

  const visibleGroupKeys = useMemo(() => (
    PIPELINE_GROUP_ORDER.filter((groupKey) => grouped[groupKey]?.count > 0)
  ), [grouped]);

  const clearFilters = () => {
    setFilters(INITIAL_FILTERS);
  };

  const applyQuickFilter = (quickFilter) => {
    setFilters((prev) => {
      const nextQuickFilter = prev.quickFilter === quickFilter ? null : quickFilter;

      return {
        ...prev,
        quickFilter: nextQuickFilter,
        onlyWithoutWorkStages: nextQuickFilter === PIPELINE_QUICK_FILTER_KEYS.NO_WORK_STAGES,
        onlyOpenCollection: nextQuickFilter === PIPELINE_QUICK_FILTER_KEYS.OPEN_COLLECTION,
        onlyConstructionNotUpdated: nextQuickFilter === PIPELINE_QUICK_FILTER_KEYS.CONSTRUCTION_NOT_UPDATED,
      };
    });
  };

  const handleSummaryCardClick = ({ quickFilter, groupKey }) => {
    setFilters((prev) => ({
      ...prev,
      quickFilter: prev.quickFilter === quickFilter ? null : quickFilter,
    }));
    if (groupKey) {
      window.setTimeout(() => scrollToGroup(groupKey), 50);
    }
  };

  const isLoading = isLoadingProjects
    || isLoadingWorkStages
    || isLoadingCollectionDues
    || isLoadingReminders;

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6" dir="rtl">
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
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
              {SUMMARY_CARDS.map((card) => (
                <SummaryCard
                  key={card.label}
                  label={card.label}
                  value={summary[card.countKey]}
                  active={filters.quickFilter === card.quickFilter}
                  onClick={() => handleSummaryCardClick(card)}
                />
              ))}
            </div>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">סינון מהיר</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {QUICK_FILTER_BUTTONS.map((item) => (
                  <Button
                    key={item.key}
                    type="button"
                    size="sm"
                    variant={filters.quickFilter === item.key ? 'default' : 'outline'}
                    onClick={() => applyQuickFilter(item.key)}
                  >
                    {item.label}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={clearFilters}
                  disabled={!hasActiveFilters}
                >
                  נקה סינון
                </Button>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle>סינון מתקדם</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="pipeline-search">חיפוש</Label>
                    <Input
                      id="pipeline-search"
                      value={filters.searchTerm}
                      onChange={(event) => setFilters((prev) => ({
                        ...prev,
                        searchTerm: event.target.value,
                      }))}
                      placeholder="שם / BID / מספר עבודה / לקוח"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pipeline-status-filter">סטטוס פרויקט</Label>
                    <Select
                      value={filters.statusFilter}
                      onValueChange={(value) => setFilters((prev) => ({
                        ...prev,
                        statusFilter: value,
                      }))}
                    >
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
                      checked={filters.showRejectedCancelled}
                      onCheckedChange={(value) => setFilters((prev) => ({
                        ...prev,
                        showRejectedCancelled: value === true,
                      }))}
                    />
                    הצג גם בוטלו / לא התקבלו
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={filters.onlyWithoutWorkStages}
                      onCheckedChange={(value) => setFilters((prev) => ({
                        ...prev,
                        onlyWithoutWorkStages: value === true,
                        quickFilter: value === true
                          ? PIPELINE_QUICK_FILTER_KEYS.NO_WORK_STAGES
                          : (
                            prev.quickFilter === PIPELINE_QUICK_FILTER_KEYS.NO_WORK_STAGES
                              ? null
                              : prev.quickFilter
                          ),
                      }))}
                    />
                    הצג רק פרויקטים ללא WorkStages
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={filters.onlyOpenCollection}
                      onCheckedChange={(value) => setFilters((prev) => ({
                        ...prev,
                        onlyOpenCollection: value === true,
                        quickFilter: value === true
                          ? PIPELINE_QUICK_FILTER_KEYS.OPEN_COLLECTION
                          : (
                            prev.quickFilter === PIPELINE_QUICK_FILTER_KEYS.OPEN_COLLECTION
                              ? null
                              : prev.quickFilter
                          ),
                      }))}
                    />
                    הצג רק פרויקטים עם גבייה פתוחה
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={filters.onlyConstructionNotUpdated}
                      onCheckedChange={(value) => setFilters((prev) => ({
                        ...prev,
                        onlyConstructionNotUpdated: value === true,
                        quickFilter: value === true
                          ? PIPELINE_QUICK_FILTER_KEYS.CONSTRUCTION_NOT_UPDATED
                          : (
                            prev.quickFilter === PIPELINE_QUICK_FILTER_KEYS.CONSTRUCTION_NOT_UPDATED
                              ? null
                              : prev.quickFilter
                          ),
                      }))}
                    />
                    הצג רק סטטוס בנייה לא עודכן
                  </label>
                </div>
              </CardContent>
            </Card>

            {filteredRows.length === 0 ? (
              <Card className="border-0 shadow-sm">
                <CardContent className="py-10 text-center space-y-4">
                  <p className="text-muted-foreground">
                    לא נמצאו פרויקטים לפי הסינון הנוכחי
                  </p>
                  <Button type="button" variant="outline" onClick={clearFilters}>
                    נקה סינון
                  </Button>
                </CardContent>
              </Card>
            ) : (
              visibleGroupKeys.map((groupKey) => (
                <PipelineGroupCard
                  key={groupKey}
                  group={grouped[groupKey]}
                  forceExpanded={hasActiveFilters}
                  hasActiveFilters={hasActiveFilters}
                />
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
