import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowDown, ArrowUp } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import WorkStageDialog from '@/components/workflow/WorkStageDialog';
import WorkStagesProjectPicker from '@/components/workflow/WorkStagesProjectPicker';
import {
  getActiveWorkStage,
  normalizeWorkStageStatuses,
  sortWorkStages,
} from '@/lib/workStageLogic';
import {
  invalidateWorkStageQueries,
  loadWorkStagesForProject,
  recalculateProjectWorkStages,
} from '@/lib/workStageSync';
import { isValidSignedProposalForWorkStages } from '@/lib/signedProposalValidation';
import { cn } from '@/lib/utils';

const STATUS_LABELS = {
  pending: 'ממתין',
  active: 'פעיל',
  completed: 'הושלם',
  cancelled: 'בוטל',
};

const PROJECT_STATUS_LABELS = {
  lead: 'ליד',
  pricing: 'תמחור',
  signed: 'חתום',
  planning: 'תכנון',
  submission: 'הגשה',
  execution: 'ביצוע',
  completed: 'הושלם',
  collection_completed: 'גבייה הושלמה',
  cancelled: 'בוטל',
  waiting: 'ממתין',
  rejected: 'נדחה',
};

const formatBoolean = (value) => (value ? 'כן' : 'לא');

const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('he-IL').format(date);
};

const formatProjectStatus = (status) => (
  PROJECT_STATUS_LABELS[status] || status || '-'
);

export default function WorkStages() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingStage, setEditingStage] = useState(null);
  const [busyStageId, setBusyStageId] = useState(null);

  const resolvedProjectId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('project_id') || '';
  }, [location.search]);

  const resolvedSignedProposalId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('signed_proposal_id') || '';
  }, [location.search]);

  const resolvedStageId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('stage_id') || '';
  }, [location.search]);

  if (!resolvedProjectId) {
    return <WorkStagesProjectPicker />;
  }

  return (
    <WorkStagesProjectView
      resolvedProjectId={resolvedProjectId}
      resolvedSignedProposalId={resolvedSignedProposalId}
      resolvedStageId={resolvedStageId}
      dialogOpen={dialogOpen}
      setDialogOpen={setDialogOpen}
      editingStage={editingStage}
      setEditingStage={setEditingStage}
      busyStageId={busyStageId}
      setBusyStageId={setBusyStageId}
      queryClient={queryClient}
    />
  );
}

function WorkStagesProjectView({
  resolvedProjectId,
  resolvedSignedProposalId,
  resolvedStageId,
  dialogOpen,
  setDialogOpen,
  editingStage,
  setEditingStage,
  busyStageId,
  setBusyStageId,
  queryClient,
}) {
  const { data: project, isLoading: isLoadingProject } = useQuery({
    queryKey: ['project', resolvedProjectId],
    queryFn: async () => {
      const results = await base44.entities.Project.filter({ id: resolvedProjectId });
      return results?.[0] || null;
    },
    enabled: Boolean(resolvedProjectId),
  });

  const { data: linkedClient } = useQuery({
    queryKey: ['client', project?.client_id],
    queryFn: async () => {
      const results = await base44.entities.Client.filter({ id: project.client_id });
      return results?.[0] || null;
    },
    enabled: Boolean(project?.client_id),
  });

  const { data: signedProposals = [] } = useQuery({
    queryKey: ['signed-proposals-for-work-stages', resolvedProjectId],
    queryFn: () => base44.entities.SignedProposal.list(),
    enabled: Boolean(resolvedProjectId),
  });

  const validSignedProposal = useMemo(() => {
    const fromUrl = signedProposals.find((item) => item.id === resolvedSignedProposalId);
    if (fromUrl && isValidSignedProposalForWorkStages(fromUrl)) return fromUrl;

    return signedProposals.find(
      (item) => String(item.project_id || '') === resolvedProjectId
        && isValidSignedProposalForWorkStages(item),
    ) || null;
  }, [signedProposals, resolvedProjectId, resolvedSignedProposalId]);

  const {
    data: workStages = [],
    isLoading: isLoadingStages,
    refetch: refetchWorkStages,
  } = useQuery({
    queryKey: ['work-stages', resolvedProjectId],
    queryFn: () => loadWorkStagesForProject(resolvedProjectId),
    enabled: Boolean(resolvedProjectId),
  });

  const sortedStages = useMemo(
    () => sortWorkStages(workStages.filter((stage) => stage.status !== 'cancelled')),
    [workStages],
  );

  const normalizedStages = useMemo(
    () => normalizeWorkStageStatuses(workStages),
    [workStages],
  );

  const activeStage = useMemo(
    () => getActiveWorkStage(workStages),
    [workStages],
  );

  const clientName = linkedClient?.name || project?.client_name || '';

  useEffect(() => {
    if (!resolvedStageId || isLoadingStages) return;

    const row = document.getElementById(`work-stage-row-${resolvedStageId}`);
    if (!row) return;

    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [resolvedStageId, isLoadingStages, workStages.length]);

  const handleAfterMutation = async () => {
    await recalculateProjectWorkStages(resolvedProjectId);
    await refetchWorkStages();
    await invalidateWorkStageQueries(queryClient, resolvedProjectId);
  };

  const openCreateDialog = () => {
    setEditingStage(null);
    setDialogOpen(true);
  };

  const openEditDialog = (stage) => {
    setEditingStage(stage);
    setDialogOpen(true);
  };

  const handleDeleteStage = async (stage) => {
    const confirmed = window.confirm(`למחוק את השלב "${stage.title}"?`);
    if (!confirmed) return;

    setBusyStageId(stage.id);
    try {
      await base44.entities.WorkStage.delete(stage.id);
      await handleAfterMutation();
    } catch (error) {
      console.error('[WorkStages] failed to delete work stage', error);
      alert('מחיקת השלב נכשלה');
    } finally {
      setBusyStageId(null);
    }
  };

  const handleCancelStage = async (stage) => {
    const confirmed = window.confirm(`לבטל את השלב "${stage.title}"?`);
    if (!confirmed) return;

    setBusyStageId(stage.id);
    try {
      await base44.entities.WorkStage.update(stage.id, { status: 'cancelled' });
      await handleAfterMutation();
    } catch (error) {
      console.error('[WorkStages] failed to cancel work stage', error);
      alert('ביטול השלב נכשל');
    } finally {
      setBusyStageId(null);
    }
  };

  const previewActiveStageAfterReorder = (reorderedStages) => {
    const normalized = normalizeWorkStageStatuses(reorderedStages);
    return getActiveWorkStage(normalized);
  };

  const applyReorder = async (nextStages) => {
    const nextActive = previewActiveStageAfterReorder(nextStages);
    const activeName = nextActive?.title || '(אין שלב פעיל)';
    const confirmed = window.confirm(
      `הסדר החדש ישנה את השלב הפעיל ואת התזכורות.\nהשלב הפעיל החדש יהיה: ${activeName}.\nהאם לשמור את הסדר החדש?`,
    );
    if (!confirmed) return;

    setBusyStageId('reorder');
    try {
      for (let index = 0; index < nextStages.length; index += 1) {
        const stage = nextStages[index];
        if (Number(stage.order_index) !== index + 1) {
          await base44.entities.WorkStage.update(stage.id, { order_index: index + 1 });
        }
      }
      await handleAfterMutation();
    } catch (error) {
      console.error('[WorkStages] failed to reorder work stages', error);
      alert('שמירת הסדר החדש נכשלה');
    } finally {
      setBusyStageId(null);
    }
  };

  const moveStage = async (stageId, direction) => {
    const index = sortedStages.findIndex((stage) => stage.id === stageId);
    if (index < 0) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sortedStages.length) return;

    const reordered = [...sortedStages];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);

    const withOrder = reordered.map((stage, orderIndex) => ({
      ...stage,
      order_index: orderIndex + 1,
    }));

    await applyReorder(withOrder);
  };

  if (isLoadingProject || isLoadingStages) {
    return (
      <div className="min-h-screen bg-background p-6" dir="rtl">
        <p className="text-sm text-muted-foreground">טוען שלבי עבודה...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background p-6" dir="rtl">
        <p className="text-sm text-muted-foreground">הפרויקט לא נמצא.</p>
      </div>
    );
  }

  const projectDetailsUrl = createPageUrl(`ProjectDetails?id=${project.id}`);
  const effectiveSignedProposalId = validSignedProposal?.id || resolvedSignedProposalId || '';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50" dir="rtl">
      <div className="max-w-[1200px] mx-auto px-8 py-10 space-y-6">
        <div className="flex items-center gap-2 flex-wrap">
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link to={projectDetailsUrl}>
              <ArrowRight className="w-4 h-4" />
              חזרה לפרויקט
            </Link>
          </Button>
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <CardTitle>שלבי עבודה</CardTitle>
              <div className="text-sm text-muted-foreground space-y-1">
                <p>
                  <span className="font-medium text-foreground">{project.name || 'פרויקט'}</span>
                  {clientName ? ` · ${clientName}` : ''}
                </p>
                <p className="text-xs">
                  {project.bid_number ? `BID ${project.bid_number}` : null}
                  {project.bid_number && project.work_number ? ' · ' : null}
                  {project.work_number ? `עבודה ${project.work_number}` : null}
                  {(project.bid_number || project.work_number) && project.status ? ' · ' : null}
                  {project.status ? `סטטוס: ${formatProjectStatus(project.status)}` : null}
                </p>
                <p className="text-xs">
                  {validSignedProposal ? (
                    <Badge variant="secondary" className="font-normal">
                      יש הצעה/הזמנה חתומה תקפה
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="font-normal">
                      אין הצעה/הזמנה חתומה תקפה
                    </Badge>
                  )}
                </p>
                {activeStage ? (
                  <p className="text-xs">
                    שלב פעיל: {activeStage.title}
                  </p>
                ) : (
                  <p className="text-xs">אין שלב פעיל כרגע</p>
                )}
              </div>
            </div>
            <Button onClick={openCreateDialog}>הוסף שלב עבודה</Button>
          </CardHeader>
          <CardContent>
            {sortedStages.length === 0 ? (
              <p className="text-sm text-muted-foreground">עדיין לא הוגדרו שלבי עבודה לפרויקט.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>סדר</TableHead>
                    <TableHead>שם</TableHead>
                    <TableHead>סטטוס</TableHead>
                    <TableHead>אהרון</TableHead>
                    <TableHead>לקוח</TableHead>
                    <TableHead>שרטט</TableHead>
                    <TableHead>תאריך יעד</TableHead>
                    <TableHead>חשבונית</TableHead>
                    <TableHead>הערות</TableHead>
                    <TableHead>פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedStages.map((stage, index) => {
                    const normalized = normalizedStages.find((item) => item.id === stage.id) || stage;
                    return (
                      <TableRow
                        key={stage.id}
                        id={`work-stage-row-${stage.id}`}
                        className={cn(
                          resolvedStageId === stage.id && 'bg-primary/5 ring-1 ring-primary/30',
                        )}
                      >
                        <TableCell>{stage.order_index ?? index + 1}</TableCell>
                        <TableCell>{stage.title}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {STATUS_LABELS[normalized.status] || normalized.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatBoolean(stage.aaron_approved)}</TableCell>
                        <TableCell>{formatBoolean(stage.client_approved)}</TableCell>
                        <TableCell>{formatBoolean(stage.draftsman_approved)}</TableCell>
                        <TableCell>{formatDate(stage.target_date)}</TableCell>
                        <TableCell>{formatBoolean(stage.invoice_required_on_completion)}</TableCell>
                        <TableCell className="max-w-[180px] truncate">{stage.notes || '-'}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busyStageId === stage.id || index === 0}
                              onClick={() => { void moveStage(stage.id, 'up'); }}
                            >
                              <ArrowUp className="w-3 h-3" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busyStageId === stage.id || index === sortedStages.length - 1}
                              onClick={() => { void moveStage(stage.id, 'down'); }}
                            >
                              <ArrowDown className="w-3 h-3" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={Boolean(busyStageId)}
                              onClick={() => openEditDialog(stage)}
                            >
                              ערוך
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busyStageId === stage.id}
                              onClick={() => { void handleCancelStage(stage); }}
                            >
                              בטל
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              disabled={busyStageId === stage.id}
                              onClick={() => { void handleDeleteStage(stage); }}
                            >
                              מחק
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <WorkStageDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        stage={editingStage}
        project={project}
        signedProposalId={effectiveSignedProposalId}
        existingStages={workStages}
        onSaved={handleAfterMutation}
      />
    </div>
  );
}
