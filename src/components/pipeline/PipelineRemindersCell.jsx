import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import {
  buildPipelineReminderCompactSummary,
} from '@/lib/pipelineReminderDisplay';
import PipelineReminderDetailDialog from './PipelineReminderDetailDialog';

function formatReminderCountLabel(count) {
  return count === 1 ? 'תזכורת אחת' : `${count} תזכורות`;
}

export default function PipelineRemindersCell({
  reminders = [],
  projectName = '',
  clientName = '',
}) {
  const queryClient = useQueryClient();
  const [selectedReminder, setSelectedReminder] = useState(null);

  if (!reminders.length) {
    return <span className="text-muted-foreground text-xs">-</span>;
  }

  const compactSummary = buildPipelineReminderCompactSummary(reminders, { maxLines: 2 });

  const handleSnoozed = () => {
    queryClient.invalidateQueries({ queryKey: ['reminders', 'pipeline-visible'] });
    setSelectedReminder(null);
  };

  const openReminder = (reminder) => {
    if (!reminder) return;
    setSelectedReminder(reminder);
  };

  return (
    <>
      <div className="min-w-[120px] max-w-[170px] space-y-0.5">
        <button
          type="button"
          className="inline-flex"
          title={compactSummary.combinedText || formatReminderCountLabel(reminders.length)}
          onClick={() => openReminder(reminders[0])}
        >
          <Badge variant="secondary" className="font-normal text-[11px] px-1.5 py-0 h-5 hover:bg-secondary/80">
            {formatReminderCountLabel(reminders.length)}
          </Badge>
        </button>

        {compactSummary.lines.map((line) => (
          <button
            key={line.id}
            type="button"
            className="block w-full truncate text-right text-[11px] leading-tight text-primary hover:underline"
            title={line.fullTitle}
            onClick={() => openReminder(line.reminder)}
          >
            {line.displayText}
          </button>
        ))}

        {compactSummary.hiddenCount > 0 ? (
          <button
            type="button"
            className="block text-right text-[11px] leading-tight text-muted-foreground hover:underline"
            onClick={() => openReminder(reminders[2] || reminders[0])}
          >
            ועוד
            {' '}
            {compactSummary.hiddenCount}
          </button>
        ) : null}
      </div>

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
