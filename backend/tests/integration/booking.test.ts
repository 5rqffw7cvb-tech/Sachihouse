import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { FakePaymentGateway } from '../helpers/fakePaymentGateway.js';

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
let payments: FakePaymentGateway;

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  return res.body.token as string;
}

// Dates are derived from the clock rather than hard-coded, so the suite keeps
// passing as time moves past any fixed date and stays inside the default
// 365-day booking window.
function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const CHECK_IN = isoDaysFromNow(40);
const CHECK_OUT = isoDaysFromNow(43); // 3 nights
const STAY_NIGHTS = [isoDaysFromNow(40), isoDaysFromNow(41), isoDaysFromNow(42)];

async function enableDirectBooking(propertyId: string, config: Record<string, unknown> = { enabled: true }) {
  const token = await login('admin@sachihouse.com', 'admin123');
  const current = await request(app).get(`/api/properties/${propertyId}`).expect(200);
  await request(app)
    .put(`/api/properties/${propertyId}`)
    .set({ Authorization: `Bearer ${token}` })
    .send({ ...current.body.property, directBooking: config })
    .expect(200);
}

// Wide open by default (today through +100 days) so it comfortably covers
// CHECK_IN/CHECK_OUT (+40/+43 days) without the test needing to reason about
// exact boundaries, unless a test overrides startDate/endDate on purpose.
async function addCouponToProperty(propertyId: string, coupon: Record<string, unknown> = {}) {
  const token = await login('admin@sachihouse.com', 'admin123');
  const current = await request(app).get(`/api/properties/${propertyId}`).expect(200);
  await request(app)
    .put(`/api/properties/${propertyId}`)
    .set({ Authorization: `Bearer ${token}` })
    .send({
      ...current.body.property,
      coupons: [{
        id: 'coupon_1',
        code: 'SH-TEST01',
        type: 'percentage',
        value: 10,
        startDate: isoDaysFromNow(0),
        endDate: isoDaysFromNow(100),
        active: true,
        createdAt: Date.now(),
        ...coupon,
      }],
    })
    .expect(200);
}

function bookingPayload(overrides: Record<string, unknown> = {}) {
  return {
    propertyId: 'main',
    guestName: 'Hanako Tanaka',
    guestEmail: 'hanako@example.com',
    guestPhone: '+81 90 1234 5678',
    adults: 2,
    children: 0,
    infants: 0,
    checkInDate: CHECK_IN,
    checkOutDate: CHECK_OUT,
    locale: 'ja',
    ...overrides,
  };
}

beforeEach(async () => {
  store = new MemoryStore();
  await store.init();
  payments = new FakePaymentGateway();
  app = createApp(store, { payments });
});

describe('direct booking creation', () => {
  it('refuses properties that have not opted in', async () => {
    const res = await request(app).post('/api/bookings').send(bookingPayload()).expect(403);
    expect(res.body.error).toMatch(/does not accept online bookings/i);
  });

  it('creates a hold and prices the stay server-side', async () => {
    await enableDirectBooking('main');

    const res = await request(app).post('/api/bookings').send(bookingPayload()).expect(201);

    expect(res.body.booking.status).toBe('pending_payment');
    expect(res.body.booking.nights).toBe(3);
    expect(res.body.booking.currency).toBe('JPY');
    // 2 adults x ¥5,000 x 3 nights + ¥5,000 cleaning, per the seeded pricing.
    expect(res.body.booking.amountTotal).toBe(35000);
    expect(res.body.booking.quote.total).toBe(35000);
    expect(res.body.booking.holdExpiresAt).toBeGreaterThan(Date.now());
    expect(typeof res.body.guestToken).toBe('string');
    // The token is a credential and must not be echoed inside the record.
    expect(res.body.booking).not.toHaveProperty('guestToken');
  });

  it('ignores any amount supplied by the client', async () => {
    await enableDirectBooking('main');

    const res = await request(app)
      .post('/api/bookings')
      .send(bookingPayload({ amountTotal: 1, total: 1 }))
      .expect(201);

    expect(res.body.booking.amountTotal).toBe(35000);
  });

  it('rejects missing or malformed guest details', async () => {
    await enableDirectBooking('main');

    await request(app).post('/api/bookings').send(bookingPayload({ guestName: '  ' })).expect(400);
    await request(app).post('/api/bookings').send(bookingPayload({ guestEmail: 'not-an-email' })).expect(400);
    await request(app).post('/api/bookings').send(bookingPayload({ adults: 0 })).expect(400);
    await request(app).post('/api/bookings').send(bookingPayload({ checkInDate: '2026-8-1' })).expect(400);
  });

  it('enforces the property booking window', async () => {
    await enableDirectBooking('main', { enabled: true, minNights: 5 });

    const res = await request(app).post('/api/bookings').send(bookingPayload()).expect(400);
    expect(res.body.error).toMatch(/Minimum stay is 5/);
  });

  it('refuses dates the host has blocked manually', async () => {
    await enableDirectBooking('main');
    const token = await login('admin@sachihouse.com', 'admin123');
    await request(app)
      .post('/api/properties/main/blocked-dates')
      .set({ Authorization: `Bearer ${token}` })
      .send({ dates: [STAY_NIGHTS[1]] })
      .expect(200);

    const res = await request(app).post('/api/bookings').send(bookingPayload()).expect(409);
    expect(res.body.conflictDates).toEqual([STAY_NIGHTS[1]]);
  });
});

describe('double booking protection', () => {
  it('lets only one of two concurrent requests take the same nights', async () => {
    await enableDirectBooking('main');

    const [first, second] = await Promise.all([
      request(app).post('/api/bookings').send(bookingPayload()),
      request(app).post('/api/bookings').send(bookingPayload({ guestEmail: 'second@example.com' })),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);

    const loser = first.status === 409 ? first : second;
    expect(loser.body.conflictDates.length).toBeGreaterThan(0);

    const held = await store.listHeldDates('main');
    expect(held).toEqual(STAY_NIGHTS);
  });

  it('rejects a stay that only partially overlaps an existing hold', async () => {
    await enableDirectBooking('main');
    await request(app).post('/api/bookings').send(bookingPayload()).expect(201);

    const res = await request(app)
      .post('/api/bookings')
      .send(bookingPayload({ checkInDate: isoDaysFromNow(42), checkOutDate: isoDaysFromNow(45) }))
      .expect(409);
    expect(res.body.conflictDates).toEqual([isoDaysFromNow(42)]);
  });

  it('allows a stay starting the day the previous guest checks out', async () => {
    await enableDirectBooking('main');
    await request(app).post('/api/bookings').send(bookingPayload()).expect(201);

    // Check-out is exclusive, so CHECK_OUT itself is still for sale.
    await request(app)
      .post('/api/bookings')
      .send(bookingPayload({ checkInDate: CHECK_OUT, checkOutDate: isoDaysFromNow(45) }))
      .expect(201);
  });
});

describe('held nights and availability', () => {
  it('removes the property from availability search while held', async () => {
    await enableDirectBooking('main');

    const before = await request(app)
      .get(`/api/properties/availability?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}`)
      .expect(200);
    expect(before.body.available.map((item: { id: string }) => item.id)).toContain('main');

    await request(app).post('/api/bookings').send(bookingPayload()).expect(201);

    const after = await request(app)
      .get(`/api/properties/availability?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}`)
      .expect(200);
    expect(after.body.available.map((item: { id: string }) => item.id)).not.toContain('main');
  });

  it('exposes the held nights on the public blocked-dates endpoint', async () => {
    await enableDirectBooking('main');
    await request(app).post('/api/bookings').send(bookingPayload()).expect(201);

    const res = await request(app).get('/api/properties/main/blocked-dates').expect(200);
    for (const night of STAY_NIGHTS) {
      expect(res.body.blockedDates).toContain(night);
    }
  });

  it('makes quotes for the held range fail with a conflict', async () => {
    await enableDirectBooking('main');
    await request(app).post('/api/bookings').send(bookingPayload()).expect(201);

    const res = await request(app)
      .post('/api/quotes')
      .send({ propertyId: 'main', checkIn: CHECK_IN, checkOut: CHECK_OUT, adults: 2, children: 0, infants: 0 })
      .expect(409);
    expect(res.body.blockedDates.length).toBeGreaterThan(0);
  });

  it('does not leak one property\'s hold onto another', async () => {
    await enableDirectBooking('main');
    await request(app).post('/api/bookings').send(bookingPayload()).expect(201);

    const res = await request(app)
      .get(`/api/properties/availability?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}`)
      .expect(200);
    expect(res.body.available.map((item: { id: string }) => item.id)).toContain('list_shin');
  });
});

describe('hold expiry', () => {
  it('releases the nights once the hold window passes', async () => {
    await enableDirectBooking('main');
    const created = await request(app).post('/api/bookings').send(bookingPayload()).expect(201);
    const bookingId = created.body.booking.id;

    // Nothing is due yet.
    expect(await store.expireStaleHolds(Date.now())).toEqual([]);

    const expired = await store.expireStaleHolds(Date.now() + 36 * 60_000);
    expect(expired).toEqual([bookingId]);
    expect((await store.getBooking(bookingId))?.status).toBe('expired');
    expect(await store.listHeldDates('main')).toEqual([]);

    const res = await request(app)
      .get(`/api/properties/availability?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}`)
      .expect(200);
    expect(res.body.available.map((item: { id: string }) => item.id)).toContain('main');

    // The freed nights can be sold again.
    await request(app).post('/api/bookings').send(bookingPayload()).expect(201);
  });

  it('leaves confirmed bookings alone', async () => {
    await enableDirectBooking('main');
    const created = await request(app).post('/api/bookings').send(bookingPayload()).expect(201);
    await store.updateBooking(created.body.booking.id, { status: 'confirmed', holdExpiresAt: null });

    expect(await store.expireStaleHolds(Date.now() + 365 * 24 * 60 * 60_000)).toEqual([]);
    expect(await store.listHeldDates('main')).toEqual(STAY_NIGHTS);
  });

  it('frees the nights when a confirmed booking is cancelled', async () => {
    await enableDirectBooking('main');
    const created = await request(app).post('/api/bookings').send(bookingPayload()).expect(201);
    await store.updateBooking(created.body.booking.id, { status: 'confirmed', holdExpiresAt: null });
    await store.updateBooking(created.body.booking.id, { status: 'cancelled_by_guest' });

    expect(await store.listHeldDates('main')).toEqual([]);
  });
});

describe('iCal export', () => {
  async function getExportPath(): Promise<string> {
    const token = await login('admin@sachihouse.com', 'admin123');
    const cal = await request(app)
      .get('/api/properties/main/calendar')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    const exportUrl: string = cal.body.exportUrl;
    return exportUrl.slice(exportUrl.indexOf('/api/'));
  }

  it('publishes confirmed bookings but not unpaid holds', async () => {
    await enableDirectBooking('main');
    const created = await request(app).post('/api/bookings').send(bookingPayload()).expect(201);

    const holdIcs = await request(app).get(await getExportPath()).expect(200);
    expect(holdIcs.text).not.toContain(`direct-${created.body.booking.id}`);

    await store.updateBooking(created.body.booking.id, { status: 'confirmed', holdExpiresAt: null });

    const confirmedIcs = await request(app).get(await getExportPath()).expect(200);
    expect(confirmedIcs.text).toContain(`direct-${created.body.booking.id}`);
    expect(confirmedIcs.text).toContain('Reserved - Hanako Tanaka');
  });
});

describe('host calendar', () => {
  it('reports direct bookings separately from imported dates', async () => {
    await enableDirectBooking('main');
    const created = await request(app).post('/api/bookings').send(bookingPayload()).expect(201);

    const token = await login('admin@sachihouse.com', 'admin123');
    const cal = await request(app)
      .get('/api/properties/main/calendar')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    expect(cal.body.directBookings).toHaveLength(1);
    expect(cal.body.directBookings[0]).toMatchObject({
      id: created.body.booking.id,
      status: 'pending_payment',
      guestName: 'Hanako Tanaka',
    });
    // Nights sold on our own site must not be mislabelled as coming from
    // another platform.
    for (const night of STAY_NIGHTS) {
      expect(cal.body.importedBlockedDates).not.toContain(night);
    }
  });
});

describe('booking lookup', () => {
  it('returns the booking to a guest holding the token', async () => {
    await enableDirectBooking('main');
    const created = await request(app).post('/api/bookings').send(bookingPayload()).expect(201);
    const { id } = created.body.booking;

    const res = await request(app)
      .get(`/api/bookings/${id}?token=${created.body.guestToken}`)
      .expect(200);
    expect(res.body.booking.id).toBe(id);
    expect(res.body.booking).not.toHaveProperty('guestToken');
  });

  it('hides the booking from anyone without the right token', async () => {
    await enableDirectBooking('main');
    const created = await request(app).post('/api/bookings').send(bookingPayload()).expect(201);
    const { id } = created.body.booking;

    await request(app).get(`/api/bookings/${id}`).expect(404);
    await request(app).get(`/api/bookings/${id}?token=wrong`).expect(404);
    await request(app).get(`/api/bookings/${id}?token=${'a'.repeat(64)}`).expect(404);
  });
});

describe('host booking list', () => {
  it('requires authentication', async () => {
    await request(app).get('/api/bookings').expect(401);
  });

  it('lists bookings without exposing guest tokens', async () => {
    await enableDirectBooking('main');
    await request(app).post('/api/bookings').send(bookingPayload()).expect(201);

    const token = await login('admin@sachihouse.com', 'admin123');
    const res = await request(app)
      .get('/api/bookings')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    expect(res.body.bookings).toHaveLength(1);
    expect(res.body.bookings[0]).not.toHaveProperty('guestToken');
  });

  it('filters by status', async () => {
    await enableDirectBooking('main');
    await request(app).post('/api/bookings').send(bookingPayload()).expect(201);

    const token = await login('admin@sachihouse.com', 'admin123');
    const confirmed = await request(app)
      .get('/api/bookings?status=confirmed')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(confirmed.body.bookings).toHaveLength(0);

    const pending = await request(app)
      .get('/api/bookings?status=pending_payment')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(pending.body.bookings).toHaveLength(1);
  });
});

describe('coupons', () => {
  it('/api/quotes applies a valid percentage coupon and reports it', async () => {
    await addCouponToProperty('main', { type: 'percentage', value: 10 });

    const res = await request(app)
      .post('/api/quotes')
      .send({ propertyId: 'main', checkIn: CHECK_IN, checkOut: CHECK_OUT, adults: 2, children: 0, infants: 0, couponCode: 'sh-test01' })
      .expect(200);

    // 2 x (5,000 - 10%) x 3 nights + 5,000 cleaning.
    expect(res.body.quote.total).toBe(32000);
    expect(res.body.coupon).toMatchObject({ code: 'SH-TEST01', type: 'percentage', value: 10 });
    expect(res.body.couponError).toBeNull();
  });

  it('/api/quotes falls back to full price with a couponError when the code is wrong', async () => {
    await addCouponToProperty('main');

    const res = await request(app)
      .post('/api/quotes')
      .send({ propertyId: 'main', checkIn: CHECK_IN, checkOut: CHECK_OUT, adults: 2, children: 0, infants: 0, couponCode: 'SH-WRONG' })
      .expect(200);

    expect(res.body.quote.total).toBe(35000);
    expect(res.body.coupon).toBeNull();
    expect(res.body.couponError).toMatch(/invalid coupon/i);
  });

  it('/api/bookings applies a valid fixed_night coupon and snapshots it onto the booking', async () => {
    await enableDirectBooking('main');
    await addCouponToProperty('main', { type: 'fixed_night', value: 4000 });

    const res = await request(app)
      .post('/api/bookings')
      .send(bookingPayload({ couponCode: 'SH-TEST01' }))
      .expect(201);

    // 2 x 4,000 (flat, regardless of guest count) x 3 nights + 5,000 cleaning.
    expect(res.body.booking.amountTotal).toBe(29000);
    expect(res.body.booking.quote.total).toBe(29000);
    expect(res.body.booking.couponCode).toBe('SH-TEST01');
  });

  it('/api/bookings rejects an unknown coupon code and creates nothing', async () => {
    await enableDirectBooking('main');

    const res = await request(app)
      .post('/api/bookings')
      .send(bookingPayload({ couponCode: 'SH-NOPE99' }))
      .expect(400);
    expect(res.body.error).toMatch(/invalid coupon/i);

    // Never trusted with the client's total, and never even started a hold.
    expect(await store.listHeldDates('main')).toEqual([]);
  });

  it('/api/bookings rejects a coupon whose date range only partially covers the stay', async () => {
    await enableDirectBooking('main');
    // Ends the day before check-out, so the stay only partially overlaps.
    await addCouponToProperty('main', { endDate: isoDaysFromNow(42) });

    const res = await request(app)
      .post('/api/bookings')
      .send(bookingPayload({ couponCode: 'SH-TEST01' }))
      .expect(400);
    expect(res.body.error).toMatch(/not valid for the selected dates/i);
    expect(await store.listHeldDates('main')).toEqual([]);
  });

  it('/api/bookings ignores an empty coupon code and prices normally', async () => {
    await enableDirectBooking('main');

    const res = await request(app)
      .post('/api/bookings')
      .send(bookingPayload({ couponCode: '' }))
      .expect(201);
    expect(res.body.booking.amountTotal).toBe(35000);
    expect(res.body.booking.couponCode).toBeUndefined();
  });
});
