/**
 * Local-time helpers.
 *
 * The frontend displays timestamps verbatim, so every string the API stores must be
 * local time, never UTC. `toISOString()` is deliberately avoided: it is 7 hours behind
 * Asia/Bangkok and made alerts look like they fired in the past.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

/** `2026-10-06 14:05:32` in the server's local timezone. */
export const nowTimestamp = (date: Date = new Date()): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
  `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

/** `14:05` — the x-axis label used by the Dashboard and Statistics charts. */
export const hourMinute = (date: Date): string => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** SNMP sysUpTime is in hundredths of a second. Render it the way the device CLI does. */
export const formatUptimeFromTimeticks = (timeticks: number): string => {
  if (!Number.isFinite(timeticks) || timeticks < 0) return '-';
  const totalSeconds = Math.floor(timeticks / 100);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
};

/** Parse a stored local-time string back into epoch ms. */
export const parseTimestamp = (value: string): number => {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!match) {
    const fallback = Date.parse(value);
    return Number.isNaN(fallback) ? 0 : fallback;
  }
  const [, y, mo, d, h, mi, s] = match;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? '0')).getTime();
};
