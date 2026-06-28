// Bulk-rewrite image links stored in property data.
//
// Replaces an old base URL (e.g. the raw GCS origin) with a new one (e.g. your
// Cloudflare CDN custom domain) across every property's JSON data.
//
// Usage (from the backend/ folder):
//   Dry-run (default, shows what WOULD change, writes nothing):
//     node scripts/migrate-image-urls.mjs
//   Apply the changes:
//     node scripts/migrate-image-urls.mjs --apply
//   Custom bases:
//     node scripts/migrate-image-urls.mjs --from "https://storage.googleapis.com/sachihouse-public/" --to "https://cdn.sachi-house.net/" --apply
//
// Requires DATABASE_URL in the environment (or backend/.env). On Railway:
//   railway run node backend/scripts/migrate-image-urls.mjs --apply

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const FROM = arg('from', 'https://storage.googleapis.com/sachihouse-public/');
const TO = arg('to', 'https://cdn.sachi-house.net/');
const APPLY = process.argv.includes('--apply');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set.');
  process.exit(1);
}

const countOccurrences = (text, needle) => text.split(needle).length - 1;

async function main() {
  console.log(`From: ${FROM}`);
  console.log(`To:   ${TO}`);
  console.log(APPLY ? 'Mode: APPLY (will write changes)\n' : 'Mode: DRY-RUN (no changes written)\n');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let totalProps = 0;
  let changedProps = 0;
  let totalReplacements = 0;

  try {
    const { rows } = await pool.query('SELECT id, data::text AS data FROM properties');
    for (const row of rows) {
      totalProps++;
      const original = row.data;
      const occurrences = countOccurrences(original, FROM);
      if (occurrences === 0) continue;

      const updated = original.split(FROM).join(TO);
      changedProps++;
      totalReplacements += occurrences;
      console.log(`• ${row.id}: ${occurrences} link(s)`);

      if (APPLY) {
        await pool.query(
          'UPDATE properties SET data = $2::jsonb, updated_at = NOW() WHERE id = $1',
          [row.id, updated],
        );
      }
    }

    console.log(`\nProperties scanned: ${totalProps}`);
    console.log(`Properties with matches: ${changedProps}`);
    console.log(`Total links ${APPLY ? 'replaced' : 'to replace'}: ${totalReplacements}`);
    if (!APPLY && totalReplacements > 0) {
      console.log('\nRe-run with --apply to write these changes.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
