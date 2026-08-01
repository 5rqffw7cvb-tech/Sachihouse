// One-off repair: booking_confirmations rows created for a paid online
// booking (source = 'online') were, until this fix, given their OWN fresh
// confirmation number instead of reusing the Booking's — so the check-in
// link already emailed to the guest (?bk=<the Booking's number>) silently
// stopped matching anything in booking_confirmations. This finds every
// online row whose confirmationNo drifted from its source Booking's and
// realigns it.
//
// Usage (from the repository root, via the Railway CLI):
//   Dry-run (default, shows what WOULD change, writes nothing):
//     railway run --service Postgres node backend/scripts/fix-mismatched-confirmation-numbers.mjs
//   Apply:
//     railway run --service Postgres node backend/scripts/fix-mismatched-confirmation-numbers.mjs --apply

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

async function main() {
  const apply = flag('apply');
  const connectionString = arg('url') ?? process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('No database URL found. Run via: railway run --service Postgres node backend/scripts/fix-mismatched-confirmation-numbers.mjs');
    process.exitCode = 1;
    return;
  }
  if (connectionString.includes('.railway.internal')) {
    console.error('This URL points at Railway\'s private network. Re-run with `railway run --service Postgres …`.');
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString });
  let fixed = 0;
  let alreadyOk = 0;
  let orphaned = 0;

  try {
    const { rows } = await pool.query(
      "SELECT id, data->>'confirmationNo' AS confirmation_no, data->>'sourceBookingId' AS source_booking_id "
      + "FROM booking_confirmations WHERE data->>'source' = 'online' AND data->>'sourceBookingId' IS NOT NULL",
    );

    for (const row of rows) {
      const booking = await pool.query("SELECT data->>'confirmationNo' AS confirmation_no FROM bookings WHERE id = $1", [row.source_booking_id]);
      const trueNo = booking.rows[0]?.confirmation_no;

      if (!trueNo) {
        console.warn(`  ? confirmation ${row.id}: source booking ${row.source_booking_id} not found or has no confirmationNo, skipped`);
        orphaned += 1;
        continue;
      }

      if (trueNo === row.confirmation_no) {
        alreadyOk += 1;
        continue;
      }

      console.log(`  ${row.id}: ${row.confirmation_no} -> ${trueNo}`);
      if (apply) {
        await pool.query(
          "UPDATE booking_confirmations SET data = jsonb_set(data, '{confirmationNo}', to_jsonb($2::text)), updated_at = $3 WHERE id = $1",
          [row.id, trueNo, Date.now()],
        );
      }
      fixed += 1;
    }
  } finally {
    await pool.end();
  }

  console.log(`\n${fixed} confirmation number(s) ${apply ? 'fixed' : 'would be fixed'}.`);
  console.log(`${alreadyOk} already matched their booking.`);
  if (orphaned > 0) console.log(`${orphaned} pointed at a missing/incomplete booking, skipped.`);
  if (!apply) console.log('\nDry run — nothing was written. Re-run with --apply to save.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
