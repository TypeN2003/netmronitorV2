import type { Settings } from '@prisma/client';
import { getSettings } from './settings.js';
import { nowTimestamp } from '../utils/time.js';
import type { AlertSeverity } from './alerts.js';
import {
  type NotificationPayload,
  SEVERITY_TH,
  cooldownKey,
  createSendQueue,
  markSent,
  meetsMinimumSeverity,
  withinCooldown,
} from './notify-policy.js';

/**
 * Telegram notifications.
 *
 * Uses the Bot API over plain `fetch`, which Node provides, so there is no SDK to
 * install and nothing to keep up to date. Everything here is best-effort: a failure
 * to notify must never fail a poll cycle or block an alert from being recorded.
 */

const API_BASE = 'https://api.telegram.org';
const SEND_TIMEOUT_MS = 8000;

const SEVERITY_ICON: Record<AlertSeverity, string> = {
  critical: '\u{1F534}', // red circle
  warning: '\u{1F7E0}', // orange circle
  info: '\u{1F535}', // blue circle
};

export interface TelegramResult {
  ok: boolean;
  /** Telegram's own description when it rejects the request, or our own reason. */
  error?: string;
  /** Which part of the configuration to look at, when we can tell. */
  hint?: string;
}

/** Telegram rejects a message containing raw &, < or > when parse_mode is HTML. */
const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Post one message. Returns the outcome instead of throwing, and translates the
 * common Bot API failures into something an operator can act on.
 */
export const sendTelegramMessage = async (
  token: string,
  chatId: string,
  html: string
): Promise<TelegramResult> => {
  if (!token.trim() || !chatId.trim()) {
    return { ok: false, error: 'No bot token or chat id configured', hint: 'settings' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}/bot${token.trim()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text: html,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; description?: string; error_code?: number }
      | null;

    if (payload?.ok) return { ok: true };

    const description = payload?.description ?? `HTTP ${response.status}`;
    // The two mistakes that account for nearly every failed setup
    const hint = /not found|unauthorized/i.test(description)
      ? 'The bot token looks wrong, or the bot was deleted.'
      : /chat not found/i.test(description)
        ? 'The chat id is wrong, or you have not sent the bot a message yet. ' +
          'A bot cannot start a conversation: open the chat and send it anything once.'
        : /bot was blocked|bot can't initiate/i.test(description)
          ? 'The bot is blocked in that chat.'
          : undefined;

    return { ok: false, error: description, hint };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: `Telegram did not answer within ${SEND_TIMEOUT_MS} ms` };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not reach api.telegram.org',
      hint: 'Check that the server has internet access and that api.telegram.org is not blocked.',
    };
  } finally {
    clearTimeout(timer);
  }
};

// ---------------------------------------------------------------- throttling

// Telegram allows roughly one message per second to the same chat
const enqueue = createSendQueue(1100);

// ---------------------------------------------------------------- alert notifications

const isEnabled = (settings: Settings): boolean =>
  settings.telegramEnabled && Boolean(settings.telegramBotToken.trim() && settings.telegramChatId.trim());

/** Announce a newly raised alert. Never throws. */
export const notifyAlert = async (alert: NotificationPayload): Promise<void> => {
  try {
    const settings = await getSettings();
    if (!isEnabled(settings)) return;

    if (!meetsMinimumSeverity(alert.severity, settings.telegramMinSeverity)) return;

    const key = cooldownKey('telegram', 'alert', alert.deviceName, alert.category);
    if (withinCooldown(key, settings.telegramCooldownMinutes)) return;
    markSent(key);

    const html =
      `${SEVERITY_ICON[alert.severity]} <b>NetMonitor — ${escapeHtml(SEVERITY_TH[alert.severity])}</b>\n` +
      `<b>อุปกรณ์:</b> ${escapeHtml(alert.deviceName)} (<code>${escapeHtml(alert.deviceIp)}</code>)\n` +
      `<b>หัวข้อ:</b> ${escapeHtml(alert.categoryTh ?? alert.category)}\n` +
      `<b>รายละเอียด:</b> ${escapeHtml(alert.messageTh ?? alert.message)}\n` +
      `<b>เวลา:</b> <code>${escapeHtml(alert.timestamp)}</code>`;

    const result = await enqueue(() =>
      sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, html)
    );
    if (!result.ok) {
      console.warn(`[telegram] could not notify about ${alert.deviceName}: ${result.error}`);
    }
  } catch (error) {
    console.warn('[telegram] notify failed:', error instanceof Error ? error.message : error);
  }
};

/** Announce that a device came back / dropped under its thresholds. Never throws. */
export const notifyRecovery = async (input: {
  deviceName: string;
  deviceIp: string;
  category: string;
  categoryTh?: string;
  reason: string;
}): Promise<void> => {
  try {
    const settings = await getSettings();
    if (!isEnabled(settings) || !settings.telegramNotifyRecovery) return;

    // A recovery is the counterpart of an alert that was already announced, so it
    // uses its own cooldown key and is not suppressed by the alert's.
    const key = cooldownKey('telegram', 'recovery', input.deviceName, input.category);
    if (withinCooldown(key, settings.telegramCooldownMinutes)) return;
    markSent(key);

    const html =
      `\u{1F7E2} <b>NetMonitor — กลับมาปกติ</b>\n` +
      `<b>อุปกรณ์:</b> ${escapeHtml(input.deviceName)} (<code>${escapeHtml(input.deviceIp)}</code>)\n` +
      `<b>หัวข้อ:</b> ${escapeHtml(input.categoryTh ?? input.category)}\n` +
      `<b>รายละเอียด:</b> ${escapeHtml(input.reason)}\n` +
      `<b>เวลา:</b> <code>${escapeHtml(nowTimestamp())}</code>`;

    const result = await enqueue(() =>
      sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, html)
    );
    if (!result.ok) {
      console.warn(`[telegram] could not notify recovery for ${input.deviceName}: ${result.error}`);
    }
  } catch (error) {
    console.warn('[telegram] recovery notify failed:', error instanceof Error ? error.message : error);
  }
};

/** What the Test button sends. Reports the real outcome, including Telegram's reason. */
export const sendTestMessage = async (token: string, chatId: string, by: string): Promise<TelegramResult> => {
  const html =
    `\u{2705} <b>NetMonitor — ทดสอบการแจ้งเตือน</b>\n` +
    `ถ้าคุณเห็นข้อความนี้ แปลว่าการตั้งค่าถูกต้องแล้ว\n` +
    `<b>สั่งทดสอบโดย:</b> ${escapeHtml(by)}\n` +
    `<b>เวลา:</b> <code>${escapeHtml(nowTimestamp())}</code>`;
  return enqueue(() => sendTelegramMessage(token, chatId, html));
};
