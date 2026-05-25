import React, { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReminderCard from './ReminderCard.jsx';

const METRICS_FOCUS_LIMIT = 7;

const hasClientName = (reminder) =>
  reminder?.client_name !== undefined
  && reminder?.client_name !== null
  && String(reminder.client_name).trim() !== '';

export default function ReminderPanel({
  reminders = [],
  mode = 'metrics_focus',
  onShowAll,
  onMinimize,
  onSnoozed,
  isLoading = false,
  className,
}) {
  const displayReminders = useMemo(() => {
    const validReminders = [];

    reminders.forEach((reminder) => {
      if (!hasClientName(reminder)) {
        console.warn('[ReminderPanel] Reminder missing client_name', reminder);
        return;
      }

      validReminders.push(reminder);
    });

    if (mode === 'reminders_focus') {
      return validReminders;
    }

    return validReminders.slice(0, METRICS_FOCUS_LIMIT);
  }, [reminders, mode]);

  const totalCount = useMemo(() => {
    return reminders.filter(hasClientName).length;
  }, [reminders]);

  const visibleCount = displayReminders.length;
  const hiddenCount = Math.max(0, totalCount - visibleCount);
  const hasHiddenReminders = hiddenCount > 0;

  const isMetricsFocus = mode === 'metrics_focus';
  const isRemindersFocus = mode === 'reminders_focus';

  const statusLine = (() => {
    if (totalCount === 0) {
      return 'אין תזכורות לטיפול כרגע';
    }

    if (isRemindersFocus) {
      return `מוצגות כל ${totalCount} התזכורות`;
    }

    if (hasHiddenReminders) {
      return `מוצגות ${visibleCount} מתוך ${totalCount} תזכורות`;
    }

    return `${totalCount} תזכורות לטיפול`;
  })();

  return (
    <Card
      className={cn(
        'p-4 md:col-span-2 border-slate-200/90 shadow-sm',
        isRemindersFocus && 'order-first',
        className,
      )}
      dir="rtl"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100">
            <Bell className="w-4 h-4 text-slate-600" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold leading-tight">תזכורות</h3>
            <p className="text-xs text-muted-foreground">{statusLine}</p>
          </div>
        </div>

        {isRemindersFocus && onMinimize && (
          <Button type="button" variant="outline" size="sm" className="shrink-0 h-8 text-xs" onClick={onMinimize}>
            מזער תזכורות
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">טוען תזכורות...</p>
      ) : displayReminders.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין תזכורות לטיפול כרגע</p>
      ) : (
        <>
          <div
            className={cn(
              'grid gap-3',
              'grid-cols-1 md:grid-cols-2',
              isRemindersFocus && 'xl:grid-cols-3',
            )}
          >
            {displayReminders.map((reminder) => (
              <ReminderCard
                key={reminder.id || reminder.condition_key}
                reminder={reminder}
                onSnoozed={onSnoozed}
              />
            ))}
          </div>

          {isMetricsFocus && hasHiddenReminders && (
            <div className="mt-4 pt-3 border-t border-slate-200/80 space-y-2">
              <p className="text-sm text-muted-foreground">
                מוצגות {visibleCount} מתוך {totalCount} תזכורות
              </p>
              <p className="text-sm text-amber-800/90">
                עוד {hiddenCount} תזכורות מוסתרות
              </p>
              {onShowAll && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={onShowAll}
                >
                  הצג את כל {totalCount} התזכורות
                </Button>
              )}
            </div>
          )}

          {isRemindersFocus && totalCount > 0 && (
            <p className="mt-4 pt-3 border-t border-slate-200/80 text-sm text-muted-foreground">
              מוצגות כל {totalCount} התזכורות
            </p>
          )}
        </>
      )}
    </Card>
  );
}
