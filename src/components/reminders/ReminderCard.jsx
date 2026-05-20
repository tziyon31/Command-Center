import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

const FREQUENCY_LABELS = {
  immediate: 'מיידי',
  daily: 'יומי',
  weekly: 'שבועי',
  due_date_based: 'לפי תאריך יעד',
  custom: 'מותאם',
};

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

export default function ReminderCard({ reminder, className }) {
  const navigate = useNavigate();
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

  return (
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

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={handleActionClick}
      >
        <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
        {reminder.action_label || 'פתח'}
      </Button>
    </div>
  );
}
