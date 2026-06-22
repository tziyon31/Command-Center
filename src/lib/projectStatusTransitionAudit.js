/**
 * P2F — Legacy Project Status Transition Audit (read-only).
 *
 * This is a STATIC CODE AUDIT: the findings below were produced by reading the
 * source code (file + line references included). The function performs no
 * entity reads and no mutations of any kind. It only returns the audit data.
 *
 * Audit snapshot date: 2026-06-09 (commit a522c57 baseline).
 * If the codebase changes, re-run the code search and update this file.
 */

export const PROJECT_STATUS_VALUES = [
  'lead',
  'pricing',
  'waiting',
  'signed',
  'planning',
  'submission',
  'execution',
  'completed',
  'collection_completed',
  'rejected',
  'cancelled',
];

/**
 * Every location in the codebase where Project.create is called.
 * All production create paths default status to 'pricing'
 * (EMPTY_PROJECT_FORM / getNextProjectDefaults in projectDefaults.js).
 */
const PROJECT_CREATE_LOCATIONS = [
  {
    file: 'src/pages/ProjectDetails.jsx',
    line: 375,
    caller: 'handleSaveProjectCreate',
    trigger: 'UI — טופס יצירת פרויקט (create mode)',
    statusWritten: "form value, default 'pricing'",
    automatic: false,
    notes: 'Payload via buildProjectCreatePayloadFromForm; status comes from the form Select.',
  },
  {
    file: 'src/pages/ProjectPipeline.jsx',
    line: 568,
    caller: 'CreateProjectDialog',
    trigger: 'UI — דף פרויקטים, יצירה',
    statusWritten: "form value, default 'pricing'",
    automatic: false,
    notes: 'Same payload builder; runs client + P2 reminder rules after create.',
  },
  {
    file: 'src/components/workflow/CreateProjectDialog.jsx',
    line: 87,
    caller: 'handleSubmit',
    trigger: 'UI — דיאלוג יצירת פרויקט בתהליך workflow',
    statusWritten: "form value, default 'pricing'",
    automatic: false,
    notes: 'Can be overridden by onCreateProject prop (see SignedProposalForm).',
  },
  {
    file: 'src/pages/SignedProposalForm.jsx',
    line: 632,
    caller: 'CreateProjectDialog onCreateProject',
    trigger: 'UI — יצירת פרויקט מתוך טופס הצעה חתומה',
    statusWritten: "form value, default 'pricing' — NOT 'signed'",
    automatic: false,
    notes: 'Adds source_signed_proposal_id, but does NOT set status to signed. Project created from a signed proposal still starts as pricing unless changed manually.',
  },
  {
    file: 'src/lib/reminderTestRunner.js',
    line: 1450,
    caller: 'createTestProjectWithClient',
    trigger: 'Test runner only (admin/local dev)',
    statusWritten: "'pricing' (test data)",
    automatic: false,
    notes: 'Test-only path; not part of the production flow.',
  },
];

/**
 * Every location in the codebase where Project.update is called,
 * with whether the payload includes the status field.
 */
const PROJECT_UPDATE_LOCATIONS = [
  {
    file: 'src/pages/ProjectDetails.jsx',
    line: 427,
    caller: 'handleSaveProjectEdit → buildProjectUpdatePayload',
    trigger: 'UI — דיאלוג עריכת פרויקט',
    writesStatus: true,
    statusWritten: 'any of the 11 status values, chosen manually in a Select (lines 1139-1156)',
    automatic: false,
    notes: 'THE primary (and almost only) status transition mechanism. buildProjectUpdatePayload (line 175) always includes status: formData.status.',
  },
  {
    file: 'src/pages/InvoiceUpload.jsx',
    line: 130,
    caller: 'save flow after invoice upload',
    trigger: 'UI — העלאת חשבונית; חישוב אוטומטי',
    writesStatus: true,
    statusWritten: "'collection_completed' when collected_amount >= total_amount, otherwise keeps current status",
    automatic: true,
    notes: 'The ONLY automatic status transition in the codebase (lines 124-133).',
  },
  {
    file: 'src/pages/ProjectDetails.jsx',
    line: 706,
    caller: 'handleSaveCollectionDue (legacy)',
    trigger: 'UI — שמירת גבייה legacy',
    writesStatus: false,
    statusWritten: '—',
    automatic: false,
    notes: 'Writes legacy collection_due_* fields only.',
  },
  {
    file: 'src/pages/ProjectDetails.jsx',
    line: 743,
    caller: 'handleMarkCollectionPaid (legacy)',
    trigger: 'UI — סימון גבייה כשולמה legacy',
    writesStatus: false,
    statusWritten: '—',
    automatic: false,
    notes: 'Writes collected_amount + clears legacy collection fields; does NOT touch status.',
  },
  {
    file: 'src/pages/ProjectDetails.jsx',
    line: 776,
    caller: 'handleCancelCollectionDue (legacy)',
    trigger: 'UI — ביטול גבייה legacy',
    writesStatus: false,
    statusWritten: '—',
    automatic: false,
    notes: 'Clears legacy collection fields only.',
  },
  {
    file: 'src/components/workflow/ProjectConstructionStatusSection.jsx',
    line: 68,
    caller: 'construction status save',
    trigger: 'UI — עדכון סטטוס בנייה',
    writesStatus: false,
    statusWritten: '—',
    automatic: false,
    notes: 'Writes construction_status / construction_status_note / construction_status_updated_at only.',
  },
  {
    file: 'src/lib/collectionDueUtils.js',
    line: 296,
    caller: 'syncProjectLegacyCollectionFields',
    trigger: 'אוטומטי — סנכרון שדות גבייה legacy אחרי שינוי CollectionDue',
    writesStatus: false,
    statusWritten: '—',
    automatic: true,
    notes: 'buildProjectLegacyCollectionPayload (line 189) builds collection_due_* / last_collection_paid_on only. No status.',
  },
  {
    file: 'src/lib/signedProposalLifecycle.js',
    line: 27,
    caller: 'clearProjectSourceSignedProposalLinks',
    trigger: 'אוטומטי — מחיקה/ביטול הצעה חתומה',
    writesStatus: false,
    statusWritten: '—',
    automatic: true,
    notes: 'Clears source_signed_proposal_id only.',
  },
  {
    file: 'src/lib/signedProposalLifecycle.js',
    line: 55,
    caller: 'linkProjectToValidSignedProposal',
    trigger: 'אוטומטי — קישור הצעה חתומה תקינה לפרויקט',
    writesStatus: false,
    statusWritten: '—',
    automatic: true,
    notes: 'Sets source_signed_proposal_id only. Does NOT move project to signed — a key legacy gap.',
  },
  {
    file: 'src/lib/reminderTestRunner.js',
    line: 1466,
    caller: 'update_project (test)',
    trigger: 'Test runner only (admin/local dev)',
    writesStatus: true,
    statusWritten: 'test patches (e.g. cancelled)',
    automatic: false,
    notes: 'Test-only path.',
  },
];

/**
 * How Proposal / SignedProposal / Quote / CollectionDue flows relate to
 * Project.status writes.
 */
const PROPOSAL_RELATED_STATUS_WRITES = [
  {
    entity: 'Proposal',
    writesProjectStatus: false,
    detail: 'No code path updates Project.status when a Proposal is created/sent/seen. Proposal flows only run reminder rules (proposalReminderRules.js).',
  },
];

const SIGNED_PROPOSAL_RELATED_STATUS_WRITES = [
  {
    entity: 'SignedProposal',
    writesProjectStatus: false,
    detail: 'linkProjectToValidSignedProposal (signedProposalLifecycle.js:49-60) writes source_signed_proposal_id only. Creating/validating a signed proposal does NOT move Project.status to signed — the user must do it manually in the ProjectDetails edit dialog.',
  },
  {
    entity: 'Quote',
    writesProjectStatus: false,
    detail: 'No Project.status writes found from any Quote flow. Quote is only read (Dashboard.jsx:138, projectLifecycleAlignmentAudit.js).',
  },
  {
    entity: 'CollectionDue',
    writesProjectStatus: false,
    detail: 'syncProjectLegacyCollectionFields (collectionDueUtils.js:285-297) writes legacy collection_due_* mirror fields only. Closing a CollectionDue does NOT set collection_completed.',
  },
  {
    entity: 'Invoice (legacy InvoiceUpload)',
    writesProjectStatus: true,
    detail: "InvoiceUpload.jsx:124-133 — the only automatic Project.status write: sets 'collection_completed' when collected_amount reaches total_amount.",
  },
];

/**
 * Reminder rules that create the four condition_key families, and whether
 * they depend on Project.status.
 */
const REMINDER_RULES_DEPENDING_ON_PROJECT_STATUS = [
  {
    conditionKeyPrefix: 'project_needs_proposal:',
    rule: 'P2 — runP2ReminderRuleForProject',
    file: 'src/lib/proposalReminderRules.js',
    lines: '140-144, 508-571',
    dependsOnProjectStatus: true,
    statusDependency: "Eligible unless status === 'cancelled' (INACTIVE_PROJECT_STATUSES, line 23). Reminder is resolved only when a Proposal/SignedProposal RECORD exists — NOT when status moves to waiting/signed/execution/completed.",
    riskNote: 'Root cause of the stale reminders found in P2E: a manual status change beyond pricing without creating a Proposal/SignedProposal record leaves the reminder active.',
  },
  {
    conditionKeyPrefix: 'signed_proposal_needs_work_stages:',
    rule: 'R7 — runSignedProposalNeedReminderRule (workStageReminderRules.js:283+)',
    file: 'src/lib/workStageReminderRules.js',
    lines: '21-29, 270-300',
    dependsOnProjectStatus: false,
    statusDependency: 'Depends on SignedProposal validity (form_status, has_signed_offer_or_order) and existence of non-cancelled WorkStages. Does not read Project.status at all.',
    riskNote: 'A project manually moved to completed keeps this reminder active if work stages were never created.',
  },
  {
    conditionKeyPrefix: 'collection_payment_due:',
    rule: 'collection rules — runCollectionReminderRulesForCollection',
    file: 'src/lib/collectionReminderRules.js',
    lines: '12-26+',
    dependsOnProjectStatus: false,
    statusDependency: 'Depends on CollectionDue.status (open/partially_paid) and due_date. Does not read Project.status.',
    riskNote: 'Consistent: collection reminders close with the CollectionDue, regardless of project status.',
  },
  {
    conditionKeyPrefix: 'collection_needs_tax_invoice:',
    rule: 'collection rules — runCollectionReminderRulesForCollection',
    file: 'src/lib/collectionReminderRules.js',
    lines: '13, 24-26+',
    dependsOnProjectStatus: false,
    statusDependency: 'Depends on CollectionDue.status === awaiting_tax_invoice. Does not read Project.status.',
    riskNote: 'Same as collection_payment_due.',
  },
];

/**
 * Reconstruction of the legacy manual status flow, based on code evidence.
 */
const SUSPECTED_LEGACY_MANUAL_STATUS_FLOW = {
  conclusion: 'mixed_mostly_manual',
  conclusionLabel: 'מעורב — כמעט לחלוטין ידני, עם מעבר אוטומטי אחד',
  manualTransitions: {
    mechanism: 'Select בדיאלוג עריכת פרויקט (ProjectDetails.jsx:1139-1156) — המשתמש בוחר ידנית כל אחד מ-11 הסטטוסים',
    coveredTransitions: 'all transitions: pricing → waiting → signed → planning → submission → execution → completed, וכן rejected/cancelled',
  },
  automaticTransitions: [
    {
      from: 'any status',
      to: 'collection_completed',
      trigger: 'InvoiceUpload.jsx:124-133 — collected_amount >= total_amount אחרי העלאת חשבונית',
    },
  ],
  notableGaps: [
    'יצירת SignedProposal תקינה לא מעבירה את הפרויקט ל-signed (רק source_signed_proposal_id נכתב).',
    "יצירת פרויקט מתוך SignedProposalForm נוצרת עם status='pricing' ולא 'signed'.",
    'סגירת CollectionDue לא מעבירה ל-collection_completed (רק מסלול ה-legacy של InvoiceUpload עושה זאת).',
    'יצירת WorkStage / השלמת כל השלבים לא מעבירה ל-execution / completed.',
    'אין ולידציה של מעברי סטטוס — אפשר לדלג מ-pricing ישירות ל-completed.',
  ],
  dataLimitations: [
    'אין ישות status_history או audit_log בקוד — לא ניתן לדעת מה-data מתי סטטוס השתנה ועל ידי מי.',
    'אין שדות changed_by / updated_by על Project בקוד הקליינט.',
    'updated_date של base44 (אם קיים) משקף עדכון אחרון כלשהו, לא שינוי סטטוס ספציפי — אין להסיק ממנו.',
  ],
};

const RISK_FINDINGS = [
  {
    id: 'RF1',
    severity: 'warning_high',
    title: 'P2 reminder לא נסגר בשינוי סטטוס ידני',
    detail: "project_needs_proposal נסגר רק כשנוצר Proposal/SignedProposal record. שינוי ידני של סטטוס ל-waiting/signed/execution/completed בלי record כזה משאיר את התזכורת פעילה. זה המקור לתזכורות ה-stale שאותרו ב-P2E.",
    evidence: 'proposalReminderRules.js:23 (INACTIVE_PROJECT_STATUSES = cancelled only), 508-571',
  },
  {
    id: 'RF2',
    severity: 'warning_high',
    title: 'SignedProposal לא מסנכרן את Project.status',
    detail: 'הצעה חתומה תקינה מקושרת לפרויקט (source_signed_proposal_id) אבל הפרויקט נשאר בסטטוס הקודם עד שינוי ידני. נוצר פער בין "יש הצעה חתומה" לבין "הפרויקט signed".',
    evidence: 'signedProposalLifecycle.js:49-60; SignedProposalForm.jsx:620-633',
  },
  {
    id: 'RF3',
    severity: 'warning',
    title: 'מעבר אוטומטי יחיד במסלול legacy בלבד',
    detail: "collection_completed נכתב אוטומטית רק ב-InvoiceUpload (מסלול legacy). תהליך הגבייה החדש (CollectionDue) לא מעדכן סטטוס, כך שאותו מצב עסקי מסתיים בסטטוסים שונים תלוי באיזה מסלול השתמשו.",
    evidence: 'InvoiceUpload.jsx:124-133 לעומת collectionDueUtils.js:285-297',
  },
  {
    id: 'RF4',
    severity: 'warning',
    title: 'אין ולידציית מעברים ואין היסטוריה',
    detail: 'ה-Select מאפשר כל מעבר בין כל שני סטטוסים, ואין status_history/audit_log — אי אפשר לשחזר מי שינה סטטוס ומתי. לא ניתן לדעת זאת מה-data הקיים.',
    evidence: 'ProjectDetails.jsx:1139-1156; אין מופעים של status_history/audit_log/changed_by בקוד',
  },
  {
    id: 'RF5',
    severity: 'info',
    title: 'rejected/cancelled לא סוגרים תזכורות פתוחות',
    detail: "P2 פוסל רק cancelled (לא rejected). שאר חוקי התזכורות לא קוראים את Project.status בכלל, כך שתזכורות נשארות פתוחות גם אחרי דחייה/ביטול.",
    evidence: 'proposalReminderRules.js:23; workStageReminderRules.js (אין קריאת project.status)',
  },
];

const RECOMMENDED_FIX_ORDER = [
  {
    order: 1,
    title: 'החלטת מדיניות עם אהרון: מתי P2 צריך להיסגר',
    detail: "להחליט האם project_needs_proposal צריך להיסגר גם כשהסטטוס עבר את pricing (ולא רק כשנוצר Proposal record). זו ההחלטה שחוסמת את ניקוי ה-stale מ-P2E.",
    mutation: false,
  },
  {
    order: 2,
    title: 'סגירה ידנית מבוקרת של תזכורות stale שאותרו ב-P2E',
    detail: 'אחרי אישור אהרון, לסגור ידנית (או במיגרציה ייעודית מאושרת) את התזכורות שסווגו stale_project_reminder. לא אוטומטית מהאבחון.',
    mutation: true,
  },
  {
    order: 3,
    title: 'להרחיב את INACTIVE_PROJECT_STATUSES של P2',
    detail: "לשקול להוסיף לפחות rejected (ואולי statuses מתקדמים) לרשימת הפסילה של P2, כך שתזכורות חדשות לא ייווצרו/יישארו במצבים לא רלוונטיים.",
    mutation: true,
  },
  {
    order: 4,
    title: 'סנכרון signed בעת קישור הצעה חתומה',
    detail: 'לשקול ש-linkProjectToValidSignedProposal יציע/יבצע מעבר ל-signed (או לפחות יתריע על פער). דורש החלטת מדיניות.',
    mutation: true,
  },
  {
    order: 5,
    title: 'איחוד מסלול collection_completed',
    detail: 'להחליט אם השלמת כל ה-CollectionDues צריכה להעביר ל-collection_completed כמו מסלול ה-legacy של InvoiceUpload, או לבטל את הכתיבה האוטומטית שם.',
    mutation: true,
  },
  {
    order: 6,
    title: 'שקילת status_history',
    detail: 'אם נדרש מעקב "מי שינה ומתי", להוסיף ישות/שדה היסטוריה בעת כתיבת סטטוס. כרגע אין שום מקור כזה ב-data.',
    mutation: true,
  },
];

/**
 * Read-only: returns the static code-audit report. No entity access,
 * no mutations. Safe to run in production.
 */
export function runProjectStatusTransitionAudit() {
  const statusWriteLocations = PROJECT_UPDATE_LOCATIONS.filter((row) => row.writesStatus);

  return {
    status: 'completed',
    readOnly: true,
    auditType: 'static_code_audit',
    generated_at: new Date().toISOString(),
    codeAuditSnapshot: '2026-06-09 (baseline commit a522c57)',
    statusValuesFound: PROJECT_STATUS_VALUES,
    projectStatusWriteLocations: statusWriteLocations,
    projectCreateLocations: PROJECT_CREATE_LOCATIONS,
    projectUpdateLocations: PROJECT_UPDATE_LOCATIONS,
    proposalRelatedStatusWrites: PROPOSAL_RELATED_STATUS_WRITES,
    signedProposalRelatedStatusWrites: SIGNED_PROPOSAL_RELATED_STATUS_WRITES,
    reminderRulesThatDependOnProjectStatus: REMINDER_RULES_DEPENDING_ON_PROJECT_STATUS,
    suspectedLegacyManualStatusFlow: SUSPECTED_LEGACY_MANUAL_STATUS_FLOW,
    riskFindings: RISK_FINDINGS,
    recommendedFixOrder: RECOMMENDED_FIX_ORDER,
    counts: {
      statusValuesCount: PROJECT_STATUS_VALUES.length,
      projectCreateLocationsCount: PROJECT_CREATE_LOCATIONS.length,
      projectUpdateLocationsCount: PROJECT_UPDATE_LOCATIONS.length,
      statusWriteLocationsCount: statusWriteLocations.length,
      automaticStatusWriteCount: statusWriteLocations.filter((row) => row.automatic).length,
      manualStatusWriteCount: statusWriteLocations.filter((row) => !row.automatic).length,
      reminderRulesDependingOnStatusCount: REMINDER_RULES_DEPENDING_ON_PROJECT_STATUS.filter(
        (rule) => rule.dependsOnProjectStatus,
      ).length,
      riskFindingsCount: RISK_FINDINGS.length,
    },
  };
}
