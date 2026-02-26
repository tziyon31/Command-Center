import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import StatusBadge from '../components/StatusBadge.jsx';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, FolderKanban, DollarSign, Calendar } from 'lucide-react';
import { format } from 'date-fns';

export default function Projects() {
  const [searchTerm, setSearchTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    client_id: '',
    name: '',
    description: '',
    status: 'lead',
    total_amount: 0,
    start_date: '',
    end_date: ''
  });

  const queryClient = useQueryClient();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list('-created_date'),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => base44.entities.Client.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Project.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['projects']);
      setDialogOpen(false);
      setFormData({ client_id: '', name: '', description: '', status: 'lead', total_amount: 0, start_date: '', end_date: '' });
    }
  });

  const filteredProjects = projects.filter(project =>
    project.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    project.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1400px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">פרויקטים</h1>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
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
                <div className="space-y-2">
                  <Label htmlFor="client_id">לקוח *</Label>
                  <Select value={formData.client_id} onValueChange={(value) => setFormData({ ...formData, client_id: value })} required>
                    <SelectTrigger>
                      <SelectValue placeholder="בחר לקוח" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map(client => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">שם הפרויקט *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">תיאור</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="status">סטטוס</Label>
                    <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lead">ליד</SelectItem>
                        <SelectItem value="pricing">בתמחור</SelectItem>
                        <SelectItem value="signed">נחתם</SelectItem>
                        <SelectItem value="planning">בתכנון</SelectItem>
                        <SelectItem value="submission">בהגשה</SelectItem>
                        <SelectItem value="execution">בביצוע</SelectItem>
                        <SelectItem value="completed">הושלם</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="total_amount">סכום כולל</Label>
                    <Input
                      id="total_amount"
                      type="number"
                      value={formData.total_amount}
                      onChange={(e) => setFormData({ ...formData, total_amount: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="start_date">תאריך התחלה</Label>
                    <Input
                      id="start_date"
                      type="date"
                      value={formData.start_date}
                      onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="end_date">תאריך סיום משוער</Label>
                    <Input
                      id="end_date"
                      type="date"
                      value={formData.end_date}
                      onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    ביטול
                  </Button>
                  <Button type="submit">
                    שמור
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            placeholder="חיפוש פרויקטים..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pr-10"
          />
        </div>

        {/* Projects Grid */}
        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">טוען...</p>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">לא נמצאו פרויקטים</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjects.map(project => (
              <Link key={project.id} to={createPageUrl(`ProjectDetails?id=${project.id}`)}>
                <Card className="hover:shadow-lg transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                          <FolderKanban className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">{project.name}</h3>
                        </div>
                      </div>
                      <StatusBadge status={project.status} />
                    </div>
                    {project.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{project.description}</p>
                    )}
                    <div className="space-y-2 pt-3 border-t">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <DollarSign className="w-4 h-4" />
                          <span>סה"כ</span>
                        </div>
                        <span className="font-semibold">₪{project.total_amount?.toLocaleString() || 0}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <DollarSign className="w-4 h-4" />
                          <span>נגבה</span>
                        </div>
                        <span className="font-semibold text-green-600">₪{project.collected_amount?.toLocaleString() || 0}</span>
                      </div>
                      {project.start_date && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="w-4 h-4" />
                          <span>{format(new Date(project.start_date), 'dd/MM/yyyy')}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}