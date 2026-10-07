import { prisma } from '../prisma.js';
import { uid } from '../utils/id.js';
import { nowTimestamp } from '../utils/time.js';
import { env } from '../env.js';
import { events } from './events.js';

/** Severities follow RFC 5424, deliberately different from the 3 alert levels. */
export type SyslogSeverity =
  | 'Emergency'
  | 'Alert'
  | 'Critical'
  | 'Error'
  | 'Warning'
  | 'Notice'
  | 'Info';

export interface LogInput {
  facility?: string;
  severity: SyslogSeverity;
  host: string;
  ip: string;
  tag: string;
  message: string;
  timestamp?: string;
}

/** Append one entry to the event log shown on the Syslog page. */
export const writeLog = async (input: LogInput): Promise<void> => {
  const entry = await prisma.syslog.create({
    data: {
      id: uid('log'),
      timestamp: input.timestamp ?? nowTimestamp(),
      facility: input.facility ?? 'SYSTEM',
      severity: input.severity,
      host: input.host,
      ip: input.ip,
      tag: input.tag,
      message: input.message,
    },
  });
  events.publish({
    type: 'syslog',
    at: entry.timestamp,
    host: entry.host,
    severity: entry.severity,
    message: entry.message,
  });
};

export const writeLogs = async (inputs: LogInput[]): Promise<void> => {
  if (inputs.length === 0) return;
  const at = nowTimestamp();
  await prisma.syslog.createMany({
    data: inputs.map(input => ({
      id: uid('log'),
      timestamp: input.timestamp ?? at,
      facility: input.facility ?? 'SYSTEM',
      severity: input.severity,
      host: input.host,
      ip: input.ip,
      tag: input.tag,
      message: input.message,
    })),
  });
  events.publish({ type: 'syslog', at, host: 'NetMonitor-Core', severity: 'Info', message: `${inputs.length} new log entries` });
};

/**
 * Drop the oldest rows once the table passes SYSLOG_MAX_ROWS.
 * The poller writes on every cycle, so without this the SQLite file grows forever.
 */
export const pruneLogs = async (): Promise<number> => {
  const total = await prisma.syslog.count();
  const excess = total - env.syslogMaxRows;
  if (excess <= 0) return 0;

  const oldest = await prisma.syslog.findMany({
    orderBy: { timestamp: 'asc' },
    take: excess,
    select: { id: true },
  });
  if (oldest.length === 0) return 0;

  const { count } = await prisma.syslog.deleteMany({ where: { id: { in: oldest.map(l => l.id) } } });
  return count;
};
