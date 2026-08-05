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

const CHECK_IN = isoDaysFromNow(40);
const CHECK_OUT = isoDaysFromNow(43);
const STAY_NIGHTS = [isoDaysFromNow(40), isoDaysFromNow(41), isoDaysFromNow(42)];

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

function bookingPayload(overrides: Record<string, unknown> = {}) {
  return {
    propertyId: 'main',
    guestName: 'Hanako Tanaka',
    guestEmail: 'hanako@example.com',
    adults: 2,
    children: 0,
    infants: 0,
    checkInDate: CHECK_IN,
    checkOutDate: CHECK_OUT,
    locale: 'ja',
    ...overrides,
  };
}

async function createBooking() {
  const res = await request(app).post('/api/bookings').send(bookingPayload()).expect(201);
  return res.body as { booking: { id: string }; guestToken: string; checkoutUrl: string };
}

// Posts a webhook the way Stripe does: the exact bytes, signed with the secret.
function postWebhook(event: Record<string, unknown>, options: { secret?: string } = {}) {
  const payload = JSON.stringify(event);
  const signature = signWebhookPayload(payload, options.secret);
  return request(app)
    .post('/api/stripe/webhook')
    .set('stripe-signature', signature)
    .set('Content-Type', 'application/json')
    .send(payload);
}

function checkoutCompleted(bookingId: string, eventId = 'evt_completed_1') {
  return {
    id: eventId,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        object: 'checkout_session',
        client_reference_id: bookingId,
        metadata: { bookingId, propertyId: 'main' },
        payment_intent: 'pi_test_123',
      },
    },
  };
}

beforeEach(async () => {
  store = new MemoryStore();
  await store.init();
  payments = new FakePaymentGateway();
  app = createApp(store, { payments });
});

describe('checkout session creation', () => {
  it('returns a payment URL and remembers the session id', async () => {
    await enableDirectBooking();
    const body = await createBooking();

    expect(body.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(payments.sessions).toHaveLength(1);

    const stored = await store.getBooking(body.booking.id);
    expect(stored?.stripeSessionId).toBe('cs_test_1');
    expect(stored?.status).toBe('pending_payment');
  });

  it('charges yen without a x100 minor-unit conversion', async () => {
    await enableDirectBooking();
    await createBooking();

    // 2 adults x ¥5,000 x 3 nights + ¥5,000 cleaning. Stripe must receive
    // 35000, not 3500000 — JPY is a zero-decimal currency.
    expect(payments.sessions[0].booking.amountTotal).toBe(35000);
    expect(payments.sessions[0].booking.currency).toBe('JPY');
  });

  it('sends the guest back to a URL carrying their access token', async () => {
    await enableDirectBooking();
    const body = await createBooking();

    expect(payments.sessions[0].successUrl).toContain(`id=${body.booking.id}`);
    expect(payments.sessions[0].successUrl).toContain(`token=${body.guestToken}`);
  });

  it('gives Stripe an expiry inside its 30-minute floor and under our hold', async () => {
    await enableDirectBooking();
    const body = await createBooking();

    const expiresAtMs = payments.sessions[0].expiresAt * 1000;
    expect(expiresAtMs).toBeGreaterThan(Date.now() + 29 * 60_000);
    const stored = await store.getBooking(body.booking.id);
    // The session must die before the hold does, never the other way round.
    expect(expiresAtMs).toBeLessThan(stored!.holdExpiresAt!);
  });

  it('releases the nights when Stripe cannot create a session', async () => {
    await enableDirectBooking();
    payments.failNextSession = true;

    await request(app).post('/api/bookings').send(bookingPayload()).expect(502);

    expect(await store.listHeldDates('main')).toEqual([]);
    const res = await request(app)
      .get(`/api/properties/availability?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}`)
      .expect(200);
    expect(res.body.available.map((item: { id: string }) => item.id)).toContain('main');
  });
});

describe('guest abandons checkout', () => {
  it('releases the hold immediately instead of waiting out the timer', async () => {
    await enableDirectBooking();
    const body = await createBooking();
    expect(await store.listHeldDates('main')).toEqual(STAY_NIGHTS);

    await request(app)
      .post(`/api/bookings/${body.booking.id}/abandon?token=${body.guestToken}`)
      .expect(200);

    expect((await store.getBooking(body.booking.id))?.status).toBe('expired');
    expect(await store.listHeldDates('main')).toEqual([]);
    const res = await request(app)
      .get(`/api/properties/availability?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}`)
      .expect(200);
    expect(res.body.available.map((item: { id: string }) => item.id)).toContain('main');
  });

  it('is a no-op once the booking already paid, so a stray call cannot undo a real payment', async () => {
    await enableDirectBooking();
    const body = await createBooking();
    await postWebhook(checkoutCompleted(body.booking.id)).expect(200);

    await request(app)
      .post(`/api/bookings/${body.booking.id}/abandon?token=${body.guestToken}`)
      .expect(200);

    expect((await store.getBooking(body.booking.id))?.status).toBe('confirmed');
    expect(await store.listHeldDates('main')).toEqual(STAY_NIGHTS);
  });

  it('refuses without the right token', async () => {
    await enableDirectBooking();
    const body = await createBooking();

    await request(app).post(`/api/bookings/${body.booking.id}/abandon`).expect(404);
    await request(app).post(`/api/bookings/${body.booking.id}/abandon?token=wrong`).expect(404);
    expect((await store.getBooking(body.booking.id))?.status).toBe('pending_payment');
  });
});

describe('webhook signature', () => {
  it('rejects a request with no signature header', async () => {
    await request(app).post('/api/stripe/webhook').send({ id: 'evt_1' }).expect(400);
  });

  it('rejects a payload signed with the wrong secret', async () => {
    await enableDirectBooking();
    const body = await createBooking();

    await postWebhook(checkoutCompleted(body.booking.id), { secret: 'whsec_wrong_secret' }).expect(400);
    expect((await store.getBooking(body.booking.id))?.status).toBe('pending_payment');
  });

  it('rejects a payload that was altered after signing', async () => {
    await enableDirectBooking();
    const body = await createBooking();

    const payload = JSON.stringify(checkoutCompleted(body.booking.id));
    const signature = signWebhookPayload(payload);

    await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload.replace('cs_test_1', 'cs_test_9'))
      .expect(400);
  });
});

describe('checkout.session.completed', () => {
  it('confirms the booking and records the real Stripe fee', async () => {
    await enableDirectBooking();
    const body = await createBooking();

    await postWebhook(checkoutCompleted(body.booking.id)).expect(200);

    const stored = await store.getBooking(body.booking.id);
    expect(stored?.status).toBe('confirmed');
    expect(stored?.confirmationNo).toMatch(/^BC-\d{8}-[A-Z0-9]{4}$/);
    expect(stored?.stripePaymentIntentId).toBe('pi_test_123');
    expect(stored?.stripeFeeAmount).toBe(1260);
    expect(stored?.holdExpiresAt).toBeNull();
    expect(stored?.confirmedAt).toBeGreaterThan(0);
  });

  it('keeps the nights held after confirmation', async () => {
    await enableDirectBooking();
    const body = await createBooking();
    await postWebhook(checkoutCompleted(body.booking.id)).expect(200);

    expect(await store.listHeldDates('main')).toEqual(STAY_NIGHTS);
    const res = await request(app)
      .get(`/api/properties/availability?checkIn=${CHECK_IN}&checkOut=${CHECK_OUT}`)
      .expect(200);
    expect(res.body.available.map((item: { id: string }) => item.id)).not.toContain('main');
  });

  it('publishes the confirmed booking to the iCal feed exactly once, with its guest count', async () => {
    await enableDirectBooking();
    const body = await createBooking();
    await postWebhook(checkoutCompleted(body.booking.id)).expect(200);

    const token = await login('admin@sachihouse.com', 'admin123');
    const cal = await request(app)
      .get('/api/properties/main/calendar')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    const exportUrl: string = cal.body.exportUrl;
    const ics = await request(app).get(exportUrl.slice(exportUrl.indexOf('/api/'))).expect(200);

    expect(ics.text).toContain(`direct-${body.booking.id}`);
    expect(ics.text).toContain('DESCRIPTION:2 guests');
    // The booking is also mirrored into booking_confirmations for the PDF/
    // accounting flows — it must not be published a second time under that id
    // (i.e. no "booking-main-BC-..." UID for this same stay).
    expect(ics.text.match(new RegExp(`direct-${body.booking.id}`, 'g'))).toHaveLength(1);

    // The host calendar's "manual confirmations" list is likewise not
    // double-counting this online booking under its mirrored id.
    expect(cal.body.bookings).toEqual([]);
  });

  it('processes a redelivered event only once', async () => {
    await enableDirectBooking();
    const body = await createBooking();

    const first = await postWebhook(checkoutCompleted(body.booking.id)).expect(200);
    expect(first.body).toEqual({ received: true });

    const confirmationNo = (await store.getBooking(body.booking.id))?.confirmationNo;

    const second = await postWebhook(checkoutCompleted(body.booking.id)).expect(200);
    expect(second.body).toEqual({ received: true, duplicate: true });

    // A fresh confirmation number would prove the handler ran twice.
    expect((await store.getBooking(body.booking.id))?.confirmationNo).toBe(confirmationNo);
  });

  it('refuses to confirm a hold the sweeper already released', async () => {
    await enableDirectBooking();
    const body = await createBooking();

    await store.expireStaleHolds(Date.now() + 36 * 60_000);
    expect((await store.getBooking(body.booking.id))?.status).toBe('expired');

    // Stripe still says it was paid, but those nights are back on sale — the
    // booking must not silently reclaim them.
    await postWebhook(checkoutCompleted(body.booking.id)).expect(200);

    const stored = await store.getBooking(body.booking.id);
    expect(stored?.status).toBe('expired');
    expect(stored?.confirmationNo).toBeUndefined();
    expect(await store.listHeldDates('main')).toEqual([]);
  });

  it('ignores an event for a booking that does not exist', async () => {
    await postWebhook(checkoutCompleted('BK-does-not-exist')).expect(200);
  });
});

describe('failed and abandoned payments', () => {
  it('releases the nights when the session expires', async () => {
    await enableDirectBooking();
    const body = await createBooking();

    await postWebhook({
      id: 'evt_expired_1',
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_test_1', metadata: { bookingId: body.booking.id } } },
    }).expect(200);

    expect((await store.getBooking(body.booking.id))?.status).toBe('expired');
    expect(await store.listHeldDates('main')).toEqual([]);
  });

  it('keeps the hold when a card is declined, because Checkout allows a retry', async () => {
    await enableDirectBooking();
    const body = await createBooking();

    await postWebhook({
      id: 'evt_failed_1',
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_test_123', metadata: { bookingId: body.booking.id } } },
    }).expect(200);

    expect((await store.getBooking(body.booking.id))?.status).toBe('pending_payment');
    expect(await store.listHeldDates('main')).toEqual(STAY_NIGHTS);
  });

  it('confirms a booking whose first card was declined and second succeeded', async () => {
    await enableDirectBooking();
    const body = await createBooking();

    await postWebhook({
      id: 'evt_failed_2',
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_test_123', metadata: { bookingId: body.booking.id } } },
    }).expect(200);

    // The guest tries another card on the same Checkout page and it works.
    await postWebhook(checkoutCompleted(body.booking.id, 'evt_retry_ok')).expect(200);

    const stored = await store.getBooking(body.booking.id);
    // Taking the money without confirming the stay would be the worst outcome.
    expect(stored?.status).toBe('confirmed');
    expect(stored?.confirmationNo).toBeTruthy();
    expect(await store.listHeldDates('main')).toEqual(STAY_NIGHTS);
  });

  it('does not expire a booking that was already paid', async () => {
    await enableDirectBooking();
    const body = await createBooking();
    await postWebhook(checkoutCompleted(body.booking.id)).expect(200);

    // Out-of-order delivery: an expiry event arriving after confirmation.
    await postWebhook({
      id: 'evt_expired_2',
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_test_1', metadata: { bookingId: body.booking.id } } },
    }).expect(200);

    expect((await store.getBooking(body.booking.id))?.status).toBe('confirmed');
    expect(await store.listHeldDates('main')).toEqual(STAY_NIGHTS);
  });
});

describe('refunds issued outside our API', () => {
  it('mirrors a refund made in the Stripe Dashboard', async () => {
    await enableDirectBooking();
    const body = await createBooking();
    await postWebhook(checkoutCompleted(body.booking.id)).expect(200);

    await postWebhook({
      id: 'evt_refund_1',
      type: 'charge.refunded',
      data: { object: { id: 'ch_test_1', metadata: { bookingId: body.booking.id }, amount_refunded: 33740 } },
    }).expect(200);

    const stored = await store.getBooking(body.booking.id);
    expect(stored?.refundAmount).toBe(33740);
    // A refund alone does not free the room; cancelling is a separate decision.
    expect(stored?.status).toBe('confirmed');
  });
});

describe('chargebacks', () => {
  it('acknowledges a dispute without cancelling the stay', async () => {
    await enableDirectBooking();
    const body = await createBooking();
    await postWebhook(checkoutCompleted(body.booking.id)).expect(200);

    await postWebhook({
      id: 'evt_dispute_1',
      type: 'charge.dispute.created',
      data: { object: { id: 'dp_test_1', charge: 'ch_test_1' } },
    }).expect(200);

    expect((await store.getBooking(body.booking.id))?.status).toBe('confirmed');
    expect(await store.listHeldDates('main')).toEqual(STAY_NIGHTS);
  });
});

describe('guest status polling', () => {
  it('flips to confirmed for the guest once the webhook lands', async () => {
    await enableDirectBooking();
    const body = await createBooking();

    const before = await request(app)
      .get(`/api/bookings/${body.booking.id}?token=${body.guestToken}`)
      .expect(200);
    expect(before.body.booking.status).toBe('pending_payment');

    await postWebhook(checkoutCompleted(body.booking.id)).expect(200);

    const after = await request(app)
      .get(`/api/bookings/${body.booking.id}?token=${body.guestToken}`)
      .expect(200);
    expect(after.body.booking.status).toBe('confirmed');
    expect(after.body.booking.confirmationNo).toBeTruthy();
  });
});

describe('guest confirmation-PDF data', () => {
  it('404s before payment confirms — nothing has been mirrored yet', async () => {
    await enableDirectBooking();
    const body = await createBooking();

    await request(app)
      .get(`/api/bookings/${body.booking.id}/confirmation?token=${body.guestToken}`)
      .expect(404);
  });

  it('serves the mirrored confirmation record once payment completes, for the PDF renderer', async () => {
    await enableDirectBooking();
    const body = await createBooking();
    await postWebhook(checkoutCompleted(body.booking.id)).expect(200);

    const after = await request(app)
      .get(`/api/bookings/${body.booking.id}?token=${body.guestToken}`)
      .expect(200);

    const res = await request(app)
      .get(`/api/bookings/${body.booking.id}/confirmation?token=${body.guestToken}`)
      .expect(200);

    expect(res.body.confirmation.confirmationNo).toBe(after.body.booking.confirmationNo);
    expect(res.body.confirmation.guestName).toBe('Hanako Tanaka');
    expect(res.body.confirmation.source).toBe('online');
  });

  it('snapshots the property\'s free-cancellation window, for the PDF cancellation-policy note', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const current = await request(app).get('/api/properties/main').expect(200);
    await request(app)
      .put('/api/properties/main')
      .set({ Authorization: `Bearer ${token}` })
      .send({ ...current.body.property, directBooking: { enabled: true, freeCancellationDays: 10 } })
      .expect(200);

    const body = await createBooking();
    await postWebhook(checkoutCompleted(body.booking.id)).expect(200);

    const res = await request(app)
      .get(`/api/bookings/${body.booking.id}/confirmation?token=${body.guestToken}`)
      .expect(200);

    expect(res.body.confirmation.freeCancellationDays).toBe(10);
  });

  it('rejects a wrong or missing token', async () => {
    await enableDirectBooking();
    const body = await createBooking();
    await postWebhook(checkoutCompleted(body.booking.id)).expect(200);

    await request(app)
      .get(`/api/bookings/${body.booking.id}/confirmation?token=wrong-token`)
      .expect(404);
  });
});
