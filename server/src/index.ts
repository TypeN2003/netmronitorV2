import { createApp } from './app.js';
import { env } from './env.js';
import { prisma, disconnectPrisma } from './prisma.js';
import { getSettings } from './services/settings.js';
import { startPoller, stopPoller } from './services/poller.js';

const main = async (): Promise<void> => {
  // Fail here rather than on the first request if the database file is missing
  await prisma.$queryRaw`SELECT 1`;
  const settings = await getSettings();

  const userCount = await prisma.user.count();
  if (userCount === 0) {
    console.warn('[boot] No user accounts exist. Run `npm run db:seed` to create the first Admin.');
  }

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[boot] NetMonitor collector listening on http://localhost:${env.port}`);
    console.log(`[boot] CORS allows: ${env.corsOrigins.join(', ')}`);
    console.log(
      `[boot] SNMP polling every ${settings.snmpInterval}s, timeout ${settings.pingTimeoutMs}ms, ` +
        `up to ${env.snmp.concurrency} devices at a time`
    );
  });

  startPoller();

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[boot] ${signal} received, shutting down`);
    stopPoller();
    server.close();
    await disconnectPrisma();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // A rejected promise in a poll cycle must not take the collector down
  process.on('unhandledRejection', reason => {
    console.error('[boot] unhandled rejection:', reason);
  });
};

main().catch(async error => {
  console.error('[boot] failed to start:', error instanceof Error ? error.message : error);
  if (error instanceof Error && /no such table|does not exist/i.test(error.message)) {
    console.error('[boot] The database has no schema yet. Run: npm run setup');
  }
  await disconnectPrisma().catch(() => undefined);
  process.exit(1);
});
