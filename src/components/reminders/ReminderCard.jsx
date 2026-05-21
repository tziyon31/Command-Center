import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import ReminderEditDialog from './ReminderEditDialog.jsx';
import {
  datetimeLocalToIso,
  getDefaultFutureDatetimeValue,
  isFutureDatetimeLocal,
} from './reminderDateTime.js';
import { Clock, ExternalLink, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';

const FREQUENCY_LABELS = {
  immediate: 'מיידי',
  daily: 'יומי',
  weekly: 'שבועי',
  due_date_based: 'לפי תאריך יעד',
  custom: 'מותאם',
};

const SNOOZE_OPTIONS = [
  {
    id: 'later_today',
    label: 'מאוחר יותר היום',
    getSnoozedUntil: () => {
      const date = new Date();
      date.setHours(date.getHours() + 3);
      return date;
    },
  },
  {
    id: 'tomorrow_morning',
    label: 'מחר בבוקר',
    getSnoozedUntil: () => {
      const date = new Date();
      date.setDate(date.getDate() + 1);
      date.setHours(7, 0, 0, 0);
      return date;
    },
  },
  {
    id: 'next_week',
    label: 'בעוד שבוע',
    getSnoozedUntil: () => {
      const date = new Date();
      date.setDate(date.getDate() + 7);
      return date;
    },
  },
];

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

const getActiveDays = (activeSince) => {
  if (!activeSince) return null;

  const start = new Date(activeSince);
  if (Number.isNaN(start.getTime())) return null;

  const diffMs = Date.now() - start.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
};

export default function ReminderCard({ reminder, onSnoozed, className }) {
  const navigate = useNavigate();
  const [isSnoozing, setIsSnoozing] = useState(false);
  const [customSnoozeOpen, setCustomSnoozeOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [customDateTimeValue, setCustomDateTimeValue] = useState(getDefaultFutureDatetimeValue);
  const activeDays = getActiveDays(reminder.active_since);
  const frequencyLabel = FREQUENCY_LABELS[reminder.frequency] || reminder.frequency || 'יומי';
  const nextRemindAtLabel = formatShortDateTime(reminder.next_remind_at);

  const handleActionClick = () => {
    const actionUrl = reminder.action_url;
    if (!actionUrl) return;

    if (/^https?:\/\//i.test(actionUrl)) {
      window.location.href = actionUrl;
      return;
    }

    navigate(actionUrl.startsWith('/') ? actionUrl : `/${actionUrl}`);
  };

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
    } catch (error) {
      throw error;
    } finally {
      setIsSnoozing(false);
    }
  };

  const handleSnooze = async (option) => {
    try {
      const snoozedUntil = option.getSnoozedUntil().toISOString();
      await applySnooze(snoozedUntil, option.label);
    } catch (error) {
      console.error('[ReminderCard] failed to snooze reminder', error);
      alert('לא הצלחתי לדחות את התזכורת');
    }
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

    try {
      await applySnooze(datetimeLocalToIso(customDateTimeValue), 'בחר תאריך ושעה');
      setCustomSnoozeOpen(false);
    } catch (error) {
      console.error('[ReminderCard] failed to custom snooze reminder', error);
      alert('לא הצלחתי לדחות את התזכורת');
    }
  };

  return (
    <>
      <article
        className={cn(
          'h-auto w-full rounded-lg border border-slate-200/90 bg-slate-50/70 p-3 text-right shadow-sm',
          className,
        )}
        dir="rtl"
      >
        <div className="flex items-start gap-2">
          <h4 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground">
            {reminder.title}
          </h4>
          <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0 h-5">
            {frequencyLabel}
          </Badge>
        </div>

        <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
          <p className="truncate">{reminder.client_name}</p>
          {reminder.project_name && (
            <p className="truncate">פרויקט: {reminder.project_name}</p>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {activeDays !== null && <span>פעילה {activeDays} ימים</span>}
          {nextRemindAtLabel && <span>הבא: {nextRemindAtLabel}</span>}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={handleActionClick}
          >
            <ExternalLink className="w-3 h-3 ml-1" />
            {reminder.action_label || 'פתח'}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isSnoozing}
                className="h-7 px-2 text-xs text-muted-foreground"
              >
                <Clock className="w-3 h-3 ml-1" />
                {isSnoozing ? 'מדחה...' : 'דחה'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-right">
              {SNOOZE_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.id}
                  disabled={isSnoozing}
                  onClick={() => handleSnooze(option)}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                disabled={isSnoozing}
                onSelect={(event) => {
                  event.preventDefault();
                  openCustomSnoozeDialog();
                }}
              >
                בחר תאריך ושעה
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setEditOpen(true)}
            disabled={isSnoozing}
          >
            <Pencil className="w-3 h-3 ml-1" />
            ערוך
          </Button>
        </div>
      </article>

      <ReminderEditDialog
        reminder={reminder}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onUpdated={onSnoozed}
      />

      <Dialog open={customSnoozeOpen} onOpenChange={setCustomSnoozeOpen}>
        <DialogContent className="max-w-sm text-right" dir="rtl">
          <DialogHeader className="text-right sm:text-right">
            <DialogTitle>דחיית תזכורת</DialogTitle>
            <DialogDescription>
              בחר מתי להציג שוב את התזכורת
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor={`custom-snooze-${reminder.id}`}>תאריך ושעה</Label>
            <Input
              id={`custom-snooze-${reminder.id}`}
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
    </>
  );
}
