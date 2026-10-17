import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { toJstDateString } from '../../src/domain/booking.js';
import { MemoryStore } from '../../src/store/memoryStore.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let app: ReturnType<typeof createApp>;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  return bearer(res.body.token as string);
}

const adminAuth = () => login('admin@sachihouse.com', 'admin123');
const hostAuth = () => login('host@sachihouse.com', 'host123');

async function registerHost(email: string) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Other Host', email, password: 'secret123' })
    .expect(201);
  return bearer(res.body.token);
}

function jstDaysFromNow(days: number): string {
  return toJstDateString(Date.now() + days * DAY_MS);
}

function stayPayout(overrides: Record<string, unknown> = {}) {
  return {
    propertyId: 'main',
    stayRef: `main:${jstDaysFromNow(-3)}:${jstDaysFromNow(-1)}:Airbnb`,
    label: 'Airbnb',
    checkInDate: jstDaysFromNow(-3),
    checkOutDate: jstDaysFromNow(-1),
    cleaningFee: 8000,
    coHostPercent: 3,
    guestPayment: 100000,
    bonus: 500,
    supplies: 1200,
    ...overrides,
  };
}

beforeEach(async () => {
  const store = new MemoryStore();
  await store.init();
  app = createApp(store);
});

describe('recording a payout', () => {
  it('recomputes the co-host share and total on the server', async () => {
    const res = await request(app)
      .post('/api/cleaning-payouts')
      .set(await hostAuth())
      .send(stayPayout({ coHostShare: 999999, total: 1 }))
      .expect(201);
    expect(res.body.payout).toMatchObject({
      propertyId: 'main',
      coHostShare: 3000,
      total: 8000 + 3000 + 500 + 1200,
      paidByName: 'Sachi Primary Host',
    });
  });

  it('refuses to pay the same stay twice', async () => {
    const auth = await hostAuth();
    await request(app).post('/api/cleaning-payouts').set(auth).send(stayPayout()).expect(201);
    const again = await request(app).post('/api/cleaning-payouts').set(await adminAuth()).send(stayPayout()).expect(409);
    expect(again.body).toEqual({ error: 'This stay has already been paid.' });
  });

  it('allows several manual payouts with no stay', async () => {
    const auth = await hostAuth();
    const manual = { label: 'Extra deep clean', cleaningFee: 8000 };
    await request(app).post('/api/cleaning-payouts').set(auth).send(manual).expect(201);
    await request(app).post('/api/cleaning-payouts').set(auth).send(manual).expect(201);
  });

  it('rejects a stay on a property the host does not run', async () => {
    const other = await registerHost('other-host@sachihouse.com');
    await request(app).post('/api/cleaning-payouts').set(other).send(stayPayout()).expect(403);
  });

  it('rejects negative or fractional amounts and an empty payout', async () => {
    const auth = await hostAuth();
    await request(app).post('/api/cleaning-payouts').set(auth).send(stayPayout({ bonus: -100 })).expect(400);
    await request(app).post('/api/cleaning-payouts').set(auth).send(stayPayout({ supplies: 10.5 })).expect(400);
    await request(app).post('/api/cleaning-payouts').set(auth).send(stayPayout({ coHostPercent: 150 })).expect(400);
    await request(app).post('/api/cleaning-payouts').set(auth).send({ cleaningFee: 0 }).expect(400);
  });

  it('needs a property for a stay reference', async () => {
    await request(app)
      .post('/api/cleaning-payouts')
      .set(await hostAuth())
      .send(stayPayout({ propertyId: '' }))
      .expect(400);
  });
});

describe('listing payouts', () => {
  it('shows a host the payouts for their properties and their own manual ones', async () => {
    const host = await hostAuth();
    const admin = await adminAuth();
    await request(app).post('/api/cleaning-payouts').set(admin).send(stayPayout()).expect(201);
    await request(app).post('/api/cleaning-payouts').set(admin).send({ label: 'Admin manual', cleaningFee: 8000 }).expect(201);
    await request(app).post('/api/cleaning-payouts').set(host).send({ label: 'Host manual', cleaningFee: 8000 }).expect(201);

    const hostList = await request(app).get('/api/cleaning-payouts').set(host).expect(200);
    expect(hostList.body.payouts.map((p: { label: string }) => p.label).sort()).toEqual(['Airbnb', 'Host manual']);

    const adminList = await request(app).get('/api/cleaning-payouts').set(admin).expect(200);
    expect(adminList.body.payouts).toHaveLength(3);
  });

  it('leaves out stays that checked out before the window', async () => {
    const auth = await hostAuth();
    await request(app)
      .post('/api/cleaning-payouts')
      .set(auth)
      .send(stayPayout({ stayRef: 'old', checkInDate: jstDaysFromNow(-50), checkOutDate: jstDaysFromNow(-45) }))
      .expect(201);
    const res = await request(app).get('/api/cleaning-payouts').set(auth).expect(200);
    expect(res.body.payouts).toEqual([]);
  });
});

describe('undoing a payout', () => {
  it('lets the payer undo it, and then the stay can be paid again', async () => {
    const auth = await hostAuth();
    const created = await request(app).post('/api/cleaning-payouts').set(auth).send(stayPayout()).expect(201);
    await request(app).delete(`/api/cleaning-payouts/${created.body.payout.id}`).set(auth).expect(204);
    await request(app).post('/api/cleaning-payouts').set(auth).send(stayPayout()).expect(201);
  });

  it('does not let another host undo it', async () => {
    const created = await request(app)
      .post('/api/cleaning-payouts')
      .set(await adminAuth())
      .send(stayPayout())
      .expect(201);
    await request(app).delete(`/api/cleaning-payouts/${created.body.payout.id}`).set(await hostAuth()).expect(403);
  });
});
