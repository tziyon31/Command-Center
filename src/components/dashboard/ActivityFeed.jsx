import React from 'react';
import { Card } from "@/components/ui/card";
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

export default function ActivityFeed({ activities }) {
  const getActivityIcon = (type) => {
    const icons = {
      lead: '🎯',
      quote: '📋',
      signed: '✅',
      completed: '🎉',
      payment: '💰'
    };
    return icons[type] || '📌';
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight mb-2">תנועה עסקית</h2>
        <p className="text-muted-foreground">אירועים ופעילויות אחרונות</p>
      </div>
      <Card className="border-0 bg-white shadow-sm">
        <div className="p-8">
          {activities.length === 0 ? (
            <p className="text-muted-foreground text-center py-12">אין פעילות עסקית אחרונה</p>
          ) : (
            <div className="space-y-4">
              {activities.map((activity, index) => (
                <div key={index} className="flex items-start gap-4 p-5 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors border border-slate-100">
                  <div className="text-2xl">{getActivityIcon(activity.type)}</div>
                  <div className="flex-1">
                    <div className="font-semibold text-sm mb-1">{activity.title}</div>
                    <div className="text-sm text-muted-foreground">{activity.description}</div>
                    <div className="text-xs text-muted-foreground/70 mt-2">
                      {format(new Date(activity.date), 'dd MMM yyyy, HH:mm', { locale: he })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}