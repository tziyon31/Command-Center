import React from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import StatsCard from '../components/StatsCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  FileText, 
  Mail, 
  CheckCircle, 
  DollarSign, 
  Clock,
  TrendingUp,
  AlertCircle,
  Calendar,
  Plus
} from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

export default function Dashboard() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: quotes = [] } = useQuery({
    queryKey: ['quotes'],
    queryFn: () => base44.entities.Quote.list(),
    enabled: currentUser?.role === 'admin' || currentUser?.role === 'office_manager',
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => base44.entities.Invoice.list(),
    enabled: currentUser?.role === 'admin' || currentUser?.role === 'office_manager',
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => {
      // אם זה מבצע משימות - רק משימות שמוקצות אליו
      if (currentUser?.role === 'task_worker') {
        return base44.entities.Task.filter({ assigned_to: currentUser.email });
      }
      // אם זה עובד פרויקטים - משימות של הפרויקטים שלו
      if (currentUser?.role === 'project_worker') {
        return base44.entities.Task.filter({ assigned_to: currentUser.email });
      }
      return base44.entities.Task.list();
    },
    enabled: !!currentUser,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list(),
    enabled: currentUser?.role === 'admin' || currentUser?.role === 'office_manager' || currentUser?.role === 'project_worker',
  });

  // חישוב סטטיסטיקות
  const draftQuotes = quotes.filter(q => q.status === 'draft');
  const sentQuotes = quotes.filter(q => ['sent', 'pending', 'negotiation'].includes(q.status));
  const unpaidInvoices = invoices.filter(i => i.status !== 'paid');
  const totalOutstanding = unpaidInvoices.reduce((sum, inv) => sum + (inv.amount - inv.paid_amount), 0);
  const todayTasks = tasks.filter(t => t.status !== 'completed' && t.due_date === new Date().toISOString().split('T')[0]);

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'office_manager';
  const isProjectWorker = currentUser?.role === 'project_worker';
  const isTaskWorker = currentUser?.role === 'task_worker';

  // תצוגה מותאמת למבצע משימות
  if (isTaskWorker) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-[1400px] mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold">המשימות שלי</h1>
            <p className="text-muted-foreground mt-1">
              {format(new Date(), 'EEEE, dd MMMM yyyy', { locale: he })}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <StatsCard
              title="משימות להיום"
              value={todayTasks.length}
              icon={CheckCircle}
              color="purple"
            />
            <StatsCard
              title="סה״כ משימות פעילות"
              value={tasks.filter(t => t.status !== 'completed').length}
              icon={Clock}
              color="blue"
            />
          </div>

          <Card>
            <CardHeader className="border-b bg-purple-50">
              <CardTitle className="flex items-center gap-2 text-purple-900">
                <Calendar className="w-5 h-5" />
                המשימות שלי
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {tasks.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">אין משימות</p>
              ) : (
                tasks.map(task => (
                  <div key={task.id} className="flex items-center justify-between p-4 bg-background rounded-lg border">
                    <div className="flex-1">
                      <p className="font-medium">{task.title}</p>
                      {task.description && (
                        <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
                      )}
                      {task.due_date && (
                        <p className="text-xs text-muted-foreground mt-2">
                          תאריך יעד: {format(new Date(task.due_date), 'dd/MM/yyyy')}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 items-end">
                      <StatusBadge status={task.status} />
                      <StatusBadge status={task.priority} />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1400px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">דשבורד בוקר</h1>
            <p className="text-muted-foreground mt-1">
              {format(new Date(), 'EEEE, dd MMMM yyyy', { locale: he })}
            </p>
          </div>
          <Link to={createPageUrl('Projects')}>
            <Button size="lg">
              <Plus className="w-5 h-5 ml-2" />
              פרויקט חדש
            </Button>
          </Link>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {isAdmin && (
            <>
              <StatsCard
                title="הצעות מחיר בטיוטה"
                value={draftQuotes.length}
                icon={FileText}
                color="amber"
              />
              <StatsCard
                title="ממתין לתגובת לקוח"
                value={sentQuotes.length}
                icon={Mail}
                color="blue"
              />
            </>
          )}
          <StatsCard
            title="משימות להיום"
            value={todayTasks.length}
            icon={CheckCircle}
            color="purple"
          />
          {isAdmin && (
            <StatsCard
              title="גבייה פתוחה"
              value={`₪${totalOutstanding.toLocaleString()}`}
              icon={DollarSign}
              color="red"
            />
          )}
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* מחכה לתגובה ממני */}
          {isAdmin && (
          <Card>
            <CardHeader className="border-b bg-amber-50">
              <CardTitle className="flex items-center gap-2 text-amber-900">
                <AlertCircle className="w-5 h-5" />
                מחכה לתגובה ממני
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {draftQuotes.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">אין הצעות מחיר בטיוטה</p>
              ) : (
                draftQuotes.slice(0, 5).map(quote => (
                  <div key={quote.id} className="flex items-center justify-between p-3 bg-background rounded-lg border">
                    <div>
                      <p className="font-medium">הצעת מחיר {quote.quote_number}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(quote.date), 'dd/MM/yyyy')}
                      </p>
                    </div>
                    <StatusBadge status={quote.status} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          )}

          {/* מחכה לתגובה מהלקוח */}
          {isAdmin && (
          <Card>
            <CardHeader className="border-b bg-blue-50">
              <CardTitle className="flex items-center gap-2 text-blue-900">
                <Clock className="w-5 h-5" />
                מחכה לתגובה מהלקוח
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {sentQuotes.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">אין הצעות ממתינות</p>
              ) : (
                sentQuotes.slice(0, 5).map(quote => (
                  <div key={quote.id} className="flex items-center justify-between p-3 bg-background rounded-lg border">
                    <div>
                      <p className="font-medium">הצעת מחיר {quote.quote_number}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(quote.date), 'dd/MM/yyyy')}
                      </p>
                    </div>
                    <StatusBadge status={quote.status} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          )}

          {/* משימות להיום */}
          <Card>
            <CardHeader className="border-b bg-purple-50">
              <CardTitle className="flex items-center gap-2 text-purple-900">
                <Calendar className="w-5 h-5" />
                משימות להיום
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {todayTasks.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">אין משימות להיום</p>
              ) : (
                todayTasks.slice(0, 5).map(task => (
                  <div key={task.id} className="flex items-center justify-between p-3 bg-background rounded-lg border">
                    <div className="flex-1">
                      <p className="font-medium">{task.title}</p>
                      {task.description && (
                        <p className="text-sm text-muted-foreground line-clamp-1">{task.description}</p>
                      )}
                    </div>
                    <StatusBadge status={task.priority} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* גבייה פתוחה */}
          {isAdmin && (
          <Card>
            <CardHeader className="border-b bg-red-50">
              <CardTitle className="flex items-center gap-2 text-red-900">
                <DollarSign className="w-5 h-5" />
                גבייה פתוחה
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              {unpaidInvoices.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">אין חשבוניות פתוחות</p>
              ) : (
                <>
                  <div className="p-4 bg-red-100 rounded-lg border border-red-200">
                    <p className="text-sm text-red-700">סה"כ לגבייה</p>
                    <p className="text-2xl font-bold text-red-900">₪{totalOutstanding.toLocaleString()}</p>
                  </div>
                  {unpaidInvoices.slice(0, 4).map(invoice => (
                    <div key={invoice.id} className="flex items-center justify-between p-3 bg-background rounded-lg border">
                      <div>
                        <p className="font-medium">חשבונית {invoice.invoice_number}</p>
                        <p className="text-sm text-muted-foreground">
                          ₪{(invoice.amount - invoice.paid_amount).toLocaleString()}
                        </p>
                      </div>
                      <StatusBadge status={invoice.status} />
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* פרויקטים פעילים */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                פרויקטים פעילים
              </CardTitle>
              <Link to={createPageUrl('Projects')}>
                <Button variant="outline" size="sm">
                  צפה בהכל
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {projects.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">אין פרויקטים פעילים</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {projects.filter(p => !['completed', 'collection_completed'].includes(p.status)).slice(0, 6).map(project => (
                  <Link key={project.id} to={createPageUrl(`ProjectDetails?id=${project.id}`)}>
                    <div className="p-4 bg-background rounded-lg border hover:border-primary transition-colors">
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-semibold">{project.name}</h3>
                        <StatusBadge status={project.status} />
                      </div>
                      {project.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{project.description}</p>
                      )}
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">סה"כ</span>
                        <span className="font-semibold">₪{project.total_amount?.toLocaleString() || 0}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm mt-1">
                        <span className="text-muted-foreground">נגבה</span>
                        <span className="font-semibold text-green-600">₪{project.collected_amount?.toLocaleString() || 0}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}