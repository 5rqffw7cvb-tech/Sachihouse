import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { FakePaymentGateway, signWebhookPayload } from '../helpers/fakePaymentGateway.js';
import { FakeMailer } from '../helpers/fakeMailer.js';

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
let payments: FakePaymentGateway;
let mailer: FakeMailer;

const ORIGINAL_EMAIL = 'typo@exmaple.com';
const FIXED_EMAIL = 'hanako@example.com';

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  return res.body.token as string;
}

async function enableDirectBooking(patch: Record<string, unknown> = {}) {
  const token = await login('admin@sachihouse.com', 'admin123');
  const current = await request(app).get('/api/properties/main').expect(200);
  await request(app)
    .put('/api/properties/main')
    .set({ Authorization: `Bearer ${token}` })
    .send({ ...current.body.property, directBooking: { enabled: true }, ...patch })
    .expect(200);
}

async function bookAndPay(options: { pay?: boolean } = {}) {
  const created = await request(app)
    .post('/api/bookings')
    .send({
      propertyId: 'main',
      guestName: 'Hanako Tanaka',
      guestEmail: ORIGINAL_EMAIL,
      adults: 2,
      children: 0,
      infants: 0,
      checkInDate: isoDaysFromNow(40),
      checkOutDate: isoDaysFromNow(43),
      locale: 'en',
    })
    .expect(201);

  const { booking, guestToken } = created.body as { booking: { id: string }; guestToken: string };

  if (options.pay !== false) {
    const payload = JSON.stringify({
      id: `evt_${booking.id}`,
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', metadata: { bookingId: booking.id }, payment_intent: 'pi_test_123' } },
    });
    await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', signWebhookPayload(payload))
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(200);
  }

  return { id: booking.id, guestToken };
}

beforeEach(async () => {
  store = new MemoryStore();
  await store.init();
  payments = new FakePaymentGateway();
  mailer = new FakeMailer();
  app = createApp(store, { payments, mailer });
});

describe('guest self-service email correction', () => {
  it('updates the email and resends the confirmation only to the guest', async () => {
    await enableDirectBooking({ adminEmail: 'host@sachihouse.com' });
    const { id, guestToken } = await bookAndPay();
    mailer.sent.length = 0;

    const res = await request(app)
      .post(`/api/bookings/${id}/email?token=${guestToken}`)
      .send({ email: FIXED_EMAIL })
      .expect(200);

    expect(res.body.sentTo).toBe(FIXED_EMAIL);
    expect(res.body.booking.guestEmail).toBe(FIXED_EMAIL);
    expect(mailer.to(FIXED_EMAIL)).toHaveLength(1);
    expect(mailer.to(ORIGINAL_EMAIL)).toHaveLength(0);
    // The host already got their one notification when first confirmed —
    // a guest-side typo fix must not re-notify them.
    expect(mailer.to('host@sachihouse.com')).toHaveLength(0);

    expect((await store.getBooking(id))?.guestEmail).toBe(FIXED_EMAIL);
  });

  it('lower-cases the corrected address', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay();

    const res = await request(app)
      .post(`/api/bookings/${id}/email?token=${guestToken}`)
      .send({ email: 'MixedCase@Example.com' })
      .expect(200);

    expect(res.body.sentTo).toBe('mixedcase@example.com');
  });

  it('keeps the Direct booking revenue mirror in sync', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay();

    await request(app)
      .post(`/api/bookings/${id}/email?token=${guestToken}`)
      .send({ email: FIXED_EMAIL })
      .expect(200);

    const mirrored = await store.getBookingConfirmationBySourceBookingId(id);
    expect(mirrored?.guestEmail).toBe(FIXED_EMAIL);
  });

  it('rejects an invalid email address', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay();

    const res = await request(app)
      .post(`/api/bookings/${id}/email?token=${guestToken}`)
      .send({ email: 'not-an-email' })
      .expect(400);

    expect(res.body.error).toMatch(/valid email/i);
  });

  it('rejects without the right token', async () => {
    await enableDirectBooking();
    const { id } = await bookAndPay();

    await request(app).post(`/api/bookings/${id}/email`).send({ email: FIXED_EMAIL }).expect(404);
    await request(app).post(`/api/bookings/${id}/email?token=wrong`).send({ email: FIXED_EMAIL }).expect(404);
  });

  it('refuses for a booking that is not confirmed', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay({ pay: false });

    const res = await request(app)
      .post(`/api/bookings/${id}/email?token=${guestToken}`)
      .send({ email: FIXED_EMAIL })
      .expect(409);
    expect(res.body.error).toMatch(/pending_payment/);
  });

  it('caps the number of corrections to stop this becoming a spam relay', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay();

    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post(`/api/bookings/${id}/email?token=${guestToken}`)
        .send({ email: `attempt${i}@example.com` })
        .expect(200);
    }

    const res = await request(app)
      .post(`/api/bookings/${id}/email?token=${guestToken}`)
      .send({ email: 'onemore@example.com' })
      .expect(429);
    expect(res.body.error).toMatch(/limit/i);

    // The last successful address must stick — the rejected attempt changes nothing.
    expect((await store.getBooking(id))?.guestEmail).toBe('attempt2@example.com');
  });
});
