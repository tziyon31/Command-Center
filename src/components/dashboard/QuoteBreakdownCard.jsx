import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, XCircle, Clock } from 'lucide-react';

const QUOTE_PERIOD_LABELS = {
  month: 'החודש',
  quarter: 'הרבעון',
  year: 'השנה',
  all: 'הכל',
};

export default function QuoteBreakdownCard({ proposalBreakdown, period = 'year' }) {
  const open = proposalBreakdown?.open || 0;
  const won = proposalBreakdown?.won || 0;
  const lost = proposalBreakdown?.lost || 0;
  const total = proposalBreakdown?.total || 0;

  const pct = (n) => total > 0 ? Math.round((n / total) * 100) : 0;
  const periodLabel = QUOTE_PERIOD_LABELS[period] || QUOTE_PERIOD_LABELS.year;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4">
          <h3 className="font-semibold text-lg">פילוח הצעות מחיר</h3>
          <p className="text-sm text-muted-foreground">{total} הצעות בתקופה: {periodLabel}</p>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="text-sm">ניצחונות (נחתמו)</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-32 bg-muted rounded-full h-2">
                <div className="bg-green-500 h-2 rounded-full" style={{ width: `${pct(won)}%` }} />
              </div>
              <span className="text-sm font-medium w-16 text-left">{won} ({pct(won)}%)</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-500" />
              <span className="text-sm">הפסדים (בוטלו)</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-32 bg-muted rounded-full h-2">
                <div className="bg-red-500 h-2 rounded-full" style={{ width: `${pct(lost)}%` }} />
              </div>
              <span className="text-sm font-medium w-16 text-left">{lost} ({pct(lost)}%)</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-sm">פתוחות (ממתינות)</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-32 bg-muted rounded-full h-2">
                <div className="bg-amber-500 h-2 rounded-full" style={{ width: `${pct(open)}%` }} />
              </div>
              <span className="text-sm font-medium w-16 text-left">{open} ({pct(open)}%)</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}