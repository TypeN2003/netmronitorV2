import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/error.js';
import {
  HttpError,
  authorOf,
  requireAdmin,
  requireAuth,
  requireOperator,
  type AuthedRequest,
} from '../middleware/auth.js';
import { sha256, uid } from '../utils/id.js';
import { nowTimestamp } from '../utils/time.js';
import { serializeDevice } from '../services/serialize.js';
import { writeLog } from '../services/logs.js';
import { events } from '../services/events.js';
import { getSettings } from '../services/settings.js';
import { runPollCycle } from '../services/poller.js';
import { pollDevice } from '../snmp/collector.js';
import { targetFromDevice } from '../snmp/target.js';
import { env } from '../env.js';

export const devicesRouter = Router();
devicesRouter.use(requireAuth);

const DEVICE_TYPES = [
  'Router',
  'Core Switch',
  'Distribution Switch',
  'Edge Switch',
  'Firewall',
  'Server',
] as const;

/** Where a new device of each type lands on the topology map. Mirrors TOPOLOGY_PLACEMENT. */
const TOPOLOGY_PLACEMENT: Record<string, { type: string; tier: number }> = {
  Router: { type: 'router', tier: 1 },
  Firewall: { type: 'firewall', tier: 2 },
  'Core Switch': { type: 'core_switch', tier: 3 },
  'Distribution Switch': { type: 'dist_switch', tier: 4 },
  'Edge Switch': { type: 'edge_ap', tier: 5 },
  Server: { type: 'server', tier: 4 },
};

const LINK_SPEED_LABEL: Record<string, string> = {
  fiber_10g: '10 Gbps SFP+',
  copper_1g: '1 Gbps Cat6',
  fiber_40g: '40 Gbps QSFP+',
  trunk: 'VLAN 802.1Q Trunk',
};

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

const snmpSchema = z.object({
  snmpVersion: z.enum(['2c', '3']).optional(),
  snmpPort: z.number().int().min(1).max(65535).optional(),
  snmpCommunity: z.string().max(200).optional(),
  // Separate RW community; required before the Ports page can shut / no-shut a port
  snmpWriteCommunity: z.string().max(200).optional(),
  snmpV3User: z.string().max(200).optional(),
  snmpV3SecurityLevel: z.enum(['noAuthNoPriv', 'authNoPriv', 'authPriv']).optional(),
  snmpV3AuthProtocol: z.enum(['md5', 'sha', 'sha224', 'sha256', 'sha384', 'sha512']).optional(),
  snmpV3AuthKey: z.string().max(200).optional(),
  snmpV3PrivProtocol: z.enum(['des', 'aes', 'aes256b', 'aes256r']).optional(),
  snmpV3PrivKey: z.string().max(200).optional(),
  snmpV3Context: z.string().max(200).optional(),
});

const deviceBaseSchema = snmpSchema.extend({
  name: z.string().trim().min(1, 'Device name is required').max(120),
  ip: z.string().trim().regex(IPV4, 'Enter a valid IPv4 address'),
  type: z.enum(DEVICE_TYPES),
  mac: z.string().trim().max(32).optional(),
  vendor: z.string().trim().max(120).optional(),
  model: z.string().trim().max(160).optional(),
  location: z.string().trim().max(200).optional(),
  rack: z.string().trim().max(120).optional(),
  firmware: z.string().trim().max(160).optional(),
  config: z.string().max(2_000_000).optional(),
  pollEnabled: z.boolean().optional(),
});

/** SNMPv3 without a username cannot authenticate, so reject it before it reaches the poller. */
const assertSnmpUsable = (input: z.infer<typeof snmpSchema>, current?: { snmpV3User?: string | null }): void => {
  if (input.snmpVersion !== '3') return;
  const user = input.snmpV3User ?? current?.snmpV3User ?? '';
  if (!user.trim()) {
    throw new HttpError(400, 'SNMPv3 requires a username', 'SNMPV3_NO_USER');
  }
};

// ---------------------------------------------------------------- read

devicesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const devices = await prisma.device.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] });
    res.json(devices.map(serializeDevice));
  })
);

devicesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) throw new HttpError(404, 'Device not found', 'NOT_FOUND');
    res.json(serializeDevice(device));
  })
);

// ---------------------------------------------------------------- SNMP probe

/**
 * POST /api/devices/test-snmp
 *
 * Reach out to an address with the supplied credentials and report what came back.
 * The Add Device dialog calls this before saving, so an operator finds out about a
 * wrong community string immediately instead of seeing a device stuck at "offline".
 */
devicesRouter.post(
  '/test-snmp',
  requireOperator,
  asyncHandler(async (req, res) => {
    const schema = snmpSchema.extend({
      ip: z.string().trim().regex(IPV4, 'Enter a valid IPv4 address'),
      withPorts: z.boolean().optional(),
    });
    const input = schema.parse(req.body);
    assertSnmpUsable(input);

    const settings = await getSettings();
    const target = targetFromDevice(
      {
        ip: input.ip,
        snmpVersion: input.snmpVersion ?? '2c',
        snmpPort: input.snmpPort ?? 161,
        snmpCommunity: input.snmpCommunity ?? 'public',
        snmpV3User: input.snmpV3User ?? null,
        snmpV3SecurityLevel: input.snmpV3SecurityLevel ?? 'authPriv',
        snmpV3AuthProtocol: input.snmpV3AuthProtocol ?? 'sha',
        snmpV3AuthKey: input.snmpV3AuthKey ?? null,
        snmpV3PrivProtocol: input.snmpV3PrivProtocol ?? 'aes',
        snmpV3PrivKey: input.snmpV3PrivKey ?? null,
        snmpV3Context: input.snmpV3Context ?? null,
      },
      { timeoutMs: settings.pingTimeoutMs > 0 ? settings.pingTimeoutMs : env.snmp.timeoutMs }
    );

    const result = await pollDevice(target, { withPorts: input.withPorts !== false });

    if (!result.reachable) {
      res.status(200).json({ reachable: false, error: result.error, responseMs: result.responseMs });
      return;
    }

    const physical = result.interfaces.filter(i => i.isPhysical);
    res.json({
      reachable: true,
      responseMs: result.responseMs,
      // Suggested inventory fields — the dialog pre-fills its form from these
      suggested: {
        name: result.sysName || undefined,
        vendor: result.vendorLabel,
        model: result.model || undefined,
        firmware: result.firmware || undefined,
        location: result.sysLocation || undefined,
        mac: result.mac || undefined,
      },
      metrics: { cpu: result.cpu, ram: result.ram, temp: result.temp, uptime: result.uptime },
      sysDescr: result.sysDescr,
      serial: result.serial || undefined,
      interfaceCount: result.interfaces.length,
      physicalPortCount: physical.length,
      portsUp: physical.filter(i => i.operUp && i.adminUp).length,
      vlans: result.vlans,
      // Metrics the agent refused to answer, so the UI can say why CPU reads 0%
      missing: result.missing,
    });
  })
);

// ---------------------------------------------------------------- create

/**
 * POST /api/devices
 *
 * Registers a device and, when `topology` is supplied, does everything
 * provisionDeviceFromConfig used to do in the browser: inventory row, topology node,
 * link to the chosen parent, a baseline config backup and a syslog entry.
 */
devicesRouter.post(
  '/',
  requireOperator,
  asyncHandler(async (req: AuthedRequest, res) => {
    const schema = deviceBaseSchema.extend({
      topology: z
        .object({
          parentNodeId: z.string().nullable().optional(),
          linkType: z.enum(['fiber_10g', 'copper_1g', 'fiber_40g', 'trunk']).default('fiber_10g'),
          addNode: z.boolean().optional(),
        })
        .optional(),
    });
    const input = schema.parse(req.body);
    assertSnmpUsable(input);

    if (await prisma.device.findFirst({ where: { name: input.name } })) {
      throw new HttpError(409, 'A device with this name already exists', 'NAME_TAKEN');
    }
    if (await prisma.device.findFirst({ where: { ip: input.ip } })) {
      throw new HttpError(409, 'A device with this IP already exists', 'IP_TAKEN');
    }

    const now = nowTimestamp();
    const author = authorOf(req.user!);

    const device = await prisma.device.create({
      data: {
        id: uid('dev'),
        name: input.name,
        ip: input.ip,
        mac: input.mac ?? '',
        type: input.type,
        vendor: input.vendor || 'Unknown',
        model: input.model ?? '',
        location: input.location || '-',
        rack: input.rack || '-',
        firmware: input.firmware || '-',
        config: input.config,
        // Starts offline on purpose: the first poll decides whether it is really there
        status: 'offline',
        uptime: '-',
        lastSeen: 'Never',
        snmpVersion: input.snmpVersion ?? '2c',
        snmpPort: input.snmpPort ?? 161,
        snmpCommunity: input.snmpCommunity ?? 'public',
        snmpWriteCommunity: input.snmpWriteCommunity || null,
        snmpV3User: input.snmpV3User,
        snmpV3SecurityLevel: input.snmpV3SecurityLevel ?? 'authPriv',
        snmpV3AuthProtocol: input.snmpV3AuthProtocol ?? 'sha',
        snmpV3AuthKey: input.snmpV3AuthKey,
        snmpV3PrivProtocol: input.snmpV3PrivProtocol ?? 'aes',
        snmpV3PrivKey: input.snmpV3PrivKey,
        snmpV3Context: input.snmpV3Context,
        pollEnabled: input.pollEnabled ?? true,
        createdAt: now,
        updatedAt: now,
      },
    });

    // Baseline backup, so there is always a known-good config to roll back to
    if (input.config && input.config.trim()) {
      const content = input.config;
      await prisma.backup.create({
        data: {
          id: uid('bk'),
          deviceId: device.id,
          deviceName: device.name,
          deviceIp: device.ip,
          deviceType: device.type,
          versionTag: 'Initial Import',
          timestamp: now,
          sizeKb: Math.max(0.1, Math.round((content.length / 1024) * 10) / 10),
          checksumSha256: sha256(content),
          triggeredBy: author,
          triggerType: 'manual',
          configContent: content,
          format: device.type === 'Firewall' ? 'fortios' : content.trimStart().startsWith('{') ? 'json' : 'cisco_ios',
          notes: 'Baseline config archived when the device was registered',
        },
      });
    }

    let parentLabel: string | null = null;
    if (input.topology?.addNode !== false) {
      const placement = TOPOLOGY_PLACEMENT[device.type] ?? { type: 'dist_switch', tier: 4 };
      const nodes = await prisma.topologyNode.findMany();
      const parent = input.topology?.parentNodeId
        ? nodes.find(n => n.id === input.topology?.parentNodeId) ?? null
        : null;

      // One row below the parent, sliding right until it stops overlapping a neighbour
      const y = parent ? parent.y + 150 : Math.max(0, ...nodes.map(n => n.y), 0) + 150;
      let x = parent ? parent.x : 620;
      while (nodes.some(n => Math.abs(n.y - y) < 80 && Math.abs(n.x - x) < 180)) x += 200;

      const node = await prisma.topologyNode.create({
        data: {
          id: uid('node'),
          label: device.name,
          ip: device.ip,
          tier: placement.tier,
          type: placement.type,
          status: device.status,
          x,
          y,
          model: device.model || null,
          deviceId: device.id,
        },
      });

      if (parent) {
        parentLabel = parent.label;
        const linkType = input.topology?.linkType ?? 'fiber_10g';
        await prisma.topologyLink.create({
          data: {
            id: uid('link'),
            source: parent.id,
            target: node.id,
            speed: LINK_SPEED_LABEL[linkType],
            linkType,
            status: 'up',
          },
        });
      }
    }

    await writeLog({
      severity: 'Notice',
      host: device.name,
      ip: device.ip,
      tag: '%NETMON-5-DEVICE_PROVISIONED',
      message:
        `Device registered by ${author}` +
        (parentLabel ? ` and linked to ${parentLabel}` : '') +
        ` (SNMP v${device.snmpVersion} on udp/${device.snmpPort})`,
    });

    events.publish({ type: 'device', at: now, deviceId: device.id, action: 'created' });

    // Poll it straight away so the operator sees real numbers instead of an empty row
    void runPollCycle([device.id]).catch(() => undefined);

    res.status(201).json(serializeDevice(device));
  })
);

// ---------------------------------------------------------------- update

devicesRouter.patch(
  '/:id',
  requireOperator,
  asyncHandler(async (req: AuthedRequest, res) => {
    const schema = deviceBaseSchema.partial();
    const input = schema.parse(req.body);

    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) throw new HttpError(404, 'Device not found', 'NOT_FOUND');
    assertSnmpUsable(input, device);

    if (input.name && input.name !== device.name) {
      if (await prisma.device.findFirst({ where: { name: input.name } })) {
        throw new HttpError(409, 'A device with this name already exists', 'NAME_TAKEN');
      }
    }
    if (input.ip && input.ip !== device.ip) {
      if (await prisma.device.findFirst({ where: { ip: input.ip } })) {
        throw new HttpError(409, 'A device with this IP already exists', 'IP_TAKEN');
      }
    }

    const now = nowTimestamp();
    const updated = await prisma.device.update({
      where: { id: device.id },
      data: { ...input, updatedAt: now },
    });

    // Keep the topology node label and address in step with the inventory
    if (input.name || input.ip || input.model) {
      await prisma.topologyNode.updateMany({
        where: { deviceId: device.id },
        data: {
          ...(input.name ? { label: input.name } : {}),
          ...(input.ip ? { ip: input.ip } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
        },
      });
    }

    const credentialsChanged = Object.keys(input).some(key => key.startsWith('snmp')) || input.ip !== undefined;
    if (credentialsChanged) {
      await writeLog({
        severity: 'Notice',
        host: updated.name,
        ip: updated.ip,
        tag: '%NETMON-5-SNMP_RECONFIGURED',
        message: `${authorOf(req.user!)} changed the SNMP settings for this device`,
      });
      void runPollCycle([updated.id]).catch(() => undefined);
    }

    events.publish({ type: 'device', at: now, deviceId: updated.id, action: 'updated' });
    res.json(serializeDevice(updated));
  })
);

// ---------------------------------------------------------------- poll on demand

devicesRouter.post(
  '/:id/poll',
  asyncHandler(async (req, res) => {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) throw new HttpError(404, 'Device not found', 'NOT_FOUND');
    const summary = await runPollCycle([device.id]);
    const fresh = await prisma.device.findUnique({ where: { id: device.id } });
    res.json({ summary, device: fresh ? serializeDevice(fresh) : null });
  })
);

// ---------------------------------------------------------------- delete (Admin only)

devicesRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req: AuthedRequest, res) => {
    const device = await prisma.device.findUnique({ where: { id: req.params.id } });
    if (!device) throw new HttpError(404, 'Device not found', 'NOT_FOUND');

    // Ports, telemetry and the topology node go with it; backups keep their history
    // with deviceId set to null so the archive is not silently destroyed.
    const nodes = await prisma.topologyNode.findMany({ where: { deviceId: device.id }, select: { id: true } });
    const nodeIds = nodes.map(n => n.id);
    if (nodeIds.length > 0) {
      await prisma.topologyLink.deleteMany({
        where: { OR: [{ source: { in: nodeIds } }, { target: { in: nodeIds } }] },
      });
      await prisma.topologyNode.deleteMany({ where: { id: { in: nodeIds } } });
    }
    await prisma.device.delete({ where: { id: device.id } });

    await writeLog({
      severity: 'Warning',
      host: device.name,
      ip: device.ip,
      tag: '%NETMON-4-DEVICE_REMOVED',
      message: `Device removed from monitoring by ${authorOf(req.user!)}`,
    });

    events.publish({ type: 'device', at: nowTimestamp(), deviceId: device.id, action: 'deleted' });
    res.json({ success: true });
  })
);
