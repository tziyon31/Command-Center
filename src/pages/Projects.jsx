import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Search } from 'lucide-react';
import { assertProjectHasClientId } from '@/lib/projectValidation';
import { runClientReminderRulesForClient } from '@/lib/clientReminderRules';
import CreateClientDialog from '@/components/workflow/CreateClientDialog';
import { buildInitialProjectForm, EMPTY_PROJECT_FORM } from '@/lib/projectDefaults';
import { buildProposalFormPageUrl } from '@/lib/workflowNavigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS_LABELS = {
  lead: { label: 'ליד', color: 'bg-gray-100 text-gray-700' },
  pricing: { label: 'בתמחור', color: 'bg-yellow-100 text-yellow-800' },
  signed: { label: 'התקבלה', color: 'bg-green-100 text-green-800' },
  planning: { label: 'בתכנון', color: 'bg-blue-100 text-blue-800' },
  submission: { label: 'בהגשה', color: 'bg-indigo-100 text-indigo-800' },
  execution: { label: 'בעבודה', color: 'bg-purple-100 text-purple-800' },
  completed: { label: 'בוצע', color: 'bg-teal-100 text-teal-800' },
  collection_completed: { label: 'גבייה הושלמה', color: 'bg-emerald-100 text-emerald-800' },
  cancelled: { label: 'בוטלה', color: 'bg-red-100 text-red-800' },
  waiting: { label: 'ממתין', color: 'bg-orange-100 text-orange-800' },
  rejected: { label: 'לא התקבלה', color: 'bg-red-100 text-red-700' },
};

// Active statuses = has a work number / actively in progress or completed
const ACTIVE_STATUSES = ['planning', 'submission', 'execution', 'completed', 'collection_completed', 'signed'];
const PROPOSAL_STATUSES = ['lead', 'pricing', 'waiting', 'rejected', 'cancelled'];

export default function Projects() {
  const [searchTerm, setSearchTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isCreateClientOpen, setIsCreateClientOpen] = useState(false);
  const [savedProject, setSavedProject] = useState(null);
  const [formData, setFormData] = useState(EMPTY_PROJECT_FORM);

  const queryClient = useQueryClient();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-year'),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => base44.entities.Client.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Project.create(data),
    onSuccess: async (project) => {
      const client = clients.find((item) => item.id === project?.client_id);
      if (client) {
        try {
          await runClientReminderRulesForClient(client);
        } catch (error) {
          console.error('[Projects] failed to run client reminder rules', error);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
      setSavedProject(project);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!assertProjectHasClientId(formData.client_id)) return;

    createMutation.mutate(formData);
  };

  const applyClientToProjectForm = (client) => {
    if (!client?.id) return;

    setFormData((prev) => ({
      ...prev,
      client_id: client.id,
      name: prev.name?.trim() ? prev.name : client.name,
      source_inquiry_id: prev.source_inquiry_id || client.source_inquiry_id || '',
    }));
    queryClient.invalidateQueries({ queryKey: ['clients'] });
  };

  const handleClientSelect = (selectedClientId) => {
    const client = clients.find((item) => item.id === selectedClientId);
    applyClientToProjectForm(client);
  };

  const handleNewClientCreated = (client) => {
    applyClientToProjectForm(client);
    setIsCreateClientOpen(false);
  };

  const handleDialogOpenChange = (open) => {
    setDialogOpen(open);

    if (open) {
      setFormData(buildInitialProjectForm({ projects }));
      setSavedProject(null);
      setIsCreateClientOpen(false);
      return;
    }

    setIsCreateClientOpen(false);
    setSavedProject(null);
    setFormData(EMPTY_PROJECT_FORM);
  };

  const linkedClient = clients.find((client) => client.id === formData.client_id);

  const filtered = projects.filter(p =>
    p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.city?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.bid_number?.includes(searchTerm) ||
    p.work_number?.includes(searchTerm)
  );

  // Split into proposals and active
  const proposals = filtered.filter(p => PROPOSAL_STATUSES.includes(p.status));
  const actives = filtered.filter(p => ACTIVE_STATUSES.includes(p.status));

  const ProjectTable = ({ projects, title, color }) => (
    <div className="space-y-2">
      <h2 className={`text-lg font-bold px-1 ${color}`}>{title} ({projects.length})</h2>
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-right w-20">BID</TableHead>
              <TableHead className="text-right w-20">מס' עבודה</TableHead>
              <TableHead className="text-right">פרויקט</TableHead>
              <TableHead className="text-right">עיר</TableHead>
              <TableHead className="text-right">סוג</TableHead>
              <TableHead className="text-right">שטח / יח"ד</TableHead>
              <TableHead className="text-right">שנה</TableHead>
              <TableHead className="text-right">שכ"ט ₪</TableHead>
              <TableHead className="text-right">סטטוס</TableHead>
              <TableHead className="text-right">הערות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map(project => {
              const st = STATUS_LABELS[project.status] || { label: project.status, color: 'bg-gray-100 text-gray-700' };
              return (
                <TableRow key={project.id} className="hover:bg-muted/30 cursor-pointer">
                  <TableCell>
                    <Link to={createPageUrl(`ProjectDetails?id=${project.id}`)} className="font-mono text-sm text-muted-foreground hover:text-primary">
                      {project.bid_number || '-'}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {project.work_number || '-'}
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link to={createPageUrl(`ProjectDetails?id=${project.id}`)} className="hover:text-primary">
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{project.city || '-'}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{project.project_type || '-'}</TableCell>
                  <TableCell className="text-muted-foreground text-sm max-w-[150px] truncate">{project.area || '-'}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{project.year || '-'}</TableCell>
                  <TableCell className="font-semibold text-sm">
                    {project.total_amount ? `₪${project.total_amount.toLocaleString()}` : '-'}
                  </TableCell>
                  <TableCell>
                    <Badge className={`text-xs ${st.color}`}>{st.label}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs max-w-[120px] truncate">{project.notes || '-'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1600px] mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">פרויקטים</h1>
          <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
            <DialogTrigger asChild>
              <Button size="lg">
                <Plus className="w-5 h-5 ml-2" />
                פרויקט חדש
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>הוספת פרויקט חדש</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>מספר BID</Label>
                    <Input value={formData.bid_number} onChange={(e) => setFormData({ ...formData, bid_number: e.target.value })} placeholder="00055" />
                  </div>
                  <div className="space-y-2">
                    <Label>מספר עבודה</Label>
                    <Input value={formData.work_number} onChange={(e) => setFormData({ ...formData, work_number: e.target.value })} placeholder="1055" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>שם הפרויקט *</Label>
                    <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
                  </div>
                  <div className="space-y-2">
                    <Label>עיר</Label>
                    <Input value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>סוג פרויקט</Label>
                    <Input value={formData.project_type} onChange={(e) => setFormData({ ...formData, project_type: e.target.value })} placeholder="מגורים / מסחר / ציבורי..." />
                  </div>
                  <div className="space-y-2">
                    <Label>שטח / יח"ד</Label>
                    <Input value={formData.area} onChange={(e) => setFormData({ ...formData, area: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>סטטוס</Label>
                    <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pricing">בתמחור</SelectItem>
                        <SelectItem value="waiting">ממתין</SelectItem>
                        <SelectItem value="signed">התקבלה</SelectItem>
                        <SelectItem value="execution">בעבודה</SelectItem>
                        <SelectItem value="completed">בוצע</SelectItem>
                        <SelectItem value="cancelled">בוטלה</SelectItem>
                        <SelectItem value="rejected">לא התקבלה</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>שכ"ט ₪</Label>
                    <Input type="number" value={formData.total_amount} onChange={(e) => setFormData({ ...formData, total_amount: parseFloat(e.target.value) || 0 })} />
                  </div>
                  <div className="space-y-2">
                    <Label>שנה</Label>
                    <Input type="number" value={formData.year} onChange={(e) => setFormData({ ...formData, year: parseInt(e.target.value) || new Date().getFullYear() })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-client-select">לקוח *</Label>
                  {linkedClient && (
                    <p className="text-xs text-muted-foreground">
                      לקוח משויך: {linkedClient.name}
                    </p>
                  )}
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
                    <Select
                      value={formData.client_id || undefined}
                      onValueChange={handleClientSelect}
                      disabled={createMutation.isPending}
                    >
                      <SelectTrigger id="project-client-select" className="w-full">
                        <SelectValue placeholder="בחר לקוח" />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map((client) => (
                          <SelectItem key={client.id} value={client.id}>
                            {client.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 whitespace-nowrap min-w-[5.5rem]"
                      onClick={() => setIsCreateClientOpen(true)}
                      disabled={createMutation.isPending}
                      data-testid="project-modal-new-client-btn"
                    >
                      לקוח חדש
                    </Button>
                  </div>
                </div>
                <CreateClientDialog
                  open={isCreateClientOpen}
                  onOpenChange={setIsCreateClientOpen}
                  initialName={formData.name}
                  sourceInquiryId={formData.source_inquiry_id}
                  onClientCreated={handleNewClientCreated}
                />
                <div className="space-y-2">
                  <Label>הערות</Label>
                  <Textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} />
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)}>ביטול</Button>
                  <Button type="submit" disabled={!formData.client_id || createMutation.isPending}>
                    {createMutation.isPending ? 'שומר...' : 'שמור'}
                  </Button>
                </div>

                <div className="rounded-md border p-4 space-y-3">
                  <h3 className="text-sm font-semibold">המשך טיפול</h3>
                  <p className="text-xs text-muted-foreground">
                    {savedProject?.id
                      ? 'הפרויקט נשמר, ניתן לפתוח הצעת מחיר.'
                      : 'יש לשמור את הפרויקט לפני פתיחת הצעת מחיר.'}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    asChild={Boolean(savedProject?.id)}
                    disabled={!savedProject?.id}
                  >
                    {savedProject?.id ? (
                      <Link
                        to={buildProposalFormPageUrl({
                          projectId: savedProject.id,
                          projectName: savedProject.name,
                          clientId: savedProject.client_id,
                          clientName: linkedClient?.name || '',
                          sourceInquiryId: savedProject.source_inquiry_id || '',
                        })}
                      >
                        פתח הצעת מחיר
                      </Link>
                    ) : (
                      <span>פתח הצעת מחיר</span>
                    )}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            placeholder="חיפוש לפי שם, עיר, מספר BID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pr-10"
          />
        </div>

        {isLoading ? (
          <div className="text-center py-12"><p className="text-muted-foreground">טוען...</p></div>
        ) : (
          <>
            {/* Active Projects */}
            <ProjectTable projects={actives} title="עבודות פעילות" color="text-blue-700" />
            {/* Proposals */}
            <ProjectTable proposals={proposals} projects={proposals} title="הצעות מחיר" color="text-orange-700" />
          </>
        )}
      </div>
    </div>
  );
}