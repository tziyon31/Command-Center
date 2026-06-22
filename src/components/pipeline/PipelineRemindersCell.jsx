import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import PipelineReminderDetailDialog from './PipelineReminderDetailDialog';

function formatReminderCountLabel(count) {
  return count === 1 ? 'תזכורת אחת' : `${count} תזכורות`;
}

function formatReminderDateTime(value) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('he-IL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function ReminderCountBadge({ children, className = 'text-xs' }) {
  return (
    <Badge variant="secondary" className={`font-normal ${className}`}>
      {children}
    </Badge>
  );
}

function ReminderListItems({
  reminders = [],
  onReminderClick,
  size = 'inline',
  showAll = false,
}) {
  const visibleReminders = showAll ? reminders : reminders.slice(0, 2);
  const remainingCount = showAll ? 0 : Math.max(reminders.length - visibleReminders.length, 0);
  const titleClassName = size === 'magnified'
    ? 'block text-right text-base leading-snug text-primary hover:underline'
    : 'block text-right text-xs text-primary hover:underline';
  const metaClassName = size === 'magnified'
    ? 'text-sm text-muted-foreground'
    : 'text-xs text-muted-foreground';

  return (
    <div className={size === 'magnified' ? 'space-y-2' : 'space-y-1'}>
      {visibleReminders.map((reminder) => {
        const nextLabel = formatReminderDateTime(reminder.next_remind_at);
        const title = reminder.title || 'תזכורת';

        return (
          <button
            key={reminder.id}
            type="button"
            className={titleClassName}
            title="לחץ לפרטי התזכורת"
            onClick={() => onReminderClick(reminder)}
          >
            {title}
            {nextLabel ? (
              <span className={metaClassName}>
                {' '}
                ·
                {' '}
                {nextLabel}
              </span>
            ) : null}
          </button>
        );
      })}
      {remainingCount > 0 ? (
        <div className={metaClassName}>
          ועוד
          {' '}
          {remainingCount}
        </div>
      ) : null}
    </div>
  );
}

export default function PipelineRemindersCell({
  reminders = [],
  projectName = '',
  clientName = '',
}) {
  const queryClient = useQueryClient();
  const [selectedReminder, setSelectedReminder] = useState(null);

  if (!reminders.length) {
    return <span className="text-muted-foreground">-</span>;
  }

  const handleSnoozed = () => {
    queryClient.invalidateQueries({ queryKey: ['reminders', 'pipeline-visible'] });
    setSelectedReminder(null);
  };

  const openReminder = (reminder) => {
    if (!reminder) return;
    setSelectedReminder(reminder);
  };

  const displayProjectName = String(
    projectName || reminders[0]?.project_name || '',
  ).trim();
  const displayClientName = String(
    clientName || reminders[0]?.client_name || '',
  ).trim();

  const handleTouchFallbackClick = (event) => {
    if (window.matchMedia('(hover: hover)').matches) return;
    if (event.target !== event.currentTarget) return;
    openReminder(reminders[0]);
  };

  return (
    <>
      <HoverCard openDelay={150} closeDelay={100}>
        <HoverCardTrigger asChild>
          <div
            className="min-w-[150px] space-y-1 text-right"
            dir="rtl"
            onClick={handleTouchFallbackClick}
          >
            <ReminderCountBadge>{formatReminderCountLabel(reminders.length)}</ReminderCountBadge>
            <ReminderListItems
              reminders={reminders}
              onReminderClick={openReminder}
              size="inline"
            />
          </div>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="center"
          sideOffset={10}
          collisionPadding={16}
          className="z-[100] w-auto min-w-[300px] max-w-[min(460px,calc(100vw-2rem))] border bg-popover p-4 shadow-lg"
          dir="rtl"
        >
          <div className="space-y-3 text-right">
            <div>
              <div className="text-base font-semibold leading-snug">
                תזכורות לפרויקט:
                {' '}
                {displayProjectName || 'לא צוין'}
              </div>
              {displayClientName ? (
                <div className="text-sm text-muted-foreground mt-1">
                  לקוח:
                  {' '}
                  {displayClientName}
                </div>
              ) : null}
            </div>
            <ReminderCountBadge className="text-sm">
              {formatReminderCountLabel(reminders.length)}
            </ReminderCountBadge>
            <ReminderListItems
              reminders={reminders}
              onReminderClick={openReminder}
              size="magnified"
              showAll
            />
          </div>
        </HoverCardContent>
      </HoverCard>

      <PipelineReminderDetailDialog
        reminder={selectedReminder}
        open={Boolean(selectedReminder)}
        onClose={() => setSelectedReminder(null)}
        onSnoozed={handleSnoozed}
        projectName={projectName}
        clientName={clientName}
      />
    </>
  );
}
