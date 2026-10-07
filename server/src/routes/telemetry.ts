import { Router } from 'express';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireOperator, type AuthedRequest } from '../middleware/auth.js';
import { hourMinute, nowTimestamp } from '../utils/time.js';
import { getLastCycleSummary, runPollCycle } from '../services/poller.js';
import { getSettings } from '../services/settings.js';
import { events } from '../services/events.js';
import { env } from '../env.js';

export const telemetryRouter = Router();
telemetryRouter.use(requireAuth);

/**
 * POST /api/telemetry/refresh
 *
 * What the Refresh button calls. Polls every enabled device and returns the summary.
 * Concurrent calls join the cycle already running instead of starting a second one.
 */
telemetryRouter.post(
  '/refresh',
  asyncHandler(async (_req, res) => {
    const summary = await runPollCycle();
    res.json(summary);
  })
);

/** GET /api/telemetry/status — collector health, for the "last sync" line in the header. */
telemetryRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const [settings, deviceCount, pollableCount, sampleCount] = await Promise.all([
      getSettings(),
      prisma.device.count(),
      prisma.device.count({ where: { pollEnabled: true } }),
      prisma.telemetrySample.count(),
    ]);

    const last = getLastCycleSummary();
    res.json({
      pollerEnabled: env.pollerEnabled,
      intervalSeconds: settings.snmpInterval,
      timeoutMs: settings.pingTimeoutMs > 0 ? settings.pingTimeoutMs : env.snmp.timeoutMs,
      concurrency: env.snmp.concurrency,
      cpuThreshold: env.cpuThreshold,
      ramThreshold: env.ramThreshold,
      deviceCount,
      pollableCount,
      sampleCount,
      lastCycle: last,
      serverTime: nowTimestamp(),
    });
  })
);

/**
 * GET /api/telemetry/history?hours=6&points=6
 *
 * Buckets the stored samples into a fixed number of points for the Dashboard and
 * Statistics charts. Traffic is network-wide (every device summed), CPU and RAM are
 * averaged across devices.
 *
 * Returns the buckets that actually contain data — a freshly installed collector has
 * one point, not six fabricated ones.
 */
telemetryRouter.get(
  '/history',
  asyncHandler(async (req, res) => {
    const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 6));
    const points = Math.min(48, Math.max(2, Number(req.query.points) || 6));
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;

    const windowMs = hours * 3600 * 1000;
    const until = Date.now();
    const since = until - windowMs;
    const bucketMs = windowMs / points;

    const samples = await prisma.telemetrySample.findMany({
      where: {
        takenAtMs: { gte: BigInt(since) },
        ...(deviceId ? { deviceId } : {}),
      },
      orderBy: { takenAtMs: 'asc' },
      select: {
        takenAtMs: true,
        cpu: true,
        ram: true,
        temp: true,
        trafficInMbps: true,
        trafficOutMbps: true,
        pingMs: true,
        takenAt: true,
      },
    });

    interface Bucket {
      startMs: number;
      cpu: number[];
      ram: number[];
      temp: number[];
      pingMs: number[];
      // Traffic is summed per poll instant, then averaged over the bucket
      trafficByInstant: Map<string, { inbound: number; outbound: number }>;
    }

    const buckets = new Map<number, Bucket>();
    for (const sample of samples) {
      const takenAtMs = Number(sample.takenAtMs);
      const index = Math.min(points - 1, Math.floor((takenAtMs - since) / bucketMs));
      const startMs = since + index * bucketMs;
      const fresh: Bucket = { startMs, cpu: [], ram: [], temp: [], pingMs: [], trafficByInstant: new Map() };
      const bucket = buckets.get(index) ?? fresh;

      bucket.cpu.push(sample.cpu);
      bucket.ram.push(sample.ram);
      bucket.temp.push(sample.temp);
      bucket.pingMs.push(sample.pingMs);

      const instant = bucket.trafficByInstant.get(sample.takenAt) ?? { inbound: 0, outbound: 0 };
      instant.inbound += sample.trafficInMbps;
      instant.outbound += sample.trafficOutMbps;
      bucket.trafficByInstant.set(sample.takenAt, instant);

      buckets.set(index, bucket);
    }

    const mean = (values: number[]): number =>
      values.length === 0 ? 0 : Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;

    const ordered = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([, bucket]) => bucket);

    const traffic = ordered.map(bucket => {
      const instants = [...bucket.trafficByInstant.values()];
      const inbound = instants.length === 0 ? 0 : instants.reduce((s, i) => s + i.inbound, 0) / instants.length;
      const outbound = instants.length === 0 ? 0 : instants.reduce((s, i) => s + i.outbound, 0) / instants.length;
      return {
        time: hourMinute(new Date(bucket.startMs)),
        inbound: Math.round(inbound * 10) / 10,
        outbound: Math.round(outbound * 10) / 10,
      };
    });

    const resource = ordered.map(bucket => ({
      time: hourMinute(new Date(bucket.startMs)),
      cpu: Math.round(mean(bucket.cpu)),
      ram: Math.round(mean(bucket.ram)),
      temp: Math.round(mean(bucket.temp)),
      pingMs: mean(bucket.pingMs),
    }));

    res.json({
      unit: 'Mbps',
      hours,
      points: ordered.length,
      sampleCount: samples.length,
      traffic,
      resource,
    });
  })
);

/**
 * GET /api/telemetry/top-ports?limit=5
 *
 * Busiest ports across the whole network — the "top talkers" table on the
 * Statistics page, from live interface counters.
 */
telemetryRouter.get(
  '/top-ports',
  requireOperator,
  asyncHandler(async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 5));

    const ports = await prisma.port.findMany({
      where: { status: { in: ['up', 'warning', 'error'] } },
      include: { device: { select: { name: true, ip: true, type: true } } },
    });

    const ranked = ports
      .map(port => ({
        deviceName: port.device.name,
        deviceIp: port.device.ip,
        portName: port.name,
        vlan: port.vlan,
        vlanName: port.vlanName,
        inMbps: port.inTrafficMbps,
        outMbps: port.outTrafficMbps,
        totalMbps: Math.round((port.inTrafficMbps + port.outTrafficMbps) * 100) / 100,
        connectedMac: port.connectedMac ?? undefined,
      }))
      .filter(entry => entry.totalMbps > 0)
      .sort((a, b) => b.totalMbps - a.totalMbps)
      .slice(0, limit);

    res.json(ranked);
  })
);

/**
 * GET /api/stream?token=<jwt>
 *
 * Server-sent events, so the browser learns about a finished poll cycle or a new
 * alert immediately instead of waiting for its own timer. EventSource cannot send
 * an Authorization header, which is why requireAuth also accepts ?token=.
 */
export const streamHandler = (req: AuthedRequest, res: import('express').Response): void => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx buffers SSE by default, which delays every event until the connection closes
    'X-Accel-Buffering': 'no',
  });

  const send = (event: unknown): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  send({ type: 'hello', at: nowTimestamp(), user: req.user?.name });

  const unsubscribe = events.subscribe(send);
  // Comment frames keep proxies and browsers from dropping an idle connection
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
};
