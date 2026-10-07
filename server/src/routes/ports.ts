import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/error.js';
import { HttpError, authorOf, requireAuth, requireOperator, type AuthedRequest } from '../middleware/auth.js';
import { serializePort } from '../services/serialize.js';
import { writeLog } from '../services/logs.js';
import { getSettings } from '../services/settings.js';
import { runPollCycle } from '../services/poller.js';
import { targetFromDevice } from '../snmp/target.js';
import { withSnmp } from '../snmp/client.js';
import { IF_ADMIN_STATUS, IF_MIB } from '../snmp/oids.js';
import { env } from '../env.js';

export const portsRouter = Router();

// The Ports page is hidden from Viewer (CLAUDE.md, section 2.3.6)
portsRouter.use(requireAuth, requireOperator);

/**
 * GET /api/ports
 *
 * Returns `{ [deviceId]: PortInfo[] }` — the exact shape of the frontend's
 * `portsByDevice` map, so the Ports page needs no reshaping.
 */
portsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const ports = await prisma.port.findMany({ orderBy: [{ deviceId: 'asc' }, { portId: 'asc' }] });
    const grouped: Record<string, ReturnType<typeof serializePort>[]> = {};
    for (const port of ports) {
      (grouped[port.deviceId] ??= []).push(serializePort(port));
    }
    res.json(grouped);
  })
);

portsRouter.get(
  '/:deviceId',
  asyncHandler(async (req, res) => {
    const ports = await prisma.port.findMany({
      where: { deviceId: req.params.deviceId },
      orderBy: { portId: 'asc' },
    });
    res.json(ports.map(serializePort));
  })
);

/**
 * POST /api/ports/:deviceId/:portId/admin
 *
 * Really shuts or un-shuts the port, by writing ifAdminStatus over SNMP.
 *
 * This needs a read-write credential: set `snmpWriteCommunity` on the device (v2c)
 * or give the v3 user write access. Without one the switch answers with a
 * no-access error and nothing changes, which is reported back as a 502.
 */
portsRouter.post(
  '/:deviceId/:portId/admin',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { adminUp } = z.object({ adminUp: z.boolean() }).parse(req.body);
    const portId = Number(req.params.portId);
    if (!Number.isInteger(portId)) throw new HttpError(400, 'Port id must be a number', 'BAD_PORT');

    const device = await prisma.device.findUnique({ where: { id: req.params.deviceId } });
    if (!device) throw new HttpError(404, 'Device not found', 'NOT_FOUND');

    const port = await prisma.port.findFirst({ where: { deviceId: device.id, portId } });
    if (!port) throw new HttpError(404, 'Port not found on this device', 'NOT_FOUND');

    if (device.snmpVersion === '2c' && !device.snmpWriteCommunity) {
      throw new HttpError(
        400,
        'This device has no SNMP write community configured, so its ports cannot be changed from NetMonitor. ' +
          'Add one in the device settings, or make the change on the switch itself.',
        'NO_WRITE_CREDENTIAL'
      );
    }

    const settings = await getSettings();
    const target = targetFromDevice(device, {
      snmpCommunity: device.snmpWriteCommunity ?? device.snmpCommunity,
      timeoutMs: settings.pingTimeoutMs > 0 ? settings.pingTimeoutMs : env.snmp.timeoutMs,
    });

    try {
      await withSnmp(target, session =>
        session.setInt(
          `${IF_MIB.ifAdminStatus}.${port.ifIndex}`,
          adminUp ? IF_ADMIN_STATUS.up : IF_ADMIN_STATUS.down
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SNMP SET failed';
      await writeLog({
        severity: 'Error',
        host: device.name,
        ip: device.ip,
        tag: '%NETMON-3-PORT_SET_FAILED',
        message: `${authorOf(req.user!)} tried to set ${port.name} ${adminUp ? 'up' : 'down'} but the device refused: ${message}`,
      });
      throw new HttpError(502, `The device refused the change: ${message}`, 'SNMP_SET_FAILED');
    }

    // Reflect the change immediately; the next poll confirms it from the device itself
    const updated = await prisma.port.update({
      where: { id: port.id },
      data: {
        adminUp,
        status: adminUp ? 'up' : 'down',
        // shutdown / no shutdown clears an err-disable, but a bad cable keeps failing CRC
        fault: adminUp && port.fault === 'crc' ? 'crc' : null,
        ...(adminUp && port.fault === 'crc' ? { status: 'error' } : {}),
      },
    });

    await writeLog({
      facility: 'LINK',
      severity: 'Notice',
      host: device.name,
      ip: device.ip,
      tag: '%NETMON-5-PORT_ADMIN',
      message: `${authorOf(req.user!)} set ${port.name} administratively ${adminUp ? 'up (no shutdown)' : 'down (shutdown)'}`,
    });

    // Re-poll in the background so counters and oper status catch up
    void runPollCycle([device.id]).catch(() => undefined);

    res.json(serializePort(updated));
  })
);
