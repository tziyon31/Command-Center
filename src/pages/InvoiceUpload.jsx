import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight } from 'lucide-react';

/* Migration 0.3: Invoice upload via base44.integrations.Core — disabled until self-hosted backend
import React, { useState } from 'react';
import { api as base44 } from '@/api/apiClient';
... (full original in git history)
*/

export default function InvoiceUpload() {
  return (
    <div className="min-h-screen bg-slate-50 p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <Link to={createPageUrl('Dashboard')}>
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowRight className="w-4 h-4" />
            חזרה לדשבורד
          </Button>
        </Link>
        <Link to={createPageUrl('Projects')}>
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowRight className="w-4 h-4" />
            פרויקטים
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">העלאת חשבונית</h1>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-8 text-center">
          <p className="text-lg font-medium text-muted-foreground">לא זמין עדיין</p>
          <p className="text-sm text-muted-foreground mt-2">
            העלאת חשבוניות תופעל לאחר המיגרציה ל-backend עצמאי.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
