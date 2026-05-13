import React, { useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import BusinessHealthCard from '../components/dashboard/BusinessHealthCard.jsx';
import ActionCard from '../components/dashboard/ActionCard.jsx';
import ActivityFeed from '../components/dashboard/ActivityFeed.jsx';
import { Button } from "@/components/ui/button";
import { 
  DollarSign,
  TrendingUp,
  Target,
  AlertCircle,
  Clock,
  Flame,
  Calendar,
  Plus,
  BarChart3
} from 'lucide-react';
import { format, subDays, startOfYear, startOfMonth, startOfQuarter } from 'date-fns';
import { he } from 'date-fns/locale';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import QuoteBreakdownCard from '../components/dashboard/QuoteBreakdownCard.jsx';

export default function Dashboard() {
  const [quotePeriod, setQuotePeriod] = React.useState('year');

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
      if (currentUser?.role === 'task_worker') {
        return base44.entities.Task.filter({ assigned_to: currentUser.email });
      }
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

  useEffect(() => {
    if (!currentUser) return;

    console.log({
      role: currentUser?.role,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        total_amount: p.total_amount,
        collected_amount: p.collected_amount,
        created_date: p.created_date,
        updated_date: p.updated_date,
      })),
      quotes: quotes.map((q) => ({
        id: q.id,
        status: q.status,
        total_amount: q.total_amount,
        date: q.date,
        updated_date: q.updated_date,
      })),
      invoices: invoices.map((i) => ({
        id: i.id,
        status: i.status,
        amount: i.amount,
        paid_amount: i.paid_amount,
        date: i.date,
        due_date: i.due_date,
      })),
    });
  }, [currentUser, projects, quotes, invoices]);

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'office_manager';
  const isTaskWorker = currentUser?.role === 'task_worker';

  // חישובי בריאות עסקית
  const businessHealth = useMemo(() => {
    const now = new Date();
    const yearStart = startOfYear(now);
    const thisYearProjects = projects.filter(p => new Date(p.created_date) >= yearStart);
    
    // סך הכנסות שנה
    const yearlyRevenue = thisYearProjects.reduce((sum, p) => sum + (p.collected_amount || 0), 0);
    
    // רווחיות ממוצעת
    const completedProjects = projects.filter(p => p.status === 'completed' || p.status === 'collection_completed');
    const avgProfit = completedProjects.length > 0 
      ? completedProjects.reduce((sum, p) => sum + (p.total_amount || 0), 0) / completedProjects.length 
      : 0;
    
    // אחוז סגירת הצעות - לפי תקופה נבחרת
    const periodStart = quotePeriod === 'month' ? startOfMonth(now)
      : quotePeriod === 'quarter' ? startOfQuarter(now)
      : quotePeriod === 'year' ? startOfYear(now)
      : new Date(0); // 'all'
    
    const periodQuotes = quotes.filter(q => new Date(q.date) >= periodStart);
    const signedQuotes = periodQuotes.filter(q => q.status === 'signed').length;
    const decidedQuotes = periodQuotes.filter(q => ['signed', 'cancelled'].includes(q.status)).length;
    const closeRate = decidedQuotes > 0 ? Math.round((signedQuotes / decidedQuotes) * 100) : 0;
    
    // גבייה פתוחה
    const unpaidInvoices = invoices.filter(i => i.status !== 'paid');
    const totalOutstanding = unpaidInvoices.reduce((sum, inv) => sum + (inv.amount - inv.paid_amount), 0);
    
    return {
      yearlyRevenue,
      avgProfit,
      closeRate,
      signedQuotes,
      decidedQuotes,
      totalOutstanding,
      unpaidInvoicesCount: unpaidInvoices.length
    };
  }, [projects, quotes, invoices, quotePeriod]);

  // דורש טיפול
  const needsAttention = useMemo(() => {
    const now = new Date();
    const sevenDaysAgo = subDays(now, 7);
    const fourteenDaysAgo = subDays(now, 14);
    const today = now.toISOString().split('T')[0];
    
    // הצעות פתוחות מעל 7 ימים
    const oldQuotes = quotes
      .filter(q => ['sent', 'pending', 'negotiation'].includes(q.status) && new Date(q.date) < sevenDaysAgo)
      .map(q => ({
        title: `הצעת מחיר ${q.quote_number}`,
        subtitle: `פתוחה ${Math.floor((now - new Date(q.date)) / (1000 * 60 * 60 * 24))} ימים`,
        data: q
      }));
    
    // גבייה באיחור
    const overdueInvoices = invoices
      .filter(i => i.status !== 'paid' && i.due_date && new Date(i.due_date) < now)
      .map(i => ({
        title: `חשבונית ${i.invoice_number}`,
        subtitle: `איחור ${Math.floor((now - new Date(i.due_date)) / (1000 * 60 * 60 * 24))} ימים - ₪${(i.amount - i.paid_amount).toLocaleString()}`,
        data: i
      }));
    
    // פרויקטים בלי פעילות 14 יום
    const inactiveProjects = projects
      .filter(p => !['completed', 'collection_completed'].includes(p.status) && new Date(p.updated_date) < fourteenDaysAgo)
      .map(p => ({
        title: p.name,
        subtitle: `ללא פעילות ${Math.floor((now - new Date(p.updated_date)) / (1000 * 60 * 60 * 24))} ימים`,
        data: p
      }));
    
    // משימות להיום
    const todayTasks = tasks
      .filter(t => t.status !== 'completed' && t.due_date === today)
      .map(t => ({
        title: t.title,
        subtitle: t.description || 'משימה דחופה',
        data: t
      }));
    
    return {
      oldQuotes,
      overdueInvoices,
      inactiveProjects,
      todayTasks
    };
  }, [quotes, invoices, projects, tasks]);

  // תנועה עסקית
  const recentActivity = useMemo(() => {
    const activities = [];
    const sevenDaysAgo = subDays(new Date(), 7);
    
    // לידים חדשים (פרויקטים בסטטוס lead)
    projects
      .filter(p => p.status === 'lead' && new Date(p.created_date) >= sevenDaysAgo)
      .forEach(p => activities.push({
        type: 'lead',
        title: 'ליד חדש',
        description: p.name,
        date: p.created_date
      }));
    
    // הצעות שנשלחו
    quotes
      .filter(q => ['sent', 'pending'].includes(q.status) && new Date(q.date) >= sevenDaysAgo)
      .forEach(q => activities.push({
        type: 'quote',
        title: 'הצעת מחיר נשלחה',
        description: `הצעה ${q.quote_number}`,
        date: q.date
      }));
    
    // הצעות שנחתמו
    quotes
      .filter(q => q.status === 'signed' && new Date(q.updated_date) >= sevenDaysAgo)
      .forEach(q => activities.push({
        type: 'signed',
        title: 'הצעה נחתמה! 🎉',
        description: `הצעה ${q.quote_number}`,
        date: q.updated_date
      }));
    
    // פרויקטים שהושלמו
    projects
      .filter(p => p.status === 'completed' && new Date(p.updated_date) >= sevenDaysAgo)
      .forEach(p => activities.push({
        type: 'completed',
        title: 'פרויקט הושלם',
        description: p.name,
        date: p.updated_date
      }));
    
    return activities.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [projects, quotes]);

  // תצוגה למבצע משימות
  if (isTaskWorker) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
        <div className="max-w-[1400px] mx-auto px-8 py-12 space-y-8">
          <div className="space-y-4">
            <h1 className="text-5xl font-bold tracking-tight">המשימות שלי</h1>
            <p className="text-muted-foreground text-lg">
              {format(new Date(), 'EEEE, dd MMMM yyyy', { locale: he })}
            </p>
          </div>
          <ActionCard
            title="משימות להיום"
            items={needsAttention.todayTasks}
            icon={Calendar}
            color="purple"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <div className="max-w-[1600px] mx-auto px-8 py-12 space-y-16">
        {/* Header */}
        <div className="flex items-end justify-between">
          <div className="space-y-4">
            <h1 className="text-6xl font-bold tracking-tight">חדר המצב</h1>
            <p className="text-xl text-muted-foreground">
              מבט מקיף על בריאות העסק שלך
            </p>
            <p className="text-sm text-muted-foreground/70">
              {format(new Date(), 'EEEE, dd MMMM yyyy', { locale: he })}
            </p>
          </div>
          <Link to={createPageUrl('Projects')}>
            <Button size="lg" className="text-base px-8 py-6 rounded-lg shadow-sm">
              <Plus className="w-5 h-5 ml-2" />
              פרויקט חדש
            </Button>
          </Link>
        </div>

        {/* 🔵 אזור 1 - בריאות עסקית */}
        <div className="space-y-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight mb-2">בריאות עסקית</h2>
            <p className="text-muted-foreground">המדדים המרכזיים של העסק</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <BusinessHealthCard
              title="הכנסות השנה"
              value={`₪${businessHealth.yearlyRevenue.toLocaleString()}`}
              subtitle="סך כל הגבייה בשנה זו"
              icon={DollarSign}
              color="green"
              trend={12}
            />
            <BusinessHealthCard
              title="רווחיות ממוצעת"
              value={`₪${Math.round(businessHealth.avgProfit).toLocaleString()}`}
              subtitle="לפרויקט מושלם"
              icon={TrendingUp}
              color="blue"
            />
            <div className="space-y-2">
              <BusinessHealthCard
                title="אחוז סגירת הצעות"
                value={`${businessHealth.closeRate}%`}
                subtitle={`${businessHealth.signedQuotes} מתוך ${businessHealth.decidedQuotes} שהוכרעו`}
                icon={Target}
                color="primary"
              />
              <Select value={quotePeriod} onValueChange={setQuotePeriod}>
                <SelectTrigger className="text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">החודש</SelectItem>
                  <SelectItem value="quarter">הרבעון</SelectItem>
                  <SelectItem value="year">השנה</SelectItem>
                  <SelectItem value="all">הכל</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <BusinessHealthCard
              title="גבייה פתוחה"
              value={`₪${businessHealth.totalOutstanding.toLocaleString()}`}
              subtitle={`${businessHealth.unpaidInvoicesCount} חשבוניות`}
              icon={AlertCircle}
              color={businessHealth.unpaidInvoicesCount > 5 ? "red" : "amber"}
            />
          </div>
        </div>

        {/* 🔵 פילוח הצעות */}
        <div className="space-y-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight mb-2">פילוח הצעות</h2>
            <p className="text-muted-foreground">ניתוח תוצאות הצעות מחיר לפי התקופה שנבחרה</p>
          </div>
          <QuoteBreakdownCard
            quotes={quotes.filter(q => {
              const now = new Date();
              const periodStart = quotePeriod === 'month' ? startOfMonth(now)
                : quotePeriod === 'quarter' ? startOfQuarter(now)
                : quotePeriod === 'year' ? startOfYear(now)
                : new Date(0);
              return new Date(q.date) >= periodStart;
            })}
            period={quotePeriod}
          />
        </div>

        {/* 🟡 אזור 2 - דורש טיפול */}
        <div className="space-y-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight mb-2">דורש טיפול</h2>
            <p className="text-muted-foreground">פעולות שדורשות תשומת לב מיידית</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ActionCard
              title="הצעות ממתינות לתגובה"
              items={needsAttention.oldQuotes}
              icon={Clock}
              color="amber"
            />
            <ActionCard
              title="גבייה באיחור"
              items={needsAttention.overdueInvoices}
              icon={AlertCircle}
              color="red"
            />
            <ActionCard
              title="פרויקטים ללא פעילות"
              items={needsAttention.inactiveProjects}
              icon={Flame}
              color="blue"
            />
            <ActionCard
              title="משימות להיום"
              items={needsAttention.todayTasks}
              icon={Calendar}
              color="purple"
            />
          </div>
        </div>

        {/* 🟢 אזור 3 - תנועה עסקית */}
        <div>
          <ActivityFeed activities={recentActivity} />
        </div>
      </div>
    </div>
  );
}