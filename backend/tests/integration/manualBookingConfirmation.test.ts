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

beforeEach(async () => {
  store = new MemoryStore();
  await store.init();
  payments = new FakePaymentGateway();
  mailer = new FakeMailer();
  app = createApp(store, { payments, mailer });
});

describe('manual booking confirmation: calendar sync', () => {
  it('rejects a manual entry on dates another platform already blocks', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const blockedDate = isoDaysFromNow(41);
    await request(app)
      .post('/api/properties/main/blocked-dates')
      .set({ Authorization: `Bearer ${token}` })
      .send({ dates: [blockedDate] })
      .expect(200);

    const res = await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set({ Authorization: `Bearer ${token}` })
      .send(manualPayload())
      .expect(409);

    expect(res.body.error).toMatch(/not available/);
    expect(res.body.conflictDates).toContain(blockedDate);
  });

  it('rejects a manual entry overlapping a paid direct booking', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const current = await request(app).get('/api/properties/main').expect(200);
    await request(app)
      .put('/api/properties/main')
      .set({ Authorization: `Bearer ${token}` })
      .send({ ...current.body.property, directBooking: { enabled: true } })
      .expect(200);

    const created = await request(app)
      .post('/api/bookings')
      .send({
        propertyId: 'main',
        guestName: 'Hanako Tanaka',
        guestEmail: 'hanako@example.com',
        adults: 2,
        children: 0,
        infants: 0,
        checkInDate: isoDaysFromNow(40),
        checkOutDate: isoDaysFromNow(43),
        locale: 'ja',
      })
      .expect(201);
    const payload = JSON.stringify({
      id: `evt_${created.body.booking.id}`,
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', metadata: { bookingId: created.body.booking.id }, payment_intent: 'pi_test_123' } },
    });
    await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', signWebhookPayload(payload))
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(200);

    const res = await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set({ Authorization: `Bearer ${token}` })
      .send(manualPayload({ checkInDate: isoDaysFromNow(41), checkOutDate: isoDaysFromNow(44) }))
      .expect(409);

    expect(res.body.conflictDates.length).toBeGreaterThan(0);
  });

  it('allows a manual entry once the conflicting block is removed', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const blockedDate = isoDaysFromNow(41);
    await request(app)
      .post('/api/properties/main/blocked-dates')
      .set({ Authorization: `Bearer ${token}` })
      .send({ dates: [blockedDate] })
      .expect(200);
    await request(app)
      .delete('/api/properties/main/blocked-dates')
      .set({ Authorization: `Bearer ${token}` })
      .send({ dates: [blockedDate] })
      .expect(200);

    await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set({ Authorization: `Bearer ${token}` })
      .send(manualPayload())
      .expect(201);
  });
});

describe('manual booking confirmation: guest email', () => {
  it('emails the guest a confirmation containing the booking details', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');

    const res = await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set({ Authorization: `Bearer ${token}` })
      .send(manualPayload({ locale: 'en' }))
      .expect(201);

    const mail = mailer.to('guest@example.com');
    expect(mail).toHaveLength(1);
    expect(mail[0].text).toContain(res.body.confirmation.confirmationNo);
    expect(mail[0].text).toContain('Sachi House Ojima');
    expect(mail[0].text).toContain('¥35,000');
  });

  it('writes the manual confirmation email in the requested language', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');

    await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set({ Authorization: `Bearer ${token}` })
      .send(manualPayload({ locale: 'vi' }))
      .expect(201);

    const [mail] = mailer.to('guest@example.com');
    expect(mail.subject).toContain('Đặt phòng đã xác nhận');
  });

  it('sends nothing when no guest email was given', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');

    await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set({ Authorization: `Bearer ${token}` })
      .send(manualPayload({ guestEmail: undefined }))
      .expect(201);

    expect(mailer.sent).toHaveLength(0);
  });

  it('still creates the confirmation even if the mail server is down', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    mailer.failNextSend = true;

    const res = await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set({ Authorization: `Bearer ${token}` })
      .send(manualPayload())
      .expect(201);

    expect(res.body.confirmation.guestName).toBe('Airbnb Guest');
  });
});

describe('manual booking confirmation: PDF-attached email', () => {
  const fakePdfBase64 = Buffer.from('%PDF-1.4 fake pdf content for tests').toString('base64');

  it('skips the create-time email when attachPdf is true', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');

    await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set({ Authorization: `Bearer ${token}` })
      .send(manualPayload({ attachPdf: true }))
      .expect(201);

    expect(mailer.sent).toHaveLength(0);
  });

  it('sends the confirmation email with the PDF attached', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');

    const created = await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set({ Authorization: `Bearer ${token}` })
      .send(manualPayload({ attachPdf: true }))
      .expect(201);

    await request(app)
      .post(`/api/booking-confirmations/${created.body.confirmation.id}/email`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ pdfBase64: fakePdfBase64, pdfFileName: 'confirmation.pdf', locale: 'en' })
      .expect(200);

    const mail = mailer.to('guest@example.com');
    expect(mail).toHaveLength(1);
    expect(mail[0].attachments).toHaveLength(1);
    expect(mail[0].attachments?.[0].filename).toBe('confirmation.pdf');
    expect(mail[0].attachments?.[0].content).toBe(fakePdfBase64);
  });

  it('rejects a payload that is not actually a PDF', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');

    const created = await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set({ Authorization: `Bearer ${token}` })
      .send(manualPayload({ attachPdf: true }))
      .expect(201);

    const res = await request(app)
      .post(`/api/booking-confirmations/${created.body.confirmation.id}/email`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ pdfBase64: Buffer.from('not a pdf').toString('base64') })
      .expect(400);

    expect(res.body.error).toMatch(/not a pdf/i);
    expect(mailer.sent).toHaveLength(0);
  });

  it('sends without an attachment when no pdfBase64 is given (plain resend)', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');

    const created = await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set({ Authorization: `Bearer ${token}` })
      .send(manualPayload({ attachPdf: true }))
      .expect(201);

    await request(app)
      .post(`/api/booking-confirmations/${created.body.confirmation.id}/email`)
      .set({ Authorization: `Bearer ${token}` })
      .send({})
      .expect(200);

    const mail = mailer.to('guest@example.com');
    expect(mail).toHaveLength(1);
    expect(mail[0].attachments).toBeUndefined();
  });

  it('rejects sending for a confirmation with no guest email on file', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');

    const created = await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set({ Authorization: `Bearer ${token}` })
      .send(manualPayload({ guestEmail: undefined }))
      .expect(201);

    const res = await request(app)
      .post(`/api/booking-confirmations/${created.body.confirmation.id}/email`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ pdfBase64: fakePdfBase64 })
      .expect(400);

    expect(res.body.error).toMatch(/no guest email/i);
  });

  it('404s for an unknown confirmation id', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');

    await request(app)
      .post('/api/booking-confirmations/does-not-exist/email')
      .set({ Authorization: `Bearer ${token}` })
      .send({ pdfBase64: fakePdfBase64 })
      .expect(404);
  });
});
