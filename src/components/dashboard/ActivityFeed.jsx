import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Clock } from 'lucide-react';
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
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Clock className="w-5 h-5" />
          תנועה עסקית
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {activities.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">אין פעילות עדיין</p>
        ) : (
          <div className="space-y-4">
            {activities.map((activity, index) => (
              <div key={index} className="flex items-start gap-3 pb-4 border-b last:border-0 last:pb-0">
                <div className="text-2xl mt-1">{getActivityIcon(activity.type)}</div>
                <div className="flex-1">
                  <p className="font-medium">{activity.title}</p>
                  <p className="text-sm text-muted-foreground">{activity.description}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(new Date(activity.date), 'dd/MM/yyyy HH:mm', { locale: he })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}