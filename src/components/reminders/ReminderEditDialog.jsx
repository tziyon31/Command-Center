import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { snoozeReminder, updateReminderSchedule } from '@/lib/reminderEngine';
import {
  datetimeLocalToIso,
  getDefaultFutureDatetimeValue,
  isFutureDatetimeLocal,
  toDatetimeLocalValue,
} from './reminderDateTime.js';

const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'יומי' },
  { value: 'weekly', label: 'שבועי' },
  { value: 'due_date_based', label: 'לפי תאריך יעד' },
  { value: 'custom', label: 'מותאם אישית' },
];

export default function ReminderEditDialog({
  reminder,
  open,
  onClose,
  onUpdated,
}) {
  const [frequency, setFrequency] = useState('daily');
  const [nextRemindAtValue, setNextRemindAtValue] = useState('');
  const [snoozeUntilValue, setSnoozeUntilValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSnoozing, setIsSnoozing] = useState(false);

  useEffect(() => {
    if (!open || !reminder) return;

    const initialFrequency = FREQUENCY_OPTIONS.some((option) => option.value === reminder.frequency)
      ? reminder.frequency
      : 'daily';

    setFrequency(initialFrequency);
    setNextRemindAtValue(
      toDatetimeLocalValue(reminder.next_remind_at) || getDefaultFutureDatetimeValue(),
    );
    setSnoozeUntilValue(
      toDatetimeLocalValue(reminder.snoozed_until) || getDefaultFutureDatetimeValue(),
    );
  }, [open, reminder]);

  const handleClose = () => {
    if (isSaving || isSnoozing) return;
    onClose?.();
  };

  const handleSaveSchedule = async () => {
    if (!reminder?.id || isSaving || isSnoozing) return;

    if (!isFutureDatetimeLocal(nextRemindAtValue)) {
      alert('יש לבחור זמן עתידי לתזכורת');
      return;
    }

    setIsSaving(true);

    try {
      await updateReminderSchedule(reminder.id, {
        frequency,
        next_remind_at: datetimeLocalToIso(nextRemindAtValue),
      });

      onUpdated?.();
      onClose?.();
    } catch (error) {
      console.error('[ReminderEditDialog] failed to update reminder schedule', error);
      alert('לא הצלחתי לעדכן את התזכורת');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSnoozeUntil = async () => {
    if (!reminder?.id || isSaving || isSnoozing) return;

    if (!isFutureDatetimeLocal(snoozeUntilValue)) {
      alert('יש לבחור זמן עתידי לתזכורת');
      return;
    }

    setIsSnoozing(true);

    try {
      await snoozeReminder(reminder.id, datetimeLocalToIso(snoozeUntilValue));
      onUpdated?.();
      onClose?.();
    } catch (error) {
      console.error('[ReminderEditDialog] failed to snooze reminder', error);
      alert('לא הצלחתי לדחות את התזכורת');
    } finally {
      setIsSnoozing(false);
    }
  };

  if (!reminder) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-md text-right" dir="rtl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>עריכת תזכורת</DialogTitle>
          <DialogDescription>עריכת הגדרות תזמון בלבד</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 rounded-lg border bg-muted/30 p-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground mb-1">כותרת</div>
            <div className="font-medium">{reminder.title}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">לקוח</div>
            <div>{reminder.client_name}</div>
          </div>
          {reminder.project_name && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">פרויקט</div>
              <div>{reminder.project_name}</div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>תדירות</Label>
          <Select value={frequency} onValueChange={setFrequency} disabled={isSaving || isSnoozing}>
            <SelectTrigger>
              <SelectValue placeholder="בחר תדירות" />
            </SelectTrigger>
            <SelectContent>
              {FREQUENCY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`edit-next-remind-${reminder.id}`}>מועד התזכורת הבא</Label>
          <Input
            id={`edit-next-remind-${reminder.id}`}
            type="datetime-local"
            value={nextRemindAtValue}
            onChange={(event) => setNextRemindAtValue(event.target.value)}
            dir="ltr"
            disabled={isSaving || isSnoozing}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`edit-snooze-until-${reminder.id}`}>דחה עד</Label>
          <Input
            id={`edit-snooze-until-${reminder.id}`}
            type="datetime-local"
            value={snoozeUntilValue}
            onChange={(event) => setSnoozeUntilValue(event.target.value)}
            dir="ltr"
            disabled={isSaving || isSnoozing}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleSnoozeUntil}
            disabled={isSaving || isSnoozing}
          >
            {isSnoozing ? 'מדחה...' : 'דחה עד תאריך זה'}
          </Button>
        </div>

        <DialogFooter className="flex-row-reverse gap-2 sm:justify-start">
          <Button
            type="button"
            size="sm"
            onClick={handleSaveSchedule}
            disabled={isSaving || isSnoozing}
          >
            {isSaving ? 'שומר...' : 'שמור תזמון'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={isSaving || isSnoozing}
          >
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
