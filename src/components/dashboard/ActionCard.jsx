import React from 'react';
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft } from 'lucide-react';
import { cn } from "@/lib/utils";

export default function ActionCard({ title, items, icon: Icon, color = "amber", onItemClick }) {
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

  return (
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
          <div className="space-y-3">
            {items.slice(0, 5).map((item, index) => (
              <button
                key={index}
                onClick={() => onItemClick && onItemClick(item)}
                className="w-full flex items-start justify-between p-4 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-100/50 hover:border-slate-300 transition-all text-right"
              >
                <div className="flex-1">
                  <div className="font-medium text-sm mb-1">{item.title}</div>
                  <div className="text-xs text-muted-foreground">{item.subtitle}</div>
                </div>
                <ChevronLeft className="w-4 h-4 text-muted-foreground mr-2 mt-1 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}