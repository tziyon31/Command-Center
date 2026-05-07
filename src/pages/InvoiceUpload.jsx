import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, CheckCircle2, AlertCircle, Loader2, FileText, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

const formatMoney = (v) =>
  new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(Number(v) || 0);

export default function InvoiceUpload() {
  const [step, setStep] = useState('upload'); // upload | preview | done
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [extracted, setExtracted] = useState(null); // { invoice_number, date, client_name, items: [{description, amount, project_id?, project_name?}] }
  const [results, setResults] = useState([]); // per-item result after saving
  const queryClient = useQueryClient();

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => base44.entities.Project.list(),
  });

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    setLoadingMsg('מעלה קובץ...');

    const { file_url } = await base44.integrations.Core.UploadFile({ file });

    setLoadingMsg('מחלץ נתונים מהחשבונית...');
    const result = await base44.integrations.Core.ExtractDataFromUploadedFile({
      file_url,
      json_schema: {
        type: 'object',
        properties: {
          invoice_number: { type: 'string', description: 'מספר חשבונית מס קבלה' },
          date: { type: 'string', description: 'תאריך החשבונית בפורמט YYYY-MM-DD' },
          client_name: { type: 'string', description: 'שם החברה המקבלת (לכבוד)' },
          total_before_vat: { type: 'number', description: 'סך לפני מעמ' },
          items: {
            type: 'array',
            description: 'פירוט שורות החשבונית',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string', description: 'תיאור מלא של השורה' },
                amount: { type: 'number', description: 'סה"כ שח של השורה (לפני מעמ)' },
              },
              required: ['description', 'amount'],
            },
          },
        },
        required: ['invoice_number', 'date', 'items'],
      },
    });

    if (result.status !== 'success' || !result.output) {
      alert('שגיאה בחילוץ נתונים מהקובץ');
      setLoading(false);
      return;
    }

    // Match items to projects by name similarity
    const data = result.output;
    const itemsWithProjects = (data.items || [])
      .filter(item => item.amount && item.amount !== 0) // skip rounding rows
      .map(item => {
        const matched = findProject(item.description, projects);
        return { ...item, project: matched || null };
      });

    setExtracted({ ...data, items: itemsWithProjects, file_url });
    setStep('preview');
    setLoading(false);
  };

  const findProject = (description, projects) => {
    if (!description) return null;
    const lower = description.toLowerCase();
    let best = null;
    let bestScore = 0;
    for (const p of projects) {
      const name = (p.name || '').toLowerCase();
      if (name.length < 3) continue;
      if (lower.includes(name)) {
        const score = name.length;
        if (score > bestScore) { best = p; bestScore = score; }
      }
    }
    return best;
  };

  const handleSave = async () => {
    if (!extracted) return;
    setLoading(true);
    setLoadingMsg('שומר חשבוניות ומעדכן פרויקטים...');
    const saveResults = [];

    for (const item of extracted.items) {
      if (!item.project) {
        saveResults.push({ description: item.description, status: 'no_project', amount: item.amount });
        continue;
      }

      // Create Invoice record
      await base44.entities.Invoice.create({
        project_id: item.project.id,
        invoice_number: extracted.invoice_number,
        date: extracted.date,
        due_date: extracted.date,
        status: 'paid',
        amount: item.amount,
        paid_amount: item.amount,
        milestone: item.description,
        file_url: extracted.file_url,
      });

      // Update project collected_amount
      const newCollected = (Number(item.project.collected_amount) || 0) + item.amount;
      const newStatus =
        item.project.total_amount > 0 && newCollected >= item.project.total_amount
          ? 'collection_completed'
          : item.project.status;

      await base44.entities.Project.update(item.project.id, {
        collected_amount: newCollected,
        status: newStatus,
      });

      saveResults.push({
        description: item.description,
        status: 'saved',
        amount: item.amount,
        projectName: item.project.name,
        newStatus,
      });
    }

    queryClient.invalidateQueries(['projects']);
    queryClient.invalidateQueries(['invoices']);
    setResults(saveResults);
    setStep('done');
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to={createPageUrl('Projects')}>
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowRight className="w-4 h-4" />
            פרויקטים
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">העלאת חשבונית</h1>
      </div>

      {/* STEP: Upload */}
      {step === 'upload' && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-8 text-center space-y-4">
            {loading ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
                <p className="text-muted-foreground">{loadingMsg}</p>
              </div>
            ) : (
              <>
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                  <Upload className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold mb-1">העלה חשבונית PDF</h2>
                  <p className="text-sm text-muted-foreground">
                    המערכת תחלץ אוטומטית את הנתונים ותעדכן את הפרויקטים הרלוונטיים
                  </p>
                </div>
                <label className="cursor-pointer">
                  <div className="border-2 border-dashed border-border rounded-xl p-8 hover:bg-slate-50 transition-colors">
                    <p className="text-sm text-muted-foreground">לחץ לבחירת קובץ PDF</p>
                  </div>
                  <input type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
                </label>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP: Preview */}
      {step === 'preview' && extracted && (
        <div className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="w-5 h-5 text-primary" />
                <h2 className="font-bold text-lg">פרטי חשבונית</h2>
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">מספר חשבונית</div>
                  <div className="font-semibold">{extracted.invoice_number}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">תאריך</div>
                  <div className="font-semibold">{extracted.date}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">לכבוד</div>
                  <div className="font-semibold">{extracted.client_name || '-'}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 space-y-3">
              <h2 className="font-bold text-lg">פירוט שורות</h2>
              {extracted.items.map((item, i) => (
                <div key={i} className={`rounded-xl p-4 border ${item.project ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium">{item.description}</p>
                      {item.project ? (
                        <p className="text-xs text-green-700 mt-1">
                          ✓ מזוהה לפרויקט: <strong>{item.project.name}</strong>
                        </p>
                      ) : (
                        <p className="text-xs text-amber-700 mt-1">⚠ לא זוהה פרויקט מתאים</p>
                      )}
                    </div>
                    <div className="text-sm font-bold flex-shrink-0">{formatMoney(item.amount)}</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setStep('upload')}>חזור</Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
              שמור והעדכן פרויקטים
            </Button>
          </div>
        </div>
      )}

      {/* STEP: Done */}
      {step === 'done' && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-8 space-y-4">
            <div className="text-center mb-4">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-2" />
              <h2 className="text-xl font-bold">הסתיים בהצלחה!</h2>
            </div>
            <div className="space-y-2">
              {results.map((r, i) => (
                <div key={i} className={`flex items-center justify-between rounded-lg px-4 py-3 ${r.status === 'saved' ? 'bg-green-50' : 'bg-amber-50'}`}>
                  <div>
                    <p className="text-sm font-medium">{r.description}</p>
                    {r.status === 'saved' ? (
                      <p className="text-xs text-green-700">✓ עודכן: {r.projectName} {r.newStatus === 'collection_completed' ? '· גבייה הושלמה!' : ''}</p>
                    ) : (
                      <p className="text-xs text-amber-700">⚠ לא עודכן - לא נמצא פרויקט</p>
                    )}
                  </div>
                  <span className="text-sm font-bold">{formatMoney(r.amount)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-center gap-3 pt-2">
              <Button variant="outline" onClick={() => { setStep('upload'); setExtracted(null); setResults([]); }}>
                העלה חשבונית נוספת
              </Button>
              <Link to={createPageUrl('Projects')}>
                <Button>חזור לפרויקטים</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}