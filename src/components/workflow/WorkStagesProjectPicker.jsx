import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
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
import { buildWorkStagesPageUrl } from '@/lib/workflowNavigation';
import { isValidSignedProposalForWorkStages } from '@/lib/signedProposalValidation';

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

export default function WorkStagesProjectPicker() {
  const navigate = useNavigate();
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [showAllProjects, setShowAllProjects] = useState(false);

  const { data: projects = [], isLoading: isLoadingProjects } = useQuery({
    queryKey: ['work-stages-picker-projects'],
    queryFn: () => base44.entities.Project.list('-year'),
  });

  const { data: clients = [], isLoading: isLoadingClients } = useQuery({
    queryKey: ['work-stages-picker-clients'],
    queryFn: () => base44.entities.Client.list(),
  });

  const { data: signedProposals = [], isLoading: isLoadingSignedProposals } = useQuery({
    queryKey: ['work-stages-picker-signed-proposals'],
    queryFn: () => base44.entities.SignedProposal.list(),
  });

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

  const isLoading = isLoadingProjects || isLoadingClients || isLoadingSignedProposals;

  const handleOpenProject = () => {
    if (!selectedProjectId) return;

    const signedProposal = validSignedProposalByProjectId.get(selectedProjectId);
    const url = buildWorkStagesPageUrl({
      projectId: selectedProjectId,
      signedProposalId: signedProposal?.id || '',
    });

    navigate(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50" dir="rtl">
      <div className="max-w-[720px] mx-auto px-8 py-10 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">שלבי עבודה</h1>
          <p className="text-sm text-muted-foreground mt-2">
            בחר פרויקט כדי לנהל את שלבי העבודה שלו.
          </p>
        </div>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">בחירת פרויקט</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">טוען פרויקטים...</p>
            ) : (
              <>
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
                          {formatPickerLabel(
                            project,
                            clientNameById.get(project.client_id),
                          )}
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
                    שים לב: לפרויקט זה לא נמצאה הצעה/הזמנה חתומה. עדיין אפשר לנהל שלבי עבודה, אך בדרך כלל שלבי עבודה מתחילים לאחר חתימה.
                  </p>
                ) : null}

                <Button
                  type="button"
                  disabled={!selectedProjectId}
                  onClick={handleOpenProject}
                >
                  נהל שלבי עבודה לפרויקט
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
