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
  Plus,
  BarChart3
} from 'lucide-react';
import { format, subDays, startOfYear, startOfMonth, startOfQuarter } from 'date-fns';
import { he } from 'date-fns/locale';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import QuoteBreakdownCard from '../components/dashboard/QuoteBreakdownCard.jsx';
import TodayTasksCard from '../components/dashboard/TodayTasksCard.jsx';

const OPEN_PROPOSAL_STATUSES = ['pricing', 'waiting'];
const WON_PROPOSAL_STATUSES = ['signed'];
const LOST_PROPOSAL_STATUSES = ['rejected', 'cancelled'];
const PROPOSAL_STATUSES = [
  ...OPEN_PROPOSAL_STATUSES,
  ...WON_PROPOSAL_STATUSES,
  ...LOST_PROPOSAL_STATUSES,
];
const COLLECTION_RELEVANT_STATUSES = ['signed', 'planning', 'submission', 'execution', 'completed'];
const ACTIVE_INACTIVITY_STATUSES = ['pricing', 'waiting', 'signed', 'planning', 'submission', 'execution'];
const INACTIVE_PROJECT_EXCLUDED_STATUSES = ['rejected', 'cancelled', 'collection_completed'];
const INACTIVITY_THRESHOLD_DAYS = 14;
const RECORDED_COLLECTION_TYPES = ['collection_paid', 'collection_paid_legacy'];
const COLLECTION_PERIOD_SUBTITLES = {
  month: 'לפי פעולות גבייה שתועדו החודש',
  quarter: 'לפי פעולות גבייה שתועדו ברבעון',
  year: 'לפי פעולות גבייה שתועדו השנה',
  all: 'לפי כל פעולות הגבייה שתועדו במערכת',
};

const hasValidPaidAt = (paidAt) => {
  if (!paidAt) return false;

  const paidDate = new Date(paidAt);
  return !Number.isNaN(paidDate.getTime());
};

const isEventInCollectionPeriod = (event, period, now) => {
  if (!RECORDED_COLLECTION_TYPES.includes(event.type)) return false;
  if (!hasValidPaidAt(event.paid_at)) return false;
  if (period === 'all') return true;

  const paidDate = new Date(event.paid_at);
  return paidDate >= getPeriodStart(period, now);
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

  const date = parseDateOnly(dateValue);
  if (!date) return null;

  const diffMs = Date.now() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
};

const parseDateOnly = (value) => {
  if (!value) return null;

  const datePart = String(value).split('T')[0];
  const parts = datePart.split('-');
  if (parts.length === 3) {
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatShortDate = (value) => {
  const date = parseDateOnly(value);
  if (!date) return null;

  return new Intl.DateTimeFormat('he-IL').format(date);
};

const hasCollectionTargetDate = (project) => (
  Boolean(project?.collection_due_target_date && String(project.collection_due_target_date).trim())
);

const isOverdueCollection = (project, now = new Date()) => {
  if (project.collection_due_now !== true || toNumber(project.collection_due_amount) <= 0) {
    return false;
  }

  if (!hasCollectionTargetDate(project)) return false;

  const targetDate = parseDateOnly(project.collection_due_target_date);
  if (!targetDate) return false;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  targetDate.setHours(0, 0, 0, 0);

  return targetDate < today;
};

const getDaysOverdue = (targetDateValue, now = new Date()) => {
  const targetDate = parseDateOnly(targetDateValue);
  if (!targetDate) return null;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  targetDate.setHours(0, 0, 0, 0);

  if (targetDate >= today) return null;

  return Math.floor((today.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
};

const getProjectLastActivityDate = (project) => {
  const value = project?.updated_date || project?.created_date;
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isProjectEligibleForInactivityCheck = (project) => {
  const status = project?.status;
  if (!status || INACTIVE_PROJECT_EXCLUDED_STATUSES.includes(status)) return false;
  if (ACTIVE_INACTIVITY_STATUSES.includes(status)) return true;

  if (status === 'completed') {
    const total = toNumber(project.total_amount);
    const collected = toNumber(project.collected_amount);
    const hasOutstanding = total > collected;
    const hasCollectionDueNow =
      project.collection_due_now === true && toNumber(project.collection_due_amount) > 0;

    return hasOutstanding || hasCollectionDueNow;
  }

  return false;
};

export default function Dashboard() {
  const [quotePeriod, setQuotePeriod] = React.useState('year');
  const [collectionPeriod, setCollectionPeriod] = React.useState('year');
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

  const todayOpenTasks = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];

    return tasks.filter((task) => {
      const dueDate = String(task.due_date || '').split('T')[0];
      return task.is_completed !== true && dueDate === today;
    });
  }, [tasks]);

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
    const events = Array.isArray(collectionEvents) ? collectionEvents : [];

    const recordedCollection = events
      .filter((event) => isEventInCollectionPeriod(event, collectionPeriod, now))
      .reduce((sum, event) => sum + toNumber(event.amount), 0);

    const completedProjects = projects.filter(p => p.status === 'completed' || p.status === 'collection_completed');
    const averageProjectValue = completedProjects.length > 0
      ? completedProjects.reduce((sum, p) => sum + toNumber(p.total_amount), 0) / completedProjects.length
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
      recordedCollection,
      averageProjectValue,
      closeRate: proposalMetrics.closeRate,
      wonProposalsCount: proposalMetrics.wonProposals.length,
      decidedProposalsCount: proposalMetrics.decidedCount,
      totalOutstanding,
      openCollectionProjectsCount: openCollectionProjects.length,
      collectionDueNowAmount: collectionDueMetrics.collectionDueNowAmount,
      collectionDueNowProjectsCount: collectionDueMetrics.collectionDueNowProjects.length,
    };
  }, [projects, collectionEvents, collectionPeriod, proposalMetrics, collectionDueMetrics]);

  // דורש טיפול
  const needsAttention = useMemo(() => {
    const now = new Date();
    const sevenDaysAgo = subDays(now, 7);
    const inactivityThresholdDate = subDays(now, INACTIVITY_THRESHOLD_DAYS);
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
        const notePart = project.collection_due_note ? ` - ${project.collection_due_note}` : '';
        const targetLabel = hasCollectionTargetDate(project)
          ? `יעד: ${formatShortDate(project.collection_due_target_date)}`
          : 'ללא תאריך יעד';

        return {
          title: project.name || 'פרויקט ללא שם',
          subtitle: `₪${amount.toLocaleString()}${notePart} - ${targetLabel}`,
          data: project,
        };
      });

    const overdueCollections = projects
      .filter((project) => isOverdueCollection(project, now))
      .map((project) => {
        const amount = toNumber(project.collection_due_amount);
        const daysOverdue = getDaysOverdue(project.collection_due_target_date, now);

        return {
          title: project.name || 'פרויקט ללא שם',
          subtitle: `₪${amount.toLocaleString()} - תאריך יעד עבר לפני ${daysOverdue} ימים`,
          data: project,
        };
      });
    
    const inactiveProjects = projects
      .filter(isProjectEligibleForInactivityCheck)
      .map((project) => {
        const lastActivity = getProjectLastActivityDate(project);
        const daysInactive = lastActivity
          ? Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24))
          : null;

        return {
          project,
          lastActivity,
          daysInactive,
        };
      })
      .filter(({ lastActivity }) => (
        lastActivity === null || lastActivity < inactivityThresholdDate
      ))
      .sort((a, b) => {
        if (a.lastActivity === null && b.lastActivity === null) return 0;
        if (a.lastActivity === null) return -1;
        if (b.lastActivity === null) return 1;
        return b.daysInactive - a.daysInactive;
      })
      .map(({ project, daysInactive }) => {
        const total = toNumber(project.total_amount);
        const collected = toNumber(project.collected_amount);
        const outstandingAmount = Math.max(total - collected, 0);

        return {
          title: project.name || 'פרויקט ללא שם',
          subtitle: daysInactive !== null
            ? `ללא פעילות ${daysInactive} ימים`
            : 'ללא פעילות - אין תאריך עדכון',
          data: project,
          dialogExtras: {
            status: project.status,
            daysInactive,
            outstandingAmount,
          },
        };
      });
    
    return {
      pricingProposals,
      waitingProposals,
      collectionDueNow,
      overdueCollections,
      inactiveProjects,
    };
  }, [collectionDueMetrics, projects, proposalMetrics]);

  const openProjectDetails = (item) => {
    const projectId = item?.data?.id;
    if (!projectId) return;

    navigate(createPageUrl(`ProjectDetails?id=${projectId}`));
  };

  const openCollectionActivity = (activity) => {
    if (!activity?.projectId) return;

    navigate(createPageUrl(`ProjectDetails?id=${activity.projectId}`));
  };

  const scrollToCollectionDueNow = () => {
    if (!collectionDueNowCardRef.current) return;

    collectionDueNowCardRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  // תנועה עסקית — רק גביות אמיתיות שנרשמו במערכת (לא legacy)
  const recentActivity = useMemo(() => {
    const events = Array.isArray(collectionEvents) ? collectionEvents : [];

    return events
      .filter((event) => event.type === 'collection_paid' && hasValidPaidAt(event.paid_at))
      .sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime())
      .slice(0, 10)
      .map((event) => ({
        type: 'collection_paid',
        title: 'גבייה בוצעה',
        description: `${event.project_name || 'פרויקט ללא שם'} · ₪${toNumber(event.amount).toLocaleString()}`,
        date: event.paid_at,
        projectId: event.project_id,
      }));
  }, [collectionEvents]);

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
          <TodayTasksCard tasks={todayOpenTasks} projects={projects} />
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
            <div className="space-y-2">
              <BusinessHealthCard
                title="גבייה רשומה"
                value={`₪${toNumber(businessHealth.recordedCollection).toLocaleString()}`}
                subtitle={COLLECTION_PERIOD_SUBTITLES[collectionPeriod]}
                icon={DollarSign}
                color="green"
                trend={12}
              />
              <Select value={collectionPeriod} onValueChange={setCollectionPeriod}>
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
              title="היקף פרויקט ממוצע"
              value={`₪${Math.round(businessHealth.averageProjectValue).toLocaleString()}`}
              subtitle="לפרויקט מאושר"
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
              items={needsAttention.overdueCollections}
              icon={AlertCircle}
              color="red"
              onItemClick={openProjectDetails}
              emptyMessage="הכל מסודר! אין גביות שעברו את תאריך היעד"
            />
            <ActionCard
              title="פרויקטים ללא פעילות"
              items={needsAttention.inactiveProjects}
              icon={Flame}
              color="blue"
              onItemClick={openProjectDetails}
            />
            <TodayTasksCard tasks={todayOpenTasks} projects={projects} />
          </div>
        </div>

        {/* 🟢 אזור 3 - תנועה עסקית */}
        <div>
          <ActivityFeed
            activities={recentActivity}
            onActivityClick={openCollectionActivity}
          />
        </div>
      </div>
    </div>
  );
}