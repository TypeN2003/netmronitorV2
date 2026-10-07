import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/error.js';
import { HttpError, requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { generateToken } from '../utils/jwt.js';
import { otpCode, sha256, uid } from '../utils/id.js';
import { nowTimestamp } from '../utils/time.js';
import { serializeUser } from '../services/serialize.js';
import { DEFAULT_PERMISSIONS } from '../services/permissions.js';
import { writeLog } from '../services/logs.js';

export const authRouter = Router();

const BCRYPT_ROUNDS = 10;
const OTP_TTL_MS = 15 * 60 * 1000;

const loginSchema = z.object({
  // Login accepts either the email or the display name, same as the demo build
  identifier: z.string().min(1, 'Email or username is required'),
  password: z.string().min(1, 'Password is required'),
});

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  department: z.string().trim().optional(),
});

// ---------------------------------------------------------------- POST /api/auth/login

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { identifier, password } = loginSchema.parse(req.body);
    const needle = identifier.trim().toLowerCase();

    // SQLite has no case-insensitive unique lookup across two columns, so compare in JS
    const candidates = await prisma.user.findMany({
      where: { OR: [{ email: { equals: needle } }, { name: { equals: identifier.trim() } }] },
    });
    const user =
      candidates.find(u => u.email.toLowerCase() === needle) ??
      candidates.find(u => u.name.toLowerCase() === needle) ??
      null;

    // Same message for unknown account and wrong password, so the endpoint cannot be
    // used to enumerate which emails exist.
    const invalid = new HttpError(401, 'Invalid email/username or password', 'BAD_CREDENTIALS');
    if (!user) throw invalid;
    if (!(await bcrypt.compare(password, user.passwordHash))) throw invalid;
    if (user.status !== 'Active') {
      throw new HttpError(403, 'This account has been suspended by an administrator', 'SUSPENDED');
    }

    const lastLogin = nowTimestamp();
    const updated = await prisma.user.update({ where: { id: user.id }, data: { lastLogin } });

    await writeLog({
      severity: 'Info',
      host: 'NetMonitor-Core',
      ip: req.ip ?? '',
      tag: '%AUTH-6-LOGIN',
      message: `${updated.name} (${updated.role}) signed in`,
    });

    res.json({
      token: generateToken({ sub: updated.id, role: updated.role, email: updated.email }),
      user: serializeUser(updated),
    });
  })
);

// ---------------------------------------------------------------- POST /api/auth/register

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { name, email, password, department } = registerSchema.parse(req.body);

    const existingEmail = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
    if (existingEmail) throw new HttpError(409, 'This email is already registered', 'EMAIL_TAKEN');
    const existingName = await prisma.user.findFirst({ where: { name } });
    if (existingName) throw new HttpError(409, 'This username is already taken', 'NAME_TAKEN');

    // Bootstrap policy: the first account, or the first one when no Admin is left, is an Admin.
    const adminCount = await prisma.user.count({ where: { role: 'Admin', status: 'Active' } });
    const role = adminCount === 0 ? 'Admin' : 'Engineer';

    const now = nowTimestamp();
    const user = await prisma.user.create({
      data: {
        id: uid('usr'),
        name,
        email: email.toLowerCase(),
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        role,
        department: department?.trim() || 'Operations',
        status: 'Active',
        createdAt: now,
        lastLogin: now,
        ...DEFAULT_PERMISSIONS[role],
      },
    });

    await writeLog({
      severity: 'Notice',
      host: 'NetMonitor-Core',
      ip: req.ip ?? '',
      tag: '%AUTH-5-REGISTER',
      message: `New account registered: ${user.name} <${user.email}> assigned role ${role}`,
    });

    res.status(201).json({
      token: generateToken({ sub: user.id, role: user.role, email: user.email }),
      user: serializeUser(user),
      assignedRole: role,
    });
  })
);

// ---------------------------------------------------------------- GET /api/auth/me

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ user: serializeUser(req.user!) });
  })
);

// ---------------------------------------------------------------- POST /api/auth/change-password

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8, 'New password must be at least 8 characters'),
    });
    const { currentPassword, newPassword } = schema.parse(req.body);
    const user = req.user!;

    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new HttpError(401, 'Current password is incorrect', 'BAD_CREDENTIALS');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) },
    });
    res.json({ success: true });
  })
);

// ---------------------------------------------------------------- password reset

/**
 * Issue a one-time code.
 *
 * V1 has no mail transport, so the code comes back in the response and the Forgot
 * Password screen displays it — the same flow the demo build used. Once SMTP exists,
 * stop returning `otp` here and send it by email instead.
 */
authRouter.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().trim().email('Enter a valid email address') }).parse(req.body);
    const user = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
    if (!user) throw new HttpError(404, 'No user registered with this email address', 'NO_USER');

    const otp = otpCode();
    const expiresAt = Date.now() + OTP_TTL_MS;

    // Only one live code per account
    await prisma.passwordReset.deleteMany({ where: { userId: user.id } });
    await prisma.passwordReset.create({
      data: { id: uid('rst'), userId: user.id, otpHash: sha256(otp), expiresAt: BigInt(expiresAt) },
    });

    await writeLog({
      severity: 'Notice',
      host: 'NetMonitor-Core',
      ip: req.ip ?? '',
      tag: '%AUTH-5-RESET_REQUESTED',
      message: `Password reset code issued for <${user.email}> (valid 15 minutes)`,
    });

    res.json({ success: true, otp, expiresAt, deliveredBy: 'response' });
  })
);

authRouter.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      email: z.string().trim().email(),
      otp: z.string().trim().min(1, 'Enter the code from the previous step'),
      newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    });
    const { email, otp, newPassword } = schema.parse(req.body);

    const user = await prisma.user.findFirst({ where: { email: email.toLowerCase() } });
    if (!user) throw new HttpError(404, 'No active password reset request found for this email', 'NO_REQUEST');

    const request = await prisma.passwordReset.findFirst({
      where: { userId: user.id, usedAt: null },
      orderBy: { expiresAt: 'desc' },
    });
    if (!request) throw new HttpError(404, 'No active password reset request found for this email', 'NO_REQUEST');

    if (Date.now() > Number(request.expiresAt)) {
      await prisma.passwordReset.delete({ where: { id: request.id } });
      throw new HttpError(400, 'OTP code has expired (15-minute limit). Please request a new code.', 'OTP_EXPIRED');
    }

    if (request.otpHash !== sha256(otp.trim().toUpperCase())) {
      throw new HttpError(400, 'Invalid or expired OTP code', 'OTP_INVALID');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) },
    });
    await prisma.passwordReset.update({ where: { id: request.id } , data: { usedAt: nowTimestamp() } });

    await writeLog({
      severity: 'Notice',
      host: 'NetMonitor-Core',
      ip: req.ip ?? '',
      tag: '%AUTH-5-PASSWORD_RESET',
      message: `Password reset completed for <${user.email}>`,
    });

    res.json({ success: true });
  })
);
