import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import StatusBadge from '@/components/StatusBadge';
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const formatCurrency = (value) => (
  new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
  }).format(toNumber(value))
);

const formatDate = (value) => {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('he-IL').format(date);
};

const DetailField = ({ label, children }) => (
  <div className="space-y-1">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="text-sm font-medium">{children}</div>
  </div>
);

export default function ProjectDetails() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const projectId = params.get('id');

  const {
    data: project,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      try {
        const filteredProjects = await base44.entities.Project.filter({ id: projectId });
        if (filteredProjects?.[0]) {
          return filteredProjects[0];
        }
      } catch (error) {
        // Fallback to list() below because some Base44 entities don't support filtering by id.
      }

      const projects = await base44.entities.Project.list();
      return projects.find((item) => item.id === projectId) || null;
    },
    enabled: !!projectId,
  });

  if (!projectId) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-[1100px] mx-auto">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground">לא נבחר פרויקט.</p>
              <Button asChild variant="outline">
                <Link to={createPageUrl('Projects')}>
                  <ArrowRight className="w-4 h-4 ml-2" />
                  חזרה לפרויקטים
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-[1100px] mx-auto">
          <div className="flex items-center justify-center min-h-[300px]">
            <div className="w-8 h-8 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !project) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-[1100px] mx-auto">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground">הפרויקט לא נמצא או שלא ניתן לטעון אותו.</p>
              <Button asChild variant="outline">
                <Link to={createPageUrl('Projects')}>
                  <ArrowRight className="w-4 h-4 ml-2" />
                  חזרה לפרויקטים
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const totalAmount = toNumber(project.total_amount);
  const collectedAmount = toNumber(project.collected_amount);
  const outstandingAmount = Math.max(totalAmount - collectedAmount, 0);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-[1100px] mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link to={createPageUrl('Projects')}>
              <ArrowRight className="w-4 h-4" />
              פרויקטים
            </Link>
          </Button>
        </div>

        <Card className="border-0 shadow-sm">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-3xl font-bold">{project.name || 'פרויקט ללא שם'}</h1>
                  <StatusBadge status={project.status || 'unknown'} />
                </div>
                <p className="text-sm text-muted-foreground">פרטי פרויקט בסיסיים</p>
              </div>
              <Button asChild variant="outline">
                <Link to={createPageUrl('Projects')}>
                  <ArrowRight className="w-4 h-4 ml-2" />
                  חזרה לפרויקטים
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>פרטים כלליים</CardTitle>
            <CardDescription>מידע בסיסי על הפרויקט והסטטוס הנוכחי שלו.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <DetailField label="שם הפרויקט">{project.name || '-'}</DetailField>
            <DetailField label="סטטוס">
              <StatusBadge status={project.status || 'unknown'} />
            </DetailField>
            <DetailField label="מספר הצעה">{project.bid_number || '-'}</DetailField>
            <DetailField label="מספר עבודה">{project.work_number || '-'}</DetailField>
            <DetailField label="תאריך יצירה">{formatDate(project.created_date)}</DetailField>
            <DetailField label="תאריך עדכון">{formatDate(project.updated_date)}</DetailField>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>נתונים כספיים</CardTitle>
            <CardDescription>תמונת מצב בסיסית של החיוב והגבייה בפרויקט.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <DetailField label="סכום כולל">
              <span className="text-2xl font-semibold">{formatCurrency(totalAmount)}</span>
            </DetailField>
            <DetailField label="נגבה עד עכשיו">
              <span className="text-2xl font-semibold">{formatCurrency(collectedAmount)}</span>
            </DetailField>
            <DetailField label="יתרת גבייה כוללת">
              <span className="text-2xl font-semibold">{formatCurrency(outstandingAmount)}</span>
            </DetailField>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle>גבייה לטיפול עכשיו</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">יוגדר בשלב הבא.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
