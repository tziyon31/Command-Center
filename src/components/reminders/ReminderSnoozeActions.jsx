import React, { useMemo, useState } from 'react';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/use-toast';
import { snoozeReminder } from '@/lib/reminderEngine';
import {
  getSnoozeOptionsForReminder,
  getSnoozedUntilIso,
  REMINDER_CUSTOM_SNOOZE_LABEL,
} from '@/lib/reminderSnoozeOptions';
import {
  datetimeLocalToIso,
  getDefaultFutureDatetimeValue,
  isFutureDatetimeLocal,
} from './reminderDateTime.js';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

const formatShortDateTime = (value) => {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

export default function ReminderSnoozeActions({
  reminder,
  onSnoozed,
  onSnoozedComplete,
  layout = 'dropdown',
  disabled = false,
  buttonClassName,
  buttonSize = 'sm',
  buttonVariant = 'outline',
}) {
  const [isSnoozing, setIsSnoozing] = useState(false);
  const [customSnoozeOpen, setCustomSnoozeOpen] = useState(false);
  const [customDateTimeValue, setCustomDateTimeValue] = useState(getDefaultFutureDatetimeValue);

  const snoozeOptions = useMemo(
    () => getSnoozeOptionsForReminder(reminder),
    [reminder],
  );

  const applySnooze = async (snoozedUntil, label) => {
    if (!reminder?.id || isSnoozing) return;

    setIsSnoozing(true);

    try {
      await snoozeReminder(reminder.id, snoozedUntil);

      toast({
        title: 'התזכורת נדחתה',
        description: `${label} · עד ${formatShortDateTime(snoozedUntil)}`,
      });

      onSnoozed?.();
      onSnoozedComplete?.();
    } catch (error) {
      console.error('[ReminderSnoozeActions] failed to snooze reminder', error);
      alert('לא הצלחתי לדחות את התזכורת');
    } finally {
      setIsSnoozing(false);
    }
  };

  const handleSnoozeOption = async (option) => {
    await applySnooze(getSnoozedUntilIso(option), option.label);
  };

  const openCustomSnoozeDialog = () => {
    setCustomDateTimeValue(getDefaultFutureDatetimeValue());
    setCustomSnoozeOpen(true);
  };

  const handleCustomSnooze = async () => {
    if (!isFutureDatetimeLocal(customDateTimeValue)) {
      alert('יש לבחור זמן עתידי לתזכורת');
      return;
    }

    await applySnooze(datetimeLocalToIso(customDateTimeValue), REMINDER_CUSTOM_SNOOZE_LABEL);
    setCustomSnoozeOpen(false);
  };

  const isDisabled = disabled || isSnoozing || !reminder?.id;

  const customSnoozeDialog = (
    <Dialog open={customSnoozeOpen} onOpenChange={setCustomSnoozeOpen}>
      <DialogContent className="max-w-sm text-right" dir="rtl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>דחיית תזכורת</DialogTitle>
          <DialogDescription>
            בחר מתי להציג שוב את התזכורת
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor={`custom-snooze-${reminder?.id || 'reminder'}`}>תאריך ושעה</Label>
          <Input
            id={`custom-snooze-${reminder?.id || 'reminder'}`}
            type="datetime-local"
            value={customDateTimeValue}
            onChange={(event) => setCustomDateTimeValue(event.target.value)}
            dir="ltr"
          />
        </div>

        <DialogFooter className="flex-row-reverse gap-2 sm:justify-start">
          <Button
            type="button"
            size="sm"
            onClick={handleCustomSnooze}
            disabled={isSnoozing}
          >
            {isSnoozing ? 'מדחה...' : 'אישור'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setCustomSnoozeOpen(false)}
            disabled={isSnoozing}
          >
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (layout === 'stack') {
    return (
      <>
        <div className="flex w-full flex-col gap-2">
          {snoozeOptions.map((option) => (
            <Button
              key={option.id}
              type="button"
              variant={buttonVariant}
              size={buttonSize}
              className={cn('w-full', buttonClassName)}
              disabled={isDisabled}
              onClick={() => handleSnoozeOption(option)}
            >
              {isSnoozing ? 'מדחה...' : option.label}
            </Button>
          ))}
          <Button
            type="button"
            variant={buttonVariant}
            size={buttonSize}
            className={cn('w-full', buttonClassName)}
            disabled={isDisabled}
            onClick={openCustomSnoozeDialog}
          >
            {REMINDER_CUSTOM_SNOOZE_LABEL}
          </Button>
        </div>
        {customSnoozeDialog}
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant={buttonVariant}
            size={buttonSize}
            disabled={isDisabled}
            className={buttonClassName}
          >
            <Clock className="w-3 h-3 ml-1" />
            {isSnoozing ? 'מדחה...' : 'דחה'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="text-right">
          {snoozeOptions.map((option) => (
            <DropdownMenuItem
              key={option.id}
              disabled={isDisabled}
              onClick={() => handleSnoozeOption(option)}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            disabled={isDisabled}
            onSelect={(event) => {
              event.preventDefault();
              openCustomSnoozeDialog();
            }}
          >
            {REMINDER_CUSTOM_SNOOZE_LABEL}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {customSnoozeDialog}
    </>
  );
}
