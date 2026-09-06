import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MemoryStore } from '../../src/store/memoryStore.js';

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
let token: string;

const auth = () => ({ Authorization: `Bearer ${token}` });

beforeEach(async () => {
  store = new MemoryStore();
  await store.init();
  app = createApp(store);

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@sachihouse.com', password: 'admin123' })
    .expect(200);
  token = login.body.token;
});

describe('entry details routes', () => {
  it('refuses an anonymous read', async () => {
    await request(app).get('/api/properties/main/check-in-info').expect(401);
  });

  it('refuses an anonymous write', async () => {
    await request(app)
      .patch('/api/properties/main/check-in-info')
      .send({ entryCode: 'HIJACKED' })
      .expect(401);
  });

  it('404s for a property that does not exist', async () => {
    await request(app)
      .get('/api/properties/nope/check-in-info')
      .set(auth())
      .expect(404);
  });

  it('starts empty and takes a door code', async () => {
    const before = await request(app)
      .get('/api/properties/main/check-in-info')
      .set(auth())
      .expect(200);
    expect(before.body.checkInInfo).toEqual({});

    const patched = await request(app)
      .patch('/api/properties/main/check-in-info')
      .set(auth())
      .send({ entryCode: '  8461#  ' })
      .expect(200);
    // Trimmed on the way in: a code with a stray space is a code that fails at
    // the door.
    expect(patched.body.checkInInfo.entryCode).toBe('8461#');

    const after = await request(app)
      .get('/api/properties/main/check-in-info')
      .set(auth())
      .expect(200);
    expect(after.body.checkInInfo.entryCode).toBe('8461#');
  });

  it('merges rather than replaces, so setting one field keeps the others', async () => {
    await request(app)
      .patch('/api/properties/main/check-in-info')
      .set(auth())
      .send({ entryCode: '8461#', wifiPassword: 'hunter2' })
      .expect(200);

    const patched = await request(app)
      .patch('/api/properties/main/check-in-info')
      .set(auth())
      .send({ entryCode: '9999#' })
      .expect(200);

    expect(patched.body.checkInInfo.entryCode).toBe('9999#');
    expect(patched.body.checkInInfo.wifiPassword).toBe('hunter2');
  });

  it('removes a field when it is emptied, instead of storing a blank', async () => {
    await request(app)
      .patch('/api/properties/main/check-in-info')
      .set(auth())
      .send({ entryCode: '8461#' })
      .expect(200);

    const cleared = await request(app)
      .patch('/api/properties/main/check-in-info')
      .set(auth())
      .send({ entryCode: '   ' })
      .expect(200);

    expect(cleared.body.checkInInfo).not.toHaveProperty('entryCode');
  });

  it('leaves the rest of the property alone', async () => {
    const before = await request(app).get('/api/properties/main').set(auth()).expect(200);
    const original = before.body.property ?? before.body;

    await request(app)
      .patch('/api/properties/main/check-in-info')
      .set(auth())
      .send({ entryCode: '8461#' })
      .expect(200);

    const after = await request(app).get('/api/properties/main').set(auth()).expect(200);
    const updated = after.body.property ?? after.body;

    expect(updated.name).toBe(original.name);
    expect(updated.address).toBe(original.address);
    expect(updated.pricing).toEqual(original.pricing);
    expect(updated.checkInInfo.entryCode).toBe('8461#');
  });

  it('rejects a non-string value', async () => {
    await request(app)
      .patch('/api/properties/main/check-in-info')
      .set(auth())
      .send({ entryCode: 1234 })
      .expect(400);
  });

  it('rejects a body with nothing it recognises', async () => {
    await request(app)
      .patch('/api/properties/main/check-in-info')
      .set(auth())
      .send({ somethingElse: 'x' })
      .expect(400);
  });

  it('never lets the new code escape to an anonymous reader', async () => {
    await request(app)
      .patch('/api/properties/main/check-in-info')
      .set(auth())
      .send({ entryCode: 'FRESH-CODE-1' })
      .expect(200);

    const anonymous = await request(app).get('/api/properties').expect(200);
    expect(JSON.stringify(anonymous.body)).not.toContain('FRESH-CODE-1');
  });
});
