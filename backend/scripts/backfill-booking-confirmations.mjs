// One-off backfill: creates the accounting confirmation row for Stripe
// bookings that were paid (or paid-and-cancelled-without-refund) BEFORE the
// "mirror online bookings into booking-confirmations" feature shipped.
//
// From that commit onward every booking gets its confirmation created live,
// at the moment it is confirmed or cancelled — this script only exists to
// backfill the bookings that predate it, and is safe to run more than once
// (skips any booking that already has one, matched by sourceBookingId).
//
// Usage (from the repository root, via the Railway CLI):
//   Dry-run (default, shows what WOULD be created, writes nothing):
//     railway run --service Postgres node backend/scripts/backfill-booking-confirmations.mjs
//   Apply:
//     railway run --service Postgres node backend/scripts/backfill-booking-confirmations.mjs --apply
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

function generateConfirmationNo(timestamp) {
  const date = new Date(timestamp);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BC-${y}${m}${d}-${suffix}`;
}

async function main() {
  const apply = flag('apply');
  const siteUrl = (arg('site-url') ?? process.env.PUBLIC_SITE_URL ?? 'https://sachi-house.net').replace(/\/+$/, '');

  const connectionString = arg('url') ?? process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('No database URL found.');
    console.error('Run this through the Railway CLI, pointed at the Postgres service:');
    console.error('  railway run --service Postgres node backend/scripts/backfill-booking-confirmations.mjs');
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

  const pool = new Pool({ connectionString });
  let created = 0;
  let skippedExisting = 0;
  let skippedNoRevenue = 0;

  try {
    const { rows: bookings } = await pool.query(
      "SELECT id, property_id, status, data FROM bookings WHERE status IN ('confirmed', 'cancelled_by_guest', 'cancelled_by_host')",
    );

    for (const row of bookings) {
      const booking = row.data;

      // Same rule the live sync uses: a refund means no real revenue was kept.
      const refundAmount = booking.refundAmount ?? 0;
      const keptRevenue = row.status === 'confirmed' || refundAmount === 0;
      if (!keptRevenue) {
        skippedNoRevenue += 1;
        continue;
      }

      const existing = await pool.query(
        "SELECT id FROM booking_confirmations WHERE data->>'sourceBookingId' = $1 LIMIT 1",
        [booking.id],
      );
      if (existing.rows.length > 0) {
        skippedExisting += 1;
        continue;
      }

      const property = await pool.query(
        "SELECT id, data->>'name' AS name, data->>'address' AS address, data->>'metalink' AS metalink FROM properties WHERE id = $1",
        [row.property_id],
      );
      const prop = property.rows[0];
      if (!prop) {
        console.warn(`  ✗ booking ${booking.id}: property ${row.property_id} no longer exists, skipped`);
        continue;
      }

      const slug = prop.metalink || prop.id;
      const quote = booking.quote ?? {};
      const now = Date.now();
      const notes = row.status !== 'confirmed'
        ? 'Guest cancelled — no refund (past the free-cancellation window). Backfilled.'
        : undefined;

      const confirmation = {
        id: `bc_${Math.random().toString(36).slice(2, 10)}`,
        confirmationNo: generateConfirmationNo(now),
        propertyId: prop.id,
        propertyName: prop.name || prop.id,
        propertyAddress: prop.address || '',
        propertyUrl: `${siteUrl}/#/${encodeURIComponent(slug)}`,
        guestName: booking.guestName,
        guestEmail: booking.guestEmail,
        guestPhone: booking.guestPhone,
        numGuests: (booking.adults ?? 0) + (booking.children ?? 0) + (booking.infants ?? 0),
        checkInDate: booking.checkInDate,
        checkOutDate: booking.checkOutDate,
        checkInTime: '15:00',
        checkOutTime: '10:00',
        currency: booking.currency || 'JPY',
        roomFee: (quote.adultTotal ?? 0) + (quote.childTotal ?? 0),
        cleaningFee: quote.cleaningFee ?? 0,
        extraFee: 0,
        discountLabel: (quote.longStayDiscount ?? 0) > 0 ? 'Long-stay discount' : undefined,
        discountAmount: quote.longStayDiscount ?? 0,
        totalAmount: booking.amountTotal,
        depositAmount: booking.amountTotal,
        balanceDue: 0,
        notes,
        includeInAccounting: true,
        source: 'online',
        sourceBookingId: booking.id,
        createdByUserId: 0,
        createdByName: 'Online booking (Stripe)',
        createdAt: now,
        updatedAt: now,
      };

      console.log(`  + ${booking.id} (${prop.name}) — ${booking.guestName}, ${booking.checkInDate} → ${booking.checkOutDate}, ¥${booking.amountTotal}${notes ? ' [cancelled, no refund]' : ''}`);

      if (apply) {
        await pool.query(
          'INSERT INTO booking_confirmations (id, property_id, check_in_date, check_out_date, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)',
          [confirmation.id, confirmation.propertyId, confirmation.checkInDate, confirmation.checkOutDate, JSON.stringify(confirmation), confirmation.createdAt, confirmation.updatedAt],
        );
      }
      created += 1;
    }
  } finally {
    await pool.end();
  }

  console.log(`\n${created} confirmation(s) ${apply ? 'created' : 'would be created'}.`);
  if (skippedExisting > 0) console.log(`${skippedExisting} booking(s) already had one, skipped.`);
  if (skippedNoRevenue > 0) console.log(`${skippedNoRevenue} cancelled booking(s) were fully refunded — no revenue to record, skipped.`);
  if (!apply) console.log('\nDry run — nothing was written. Re-run with --apply to save.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
