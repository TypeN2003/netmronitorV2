import type { AlertSeverity } from './alerts.js';

/**
 * Rules every notification channel shares.
 *
 * Telegram and email each have their own credentials and their own enable switch,
 * but "is this severe enough to send?" and "have we already said this recently?"
 * work the same way, so they live here rather than being copied per channel.
 */

/** Severity as an order, so a channel can require "this level or worse". */
const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warning: 1, critical: 2 };

export const meetsMinimumSeverity = (severity: AlertSeverity, minimum: string): boolean =>
  SEVERITY_RANK[severity] >= (SEVERITY_RANK[minimum as AlertSeverity] ?? 0);

/**
 * When each channel last said something about a given device and category.
 *
 * A link that flaps would otherwise notify on every transition. The key includes the
 * channel, so turning Telegram's cooldown up does not silence email. Kept in memory
 * on purpose: after a restart the first event of each kind is worth announcing again.
 */
const lastSentAt = new Map<string, number>();

export const cooldownKey = (channel: string, kind: 'alert' | 'recovery', device: string, category: string): string =>
  `${channel}:${kind}:${device}:${category}`;

/** True when this key was used within the cooldown window, so the caller should stay quiet. */
export const withinCooldown = (key: string, cooldownMinutes: number): boolean => {
  if (cooldownMinutes <= 0) return false;
  const previous = lastSentAt.get(key);
  if (previous === undefined) return false;
  return Date.now() - previous < cooldownMinutes * 60_000;
};

export const markSent = (key: string): void => {
  lastSentAt.set(key, Date.now());
};

/**
 * Serialise one channel's sends.
 *
 * A poll cycle can finish several alerts at once, and both Telegram and SMTP dislike
 * bursts. Each channel gets its own queue so a slow mail server cannot delay a
 * Telegram message.
 */
export const createSendQueue = (gapMs: number) => {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.then(
      () => new Promise(resolve => setTimeout(resolve, gapMs)),
      () => new Promise(resolve => setTimeout(resolve, gapMs))
    );
    return next;
  };
};

/** What a channel needs to describe an alert, in both languages the UI uses. */
export interface NotificationPayload {
  deviceName: string;
  deviceIp: string;
  severity: AlertSeverity;
  category: string;
  categoryTh?: string;
  message: string;
  messageTh?: string;
  timestamp: string;
}

export const SEVERITY_TH: Record<AlertSeverity, string> = {
  critical: 'วิกฤต',
  warning: 'เตือน',
  info: 'ข้อมูล',
};

/** Colour per severity, used by the HTML email. */
export const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: '#c0392b',
  warning: '#e67e22',
  info: '#2980b9',
};
