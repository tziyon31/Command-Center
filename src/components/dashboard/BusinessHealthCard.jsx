import React from 'react';
import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from "@/lib/utils";

export default function BusinessHealthCard({ title, value, subtitle, trend, icon: Icon, color = "primary" }) {
  const colorClasses = {
    primary: "text-primary",
    green: "text-emerald-600",
    blue: "text-blue-600",
    amber: "text-amber-600",
    red: "text-red-600"
  };

  return (
    <Card className="border-0 bg-white shadow-sm hover:shadow-md transition-all">
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <Icon className={cn('w-7 h-7', colorClasses[color])} strokeWidth={1.5} />
          {trend !== undefined && (
            <div className={cn(
              'flex items-center gap-1 text-sm font-semibold px-2 py-1 rounded-full',
              trend >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            )}>
              {trend >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {Math.abs(trend)}%
            </div>
          )}
        </div>
        <div>
          <div className="text-sm font-medium text-muted-foreground mb-2">{title}</div>
          <div className="text-4xl font-bold tracking-tight mb-1">{value}</div>
          {subtitle && <div className="text-xs text-muted-foreground/80 mt-2">{subtitle}</div>}
        </div>
      </div>
    </Card>
  );
}