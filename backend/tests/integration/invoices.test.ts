import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { FakePaymentGateway } from '../helpers/fakePaymentGateway.js';
import { FakeMailer } from '../helpers/fakeMailer.js';

let app: ReturnType<typeof createApp>;
let store: MemoryStore;

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  return res.body.token as string;
}

const SETTINGS = {
  registrationNumber: 'T1234567890123',
  issuerName: '株式会社サチハウス',
  issuerAddress: '東京都豊島区1-2-3',
  issuerPhone: '03-1234-5678',
  bankInfo: 'みずほ銀行 池袋支店 普通 1234567',
};

/**
 * A stay inside the invoiceable window: arrived three days ago, leaving
 * tomorrow. The picker only lists guests in the house or gone within the
 * month, so a stay seeded in the future would not appear at all.
 */
async function seedStay(token: string, overrides: Record<string, unknown> = {}) {
  const payload = {
    propertyName: 'Sachi House Ojima',
    propertyAddress: '1-2-3 Ojima, Koto-ku',
    propertyUrl: 'https://example.com/#/ojima',
    guestName: 'Booking Name',
    numGuests: 2,
    checkInDate: isoDaysFromNow(-3),
    checkOutDate: isoDaysFromNow(1),
    checkInTime: '15:00',
    checkOutTime: '10:00',
    currency: 'JPY',
    roomFee: 30000,
    cleaningFee: 5000,
    extraFee: 0,
    discountAmount: 0,
    totalAmount: 35000,
    depositAmount: 0,
    balanceDue: 35000,
    includeInAccounting: true,
    ...overrides,
  };
  const res = await request(app)
    .post('/api/properties/main/booking-confirmations')
    .set({ Authorization: `Bearer ${token}` })
    .send(payload)
    .expect(201);
  return res.body.confirmation;
}

beforeEach(async () => {
  store = new MemoryStore();
  await store.init();
  app = createApp(store, { payments: new FakePaymentGateway(), mailer: new FakeMailer() });
});

describe('invoice settings', () => {
  it('is refused below host level 4, the same bar the finance screens sit behind', async () => {
    const admin = await login('admin@sachihouse.com', 'admin123');
    const created = await request(app)
      .post('/api/users')
      .set({ Authorization: `Bearer ${admin}` })
      .send({ name: 'L3 Host', email: 'l3@example.com', password: 'password123', role: 'HOST' })
      .expect(201);
    await request(app)
      .put(`/api/users/${created.body.user.id}/host-level`)
      .set({ Authorization: `Bearer ${admin}` })
      .send({ hostLevel: 3 })
      .expect(200);

    const host = await login('l3@example.com', 'password123');
    await request(app)
      .get('/api/invoice-settings')
      .set({ Authorization: `Bearer ${host}` })
      .expect(403);
  });

  it('rejects a registration number that is not T plus 13 digits', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    await request(app)
      .put('/api/invoice-settings')
      .set({ Authorization: `Bearer ${token}` })
      .send({ ...SETTINGS, registrationNumber: '1234567890123' })
      .expect(400);
  });

  it('normalises the separators a host types into the stored number', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const res = await request(app)
      .put('/api/invoice-settings')
      .set({ Authorization: `Bearer ${token}` })
      .send({ ...SETTINGS, registrationNumber: 't1234-5678-90123' })
      .expect(200);

    expect(res.body.settings.registrationNumber).toBe('T1234567890123');
  });
});

describe('invoiceable stays', () => {
  it('lists a manual booking confirmation with its amounts prefilled', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const confirmation = await seedStay(token);

    const res = await request(app)
      .get('/api/invoices/stays')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    const stay = res.body.stays.find((row: { sourceId: string }) => row.sourceId === confirmation.id);
    expect(stay).toBeTruthy();
    expect(stay.roomFee).toBe(30000);
    expect(stay.cleaningFee).toBe(5000);
    expect(stay.totalAmount).toBe(35000);
    expect(stay.existingInvoice).toBeNull();
  });
});

describe('issuing an invoice', () => {
  async function ready() {
    const token = await login('admin@sachihouse.com', 'admin123');
    await request(app)
      .put('/api/invoice-settings')
      .set({ Authorization: `Bearer ${token}` })
      .send(SETTINGS)
      .expect(200);
    const confirmation = await seedStay(token);
    return { token, confirmation };
  }

  function invoiceBody(confirmation: { id: string; checkInDate: string; checkOutDate: string }) {
    return {
      propertyId: 'main',
      sourceKind: 'booking_confirmation',
      sourceId: confirmation.id,
      sourceLabel: 'Manual',
      checkInDate: confirmation.checkInDate,
      checkOutDate: confirmation.checkOutDate,
      customerName: '田中 有紀',
      customerAddress: '大阪府大阪市…',
      customerSource: 'checkin',
      currency: 'JPY',
      lineItems: [
        { description: '宿泊料金', quantity: 1, unitPrice: 30000, amount: 30000, taxCategory: 'standard10' },
        { description: '清掃料金', quantity: 1, unitPrice: 5000, amount: 5000, taxCategory: 'standard10' },
      ],
    };
  }

  it('refuses to issue before the host has a registration number', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const confirmation = await seedStay(token);

    const res = await request(app)
      .post('/api/invoices')
      .set({ Authorization: `Bearer ${token}` })
      .send(invoiceBody(confirmation))
      .expect(400);

    expect(res.body.code).toBe('INVOICE_SETTINGS_MISSING');
  });

  it('snapshots the issuer and works the tax out from the tax-inclusive total', async () => {
    const { token, confirmation } = await ready();

    const res = await request(app)
      .post('/api/invoices')
      .set({ Authorization: `Bearer ${token}` })
      .send(invoiceBody(confirmation))
      .expect(201);

    const invoice = res.body.invoice;
    expect(invoice.invoiceNo).toMatch(/^INV-\d{4}-0001$/);
    expect(invoice.issuerRegistrationNumber).toBe('T1234567890123');
    expect(invoice.issuerName).toBe(SETTINGS.issuerName);
    // ¥35,000 tax-inclusive at 10% is ¥31,819 + ¥3,181 (rounded down once).
    expect(invoice.totalAmount).toBe(35000);
    expect(invoice.totalTax).toBe(3181);
    expect(invoice.subtotalTaxExclusive).toBe(31819);
    expect(invoice.taxBreakdown).toHaveLength(1);
    expect(invoice.taxBreakdown[0].taxRate).toBe(0.1);
  });

  it('numbers invoices consecutively per issuer', async () => {
    const { token, confirmation } = await ready();

    const first = await request(app)
      .post('/api/invoices')
      .set({ Authorization: `Bearer ${token}` })
      .send(invoiceBody(confirmation))
      .expect(201);
    const second = await request(app)
      .post('/api/invoices')
      .set({ Authorization: `Bearer ${token}` })
      .send({ ...invoiceBody(confirmation), sourceId: undefined, sourceKind: 'manual' })
      .expect(201);

    expect(first.body.invoice.sequence).toBe(1);
    expect(second.body.invoice.sequence).toBe(2);
    expect(second.body.invoice.invoiceNo.endsWith('0002')).toBe(true);
  });
});

describe('a stay is only invoiced once by accident', () => {
  async function ready() {
    const token = await login('admin@sachihouse.com', 'admin123');
    await request(app)
      .put('/api/invoice-settings')
      .set({ Authorization: `Bearer ${token}` })
      .send(SETTINGS)
      .expect(200);
    const confirmation = await seedStay(token);
    const body = {
      propertyId: 'main',
      sourceKind: 'booking_confirmation',
      sourceId: confirmation.id,
      checkInDate: confirmation.checkInDate,
      checkOutDate: confirmation.checkOutDate,
      customerName: '田中 有紀',
      customerSource: 'checkin',
      lineItems: [
        { description: '宿泊料金', quantity: 1, unitPrice: 35000, amount: 35000, taxCategory: 'standard10' },
      ],
    };
    return { token, confirmation, body };
  }

  it('refuses a second invoice for the same booking, and says which one exists', async () => {
    const { token, body } = await ready();
    const first = await request(app)
      .post('/api/invoices')
      .set({ Authorization: `Bearer ${token}` })
      .send(body)
      .expect(201);

    const clash = await request(app)
      .post('/api/invoices')
      .set({ Authorization: `Bearer ${token}` })
      .send(body)
      .expect(409);

    expect(clash.body.code).toBe('INVOICE_ALREADY_ISSUED');
    expect(clash.body.invoice.invoiceNo).toBe(first.body.invoice.invoiceNo);
  });

  it('still allows a deliberate reissue', async () => {
    const { token, body } = await ready();
    await request(app).post('/api/invoices').set({ Authorization: `Bearer ${token}` }).send(body).expect(201);
    await request(app)
      .post('/api/invoices')
      .set({ Authorization: `Bearer ${token}` })
      .send({ ...body, allowDuplicate: true })
      .expect(201);
  });

  it('shows the already-issued invoice on the stay picker', async () => {
    const { token, body, confirmation } = await ready();
    await request(app).post('/api/invoices').set({ Authorization: `Bearer ${token}` }).send(body).expect(201);

    const res = await request(app)
      .get('/api/invoices/stays')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    const stay = res.body.stays.find((row: { sourceId: string }) => row.sourceId === confirmation.id);
    expect(stay.existingInvoice.invoiceNo).toMatch(/^INV-/);
  });

  it('voids rather than deletes, so the numbering keeps no gaps', async () => {
    const { token, body } = await ready();
    const created = await request(app)
      .post('/api/invoices')
      .set({ Authorization: `Bearer ${token}` })
      .send(body)
      .expect(201);

    await request(app)
      .post(`/api/invoices/${created.body.invoice.id}/void`)
      .set({ Authorization: `Bearer ${token}` })
      .send({})
      .expect(400);

    const voided = await request(app)
      .post(`/api/invoices/${created.body.invoice.id}/void`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ reason: 'Guest asked for a different 宛名' })
      .expect(200);

    expect(voided.body.invoice.status).toBe('void');
    expect(voided.body.invoice.invoiceNo).toBe(created.body.invoice.invoiceNo);

    // A voided stay is invoiceable again without the duplicate guard firing.
    await request(app).post('/api/invoices').set({ Authorization: `Bearer ${token}` }).send(body).expect(201);
  });
});

describe('archiving the PDF', () => {
  // No bucket is configured under test, which is also the state a fresh
  // deployment is in — so this is the path that has to stay non-destructive.
  it('says so plainly rather than failing the issue when no bucket is configured', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    await request(app)
      .put('/api/invoice-settings')
      .set({ Authorization: `Bearer ${token}` })
      .send(SETTINGS)
      .expect(200);
    const confirmation = await seedStay(token);

    const created = await request(app)
      .post('/api/invoices')
      .set({ Authorization: `Bearer ${token}` })
      .send({
        propertyId: 'main',
        sourceKind: 'booking_confirmation',
        sourceId: confirmation.id,
        checkInDate: confirmation.checkInDate,
        checkOutDate: confirmation.checkOutDate,
        customerName: '田中 有紀',
        customerSource: 'checkin',
        lineItems: [
          { description: '宿泊料金', quantity: 1, unitPrice: 35000, amount: 35000, taxCategory: 'standard10' },
        ],
      })
      .expect(201);

    // The invoice exists and is complete either way.
    expect(created.body.archiveConfigured).toBe(false);
    expect(created.body.invoice.pdfObjectPath).toBeUndefined();

    const archive = await request(app)
      .post(`/api/invoices/${created.body.invoice.id}/pdf`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ pdfBase64: Buffer.from('%PDF-1.4 fake').toString('base64') })
      .expect(503);

    expect(archive.body.code).toBe('INVOICE_ARCHIVE_NOT_CONFIGURED');

    // And it is still readable and still issued.
    const read = await request(app)
      .get(`/api/invoices/${created.body.invoice.id}`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(read.body.invoice.status).toBe('issued');
  });

  it('will not accept a PDF for another host’s property', async () => {
    const admin = await login('admin@sachihouse.com', 'admin123');
    await request(app)
      .put('/api/invoice-settings')
      .set({ Authorization: `Bearer ${admin}` })
      .send(SETTINGS)
      .expect(200);
    const confirmation = await seedStay(admin);
    const created = await request(app)
      .post('/api/invoices')
      .set({ Authorization: `Bearer ${admin}` })
      .send({
        propertyId: 'main',
        sourceKind: 'booking_confirmation',
        sourceId: confirmation.id,
        checkInDate: confirmation.checkInDate,
        checkOutDate: confirmation.checkOutDate,
        customerName: '田中 有紀',
        customerSource: 'checkin',
        lineItems: [
          { description: '宿泊料金', quantity: 1, unitPrice: 35000, amount: 35000, taxCategory: 'standard10' },
        ],
      })
      .expect(201);

    const other = await request(app)
      .post('/api/users')
      .set({ Authorization: `Bearer ${admin}` })
      .send({ name: 'Other L4', email: 'other@example.com', password: 'password123', role: 'HOST' })
      .expect(201);
    await request(app)
      .put(`/api/users/${other.body.user.id}/host-level`)
      .set({ Authorization: `Bearer ${admin}` })
      .send({ hostLevel: 4 })
      .expect(200);

    const outsider = await login('other@example.com', 'password123');
    await request(app)
      .post(`/api/invoices/${created.body.invoice.id}/pdf`)
      .set({ Authorization: `Bearer ${outsider}` })
      .send({ pdfBase64: Buffer.from('%PDF-1.4 fake').toString('base64') })
      .expect(403);
  });
});

describe('which stays the picker offers', () => {
  async function stayKeys(token: string): Promise<string[]> {
    const res = await request(app)
      .get('/api/invoices/stays')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    return res.body.stays.map((row: { sourceId: string }) => row.sourceId);
  }

  it('leaves out a booking that has not started yet', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const future = await seedStay(token, {
      checkInDate: isoDaysFromNow(40),
      checkOutDate: isoDaysFromNow(43),
      guestName: 'Next month',
    });

    expect(await stayKeys(token)).not.toContain(future.id);
  });

  it('leaves out a stay that ended more than a month ago', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const old = await seedStay(token, {
      checkInDate: isoDaysFromNow(-70),
      checkOutDate: isoDaysFromNow(-67),
      guestName: 'Long gone',
    });

    expect(await stayKeys(token)).not.toContain(old.id);
  });

  it('keeps a guest who is in the house right now', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const current = await seedStay(token, { guestName: 'In the house' });

    expect(await stayKeys(token)).toContain(current.id);
  });

  it('keeps a guest who checked out within the month', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const recent = await seedStay(token, {
      checkInDate: isoDaysFromNow(-20),
      checkOutDate: isoDaysFromNow(-18),
      guestName: 'Just left',
    });

    expect(await stayKeys(token)).toContain(recent.id);
  });

  it('keeps a long stay that began before the window and is still running', async () => {
    // The reason the window is an overlap test rather than a check-in one: this
    // guest arrived two months ago and is standing at the desk today.
    const token = await login('admin@sachihouse.com', 'admin123');
    const long = await seedStay(token, {
      checkInDate: isoDaysFromNow(-60),
      checkOutDate: isoDaysFromNow(5),
      guestName: 'Still here',
    });

    expect(await stayKeys(token)).toContain(long.id);
  });

  it('lists the newest arrival first', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const older = await seedStay(token, {
      checkInDate: isoDaysFromNow(-20),
      checkOutDate: isoDaysFromNow(-18),
      guestName: 'Older',
    });
    const newer = await seedStay(token, {
      checkInDate: isoDaysFromNow(-6),
      checkOutDate: isoDaysFromNow(-5),
      guestName: 'Newer',
    });

    const keys = await stayKeys(token);
    expect(keys.indexOf(newer.id)).toBeLessThan(keys.indexOf(older.id));
  });
});
