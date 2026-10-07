import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler } from '../middleware/error.js';
import { authorOf, requireAuth, requireOperator, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { serializeSettings } from '../services/serialize.js';
import { getSettings } from '../services/settings.js';
import { writeLog } from '../services/logs.js';
import { events } from '../services/events.js';
import { nowTimestamp } from '../utils/time.js';
import { sendTestMessage } from '../services/telegram.js';
import { sendTestEmail } from '../services/email.js';
import { HttpError } from '../middleware/auth.js';

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(serializeSettings(await getSettings()));
  })
);

/**
 * PATCH /api/settings
 *
 * Fields that really change behaviour:
 *   snmpInterval  — how often the collector polls (minimum 15 s, enforced here and in the poller)
 *   pingTimeoutMs — how long one SNMP request waits before the device counts as unreachable
 *   ruckusOneUrl  — the cloud Wi-Fi console the Access Points menu opens
 *
 *   telegram*     — real Telegram notifications for alerts and recoveries
 *   smtp* / email* — real email notifications over SMTP
 *
 * Still inert, stored only: packetLossThreshold and sessionTimeoutMinutes.
 * Token lifetime comes from JWT_EXPIRES_IN in server/.env.
 */
settingsRouter.patch(
  '/',
  requireOperator,
  requirePermission('canModifySettings'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const schema = z.object({
      snmpInterval: z.number().int().min(15, 'Polling any faster than 15 s floods the network').max(86400).optional(),
      pingTimeoutMs: z.number().int().min(200).max(60000).optional(),
      packetLossThreshold: z.number().int().min(0).max(100).optional(),
      // Empty string means "keep the stored token"; the UI never receives it back
      telegramBotToken: z.string().max(200).optional(),
      telegramChatId: z.string().max(100).optional(),
      telegramEnabled: z.boolean().optional(),
      telegramNotifyRecovery: z.boolean().optional(),
      telegramMinSeverity: z.enum(['info', 'warning', 'critical']).optional(),
      telegramCooldownMinutes: z.number().int().min(0).max(1440).optional(),
      emailNotification: z.string().max(200).optional(),
      emailEnabled: z.boolean().optional(),
      emailNotifyRecovery: z.boolean().optional(),
      emailMinSeverity: z.enum(['info', 'warning', 'critical']).optional(),
      emailCooldownMinutes: z.number().int().min(0).max(1440).optional(),
      smtpHost: z.string().trim().max(200).optional(),
      smtpPort: z.number().int().min(1).max(65535).optional(),
      smtpUser: z.string().trim().max(200).optional(),
      // Empty means "keep the stored App Password"; it is never sent back to the UI
      smtpPassword: z.string().max(200).optional(),
      emailFrom: z.string().trim().max(200).optional(),
      sessionTimeoutMinutes: z.number().int().min(1).max(1440).optional(),
      ruckusOneUrl: z.string().trim().url('Enter a full URL, including https://').max(400).optional(),
      lastGlobalBackup: z.string().max(40).optional(),
    });
    const input = schema.parse(req.body);

    const before = await getSettings();
    // A blank token field means the operator did not retype it, so keep what we have
    const { telegramBotToken, smtpPassword, ...rest } = input;
    const data = {
      ...rest,
      ...(telegramBotToken && telegramBotToken.trim() ? { telegramBotToken: telegramBotToken.trim() } : {}),
      // Gmail App Passwords are shown with spaces; strip them so a pasted value works
      ...(smtpPassword && smtpPassword.trim()
        ? { smtpPassword: smtpPassword.replace(/\s+/g, '') }
        : {}),
    };
    const settings = await prisma.settings.update({ where: { id: 1 }, data });

    if (input.snmpInterval && input.snmpInterval !== before.snmpInterval) {
      await writeLog({
        severity: 'Notice',
        host: 'NetMonitor-Core',
        ip: '',
        tag: '%NETMON-5-INTERVAL_CHANGED',
        message: `${authorOf(req.user!)} changed the SNMP polling interval from ${before.snmpInterval}s to ${input.snmpInterval}s`,
      });
    }

    events.publish({ type: 'settings', at: nowTimestamp() });
    res.json(serializeSettings(settings));
  })
);

/**
 * POST /api/settings/test-telegram
 *
 * Actually sends a message and reports what Telegram said. Takes an optional token
 * and chat id so credentials can be verified before they are saved; with neither,
 * it uses the stored ones.
 */
settingsRouter.post(
  '/test-telegram',
  requireOperator,
  requirePermission('canModifySettings'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { telegramBotToken, telegramChatId } = z
      .object({
        telegramBotToken: z.string().max(200).optional(),
        telegramChatId: z.string().max(100).optional(),
      })
      .parse(req.body ?? {});

    const stored = await getSettings();
    const token = telegramBotToken?.trim() || stored.telegramBotToken;
    const chatId = telegramChatId?.trim() || stored.telegramChatId;

    if (!token || !chatId) {
      throw new HttpError(
        400,
        'Enter a bot token and a chat id first, then test.',
        'TELEGRAM_NOT_CONFIGURED'
      );
    }

    const result = await sendTestMessage(token, chatId, authorOf(req.user!));

    await writeLog({
      severity: result.ok ? 'Info' : 'Warning',
      host: 'NetMonitor-Core',
      ip: '',
      tag: result.ok ? '%NOTIFY-6-TELEGRAM_TEST_OK' : '%NOTIFY-4-TELEGRAM_TEST_FAILED',
      message: result.ok
        ? `${authorOf(req.user!)} sent a Telegram test message successfully`
        : `${authorOf(req.user!)} tried a Telegram test message: ${result.error}`,
    });

    // 200 either way: the request succeeded, the result says whether Telegram accepted it
    res.json(result);
  })
);

/**
 * POST /api/settings/test-email
 *
 * Actually sends a message through SMTP and reports what the server said. Takes
 * optional credentials so they can be checked before being saved; with none, it
 * uses the stored ones.
 */
settingsRouter.post(
  '/test-email',
  requireOperator,
  requirePermission('canModifySettings'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = z
      .object({
        smtpHost: z.string().trim().max(200).optional(),
        smtpPort: z.number().int().min(1).max(65535).optional(),
        smtpUser: z.string().trim().max(200).optional(),
        smtpPassword: z.string().max(200).optional(),
        emailFrom: z.string().trim().max(200).optional(),
        emailNotification: z.string().trim().max(200).optional(),
      })
      .parse(req.body ?? {});

    const stored = await getSettings();
    const host = input.smtpHost || stored.smtpHost;
    const port = input.smtpPort ?? stored.smtpPort;
    const user = input.smtpUser || stored.smtpUser;
    const password = (input.smtpPassword || '').replace(/\s+/g, '') || stored.smtpPassword;
    const to = input.emailNotification || stored.emailNotification;
    const from = input.emailFrom || stored.emailFrom || user;

    if (!host || !user || !password) {
      throw new HttpError(
        400,
        'Enter the SMTP server, the account and its App Password first, then test.',
        'SMTP_NOT_CONFIGURED'
      );
    }
    if (!to) {
      throw new HttpError(400, 'Enter the address that should receive the alerts.', 'NO_RECIPIENT');
    }

    const result = await sendTestEmail({ host, port, user, password, from, to }, authorOf(req.user!));

    await writeLog({
      severity: result.ok ? 'Info' : 'Warning',
      host: 'NetMonitor-Core',
      ip: '',
      tag: result.ok ? '%NOTIFY-6-EMAIL_TEST_OK' : '%NOTIFY-4-EMAIL_TEST_FAILED',
      message: result.ok
        ? `${authorOf(req.user!)} sent a test email to ${to}`
        : `${authorOf(req.user!)} tried a test email to ${to}: ${result.error}`,
    });

    // 200 either way: the request succeeded, the result says whether SMTP accepted it
    res.json(result);
  })
);
