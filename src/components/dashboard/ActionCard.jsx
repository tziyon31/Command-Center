import React from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from 'lucide-react';

export default function ActionCard({ title, items, icon: Icon, color = "amber", onItemClick }) {
  const colorClasses = {
    amber: "bg-amber-50 text-amber-900 border-amber-200",
    red: "bg-red-50 text-red-900 border-red-200",
    blue: "bg-blue-50 text-blue-900 border-blue-200",
    purple: "bg-purple-50 text-purple-900 border-purple-200"
  };

  const badgeColors = {
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
    blue: "bg-blue-100 text-blue-700",
    purple: "bg-purple-100 text-purple-700"
  };

  return (
    <Card className={`border-2 ${colorClasses[color]}`}>
      <CardContent className="p-0">
        <div className={`p-4 border-b ${colorClasses[color]}`}>
          <div className="flex items-center gap-2">
            <Icon className="w-5 h-5" />
            <h3 className="font-bold text-lg">{title}</h3>
            {items.length > 0 && (
              <span className={`text-xs font-bold px-2 py-1 rounded-full ${badgeColors[color]}`}>
                {items.length}
              </span>
            )}
          </div>
        </div>
        <div className="p-4 space-y-2">
          {items.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">הכל בסדר! 👍</p>
          ) : (
            items.slice(0, 5).map((item, index) => (
              <div
                key={index}
                onClick={() => onItemClick && onItemClick(item)}
                className="flex items-center justify-between p-3 bg-background rounded-lg border hover:border-primary transition-colors cursor-pointer"
              >
                <div className="flex-1">
                  <p className="font-medium">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.subtitle}</p>
                </div>
                <ChevronLeft className="w-5 h-5 text-muted-foreground" />
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}