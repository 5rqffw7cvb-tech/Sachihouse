import 'dotenv/config';
import { Pool } from 'pg';
import { createApp } from './app.js';
import { ObjectStorageService } from './services/objectStorage.js';
import { CheckInSubmission } from './store/types.js';
import { MemoryStore } from './store/memoryStore.js';
import { PostgresStore } from './store/postgresStore.js';

const PORT = Number(process.env.PORT ?? 3001);
const STORE_MODE = process.env.STORE_MODE ?? 'postgres';

function getCleanupIntervalMs(): number {
  const raw = Number(process.env.CHECKIN_RETENTION_CLEANUP_INTERVAL_MS ?? 60 * 60 * 1000);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 60 * 60 * 1000;
}

async function purgeExpiredCheckIns(params: {
  store: MemoryStore | PostgresStore;
  objectStorage: ObjectStorageService;
}): Promise<number> {
  const retentionDays = Number(process.env.CHECKIN_RETENTION_DAYS ?? 7);
  const safeRetentionDays = Number.isFinite(retentionDays) && retentionDays > 0 ? Math.trunc(retentionDays) : 7;
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

  await runCleanup();
  const cleanupTimer = setInterval(() => {
    void runCleanup();
  }, getCleanupIntervalMs());
  cleanupTimer.unref();

  const app = createApp(store);
  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
