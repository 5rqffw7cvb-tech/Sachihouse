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

async function enableDirectBooking(propertyId = 'main') {
  const token = await login('admin@sachihouse.com', 'admin123');
  const current = await request(app).get(`/api/properties/${propertyId}`).expect(200);
  await request(app)
    .put(`/api/properties/${propertyId}`)
    .set({ Authorization: `Bearer ${token}` })
    .send({ ...current.body.property, directBooking: { enabled: true } })
    .expect(200);
}

async function bookAndPay(options: { daysAhead?: number; pay?: boolean } = {}) {
  const daysAhead = options.daysAhead ?? 40;
  const created = await request(app)
    .post('/api/bookings')
    .send({
      propertyId: 'main',
      guestName: 'Hanako Tanaka',
      guestEmail: 'hanako@example.com',
      adults: 2,
      children: 0,
      infants: 0,
      checkInDate: isoDaysFromNow(daysAhead),
      checkOutDate: isoDaysFromNow(daysAhead + 3),
      locale: 'ja',
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
  app = createApp(store, { payments });
});

describe('accounting mirror for a paid online booking', () => {
  it('creates a confirmation with the fee breakdown from the quote', async () => {
    await enableDirectBooking();
    const { id } = await bookAndPay({ daysAhead: 40 });

    const confirmation = await store.getBookingConfirmationBySourceBookingId(id);
    expect(confirmation).not.toBeNull();
    expect(confirmation!.source).toBe('online');
    expect(confirmation!.propertyId).toBe('main');
    expect(confirmation!.guestName).toBe('Hanako Tanaka');
    // ¥35,000 total = roomFee + cleaningFee for a 2-adult, 3-night stay.
    expect(confirmation!.roomFee + confirmation!.cleaningFee - confirmation!.discountAmount).toBe(35000);
    expect(confirmation!.totalAmount).toBe(35000);
    expect(confirmation!.depositAmount).toBe(35000);
    expect(confirmation!.balanceDue).toBe(0);
    expect(confirmation!.includeInAccounting).toBe(true);
  });

  it('shows up in the same list the host uses for manual confirmations', async () => {
    await enableDirectBooking();
    await bookAndPay();
    const token = await login('admin@sachihouse.com', 'admin123');

    const res = await request(app)
      .get('/api/booking-confirmations')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    expect(res.body.confirmations).toHaveLength(1);
    expect(res.body.confirmations[0].source).toBe('online');
  });

  it('does not create a second row when Stripe redelivers the webhook', async () => {
    await enableDirectBooking();
    const { id } = await bookAndPay();

    const payload = JSON.stringify({
      id: `evt_${id}`,
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', metadata: { bookingId: id }, payment_intent: 'pi_test_123' } },
    });
    await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', signWebhookPayload(payload))
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(200);

    const token = await login('admin@sachihouse.com', 'admin123');
    const res = await request(app)
      .get('/api/booking-confirmations')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(res.body.confirmations).toHaveLength(1);
  });
});

describe('accounting mirror after cancellation', () => {
  it('removes the confirmation once the guest is refunded', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay({ daysAhead: 40 });
    expect(await store.getBookingConfirmationBySourceBookingId(id)).not.toBeNull();

    await request(app).post(`/api/bookings/${id}/cancel?token=${guestToken}`).expect(200);

    expect(await store.getBookingConfirmationBySourceBookingId(id)).toBeNull();
  });

  it('keeps the confirmation and notes it when a late cancellation keeps the money', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay({ daysAhead: 3 });

    await request(app).post(`/api/bookings/${id}/cancel?token=${guestToken}`).expect(200);

    const confirmation = await store.getBookingConfirmationBySourceBookingId(id);
    expect(confirmation).not.toBeNull();
    expect(confirmation!.notes).toContain('no refund');
    expect(confirmation!.includeInAccounting).toBe(true);
  });

  it('removes the confirmation when the host cancels (always a full refund)', async () => {
    await enableDirectBooking();
    const { id } = await bookAndPay({ daysAhead: 2 });
    const token = await login('admin@sachihouse.com', 'admin123');

    await request(app)
      .post(`/api/bookings/${id}/cancel-by-host`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    expect(await store.getBookingConfirmationBySourceBookingId(id)).toBeNull();
  });

  it('never created one for a hold that was cancelled before payment', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay({ pay: false });

    await request(app).post(`/api/bookings/${id}/cancel?token=${guestToken}`).expect(200);

    expect(await store.getBookingConfirmationBySourceBookingId(id)).toBeNull();
  });
});

describe('manual confirmations are unaffected', () => {
  it('are still tagged as manual and stay deletable', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const created = await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set({ Authorization: `Bearer ${token}` })
      .send({
        propertyName: 'Sachi House Ojima',
        propertyAddress: 'Tokyo',
        propertyUrl: 'https://sachi-house.net/#/main',
        guestName: 'Walk-in Guest',
        numGuests: 2,
        checkInDate: isoDaysFromNow(10),
        checkOutDate: isoDaysFromNow(12),
        checkInTime: '15:00',
        checkOutTime: '10:00',
        currency: 'JPY',
        roomFee: 20000,
        cleaningFee: 5000,
        extraFee: 0,
        discountAmount: 0,
        totalAmount: 25000,
        depositAmount: 25000,
        balanceDue: 0,
      })
      .expect(201);

    expect(created.body.confirmation.source).toBe('manual');

    await request(app)
      .delete(`/api/booking-confirmations/${created.body.confirmation.id}`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(204);
  });
});
