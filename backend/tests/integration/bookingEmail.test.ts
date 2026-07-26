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

const GUEST_EMAIL = 'hanako@example.com';

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

async function bookAndPay(options: { locale?: string; daysAhead?: number; pay?: boolean } = {}) {
  const daysAhead = options.daysAhead ?? 40;
  const created = await request(app)
    .post('/api/bookings')
    .send({
      propertyId: 'main',
      guestName: 'Hanako Tanaka',
      guestEmail: GUEST_EMAIL,
      guestPhone: '+81 90 1234 5678',
      adults: 2,
      children: 0,
      infants: 0,
      checkInDate: isoDaysFromNow(daysAhead),
      checkOutDate: isoDaysFromNow(daysAhead + 3),
      locale: options.locale ?? 'ja',
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

describe('confirmation email', () => {
  it('emails the guest once the payment webhook confirms', async () => {
    await enableDirectBooking();
    const { id } = await bookAndPay();

    const guestMail = mailer.to(GUEST_EMAIL);
    expect(guestMail).toHaveLength(1);

    const booking = await store.getBooking(id);
    expect(guestMail[0].subject).toContain(booking!.confirmationNo!);
    expect(guestMail[0].text).toContain(booking!.confirmationNo!);
  });

  it('sends nothing until the booking is actually paid', async () => {
    await enableDirectBooking();
    await bookAndPay({ pay: false });

    expect(mailer.sent).toHaveLength(0);
  });

  it('includes the check-in link and the booking management link', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay();
    const [mail] = mailer.to(GUEST_EMAIL);

    // The public site routes by metalink, not by the internal property id.
    expect(mail.text).toContain('/sachi-ojima/checkin');
    expect(mail.text).toContain(`/booking/result?id=${id}&token=${guestToken}`);
  });

  it('writes to the guest in their own language', async () => {
    await enableDirectBooking();
    await bookAndPay({ locale: 'vi' });

    const [mail] = mailer.to(GUEST_EMAIL);
    expect(mail.subject).toContain('Đặt phòng đã xác nhận');
    expect(mail.text).toContain('Mã đặt phòng');
  });

  it('falls back to English for a language we have no template for', async () => {
    await enableDirectBooking();
    await bookAndPay({ locale: 'fr' });

    const [mail] = mailer.to(GUEST_EMAIL);
    expect(mail.subject).toContain('Booking confirmed');
  });

  it('notifies the host at the property address, in the host language', async () => {
    await enableDirectBooking({ adminEmail: 'host@sachihouse.com' });
    await bookAndPay();

    const hostMail = mailer.to('host@sachihouse.com');
    expect(hostMail).toHaveLength(1);
    expect(hostMail[0].subject).toContain('直販の新規予約');
    // Replying to the notification should reach the guest, not us.
    expect(hostMail[0].replyTo).toBe(GUEST_EMAIL);
    expect(hostMail[0].text).toContain('Hanako Tanaka');
    expect(hostMail[0].text).toContain('+81 90 1234 5678');
  });

  it('still confirms the booking when the mail server is down', async () => {
    await enableDirectBooking();
    mailer.failNextSend = true;
    const { id } = await bookAndPay();

    // A paid booking must never be lost because SMTP failed.
    expect((await store.getBooking(id))?.status).toBe('confirmed');
  });

  it('does not email twice when Stripe redelivers the event', async () => {
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

    expect(mailer.to(GUEST_EMAIL)).toHaveLength(1);
  });
});

describe('resending a confirmation', () => {
  it('sends the confirmation again to guest and host', async () => {
    await enableDirectBooking({ adminEmail: 'host@sachihouse.com' });
    const { id } = await bookAndPay();
    mailer.sent.length = 0;

    const token = await login('admin@sachihouse.com', 'admin123');
    const res = await request(app)
      .post(`/api/bookings/${id}/resend-confirmation`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    expect(res.body).toEqual({ sent: true, to: GUEST_EMAIL });
    expect(mailer.to(GUEST_EMAIL)).toHaveLength(1);
    expect(mailer.to('host@sachihouse.com')).toHaveLength(1);
  });

  it('refuses for a booking that was never confirmed', async () => {
    await enableDirectBooking();
    const { id } = await bookAndPay({ pay: false });

    const token = await login('admin@sachihouse.com', 'admin123');
    const res = await request(app)
      .post(`/api/bookings/${id}/resend-confirmation`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(409);
    expect(res.body.error).toMatch(/pending_payment/);
  });

  it('requires authentication', async () => {
    await enableDirectBooking();
    const { id } = await bookAndPay();
    await request(app).post(`/api/bookings/${id}/resend-confirmation`).expect(401);
  });
});

describe('cancellation email', () => {
  it('tells the guest the refund amount', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay({ daysAhead: 40 });
    mailer.sent.length = 0;

    await request(app).post(`/api/bookings/${id}/cancel?token=${guestToken}`).expect(200);

    const [mail] = mailer.to(GUEST_EMAIL);
    expect(mail.subject).toContain('ご予約のキャンセル');
    expect(mail.text).toContain('¥33,740');
  });

  it('states plainly that a late cancellation is not refunded', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay({ daysAhead: 3 });
    mailer.sent.length = 0;

    await request(app).post(`/api/bookings/${id}/cancel?token=${guestToken}`).expect(200);

    const [mail] = mailer.to(GUEST_EMAIL);
    expect(mail.text).toContain('返金対象外');
  });

  it('notifies the host so the freed dates are not a surprise', async () => {
    await enableDirectBooking({ adminEmail: 'host@sachihouse.com' });
    const { id, guestToken } = await bookAndPay();
    mailer.sent.length = 0;

    await request(app).post(`/api/bookings/${id}/cancel?token=${guestToken}`).expect(200);

    expect(mailer.to('host@sachihouse.com')).toHaveLength(1);
  });

  it('sends no cancellation mail for a hold that was never paid', async () => {
    await enableDirectBooking();
    const { id, guestToken } = await bookAndPay({ pay: false });

    await request(app).post(`/api/bookings/${id}/cancel?token=${guestToken}`).expect(200);

    expect(mailer.sent).toHaveLength(0);
  });

  it('emails after a host cancellation too', async () => {
    await enableDirectBooking({ adminEmail: 'host@sachihouse.com' });
    const { id } = await bookAndPay();
    mailer.sent.length = 0;

    const token = await login('admin@sachihouse.com', 'admin123');
    await request(app)
      .post(`/api/bookings/${id}/cancel-by-host`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    expect(mailer.to(GUEST_EMAIL)).toHaveLength(1);
    expect(mailer.to('host@sachihouse.com')).toHaveLength(1);
  });
});
