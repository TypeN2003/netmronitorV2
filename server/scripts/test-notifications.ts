/**
 * Raise one alert of every severity through the real code path, then resolve them.
 *
 *   npx tsx scripts/test-notifications.ts          # raise, resolve, then clean up
 *   npx tsx scripts/test-notifications.ts --keep   # leave the alerts in the database
 *
 * This calls `raiseAlert()` and `autoResolveAlerts()`, the same functions the poller
 * uses, so it exercises everything a genuine alert does: the database row, the event
 * stream, the syslog entry and every notification channel. It is not a mock.
 *
 * Expect several messages in Telegram and in the inbox.
 */
import { prisma } from '../src/prisma.js';
import { raiseAlert, autoResolveAlerts, type AlertSeverity } from '../src/services/alerts.js';
import { getSettings } from '../src/services/settings.js';

const KEEP = process.argv.includes('--keep');

/** Distinct device names so the per-device cooldown cannot suppress one of them. */
const CASES: Array<{ device: string; severity: AlertSeverity; category: string; message: string; messageTh: string }> = [
  {
    device: 'TEST-Info',
    severity: 'info',
    category: 'Notification Test',
    message: 'Test notification at info level. Nothing is wrong.',
    messageTh: 'ทดสอบการแจ้งเตือนระดับข้อมูล ไม่มีปัญหาใด ๆ',
  },
  {
    device: 'TEST-Warning',
    severity: 'warning',
    category: 'Notification Test',
    message: 'Test notification at warning level. Nothing is wrong.',
    messageTh: 'ทดสอบการแจ้งเตือนระดับเตือน ไม่มีปัญหาใด ๆ',
  },
  {
    device: 'TEST-Critical',
    severity: 'critical',
    category: 'Notification Test',
    message: 'Test notification at critical level. Nothing is wrong.',
    messageTh: 'ทดสอบการแจ้งเตือนระดับวิกฤต ไม่มีปัญหาใด ๆ',
  },
];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const main = async (): Promise<void> => {
  const settings = await getSettings();

  console.log('การตั้งค่าปัจจุบัน');
  console.log(
    `  Telegram : ${settings.telegramEnabled ? 'เปิด' : 'ปิด'}  ` +
      `ส่งตั้งแต่ ${settings.telegramMinSeverity}  คูลดาวน์ ${settings.telegramCooldownMinutes} นาที`
  );
  console.log(
    `  Email    : ${settings.emailEnabled ? 'เปิด' : 'ปิด'}  ` +
      `ส่งตั้งแต่ ${settings.emailMinSeverity}  คูลดาวน์ ${settings.emailCooldownMinutes} นาที  ` +
      `-> ${settings.emailNotification || '(ไม่ได้ตั้งผู้รับ)'}`
  );
  console.log();

  // Which levels each channel should actually send, given its minimum
  const rank: Record<string, number> = { info: 0, warning: 1, critical: 2 };
  const expected = (min: string, severity: AlertSeverity) => rank[severity] >= (rank[min] ?? 0);

  console.log('สิ่งที่ควรเกิดขึ้น');
  for (const c of CASES) {
    const tg = settings.telegramEnabled && expected(settings.telegramMinSeverity, c.severity);
    const em = settings.emailEnabled && expected(settings.emailMinSeverity, c.severity);
    console.log(`  ${c.severity.padEnd(8)} -> Telegram ${tg ? 'ส่ง' : 'ไม่ส่ง'} | Email ${em ? 'ส่ง' : 'ไม่ส่ง'}`);
  }
  console.log();

  // ---- raise
  console.log('กำลังสร้าง Alert ทั้งสามระดับ...');
  const ids: string[] = [];
  for (const c of CASES) {
    // Clear any leftover from a previous run, or raiseAlert would dedup it away
    await prisma.alert.deleteMany({ where: { deviceName: c.device } });
    const id = await raiseAlert({
      deviceName: c.device,
      deviceIp: '0.0.0.0',
      severity: c.severity,
      category: c.category,
      message: c.message,
      messageTh: c.messageTh,
    });
    console.log(`  ${c.severity.padEnd(8)} ${id ? 'สร้างแล้ว ' + id : 'ถูกข้าม (มี Alert เปิดอยู่แล้ว)'}`);
    if (id) ids.push(id);
  }

  // Both channels queue their sends; give them room to drain before resolving
  console.log('\nรอให้คิวส่งทำงาน (10 วินาที)...');
  await sleep(10000);

  // ---- resolve, which is what triggers the recovery message
  console.log('กำลังปิด Alert เพื่อทดสอบข้อความ "กลับมาปกติ"...');
  for (const c of CASES) {
    const closed = await autoResolveAlerts(c.device, c.category, 'ทดสอบเสร็จสิ้น ระบบกลับสู่สถานะปกติ');
    console.log(`  ${c.device.padEnd(14)} ปิดไป ${closed} รายการ`);
  }

  console.log('\nรอให้คิวส่งข้อความกลับมาปกติ (10 วินาที)...');
  await sleep(10000);

  // ---- clean up
  if (KEEP) {
    console.log('\n--keep: ปล่อย Alert ทดสอบไว้ในระบบ');
  } else {
    const names = CASES.map(c => c.device);
    const { count: alertCount } = await prisma.alert.deleteMany({ where: { deviceName: { in: names } } });
    const { count: logCount } = await prisma.syslog.deleteMany({ where: { host: { in: names } } });
    console.log(`\nเก็บกวาด: ลบ Alert ${alertCount} รายการ และ log ${logCount} รายการ`);
  }

  console.log('\nเสร็จแล้ว ไปดูใน Telegram และกล่องจดหมายได้เลย');
  console.log('ถ้าช่องทางไหนไม่ได้รับ ให้ดูบรรทัดที่ขึ้นต้นด้วย [telegram] หรือ [email] ใน log ของเซิร์ฟเวอร์');
};

main()
  .then(() => prisma.$disconnect())
  .catch(async error => {
    console.error('ล้มเหลว:', error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
