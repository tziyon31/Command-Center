import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SEED_EMAIL = 'admin@local.test';
const SEED_PASSWORD = 'Admin123!';

async function main() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  await prisma.user.upsert({
    where: { email: SEED_EMAIL },
    update: {},
    create: {
      email: SEED_EMAIL,
      passwordHash,
      fullName: 'Admin',
      role: 'admin',
      phone: '',
      position: '',
    },
  });

  console.log(`Seeded admin: ${SEED_EMAIL} / ${SEED_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
