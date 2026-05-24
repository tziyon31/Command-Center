import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ArrowRight } from 'lucide-react';
import {
  deleteInquiry,
  INQUIRY_DELETE_CONFIRM_MESSAGE,
} from '@/lib/inquiryDelete';
import {
  buildInquiryCopyText,
  copyTextToClipboard,
  formatCopiedAt,
} from '@/lib/inquiryCopy';
import { runInquiryReminderRulesForInquiry } from '@/lib/inquiryReminderRules';
import {
  findClientBySourceInquiryId,
  findProjectBySourceInquiryId,
  loadInquiryById,
  openOrCreateClientFromInquiry,
  openOrCreateProjectFromInquiry,
} from '@/lib/inquiryContinuation';

const AUTOSAVE_DEBOUNCE_MS = 1000;

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

const buildFieldSnapshot = (data) => {
  const area = toOptionalNumber(data.area);
  const coolingTons = toOptionalNumber(data.cooling_tons);

  return {
    client_name: (data.client_name || '').trim(),
    building_type: (data.building_type || '').trim(),
    details: (data.details || '').trim(),
    area: area ?? null,
    cooling_tons: coolingTons ?? null,
  };
};

const snapshotsEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const buildAutosavePayload = (data, { isSubmitted }) => {
  const snapshot = buildFieldSnapshot(data);
  const payload = {
    client_name: snapshot.client_name,
    building_type: snapshot.building_type,
    details: snapshot.details,
  };

  if (snapshot.area !== null) payload.area = snapshot.area;
  if (snapshot.cooling_tons !== null) payload.cooling_tons = snapshot.cooling_tons;

  if (!isSubmitted) {
    payload.form_status = 'draft';
  }

  return payload;
};

const syncInquiryReminderRules = async (inquiryId) => {
  if (!inquiryId) return;

  try {
    const results = await base44.entities.Inquiry.filter({ id: inquiryId });
    const inquiry = results?.[0];

    if (inquiry) {
      await runInquiryReminderRulesForInquiry(inquiry);
    }
  } catch (error) {
    console.error('[InquiryForm] failed to run inquiry reminder rules', error);
  }
};

const SAVE_STATUS_LABELS = {
  idle: null,
  saving: 'שומר...',
  saved: 'נשמר',
  error: 'השמירה נכשלה',
};

export default function InquiryForm() {
  const urlParams = new URLSearchParams(window.location.search);
  const initialInquiryId = urlParams.get('id');

  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState(EMPTY_FORM);
  const [currentInquiryId, setCurrentInquiryId] = useState(initialInquiryId);
  const [formStatus, setFormStatus] = useState(null);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copiedToAiAt, setCopiedToAiAt] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState(null);
  const [isOpeningClient, setIsOpeningClient] = useState(false);
  const [isOpeningProject, setIsOpeningProject] = useState(false);

  const lastSavedSnapshotRef = useRef(buildFieldSnapshot(EMPTY_FORM));
  const skipAutosaveRef = useRef(false);
  const saveDraftNowRef = useRef(null);
  const currentInquiryIdRef = useRef(initialInquiryId);
  const saveInFlightRef = useRef(false);
  const createInFlightRef = useRef(false);

  useEffect(() => {
    currentInquiryIdRef.current = currentInquiryId;
  }, [currentInquiryId]);

  const isEditMode = Boolean(currentInquiryId);

  const { data: inquiry, isLoading } = useQuery({
    queryKey: ['inquiry', currentInquiryId],
    queryFn: async () => {
      const results = await base44.entities.Inquiry.filter({ id: currentInquiryId });
      return results?.[0] || null;
    },
    enabled: isEditMode,
  });

  const { data: linkedClient = null } = useQuery({
    queryKey: ['client-by-inquiry', currentInquiryId],
    queryFn: () => findClientBySourceInquiryId(currentInquiryId),
    enabled: Boolean(currentInquiryId),
  });

  const { data: linkedProject = null } = useQuery({
    queryKey: ['project-by-inquiry', currentInquiryId],
    queryFn: () => findProjectBySourceInquiryId(currentInquiryId),
    enabled: Boolean(currentInquiryId),
  });

  useEffect(() => {
    if (!inquiry) return;

    const nextForm = inquiryToForm(inquiry);
    setFormData(nextForm);
    lastSavedSnapshotRef.current = buildFieldSnapshot(nextForm);
    setFormStatus(inquiry.form_status || 'draft');
    setCopiedToAiAt(inquiry.copied_to_ai_at || null);
    skipAutosaveRef.current = true;
  }, [inquiry]);

  const waitForSaveToFinish = async () => {
    const maxAttempts = 200;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (!saveInFlightRef.current && !createInFlightRef.current) {
        return;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }

    throw new Error('Timed out waiting for draft save');
  };

  const saveDraftNow = useCallback(
    async ({ isManual = false, forceSave = false } = {}) => {
      if (isSubmitting) return currentInquiryIdRef.current;
      if (saveInFlightRef.current) {
        await waitForSaveToFinish();
        return currentInquiryIdRef.current;
      }

      const snapshot = buildFieldSnapshot(formData);
      const inquiryId = currentInquiryIdRef.current;

      if (!forceSave && snapshotsEqual(snapshot, lastSavedSnapshotRef.current)) {
        return inquiryId;
      }

      if (!inquiryId && !forceSave && snapshotsEqual(snapshot, buildFieldSnapshot(EMPTY_FORM))) {
        return null;
      }

      const isSubmitted = formStatus === 'submitted';
      const payload = buildAutosavePayload(formData, { isSubmitted });

      if (!inquiryId && createInFlightRef.current) {
        await waitForSaveToFinish();
        return currentInquiryIdRef.current;
      }

      saveInFlightRef.current = true;
      setSaveStatus('saving');

      try {
        let savedInquiry;
        let resolvedInquiryId = inquiryId;

        if (inquiryId) {
          savedInquiry = await base44.entities.Inquiry.update(inquiryId, payload);
        } else {
          createInFlightRef.current = true;
          savedInquiry = await base44.entities.Inquiry.create(payload);
          const newId = savedInquiry?.id;

          if (newId) {
            currentInquiryIdRef.current = newId;
            resolvedInquiryId = newId;
            setCurrentInquiryId(newId);
            setFormStatus('draft');
            navigate(createPageUrl(`InquiryForm?id=${newId}`), { replace: true });
          }
        }

        lastSavedSnapshotRef.current = snapshot;
        setSaveStatus('saved');
        queryClient.invalidateQueries(['inquiries']);

        if (resolvedInquiryId) {
          queryClient.invalidateQueries(['inquiry', resolvedInquiryId]);
        }

        if (isManual) {
          alert('הטיוטה נשמרה');
        }

        await syncInquiryReminderRules(resolvedInquiryId);

        return resolvedInquiryId;
      } catch (error) {
        console.error('[InquiryForm] failed to save draft', error);
        setSaveStatus('error');

        if (isManual) {
          alert('שמירת הטיוטה נכשלה');
        }

        throw error;
      } finally {
        saveInFlightRef.current = false;
        createInFlightRef.current = false;
      }
    },
    [
      formData,
      formStatus,
      isSubmitting,
      navigate,
      queryClient,
    ],
  );

  saveDraftNowRef.current = saveDraftNow;

  useEffect(() => {
    if (isLoading || isSubmitting) return;

    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      saveDraftNowRef.current?.();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [formData, isLoading, isSubmitting]);

  const handleFieldChange = (field, value) => {
    setFormData((current) => ({ ...current, [field]: value }));
    if (saveStatus === 'saved' || saveStatus === 'error') {
      setSaveStatus('idle');
    }
  };

  const handleSaveDraft = () => {
    saveDraftNow({ isManual: true });
  };

  const ensureInquirySavedForCopy = async () => {
    await waitForSaveToFinish();

    let inquiryId = currentInquiryIdRef.current;

    if (!inquiryId) {
      inquiryId = await saveDraftNow({ forceSave: true });
    } else {
      const snapshot = buildFieldSnapshot(formData);
      if (!snapshotsEqual(snapshot, lastSavedSnapshotRef.current)) {
        inquiryId = await saveDraftNow();
      }
    }

    return inquiryId;
  };

  const prepareInquiryForContinuation = async () => {
    const clientName = formData.client_name.trim();

    if (!clientName) {
      return { error: 'client_name' };
    }

    let inquiryId = currentInquiryIdRef.current;

    if (!inquiryId) {
      inquiryId = await saveDraftNow({ forceSave: true });
    }

    if (!inquiryId) {
      return { error: 'no_inquiry_id' };
    }

    const loadedInquiry = await loadInquiryById(inquiryId);

    if (!loadedInquiry) {
      return { error: 'inquiry_not_found' };
    }

    return { inquiry: loadedInquiry };
  };

  const handleOpenClientFromInquiry = async () => {
    setIsOpeningClient(true);

    try {
      const prepared = await prepareInquiryForContinuation();

      if (prepared.error === 'client_name') {
        alert('יש למלא שם לקוח לפני פתיחת לקוח');
        return;
      }

      if (prepared.error) {
        alert('לא הצלחנו לטעון את הפנייה. נסה לשמור טיוטה ולנסות שוב.');
        return;
      }

      const { client, created } = await openOrCreateClientFromInquiry(prepared.inquiry);

      queryClient.invalidateQueries({ queryKey: ['client-by-inquiry', prepared.inquiry.id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });

      if (client?.id) {
        if (created) {
          alert('הלקוח נוצר בהצלחה');
        }
        navigate(createPageUrl(`ClientDetails?id=${client.id}`));
        return;
      }

      alert('הלקוח נוצר');
      navigate(createPageUrl('Clients'));
    } catch (error) {
      console.error('[InquiryForm] failed to open client from inquiry', error);
      alert('לא הצלחנו לפתוח או ליצור לקוח מהפנייה');
    } finally {
      setIsOpeningClient(false);
    }
  };

  const handleOpenProjectFromInquiry = async () => {
    setIsOpeningProject(true);

    try {
      const prepared = await prepareInquiryForContinuation();

      if (prepared.error === 'client_name') {
        alert('יש למלא שם לקוח לפני פתיחת פרויקט');
        return;
      }

      if (prepared.error) {
        alert('לא הצלחנו לטעון את הפנייה. נסה לשמור טיוטה ולנסות שוב.');
        return;
      }

      const {
        project,
        createdProject,
        createdClient,
      } = await openOrCreateProjectFromInquiry(prepared.inquiry);

      queryClient.invalidateQueries({ queryKey: ['project-by-inquiry', prepared.inquiry.id] });
      queryClient.invalidateQueries({ queryKey: ['client-by-inquiry', prepared.inquiry.id] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });

      if (project?.id) {
        if (createdProject || createdClient) {
          alert('הפרויקט נוצר בהצלחה');
        }
        navigate(createPageUrl(`ProjectDetails?id=${project.id}`));
        return;
      }

      alert('הפרויקט נוצר');
      navigate(createPageUrl('Projects'));
    } catch (error) {
      console.error('[InquiryForm] failed to open project from inquiry', error);
      alert('לא הצלחנו לפתוח או ליצור פרויקט מהפנייה');
    } finally {
      setIsOpeningProject(false);
    }
  };

  const handleCopyInquiry = async () => {
    setIsCopying(true);
    setCopyFeedback(null);

    try {
      const inquiryId = await ensureInquirySavedForCopy();

      if (!inquiryId) {
        throw new Error('Inquiry was not saved before copy');
      }

      const text = buildInquiryCopyText(formData);
      await copyTextToClipboard(text);

      const copiedAt = new Date().toISOString();
      await base44.entities.Inquiry.update(inquiryId, { copied_to_ai_at: copiedAt });

      setCopiedToAiAt(copiedAt);
      setCopyFeedback('הפנייה הועתקה ללוח');
      queryClient.invalidateQueries({ queryKey: ['inquiries'] });
      queryClient.invalidateQueries({ queryKey: ['inquiry', inquiryId] });
    } catch (error) {
      console.error('[InquiryForm] failed to copy inquiry', error);
      alert('לא הצלחתי להעתיק את הפנייה');
    } finally {
      setIsCopying(false);
    }
  };

  const handleDeleteInquiry = async () => {
    const inquiryId = currentInquiryIdRef.current;
    if (!inquiryId) return;

    const confirmed = window.confirm(INQUIRY_DELETE_CONFIRM_MESSAGE);
    if (!confirmed) return;

    setIsDeleting(true);

    try {
      await deleteInquiry(inquiryId);
      queryClient.invalidateQueries({ queryKey: ['inquiries'] });
      queryClient.removeQueries({ queryKey: ['inquiry', inquiryId] });
      navigate(createPageUrl('Inquiries'));
    } catch (error) {
      console.error('[Inquiry] failed to delete inquiry', error);
      alert('לא הצלחתי למחוק את הפנייה');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSubmitForm = async () => {
    const clientName = formData.client_name.trim();
    const details = formData.details.trim();

    if (!clientName || !details) {
      alert('יש למלא שם לקוח ופירוט נוסף לפני הגשת הטופס');
      return;
    }

    setIsSubmitting(true);
    setSaveStatus('saving');

    try {
      const snapshot = buildFieldSnapshot(formData);
      const payload = {
        ...buildAutosavePayload(formData, { isSubmitted: false }),
        client_name: clientName,
        details,
        form_status: 'submitted',
        submitted_at: new Date().toISOString(),
      };

      let savedInquiry;
      const inquiryId = currentInquiryIdRef.current;

      if (inquiryId) {
        savedInquiry = await base44.entities.Inquiry.update(inquiryId, payload);
      } else {
        createInFlightRef.current = true;
        savedInquiry = await base44.entities.Inquiry.create(payload);
        const newId = savedInquiry?.id;

        if (newId) {
          currentInquiryIdRef.current = newId;
          setCurrentInquiryId(newId);
          navigate(createPageUrl(`InquiryForm?id=${newId}`), { replace: true });
        }
      }

      lastSavedSnapshotRef.current = snapshot;
      setFormStatus('submitted');
      setSaveStatus('saved');
      queryClient.invalidateQueries(['inquiries']);
      const submittedInquiryId = inquiryId || savedInquiry?.id;
      queryClient.invalidateQueries(['inquiry', submittedInquiryId]);

      await syncInquiryReminderRules(submittedInquiryId);

      alert('הטופס הוגש בהצלחה');
    } catch (error) {
      console.error('[InquiryForm] failed to submit form', error);
      setSaveStatus('error');
      alert('הגשת הטופס נכשלה');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSaving =
    saveStatus === 'saving' ||
    isSubmitting ||
    isDeleting ||
    isCopying ||
    isOpeningClient ||
    isOpeningProject;
  const isSubmitted = formStatus === 'submitted';
  const saveStatusLabel = SAVE_STATUS_LABELS[saveStatus];
  const copiedAtLabel = formatCopiedAt(copiedToAiAt);

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
            {copiedAtLabel && (
              <p className="text-xs text-muted-foreground mt-1">
                הועתק לאחרונה: {copiedAtLabel}
              </p>
            )}
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

                <div className="rounded-md border p-4 space-y-3">
                  <h3 className="text-sm font-semibold">המשך טיפול</h3>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {linkedClient && <span>לקוח נוצר</span>}
                    {linkedProject && <span>פרויקט נוצר</span>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleOpenClientFromInquiry}
                      disabled={isSaving}
                    >
                      {isOpeningClient
                        ? 'פותח לקוח...'
                        : linkedClient
                          ? 'פתח לקוח'
                          : 'פתח לקוח מהפנייה'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleOpenProjectFromInquiry}
                      disabled={isSaving}
                    >
                      {isOpeningProject
                        ? 'פותח פרויקט...'
                        : linkedProject
                          ? 'פתח פרויקט'
                          : 'פתח פרויקט מהפנייה'}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSaveDraft}
                    disabled={isSaving}
                  >
                    שמור טיוטה
                  </Button>

                  <Button
                    type="button"
                    onClick={handleSubmitForm}
                    disabled={isSaving || isSubmitted}
                  >
                    הגשת טופס
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleCopyInquiry}
                    disabled={isSaving}
                  >
                    {isCopying ? 'מעתיק...' : 'העתק'}
                  </Button>

                  {currentInquiryId && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={handleDeleteInquiry}
                      disabled={isSaving}
                    >
                      {isDeleting ? 'מוחק...' : 'מחק פנייה'}
                    </Button>
                  )}

                  {copyFeedback && (
                    <span className="text-sm text-muted-foreground" aria-live="polite">
                      {copyFeedback}
                    </span>
                  )}

                  {saveStatusLabel && (
                    <span
                      className={`text-sm ${
                        saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'
                      }`}
                      aria-live="polite"
                    >
                      {saveStatusLabel}
                    </span>
                  )}
                </div>

                {isSubmitted && (
                  <p className="text-xs text-muted-foreground">
                    הפנייה כבר הוגשה. ניתן לערוך ולשמור שינויים, אך הגשה חוזרת חסומה בשלב זה.
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
