import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/error.js';
import { HttpError, authorOf, requireAuth, requireOperator, type AuthedRequest } from '../middleware/auth.js';
import { sha256, uid } from '../utils/id.js';
import { nowTimestamp } from '../utils/time.js';
import { serializeBackup } from '../services/serialize.js';
import { writeLog } from '../services/logs.js';

export const backupsRouter = Router();

// Backup Manager is hidden from Viewer (CLAUDE.md, section 2.3.6)
backupsRouter.use(requireAuth, requireOperator);

const formatFor = (deviceType: string, vendor: string, content: string): string => {
  if (content.trimStart().startsWith('{')) return 'json';
  if (deviceType === 'Firewall' || /fortinet/i.test(vendor)) return 'fortios';
  if (/cisco/i.test(vendor)) return 'cisco_ios';
  return 'generic';
};

backupsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
    const backups = await prisma.backup.findMany({
      where: deviceId ? { deviceId } : undefined,
      orderBy: { timestamp: 'desc' },
    });
    res.json(backups.map(serializeBackup));
  })
);

/**
 * POST /api/backups
 *
 * Archives a device configuration with a real SHA-256 checksum.
 *
 * NetMonitor does not log into devices, so it cannot pull `show running-config` by
 * itself. Supply the text as `configContent` (paste or file upload in the Backup
 * Manager) and it is archived and kept as the device's current config. With no text
 * and nothing stored yet, the request is rejected rather than archiving an empty file.
 */
backupsRouter.post(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const schema = z.object({
      deviceId: z.string().min(1),
      versionTag: z.string().trim().min(1).max(120),
      triggerType: z.enum(['manual', 'scheduled', 'pre-change']).default('manual'),
      notes: z.string().trim().max(1000).optional(),
      configContent: z.string().max(2_000_000).optional(),
    });
    const input = schema.parse(req.body);

    const device = await prisma.device.findUnique({ where: { id: input.deviceId } });
    if (!device) throw new HttpError(404, 'Device not found', 'NOT_FOUND');

    const content = (input.configContent ?? device.config ?? '').trim();
    if (!content) {
      throw new HttpError(
        400,
        `No configuration stored for ${device.name}. Paste or upload its running-config to archive a snapshot.`,
        'NO_CONFIG'
      );
    }

    const author = authorOf(req.user!);
    const timestamp = nowTimestamp();

    const backup = await prisma.backup.create({
      data: {
        id: uid('bk'),
        deviceId: device.id,
        deviceName: device.name,
        deviceIp: device.ip,
        deviceType: device.type,
        versionTag: input.versionTag,
        timestamp,
        sizeKb: Math.max(0.1, Math.round((content.length / 1024) * 10) / 10),
        checksumSha256: sha256(content),
        triggeredBy: author,
        triggerType: input.triggerType,
        configContent: content,
        format: formatFor(device.type, device.vendor, content),
        notes: input.notes || `Snapshot archived by ${author}`,
      },
    });

    // A freshly supplied config becomes the device's current one
    if (input.configContent && content !== (device.config ?? '').trim()) {
      await prisma.device.update({ where: { id: device.id }, data: { config: content, updatedAt: timestamp } });
    }

    await writeLog({
      severity: 'Info',
      host: device.name,
      ip: device.ip,
      tag: '%CFG-6-BACKUP_ARCHIVED',
      message: `Configuration backup [${input.versionTag}] created by ${author} (SHA-256: ${backup.checksumSha256.slice(0, 12)}...)`,
    });

    res.status(201).json(serializeBackup(backup));
  })
);

/**
 * POST /api/backups/:id/restore
 *
 * Rolls the archive back: the stored config becomes the device's current config in
 * NetMonitor. It is NOT pushed to the hardware — someone still has to apply it on the
 * device. The syslog entry says so, so the audit trail is not misleading.
 */
backupsRouter.post(
  '/:id/restore',
  asyncHandler(async (req: AuthedRequest, res) => {
    const backup = await prisma.backup.findUnique({ where: { id: req.params.id } });
    if (!backup) throw new HttpError(404, 'Backup not found', 'NOT_FOUND');

    const author = authorOf(req.user!);
    const timestamp = nowTimestamp();

    if (backup.deviceId) {
      await prisma.device.update({
        where: { id: backup.deviceId },
        data: { config: backup.configContent, updatedAt: timestamp },
      });
    }

    await writeLog({
      severity: 'Notice',
      host: backup.deviceName,
      ip: backup.deviceIp,
      tag: '%CFG-5-RESTORE_STAGED',
      message:
        `Configuration rolled back to [${backup.versionTag}] by ${author} in NetMonitor. ` +
        'Apply it on the device to take effect.',
    });

    res.json({
      success: true,
      appliedToDevice: false,
      message: 'The archived config is now the recorded config. Apply it on the device to take effect.',
    });
  })
);

backupsRouter.delete(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const backup = await prisma.backup.findUnique({ where: { id: req.params.id } });
    if (!backup) throw new HttpError(404, 'Backup not found', 'NOT_FOUND');

    await prisma.backup.delete({ where: { id: backup.id } });
    await writeLog({
      severity: 'Warning',
      host: backup.deviceName,
      ip: backup.deviceIp,
      tag: '%CFG-4-BACKUP_DELETED',
      message: `Backup [${backup.versionTag}] from ${backup.timestamp} deleted by ${authorOf(req.user!)}`,
    });
    res.json({ success: true });
  })
);
