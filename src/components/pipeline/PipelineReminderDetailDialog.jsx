import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { snoozeReminder } from '@/lib/reminderEngine';

const FREQUENCY_LABELS = {
  immediate: 'מיידי',
  daily: 'יומי',
  weekly: 'שבועי',
  due_date_based: 'לפי תאריך יעד',
  custom: 'מותאם',
};

const formatReminderDateTime = (value) => {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
};

const getTomorrowMorningIso = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(7, 0, 0, 0);
  return date.toISOString();
};

function navigateToReminderAction(navigate, reminder) {
  const actionUrl = String(reminder?.action_url || reminder?.target_url || '').trim();
  if (!actionUrl) return;

  if (/^https?:\/\//i.test(actionUrl)) {
    window.location.href = actionUrl;
    return;
  }

  navigate(actionUrl.startsWith('/') ? actionUrl : `/${actionUrl}`);
}

export default function PipelineReminderDetailDialog({
  reminder,
  open,
  onClose,
  onSnoozed,
  projectName = '',
  clientName = '',
}) {
  const navigate = useNavigate();
  const [isSnoozing, setIsSnoozing] = useState(false);

  if (!reminder) return null;

  const displayProjectName = String(reminder.project_name || projectName || '').trim();
  const displayClientName = String(reminder.client_name || clientName || '').trim();
  const actionUrl = String(reminder.action_url || reminder.target_url || '').trim();
  const actionLabel = reminder.action_label || reminder.target_label || 'פתח';
  const frequencyLabel = FREQUENCY_LABELS[reminder.frequency] || reminder.frequency || '';
  const nextRemindAtLabel = formatReminderDateTime(reminder.next_remind_at);

  const handlePrimaryAction = () => {
    navigateToReminderAction(navigate, reminder);
    onClose?.();
  };

  const handleSnoozeUntilTomorrow = async () => {
    if (!reminder?.id || isSnoozing) return;

    setIsSnoozing(true);

    try {
      const snoozedUntil = getTomorrowMorningIso();
      await snoozeReminder(reminder.id, snoozedUntil);

      toast({
        title: 'התזכורת נדחתה',
        description: `מחר בבוקר · עד ${formatReminderDateTime(snoozedUntil)}`,
      });

      onSnoozed?.();
      onClose?.();
    } catch (error) {
      console.error('[PipelineReminderDetailDialog] failed to snooze reminder', error);
      alert('לא הצלחתי לדחות את התזכורת');
    } finally {
      setIsSnoozing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose?.(); }}>
      <DialogContent className="max-w-md text-right" dir="rtl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>{reminder.title || 'תזכורת'}</DialogTitle>
          {reminder.description ? (
            <DialogDescription className="text-right">
              {reminder.description}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <div className="space-y-2 text-sm">
          {displayProjectName ? (
            <div>
              <span className="text-muted-foreground">פרויקט: </span>
              <span>{displayProjectName}</span>
            </div>
          ) : null}
          {displayClientName ? (
            <div>
              <span className="text-muted-foreground">לקוח: </span>
              <span>{displayClientName}</span>
            </div>
          ) : null}
          {nextRemindAtLabel ? (
            <div>
              <span className="text-muted-foreground">תזכורת הבאה: </span>
              <span>{nextRemindAtLabel}</span>
            </div>
          ) : null}
          {frequencyLabel ? (
            <div>
              <span className="text-muted-foreground">תדירות: </span>
              <span>{frequencyLabel}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-col-reverse sm:items-stretch">
          {actionUrl ? (
            <Button type="button" onClick={handlePrimaryAction}>
              {actionLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={handleSnoozeUntilTomorrow}
            disabled={isSnoozing}
          >
            {isSnoozing ? 'מדחה...' : 'דחה למחר'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
