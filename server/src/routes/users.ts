import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/error.js';
import { HttpError, requireAdmin, requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { uid } from '../utils/id.js';
import { nowTimestamp } from '../utils/time.js';
import { serializeUser } from '../services/serialize.js';
import { DEFAULT_PERMISSIONS, type Role } from '../services/permissions.js';
import { writeLog } from '../services/logs.js';

export const usersRouter = Router();

// The whole Users page is Admin-only (CLAUDE.md, section 2.3.6)
usersRouter.use(requireAuth, requireAdmin);

const roleSchema = z.enum(['Admin', 'Engineer', 'Viewer']);

const permissionsSchema = z
  .object({
    canEditDevices: z.boolean(),
    canManageUsers: z.boolean(),
    canEditTopology: z.boolean(),
    canImportConfig: z.boolean(),
    canAcknowledgeAlerts: z.boolean(),
    canModifySettings: z.boolean(),
    canRebootDevices: z.boolean(),
  })
  .partial();

usersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(users.map(serializeUser));
  })
);

usersRouter.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const schema = z.object({
      name: z.string().trim().min(2),
      email: z.string().trim().email(),
      password: z.string().min(8, 'Password must be at least 8 characters'),
      role: roleSchema,
      department: z.string().trim().optional(),
      status: z.enum(['Active', 'Suspended']).optional(),
      permissions: permissionsSchema.optional(),
    });
    const input = schema.parse(req.body);

    // Login resolves either field, so both have to be unique
    if (await prisma.user.findFirst({ where: { email: input.email.toLowerCase() } })) {
      throw new HttpError(409, 'This email is already registered', 'EMAIL_TAKEN');
    }
    if (await prisma.user.findFirst({ where: { name: input.name } })) {
      throw new HttpError(409, 'This username is already taken', 'NAME_TAKEN');
    }

    const user = await prisma.user.create({
      data: {
        id: uid('usr'),
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash: await bcrypt.hash(input.password, 10),
        role: input.role,
        department: input.department?.trim() || 'Operations',
        status: input.status ?? 'Active',
        createdAt: nowTimestamp(),
        lastLogin: 'Never',
        ...DEFAULT_PERMISSIONS[input.role as Role],
        ...(input.permissions ?? {}),
      },
    });

    await writeLog({
      severity: 'Notice',
      host: 'NetMonitor-Core',
      ip: req.ip ?? '',
      tag: '%AUTH-5-USER_CREATED',
      message: `${req.user!.name} created account ${user.name} <${user.email}> with role ${user.role}`,
    });

    res.status(201).json(serializeUser(user));
  })
);

usersRouter.patch(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const schema = z.object({
      role: roleSchema.optional(),
      status: z.enum(['Active', 'Suspended']).optional(),
      department: z.string().trim().optional(),
      name: z.string().trim().min(2).optional(),
      password: z.string().min(8).optional(),
      permissions: permissionsSchema.optional(),
    });
    const input = schema.parse(req.body);

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw new HttpError(404, 'User not found', 'NOT_FOUND');

    // Changing your own role to a lower one would lock you out of this very page
    if (target.id === req.user!.id && input.role && input.role !== target.role) {
      throw new HttpError(400, 'You cannot change your own role', 'SELF_ROLE_CHANGE');
    }
    if (target.id === req.user!.id && input.status === 'Suspended') {
      throw new HttpError(400, 'You cannot suspend your own account', 'SELF_SUSPEND');
    }
    // Never leave the system without an Admin who can sign in
    if (target.role === 'Admin' && (input.role && input.role !== 'Admin' || input.status === 'Suspended')) {
      const activeAdmins = await prisma.user.count({ where: { role: 'Admin', status: 'Active' } });
      if (activeAdmins <= 1) {
        throw new HttpError(400, 'At least one active Admin must remain', 'LAST_ADMIN');
      }
    }

    const user = await prisma.user.update({
      where: { id: target.id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.department !== undefined ? { department: input.department } : {}),
        ...(input.status ? { status: input.status } : {}),
        // A role change resets the permission switches to that role's defaults,
        // then applies any explicit overrides sent with the same request.
        ...(input.role ? { role: input.role, ...DEFAULT_PERMISSIONS[input.role as Role] } : {}),
        ...(input.permissions ?? {}),
        ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 10) } : {}),
      },
    });

    if (input.role && input.role !== target.role) {
      await writeLog({
        severity: 'Notice',
        host: 'NetMonitor-Core',
        ip: req.ip ?? '',
        tag: '%AUTH-5-ROLE_CHANGED',
        message: `${req.user!.name} changed ${user.name} from ${target.role} to ${user.role}`,
      });
    }

    res.json(serializeUser(user));
  })
);

usersRouter.delete(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw new HttpError(404, 'User not found', 'NOT_FOUND');
    if (target.id === req.user!.id) {
      throw new HttpError(400, 'Cannot delete your own active account', 'SELF_DELETE');
    }
    if (target.role === 'Admin') {
      const activeAdmins = await prisma.user.count({ where: { role: 'Admin', status: 'Active' } });
      if (activeAdmins <= 1) throw new HttpError(400, 'At least one active Admin must remain', 'LAST_ADMIN');
    }

    await prisma.user.delete({ where: { id: target.id } });
    await writeLog({
      severity: 'Warning',
      host: 'NetMonitor-Core',
      ip: req.ip ?? '',
      tag: '%AUTH-4-USER_DELETED',
      message: `${req.user!.name} deleted account ${target.name} <${target.email}>`,
    });

    res.json({ success: true });
  })
);

