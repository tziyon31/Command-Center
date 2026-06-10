import React from 'react';
import { ADMIN_ACCESS_DENIED_MESSAGE } from '@/lib/adminAccess';

export default function AdminAccessDenied() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16" dir="rtl">
      <p className="text-muted-foreground">{ADMIN_ACCESS_DENIED_MESSAGE}</p>
    </div>
  );
}
