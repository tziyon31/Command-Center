import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Demo data for client presentations.
// Keep volume small: text-only rows are tiny, well within Aiven free-tier storage.
// This script RESETS all business tables (keeps users) so re-runs stay clean and
// storage does not grow on repeated demos.

const now = new Date();
const iso = (daysOffset = 0) => {
  const d = new Date(now);
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString();
};
const dateOnly = (daysOffset = 0) => iso(daysOffset).slice(0, 10);

async function resetBusinessTables() {
  // Order does not matter (no DB-level foreign keys), users are preserved.
  await prisma.$transaction([
    prisma.reminder.deleteMany(),
    prisma.reminderSettings.deleteMany(),
    prisma.task.deleteMany(),
    prisma.quote.deleteMany(),
    prisma.document.deleteMany(),
    prisma.conversation.deleteMany(),
    prisma.collectionEvent.deleteMany(),
    prisma.collectionDue.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.invoiceProcess.deleteMany(),
    prisma.workStage.deleteMany(),
    prisma.signedProposal.deleteMany(),
    prisma.proposal.deleteMany(),
    prisma.project.deleteMany(),
    prisma.inquiry.deleteMany(),
    prisma.client.deleteMany(),
  ]);
}

async function main() {
  console.log('Resetting business tables (users preserved)...');
  await resetBusinessTables();

  console.log('Seeding demo data...');

  // --- Clients ---
  const cohen = await prisma.client.create({
    data: {
      name: 'דניאל כהן', company: 'מיזוג אוויר כהן בע"מ', email: 'daniel@cohen-ac.co.il',
      phone: '052-1234567', businessNumber: '514203789', address: 'הרצל 12, תל אביב',
      rating: 'A', status: 'completed', documentCount: 4, notes: 'לקוח ותיק, פרויקטים חוזרים',
    },
  });
  const tzafon = await prisma.client.create({
    data: {
      name: 'מירב לוי', company: 'קירור הצפון בע"מ', email: 'merav@kirur-zafon.co.il',
      phone: '054-9876543', businessNumber: '515998211', address: 'דרך העמק 45, עפולה',
      rating: 'B', status: 'completed', documentCount: 2,
    },
  });
  const aklim = await prisma.client.create({
    data: {
      name: 'אבי ברנס', company: 'א.ב. מערכות אקלים', email: 'avi@ab-aklim.co.il',
      phone: '050-3344556', businessNumber: '516112233', address: 'התעשייה 8, חיפה',
      rating: 'A', status: 'completed', documentCount: 6, notes: 'דורש דיוק בלוחות זמנים',
    },
  });
  const techno = await prisma.client.create({
    data: {
      name: 'נועה שמש', company: 'טכנו-אייר פתרונות', email: 'noa@techno-air.co.il',
      phone: '053-7788990', businessNumber: '517445566', address: 'רוטשילד 30, ראשון לציון',
      rating: 'C', status: 'completed', documentCount: 1,
    },
  });
  const darom = await prisma.client.create({
    data: {
      name: 'יוסי אזולאי', company: 'דרום מיזוג ושירות', email: 'yossi@darom-ac.co.il',
      phone: '058-2211334', businessNumber: '518667788', address: 'שדרות העצמאות 5, באר שבע',
      rating: 'B', status: 'completed', documentCount: 3,
    },
  });

  // --- Inquiries ---
  await prisma.inquiry.create({
    data: {
      clientName: 'רונן גבאי', buildingType: 'בניין מגורים', area: 1200, coolingTons: 80,
      details: 'מערכת מיני מרכזי ל-3 קומות, כולל לובי', formStatus: 'submitted', submittedAt: iso(-3),
    },
  });
  await prisma.inquiry.create({
    data: {
      clientName: 'שירה פרידמן', buildingType: 'משרדים', area: 650, coolingTons: 45,
      details: 'קומת משרדים פתוחה, דרישה לבקרה חכמה', formStatus: 'submitted', submittedAt: iso(-1),
    },
  });
  await prisma.inquiry.create({
    data: {
      clientName: 'איתי כספי', buildingType: 'מסחרי', area: 300, coolingTons: 20,
      details: 'חנות, מערכת ספליט מסחרית', formStatus: 'draft',
    },
  });

  // --- Projects (across the full pipeline) ---
  const projExecution = await prisma.project.create({
    data: {
      clientId: cohen.id, name: 'מרכז לוגיסטי - מערכת VRF', city: 'מודיעין', projectType: 'VRF',
      area: '4500 מ"ר', bidNumber: 'BID-2026-014', workNumber: 'W-2041',
      status: 'execution', constructionStatus: 'execution_walls_and_ceilings',
      year: 2026, totalAmount: 480000, collectedAmount: 240000,
      startDate: dateOnly(-60), endDate: dateOnly(40), workflowManaged: true,
      workflowOrigin: 'native', workflowEntryStage: 'work_stages',
      description: 'התקנת מערכת VRF למרכז לוגיסטי, 12 מעבים',
    },
  });
  const projCollected = await prisma.project.create({
    data: {
      clientId: tzafon.id, name: 'בניין משרדים - צ\'ילרים', city: 'עפולה', projectType: 'צ\'ילר',
      bidNumber: 'BID-2026-008', workNumber: 'W-2033', status: 'collection_completed',
      constructionStatus: 'delivered_to_client', year: 2026, totalAmount: 320000, collectedAmount: 320000,
      startDate: dateOnly(-150), endDate: dateOnly(-20), lastCollectionPaidOn: iso(-15),
      workflowManaged: true, workflowOrigin: 'native', workflowEntryStage: 'collection',
    },
  });
  const projPlanning = await prisma.project.create({
    data: {
      clientId: aklim.id, name: 'מלון בוטיק - מיני מרכזי', city: 'חיפה', projectType: 'מיני מרכזי',
      bidNumber: 'BID-2026-019', status: 'planning', year: 2026, totalAmount: 540000, collectedAmount: 0,
      startDate: dateOnly(10), workflowManaged: true, workflowOrigin: 'native', workflowEntryStage: 'work_stages',
      description: '38 חדרים, מערכת מיני מרכזי עם בקרה פרטנית',
    },
  });
  const projPricing = await prisma.project.create({
    data: {
      clientId: cohen.id, name: 'סופרמרקט - קירור מסחרי', city: 'תל אביב', projectType: 'קירור מסחרי',
      bidNumber: 'BID-2026-021', status: 'pricing', year: 2026, totalAmount: 210000, collectedAmount: 0,
    },
  });
  const projSigned = await prisma.project.create({
    data: {
      clientId: techno.id, name: 'מעבדה - חדר נקי', city: 'ראשון לציון', projectType: 'חדר נקי',
      bidNumber: 'BID-2026-023', status: 'signed', year: 2026, totalAmount: 670000, collectedAmount: 0,
      workflowManaged: true, workflowOrigin: 'native', workflowEntryStage: 'work_stages',
      description: 'חדר נקי ISO 7, בקרת לחות וטמפרטורה מדויקת',
    },
  });
  const projLead = await prisma.project.create({
    data: {
      clientId: darom.id, name: 'בית פרטי - מיני ספליט', city: 'באר שבע', projectType: 'ספליט',
      status: 'lead', year: 2026, totalAmount: 45000, collectedAmount: 0,
    },
  });
  const projCompleted = await prisma.project.create({
    data: {
      clientId: aklim.id, name: 'קומפלקס מסחרי - שלב א', city: 'חיפה', projectType: 'VRF',
      bidNumber: 'BID-2025-097', workNumber: 'W-1988', status: 'completed',
      constructionStatus: 'delivered_to_client', year: 2025, totalAmount: 890000, collectedAmount: 890000,
      startDate: dateOnly(-300), endDate: dateOnly(-90), lastCollectionPaidOn: iso(-85),
      workflowManaged: true, workflowOrigin: 'native', workflowEntryStage: 'completed_no_reminders',
    },
  });

  // --- Proposals ---
  await prisma.proposal.create({
    data: {
      clientId: cohen.id, clientName: cohen.company, projectId: projPricing.id, projectName: projPricing.name,
      proposalSentToClient: true, proposalSentAt: iso(-5), clientSawProposal: true, clientSawAt: iso(-4),
      documentNote: 'הצעה #2026-021', formStatus: 'submitted', submittedAt: iso(-5),
    },
  });
  await prisma.proposal.create({
    data: {
      clientId: techno.id, clientName: techno.company, projectId: projSigned.id, projectName: projSigned.name,
      proposalSentToClient: true, proposalSentAt: iso(-20), clientSawProposal: true, clientSawAt: iso(-19),
      documentNote: 'הצעה #2026-023', formStatus: 'submitted', submittedAt: iso(-20),
    },
  });

  // --- Signed proposals ---
  const signedTechno = await prisma.signedProposal.create({
    data: {
      projectId: projSigned.id, projectName: projSigned.name, clientId: techno.id, clientName: techno.company,
      hasSignedOfferOrOrder: true, signedAt: iso(-14), documentNote: 'הזמנת עבודה חתומה',
      formStatus: 'submitted', submittedAt: iso(-14),
    },
  });
  await prisma.signedProposal.create({
    data: {
      projectId: projExecution.id, projectName: projExecution.name, clientId: cohen.id, clientName: cohen.company,
      hasSignedOfferOrOrder: true, signedAt: iso(-70), documentNote: 'חוזה חתום', formStatus: 'submitted', submittedAt: iso(-70),
    },
  });

  // --- Work stages (for execution + signed projects) ---
  const stages = [
    { project: projExecution, title: 'תכנון מפורט ואישור', order: 1, status: 'completed', a: true, c: true, d: true, completedAt: iso(-55) },
    { project: projExecution, title: 'אספקת ציוד ומעבים', order: 2, status: 'completed', a: true, c: true, d: false, completedAt: iso(-30) },
    { project: projExecution, title: 'התקנה וצנרת', order: 3, status: 'active', a: true, c: false, d: false, target: dateOnly(15) },
    { project: projExecution, title: 'הרצה ומסירה', order: 4, status: 'pending', a: false, c: false, d: false, target: dateOnly(35), invoice: true },
    { project: projSigned, title: 'תכנון חדר נקי', order: 1, status: 'active', a: true, c: false, d: false, target: dateOnly(20) },
    { project: projSigned, title: 'התקנת מערכת סינון', order: 2, status: 'pending', a: false, c: false, d: false, target: dateOnly(50) },
  ];
  for (const s of stages) {
    await prisma.workStage.create({
      data: {
        projectId: s.project.id, projectName: s.project.name, clientId: s.project.clientId,
        signedProposalId: s.project.id === projSigned.id ? signedTechno.id : undefined,
        title: s.title, orderIndex: s.order, status: s.status,
        aaronApproved: s.a, clientApproved: s.c, draftsmanApproved: s.d,
        targetDate: s.target, completedAt: s.completedAt,
        invoiceRequiredOnCompletion: Boolean(s.invoice),
      },
    });
  }

  // --- Invoice processes + invoices ---
  const invProc = await prisma.invoiceProcess.create({
    data: {
      projectId: projExecution.id, projectName: projExecution.name, clientId: cohen.id, clientName: cohen.company,
      invoiceScope: 'stage', projectPercent: 50, amount: 240000, invoiceCreatedInPaperless: true,
      invoiceCreatedAt: iso(-25), invoiceSentToClient: true, invoiceSentAt: iso(-24),
      invoiceReference: 'INV-2026-0140', formStatus: 'submitted', submittedAt: iso(-25),
    },
  });
  await prisma.invoice.create({
    data: {
      projectId: projExecution.id, invoiceNumber: 'INV-2026-0140', date: dateOnly(-25), dueDate: dateOnly(5),
      status: 'paid', amount: 240000, paidAmount: 240000, milestone: 'מקדמה 50%',
    },
  });
  await prisma.invoice.create({
    data: {
      projectId: projCollected.id, invoiceNumber: 'INV-2026-0080', date: dateOnly(-40), dueDate: dateOnly(-10),
      status: 'paid', amount: 320000, paidAmount: 320000, milestone: 'תשלום סופי',
    },
  });
  await prisma.invoice.create({
    data: {
      projectId: projCompleted.id, invoiceNumber: 'INV-2025-0970', date: dateOnly(-95), dueDate: dateOnly(-65),
      status: 'paid', amount: 890000, paidAmount: 890000, milestone: 'תשלום סופי',
    },
  });

  // --- Collection dues + events ---
  await prisma.collectionDue.create({
    data: {
      invoiceProcessId: invProc.id, invoiceReference: 'INV-2026-0140', projectId: projExecution.id,
      projectName: projExecution.name, clientId: cohen.id, clientName: cohen.company,
      amountDue: 240000, amountPaid: 240000, remainingAmount: 0, dueDate: dateOnly(5),
      openedAt: iso(-24), paidAt: iso(-2), paymentReceived: true, paymentReceivedAt: iso(-2),
      taxInvoiceSentToClient: true, taxInvoiceSentAt: iso(-1), status: 'paid',
      sourceType: 'invoice_process', formStatus: 'submitted',
    },
  });
  await prisma.collectionDue.create({
    data: {
      projectId: projExecution.id, projectName: projExecution.name, clientId: cohen.id, clientName: cohen.company,
      amountDue: 240000, amountPaid: 0, remainingAmount: 240000, dueDate: dateOnly(30),
      openedAt: iso(-1), status: 'open', sourceType: 'manual', formStatus: 'submitted',
      notes: 'יתרת תשלום עם סיום ההתקנה',
    },
  });
  await prisma.collectionEvent.create({
    data: { projectId: projCollected.id, projectName: projCollected.name, amount: 320000, note: 'תשלום סופי', paidAt: iso(-15), type: 'collection_paid' },
  });
  await prisma.collectionEvent.create({
    data: { projectId: projCompleted.id, projectName: projCompleted.name, amount: 890000, note: 'תשלום סופי שלב א', paidAt: iso(-85), type: 'collection_paid' },
  });

  // --- Quotes ---
  await prisma.quote.create({
    data: {
      projectId: projPricing.id, quoteNumber: 'Q-2026-021', date: dateOnly(-5), status: 'sent', totalAmount: 210000, validityDays: 30,
      items: [
        { description: 'מערכת קירור מסחרי', quantity: 1, unit_price: 180000, total: 180000 },
        { description: 'התקנה והפעלה', quantity: 1, unit_price: 30000, total: 30000 },
      ],
      paymentMilestones: [
        { description: 'מקדמה', percentage: 40, amount: 84000 },
        { description: 'סיום', percentage: 60, amount: 126000 },
      ],
    },
  });
  await prisma.quote.create({
    data: {
      projectId: projSigned.id, quoteNumber: 'Q-2026-023', date: dateOnly(-20), status: 'signed', totalAmount: 670000, validityDays: 45,
      items: [{ description: 'מערכת חדר נקי ISO 7', quantity: 1, unit_price: 670000, total: 670000 }],
    },
  });

  // --- Tasks ---
  const tasks = [
    { title: 'לתאם ביקור באתר - מלון בוטיק', project: projPlanning, status: 'pending', priority: 'high', due: dateOnly(2) },
    { title: 'להזמין מעבים - מרכז לוגיסטי', project: projExecution, status: 'in_progress', priority: 'high', due: dateOnly(1) },
    { title: 'לשלוח הצעת מחיר - סופרמרקט', project: projPricing, status: 'completed', priority: 'medium', due: dateOnly(-1), done: true },
    { title: 'לתאם הרצה - חדר נקי', project: projSigned, status: 'pending', priority: 'medium', due: dateOnly(7) },
    { title: 'מעקב תשלום יתרה - מרכז לוגיסטי', project: projExecution, status: 'pending', priority: 'high', due: dateOnly(4) },
    { title: 'לחזור ללקוח - בית פרטי', project: projLead, status: 'pending', priority: 'low', due: dateOnly(3) },
  ];
  for (const t of tasks) {
    await prisma.task.create({
      data: {
        title: t.title, projectId: t.project.id, relatedProjectName: t.project.name,
        status: t.status, priority: t.priority, dueDate: t.due,
        assignedTo: 'admin@local.test', isCompleted: Boolean(t.done), completedAt: t.done ? iso(-1) : undefined,
      },
    });
  }

  // --- Reminders ---
  const reminders = [
    {
      title: 'גבייה פתוחה - מרכז לוגיסטי', description: 'יתרת תשלום 240,000 ₪ ממתינה', project: projExecution,
      client: cohen, sourceType: 'collection_due', conditionKey: `collection_open:${projExecution.id}`,
      url: '/Collections', label: 'פתח גבייה', freq: 'due_date_based', next: iso(3),
    },
    {
      title: 'הצעה ממתינה לחתימה - סופרמרקט', description: 'הלקוח צפה בהצעה, לא נחתם', project: projPricing,
      client: cohen, sourceType: 'proposal', conditionKey: `proposal_followup:${projPricing.id}`,
      url: '/Proposals', label: 'פתח הצעה', freq: 'daily', next: iso(1),
    },
    {
      title: 'שלב בהמתנה לאישור - חדר נקי', description: 'שלב תכנון ממתין לאישור לקוח', project: projSigned,
      client: techno, sourceType: 'work_stage', conditionKey: `work_stage_pending:${projSigned.id}`,
      url: '/WorkStages', label: 'פתח שלבים', freq: 'daily', next: iso(2),
    },
    {
      title: 'מעקב פנייה חדשה - בניין מגורים', description: 'פנייה הוגשה, ממתינה לטיפול', project: null,
      client: null, sourceType: 'inquiry', conditionKey: 'inquiry_followup:demo', clientName: 'רונן גבאי',
      url: '/Inquiries', label: 'פתח פניות', freq: 'daily', next: iso(1),
    },
  ];
  for (const r of reminders) {
    await prisma.reminder.create({
      data: {
        title: r.title, description: r.description,
        clientName: r.client?.company ?? r.clientName ?? 'לקוח',
        clientId: r.client?.id, projectName: r.project?.name, projectId: r.project?.id,
        sourceType: r.sourceType, sourceId: r.project?.id ?? 'demo-inquiry',
        conditionKey: r.conditionKey, actionUrl: r.url, actionLabel: r.label,
        status: 'active', frequency: r.freq, defaultTime: '07:00', nextRemindAt: r.next, activeSince: iso(-2),
      },
    });
  }

  // --- Reminder settings for admin ---
  const admin = await prisma.user.findUnique({ where: { email: 'admin@local.test' } });
  if (admin) {
    await prisma.reminderSettings.create({
      data: { userId: admin.id, dailyReminderTime: '07:30', dailyRemindersEnabled: true },
    });
  }

  const counts = {
    clients: await prisma.client.count(),
    inquiries: await prisma.inquiry.count(),
    projects: await prisma.project.count(),
    proposals: await prisma.proposal.count(),
    signed_proposals: await prisma.signedProposal.count(),
    work_stages: await prisma.workStage.count(),
    invoice_processes: await prisma.invoiceProcess.count(),
    invoices: await prisma.invoice.count(),
    collection_dues: await prisma.collectionDue.count(),
    collection_events: await prisma.collectionEvent.count(),
    quotes: await prisma.quote.count(),
    tasks: await prisma.task.count(),
    reminders: await prisma.reminder.count(),
  };
  console.log('Demo seed complete:', counts);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
