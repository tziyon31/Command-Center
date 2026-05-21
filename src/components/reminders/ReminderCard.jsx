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
  toDatetimeLocalValue,
} from './reminderDateTime.js';
import { Bell, Clock, ExternalLink, Pencil } from 'lucide-react';
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
    year: 'numeric',
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
      <div
        className={cn(
          'flex flex-col gap-3 p-4 rounded-lg border border-amber-200/80 bg-amber-50/40 text-right',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm mb-1">{reminder.title}</div>
            <div className="text-xs text-muted-foreground">{reminder.client_name}</div>
            {reminder.project_name && (
              <div className="text-xs text-muted-foreground mt-0.5">
                פרויקט: {reminder.project_name}
              </div>
            )}
          </div>
          <Bell className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="text-xs">
            {frequencyLabel}
          </Badge>
          {activeDays !== null && (
            <Badge variant="secondary" className="text-xs">
              פעילה {activeDays} ימים
            </Badge>
          )}
          {nextRemindAtLabel && (
            <Badge variant="outline" className="text-xs">
              הבא: {nextRemindAtLabel}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleActionClick}
          >
            <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
            {reminder.action_label || 'פתח'}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isSnoozing}
                className="text-muted-foreground"
              >
                <Clock className="w-3.5 h-3.5 ml-1.5" />
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
            className="text-muted-foreground"
            onClick={() => setEditOpen(true)}
            disabled={isSnoozing}
          >
            <Pencil className="w-3.5 h-3.5 ml-1.5" />
            ערוך
          </Button>
        </div>
      </div>

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
              className="text-right"
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
