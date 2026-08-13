import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MemoryStore } from '../../src/store/memoryStore.js';

let app: ReturnType<typeof createApp>;
let store: MemoryStore;

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  return res.body.token as string;
}

beforeEach(async () => {
  store = new MemoryStore();
  await store.init();
  app = createApp(store);
});

describe('GET /api/properties/blocked-dates', () => {
  it('returns each property blocked nights clipped to the window', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const auth = { Authorization: `Bearer ${token}` };

    await request(app)
      .post('/api/properties/main/blocked-dates')
      .set(auth)
      .send({ dates: ['2026-08-10', '2026-08-11', '2026-12-25'] })
      .expect(200);

    const res = await request(app)
      .get('/api/properties/blocked-dates?from=2026-08-01&to=2026-09-01')
      .expect(200);

    expect(res.body.from).toBe('2026-08-01');
    expect(res.body.to).toBe('2026-09-01');

    const main = res.body.properties.find((entry: { id: string }) => entry.id === 'main');
    expect(main.blockedDates).toContain('2026-08-10');
    expect(main.blockedDates).toContain('2026-08-11');
    // Outside the window, so it must not be paid for in payload size.
    expect(main.blockedDates).not.toContain('2026-12-25');
  });

  it('treats the window end as exclusive, matching a check-out date', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const auth = { Authorization: `Bearer ${token}` };

    await request(app)
      .post('/api/properties/main/blocked-dates')
      .set(auth)
      .send({ dates: ['2026-08-31'] })
      .expect(200);

    const res = await request(app)
      .get('/api/properties/blocked-dates?from=2026-08-01&to=2026-08-31')
      .expect(200);

    const main = res.body.properties.find((entry: { id: string }) => entry.id === 'main');
    expect(main.blockedDates).not.toContain('2026-08-31');
  });

  it('narrows to the requested ids', async () => {
    const res = await request(app)
      .get('/api/properties/blocked-dates?from=2026-08-01&to=2026-09-01&ids=main')
      .expect(200);

    expect(res.body.properties).toHaveLength(1);
    expect(res.body.properties[0].id).toBe('main');

    const none = await request(app)
      .get('/api/properties/blocked-dates?from=2026-08-01&to=2026-09-01&ids=does-not-exist')
      .expect(200);
    expect(none.body.properties).toHaveLength(0);
  });

  it('rejects malformed or oversized ranges', async () => {
    await request(app).get('/api/properties/blocked-dates?from=2026-08-01').expect(400);
    await request(app).get('/api/properties/blocked-dates?from=nope&to=2026-09-01').expect(400);
    // to must be after from
    await request(app).get('/api/properties/blocked-dates?from=2026-09-01&to=2026-08-01').expect(400);
    await request(app).get('/api/properties/blocked-dates?from=2026-08-01&to=2026-08-01').expect(400);
    // Beyond the 400-day ceiling
    await request(app).get('/api/properties/blocked-dates?from=2026-01-01&to=2028-01-01').expect(400);
  });

  it('is not mistaken for a property id lookup', async () => {
    // The `/:id` route would answer 404 here if it captured the path first.
    await request(app)
      .get('/api/properties/blocked-dates?from=2026-08-01&to=2026-09-01')
      .expect(200);
  });
});
