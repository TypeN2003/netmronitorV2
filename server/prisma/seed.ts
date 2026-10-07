/**
 * First-run seed.
 *
 * Creates the settings row, one Admin account, and — if SEED_DEVICE_IP is set in
 * server/.env — one real device so the first poll has something to talk to.
 *
 * Deliberately does NOT create the fake inventory the demo build shipped with:
 * every device, port and VLAN you see now comes from a device that actually answered.
 *
 * Safe to run repeatedly: it only fills in what is missing.
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

const pad = (n: number): string => String(n).padStart(2, '0');
const nowTimestamp = (): string => {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
};
const uid = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 12)}`;

const DEVICE_TYPES = ['Router', 'Core Switch', 'Distribution Switch', 'Edge Switch', 'Firewall', 'Server'];
const PLACEMENT: Record<string, { type: string; tier: number }> = {
  Router: { type: 'router', tier: 1 },
  Firewall: { type: 'firewall', tier: 2 },
  'Core Switch': { type: 'core_switch', tier: 3 },
  'Distribution Switch': { type: 'dist_switch', tier: 4 },
  'Edge Switch': { type: 'edge_ap', tier: 5 },
  Server: { type: 'server', tier: 4 },
};

const main = async (): Promise<void> => {
  const now = nowTimestamp();

  // ---------------------------------------------------------------- settings
  const settings = await prisma.settings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
  console.log(`[seed] settings ready (polling every ${settings.snmpInterval}s)`);

  // ---------------------------------------------------------------- admin account
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@netmonitor.internal').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'admin123';
  const name = process.env.SEED_ADMIN_NAME ?? 'NetMonitor Administrator';

  const existingAdmin = await prisma.user.findFirst({ where: { email } });
  if (existingAdmin) {
    console.log(`[seed] admin already exists: ${email}`);
  } else {
    await prisma.user.create({
      data: {
        id: uid('usr'),
        name,
        email,
        passwordHash: await bcrypt.hash(password, 10),
        role: 'Admin',
        department: 'NOC Enterprise Infrastructure',
        status: 'Active',
        createdAt: now,
        lastLogin: 'Never',
        canEditDevices: true,
        canManageUsers: true,
        canEditTopology: true,
        canImportConfig: true,
        canAcknowledgeAlerts: true,
        canModifySettings: true,
        canRebootDevices: true,
      },
    });
    console.log(`[seed] admin created: ${email} / ${password}`);
    if (password === 'admin123') {
      console.warn('[seed] change this password after the first sign-in, or set SEED_ADMIN_PASSWORD before seeding');
    }
  }

  // ---------------------------------------------------------------- one real device (optional)
  const ip = (process.env.SEED_DEVICE_IP ?? '').trim();
  if (!ip) {
    console.log('[seed] SEED_DEVICE_IP is empty — starting with an empty inventory.');
    console.log('[seed] Add devices from the web UI (Backup / Import Config) once the server is running.');
    return;
  }

  const existingDevice = await prisma.device.findFirst({ where: { ip } });
  if (existingDevice) {
    console.log(`[seed] device ${ip} already registered as ${existingDevice.name}`);
    return;
  }

  const deviceName = process.env.SEED_DEVICE_NAME ?? 'Core-SW-01';
  const rawType = process.env.SEED_DEVICE_TYPE ?? 'Core Switch';
  const type = DEVICE_TYPES.includes(rawType) ? rawType : 'Core Switch';
  const community = process.env.SEED_DEVICE_COMMUNITY ?? 'public';

  const device = await prisma.device.create({
    data: {
      id: uid('dev'),
      name: deviceName,
      ip,
      type,
      vendor: 'Unknown',
      // Left blank on purpose: the first poll fills in model, firmware, MAC and port count
      model: '',
      firmware: '-',
      status: 'offline',
      uptime: '-',
      lastSeen: 'Never',
      snmpVersion: '2c',
      snmpPort: 161,
      snmpCommunity: community,
      pollEnabled: true,
      createdAt: now,
      updatedAt: now,
    },
  });

  const placement = PLACEMENT[type] ?? { type: 'core_switch', tier: 3 };
  await prisma.topologyNode.create({
    data: {
      id: uid('node'),
      label: device.name,
      ip: device.ip,
      tier: placement.tier,
      type: placement.type,
      status: 'offline',
      x: 620,
      y: 150 * placement.tier,
      deviceId: device.id,
    },
  });

  console.log(`[seed] device created: ${device.name} (${ip}) with SNMP v2c community "${community}"`);
  console.log('[seed] the collector will poll it within a few seconds of starting the server');
};

main()
  .then(() => prisma.$disconnect())
  .catch(async error => {
    console.error('[seed] failed:', error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
