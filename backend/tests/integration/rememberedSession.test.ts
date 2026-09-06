import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { REMEMBERED_SESSION_TTL_SECONDS, SESSION_TTL_SECONDS } from '../../src/auth/jwt.js';

let app: ReturnType<typeof createApp>;
let store: MemoryStore;

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';
const decode = (token: string) => jwt.decode(token) as { exp: number; iat: number; rem?: 1 };

beforeEach(async () => {
  store = new MemoryStore();
  await store.init();
  app = createApp(store);
});

describe('remembered sessions', () => {
  it('issues the short session when the client does not ask to be remembered', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@sachihouse.com', password: 'admin123' })
      .expect(200);

    const payload = decode(response.body.token);
    expect(payload.rem).toBeUndefined();
    expect(payload.exp - payload.iat).toBe(SESSION_TTL_SECONDS);
  });

  it('issues the long session when the host app asks to be remembered', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@sachihouse.com', password: 'admin123', remember: true })
      .expect(200);

    const payload = decode(response.body.token);
    expect(payload.rem).toBe(1);
    expect(payload.exp - payload.iat).toBe(REMEMBERED_SESSION_TTL_SECONDS);
  });

  it('only honours a real boolean, so a stray "false" string cannot buy 90 days', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@sachihouse.com', password: 'admin123', remember: 'false' })
      .expect(200);

    expect(decode(response.body.token).rem).toBeUndefined();
  });

  it('leaves a fresh remembered token alone on /auth/me', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@sachihouse.com', password: 'admin123', remember: true })
      .expect(200);

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);

    expect(response.body.user.email).toBe('admin@sachihouse.com');
    expect(response.body.token).toBeUndefined();
  });

  it('slides a remembered token forward once it is close to expiring', async () => {
    const user = await store.authenticate('admin@sachihouse.com', 'admin123');
    const nowSeconds = Math.floor(Date.now() / 1000);
    // A remembered token with a week left — what a host who opens the app
    // roughly every couple of months would be carrying.
    const aging = jwt.sign(
      { sub: user!.id, email: user!.email, role: user!.role, rem: 1, exp: nowSeconds + 7 * 24 * 60 * 60 },
      JWT_SECRET,
    );

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${aging}`)
      .expect(200);

    expect(response.body.token).toBeTypeOf('string');
    const renewed = decode(response.body.token);
    expect(renewed.rem).toBe(1);
    expect(renewed.exp - renewed.iat).toBe(REMEMBERED_SESSION_TTL_SECONDS);
    // The whole point: the new expiry is further out than the old one.
    expect(renewed.exp).toBeGreaterThan(nowSeconds + 7 * 24 * 60 * 60);
  });

  it('never slides a short console token forward, however little is left', async () => {
    const user = await store.authenticate('admin@sachihouse.com', 'admin123');
    const nowSeconds = Math.floor(Date.now() / 1000);
    const almostGone = jwt.sign(
      { sub: user!.id, email: user!.email, role: user!.role, exp: nowSeconds + 60 },
      JWT_SECRET,
    );

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${almostGone}`)
      .expect(200);

    expect(response.body.token).toBeUndefined();
  });
});
