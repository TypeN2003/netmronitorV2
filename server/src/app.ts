import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import { prisma } from './prisma.js';
import { errorHandler, notFound, asyncHandler } from './middleware/error.js';
import { requireAuth, type AuthedRequest } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { devicesRouter } from './routes/devices.js';
import { portsRouter } from './routes/ports.js';
import { vlansRouter } from './routes/vlans.js';
import { topologyRouter } from './routes/topology.js';
import { alertsRouter } from './routes/alerts.js';
import { syslogsRouter } from './routes/syslogs.js';
import { backupsRouter } from './routes/backups.js';
import { settingsRouter } from './routes/settings.js';
import { telemetryRouter, streamHandler } from './routes/telemetry.js';
import { wirelessRouter } from './routes/wireless.js';
import { nowTimestamp } from './utils/time.js';
import { serializeDevice, serializePort, serializeAlert, serializeSyslog, serializeVlan, serializeBackup, serializeSettings, serializeTopologyLink, serializeTopologyNode, serializeAccessPoint, serializeClient } from './services/serialize.js';
import { getSettings } from './services/settings.js';

export const createApp = (): express.Express => {
  const app = express();

  app.set('trust proxy', true);
  app.disable('x-powered-by');

  /**
   * CORS, applied to the API only.
   *
   * Static files never need it, and refusing them breaks the app outright: a browser
   * sends an Origin header even for same-origin subresources, so a strict list that
   * does not contain the app's own address makes every asset fail.
   *
   * The request's own host always counts as allowed. That means serving the UI and
   * the API together — which is how this runs in production, and behind a tunnel or
   * reverse proxy — works without anyone having to add the public hostname to
   * CORS_ORIGIN. The list stays meaningful for genuinely cross-origin callers, such
   * as the Vite dev server on :3000.
   */
  app.use(
    '/api',
    cors((req, callback) => {
      const origin = req.headers.origin;
      const host = req.headers.host;
      const sameOrigin = host ? [`http://${host}`, `https://${host}`] : [];

      // curl and same-origin navigations send no Origin at all
      if (!origin || env.corsOrigins.includes(origin) || sameOrigin.includes(origin)) {
        callback(null, { origin: true, credentials: false });
        return;
      }
      callback(new Error(`Origin ${origin} is not in CORS_ORIGIN`));
    })
  );

  // Config files are the biggest thing a client sends
  app.use(express.json({ limit: '4mb' }));

  if (env.nodeEnv !== 'test') {
    app.use((req, _res, next) => {
      if (req.path !== '/api/stream') console.log(`[http] ${req.method} ${req.originalUrl}`);
      next();
    });
  }

  // ---------------------------------------------------------------- health

  app.get(
    '/api/health',
    asyncHandler(async (_req, res) => {
      await prisma.$queryRaw`SELECT 1`;
      res.json({
        status: 'ok',
        service: 'netmonitor-collector',
        serverTime: nowTimestamp(),
        pollerEnabled: env.pollerEnabled,
      });
    })
  );

  // ---------------------------------------------------------------- resources

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/devices', devicesRouter);
  app.use('/api/ports', portsRouter);
  app.use('/api/vlans', vlansRouter);
  app.use('/api/topology', topologyRouter);
  app.use('/api/alerts', alertsRouter);
  app.use('/api/syslogs', syslogsRouter);
  app.use('/api/backups', backupsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/telemetry', telemetryRouter);
  app.use('/api/wireless', wirelessRouter);

  app.get('/api/stream', requireAuth, (req, res) => streamHandler(req as AuthedRequest, res));

  /**
   * GET /api/bootstrap
   *
   * Everything the app needs for a first paint, in one round trip. The frontend calls
   * this once after login instead of firing eleven parallel requests, and it respects
   * the role gates: a Viewer gets no ports, alerts, VLANs, syslogs or backups, which
   * matches what the Sidebar hides.
   */
  app.get(
    '/api/bootstrap',
    requireAuth,
    asyncHandler(async (req: AuthedRequest, res) => {
      const user = req.user!;
      const isOperator = user.role === 'Admin' || user.role === 'Engineer';

      const [devices, nodes, links, settings, accessPoints, clients] = await Promise.all([
        prisma.device.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
        prisma.topologyNode.findMany({ orderBy: [{ tier: 'asc' }, { x: 'asc' }] }),
        prisma.topologyLink.findMany(),
        getSettings(),
        prisma.accessPoint.findMany({ orderBy: { name: 'asc' } }),
        prisma.clientSession.findMany({ orderBy: { hostname: 'asc' } }),
      ]);

      const operatorData = isOperator
        ? await Promise.all([
            prisma.port.findMany({ orderBy: [{ deviceId: 'asc' }, { portId: 'asc' }] }),
            prisma.vlan.findMany({ orderBy: { id: 'asc' } }),
            prisma.alert.findMany({
              include: { notes: { orderBy: { timestamp: 'asc' } } },
              orderBy: { timestamp: 'desc' },
              take: 500,
            }),
            prisma.syslog.findMany({ orderBy: { timestamp: 'desc' }, take: 500 }),
            prisma.backup.findMany({ orderBy: { timestamp: 'desc' } }),
          ])
        : null;

      const portsByDevice: Record<string, ReturnType<typeof serializePort>[]> = {};
      for (const port of operatorData?.[0] ?? []) {
        (portsByDevice[port.deviceId] ??= []).push(serializePort(port));
      }

      res.json({
        serverTime: nowTimestamp(),
        devices: devices.map(serializeDevice),
        portsByDevice,
        vlans: (operatorData?.[1] ?? []).map(serializeVlan),
        accessPoints: accessPoints.map(serializeAccessPoint),
        clients: clients.map(serializeClient),
        topologyNodes: nodes.map(serializeTopologyNode),
        topologyLinks: links.map(serializeTopologyLink),
        alerts: (operatorData?.[2] ?? []).map(serializeAlert),
        syslogs: (operatorData?.[3] ?? []).map(serializeSyslog),
        backups: (operatorData?.[4] ?? []).map(serializeBackup),
        settings: serializeSettings(settings),
      });
    })
  );

  // ---------------------------------------------------------------- frontend (production)

  /**
   * Serve the built web app from the same port as the API.
   *
   * In development Vite serves the UI on :3000 and proxies /api here, so this does
   * nothing. In production there is no Vite: `npm run build` at the project root
   * writes `dist/`, and serving it from here means one process, one port and one
   * origin — which is what a Cloudflare Tunnel (or any reverse proxy) wants, and it
   * sidesteps CORS entirely.
   *
   * Override the location with FRONTEND_DIST when the build lives elsewhere.
   */
  const frontendDist =
    process.env.FRONTEND_DIST ?? fileURLToPath(new URL('../../dist', import.meta.url));

  if (existsSync(frontendDist)) {
    console.log(`[boot] serving the web app from ${frontendDist}`);
    // Hashed asset filenames can be cached hard; index.html must not be, or a
    // deploy leaves browsers on the old bundle.
    app.use(
      express.static(frontendDist, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      })
    );

    // Client-side routing: every non-API GET renders the app shell, so refreshing
    // on /devices or deep-linking to /topology works.
    app.get(/^(?!\/api\/).*/, (req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile('index.html', { root: frontendDist }, error => {
        if (error) next();
      });
    });
  } else if (env.nodeEnv === 'production') {
    console.warn(
      `[boot] no web app found at ${frontendDist}. ` +
        'Run `npm run build` in the project root, or point FRONTEND_DIST at the build.'
    );
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
};
