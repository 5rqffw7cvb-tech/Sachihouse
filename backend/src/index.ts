import { Pool } from 'pg';
import cron from 'node-cron';
import { createApp } from './app.js';
import { loadEnvironment } from './env.js';
import { ObjectStorageService } from './services/objectStorage.js';
import { CheckInSubmission } from './store/types.js';
import { MemoryStore } from './store/memoryStore.js';
import { PostgresStore } from './store/postgresStore.js';

loadEnvironment();

const PORT = Number(process.env.PORT ?? 3001);
const STORE_MODE = process.env.STORE_MODE ?? 'postgres';

async function purgeExpiredCheckIns(params: {
  store: MemoryStore | PostgresStore;
  objectStorage: ObjectStorageService;
}): Promise<number> {
  const safeRetentionDays = 1095; // 3 years
  const cutoffTimestamp = Date.now() - safeRetentionDays * 24 * 60 * 60 * 1000;
  const expired = await params.store.deleteExpiredCheckInSubmissions(cutoffTimestamp);

  await Promise.all(expired.flatMap((submission: CheckInSubmission) => (
    submission.guests.map((guest) => params.objectStorage.deleteEvidenceObject(guest.evidenceUrl))
  )));

  return expired.length;
}

async function main() {
  const store = STORE_MODE === 'memory'
    ? new MemoryStore()
    : new PostgresStore(new Pool({ connectionString: process.env.DATABASE_URL }));
  const objectStorage = new ObjectStorageService();

  await store.init();

  let cleanupRunning = false;
  const runCleanup = async () => {
    if (cleanupRunning) {
      return;
    }
    cleanupRunning = true;
    try {
      const deletedCount = await purgeExpiredCheckIns({ store, objectStorage });
      if (deletedCount > 0) {
        console.log(`Check-in retention cleanup removed ${deletedCount} expired submission(s).`);
      }
    } catch (error) {
      console.error('Check-in retention cleanup failed.', error);
    } finally {
      cleanupRunning = false;
    }
  };

  // Schedule check-in retention cleanup using cron
  const cronSchedule = process.env.CHECKIN_RETENTION_CRON_SCHEDULE || '0 0 * * 0';
  const timezone = process.env.CHECKIN_RETENTION_TIMEZONE || 'Asia/Tokyo';
  
  cron.schedule(cronSchedule, runCleanup, { timezone });
  console.log(`Check-in retention cleanup scheduled: "${cronSchedule}" (${timezone})`);

  // Safety net for holds whose payment never completed. Stripe also tells us via
  // `checkout.session.expired`, but that webhook can be missed, and every stale
  // hold is a night nobody can book.
  let holdSweepRunning = false;
  const sweepExpiredHolds = async () => {
    if (holdSweepRunning) {
      return;
    }
    holdSweepRunning = true;
    try {
      const expiredIds = await store.expireStaleHolds(Date.now());
      if (expiredIds.length > 0) {
        console.log(`Released ${expiredIds.length} expired booking hold(s).`);
      }
    } catch (error) {
      console.error('Booking hold sweep failed.', error);
    } finally {
      holdSweepRunning = false;
    }
  };

  const holdSweepSchedule = process.env.BOOKING_HOLD_SWEEP_CRON || '*/5 * * * *';
  cron.schedule(holdSweepSchedule, sweepExpiredHolds, { timezone });
  console.log(`Booking hold sweep scheduled: "${holdSweepSchedule}" (${timezone})`);

  const app = createApp(store);
  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
