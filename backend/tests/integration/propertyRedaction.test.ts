import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MemoryStore } from '../../src/store/memoryStore.js';

let app: ReturnType<typeof createApp>;
let store: MemoryStore;

const CHECK_IN_INFO = {
  wifiName: 'SachiHouse-2F',
  wifiPassword: 'sup3rsecret',
  entryCode: 'DOOR-8461#',
  emergencyContactPhone: '+81-90-0000-0000',
  googleMapsUrl: 'https://maps.example/abc',
};

async function login(email: string, password: string): Promise<string> {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.token as string;
}

/** Stamps entry details onto the seeded property, as an admin would. */
async function seedCheckInInfo(token: string): Promise<void> {
  const current = await request(app)
    .get('/api/properties/main')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const property = current.body.property ?? current.body;
  await request(app)
    .put('/api/properties/main')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...property, checkInInfo: CHECK_IN_INFO })
    .expect(200);
}

beforeEach(async () => {
  store = new MemoryStore();
  await store.init();
  app = createApp(store);
});

describe('entry details are not public', () => {
  it('withholds checkInInfo from an anonymous property list', async () => {
    await seedCheckInInfo(await login('admin@sachihouse.com', 'admin123'));

    const response = await request(app).get('/api/properties').expect(200);
    const property = response.body.properties.find((row: { id: string }) => row.id === 'main');

    expect(property).toBeDefined();
    expect(property.checkInInfo).toBeUndefined();
    // Belt and braces: the door code must not survive anywhere in the payload,
    // however the shape of the response changes later.
    expect(JSON.stringify(response.body)).not.toContain('DOOR-8461#');
    expect(JSON.stringify(response.body)).not.toContain('sup3rsecret');
  });

  it('withholds checkInInfo from an anonymous single-property read', async () => {
    await seedCheckInInfo(await login('admin@sachihouse.com', 'admin123'));

    const response = await request(app).get('/api/properties/main').expect(200);
    const property = response.body.property ?? response.body;

    expect(property.checkInInfo).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('DOOR-8461#');
  });

  it('still gives the owner their own entry details, or the admin console breaks', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    await seedCheckInInfo(token);

    const response = await request(app)
      .get('/api/properties/main')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const property = response.body.property ?? response.body;
    expect(property.checkInInfo.entryCode).toBe('DOOR-8461#');
    expect(property.checkInInfo.wifiPassword).toBe('sup3rsecret');
  });

  it('keeps withholding the older secrets it already redacted', async () => {
    await seedCheckInInfo(await login('admin@sachihouse.com', 'admin123'));

    const response = await request(app).get('/api/properties/main').expect(200);
    const property = response.body.property ?? response.body;

    expect(property.icalExportToken).toBeUndefined();
    expect(property.emailJs).toBeUndefined();
    expect(property.icalFeeds).toEqual([]);
  });
});
