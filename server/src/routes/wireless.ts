import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/error.js';
import { HttpError, requireAuth } from '../middleware/auth.js';
import { serializeAccessPoint, serializeClient } from '../services/serialize.js';

export const wirelessRouter = Router();
wirelessRouter.use(requireAuth);

/**
 * Wi-Fi inventory.
 *
 * The faculty runs cloud-managed RUCKUS One, so APs and client sessions belong to
 * that controller, not to SNMP. The tables exist and these endpoints serve them, but
 * they stay empty until the RUCKUS One API integration lands in V2 — the Access
 * Points menu opens the cloud console instead.
 */
wirelessRouter.get(
  '/access-points',
  asyncHandler(async (_req, res) => {
    const aps = await prisma.accessPoint.findMany({ orderBy: { name: 'asc' } });
    res.json(aps.map(serializeAccessPoint));
  })
);

wirelessRouter.get(
  '/clients',
  asyncHandler(async (_req, res) => {
    const clients = await prisma.clientSession.findMany({ orderBy: { hostname: 'asc' } });
    res.json(clients.map(serializeClient));
  })
);

wirelessRouter.post(
  '/access-points/:id/reboot',
  asyncHandler(async (req, res) => {
    const ap = await prisma.accessPoint.findUnique({ where: { id: req.params.id } });
    if (!ap) throw new HttpError(404, 'Access point not found', 'NOT_FOUND');
    throw new HttpError(
      501,
      'Rebooting an access point goes through the RUCKUS One cloud controller, which is not wired up yet. ' +
        'Reboot it from the RUCKUS One console.',
      'NOT_IMPLEMENTED'
    );
  })
);
