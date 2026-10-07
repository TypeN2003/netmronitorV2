import { prisma } from '../prisma.js';
import { uid } from '../utils/id.js';
import { nowTimestamp } from '../utils/time.js';
import { events } from './events.js';
import { writeLog } from './logs.js';
import { notifyAlert, notifyRecovery } from './telegram.js';
import { emailAlert, emailRecovery } from './email.js';

/** The three levels the Alerts page renders. Syslog severities are a separate scale. */
export type AlertSeverity = 'critical' | 'warning' | 'info';

export const ALERT_CATEGORY = {
  resource: 'High Resource Exhaustion',
  unreachable: 'Device Unreachable',
  portDown: 'Port State Change',
} as const;

/** Thai copy for the categories the collector raises, used by alertText(alert, lang). */
const CATEGORY_TH: Record<string, string> = {
  [ALERT_CATEGORY.resource]: 'ทรัพยากรเครื่องใช้งานสูงเกินเกณฑ์',
  [ALERT_CATEGORY.unreachable]: 'ติดต่ออุปกรณ์ไม่ได้',
  [ALERT_CATEGORY.portDown]: 'สถานะพอร์ตเปลี่ยนแปลง',
};

export interface RaiseAlertInput {
  deviceName: string;
  deviceIp: string;
  severity: AlertSeverity;
  category: string;
  message: string;
  messageTh?: string;
}

/**
 * Raise an alert unless the same device already has an open one in the same category.
 *
 * Without the de-duplication a device sitting at 90% CPU would open a new alert on
 * every poll cycle, which is what the frontend logic already guards against.
 */
export const raiseAlert = async (input: RaiseAlertInput): Promise<string | null> => {
  const existing = await prisma.alert.findFirst({
    where: {
      deviceName: input.deviceName,
      category: input.category,
      status: { not: 'resolved' },
    },
    select: { id: true },
  });
  if (existing) return null;

  const timestamp = nowTimestamp();
  const alert = await prisma.alert.create({
    data: {
      id: uid('alt'),
      timestamp,
      deviceName: input.deviceName,
      deviceIp: input.deviceIp,
      severity: input.severity,
      category: input.category,
      message: input.message,
      categoryTh: CATEGORY_TH[input.category],
      messageTh: input.messageTh,
      status: 'active',
    },
  });

  events.publish({
    type: 'alert',
    at: timestamp,
    alertId: alert.id,
    severity: alert.severity,
    deviceName: alert.deviceName,
    message: alert.message,
  });

  // Fire and forget on every channel: a notification must never hold up or fail
  // the poll cycle, and one channel failing must not stop the others.
  const payload = {
    deviceName: alert.deviceName,
    deviceIp: alert.deviceIp,
    severity: alert.severity as AlertSeverity,
    category: alert.category,
    categoryTh: alert.categoryTh ?? undefined,
    message: alert.message,
    messageTh: alert.messageTh ?? undefined,
    timestamp: alert.timestamp,
  };
  void notifyAlert(payload);
  void emailAlert(payload);

  return alert.id;
};

/**
 * Close every open alert a device has in one category, e.g. when it answers SNMP
 * again or drops back under the CPU threshold.
 */
export const autoResolveAlerts = async (
  deviceName: string,
  category: string,
  reason: string
): Promise<number> => {
  const open = await prisma.alert.findMany({
    where: { deviceName, category, status: { not: 'resolved' } },
    select: { id: true, deviceIp: true },
  });
  if (open.length === 0) return 0;

  const timestamp = nowTimestamp();
  await prisma.alert.updateMany({
    where: { id: { in: open.map(a => a.id) } },
    data: { status: 'resolved', resolvedAt: timestamp },
  });

  await prisma.alertNote.createMany({
    data: open.map(alert => ({
      id: uid('note'),
      alertId: alert.id,
      author: 'NetMonitor Collector',
      role: 'Admin',
      timestamp,
      text: reason,
    })),
  });

  await writeLog({
    severity: 'Notice',
    host: deviceName,
    ip: open[0]?.deviceIp ?? '',
    tag: '%ALARM-5-AUTO_CLEARED',
    message: `${open.length} alert(s) in "${category}" auto-resolved: ${reason}`,
  });

  const recovery = {
    deviceName,
    deviceIp: open[0]?.deviceIp ?? '',
    category,
    categoryTh: CATEGORY_TH[category],
    reason,
  };
  void notifyRecovery(recovery);
  void emailRecovery(recovery);

  return open.length;
};
