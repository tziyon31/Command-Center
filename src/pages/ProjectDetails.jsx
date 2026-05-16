import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  const date = parseDateOnly(value);
  if (!date) return '-';

  return new Intl.DateTimeFormat('he-IL').format(date);
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

const toDateInputValue = (value) => {
  if (!value) return '';

  const datePart = String(value).split('T')[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;

  const date = parseDateOnly(value);
  if (!date) return '';

  return date.toISOString().split('T')[0];
};

const isValidCollectionTargetDate = (value) => {
  const date = parseDateOnly(value);
  if (!date) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);

  return date >= today;
};

const hasProjectTargetDate = (project) => (
  Boolean(String(project?.collection_due_target_date || '').trim())
);

const getCollectionTargetDateForInput = (project) => {
  if (!hasProjectTargetDate(project)) return '';

  return toDateInputValue(project.collection_due_target_date);
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
  const queryClient = useQueryClient();
  const [isCollectionDialogOpen, setIsCollectionDialogOpen] = useState(false);
  const [collectionAmount, setCollectionAmount] = useState('');
  const [collectionNote, setCollectionNote] = useState('');
  const [collectionTargetDate, setCollectionTargetDate] = useState('');
  const [isSavingCollection, setIsSavingCollection] = useState(false);

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

  useEffect(() => {
    if (!isCollectionDialogOpen || !project) return;

    setCollectionAmount(
      project.collection_due_amount ? String(project.collection_due_amount) : ''
    );
    setCollectionNote(project.collection_due_note || '');
    setCollectionTargetDate(getCollectionTargetDateForInput(project));
  }, [isCollectionDialogOpen, project]);

  const handleCollectionDialogOpenChange = (open) => {
    setIsCollectionDialogOpen(open);

    if (!open) {
      setCollectionAmount('');
      setCollectionNote('');
      setCollectionTargetDate('');
    }
  };

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
  const hasCollectionDueNow =
    project.collection_due_now === true &&
    toNumber(project.collection_due_amount) > 0;
  const hasMissingTargetDate =
    hasCollectionDueNow &&
    !hasProjectTargetDate(project);

  const refreshProjectData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
      queryClient.invalidateQueries({ queryKey: ['client-details'] }),
    ]);
  };

  const openCollectionDialog = () => {
    setCollectionAmount(
      project.collection_due_amount ? String(project.collection_due_amount) : ''
    );
    setCollectionNote(project.collection_due_note || '');
    setCollectionTargetDate(getCollectionTargetDateForInput(project));
    setIsCollectionDialogOpen(true);
  };

  const handleSaveCollectionDue = async () => {
    const amount = toNumber(collectionAmount);

    if (amount <= 0) {
      alert('יש להזין סכום גדול מ-0');
      return;
    }

    if (amount > outstandingAmount) {
      alert('הסכום לגבייה לא יכול להיות גדול מיתרת הגבייה הכוללת');
      return;
    }

    if (!collectionTargetDate.trim()) {
      alert('יש לבחור תאריך יעד לגבייה');
      return;
    }

    if (!isValidCollectionTargetDate(collectionTargetDate)) {
      alert('תאריך היעד לא יכול להיות בעבר');
      return;
    }

    setIsSavingCollection(true);

    try {
      const isEditingExistingCollection = hasCollectionDueNow;
      const payload = {
        collection_due_now: true,
        collection_due_amount: amount,
        collection_due_note: collectionNote,
        collection_due_target_date: collectionTargetDate.split('T')[0],
        collection_due_date: isEditingExistingCollection
          ? project.collection_due_date
          : new Date().toISOString(),
      };
      await base44.entities.Project.update(project.id, payload);

      handleCollectionDialogOpenChange(false);

      await refreshProjectData();
    } catch (err) {
      console.error('[CollectionDue] save failed:', err);
      alert('שגיאה בשמירה: ' + (err?.message || err));
    } finally {
      setIsSavingCollection(false);
    }
  };

  const handleMarkCollectionPaid = async () => {
    const dueAmount = toNumber(project.collection_due_amount);
    const dueNote = project.collection_due_note || '';
    const openedAt = project.collection_due_date || '';
    const currentCollected = toNumber(project.collected_amount);
    const now = new Date().toISOString();

    if (dueAmount <= 0) {
      alert('אין סכום גבייה תקין לסימון');
      return;
    }

    setIsSavingCollection(true);

    try {
      const projectPayload = {
        collected_amount: currentCollected + dueAmount,
        last_collection_paid_on: now,
        collection_due_now: false,
        collection_due_amount: 0,
        collection_due_note: '',
        collection_due_date: '',
        collection_due_target_date: '',
      };
      await base44.entities.Project.update(project.id, projectPayload);

      const collectionEventPayload = {
        project_id: project.id,
        project_name: project.name || '',
        amount: dueAmount,
        note: dueNote,
        opened_at: openedAt,
        paid_at: now,
        type: 'collection_paid',
      };
      await base44.entities.CollectionEvent.create(collectionEventPayload);

      await refreshProjectData();
    } catch (err) {
      console.error('[CollectionDue] mark paid failed:', err);
      alert('שגיאה בסימון גבייה: ' + (err?.message || err));
    } finally {
      setIsSavingCollection(false);
    }
  };

  const handleCancelCollectionDue = async () => {
    setIsSavingCollection(true);

    try {
      const payload = {
        collection_due_now: false,
        collection_due_amount: 0,
        collection_due_note: '',
        collection_due_date: '',
        collection_due_target_date: '',
      };
      await base44.entities.Project.update(project.id, payload);

      await refreshProjectData();
    } catch (err) {
      console.error('[CollectionDue] cancel failed:', err);
      alert('שגיאה בביטול גבייה: ' + (err?.message || err));
    } finally {
      setIsSavingCollection(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-[1100px] mx-auto space-y-6">
        <div className="flex items-center gap-2 flex-wrap">
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link to={createPageUrl('Dashboard')}>
              <ArrowRight className="w-4 h-4" />
              חזרה לדשבורד
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link to={createPageUrl('Projects')}>
              <ArrowRight className="w-4 h-4" />
              חזרה לפרויקטים
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
            <CardDescription>
              פתיחת גבייה לפי אבן הדרך הנוכחית בפרויקט.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasCollectionDueNow ? (
              <>
                {hasMissingTargetDate && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <span className="font-medium">חסר תאריך יעד לגבייה</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openCollectionDialog}
                      disabled={isSavingCollection}
                    >
                      ערוך
                    </Button>
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <DetailField label="סכום לגבייה עכשיו">
                    <span className="text-2xl font-semibold">
                      {formatCurrency(project.collection_due_amount)}
                    </span>
                  </DetailField>
                  <DetailField label="סיבה / אבן דרך">
                    {project.collection_due_note || '-'}
                  </DetailField>
                  <DetailField label="נפתח בתאריך">
                    {formatDate(project.collection_due_date)}
                  </DetailField>
                  <DetailField label="תאריך יעד לגבייה">
                    {project.collection_due_target_date
                      ? formatDate(project.collection_due_target_date)
                      : 'חסר'}
                  </DetailField>
                </div>

                <p className="text-sm text-muted-foreground">
                  סומן לאחרונה כנגבה: {formatDate(project.last_collection_paid_on)}
                </p>

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={handleMarkCollectionPaid}
                    disabled={isSavingCollection}
                  >
                    {isSavingCollection ? 'מעדכן...' : 'סמן כנגבה'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={openCollectionDialog}
                    disabled={isSavingCollection}
                  >
                    ערוך
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleCancelCollectionDue}
                    disabled={isSavingCollection}
                  >
                    בטל גבייה
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  אין גבייה פתוחה לטיפול כרגע.
                </p>
                <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                  <span>סומן לאחרונה כנגבה: {formatDate(project.last_collection_paid_on)}</span>
                </div>
                <Button onClick={openCollectionDialog}>
                  פתח גבייה לשלב
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Dialog open={isCollectionDialogOpen} onOpenChange={handleCollectionDialogOpenChange}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{hasCollectionDueNow ? 'עריכת גבייה לשלב' : 'פתיחת גבייה לשלב'}</DialogTitle>
              <DialogDescription>
                הזן את הסכום, הסיבה ותאריך היעד לגבייה הנוכחית.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="collection-amount">סכום לגבייה עכשיו</Label>
                <Input
                  id="collection-amount"
                  type="number"
                  value={collectionAmount}
                  onChange={(event) => setCollectionAmount(event.target.value)}
                  placeholder="לדוגמה: 5000"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="collection-note">סיבה / אבן דרך</Label>
                <Input
                  id="collection-note"
                  value={collectionNote}
                  onChange={(event) => setCollectionNote(event.target.value)}
                  placeholder="לדוגמה: מקדמה / סיום שלב תכנון"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="collection-target-date">תאריך יעד לגבייה</Label>
                <Input
                  id="collection-target-date"
                  type="date"
                  className="w-full"
                  value={collectionTargetDate}
                  onChange={(event) => setCollectionTargetDate(event.target.value)}
                />
                {hasCollectionDueNow && !hasProjectTargetDate(project) && (
                  <p className="text-xs text-amber-700">
                    לגבייה זו חסר תאריך יעד. יש להשלים תאריך לפני שמירה.
                  </p>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                יתרת הגבייה הכוללת כרגע: {formatCurrency(outstandingAmount)}
              </p>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleCollectionDialogOpenChange(false)}
                disabled={isSavingCollection}
              >
                ביטול
              </Button>
              <Button
                onClick={handleSaveCollectionDue}
                disabled={isSavingCollection}
              >
                {isSavingCollection ? 'שומר...' : 'שמור'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}