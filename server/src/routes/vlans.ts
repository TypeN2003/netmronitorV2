import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/error.js';
import { HttpError, authorOf, requireAuth, requireOperator, type AuthedRequest } from '../middleware/auth.js';
import { serializeVlan } from '../services/serialize.js';
import { writeLog } from '../services/logs.js';

export const vlansRouter = Router();

// VLAN page is hidden from Viewer (CLAUDE.md, section 2.3.6)
vlansRouter.use(requireAuth, requireOperator);

vlansRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const vlans = await prisma.vlan.findMany({ orderBy: { id: 'asc' } });
    res.json(vlans.map(serializeVlan));
  })
);

/**
 * POST /api/vlans
 *
 * Records a VLAN in NetMonitor's documentation. It does not create the VLAN on any
 * switch — NetMonitor is read-only towards the network apart from port admin state.
 * VLANs the collector finds over SNMP are added automatically with `discovered: true`.
 */
vlansRouter.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const schema = z.object({
      id: z.number().int().min(1).max(4094),
      name: z.string().trim().min(1).max(120),
      subnet: z.string().trim().max(60).optional(),
      gateway: z.string().trim().max(60).optional(),
      dhcpTotal: z.number().int().min(0).max(1_000_000).optional(),
      dhcpUsed: z.number().int().min(0).max(1_000_000).optional(),
      description: z.string().trim().max(400).optional(),
      status: z.enum(['active', 'degraded']).optional(),
    });
    const input = schema.parse(req.body);

    if (await prisma.vlan.findUnique({ where: { id: input.id } })) {
      throw new HttpError(409, `VLAN ${input.id} already exists`, 'VLAN_EXISTS');
    }

    const vlan = await prisma.vlan.create({
      data: {
        id: input.id,
        name: input.name,
        subnet: input.subnet ?? '',
        gateway: input.gateway ?? '',
        dhcpTotal: input.dhcpTotal ?? 0,
        dhcpUsed: input.dhcpUsed ?? 0,
        description: input.description ?? '',
        status: input.status ?? 'active',
        discovered: false,
      },
    });

    await writeLog({
      severity: 'Info',
      host: 'NetMonitor-Core',
      ip: input.gateway ?? '',
      tag: '%VLAN-6-DOCUMENTED',
      message: `VLAN ${vlan.id} (${vlan.name}) documented by ${authorOf(req.user!)}`,
    });

    res.status(201).json(serializeVlan(vlan));
  })
);

vlansRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const schema = z.object({
      name: z.string().trim().min(1).max(120).optional(),
      subnet: z.string().trim().max(60).optional(),
      gateway: z.string().trim().max(60).optional(),
      dhcpTotal: z.number().int().min(0).max(1_000_000).optional(),
      dhcpUsed: z.number().int().min(0).max(1_000_000).optional(),
      description: z.string().trim().max(400).optional(),
      status: z.enum(['active', 'degraded']).optional(),
    });
    const input = schema.parse(req.body);
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'VLAN id must be a number', 'BAD_ID');

    const existing = await prisma.vlan.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'VLAN not found', 'NOT_FOUND');

    const vlan = await prisma.vlan.update({ where: { id }, data: input });
    res.json(serializeVlan(vlan));
  })
);

vlansRouter.delete(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new HttpError(400, 'VLAN id must be a number', 'BAD_ID');

    const vlan = await prisma.vlan.findUnique({ where: { id } });
    if (!vlan) throw new HttpError(404, 'VLAN not found', 'NOT_FOUND');

    // A discovered VLAN comes straight back on the next poll, so say so rather than
    // letting it look like the delete silently failed.
    if (vlan.discovered) {
      throw new HttpError(
        400,
        `VLAN ${id} was discovered on a monitored device. Remove it from the switch, or it will reappear on the next poll.`,
        'VLAN_DISCOVERED'
      );
    }

    await prisma.vlan.delete({ where: { id } });
    await writeLog({
      severity: 'Notice',
      host: 'NetMonitor-Core',
      ip: '',
      tag: '%VLAN-5-REMOVED',
      message: `VLAN ${id} (${vlan.name}) removed from documentation by ${authorOf(req.user!)}`,
    });
    res.json({ success: true });
  })
);
