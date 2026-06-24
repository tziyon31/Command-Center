import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireAdmin, signToken } from '../middleware/auth.js';
import { toUserResponse } from '../lib/serialize.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const user = await prisma.user.findUnique({ where: { email: String(email).trim().toLowerCase() } });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(String(password), user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = signToken(user);
  return res.json({ token, user: toUserResponse(user) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(toUserResponse(req.user));
});

router.post('/logout', requireAuth, (_req, res) => {
  res.json({ ok: true });
});

router.post('/invite', requireAuth, requireAdmin, async (req, res) => {
  const { email, role } = req.body ?? {};
  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return res.status(409).json({ error: 'User already exists' });
  }

  const tempPassword = crypto.randomBytes(9).toString('base64url');
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      role: role ?? 'task_worker',
      fullName: '',
      phone: '',
      position: '',
    },
  });

  console.log(`[invite] ${normalizedEmail} temporary password: ${tempPassword}`);

  return res.status(201).json({
    user: toUserResponse(user),
    temporary_password: process.env.NODE_ENV === 'production' ? undefined : tempPassword,
  });
});

export default router;
