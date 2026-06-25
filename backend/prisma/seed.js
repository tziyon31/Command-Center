import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SEED_EMAIL = 'admin@local.test';
const SEED_PASSWORD = 'Admin123!';

const DEMO_EMAIL = 'demo@local.test';
const DEMO_PASSWORD = 'Demo!2026';

async function upsertUser({ email, password, fullName, role }) {
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.upsert({
    where: { email },
    update: { fullName, role, passwordHash },
    create: {
      email,
      passwordHash,
      fullName,
      role,
      phone: '',
      position: '',
    },
  });

  console.log(`Seeded user: ${email} / ${password} (${role})`);
}

async function main() {
  await upsertUser({
    email: SEED_EMAIL,
    password: SEED_PASSWORD,
    fullName: 'Admin',
    role: 'admin',
  });

  await upsertUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    fullName: 'תצוגה ללקוח',
    role: 'office_manager',
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
