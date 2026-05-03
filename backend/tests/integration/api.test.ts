import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MemoryStore } from '../../src/store/memoryStore.js';

let app: ReturnType<typeof createApp>;
let store: MemoryStore;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);

  return response.body.token as string;
}

beforeEach(async () => {
  store = new MemoryStore();
  await store.init();
  app = createApp(store);
});

describe('API integration', () => {
  it('authenticates admin and returns role profile', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.user.email).toBe('admin@sachihouse.com');
    expect(response.body.user.role).toBe('ADMIN');
  });

  it('lists seeded properties', async () => {
    const response = await request(app).get('/api/properties').expect(200);
    expect(response.body.properties).toHaveLength(2);
    expect(response.body.properties[0]).toHaveProperty('name');
  });

  it('allows host to update an assigned property', async () => {
    const token = await login('host@sachihouse.com', 'host123');

    const before = await request(app).get('/api/properties/main').expect(200);
    const updated = {
      ...before.body.property,
      subtitle: 'Updated by assigned host',
    };

    const response = await request(app)
      .put('/api/properties/main')
      .set('Authorization', `Bearer ${token}`)
      .send(updated)
      .expect(200);

    expect(response.body.property.subtitle).toBe('Updated by assigned host');
  });

  it('allows host to delete an assigned property', async () => {
    const token = await login('host@sachihouse.com', 'host123');

    await request(app)
      .delete('/api/properties/main')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await request(app).get('/api/properties/main').expect(404);
  });

  it('blocks host from updating a non-assigned property', async () => {
    const token = await login('host@sachihouse.com', 'host123');
    const target = await request(app).get('/api/properties/list_shin').expect(200);

    await request(app)
      .put('/api/properties/list_shin')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...target.body.property, subtitle: 'Blocked write attempt' })
      .expect(403);
  });

  it('blocks host from deleting a non-assigned property', async () => {
    const token = await login('host@sachihouse.com', 'host123');

    await request(app)
      .delete('/api/properties/list_shin')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('allows admin to assign a host to another property', async () => {
    const adminToken = await login('admin@sachihouse.com', 'admin123');

    await request(app)
      .post('/api/properties/list_shin/hosts/2')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    const hostToken = await login('host@sachihouse.com', 'host123');
    await request(app)
      .put('/api/properties/list_shin')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        ...(await request(app).get('/api/properties/list_shin').then((response) => response.body.property)),
        subtitle: 'Now editable by host',
      })
      .expect(200);
  });

  it('allows admin to create a new host user', async () => {
    const adminToken = await login('admin@sachihouse.com', 'admin123');

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'New Host',
        email: 'newhost@sachihouse.com',
        password: 'host1234',
        role: 'HOST',
      })
      .expect(201);

    expect(response.body.user.name).toBe('New Host');
    expect(response.body.user.email).toBe('newhost@sachihouse.com');
    expect(response.body.user.role).toBe('HOST');

    const hostToken = await login('newhost@sachihouse.com', 'host1234');
    expect(hostToken).toBeTruthy();
  });

  it('updates user role and blocks self demotion of admin', async () => {
    const adminToken = await login('admin@sachihouse.com', 'admin123');

    await request(app)
      .patch('/api/users/2/role')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'GUEST' })
      .expect(200);

    const propertyBefore = await request(app).get('/api/properties/main').expect(200);

    await request(app)
      .put('/api/properties/main')
      .set('Authorization', `Bearer ${await login('host@sachihouse.com', 'host123')}`)
      .send({
        ...propertyBefore.body.property,
        subtitle: 'should fail after role downgrade',
      })
      .expect(403);

    await request(app)
      .patch('/api/users/1/role')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'HOST' })
      .expect(400);
  });

  it('allows admin to reset a user password', async () => {
    const adminToken = await login('admin@sachihouse.com', 'admin123');

    await request(app)
      .patch('/api/users/2/password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'host5678' })
      .expect(204);

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'host@sachihouse.com', password: 'host123' })
      .expect(401);

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'host@sachihouse.com', password: 'host5678' })
      .expect(200);
  });

  it('allows admin to edit and delete a user', async () => {
    const adminToken = await login('admin@sachihouse.com', 'admin123');

    const created = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Temp User', email: 'temp-user@sachihouse.com', password: 'temp1234', role: 'GUEST' })
      .expect(201);

    const userId = Number(created.body.user.id);

    await request(app)
      .patch(`/api/users/${userId}/name`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated User' })
      .expect(200);

    await request(app)
      .patch(`/api/users/${userId}/email`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'updated-user@sachihouse.com' })
      .expect(200);

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'updated-user@sachihouse.com', password: 'temp1234' })
      .expect(200);

    await request(app)
      .delete(`/api/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'updated-user@sachihouse.com', password: 'temp1234' })
      .expect(401);
  });

  it('returns a calculated quote from the quote endpoint', async () => {
    const response = await request(app)
      .post('/api/quotes')
      .send({
        propertyId: 'main',
        checkIn: '2026-06-01',
        checkOut: '2026-06-04',
        adults: 2,
        children: 1,
        infants: 0,
      })
      .expect(200);

    expect(response.body.quote.nights).toBe(3);
    expect(response.body.quote.payingGuests).toBe(3);
    expect(response.body.quote.total).toBeGreaterThan(0);
  });

  it('blocks quote requests when selected dates are unavailable', async () => {
    const response = await request(app)
      .post('/api/quotes')
      .send({
        propertyId: 'main',
        checkIn: '2026-06-12',
        checkOut: '2026-06-14',
        adults: 2,
        children: 0,
        infants: 0,
      })
      .expect(409);

    expect(response.body.error).toContain('not available');
    expect(response.body.blockedDates).toContain('2026-06-12');
  });
});
