import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ReminderEditDialog from './ReminderEditDialog.jsx';
import ReminderSnoozeActions from './ReminderSnoozeActions.jsx';
import { ExternalLink, Pencil } from 'lucide-react';
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

const shortId = (value) => String(value || '').slice(0, 6);

const formatShortDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(date);
};

const startsWithKey = (conditionKey, prefix) =>
  String(conditionKey || '').startsWith(prefix);

const buildReminderContextLine = (reminder) => {
  const conditionKey = reminder?.condition_key || '';
  const sourceType = reminder?.source_type || '';
  const projectName = String(reminder?.project_name || '').trim();
  const clientName = String(reminder?.client_name || '').trim();
  const description = String(reminder?.description || '').trim();

  if (
    startsWithKey(conditionKey, 'proposal_incomplete:')
    || startsWithKey(conditionKey, 'proposal_not_sent:')
    || startsWithKey(conditionKey, 'proposal_not_seen:')
  ) {
    if (projectName) return `הצעה · פרויקט: ${projectName}`;

    if (description && !description.startsWith('הצעת המחיר')) {
      return `הצעה · ${description}`;
    }

    const createdDate = formatShortDate(reminder?.created_date || reminder?.submitted_at || reminder?.active_since);
    if (createdDate) return `הצעה · נוצרה ${createdDate}`;
    return `הצעה · מזהה ${shortId(reminder?.source_id)}`;
  }

  if (
    startsWithKey(conditionKey, 'project_needs_proposal:')
    || sourceType === 'project'
  ) {
    if (projectName) return `פרויקט: ${projectName}`;
    return `פרויקט: ${shortId(reminder?.source_id)}`;
  }

  if (
    startsWithKey(conditionKey, 'client_needs_project:')
    || sourceType === 'client'
  ) {
    if (clientName) return `לקוח: ${clientName}`;
    return null;
  }

  if (projectName) return `פרויקט: ${projectName}`;
  return null;
};

export default function ReminderCard({ reminder, onSnoozed, className }) {
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const activeDays = getActiveDays(reminder.active_since);
  const frequencyLabel = FREQUENCY_LABELS[reminder.frequency] || reminder.frequency || 'יומי';
  const nextRemindAtLabel = formatShortDateTime(reminder.next_remind_at);
  const contextLine = buildReminderContextLine(reminder);

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
          {contextLine && (
            <p className="truncate">{contextLine}</p>
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

          <ReminderSnoozeActions
            reminder={reminder}
            onSnoozed={onSnoozed}
            buttonClassName="h-7 px-2 text-xs text-muted-foreground"
          />

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setEditOpen(true)}
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
    </>
  );
}
