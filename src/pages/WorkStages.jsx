import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus } from 'lucide-react';
import { api as base44 } from '@/api/apiClient';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import WorkStageDialog from '@/components/workflow/WorkStageDialog';
import WorkStageSortableList from '@/components/workflow/WorkStageSortableList';
import WorkStagesProjectPicker from '@/components/workflow/WorkStagesProjectPicker';
import {
  buildWorkStagePayloadWithStatus,
  buildWorkStageReorderConfirmMessage,
  findCompletedStagesInvalidatedByReorder,
  getActiveWorkStage,
  isWorkStageCompleted,
  normalizeWorkStageStatuses,
  sortWorkStages,
} from '@/lib/workStageLogic';
import {
  invalidateWorkStageQueries,
  loadWorkStagesForProject,
  recalculateProjectWorkStages,
} from '@/lib/workStageSync';
import { isValidSignedProposalForWorkStages } from '@/lib/signedProposalValidation';
import { buildInvoiceProcessFormPageUrl } from '@/lib/workflowNavigation';
import {
  isWorkStageEligibleForInvoice,
} from '@/lib/invoiceProcessUtils';

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
  const navigate = useNavigate();
  const [selectedInvoiceStageIds, setSelectedInvoiceStageIds] = useState([]);

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

  const statusByStageId = useMemo(() => {
    const map = {};
    for (const stage of normalizedStages) {
      if (stage?.id) map[stage.id] = stage.status;
    }
    return map;
  }, [normalizedStages]);

  const activeStage = useMemo(
    () => getActiveWorkStage(workStages),
    [workStages],
  );

  const completedStagesForInvoice = useMemo(
    () => sortedStages.filter((stage) => isWorkStageEligibleForInvoice(stage)),
    [sortedStages],
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
    await queryClient.invalidateQueries({ queryKey: ['work-stages-all'] });
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

  const handleApprovalToggle = async (stage, field, checked) => {
    const wasCompleted = isWorkStageCompleted(stage);
    const nextStage = { ...stage, [field]: checked };
    const willBeCompleted = isWorkStageCompleted(nextStage);

    if (wasCompleted && !willBeCompleted) {
      const confirmed = window.confirm(
        'ביטול האישור יחזיר את השלב למצב פתוח. אם זה השלב הראשון בסדר שלא הושלם, התזכורות יחזרו אליו. האם להמשיך?',
      );
      if (!confirmed) return;
    }

    setBusyStageId(stage.id);
    try {
      const merged = buildWorkStagePayloadWithStatus(nextStage, workStages);
      await base44.entities.WorkStage.update(stage.id, {
        aaron_approved: nextStage.aaron_approved === true,
        client_approved: nextStage.client_approved === true,
        draftsman_approved: nextStage.draftsman_approved === true,
        status: merged.status,
        completed_at: merged.completed_at || '',
      });
      await handleAfterMutation();
    } catch (error) {
      console.error('[WorkStages] failed to update approval', error);
      alert('עדכון האישור נכשל');
    } finally {
      setBusyStageId(null);
    }
  };

  const applyReorder = async (nextStages) => {
    const nextActive = previewActiveStageAfterReorder(nextStages);
    const invalidatedStages = findCompletedStagesInvalidatedByReorder(nextStages);
    const confirmMessage = buildWorkStageReorderConfirmMessage({
      nextActiveStage: nextActive,
      invalidatedStages,
    });
    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return;

    setBusyStageId('reorder');
    try {
      const invalidatedIds = new Set(invalidatedStages.map((stage) => stage.id));
      const orderById = new Map(
        nextStages.map((stage, index) => [stage.id, index + 1]),
      );

      for (const stage of workStages) {
        const nextOrder = orderById.get(stage.id);
        if (nextOrder === undefined) continue;

        const patch = {};
        const currentOrder = Number(stage.order_index) || 0;
        if (currentOrder !== nextOrder) {
          patch.order_index = nextOrder;
        }

        if (invalidatedIds.has(stage.id)) {
          patch.aaron_approved = false;
          patch.client_approved = false;
          patch.draftsman_approved = false;
          patch.completed_at = '';
        }

        if (!Object.keys(patch).length) continue;

        await base44.entities.WorkStage.update(stage.id, patch);
      }

      await handleAfterMutation();
    } catch (error) {
      console.error('[WorkStages] failed to reorder work stages', error);
      alert('שמירת הסדר החדש נכשלה');
    } finally {
      setBusyStageId(null);
    }
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    if (result.source.index === result.destination.index) return;

    const reordered = [...sortedStages];
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);

    const withOrder = reordered.map((stage, orderIndex) => ({
      ...stage,
      order_index: orderIndex + 1,
    }));

    void applyReorder(withOrder);
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
  const workStagesListUrl = createPageUrl('WorkStages');
  const effectiveSignedProposalId = validSignedProposal?.id || resolvedSignedProposalId || '';

  const handleInvoiceIncludeToggle = (stage, included) => {
    setSelectedInvoiceStageIds((prev) => {
      if (included) {
        return [...new Set([...prev, stage.id])];
      }
      return prev.filter((id) => id !== stage.id);
    });
  };

  const openInvoiceProcessForSelection = () => {
    if (!project?.id) return;

    const ids = selectedInvoiceStageIds.filter((id) => (
      completedStagesForInvoice.some((stage) => stage.id === id)
    ));

    if (!ids.length) {
      alert('בחר לפחות שלב אחד שהושלם לתהליך חשבונית');
      return;
    }

    const scope = ids.length === 1 ? 'stage' : 'multiple_stages';
    navigate(buildInvoiceProcessFormPageUrl({
      projectId: project.id,
      workStageIds: ids,
      invoiceScope: scope,
    }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50" dir="rtl">
      <div className="max-w-[1200px] mx-auto px-8 py-10 space-y-6">
        <div className="flex items-center gap-2 flex-wrap">
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link to={workStagesListUrl}>
              <ArrowRight className="w-4 h-4" />
              חזרה לרשימת שלבי עבודה
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link to={projectDetailsUrl}>
              <ArrowRight className="w-4 h-4" />
              חזרה לפרויקט
            </Link>
          </Button>
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader>
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
          </CardHeader>
          <CardContent className="space-y-4">
            {sortedStages.length === 0 ? (
              <p className="text-sm text-muted-foreground">עדיין לא הוגדרו שלבי עבודה לפרויקט.</p>
            ) : (
              <>
                <WorkStageSortableList
                  stages={sortedStages}
                  statusByStageId={statusByStageId}
                  statusLabels={STATUS_LABELS}
                  highlightedStageId={resolvedStageId}
                  busyStageId={busyStageId}
                  onDragEnd={handleDragEnd}
                  onEdit={openEditDialog}
                  onDelete={handleDeleteStage}
                  onCancel={handleCancelStage}
                  onApprovalToggle={handleApprovalToggle}
                  selectedInvoiceStageIds={selectedInvoiceStageIds}
                  onInvoiceIncludeToggle={handleInvoiceIncludeToggle}
                />

                {completedStagesForInvoice.length > 0 ? (
                  <div className="rounded-lg border border-dashed bg-muted/30 p-4 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      סמן שלבים שהושלמו ב&quot;בחר לחשבונית&quot; ולחץ לפתיחת תהליך חשבונית (ניתן לאחד כמה שלבים לחשבונית אחת).
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={selectedInvoiceStageIds.length === 0 || Boolean(busyStageId)}
                      onClick={openInvoiceProcessForSelection}
                    >
                      פתח תהליך חשבונית לשלבים שנבחרו
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    אין עדיין שלבים שהושלמו לפתיחת תהליך חשבונית.
                  </p>
                )}
              </>
            )}

            <Button
              type="button"
              variant="outline"
              className="w-full h-11 border-dashed gap-2"
              disabled={Boolean(busyStageId)}
              onClick={openCreateDialog}
            >
              <Plus className="h-4 w-4" />
              הוסף שלב עבודה
            </Button>
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
