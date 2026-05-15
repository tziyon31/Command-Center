import React, { useMemo, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
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

const OPEN_PROPOSAL_STATUSES = ['pricing', 'waiting'];
const WON_PROPOSAL_STATUSES = ['signed'];
const LOST_PROPOSAL_STATUSES = ['rejected', 'cancelled'];
const PROPOSAL_STATUSES = [
  ...OPEN_PROPOSAL_STATUSES,
  ...WON_PROPOSAL_STATUSES,
  ...LOST_PROPOSAL_STATUSES,
];
const COLLECTION_RELEVANT_STATUSES = ['signed', 'planning', 'submission', 'execution', 'completed'];
const RECORDED_COLLECTION_TYPES = ['collection_paid', 'collection_paid_legacy'];

const isPaidAtInSelectedYear = (paidAt, yearStart) => {
  if (!paidAt) return false;

  const paidDate = new Date(paidAt);
  if (Number.isNaN(paidDate.getTime())) return false;

  const yearEnd = new Date(yearStart);
  yearEnd.setFullYear(yearEnd.getFullYear() + 1);

  return paidDate >= yearStart && paidDate < yearEnd;
};

const getPeriodStart = (period, now) => (
  period === 'month' ? startOfMonth(now)
    : period === 'quarter' ? startOfQuarter(now)
    : period === 'year' ? startOfYear(now)
    : new Date(0)
);

const getProjectTimelineDate = (project) => project?.created_date || project?.updated_date || null;
const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};
const daysSince = (dateValue) => {
  if (!dateValue) return null;

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;

  const diffMs = Date.now() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
};

export default function Dashboard() {
  const [quotePeriod, setQuotePeriod] = React.useState('year');
  const navigate = useNavigate();
  const collectionDueNowCardRef = useRef(null);

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

  const { data: collectionEvents = [] } = useQuery({
    queryKey: ['collection-events'],
    queryFn: () => base44.entities.CollectionEvent.list(),
    enabled: currentUser?.role === 'admin' || currentUser?.role === 'office_manager' || currentUser?.role === 'project_worker',
  });

  const isTaskWorker = currentUser?.role === 'task_worker';

  const collectionDueMetrics = useMemo(() => {
    const collectionDueNowProjects = projects.filter((project) =>
      project.collection_due_now === true &&
      toNumber(project.collection_due_amount) > 0
    );

    const collectionDueNowAmount = collectionDueNowProjects.reduce((sum, project) => (
      sum + toNumber(project.collection_due_amount)
    ), 0);

    return {
      collectionDueNowProjects,
      collectionDueNowAmount,
    };
  }, [projects]);

  const proposalMetrics = useMemo(() => {
    const now = new Date();
    const periodStart = getPeriodStart(quotePeriod, now);

    const proposalProjects = projects.filter((project) => {
      if (!PROPOSAL_STATUSES.includes(project.status)) return false;

      const dateValue = getProjectTimelineDate(project);
      if (!dateValue) return false;

      const date = new Date(dateValue);
      return !Number.isNaN(date.getTime()) && date >= periodStart;
    });

    const openProposals = proposalProjects.filter((project) =>
      OPEN_PROPOSAL_STATUSES.includes(project.status)
    );
    const wonProposals = proposalProjects.filter((project) =>
      WON_PROPOSAL_STATUSES.includes(project.status)
    );
    const lostProposals = proposalProjects.filter((project) =>
      LOST_PROPOSAL_STATUSES.includes(project.status)
    );

    const decidedCount = wonProposals.length + lostProposals.length;
    const closeRate = decidedCount > 0
      ? Math.round((wonProposals.length / decidedCount) * 100)
      : 0;

    return {
      proposalProjects,
      openProposals,
      wonProposals,
      lostProposals,
      closeRate,
      decidedCount,
      breakdown: {
        open: openProposals.length,
        won: wonProposals.length,
        lost: lostProposals.length,
        total: proposalProjects.length,
      },
    };
  }, [projects, quotePeriod]);

  // חישובי בריאות עסקית
  const businessHealth = useMemo(() => {
    const now = new Date();
    const yearStart = startOfYear(now);
    const events = Array.isArray(collectionEvents) ? collectionEvents : [];

    const yearlyRecordedCollection = events
      .filter((event) => (
        RECORDED_COLLECTION_TYPES.includes(event.type) &&
        isPaidAtInSelectedYear(event.paid_at, yearStart)
      ))
      .reduce((sum, event) => sum + toNumber(event.amount), 0);

    // רווחיות ממוצעת
    const completedProjects = projects.filter(p => p.status === 'completed' || p.status === 'collection_completed');
    const avgProfit = completedProjects.length > 0 
      ? completedProjects.reduce((sum, p) => sum + (p.total_amount || 0), 0) / completedProjects.length 
      : 0;
    
    // גבייה פתוחה
    const collectionProjects = projects.filter((project) =>
      COLLECTION_RELEVANT_STATUSES.includes(project.status)
    );
    const openCollectionProjects = collectionProjects.filter((project) => {
      const total = toNumber(project.total_amount);
      const collected = toNumber(project.collected_amount);

      return total > collected;
    });
    const totalOutstanding = openCollectionProjects.reduce((sum, project) => {
      const total = toNumber(project.total_amount);
      const collected = toNumber(project.collected_amount);

      return sum + Math.max(total - collected, 0);
    }, 0);
    
    return {
      yearlyRecordedCollection,
      avgProfit,
      closeRate: proposalMetrics.closeRate,
      wonProposalsCount: proposalMetrics.wonProposals.length,
      decidedProposalsCount: proposalMetrics.decidedCount,
      totalOutstanding,
      openCollectionProjectsCount: openCollectionProjects.length,
      collectionDueNowAmount: collectionDueMetrics.collectionDueNowAmount,
      collectionDueNowProjectsCount: collectionDueMetrics.collectionDueNowProjects.length,
    };
  }, [projects, collectionEvents, proposalMetrics, collectionDueMetrics]);

  // דורש טיפול
  const needsAttention = useMemo(() => {
    const now = new Date();
    const sevenDaysAgo = subDays(now, 7);
    const fourteenDaysAgo = subDays(now, 14);
    const today = now.toISOString().split('T')[0];
    
    // הצעות פתוחות מעל 7 ימים
    const waitingProposals = proposalMetrics.openProposals
      .filter((project) => project.status === 'waiting')
      .map((project) => {
        const lastTouchValue = project.updated_date || project.created_date;
        const lastTouch = lastTouchValue ? new Date(lastTouchValue) : null;
        const daysWaiting = lastTouch && !Number.isNaN(lastTouch.getTime())
          ? Math.floor((now.getTime() - lastTouch.getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        return {
          title: project.name || 'הצעה ללא שם',
          subtitle: `ממתינה לתגובת לקוח${daysWaiting > 0 ? ` כבר ${daysWaiting} ימים` : ''}`,
          data: project
        };
      });

    const pricingProposals = proposalMetrics.openProposals
      .filter((project) => project.status === 'pricing')
      .map((project) => {
        const lastTouchValue = project.updated_date || project.created_date;
        const lastTouch = lastTouchValue ? new Date(lastTouchValue) : null;
        const daysInPricing = lastTouch && !Number.isNaN(lastTouch.getTime())
          ? Math.floor((now.getTime() - lastTouch.getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        return {
          title: project.name || 'הצעה ללא שם',
          subtitle: `ממתינה לתמחור${daysInPricing > 0 ? ` כבר ${daysInPricing} ימים` : ''}`,
          data: project
        };
      });

    const collectionDueNow = collectionDueMetrics.collectionDueNowProjects
      .map((project) => {
        const amount = toNumber(project.collection_due_amount);
        const daysOpen = daysSince(project.collection_due_date);

        return {
          title: project.name || 'פרויקט ללא שם',
          subtitle: `₪${amount.toLocaleString()}${project.collection_due_note ? ` - ${project.collection_due_note}` : ''}${daysOpen !== null ? ` · נפתחה לפני ${daysOpen} ימים` : ''}`,
          data: project,
        };
      });
    
    // גבייה באיחור
    const overdueInvoices = invoices
      .filter(i => i.status !== 'paid' && i.due_date && new Date(i.due_date) < now)
      .map(i => ({
        title: `חשבונית ${i.invoice_number}`,
        subtitle: `איחור ${Math.floor((now.getTime() - new Date(i.due_date).getTime()) / (1000 * 60 * 60 * 24))} ימים - ₪${(i.amount - i.paid_amount).toLocaleString()}`,
        data: i
      }));
    
    // פרויקטים בלי פעילות 14 יום
    const inactiveProjects = projects
      .filter(p => !['completed', 'collection_completed'].includes(p.status) && new Date(p.updated_date) < fourteenDaysAgo)
      .map(p => ({
        title: p.name,
        subtitle: `ללא פעילות ${Math.floor((now.getTime() - new Date(p.updated_date).getTime()) / (1000 * 60 * 60 * 24))} ימים`,
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
      pricingProposals,
      waitingProposals,
      collectionDueNow,
      overdueInvoices,
      inactiveProjects,
      todayTasks
    };
  }, [collectionDueMetrics, invoices, projects, proposalMetrics, tasks]);

  const openProjectDetails = (item) => {
    const projectId = item?.data?.id;
    if (!projectId) return;

    navigate(createPageUrl(`ProjectDetails?id=${projectId}`));
  };

  const scrollToCollectionDueNow = () => {
    if (!collectionDueNowCardRef.current) return;

    collectionDueNowCardRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

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
    
    return activities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
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
            onItemClick={() => {}}
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
            <BusinessHealthCard
              title="גבייה רשומה השנה"
              value={`₪${toNumber(businessHealth.yearlyRecordedCollection).toLocaleString()}`}
              subtitle="לפי פעולות גבייה שתועדו במערכת"
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
                subtitle={`${businessHealth.wonProposalsCount} מתוך ${businessHealth.decidedProposalsCount} שהוכרעו`}
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
              title="יתרת גבייה כוללת"
              value={`₪${businessHealth.totalOutstanding.toLocaleString()}`}
              subtitle={`${businessHealth.openCollectionProjectsCount} פרויקטים עם יתרת גבייה`}
              icon={BarChart3}
              color="blue"
            />
            <button
              type="button"
              onClick={scrollToCollectionDueNow}
              className="w-full text-right cursor-pointer rounded-xl transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <BusinessHealthCard
                title="גבייה לטיפול עכשיו"
                value={`₪${businessHealth.collectionDueNowAmount.toLocaleString()}`}
                subtitle={businessHealth.collectionDueNowProjectsCount > 0
                  ? `${businessHealth.collectionDueNowProjectsCount} פרויקטים דורשים גבייה`
                  : 'אין גביות פתוחות לטיפול'}
                icon={AlertCircle}
                color={businessHealth.collectionDueNowProjectsCount > 0 ? 'amber' : 'blue'}
              />
            </button>
          </div>
        </div>

        {/* 🔵 פילוח הצעות */}
        <div className="space-y-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight mb-2">פילוח הצעות</h2>
            <p className="text-muted-foreground">ניתוח תוצאות הצעות מחיר לפי התקופה שנבחרה</p>
          </div>
          <QuoteBreakdownCard
            proposalBreakdown={proposalMetrics.breakdown}
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
              title="הצעות ממתינות לתמחור"
              items={needsAttention.pricingProposals}
              icon={BarChart3}
              color="amber"
              onItemClick={openProjectDetails}
            />
            <ActionCard
              title="הצעות ממתינות לתגובה"
              items={needsAttention.waitingProposals}
              icon={Clock}
              color="amber"
              onItemClick={openProjectDetails}
            />
            <div ref={collectionDueNowCardRef}>
              <ActionCard
                title="גבייה לטיפול עכשיו"
                items={needsAttention.collectionDueNow}
                icon={AlertCircle}
                color="red"
                onItemClick={openProjectDetails}
              />
            </div>
            <ActionCard
              title="גבייה באיחור"
              items={needsAttention.overdueInvoices}
              icon={AlertCircle}
              color="red"
              onItemClick={() => {}}
            />
            <ActionCard
              title="פרויקטים ללא פעילות"
              items={needsAttention.inactiveProjects}
              icon={Flame}
              color="blue"
              onItemClick={openProjectDetails}
            />
            <ActionCard
              title="משימות להיום"
              items={needsAttention.todayTasks}
              icon={Calendar}
              color="purple"
              onItemClick={() => {}}
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