import React from 'react';
import { Badge } from "@/components/ui/badge";

const statusConfig = {
  // Project statuses
  lead: { label: 'ליד', color: 'bg-slate-100 text-slate-700 border-slate-300' },
  pricing: { label: 'בתמחור', color: 'bg-blue-100 text-blue-700 border-blue-300' },
  signed: { label: 'נחתם', color: 'bg-green-100 text-green-700 border-green-300' },
  planning: { label: 'בתכנון', color: 'bg-purple-100 text-purple-700 border-purple-300' },
  submission: { label: 'בהגשה', color: 'bg-orange-100 text-orange-700 border-orange-300' },
  execution: { label: 'בביצוע', color: 'bg-indigo-100 text-indigo-700 border-indigo-300' },
  completed: { label: 'הושלם', color: 'bg-teal-100 text-teal-700 border-teal-300' },
  collection_completed: { label: 'גבייה הושלמה', color: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  
  // Quote statuses
  draft: { label: 'טיוטה', color: 'bg-slate-100 text-slate-700 border-slate-300' },
  sent: { label: 'נשלחה', color: 'bg-blue-100 text-blue-700 border-blue-300' },
  pending: { label: 'ממתין', color: 'bg-amber-100 text-amber-700 border-amber-300' },
  negotiation: { label: 'במשא ומתן', color: 'bg-orange-100 text-orange-700 border-orange-300' },
  cancelled: { label: 'בוטלה', color: 'bg-red-100 text-red-700 border-red-300' },
  
  // Invoice statuses
  created: { label: 'נוצר', color: 'bg-slate-100 text-slate-700 border-slate-300' },
  viewed: { label: 'נצפה', color: 'bg-blue-100 text-blue-700 border-blue-300' },
  partial: { label: 'שולם חלקית', color: 'bg-amber-100 text-amber-700 border-amber-300' },
  paid: { label: 'שולם', color: 'bg-green-100 text-green-700 border-green-300' },
  
  // Task statuses
  in_progress: { label: 'בביצוע', color: 'bg-blue-100 text-blue-700 border-blue-300' },
  
  // Priority
  low: { label: 'נמוכה', color: 'bg-slate-100 text-slate-700 border-slate-300' },
  medium: { label: 'בינונית', color: 'bg-amber-100 text-amber-700 border-amber-300' },
  high: { label: 'גבוהה', color: 'bg-red-100 text-red-700 border-red-300' },
  
  // Rating
  A: { label: 'A', color: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  B: { label: 'B', color: 'bg-blue-100 text-blue-700 border-blue-300' },
  C: { label: 'C', color: 'bg-slate-100 text-slate-700 border-slate-300' },
};

export default function StatusBadge({ status, className = '' }) {
  const config = statusConfig[status] || { label: status, color: 'bg-slate-100 text-slate-700 border-slate-300' };
  
  return (
    <Badge className={`${config.color} border ${className}`}>
      {config.label}
    </Badge>
  );
}