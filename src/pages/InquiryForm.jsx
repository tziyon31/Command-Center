import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowRight } from 'lucide-react';

const EMPTY_FORM = {
  client_name: '',
  building_type: '',
  area: '',
  cooling_tons: '',
  details: '',
};

const inquiryToForm = (inquiry) => ({
  client_name: inquiry?.client_name || '',
  building_type: inquiry?.building_type || '',
  area: inquiry?.area ?? '',
  cooling_tons: inquiry?.cooling_tons ?? '',
  details: inquiry?.details || '',
});

const toOptionalNumber = (value) => {
  if (value === '' || value === null || value === undefined) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

export default function InquiryForm() {
  const urlParams = new URLSearchParams(window.location.search);
  const inquiryId = urlParams.get('id');
  const isEditMode = Boolean(inquiryId);

  const [formData, setFormData] = useState(EMPTY_FORM);
  const queryClient = useQueryClient();

  const { data: inquiry, isLoading } = useQuery({
    queryKey: ['inquiry', inquiryId],
    queryFn: async () => {
      const results = await base44.entities.Inquiry.filter({ id: inquiryId });
      return results?.[0] || null;
    },
    enabled: isEditMode,
  });

  useEffect(() => {
    if (inquiry) {
      setFormData(inquiryToForm(inquiry));
    }
  }, [inquiry]);

  const saveMutation = useMutation({
    mutationFn: async (payload) => {
      if (isEditMode) {
        return base44.entities.Inquiry.update(inquiryId, payload);
      }

      return base44.entities.Inquiry.create(payload);
    },
    onSuccess: (savedInquiry) => {
      queryClient.invalidateQueries(['inquiries']);

      if (!isEditMode && savedInquiry?.id) {
        window.location.href = createPageUrl(`InquiryForm?id=${savedInquiry.id}`);
      }
    },
  });

  const handleFieldChange = (field, value) => {
    setFormData((current) => ({ ...current, [field]: value }));
  };

  const buildDraftPayload = () => {
    const payload = {
      client_name: formData.client_name.trim(),
      building_type: formData.building_type.trim(),
      details: formData.details.trim(),
      form_status: 'draft',
    };

    const area = toOptionalNumber(formData.area);
    const coolingTons = toOptionalNumber(formData.cooling_tons);

    if (area !== undefined) payload.area = area;
    if (coolingTons !== undefined) payload.cooling_tons = coolingTons;

    return payload;
  };

  const handleSaveDraft = async () => {
    try {
      await saveMutation.mutateAsync(buildDraftPayload());
      alert('הטיוטה נשמרה');
    } catch (error) {
      console.error('[InquiryForm] failed to save draft', error);
      alert('שמירת הטיוטה נכשלה');
    }
  };

  const handleSubmitForm = async () => {
    const clientName = formData.client_name.trim();
    const details = formData.details.trim();

    if (!clientName || !details) {
      alert('יש למלא שם לקוח ופירוט נוסף לפני הגשת הטופס');
      return;
    }

    try {
      await saveMutation.mutateAsync({
        ...buildDraftPayload(),
        client_name: clientName,
        details,
        form_status: 'submitted',
        submitted_at: new Date().toISOString(),
      });

      alert('הטופס הוגש בהצלחה');
      queryClient.invalidateQueries(['inquiry', inquiryId]);
    } catch (error) {
      console.error('[InquiryForm] failed to submit form', error);
      alert('הגשת הטופס נכשלה');
    }
  };

  const isSaving = saveMutation.isPending;
  const isSubmitted = inquiry?.form_status === 'submitted';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50" dir="rtl">
      <div className="max-w-3xl mx-auto px-8 py-10 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {isEditMode ? 'עריכת פנייה' : 'פנייה חדשה'}
            </h1>
            <p className="text-muted-foreground mt-1">טופס פנייה בסיסי</p>
          </div>
          <Link to={createPageUrl('Inquiries')}>
            <Button type="button" variant="outline" className="gap-2">
              <ArrowRight className="w-4 h-4" />
              חזרה לרשימת פניות
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>פרטי הפנייה</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">טוען פנייה...</p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="client_name">שם לקוח</Label>
                  <Input
                    id="client_name"
                    value={formData.client_name}
                    onChange={(event) => handleFieldChange('client_name', event.target.value)}
                    disabled={isSaving}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="building_type">סוג מבנה</Label>
                  <Input
                    id="building_type"
                    value={formData.building_type}
                    onChange={(event) => handleFieldChange('building_type', event.target.value)}
                    disabled={isSaving}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="area">שטח (מ&quot;ר)</Label>
                  <Input
                    id="area"
                    type="number"
                    min="0"
                    value={formData.area}
                    onChange={(event) => handleFieldChange('area', event.target.value)}
                    disabled={isSaving}
                    dir="ltr"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cooling_tons">טון קירור</Label>
                  <Input
                    id="cooling_tons"
                    type="number"
                    min="0"
                    step="0.1"
                    value={formData.cooling_tons}
                    onChange={(event) => handleFieldChange('cooling_tons', event.target.value)}
                    disabled={isSaving}
                    dir="ltr"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="details">פירוט נוסף</Label>
                  <Textarea
                    id="details"
                    rows={5}
                    value={formData.details}
                    onChange={(event) => handleFieldChange('details', event.target.value)}
                    disabled={isSaving}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSaveDraft}
                    disabled={isSaving}
                  >
                    {isSaving ? 'שומר...' : 'שמור טיוטה'}
                  </Button>

                  <Button
                    type="button"
                    onClick={handleSubmitForm}
                    disabled={isSaving || isSubmitted}
                  >
                    הגשת טופס
                  </Button>
                </div>

                {isSubmitted && (
                  <p className="text-xs text-muted-foreground">
                    הפנייה כבר הוגשה. ניתן לערוך ולשמור טיוטה, אך הגשה חוזרת חסומה בשלב זה.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
