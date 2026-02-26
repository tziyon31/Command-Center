import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from 'lucide-react';

export default function BusinessHealthCard({ title, value, subtitle, trend, icon: Icon, color = "primary" }) {
  const colorClasses = {
    primary: "bg-primary/5 text-primary border-primary/20",
    green: "bg-emerald-500/5 text-emerald-600 border-emerald-500/20",
    blue: "bg-blue-500/5 text-blue-600 border-blue-500/20",
    amber: "bg-amber-500/5 text-amber-600 border-amber-500/20",
    red: "bg-red-500/5 text-red-600 border-red-500/20"
  };

  return (
    <Card className={`border-2 ${colorClasses[color]}`}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl ${colorClasses[color]} flex items-center justify-center`}>
              <Icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">{title}</p>
            </div>
          </div>
          {trend !== undefined && (
            <div className={`flex items-center gap-1 ${trend >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {trend >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              <span className="text-xs font-semibold">{Math.abs(trend)}%</span>
            </div>
          )}
        </div>
        <div>
          <h3 className="text-4xl font-bold mb-1">{value}</h3>
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}