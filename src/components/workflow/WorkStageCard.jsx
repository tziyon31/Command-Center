import React from 'react';
import { GripVertical, Pencil, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

const APPROVAL_FIELDS = [
  { key: 'aaron_approved', label: 'אהרון' },
  { key: 'client_approved', label: 'לקוח' },
  { key: 'draftsman_approved', label: 'שרטט' },
];

const formatDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('he-IL').format(date);
};

export default function WorkStageCard({
  stage,
  orderIndex,
  statusLabel,
  isHighlighted = false,
  isDragging = false,
  isBusy = false,
  dragHandleProps = null,
  onEdit,
  onDelete,
  onCancel,
  onApprovalToggle,
  showInvoiceInclude = false,
  includeInInvoice = false,
  onIncludeInInvoiceToggle,
}) {
  const targetLabel = formatDate(stage.target_date);
  const notesPreview = String(stage.notes || '').trim();
  const invoiceLabel = stage.invoice_required_on_completion === true ? 'כן' : 'לא';

  return (
    <div
      id={`work-stage-row-${stage.id}`}
      className={cn(
        'w-full rounded-lg border bg-card px-3 py-3 shadow-sm transition-shadow',
        isHighlighted && 'ring-2 ring-primary/40 bg-primary/5',
        isDragging && 'shadow-md ring-1 ring-primary/20',
        isBusy && 'opacity-70 pointer-events-none',
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5 shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
          aria-label="גרור לשינוי סדר"
          {...(dragHandleProps || {})}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2 justify-between gap-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground tabular-nums">
                {orderIndex}
              </span>
              <h4 className="truncate text-sm font-semibold text-foreground">
                {stage.title || 'שלב ללא שם'}
              </h4>
              <Badge variant="outline" className="shrink-0 text-xs font-normal">
                {statusLabel}
              </Badge>
            </div>

            <div className="flex shrink-0 flex-wrap gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2"
                disabled={isBusy}
                onClick={() => onEdit(stage)}
              >
                <Pencil className="h-3.5 w-3.5 ml-1" />
                ערוך
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2"
                disabled={isBusy}
                onClick={() => onCancel(stage)}
              >
                <XCircle className="h-3.5 w-3.5 ml-1" />
                בטל
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-7 px-2"
                disabled={isBusy}
                onClick={() => onDelete(stage)}
              >
                <Trash2 className="h-3.5 w-3.5 ml-1" />
                מחק
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {targetLabel ? `יעד: ${targetLabel}` : 'יעד: —'}
            {' | '}
            {`חשבונית: ${invoiceLabel}`}
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-xs text-muted-foreground">אישורים:</span>
            {APPROVAL_FIELDS.map(({ key, label }) => (
              <label
                key={key}
                className="inline-flex items-center gap-1.5 text-xs cursor-pointer"
              >
                <Checkbox
                  checked={stage[key] === true}
                  disabled={isBusy}
                  onCheckedChange={(checked) => {
                    onApprovalToggle(stage, key, checked === true);
                  }}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          {notesPreview ? (
            <p className="text-xs text-muted-foreground line-clamp-2" title={notesPreview}>
              הערות:
              {' '}
              {notesPreview}
            </p>
          ) : null}

          {showInvoiceInclude ? (
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer pt-1 border-t border-dashed w-full">
              <Checkbox
                checked={includeInInvoice}
                disabled={isBusy}
                onCheckedChange={(checked) => {
                  onIncludeInInvoiceToggle?.(stage, checked === true);
                }}
              />
              <span>כלול בתהליך חשבונית</span>
            </label>
          ) : null}
        </div>
      </div>
    </div>
  );
}
