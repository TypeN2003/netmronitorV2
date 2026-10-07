import nodemailer, { type Transporter } from 'nodemailer';
import type { Settings } from '@prisma/client';
import { getSettings } from './settings.js';
import { nowTimestamp } from '../utils/time.js';
import type { AlertSeverity } from './alerts.js';
import {
  type NotificationPayload,
  SEVERITY_COLOR,
  SEVERITY_TH,
  cooldownKey,
  createSendQueue,
  markSent,
  meetsMinimumSeverity,
  withinCooldown,
} from './notify-policy.js';

/**
 * Email notifications over SMTP.
 *
 * Built for Gmail with an App Password, which is what the faculty account uses, but
 * any SMTP server works by changing the host and port in the settings.
 *
 * Like Telegram, everything here is best-effort: a mail server being down must never
 * fail a poll cycle or stop an alert from being recorded.
 */

const SEND_TIMEOUT_MS = 15000;
// SMTP is slower than a chat API, so leave a wider gap between messages
const enqueue = createSendQueue(1500);

export interface EmailResult {
  ok: boolean;
  error?: string;
  /** Which setting to look at, when the failure points at one. */
  hint?: string;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Gmail and most providers reject a From that is not the authenticated mailbox. */
const senderOf = (settings: Pick<Settings, 'emailFrom' | 'smtpUser'>): string =>
  settings.emailFrom.trim() || settings.smtpUser.trim();

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

const buildTransport = (config: SmtpConfig): Transporter =>
  nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // 465 is implicit TLS; 587 and 25 start plaintext and upgrade with STARTTLS
    secure: config.port === 465,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  });

/** Turn an SMTP failure into something an operator can act on. */
const explain = (error: unknown): EmailResult => {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code;

  if (/invalid login|username and password not accepted|535/i.test(message)) {
    return {
      ok: false,
      error: message,
      hint:
        'The address or App Password was refused. Gmail needs a 16-character App Password, ' +
        'not the normal account password, and the account must have 2-step verification on.',
    };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo/i.test(message)) {
    return {
      ok: false,
      error: message,
      hint: 'That server name does not resolve. Check the SMTP host spelling, and that the server has working DNS.',
    };
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || /timeout/i.test(message)) {
    return {
      ok: false,
      error: message,
      hint: 'Could not reach the mail server. Check the host and port, and that outbound SMTP is not blocked.',
    };
  }
  if (/no recipients|envelope/i.test(message)) {
    return { ok: false, error: message, hint: 'Check the recipient address.' };
  }
  return { ok: false, error: message };
};

/** Send one message. Returns the outcome instead of throwing. */
export const sendEmail = async (
  config: SmtpConfig & { from: string; to: string },
  subject: string,
  html: string,
  text: string
): Promise<EmailResult> => {
  if (!config.host.trim() || !config.user.trim() || !config.password.trim()) {
    return { ok: false, error: 'SMTP is not configured', hint: 'settings' };
  }
  if (!config.to.trim()) {
    return { ok: false, error: 'No recipient address configured', hint: 'settings' };
  }

  try {
    const transport = buildTransport(config);
    await transport.sendMail({
      from: config.from || config.user,
      to: config.to,
      subject,
      text,
      html,
    });
    transport.close();
    return { ok: true };
  } catch (error) {
    return explain(error);
  }
};

// ---------------------------------------------------------------- message bodies

const shell = (accent: string, heading: string, rows: Array<[string, string]>, footer: string): string => `
<div style="font-family:-apple-system,Segoe UI,Tahoma,sans-serif;max-width:560px;margin:0 auto;
            border:1px solid #e3e8ef;border-radius:10px;overflow:hidden">
  <div style="background:${accent};color:#fff;padding:14px 18px;font-size:16px;font-weight:600">
    ${escapeHtml(heading)}
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:14px;color:#1a2332">
    ${rows
      .map(
        ([label, value]) => `
    <tr>
      <td style="padding:10px 18px;border-bottom:1px solid #eef1f5;color:#5a6472;width:34%;vertical-align:top">
        ${escapeHtml(label)}
      </td>
      <td style="padding:10px 18px;border-bottom:1px solid #eef1f5;vertical-align:top">
        ${escapeHtml(value)}
      </td>
    </tr>`
      )
      .join('')}
  </table>
  <div style="padding:12px 18px;background:#f7f9fc;color:#5a6472;font-size:12px">
    ${escapeHtml(footer)}
  </div>
</div>`;

const plain = (heading: string, rows: Array<[string, string]>, footer: string): string =>
  [heading, '', ...rows.map(([l, v]) => `${l}: ${v}`), '', footer].join('\n');

// ---------------------------------------------------------------- notifications

const isConfigured = (s: Settings): boolean =>
  s.emailEnabled &&
  Boolean(s.smtpHost.trim() && s.smtpUser.trim() && s.smtpPassword.trim() && s.emailNotification.trim());

const configFrom = (s: Settings) => ({
  host: s.smtpHost,
  port: s.smtpPort,
  user: s.smtpUser,
  password: s.smtpPassword,
  from: senderOf(s),
  to: s.emailNotification,
});

/** Email a newly raised alert. Never throws. */
export const emailAlert = async (alert: NotificationPayload): Promise<void> => {
  try {
    const settings = await getSettings();
    if (!isConfigured(settings)) return;
    if (!meetsMinimumSeverity(alert.severity, settings.emailMinSeverity)) return;

    const key = cooldownKey('email', 'alert', alert.deviceName, alert.category);
    if (withinCooldown(key, settings.emailCooldownMinutes)) return;
    markSent(key);

    const rows: Array<[string, string]> = [
      ['อุปกรณ์', `${alert.deviceName} (${alert.deviceIp})`],
      ['ระดับ', SEVERITY_TH[alert.severity]],
      ['หัวข้อ', alert.categoryTh ?? alert.category],
      ['รายละเอียด', alert.messageTh ?? alert.message],
      ['เวลา', alert.timestamp],
    ];
    const heading = `NetMonitor — แจ้งเตือนระดับ${SEVERITY_TH[alert.severity]}`;
    const footer = 'ข้อความนี้ส่งอัตโนมัติจากระบบเฝ้าระวังเครือข่าย NetMonitor';

    const result = await enqueue(() =>
      sendEmail(
        configFrom(settings),
        `[NetMonitor] ${SEVERITY_TH[alert.severity]}: ${alert.deviceName} — ${alert.categoryTh ?? alert.category}`,
        shell(SEVERITY_COLOR[alert.severity], heading, rows, footer),
        plain(heading, rows, footer)
      )
    );
    if (!result.ok) console.warn(`[email] could not notify about ${alert.deviceName}: ${result.error}`);
  } catch (error) {
    console.warn('[email] notify failed:', error instanceof Error ? error.message : error);
  }
};

/** Email a recovery. Never throws. */
export const emailRecovery = async (input: {
  deviceName: string;
  deviceIp: string;
  category: string;
  categoryTh?: string;
  reason: string;
}): Promise<void> => {
  try {
    const settings = await getSettings();
    if (!isConfigured(settings) || !settings.emailNotifyRecovery) return;

    const key = cooldownKey('email', 'recovery', input.deviceName, input.category);
    if (withinCooldown(key, settings.emailCooldownMinutes)) return;
    markSent(key);

    const rows: Array<[string, string]> = [
      ['อุปกรณ์', `${input.deviceName} (${input.deviceIp})`],
      ['หัวข้อ', input.categoryTh ?? input.category],
      ['รายละเอียด', input.reason],
      ['เวลา', nowTimestamp()],
    ];
    const heading = 'NetMonitor — อุปกรณ์กลับมาปกติ';
    const footer = 'ข้อความนี้ส่งอัตโนมัติจากระบบเฝ้าระวังเครือข่าย NetMonitor';

    const result = await enqueue(() =>
      sendEmail(
        configFrom(settings),
        `[NetMonitor] กลับมาปกติ: ${input.deviceName}`,
        shell('#2e8b57', heading, rows, footer),
        plain(heading, rows, footer)
      )
    );
    if (!result.ok) console.warn(`[email] could not notify recovery for ${input.deviceName}: ${result.error}`);
  } catch (error) {
    console.warn('[email] recovery notify failed:', error instanceof Error ? error.message : error);
  }
};

/** What the Test button sends. Reports the real outcome, including the server's reason. */
export const sendTestEmail = async (
  config: SmtpConfig & { from: string; to: string },
  by: string
): Promise<EmailResult> => {
  const rows: Array<[string, string]> = [
    ['สถานะ', 'การตั้งค่าอีเมลถูกต้อง'],
    ['สั่งทดสอบโดย', by],
    ['เวลา', nowTimestamp()],
  ];
  const heading = 'NetMonitor — ทดสอบการแจ้งเตือนทางอีเมล';
  const footer = 'ถ้าคุณเห็นข้อความนี้ แปลว่าระบบส่งอีเมลได้แล้ว';
  return enqueue(() =>
    sendEmail(config, '[NetMonitor] ทดสอบการแจ้งเตือนทางอีเมล', shell('#1e5aa8', heading, rows, footer), plain(heading, rows, footer))
  );
};

export type { AlertSeverity };
