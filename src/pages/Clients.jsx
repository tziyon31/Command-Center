import React, { useState } from 'react';
import { api as base44 } from '@/api/apiClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import StatusBadge from '../components/StatusBadge.jsx';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, Upload } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ClientContinueToProject from '@/components/workflow/ClientContinueToProject';
import { runClientReminderRulesForClient } from '@/lib/clientReminderRules';
import { buildProposalFormPageUrl } from '@/lib/workflowNavigation';

const EMPTY_CLIENT_FORM = {
  name: '',
  email: '',
  phone: '',
  company: '',
  address: '',
  notes: '',
  rating: 'B',
};

export default function Clients() {
  const [searchTerm, setSearchTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [savedClientId, setSavedClientId] = useState(null);
  // Migration 0.3: file import disabled — restore with importDialogOpen/importing when backend supports upload
  // const [importDialogOpen, setImportDialogOpen] = useState(false);
  // const [importing, setImporting] = useState(false);
  const [formData, setFormData] = useState(EMPTY_CLIENT_FORM);

  const queryClient = useQueryClient();

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: () => base44.entities.Client.list('-created_date'),
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Client.create(data),
    onSuccess: async (createdClient) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
      setSavedClientId(createdClient.id);

      try {
        await runClientReminderRulesForClient(createdClient);
      } catch (error) {
        console.error('[Clients] failed to run client reminder rules', error);
      }
    },
  });

  const filteredClients = clients.filter(client =>
    client.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.company?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleDialogOpenChange = (open) => {
    setDialogOpen(open);
    if (!open) {
      setSavedClientId(null);
      setFormData(EMPTY_CLIENT_FORM);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate({
      ...formData,
      name: formData.name.trim(),
      status: 'draft',
    });
  };

  /* Migration 0.3: file import via base44.integrations.Core — disabled until self-hosted backend
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setImporting(true);

    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const result = await base44.integrations.Core.ExtractDataFromUploadedFile({
        file_url,
        json_schema: {
          type: "array",
          items: {
            type: "object",
            properties: {
              "שם העסק": { type: "string" },
              "שם איש הקשר": { type: "string" },
              "דואל": { type: "string" },
              "נייד": { type: "string" },
              "מספר עסק": { type: "string" },
              "כתובת": { type: "string" },
              "כמות מסמכים": { type: "number" }
            },
            additionalProperties: true
          }
        }
      });

      if (result.status === 'success' && Array.isArray(result.output)) {
        const clientsData = result.output.map(item => {
          const client = {
            name: item["שם איש הקשר"] || '',
            company: item["שם העסק"] || '',
            email: item["דואל"] || '',
            phone: item["נייד"] || '',
            business_number: item["מספר עסק"] || '',
            address: item["כתובת"] || '',
            document_count: item["כמות מסמכים"] || 0,
            rating: 'B',
            notes: ''
          };
          const knownFields = new Set([
            "שם העסק", "שם איש הקשר", "דואל", "נייד", "מספר עסק", "כתובת", "כמות מסמכים"
          ]);
          const extraNotes = [];
          for (const key in item) {
            if (item.hasOwnProperty(key) && !knownFields.has(key) && item[key]) {
              extraNotes.push(`${key}: ${item[key]}`);
            }
          }
          if (extraNotes.length > 0) {
            client.notes = extraNotes.join('\n');
          }
          return client;
        }).filter(client => client.name);

        await base44.entities.Client.bulkCreate(clientsData);
        queryClient.invalidateQueries(['clients']);
        setImportDialogOpen(false);
        alert(`יובאו בהצלחה ${clientsData.length} לקוחות!`);
      } else {
        alert('שגיאה בעיבוד הקובץ: ' + (result.details || 'נסה שוב'));
      }
    } catch (error) {
      alert('שגיאה בייבוא הקובץ: ' + error.message);
    } finally {
      setImporting(false);
    }
  };
  */

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1400px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">לקוחות</h1>
          <div className="flex gap-3">
            <Button size="lg" variant="outline" disabled title="בקרוב">
              <Upload className="w-5 h-5 ml-2" />
              ייבוא מקובץ
            </Button>
            {/* Migration 0.3: original import dialog — see handleFileUpload comment above
            <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
              ...
            </Dialog>
            */}
            <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
              <DialogTrigger asChild>
                <Button size="lg">
                  <Plus className="w-5 h-5 ml-2" />
                  לקוח חדש
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>הוספת לקוח חדש</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">שם לקוח *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="company">שם חברה</Label>
                    <Input
                      id="company"
                      value={formData.company}
                      onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">מייל</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">טלפון</Label>
                    <Input
                      id="phone"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">כתובת</Label>
                  <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rating">דירוג</Label>
                  <Select value={formData.rating} onValueChange={(value) => setFormData({ ...formData, rating: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">A - לקוח מצוין</SelectItem>
                      <SelectItem value="B">B - לקוח טוב</SelectItem>
                      <SelectItem value="C">C - לקוח בינוני</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">הערות</Label>
                  <Textarea
                    id="notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                  />
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)}>
                    ביטול
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? 'שומר...' : 'שמור'}
                  </Button>
                </div>

                <ClientContinueToProject
                  clientId={savedClientId}
                  clientName={formData.name}
                  disabled={!savedClientId}
                  statusMessage={
                    savedClientId
                      ? undefined
                      : 'יש לשמור את הלקוח לפני פתיחת פרויקט.'
                  }
                />

                <div className="rounded-md border p-4 space-y-3">
                  <h3 className="text-sm font-semibold">הצעת מחיר</h3>
                  <p className="text-xs text-muted-foreground">
                    {savedClientId
                      ? 'ניתן לפתוח טופס הצעת מחיר עם מילוי מקדים.'
                      : 'יש לשמור את הלקוח לפני פתיחת הצעת מחיר.'}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    asChild={Boolean(savedClientId)}
                    disabled={!savedClientId || createMutation.isPending}
                  >
                    {savedClientId ? (
                      <Link
                        to={buildProposalFormPageUrl({
                          clientId: savedClientId,
                          clientName: formData.name.trim(),
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
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            placeholder="חיפוש לקוחות..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pr-10"
          />
        </div>

        {/* Clients Table */}
        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">טוען...</p>
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">לא נמצאו לקוחות</p>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right w-12">#</TableHead>
                  <TableHead className="text-right">שם העסק</TableHead>
                  <TableHead className="text-right">שם איש הקשר</TableHead>
                  <TableHead className="text-right">דוא"ל</TableHead>
                  <TableHead className="text-right">נייד</TableHead>
                  <TableHead className="text-right">מספר עסק (ח.פ.)</TableHead>
                  <TableHead className="text-right">כתובת</TableHead>
                  <TableHead className="text-right">כמות מסמכים</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients.map((client, index) => (
                  <TableRow key={client.id} className="hover:bg-muted/30 cursor-pointer">
                    <TableCell>
                      <Link to={createPageUrl(`ClientDetails?id=${client.id}`)} className="block w-full">
                        {index + 1}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">
                      <Link to={createPageUrl(`ClientDetails?id=${client.id}`)} className="block w-full hover:text-primary">
                        {client.company || '-'}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link to={createPageUrl(`ClientDetails?id=${client.id}`)} className="block w-full hover:text-primary">
                        {client.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{client.email || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{client.phone || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{client.business_number || '-'}</TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate">{client.address || '-'}</TableCell>
                    <TableCell className="text-center">{client.document_count ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}