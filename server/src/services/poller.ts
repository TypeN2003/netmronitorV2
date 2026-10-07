import type { Device, Port } from '@prisma/client';
import { prisma } from '../prisma.js';
import { env } from '../env.js';
import { nowTimestamp, parseTimestamp } from '../utils/time.js';
import { pollDevice, type PolledInterface, type PollResult } from '../snmp/collector.js';
import { targetFromDevice } from '../snmp/target.js';
import { getSettings } from './settings.js';
import { events } from './events.js';
import { writeLog, writeLogs, pruneLogs, type LogInput } from './logs.js';
import { ALERT_CATEGORY, autoResolveAlerts, raiseAlert } from './alerts.js';

export interface PollCycleSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  polled: number;
  reachable: number;
  failed: number;
  skipped: number;
  devices: Array<{ id: string; name: string; ip: string; ok: boolean; error?: string; responseMs: number }>;
}

// ---------------------------------------------------------------- small helpers

/** Run `tasks` with at most `limit` in flight, so a 200-device site does not open 200 sockets. */
const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
};

/**
 * Turn two counter readings into a rate.
 *
 * Returns 0 when the counter went backwards (device reboot or 64-bit wrap) rather
 * than reporting an absurd spike.
 */
const rateMbps = (
  current: bigint | null,
  previous: bigint | null | undefined,
  elapsedSeconds: number
): number => {
  if (current === null || previous === null || previous === undefined) return 0;
  if (elapsedSeconds <= 0) return 0;
  const delta = current - previous;
  if (delta < 0n) return 0;
  const bits = Number(delta) * 8;
  const mbps = bits / elapsedSeconds / 1_000_000;
  if (!Number.isFinite(mbps) || mbps < 0) return 0;
  return Math.round(mbps * 100) / 100;
};

const counterDelta = (current: bigint, previous: bigint | null | undefined): number => {
  if (previous === null || previous === undefined) return 0;
  const delta = current - previous;
  return delta < 0n ? 0 : Number(delta);
};

/** Device-level status, using the same thresholds the Dashboard cards count against. */
const statusFor = (cpu: number, ram: number): 'online' | 'warning' =>
  cpu >= env.cpuThreshold || ram >= env.ramThreshold ? 'warning' : 'online';

/**
 * Port state for the Ports page colour coding:
 * grey = not plugged in, red = faulty, orange = minor errors, green = up.
 */
const portStateFor = (
  iface: PolledInterface,
  fcsDelta: number,
  errorDelta: number
): { status: string; fault: string | null } => {
  if (iface.errDisabled) return { status: 'error', fault: 'errdisable' };
  if (!iface.adminUp) return { status: 'down', fault: null };
  if (!iface.operUp) return { status: 'down', fault: null };
  if (fcsDelta > 0) return { status: 'error', fault: 'crc' };
  if (errorDelta > 0) return { status: 'warning', fault: null };
  return { status: 'up', fault: null };
};

// ---------------------------------------------------------------- per-device persistence

const persistPorts = async (
  device: Device,
  interfaces: PolledInterface[],
  existingPorts: Port[],
  pollTimestamp: string
): Promise<{ portsTotal: number; portsUp: number; trafficInMbps: number; trafficOutMbps: number }> => {
  const physical = interfaces.filter(i => i.isPhysical);
  const byIfIndex = new Map(existingPorts.map(p => [p.ifIndex, p]));

  // Keep the human-facing port number stable across polls: existing ports keep theirs,
  // new ones are appended in ifIndex order.
  let nextPortId = existingPorts.reduce((max, p) => Math.max(max, p.portId), 0);

  let trafficIn = 0;
  let trafficOut = 0;
  let portsUp = 0;

  const vlanNameById = new Map(
    (await prisma.vlan.findMany({ select: { id: true, name: true } })).map(v => [v.id, v.name])
  );

  const operations: Array<Promise<unknown>> = [];

  for (const iface of physical) {
    const previous = byIfIndex.get(iface.ifIndex);
    const elapsedSeconds = previous?.lastPolledAt
      ? Math.max(1, (parseTimestamp(pollTimestamp) - parseTimestamp(previous.lastPolledAt)) / 1000)
      : 0;

    const inMbps = rateMbps(iface.inOctets, previous?.lastInOctets ?? null, elapsedSeconds);
    const outMbps = rateMbps(iface.outOctets, previous?.lastOutOctets ?? null, elapsedSeconds);
    const fcsDelta = counterDelta(iface.fcsErrors, previous?.lastFcsErrors);
    const errorDelta = counterDelta(iface.errorTotal, previous?.lastErrorTotal);
    const { status, fault } = portStateFor(iface, fcsDelta, errorDelta);

    if (status !== 'down') portsUp += 1;
    trafficIn += inMbps;
    trafficOut += outMbps;

    const portId = previous?.portId ?? ++nextPortId;
    const data = {
      portId,
      name: iface.name,
      status,
      fault,
      speed: iface.speedLabel,
      duplex: iface.duplex,
      vlan: iface.vlan,
      vlanName: vlanNameById.get(iface.vlan) ?? `VLAN${iface.vlan}`,
      poeWatts: iface.poeWatts,
      inTrafficMbps: inMbps,
      outTrafficMbps: outMbps,
      errorDiscards: errorDelta,
      connectedMac: iface.connectedMac,
      adminUp: iface.adminUp,
      portType: iface.portType,
      lastInOctets: iface.inOctets,
      lastOutOctets: iface.outOctets,
      lastErrorTotal: iface.errorTotal,
      lastFcsErrors: iface.fcsErrors,
      lastPolledAt: pollTimestamp,
    };

    operations.push(
      prisma.port.upsert({
        where: { deviceId_ifIndex: { deviceId: device.id, ifIndex: iface.ifIndex } },
        create: { deviceId: device.id, ifIndex: iface.ifIndex, ...data },
        update: data,
      })
    );
  }

  await Promise.all(operations);

  // Interfaces that disappeared (module pulled, stack member removed) should not linger
  const seen = new Set(physical.map(i => i.ifIndex));
  const stale = existingPorts.filter(p => !seen.has(p.ifIndex)).map(p => p.id);
  if (stale.length > 0) await prisma.port.deleteMany({ where: { id: { in: stale } } });

  return {
    portsTotal: physical.length,
    portsUp,
    trafficInMbps: Math.round(trafficIn * 100) / 100,
    trafficOutMbps: Math.round(trafficOut * 100) / 100,
  };
};

/** Add VLANs the collector found on a device, without touching ones a human created. */
const persistDiscoveredVlans = async (vlans: Array<{ id: number; name: string }>): Promise<void> => {
  if (vlans.length === 0) return;
  const existing = new Set((await prisma.vlan.findMany({ select: { id: true } })).map(v => v.id));
  const fresh = vlans.filter(v => !existing.has(v.id));
  if (fresh.length === 0) return;

  await prisma.vlan.createMany({
    data: fresh.map(vlan => ({
      id: vlan.id,
      name: vlan.name,
      description: 'Discovered over SNMP',
      discovered: true,
      status: 'active',
    })),
  });
};

/** Recompute the per-VLAN rollups the VLAN page shows, from the live port rows. */
const refreshVlanRollups = async (): Promise<void> => {
  const ports = await prisma.port.findMany({
    select: { vlan: true, status: true, inTrafficMbps: true, outTrafficMbps: true },
  });

  const stats = new Map<number, { active: number; traffic: number }>();
  for (const port of ports) {
    const entry = stats.get(port.vlan) ?? { active: 0, traffic: 0 };
    if (port.status === 'up' || port.status === 'warning') entry.active += 1;
    entry.traffic += port.inTrafficMbps + port.outTrafficMbps;
    stats.set(port.vlan, entry);
  }

  const vlans = await prisma.vlan.findMany({ select: { id: true } });
  await Promise.all(
    vlans.map(vlan => {
      const entry = stats.get(vlan.id) ?? { active: 0, traffic: 0 };
      return prisma.vlan.update({
        where: { id: vlan.id },
        data: {
          activePorts: entry.active,
          trafficRateMbps: Math.round(entry.traffic * 100) / 100,
        },
      });
    })
  );
};

/** Topology nodes bound to a device follow its live status, so the map colours match. */
const syncTopologyStatus = async (): Promise<void> => {
  const nodes = await prisma.topologyNode.findMany({
    where: { deviceId: { not: null } },
    select: { id: true, status: true, deviceId: true },
  });
  if (nodes.length === 0) return;

  const devices = await prisma.device.findMany({ select: { id: true, status: true } });
  const statusById = new Map(devices.map(d => [d.id, d.status]));

  await Promise.all(
    nodes
      .filter(node => node.deviceId && statusById.get(node.deviceId) !== node.status)
      .map(node =>
        prisma.topologyNode.update({
          where: { id: node.id },
          data: { status: statusById.get(node.deviceId as string) ?? 'offline' },
        })
      )
  );

  // A link is only up when both ends are up
  const links = await prisma.topologyLink.findMany();
  const allNodes = await prisma.topologyNode.findMany({ select: { id: true, status: true } });
  const nodeStatus = new Map(allNodes.map(n => [n.id, n.status]));
  await Promise.all(
    links.map(link => {
      const source = nodeStatus.get(link.source);
      const target = nodeStatus.get(link.target);
      const next =
        source === 'offline' || target === 'offline'
          ? 'down'
          : source === 'warning' || target === 'warning'
            ? 'degraded'
            : 'up';
      if (next === link.status) return Promise.resolve();
      return prisma.topologyLink.update({ where: { id: link.id }, data: { status: next } });
    })
  );
};

// ---------------------------------------------------------------- one device

const applyResult = async (
  device: Device,
  result: PollResult,
  pollTimestamp: string
): Promise<{ ok: boolean; error?: string; responseMs: number }> => {
  if (!result.reachable) {
    const failCount = device.failCount + 1;
    await prisma.device.update({
      where: { id: device.id },
      data: {
        status: 'offline',
        pingMs: 0,
        trafficInMbps: 0,
        trafficOutMbps: 0,
        cpu: 0,
        ram: 0,
        failCount,
        lastError: result.error,
        lastPolledAt: pollTimestamp,
        updatedAt: pollTimestamp,
      },
    });

    // Every port of an unreachable device is unknown, not up
    await prisma.port.updateMany({
      where: { deviceId: device.id },
      data: { status: 'down', inTrafficMbps: 0, outTrafficMbps: 0 },
    });

    // Only alert on the transition into offline, not on every cycle while it stays down
    if (device.status !== 'offline') {
      await raiseAlert({
        deviceName: device.name,
        deviceIp: device.ip,
        severity: 'critical',
        category: ALERT_CATEGORY.unreachable,
        message: `SNMP poll failed: ${result.error}`,
        messageTh: `ดึงข้อมูล SNMP ไม่สำเร็จ: ${result.error}`,
      });
      await writeLog({
        severity: 'Critical',
        host: device.name,
        ip: device.ip,
        tag: '%NETMON-2-DEVICE_UNREACHABLE',
        message: `Device stopped answering SNMP: ${result.error}`,
      });
    }

    return { ok: false, error: result.error, responseMs: result.responseMs };
  }

  const existingPorts = await prisma.port.findMany({ where: { deviceId: device.id } });
  await persistDiscoveredVlans(result.vlans);
  const portStats = await persistPorts(device, result.interfaces, existingPorts, pollTimestamp);

  const status = statusFor(result.cpu, result.ram);
  const logs: LogInput[] = [];

  await prisma.device.update({
    where: { id: device.id },
    data: {
      status,
      uptime: result.uptime,
      cpu: result.cpu,
      ram: result.ram,
      temp: result.temp,
      pingMs: Math.round(result.responseMs * 10) / 10,
      portsTotal: portStats.portsTotal,
      portsUp: portStats.portsUp,
      trafficInMbps: portStats.trafficInMbps,
      trafficOutMbps: portStats.trafficOutMbps,
      lastSeen: pollTimestamp,
      lastPolledAt: pollTimestamp,
      failCount: 0,
      lastError: result.missing.length > 0 ? `Agent did not report: ${result.missing.join(', ')}` : null,
      // Identity fields only fill blanks — a value typed by an operator is not overwritten
      mac: device.mac || result.mac,
      vendor: device.vendor && device.vendor !== 'Unknown' ? device.vendor : result.vendorLabel,
      model: device.model || result.model,
      firmware: !device.firmware || device.firmware === '-' ? result.firmware : device.firmware,
      updatedAt: pollTimestamp,
    },
  });

  await prisma.telemetrySample.create({
    data: {
      deviceId: device.id,
      takenAt: pollTimestamp,
      takenAtMs: BigInt(parseTimestamp(pollTimestamp)),
      cpu: result.cpu,
      ram: result.ram,
      temp: result.temp,
      pingMs: Math.round(result.responseMs * 10) / 10,
      trafficInMbps: portStats.trafficInMbps,
      trafficOutMbps: portStats.trafficOutMbps,
      status,
    },
  });

  // Came back from offline
  if (device.status === 'offline') {
    await autoResolveAlerts(
      device.name,
      ALERT_CATEGORY.unreachable,
      `Device answered SNMP again (uptime ${result.uptime})`
    );
    logs.push({
      severity: 'Notice',
      host: device.name,
      ip: device.ip,
      tag: '%NETMON-5-DEVICE_RECOVERED',
      message: `Device answering SNMP again after ${device.failCount} failed poll(s), uptime ${result.uptime}`,
    });
  }

  // Resource thresholds — the same rule and copy the frontend used in demo mode
  const reasons = [
    result.cpu >= env.cpuThreshold && `CPU ${result.cpu}% (threshold ${env.cpuThreshold}%)`,
    result.ram >= env.ramThreshold && `Memory ${result.ram}% (threshold ${env.ramThreshold}%)`,
  ].filter(Boolean) as string[];

  if (reasons.length > 0) {
    const created = await raiseAlert({
      deviceName: device.name,
      deviceIp: device.ip,
      severity: result.cpu >= 95 || result.ram >= 95 ? 'critical' : 'warning',
      category: ALERT_CATEGORY.resource,
      message: `Resource usage exceeded threshold: ${reasons.join(', ')}.`,
      messageTh: `การใช้ทรัพยากรเกินเกณฑ์: ${reasons.join(', ').replace(/threshold/g, 'เกณฑ์')}`,
    });
    if (created) {
      logs.push({
        severity: 'Warning',
        host: device.name,
        ip: device.ip,
        tag: '%NETMON-4-THRESHOLD',
        message: `Threshold exceeded: ${reasons.join(', ')}`,
      });
    }
  } else {
    await autoResolveAlerts(
      device.name,
      ALERT_CATEGORY.resource,
      `Back under thresholds (CPU ${result.cpu}%, RAM ${result.ram}%)`
    );
  }

  // Ports that changed to or from up since the last cycle
  const previousStatus = new Map(existingPorts.map(p => [p.ifIndex, p.status]));
  for (const iface of result.interfaces.filter(i => i.isPhysical)) {
    const before = previousStatus.get(iface.ifIndex);
    if (before === undefined) continue;
    const after = iface.operUp && iface.adminUp ? 'up' : 'down';
    const wasUp = before === 'up' || before === 'warning' || before === 'error';
    if (wasUp && after === 'down') {
      logs.push({
        facility: 'LINK',
        severity: 'Warning',
        host: device.name,
        ip: device.ip,
        tag: '%LINK-3-UPDOWN',
        message: `Interface ${iface.name}, changed state to down`,
      });
    } else if (!wasUp && after === 'up') {
      logs.push({
        facility: 'LINK',
        severity: 'Notice',
        host: device.name,
        ip: device.ip,
        tag: '%LINK-3-UPDOWN',
        message: `Interface ${iface.name}, changed state to up`,
      });
    }
  }

  await writeLogs(logs);
  return { ok: true, responseMs: result.responseMs };
};

// ---------------------------------------------------------------- cycle + scheduler

let cycleInFlight: Promise<PollCycleSummary> | null = null;
let timer: NodeJS.Timeout | null = null;
let lastSummary: PollCycleSummary | null = null;

/**
 * Poll every enabled device once.
 *
 * Concurrent calls share one run: the Refresh button and the scheduler firing at the
 * same moment must not double-poll a device, which would halve every traffic delta.
 */
export const runPollCycle = async (deviceIds?: string[]): Promise<PollCycleSummary> => {
  if (cycleInFlight) return cycleInFlight;

  cycleInFlight = (async (): Promise<PollCycleSummary> => {
    const started = Date.now();
    const startedAt = nowTimestamp(new Date(started));
    const settings = await getSettings();

    const all = await prisma.device.findMany({
      where: deviceIds ? { id: { in: deviceIds } } : undefined,
      orderBy: { name: 'asc' },
    });
    const pollable = all.filter(d => d.pollEnabled);
    const timeoutMs = settings.pingTimeoutMs > 0 ? settings.pingTimeoutMs : env.snmp.timeoutMs;

    const outcomes = await mapLimit(pollable, env.snmp.concurrency, async device => {
      const pollTimestamp = nowTimestamp();
      const result = await pollDevice(targetFromDevice(device, { timeoutMs }));
      try {
        const applied = await applyResult(device, result, pollTimestamp);
        return { device, ...applied };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to store poll result';
        console.error(`[poller] ${device.name}: ${message}`);
        return { device, ok: false, error: message, responseMs: result.responseMs };
      }
    });

    if (outcomes.some(o => o.ok)) {
      await refreshVlanRollups();
    }
    await syncTopologyStatus();
    await pruneTelemetry();
    await pruneLogs();

    const finished = Date.now();
    const summary: PollCycleSummary = {
      startedAt,
      finishedAt: nowTimestamp(new Date(finished)),
      durationMs: finished - started,
      polled: pollable.length,
      reachable: outcomes.filter(o => o.ok).length,
      failed: outcomes.filter(o => !o.ok).length,
      skipped: all.length - pollable.length,
      devices: outcomes.map(o => ({
        id: o.device.id,
        name: o.device.name,
        ip: o.device.ip,
        ok: o.ok,
        error: o.error,
        responseMs: o.responseMs,
      })),
    };

    lastSummary = summary;
    events.publish({
      type: 'telemetry',
      at: summary.finishedAt,
      polled: summary.polled,
      reachable: summary.reachable,
      failed: summary.failed,
    });

    return summary;
  })();

  try {
    return await cycleInFlight;
  } finally {
    cycleInFlight = null;
  }
};

/** Delete telemetry older than TELEMETRY_RETENTION_HOURS so SQLite stays small. */
const pruneTelemetry = async (): Promise<void> => {
  const cutoff = BigInt(Date.now() - env.telemetryRetentionHours * 3600 * 1000);
  await prisma.telemetrySample.deleteMany({ where: { takenAtMs: { lt: cutoff } } });
};

export const getLastCycleSummary = (): PollCycleSummary | null => lastSummary;

/**
 * Start the scheduler.
 *
 * Re-reads `snmpInterval` after every cycle, so saving a new interval on the Settings
 * page takes effect without a restart. A cycle that overruns the interval simply
 * delays the next one instead of stacking.
 */
export const startPoller = (): void => {
  if (!env.pollerEnabled) {
    console.log('[poller] disabled by POLLER_ENABLED=false — the API will serve whatever is already in the database');
    return;
  }

  const scheduleNext = async (): Promise<void> => {
    const settings = await getSettings().catch(() => null);
    const seconds = Math.max(15, settings?.snmpInterval ?? 300);
    timer = setTimeout(() => void tick(), seconds * 1000);
  };

  const tick = async (): Promise<void> => {
    try {
      const summary = await runPollCycle();
      console.log(
        `[poller] ${summary.finishedAt} polled ${summary.polled} device(s) in ${summary.durationMs} ms ` +
          `(${summary.reachable} reachable, ${summary.failed} failed)`
      );
    } catch (error) {
      console.error('[poller] cycle failed:', error instanceof Error ? error.message : error);
    } finally {
      void scheduleNext();
    }
  };

  // First cycle shortly after boot so the UI is not empty on the first page load
  timer = setTimeout(() => void tick(), 2000);
  console.log('[poller] started');
};

export const stopPoller = (): void => {
  if (timer) clearTimeout(timer);
  timer = null;
};
