import 'dotenv/config';

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true' || value === '1';
};

const list = (value: string | undefined, fallback: string[]): string[] => {
  if (!value) return fallback;
  const items = value.split(',').map(s => s.trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
};

// Fail fast rather than signing tokens with a guessable secret in production.
const resolveJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 16 && secret !== 'change-me-to-a-long-random-string') return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set to a random string of 16+ characters before starting in production');
  }
  console.warn(
    '[env] JWT_SECRET is missing or still the placeholder. Using a development-only fallback — ' +
      'set a real value in server/.env before deploying.'
  );
  return 'netmonitor-dev-secret-do-not-use-in-production';
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: num(process.env.PORT, 4000),
  corsOrigins: list(process.env.CORS_ORIGIN, [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
  ]),

  jwtSecret: resolveJwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',

  seed: {
    adminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@netmonitor.internal',
    adminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'admin123',
    adminName: process.env.SEED_ADMIN_NAME ?? 'NetMonitor Administrator',
    deviceIp: (process.env.SEED_DEVICE_IP ?? '').trim(),
    deviceName: process.env.SEED_DEVICE_NAME ?? 'Core-SW-01',
    deviceType: process.env.SEED_DEVICE_TYPE ?? 'Core Switch',
    deviceCommunity: process.env.SEED_DEVICE_COMMUNITY ?? 'public',
  },

  snmp: {
    timeoutMs: num(process.env.SNMP_TIMEOUT_MS, 4000),
    retries: num(process.env.SNMP_RETRIES, 1),
    concurrency: Math.max(1, num(process.env.SNMP_CONCURRENCY, 5)),
    collectFdb: bool(process.env.SNMP_COLLECT_FDB, true),
  },

  pollerEnabled: bool(process.env.POLLER_ENABLED, true),

  cpuThreshold: num(process.env.CPU_ALERT_THRESHOLD, 85),
  ramThreshold: num(process.env.RAM_ALERT_THRESHOLD, 90),

  telemetryRetentionHours: num(process.env.TELEMETRY_RETENTION_HOURS, 168),
  syslogMaxRows: num(process.env.SYSLOG_MAX_ROWS, 5000),
};
