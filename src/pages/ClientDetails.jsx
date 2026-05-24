import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle, FileText, Calendar, FolderOpen,
  TrendingUp, Star, ArrowRight, Phone, Mail, MapPin,
  CheckCircle2, Clock, XCircle
} from 'lucide-react';
import { subDays } from 'date-fns';
import { createPageUrl } from '@/utils';
import {
  CLIENT_DELETE_BUTTON_CLASS,
  CLIENT_DELETE_CONFIRM_MESSAGE,
  deleteClient,
} from '@/lib/clientDelete';
import ClientContinueToProject from '@/components/workflow/ClientContinueToProject';

const formatMoney = (value) =>
  new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(Number(value) || 0);

const RATING_COLORS = { A: 'bg-emerald-100 text-emerald-700', B: 'bg-blue-100 text-blue-700', C: 'bg-orange-100 text-orange-700' };
const STATUS_LABELS = {
  lead: 'ליד', pricing: 'בתמחור', signed: 'התקבלה', planning: 'בתכנון',
  submission: 'בהגשה', execution: 'בעבודה', completed: 'בוצע',
  collection_completed: 'גבייה הושלמה', cancelled: 'בוטל', waiting: 'ממתין', rejected: 'לא התקבלה',
};

export default function ClientDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const clientId = urlParams.get('id');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['client-details', clientId],
    queryFn: async () => {
      const [clients, projects, invoices, quotes, tasks] = await Promise.all([
        base44.entities.Client.filter({ id: clientId }),
        base44.entities.Project.filter({ client_id: clientId }),
        base44.entities.Invoice.list(),
        base44.entities.Quote.list(),
        base44.entities.Task.list(),
      ]);

      // filter invoices/quotes/tasks by project ids of this client
      const clientProjectIds = new Set((projects || []).map(p => p.id));
      const clientInvoices = (invoices || []).filter(i => clientProjectIds.has(i.project_id));
      const clientQuotes = (quotes || []).filter(q => clientProjectIds.has(q.project_id));
      const clientTasks = (tasks || []).filter(t => clientProjectIds.has(t.project_id));

      return {
        client: (clients || [])[0],
        projects: projects || [],
        invoices: clientInvoices,
        quotes: clientQuotes,
        tasks: clientTasks,
      };
    },
    enabled: !!clientId,
  });

  const summary = useMemo(() => {
    if (!data?.client) return null;
    const { projects, invoices, quotes, tasks } = data;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    // --- פיננסי ---
    const totalBilled = invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const totalCollected = invoices.reduce((s, i) => s + (Number(i.paid_amount) || 0), 0);
    const openBalance = totalBilled - totalCollected;
    const collectionRate = totalBilled ? Math.round((totalCollected / totalBilled) * 100) : 0;

    // מבוסס פרויקטים (fallback אם אין חשבוניות)
    const totalProjectValue = projects.reduce((s, p) => s + (Number(p.total_amount) || 0), 0);
    const totalProjectCollected = projects.reduce((s, p) => s + (Number(p.collected_amount) || 0), 0);
    const projectCollectionRate = totalProjectValue ? Math.round((totalProjectCollected / totalProjectValue) * 100) : 0;

    const useInvoiceData = invoices.length > 0;
    const displayRevenue = useInvoiceData ? totalCollected : totalProjectCollected;
    const displayBilled = useInvoiceData ? totalBilled : totalProjectValue;
    const displayBalance = useInvoiceData ? openBalance : (totalProjectValue - totalProjectCollected);
    const displayRate = useInvoiceData ? collectionRate : projectCollectionRate;

    // --- פרויקטים ---
    const activeProjects = projects.filter(p => ['signed', 'planning', 'submission', 'execution'].includes(p.status));
    const completedProjects = projects.filter(p => ['completed', 'collection_completed'].includes(p.status));
    const pendingProjects = projects.filter(p => ['lead', 'pricing', 'waiting'].includes(p.status));

    // --- הצעות ---
    const openQuotes = quotes.filter(q => ['draft', 'sent', 'pending', 'negotiation'].includes(q.status));
    const wonQuotes = quotes.filter(q => q.status === 'signed').length;
    const lostQuotes = quotes.filter(q => q.status === 'cancelled').length;
    const decidedQuotes = wonQuotes + lostQuotes;
    const winRate = decidedQuotes ? Math.round((wonQuotes / decidedQuotes) * 100) : 0;

    // --- משימות ---
    const todayTasks = tasks.filter(t => t.due_date === today && t.status !== 'completed');
    const overdueTasks = tasks.filter(t => t.status !== 'completed' && t.due_date && t.due_date < today);

    // --- התראות ---
    const attentionItems = [];
    const fourteenDaysAgo = subDays(now, 14);

    projects.forEach(p => {
      if (!['completed', 'collection_completed', 'cancelled', 'rejected'].includes(p.status)) {
        if (new Date(p.updated_date) < fourteenDaysAgo) {
          const days = Math.floor((now - new Date(p.updated_date)) / (1000 * 60 * 60 * 24));
          attentionItems.push({ type: 'inactive', label: `פרויקט ללא פעילות ${days} ימים`, sub: p.name });
        }
      }
    });

    invoices.forEach(inv => {
      if (inv.status !== 'paid' && inv.due_date && inv.due_date < today) {
        const days = Math.floor((now - new Date(inv.due_date)) / (1000 * 60 * 60 * 24));
        const balance = (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0);
        attentionItems.push({ type: 'overdue_invoice', label: `חשבונית ${inv.invoice_number || ''} באיחור ${days} ימים`, sub: formatMoney(balance) });
      }
    });

    overdueTasks.forEach(t => {
      attentionItems.push({ type: 'overdue_task', label: `משימה: ${t.title}`, sub: `איחור מ-${t.due_date}` });
    });

    // --- דירוג דינמי ---
    let dynamicRating = 'C';
    if (displayRate >= 90 && displayRevenue > 30000 && attentionItems.length === 0) dynamicRating = 'A';
    else if (displayRate >= 70 && displayRevenue > 5000 && attentionItems.length <= 2) dynamicRating = 'B';

    return {
      displayRevenue, displayBilled, displayBalance, displayRate,
      useInvoiceData,
      activeProjects, completedProjects, pendingProjects,
      openQuotes, wonQuotes, lostQuotes, winRate,
      todayTasks, overdueTasks, attentionItems,
      dynamicRating,
    };
  }, [data]);

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
    </div>
  );

  if (!data?.client) return (
    <div className="p-8 text-center text-muted-foreground">לקוח לא נמצא</div>
  );

  const { client, projects, invoices, quotes, tasks } = data;

  const handleDeleteClient = async () => {
    if (!clientId) return;

    const confirmed = window.confirm(CLIENT_DELETE_CONFIRM_MESSAGE);
    if (!confirmed) return;

    setIsDeleting(true);

    try {
      await deleteClient(clientId);
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.removeQueries({ queryKey: ['client-details', clientId] });
      navigate(createPageUrl('Clients'));
    } catch (error) {
      console.error('[Client] failed to delete client', error);
      alert('לא הצלחתי למחוק את הלקוח');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 space-y-6 max-w-[1400px] mx-auto">

      {/* HEADER */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <Link to={createPageUrl('Dashboard')}>
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowRight className="w-4 h-4" />
            חזרה לדשבורד
          </Button>
        </Link>
        <Link to={createPageUrl('Clients')}>
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowRight className="w-4 h-4" />
            חזרה ללקוחות
          </Button>
        </Link>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-3xl font-bold">{client.company || client.name}</h1>
                {client.company && <span className="text-muted-foreground text-lg">{client.name}</span>}
                {summary && (
                  <Badge className={`text-sm px-3 py-1 ${RATING_COLORS[summary.dynamicRating]}`}>
                    <Star className="w-3 h-3 ml-1" />
                    דירוג {summary.dynamicRating}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
                {client.phone && <span className="flex items-center gap-1"><Phone className="w-4 h-4" />{client.phone}</span>}
                {client.email && <span className="flex items-center gap-1"><Mail className="w-4 h-4" />{client.email}</span>}
                {client.address && <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />{client.address}</span>}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={`h-6 px-1.5 text-[10px] leading-none shrink-0 ${CLIENT_DELETE_BUTTON_CLASS}`}
              disabled={isDeleting}
              onClick={handleDeleteClient}
            >
              {isDeleting ? 'מוחק...' : 'מחק'}
            </Button>
          </div>

          {/* KPI Row */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiBox label="הכנסות" value={formatMoney(summary.displayRevenue)} sub={`מתוך ${formatMoney(summary.displayBilled)}`} />
              <KpiBox label="פתוח לגבייה" value={formatMoney(summary.displayBalance)} color={summary.displayBalance > 0 ? 'text-amber-600' : 'text-green-600'} />
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="text-xs text-muted-foreground mb-1">אחוז גבייה</div>
                <div className="text-2xl font-bold mb-2">{summary.displayRate}%</div>
                <Progress value={summary.displayRate} className="h-2" />
                {!summary.useInvoiceData && <div className="text-xs text-muted-foreground mt-1">מבוסס פרויקטים</div>}
              </div>
              <KpiBox label="פרויקטים פעילים" value={summary.activeProjects.length} sub={`${summary.completedProjects.length} הושלמו`} />
            </div>
          )}
        </CardContent>
      </Card>

      <ClientContinueToProject
        clientId={client.id}
        clientName={client.name}
        sourceInquiryId={client.source_inquiry_id}
        existingProjects={projects}
      />

      {/* ATTENTION ALERTS */}
      {summary?.attentionItems.length > 0 && (
        <Card className="border-red-200 bg-red-50 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <h2 className="font-bold text-red-800">דורש טיפול ({summary.attentionItems.length})</h2>
            </div>
            <div className="space-y-2">
              {summary.attentionItems.map((item, i) => (
                <div key={i} className="flex items-center justify-between bg-white rounded-lg px-4 py-2.5 border border-red-100">
                  <span className="text-sm font-medium text-red-800">{item.label}</span>
                  <span className="text-xs text-red-500">{item.sub}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* הצעות מחיר */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-orange-500" />
                <h2 className="font-bold text-lg">הצעות מחיר</h2>
              </div>
              <Badge variant="outline">{quotes.length} סה"כ</Badge>
            </div>
            {summary && (
              <div className="grid grid-cols-3 gap-3 mb-4">
                <StatMini label="פתוחות" value={summary.openQuotes.length} icon={<Clock className="w-4 h-4 text-amber-500" />} />
                <StatMini label="זכיות" value={summary.wonQuotes} icon={<CheckCircle2 className="w-4 h-4 text-green-500" />} />
                <StatMini label="הפסדים" value={summary.lostQuotes} icon={<XCircle className="w-4 h-4 text-red-400" />} />
              </div>
            )}
            {summary && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingUp className="w-4 h-4" />
                <span>אחוז הצלחה: <strong>{summary.winRate}%</strong></span>
              </div>
            )}
            {summary?.openQuotes.length > 0 && (
              <div className="mt-3 space-y-1">
                {summary.openQuotes.slice(0, 3).map(q => (
                  <div key={q.id} className="text-xs text-muted-foreground bg-slate-50 rounded px-3 py-1.5 flex justify-between">
                    <span>הצעה {q.quote_number || q.id.slice(-4)}</span>
                    <span>{formatMoney(q.total_amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* משימות */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-purple-500" />
                <h2 className="font-bold text-lg">משימות</h2>
              </div>
              {summary?.todayTasks.length > 0 && (
                <Badge className="bg-purple-100 text-purple-700">{summary.todayTasks.length} להיום</Badge>
              )}
            </div>
            {summary?.todayTasks.length === 0 && summary?.overdueTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין משימות פתוחות</p>
            ) : (
              <div className="space-y-2">
                {summary?.todayTasks.map(t => (
                  <div key={t.id} className="flex items-center gap-2 text-sm bg-purple-50 rounded-lg px-3 py-2">
                    <div className="w-2 h-2 rounded-full bg-purple-500 flex-shrink-0" />
                    <span className="font-medium">{t.title}</span>
                  </div>
                ))}
                {summary?.overdueTasks.slice(0, 3).map(t => (
                  <div key={t.id} className="flex items-center gap-2 text-sm bg-red-50 rounded-lg px-3 py-2">
                    <div className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                    <span className="text-red-700">{t.title}</span>
                    <span className="text-xs text-red-400 mr-auto">{t.due_date}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* פרויקטים פעילים */}
        <Card className="border-0 shadow-sm md:col-span-2">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-5 h-5 text-blue-500" />
                <h2 className="font-bold text-lg">פרויקטים</h2>
              </div>
              <div className="flex gap-2">
                {summary && (
                  <>
                    <Badge variant="outline" className="text-xs">פעילים: {summary.activeProjects.length}</Badge>
                    <Badge variant="outline" className="text-xs">הושלמו: {summary.completedProjects.length}</Badge>
                    <Badge variant="outline" className="text-xs">ממתינים: {summary.pendingProjects.length}</Badge>
                  </>
                )}
              </div>
            </div>
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין פרויקטים ללקוח זה</p>
            ) : (
              <div className="space-y-2">
                {projects.slice(0, 8).map(p => {
                  const pct = p.total_amount > 0 ? Math.round(((p.collected_amount || 0) / p.total_amount) * 100) : 0;
                  return (
                    <Link key={p.id} to={createPageUrl(`ProjectDetails?id=${p.id}`)}>
                      <div className="flex items-center gap-4 bg-slate-50 hover:bg-slate-100 transition-colors rounded-lg px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.city} · {p.project_type || ''}</div>
                        </div>
                        <Badge className="text-xs flex-shrink-0 bg-slate-200 text-slate-700">
                          {STATUS_LABELS[p.status] || p.status}
                        </Badge>
                        <div className="text-sm font-semibold flex-shrink-0 w-24 text-left">
                          {formatMoney(p.total_amount)}
                        </div>
                        {p.total_amount > 0 && (
                          <div className="w-20 flex-shrink-0">
                            <div className="flex justify-between text-xs text-muted-foreground mb-1">
                              <span>{pct}%</span>
                            </div>
                            <Progress value={pct} className="h-1.5" />
                          </div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* פרטי לקוח */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-5">
          <h2 className="font-bold text-lg mb-4">פרטי לקוח</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InfoField label="ח.פ / ע.מ" value={client.business_number} />
            <InfoField label="טלפון" value={client.phone} />
            <InfoField label="דוא״ל" value={client.email} />
            <InfoField label="כתובת" value={client.address} />
            <InfoField label="דירוג" value={client.rating} />
          </div>
          {client.notes && (
            <div className="mt-4 pt-4 border-t text-sm text-slate-600">
              <div className="font-medium text-xs text-muted-foreground mb-1">הערות</div>
              {client.notes}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}

function KpiBox({ label, value, sub, color = 'text-foreground' }) {
  return (
    <div className="bg-slate-50 rounded-xl p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function StatMini({ label, value, icon }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3 text-center">
      <div className="flex justify-center mb-1">{icon}</div>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function InfoField({ label, value }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium text-sm mt-0.5">{value || '-'}</div>
    </div>
  );
}