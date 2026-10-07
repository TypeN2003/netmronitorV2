import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/error.js';
import {
  HttpError,
  requireAuth,
  requireOperator,
  requirePermission,
  type AuthedRequest,
} from '../middleware/auth.js';
import { uid } from '../utils/id.js';
import { nowTimestamp } from '../utils/time.js';
import { serializeAlert } from '../services/serialize.js';
import { writeLog } from '../services/logs.js';

export const alertsRouter = Router();

// The Alerts page is hidden from Viewer (CLAUDE.md, section 2.3.6)
alertsRouter.use(requireAuth, requireOperator);
const canAcknowledge = requirePermission('canAcknowledgeAlerts');

alertsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(1000, Number(req.query.limit) || 500);
    const alerts = await prisma.alert.findMany({
      include: { notes: { orderBy: { timestamp: 'asc' } } },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
    res.json(alerts.map(serializeAlert));
  })
);

/**
 * POST /api/alerts/:id/acknowledge
 *
 * A note is mandatory: an acknowledgement with no explanation tells the next shift
 * nothing. The frontend enforces the same rule before enabling the button.
 */
alertsRouter.post(
  '/:id/acknowledge',
  canAcknowledge,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { note } = z
      .object({ note: z.string().trim().min(1, 'An acknowledgement note is required') })
      .parse(req.body);

    const alert = await prisma.alert.findUnique({ where: { id: req.params.id } });
    if (!alert) throw new HttpError(404, 'Alert not found', 'NOT_FOUND');
    if (alert.status === 'resolved') {
      throw new HttpError(400, 'This alert is already resolved', 'ALREADY_RESOLVED');
    }

    const user = req.user!;
    const timestamp = nowTimestamp();

    await prisma.alertNote.create({
      data: { id: uid('note'), alertId: alert.id, author: user.name, role: user.role, timestamp, text: note },
    });
    const updated = await prisma.alert.update({
      where: { id: alert.id },
      data: { status: 'acknowledged', acknowledgedBy: user.name, acknowledgedAt: timestamp },
      include: { notes: { orderBy: { timestamp: 'asc' } } },
    });

    await writeLog({
      severity: 'Notice',
      host: 'NetMonitor-Core',
      ip: alert.deviceIp,
      tag: '%ALARM-5-ACK',
      message: `Alert ${alert.id} acknowledged by ${user.name} (${user.role}): "${note}"`,
    });

    res.json(serializeAlert(updated));
  })
);

alertsRouter.post(
  '/:id/resolve',
  canAcknowledge,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { note } = z.object({ note: z.string().trim().max(1000).optional() }).parse(req.body ?? {});

    const alert = await prisma.alert.findUnique({ where: { id: req.params.id } });
    if (!alert) throw new HttpError(404, 'Alert not found', 'NOT_FOUND');

    const user = req.user!;
    const timestamp = nowTimestamp();

    if (note) {
      await prisma.alertNote.create({
        data: { id: uid('note'), alertId: alert.id, author: user.name, role: user.role, timestamp, text: note },
      });
    }

    const updated = await prisma.alert.update({
      where: { id: alert.id },
      data: { status: 'resolved', resolvedAt: timestamp },
      include: { notes: { orderBy: { timestamp: 'asc' } } },
    });

    await writeLog({
      severity: 'Notice',
      host: 'NetMonitor-Core',
      ip: alert.deviceIp,
      tag: '%ALARM-5-RESOLVED',
      message: `Alert ${alert.id} marked resolved by ${user.name} (${user.role})`,
    });

    res.json(serializeAlert(updated));
  })
);

alertsRouter.post(
  '/:id/notes',
  canAcknowledge,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { note } = z.object({ note: z.string().trim().min(1).max(1000) }).parse(req.body);

    const alert = await prisma.alert.findUnique({ where: { id: req.params.id } });
    if (!alert) throw new HttpError(404, 'Alert not found', 'NOT_FOUND');

    const user = req.user!;
    await prisma.alertNote.create({
      data: {
        id: uid('note'),
        alertId: alert.id,
        author: user.name,
        role: user.role,
        timestamp: nowTimestamp(),
        text: note,
      },
    });

    const updated = await prisma.alert.findUnique({
      where: { id: alert.id },
      include: { notes: { orderBy: { timestamp: 'asc' } } },
    });
    res.json(serializeAlert(updated!));
  })
);
