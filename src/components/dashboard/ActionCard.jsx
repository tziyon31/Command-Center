import React, { useState } from 'react';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import StatusBadge from '@/components/StatusBadge';
import { ChevronLeft } from 'lucide-react';
import { cn } from "@/lib/utils";

const DEFAULT_MAX_VISIBLE_ITEMS = 5;

const formatCurrency = (value) => (
  new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
  }).format(Number(value) || 0)
);

function ActionCardItem({ item, onItemClick, showExtendedDetails = false, className }) {
  const isClickable = Boolean(onItemClick);

  const content = (
    <>
      <div className="flex-1">
        <div className="font-medium text-sm mb-1">{item.title}</div>
        <div className="text-xs text-muted-foreground">{item.subtitle}</div>
        {showExtendedDetails && item.dialogExtras && (
          <div className="mt-2 space-y-1.5">
            {item.dialogExtras.status && (
              <StatusBadge status={item.dialogExtras.status} />
            )}
            {item.dialogExtras.daysInactive !== undefined && (
              <div className="text-xs text-muted-foreground">
                {item.dialogExtras.daysInactive !== null
                  ? `ללא פעילות ${item.dialogExtras.daysInactive} ימים`
                  : 'ללא פעילות - אין תאריך עדכון'}
              </div>
            )}
            {item.dialogExtras.outstandingAmount > 0 && (
              <div className="text-xs text-muted-foreground">
                יתרת גבייה: {formatCurrency(item.dialogExtras.outstandingAmount)}
              </div>
            )}
          </div>
        )}
      </div>
      {isClickable && (
        <ChevronLeft className="w-4 h-4 text-muted-foreground mr-2 mt-1 flex-shrink-0" />
      )}
    </>
  );

  if (!isClickable) {
    return (
      <div className={cn('flex items-start justify-between p-4 rounded-lg border border-slate-200 bg-slate-50/50 text-right', className)}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onItemClick(item)}
      className={cn(
        'w-full flex items-start justify-between p-4 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-100/50 hover:border-slate-300 transition-all text-right',
        className,
      )}
    >
      {content}
    </button>
  );
}

export default function ActionCard({
  title,
  items,
  icon: Icon,
  color = "amber",
  onItemClick,
  maxVisibleItems = DEFAULT_MAX_VISIBLE_ITEMS,
}) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const visibleItems = items.slice(0, maxVisibleItems);
  const hasMoreItems = items.length > maxVisibleItems;

  const colorClasses = {
    amber: "text-amber-700",
    red: "text-red-700",
    blue: "text-blue-700",
    purple: "text-purple-700"
  };

  const badgeColors = {
    amber: "bg-amber-100 text-amber-700 border-amber-200",
    red: "bg-red-100 text-red-700 border-red-200",
    blue: "bg-blue-100 text-blue-700 border-blue-200",
    purple: "bg-purple-100 text-purple-700 border-purple-200"
  };

  const handleItemClick = (item) => {
    if (!onItemClick) return;
    onItemClick(item);
    setIsDialogOpen(false);
  };

  return (
    <>
      <Card className="border-0 bg-white shadow-sm hover:shadow-md transition-all">
        <div className="p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Icon className={cn('w-6 h-6', colorClasses[color])} strokeWidth={1.5} />
              <h3 className="text-xl font-semibold">{title}</h3>
            </div>
            <Badge variant="outline" className={cn('text-sm font-semibold px-3 py-1', badgeColors[color])}>
              {items.length}
            </Badge>
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">הכל מסודר! אין פריטים הדורשים טיפול</p>
          ) : (
            <>
              <div className="space-y-3">
                {visibleItems.map((item, index) => (
                  <ActionCardItem
                    key={item.data?.id || `${item.title}-${index}`}
                    item={item}
                    onItemClick={onItemClick ? handleItemClick : undefined}
                  />
                ))}
              </div>
              {hasMoreItems && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full mt-4"
                  onClick={() => setIsDialogOpen(true)}
                >
                  הצג הכל
                </Button>
              )}
            </>
          )}
        </div>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {items.length} פריטים דורשים טיפול
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 overflow-y-auto pr-1 -mr-1 flex-1">
            {items.map((item, index) => (
              <ActionCardItem
                key={item.data?.id || `${item.title}-${index}`}
                item={item}
                showExtendedDetails
                onItemClick={onItemClick ? handleItemClick : undefined}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
