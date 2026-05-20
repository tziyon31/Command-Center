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

  const totalValidCount = useMemo(() => {
    return reminders.filter(hasClientName).length;
  }, [reminders]);

  const isMetricsFocus = mode === 'metrics_focus';
  const isRemindersFocus = mode === 'reminders_focus';

  return (
    <Card className={cn('p-6 md:col-span-2', mode === 'reminders_focus' && 'order-first', className)}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-amber-600" />
          <div>
            <h3 className="text-lg font-semibold">תזכורות</h3>
            <p className="text-sm text-muted-foreground">
              {totalValidCount > 0
                ? `${totalValidCount} תזכורות לטיפול`
                : 'אין תזכורות לטיפול כרגע'}
            </p>
          </div>
        </div>

        {isMetricsFocus && onShowAll && (
          <Button type="button" variant="outline" size="sm" onClick={onShowAll}>
            הצג את כל התזכורות
          </Button>
        )}

        {isRemindersFocus && onMinimize && (
          <Button type="button" variant="outline" size="sm" onClick={onMinimize}>
            מזער תזכורות
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">טוען תזכורות...</p>
      ) : displayReminders.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין תזכורות לטיפול כרגע</p>
      ) : (
        <div className="space-y-3">
          {displayReminders.map((reminder) => (
            <ReminderCard key={reminder.id || reminder.condition_key} reminder={reminder} />
          ))}
        </div>
      )}
    </Card>
  );
}
