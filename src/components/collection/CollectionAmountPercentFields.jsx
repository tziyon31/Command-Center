import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  calculateAmountFromProjectPercent,
  calculatePercentFromProjectAmount,
  getProjectFeeAmount,
} from '@/lib/invoiceProcessUtils';

const formatCurrency = (value) => (
  new Intl.NumberFormat('he-IL').format(Number(value) || 0)
);

export default function CollectionAmountPercentFields({
  project,
  amountValue,
  percentValue,
  onAmountChange,
  onPercentChange,
  amountLabel = 'סכום לגבייה',
  percentLabel = 'אחוז משכ״ט',
  amountId = 'collection-amount',
  percentId = 'collection-percent',
  disabled = false,
  outstandingHint = '',
}) {
  const projectFeeAmount = getProjectFeeAmount(project);

  const handlePercentChange = (value) => {
    onPercentChange?.(value);

    if (!String(value || '').trim()) return;

    const calculated = calculateAmountFromProjectPercent(project, value);
    if (calculated != null) {
      onAmountChange?.(String(calculated));
    }
  };

  const handleAmountChange = (value) => {
    onAmountChange?.(value);

    const percent = calculatePercentFromProjectAmount(project, value);
    if (percent != null) {
      onPercentChange?.(String(percent));
      return;
    }

    if (!String(value || '').trim()) {
      onPercentChange?.('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={percentId}>{percentLabel}</Label>
          <Input
            id={percentId}
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={percentValue}
            disabled={disabled || !project?.id}
            placeholder="לדוגמה: 70"
            onChange={(event) => handlePercentChange(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">מחושב לפי שכ״ט הפרויקט</p>
          {Boolean(String(percentValue || '').trim()) && projectFeeAmount <= 0 ? (
            <p className="text-xs text-amber-700">לא נמצא סכום פרויקט לחישוב אוטומטי.</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor={amountId}>{amountLabel}</Label>
          <Input
            id={amountId}
            type="number"
            min="0"
            step="0.01"
            value={amountValue}
            disabled={disabled}
            onChange={(event) => handleAmountChange(event.target.value)}
          />
          {projectFeeAmount > 0 ? (
            <p className="text-xs text-muted-foreground">
              שכ״ט פרויקט:
              {' '}
              {formatCurrency(projectFeeAmount)}
              {' '}
              ₪
            </p>
          ) : null}
          {outstandingHint ? (
            <p className="text-xs text-muted-foreground">{outstandingHint}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
