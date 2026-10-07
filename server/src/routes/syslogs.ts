import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireOperator } from '../middleware/auth.js';
import { serializeSyslog } from '../services/serialize.js';

export const syslogsRouter = Router();

// The Syslog page is hidden from Viewer (CLAUDE.md, section 2.3.6)
syslogsRouter.use(requireAuth, requireOperator);

/**
 * GET /api/syslogs?limit=500&severity=Warning&host=Core-SW-01
 *
 * Entries are written by the collector and by every operator action. A real UDP/514
 * listener that ingests messages straight from the devices is planned for V2.
 */
syslogsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(2000, Number(req.query.limit) || 500);
    const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
    const host = typeof req.query.host === 'string' ? req.query.host : undefined;
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;

    const logs = await prisma.syslog.findMany({
      where: {
        ...(severity ? { severity } : {}),
        ...(host ? { host } : {}),
        ...(search ? { message: { contains: search } } : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    res.json(logs.map(serializeSyslog));
  })
);
