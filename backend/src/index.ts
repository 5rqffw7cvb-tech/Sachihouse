import 'dotenv/config';
import { Pool } from 'pg';
import { createApp } from './app.js';
import { MemoryStore } from './store/memoryStore.js';
import { PostgresStore } from './store/postgresStore.js';

const PORT = Number(process.env.PORT ?? 3001);
const STORE_MODE = process.env.STORE_MODE ?? 'postgres';

async function main() {
  const store = STORE_MODE === 'memory'
    ? new MemoryStore()
    : new PostgresStore(new Pool({ connectionString: process.env.DATABASE_URL }));

  await store.init();

  const app = createApp(store);
  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
