import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { FakePaymentGateway, signWebhookPayload } from '../helpers/fakePaymentGateway.js';

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
let payments: FakePaymentGateway;

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  return res.body.token as string;
}

function manualPayload(overrides: Record<string, unknown> = {}) {
  return {
    propertyName: 'Sachi House Ojima',
    propertyAddress: '1-2-3 Ojima, Koto-ku',
    propertyUrl: 'https://example.com/#/ojima',
    guestName: 'Airbnb Guest',
    guestEmail: 'guest@example.com',
    numGuests: 2,
    checkInDate: isoDaysFromNow(40),
    checkOutDate: isoDaysFromNow(43),
    checkInTime: '15:00',
    checkOutTime: '10:00',
    currency: 'JPY',
    roomFee: 30000,
    cleaningFee: 5000,
    extraFee: 0,
    discountAmount: 0,
    totalAmount: 35000,
    depositAmount: 35000,
    balanceDue: 0,
    includeInAccounting: true,
    ...overrides,
  };
}

async function enableDirectBooking(propertyId = 'main') {
  const token = await login('admin@sachihouse.com', 'admin123');
  const current = await request(app).get(`/api/properties/${propertyId}`).expect(200);
  await request(app)
    .put(`/api/properties/${propertyId}`)
    .set({ Authorization: `Bearer ${token}` })
    .send({ ...current.body.property, directBooking: { enabled: true } })
    .expect(200);
}

async function bookAndPay(daysAhead: number) {
  const created = await request(app)
    .post('/api/bookings')
    .send({
      propertyId: 'main',
      guestName: 'Hanako Tanaka',
      guestEmail: 'hanako@example.com',
      adults: 2,
      children: 1,
      infants: 0,
      checkInDate: isoDaysFromNow(daysAhead),
      checkOutDate: isoDaysFromNow(daysAhead + 3),
      locale: 'ja',
    })
    .expect(201);

  const { booking } = created.body as { booking: { id: string } };
  const event = {
    id: `evt_${booking.id}`,
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_1', metadata: { bookingId: booking.id }, payment_intent: 'pi_test_123' } },
  };
  const payload = JSON.stringify(event);
  await request(app)
    .post('/api/stripe/webhook')
    .set('stripe-signature', signWebhookPayload(payload))
    .set('Content-Type', 'application/json')
    .send(payload)
    .expect(200);

  return booking.id;
}

beforeEach(async () => {
  store = new MemoryStore();
  await store.init();
  payments = new FakePaymentGateway();
  app = createApp(store, { payments });
});

describe('cleaning-calendar link management', () => {
  it('requires host/admin auth to fetch the link', async () => {
    await request(app).get('/api/cleaning-calendar-link').expect(401);
  });

  it('returns a stable link that points at the SPA, not the API', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const first = await request(app)
      .get('/api/cleaning-calendar-link')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    const second = await request(app)
      .get('/api/cleaning-calendar-link')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    expect(first.body.url).toBe(second.body.url);
    expect(first.body.url).toMatch(/\/#\/cleaning\/[a-f0-9]+$/);
  });

  it('regenerating invalidates the previous link', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const before = await request(app)
      .get('/api/cleaning-calendar-link')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    const oldPath = before.body.url.slice(before.body.url.indexOf('/#/cleaning/') + '/#/cleaning/'.length);

    const after = await request(app)
      .post('/api/cleaning-calendar-link/regenerate')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    expect(after.body.url).not.toBe(before.body.url);
    await request(app).get(`/api/cleaning-calendar/${oldPath}`).expect(404);
  });
});

describe('cleaning-calendar data', () => {
  it('rejects a wrong token without needing authentication either way', async () => {
    await request(app).get('/api/cleaning-calendar-link').expect(401); // sanity: link mgmt IS gated
    await request(app).get('/api/cleaning-calendar/deadbeef').expect(404);
  });

  it('lists a manual confirmation and a paid direct booking, with no guest name and the right source label', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set({ Authorization: `Bearer ${token}` })
      .send(manualPayload({ guestName: 'Off Platform Guest', numGuests: 3 }))
      .expect(201);

    await enableDirectBooking();
    await bookAndPay(20);

    const link = await request(app)
      .get('/api/cleaning-calendar-link')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    const linkToken = link.body.url.slice(link.body.url.indexOf('/#/cleaning/') + '/#/cleaning/'.length);

    const res = await request(app).get(`/api/cleaning-calendar/${linkToken}`).expect(200);
    const stays = res.body.stays as Array<Record<string, unknown>>;

    const manualStay = stays.find((s) => s.source === 'Manual');
    expect(manualStay).toMatchObject({ propertyId: 'main', checkInTime: '15:00', checkOutTime: '10:00', guestCount: 3 });
    // Guest identity must never leave this endpoint.
    expect(JSON.stringify(manualStay)).not.toContain('Off Platform Guest');

    const directStay = stays.find((s) => s.source === 'Direct booking');
    expect(directStay).toMatchObject({ propertyId: 'main', checkInTime: '15:00', checkOutTime: '10:00', guestCount: 3 });
    expect(JSON.stringify(directStay)).not.toContain('Hanako Tanaka');
  });

  it('excludes stays entirely outside the requested date window', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set({ Authorization: `Bearer ${token}` })
      .send(manualPayload({ checkInDate: isoDaysFromNow(200), checkOutDate: isoDaysFromNow(203) }))
      .expect(201);

    const link = await request(app)
      .get('/api/cleaning-calendar-link')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    const linkToken = link.body.url.slice(link.body.url.indexOf('/#/cleaning/') + '/#/cleaning/'.length);

    const from = isoDaysFromNow(0);
    const to = isoDaysFromNow(10);
    const res = await request(app)
      .get(`/api/cleaning-calendar/${linkToken}?from=${from}&to=${to}`)
      .expect(200);

    expect(res.body.stays).toEqual([]);
  });
});
