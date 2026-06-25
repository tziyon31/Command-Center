import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Wipes all business data (keeps users). Use to return to an empty state.

async function main() {
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
  console.log('All business tables cleared (users preserved).');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
