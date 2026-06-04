import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Plus } from 'lucide-react';
import { buildWorkStagesPageUrl } from '@/lib/workflowNavigation';
import { isValidSignedProposalForWorkStages } from '@/lib/signedProposalValidation';
import {
  computeProjectWorkStageSummary,
  groupWorkStagesByProjectId,
} from '@/lib/workStageProjectSummary';

const formatPickerLabel = (project, clientName) => {
  const parts = [];
  const name = String(project?.name || '').trim();
  if (name) parts.push(name);

  const client = String(clientName || '').trim();
  if (client) parts.push(client);

  const bid = String(project?.bid_number || '').trim();
  if (bid) parts.push(`BID ${bid}`);

  return parts.length ? parts.join(' · ') : 'פרויקט ללא שם';
};

const formatDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('he-IL').format(date);
};

const buildValidSignedProposalByProjectId = (signedProposals = []) => {
  const map = new Map();

  for (const proposal of signedProposals) {
    if (!isValidSignedProposalForWorkStages(proposal)) continue;

    const projectId = String(proposal.project_id || '').trim();
    if (!projectId || map.has(projectId)) continue;

    map.set(projectId, proposal);
  }

  return map;
};

const OVERALL_STATUS_VARIANT = {
  'לא התחיל': 'outline',
  'ממתין': 'secondary',
  'בעבודה': 'default',
  'הושלם': 'outline',
};

function WorkStagesStartFlowPanel({
  projects,
  clients,
  signedProposals,
  onClose,
}) {
  const navigate = useNavigate();
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [showAllProjects, setShowAllProjects] = useState(false);

  const clientNameById = useMemo(() => {
    const map = new Map();
    for (const client of clients) {
      if (client?.id) map.set(client.id, client.name || '');
    }
    return map;
  }, [clients]);

  const validSignedProposalByProjectId = useMemo(
    () => buildValidSignedProposalByProjectId(signedProposals),
    [signedProposals],
  );

  const visibleProjects = useMemo(() => {
    const sorted = [...projects].sort((left, right) => (
      String(right?.year || '').localeCompare(String(left?.year || ''))
      || String(left?.name || '').localeCompare(String(right?.name || ''))
    ));

    if (showAllProjects) return sorted;

    return sorted.filter((project) => (
      project?.id && validSignedProposalByProjectId.has(project.id)
    ));
  }, [projects, showAllProjects, validSignedProposalByProjectId]);

  const selectedProject = visibleProjects.find((item) => item.id === selectedProjectId)
    || projects.find((item) => item.id === selectedProjectId)
    || null;

  const selectedHasValidSignedProposal = Boolean(
    selectedProject?.id && validSignedProposalByProjectId.has(selectedProject.id),
  );

  const handleOpenProject = () => {
    if (!selectedProjectId) return;

    const signedProposal = validSignedProposalByProjectId.get(selectedProjectId);
    navigate(buildWorkStagesPageUrl({
      projectId: selectedProjectId,
      signedProposalId: signedProposal?.id || '',
    }));
  };

  return (
    <Card className="border shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-lg">בחירת פרויקט לתהליך עבודה</CardTitle>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          סגור
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {visibleProjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {showAllProjects
              ? 'אין פרויקטים להצגה.'
              : 'אין פרויקטים עם הצעה/הזמנה חתומה. נסה לסמן "הצג גם פרויקטים ללא הצעה חתומה".'}
          </p>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="work-stages-project-select">פרויקט</Label>
          <Select
            value={selectedProjectId}
            onValueChange={setSelectedProjectId}
            disabled={visibleProjects.length === 0}
          >
            <SelectTrigger id="work-stages-project-select">
              <SelectValue placeholder="בחר פרויקט" />
            </SelectTrigger>
            <SelectContent>
              {visibleProjects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {formatPickerLabel(project, clientNameById.get(project.client_id))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={showAllProjects}
            onCheckedChange={(checked) => {
              setShowAllProjects(checked === true);
              setSelectedProjectId('');
            }}
          />
          הצג גם פרויקטים ללא הצעה חתומה
        </label>

        {selectedProject && !selectedHasValidSignedProposal ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">
            שים לב: לפרויקט זה לא נמצאה הצעה/הזמנה חתומה. בדרך כלל שלבי עבודה מתחילים לאחר חתימה.
          </p>
        ) : null}

        <Button
          type="button"
          disabled={!selectedProjectId}
          onClick={handleOpenProject}
        >
          נהל שלבי עבודה לפרויקט
        </Button>
      </CardContent>
    </Card>
  );
}

export default function WorkStagesProjectPicker() {
  const [showStartFlow, setShowStartFlow] = useState(false);

  const { data: workStages = [], isLoading: isLoadingStages } = useQuery({
    queryKey: ['work-stages-all'],
    queryFn: () => base44.entities.WorkStage.list(),
  });

  const { data: projects = [], isLoading: isLoadingProjects } = useQuery({
    queryKey: ['work-stages-list-projects'],
    queryFn: () => base44.entities.Project.list('-year'),
  });

  const { data: clients = [], isLoading: isLoadingClients } = useQuery({
    queryKey: ['work-stages-list-clients'],
    queryFn: () => base44.entities.Client.list(),
  });

  const { data: signedProposals = [], isLoading: isLoadingSignedProposals } = useQuery({
    queryKey: ['work-stages-list-signed-proposals'],
    queryFn: () => base44.entities.SignedProposal.list(),
  });

  const clientNameById = useMemo(() => {
    const map = new Map();
    for (const client of clients) {
      if (client?.id) map.set(client.id, client.name || '');
    }
    return map;
  }, [clients]);

  const projectById = useMemo(() => {
    const map = new Map();
    for (const project of projects) {
      if (project?.id) map.set(project.id, project);
    }
    return map;
  }, [projects]);

  const listRows = useMemo(() => {
    const groups = groupWorkStagesByProjectId(workStages);
    const rows = [];

    for (const [projectId, stages] of groups.entries()) {
      const summary = computeProjectWorkStageSummary(stages);
      if (!summary) continue;

      const project = projectById.get(projectId);
      const firstStage = stages[0];
      const clientName = project?.client_id
        ? clientNameById.get(project.client_id)
        : (firstStage?.client_name || '');

      rows.push({
        projectId,
        projectName: project?.name || firstStage?.project_name || 'פרויקט',
        clientName,
        bidNumber: project?.bid_number || '',
        workNumber: project?.work_number || '',
        ...summary,
      });
    }

    return rows.sort((left, right) => (
      String(left.projectName).localeCompare(String(right.projectName), 'he')
    ));
  }, [workStages, projectById, clientNameById]);

  const isLoading = isLoadingStages || isLoadingProjects || isLoadingClients;

  const openProjectUrl = (projectId) => buildWorkStagesPageUrl({ projectId });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50" dir="rtl">
      <div className="max-w-[1200px] mx-auto px-8 py-10 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">שלבי עבודה</h1>
            <p className="text-sm text-muted-foreground mt-2">
              ניהול שלבי עבודה פעילים לפי פרויקט
            </p>
          </div>
          <Button
            type="button"
            className="gap-2 shrink-0"
            onClick={() => setShowStartFlow((value) => !value)}
          >
            <Plus className="w-4 h-4" />
            תחילת תהליך עבודה
          </Button>
        </div>

        {showStartFlow ? (
          <WorkStagesStartFlowPanel
            projects={projects}
            clients={clients}
            signedProposals={signedProposals}
            onClose={() => setShowStartFlow(false)}
          />
        ) : null}

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">תהליכי עבודה פעילים</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">טוען תהליכי עבודה...</p>
            ) : listRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                אין עדיין פרויקטים עם שלבי עבודה. לחץ על &quot;תחילת תהליך עבודה&quot; כדי להתחיל.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>פרויקט</TableHead>
                    <TableHead>לקוח</TableHead>
                    <TableHead>BID / עבודה</TableHead>
                    <TableHead>התקדמות</TableHead>
                    <TableHead>שלב פעיל</TableHead>
                    <TableHead>סטטוס</TableHead>
                    <TableHead>יעד קרוב</TableHead>
                    <TableHead>פעולות</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listRows.map((row) => {
                    const targetLabel = formatDate(row.upcomingTargetDate);
                    const manageUrl = openProjectUrl(row.projectId);

                    return (
                      <TableRow key={row.projectId}>
                        <TableCell className="font-medium">{row.projectName}</TableCell>
                        <TableCell>{row.clientName || '-'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.bidNumber ? `BID ${row.bidNumber}` : '-'}
                          {row.bidNumber && row.workNumber ? ' · ' : ''}
                          {row.workNumber ? `עבודה ${row.workNumber}` : ''}
                          {!row.bidNumber && !row.workNumber ? '-' : null}
                        </TableCell>
                        <TableCell>
                          {row.completedStages}
                          /
                          {row.totalStages}
                          {' '}
                          שלבים הושלמו
                        </TableCell>
                        <TableCell>
                          {row.overallStatus === 'הושלם'
                            ? '—'
                            : (row.activeStage?.title || '—')}
                        </TableCell>
                        <TableCell>
                          <Badge variant={OVERALL_STATUS_VARIANT[row.overallStatus] || 'outline'}>
                            {row.overallStatus}
                          </Badge>
                        </TableCell>
                        <TableCell>{targetLabel || '—'}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <Button type="button" size="sm" variant="outline" asChild>
                              <Link to={manageUrl}>פתח</Link>
                            </Button>
                            <Button type="button" size="sm" asChild>
                              <Link to={manageUrl}>נהל שלבים</Link>
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
    </div>
  );
}
