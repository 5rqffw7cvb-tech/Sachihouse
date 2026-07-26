// Turn online booking on (or off) for specific properties.
//
// Guests can only book and pay for a property whose data carries
// `directBooking.enabled === true`. Everything else keeps the older
// "email the host for a quote" flow.
//
// Usage (from the repository root, via the Railway CLI):
//   Link this folder to the project (once):
//     railway link
//   Dry-run (default, shows what WOULD change, writes nothing):
//     railway run --service Postgres node backend/scripts/enable-direct-booking.mjs s01 s02
//   Apply the changes:
//     railway run --service Postgres node backend/scripts/enable-direct-booking.mjs s01 s02 --apply
//   Tune the booking window while enabling:
//     railway run --service Postgres node backend/scripts/enable-direct-booking.mjs s01 --min-nights 2 --apply
//   Turn it back off:
//     railway run --service Postgres node backend/scripts/enable-direct-booking.mjs s01 --disable --apply
//
// `--service Postgres` matters: the backend service only carries DATABASE_URL,
// which points at postgres.railway.internal and resolves only inside Railway's
// private network. The Postgres service also exposes DATABASE_PUBLIC_URL, which
// is the one reachable from your own machine, and this script prefers it.

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

function numberArg(name) {
  const raw = arg(name);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative whole number (got "${raw}").`);
  }
  return parsed;
}

// Everything that is not a flag or a flag's value is a property id.
function parsePropertyIds() {
  const valueFlags = new Set(['url', 'min-nights', 'max-advance-days', 'same-day-cutoff-hour']);
  const ids = [];
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      if (valueFlags.has(token.slice(2))) {
        i += 1; // skip this flag's value
      }
      continue;
    }
    ids.push(token);
  }
  return ids;
}

async function main() {
  const apply = flag('apply');
  const disable = flag('disable');
  const propertyIds = parsePropertyIds();

  if (propertyIds.length === 0) {
    console.error('Give at least one property id, e.g. node scripts/enable-direct-booking.mjs s01 s02');
    process.exitCode = 1;
    return;
  }

  // The public proxy URL is the one reachable from a laptop; the internal one
  // only works from inside Railway.
  const connectionString = arg('url') ?? process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('No database URL found.');
    console.error('Run this through the Railway CLI, pointed at the Postgres service:');
    console.error('  railway link          (once, to connect this folder to the project)');
    console.error('  railway run --service Postgres node backend/scripts/enable-direct-booking.mjs s01 s02');
    process.exitCode = 1;
    return;
  }

  if (connectionString.includes('.railway.internal')) {
    console.error('This URL points at Railway\'s private network and will not resolve from your machine.');
    console.error('Re-run with `railway run --service Postgres …` so DATABASE_PUBLIC_URL is injected,');
    console.error('or pass the public URL directly with --url "postgresql://…".');
    process.exitCode = 1;
    return;
  }

  const directBooking = disable
    ? { enabled: false }
    : {
      enabled: true,
      ...(numberArg('min-nights') !== undefined ? { minNights: numberArg('min-nights') } : {}),
      ...(numberArg('max-advance-days') !== undefined ? { maxAdvanceDays: numberArg('max-advance-days') } : {}),
      ...(numberArg('same-day-cutoff-hour') !== undefined
        ? { sameDayCutoffHour: numberArg('same-day-cutoff-hour') }
        : {}),
    };

  const pool = new Pool({ connectionString });
  let changed = 0;
  let missing = 0;

  try {
    for (const propertyId of propertyIds) {
      const result = await pool.query(
        "SELECT id, data->>'name' AS name, data->'directBooking' AS current FROM properties WHERE id = $1",
        [propertyId],
      );
      const row = result.rows[0];

      if (!row) {
        console.warn(`  ✗ ${propertyId}: no such property, skipped`);
        missing += 1;
        continue;
      }

      const before = row.current ? JSON.stringify(row.current) : '(not set)';
      console.log(`  ${propertyId} (${row.name})`);
      console.log(`      before: ${before}`);
      console.log(`      after:  ${JSON.stringify(directBooking)}`);

      if (apply) {
        await pool.query(
          "UPDATE properties SET data = jsonb_set(data, '{directBooking}', $2::jsonb, true), updated_at = NOW() WHERE id = $1",
          [propertyId, JSON.stringify(directBooking)],
        );
        changed += 1;
      }
    }
  } finally {
    await pool.end();
  }

  if (missing > 0) {
    console.log(`\n${missing} property id(s) not found.`);
  }
  if (apply) {
    console.log(`\nUpdated ${changed} property/properties.`);
  } else {
    console.log('\nDry run — nothing was written. Re-run with --apply to save.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
