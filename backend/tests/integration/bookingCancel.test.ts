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

// Creates a booking and, unless told otherwise, drives it through the webhook
// so it ends up genuinely paid rather than just held.
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
    const event = {
      id: `evt_${booking.id}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          metadata: { bookingId: booking.id },
          payment_intent: 'pi_test_123',
        },
      },
    };
    const payload = JSON.stringify(event);
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

describe('guest cancellation', () => {
  it('refunds the amount minus the Stripe fee when cancelling well ahead', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay({ daysAhead: 40 });

    const res = await request(app).post(`/api/bookings/${id}/cancel?token=${guestToken}`).expect(200);

    // ¥35,000 total less the ¥1,260 fee Stripe keeps even on a refund.
    expect(res.body.refundAmount).toBe(33740);
    expect(res.body.booking.status).toBe('cancelled_by_guest');
    expect(payments.refunds).toEqual([{ paymentIntentId: 'pi_test_123', amount: 33740 }]);
  });

  it('re-checks the Stripe fee at cancellation time if it came back as 0 at confirm time', async () => {
    // Simulates Stripe not having finished the charge's balance_transaction
    // the instant checkout.session.completed fired, which makes getChargeFee
    // silently return 0 with nothing thrown to log.
    await enableDirectBooking();
    payments.chargeFee = 0;
    const { id, guestToken } = await bookAndPay({ daysAhead: 40 });
    expect((await store.getBooking(id))?.stripeFeeAmount).toBe(0);

    // By cancellation time the real fee is available.
    payments.chargeFee = 1260;
    const res = await request(app).post(`/api/bookings/${id}/cancel?token=${guestToken}`).expect(200);

    expect(res.body.refundAmount).toBe(33740);
    expect(payments.refunds).toEqual([{ paymentIntentId: 'pi_test_123', amount: 33740 }]);
  });

  it('refunds nothing inside the 7-day window but still cancels', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay({ daysAhead: 3 });

    const res = await request(app).post(`/api/bookings/${id}/cancel?token=${guestToken}`).expect(200);

    expect(res.body.refundAmount).toBe(0);
    expect(res.body.booking.status).toBe('cancelled_by_guest');
    expect(payments.refunds).toEqual([]);
  });

  it('puts the nights back on sale', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay();
    expect(await store.listHeldDates('main')).toHaveLength(3);

    await request(app).post(`/api/bookings/${id}/cancel?token=${guestToken}`).expect(200);

    expect(await store.listHeldDates('main')).toEqual([]);
    const res = await request(app)
      .get(`/api/properties/availability?checkIn=${isoDaysFromNow(40)}&checkOut=${isoDaysFromNow(43)}`)
      .expect(200);
    expect(res.body.available.map((item: { id: string }) => item.id)).toContain('main');
  });

  it('drops the booking from the iCal feed once cancelled', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay();

    const token = await login('admin@sachihouse.com', 'admin123');
    const cal = await request(app)
      .get('/api/properties/main/calendar')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    const path = cal.body.exportUrl.slice(cal.body.exportUrl.indexOf('/api/'));

    expect((await request(app).get(path).expect(200)).text).toContain(`direct-${id}`);

    await request(app).post(`/api/bookings/${id}/cancel?token=${guestToken}`).expect(200);

    expect((await request(app).get(path).expect(200)).text).not.toContain(`direct-${id}`);
  });

  it('cancels an unpaid hold without attempting a refund', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay({ pay: false });

    const res = await request(app).post(`/api/bookings/${id}/cancel?token=${guestToken}`).expect(200);

    expect(res.body.refundAmount).toBe(0);
    expect(payments.refunds).toEqual([]);
    expect(await store.listHeldDates('main')).toEqual([]);
  });

  it('refuses without the right token', async () => {
    await enableDirectBooking();
    const { id } = await bookAndPay();

    await request(app).post(`/api/bookings/${id}/cancel`).expect(404);
    await request(app).post(`/api/bookings/${id}/cancel?token=wrong`).expect(404);
    expect((await store.getBooking(id))?.status).toBe('confirmed');
  });

  it('refuses to cancel the same booking twice', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay();

    await request(app).post(`/api/bookings/${id}/cancel?token=${guestToken}`).expect(200);
    const second = await request(app).post(`/api/bookings/${id}/cancel?token=${guestToken}`).expect(409);

    expect(second.body.error).toMatch(/cannot be cancelled/);
    // The guest must not be paid out a second time.
    expect(payments.refunds).toHaveLength(1);
  });

  it('leaves the booking confirmed when Stripe rejects the refund', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay();
    payments.failNextRefund = true;

    const res = await request(app).post(`/api/bookings/${id}/cancel?token=${guestToken}`).expect(502);
    expect(res.body.error).toMatch(/Refund could not be processed/);

    // Nothing was released, so the guest keeps the stay they paid for.
    expect((await store.getBooking(id))?.status).toBe('confirmed');
    expect(await store.listHeldDates('main')).toHaveLength(3);
  });
});

describe('refund preview', () => {
  it('tells the guest what they would get back before they commit', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay({ daysAhead: 40 });

    const far = await request(app).get(`/api/bookings/${id}?token=${guestToken}`).expect(200);
    expect(far.body.booking.refundIfCancelledNow).toBe(33740);
  });

  it('shows zero once inside the 7-day window', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay({ daysAhead: 3 });

    const near = await request(app).get(`/api/bookings/${id}?token=${guestToken}`).expect(200);
    expect(near.body.booking.refundIfCancelledNow).toBe(0);
  });
});

describe('host cancellation', () => {
  it('refunds in full even inside the 7-day window', async () => {
    await enableDirectBooking();
    const { id } = await bookAndPay({ daysAhead: 2 });
    const token = await login('admin@sachihouse.com', 'admin123');

    const res = await request(app)
      .post(`/api/bookings/${id}/cancel-by-host`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ reason: 'boiler broken' })
      .expect(200);

    // The guest did nothing wrong, so we absorb the Stripe fee.
    expect(res.body.refundAmount).toBe(35000);
    expect(res.body.booking.status).toBe('cancelled_by_host');
    expect(res.body.booking.cancelReason).toBe('boiler broken');
    expect(res.body.booking).not.toHaveProperty('guestToken');
  });

  it('requires authentication', async () => {
    await enableDirectBooking();
    const { id } = await bookAndPay();
    await request(app).post(`/api/bookings/${id}/cancel-by-host`).expect(401);
  });

  it('blocks a host who is not assigned to the property', async () => {
    await enableDirectBooking();
    const { id } = await bookAndPay();

    const admin = await login('admin@sachihouse.com', 'admin123');
    await request(app)
      .post('/api/users')
      .set({ Authorization: `Bearer ${admin}` })
      .send({ name: 'Other Host', email: 'other@sachihouse.com', password: 'other12345', role: 'HOST' })
      .expect(201);

    const other = await login('other@sachihouse.com', 'other12345');
    await request(app)
      .post(`/api/bookings/${id}/cancel-by-host`)
      .set({ Authorization: `Bearer ${other}` })
      .expect(403);

    expect((await store.getBooking(id))?.status).toBe('confirmed');
  });
});
