import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { FakePaymentGateway } from '../helpers/fakePaymentGateway.js';

let app: ReturnType<typeof createApp>;
let store: MemoryStore;

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  return res.body.token as string;
}

function couponPayload(overrides: Record<string, unknown> = {}) {
  return {
    code: 'SH-SUMMER',
    type: 'percentage',
    value: 15,
    startDate: isoDaysFromNow(0),
    endDate: isoDaysFromNow(100),
    active: true,
    propertyIds: ['main'],
    ...overrides,
  };
}

beforeEach(async () => {
  store = new MemoryStore();
  await store.init();
  app = createApp(store, { payments: new FakePaymentGateway() });
});

describe('coupon admin CRUD', () => {
  it('rejects an unauthenticated request', async () => {
    await request(app).post('/api/coupons').send(couponPayload()).expect(403);
    await request(app).get('/api/coupons').expect(403);
  });

  it('rejects a host — admin only', async () => {
    const hostToken = await login('host@sachihouse.com', 'host123');
    await request(app)
      .post('/api/coupons')
      .set({ Authorization: `Bearer ${hostToken}` })
      .send(couponPayload())
      .expect(403);
  });

  it('creates a coupon as admin and echoes the assigned properties', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const res = await request(app)
      .post('/api/coupons')
      .set({ Authorization: `Bearer ${token}` })
      .send(couponPayload())
      .expect(201);

    expect(res.body.coupon).toMatchObject({
      code: 'SH-SUMMER',
      type: 'percentage',
      value: 15,
      propertyIds: ['main'],
    });
    expect(res.body.coupon.id).toBeTruthy();
  });

  it('rejects a duplicate code, case-insensitively', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    await request(app).post('/api/coupons').set({ Authorization: `Bearer ${token}` }).send(couponPayload()).expect(201);

    const res = await request(app)
      .post('/api/coupons')
      .set({ Authorization: `Bearer ${token}` })
      .send(couponPayload({ code: 'sh-summer' }))
      .expect(400);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('rejects a percentage value outside 1-100', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const res = await request(app)
      .post('/api/coupons')
      .set({ Authorization: `Bearer ${token}` })
      .send(couponPayload({ value: 150 }))
      .expect(400);
    expect(res.body.error).toMatch(/between 1 and 100/i);
  });

  it('rejects startDate after endDate', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const res = await request(app)
      .post('/api/coupons')
      .set({ Authorization: `Bearer ${token}` })
      .send(couponPayload({ startDate: isoDaysFromNow(10), endDate: isoDaysFromNow(5) }))
      .expect(400);
    expect(res.body.error).toMatch(/on or before/i);
  });

  it('rejects a propertyId that does not exist', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const res = await request(app)
      .post('/api/coupons')
      .set({ Authorization: `Bearer ${token}` })
      .send(couponPayload({ propertyIds: ['nope'] }))
      .expect(400);
    expect(res.body.error).toMatch(/does not exist/i);
  });

  it('allows creating a coupon with no properties assigned yet', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const res = await request(app)
      .post('/api/coupons')
      .set({ Authorization: `Bearer ${token}` })
      .send(couponPayload({ propertyIds: [] }))
      .expect(201);
    expect(res.body.coupon.propertyIds).toEqual([]);
  });

  it('lists created coupons', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    await request(app).post('/api/coupons').set({ Authorization: `Bearer ${token}` }).send(couponPayload()).expect(201);

    const res = await request(app).get('/api/coupons').set({ Authorization: `Bearer ${token}` }).expect(200);
    expect(res.body.coupons).toHaveLength(1);
    expect(res.body.coupons[0].code).toBe('SH-SUMMER');
  });

  it('updates the code and property assignment, reflected on the next read', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const created = await request(app)
      .post('/api/coupons')
      .set({ Authorization: `Bearer ${token}` })
      .send(couponPayload())
      .expect(201);

    await request(app)
      .put(`/api/coupons/${created.body.coupon.id}`)
      .set({ Authorization: `Bearer ${token}` })
      .send(couponPayload({ code: 'SH-WINTER', propertyIds: [] }))
      .expect(200);

    const res = await request(app).get('/api/coupons').set({ Authorization: `Bearer ${token}` }).expect(200);
    expect(res.body.coupons[0]).toMatchObject({ code: 'SH-WINTER', propertyIds: [] });
  });

  it('deletes a coupon, after which it no longer applies to a quote', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const created = await request(app)
      .post('/api/coupons')
      .set({ Authorization: `Bearer ${token}` })
      .send(couponPayload())
      .expect(201);

    await request(app)
      .delete(`/api/coupons/${created.body.coupon.id}`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(204);

    const listRes = await request(app).get('/api/coupons').set({ Authorization: `Bearer ${token}` }).expect(200);
    expect(listRes.body.coupons).toEqual([]);

    const quoteRes = await request(app)
      .post('/api/quotes')
      .send({
        propertyId: 'main',
        checkIn: isoDaysFromNow(40),
        checkOut: isoDaysFromNow(43),
        adults: 2,
        children: 0,
        infants: 0,
        couponCode: 'SH-SUMMER',
      })
      .expect(200);
    expect(quoteRes.body.couponError).toMatch(/invalid coupon/i);
  });
});
