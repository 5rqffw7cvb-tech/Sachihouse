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

  it('filters properties by location and minimum capacity query params', async () => {
    const response = await request(app)
      .get('/api/properties?countryCode=JP&provinceCode=JP-13&minBedrooms=3&minGuests=7')
      .expect(200);

    expect(response.body.properties).toHaveLength(2);
    expect(response.body.properties.every((property: { bedrooms: number; maxGuests: number; location?: { countryCode?: string; provinceCode?: string } }) => (
      property.bedrooms >= 3
      && property.maxGuests >= 7
      && property.location?.countryCode === 'JP'
      && property.location?.provinceCode === 'JP-13'
    ))).toBe(true);
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
    expect(response.body.user.canEditBlog).toBe(false);

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

  it('allows admin to grant blog editor permission to a host', async () => {
    const adminToken = await login('admin@sachihouse.com', 'admin123');
    const hostToken = await login('host@sachihouse.com', 'host123');

    await request(app)
      .post('/api/blog-posts')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({
        id: 'blocked-post',
        title: 'Blocked',
        excerpt: 'Blocked',
        content: 'Blocked',
        category: 'Test',
        imageUrl: '',
        isFeatured: false,
      })
      .expect(403);

    await request(app)
      .patch('/api/users/2/can-edit-blog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ canEditBlog: true })
      .expect(200);

    const elevatedHostToken = await login('host@sachihouse.com', 'host123');
    await request(app)
      .post('/api/blog-posts')
      .set('Authorization', `Bearer ${elevatedHostToken}`)
      .send({
        id: 'editor-post',
        title: 'Editor Post',
        excerpt: 'Created by blog editor',
        content: 'Hello editor',
        category: 'Test',
        imageUrl: '',
        isFeatured: false,
      })
      .expect(201);
  });

  it('archives a user and blocks future login', async () => {
    const adminToken = await login('admin@sachihouse.com', 'admin123');

    const created = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Archive User', email: 'archive-user@sachihouse.com', password: 'temp1234', role: 'GUEST', canEditBlog: false })
      .expect(201);

    const userId = Number(created.body.user.id);

    await request(app)
      .patch(`/api/users/${userId}/archive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ archived: true })
      .expect(200);

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'archive-user@sachihouse.com', password: 'temp1234' })
      .expect(401);
  });

  it('archives a property and hides it from public property endpoints', async () => {
    const adminToken = await login('admin@sachihouse.com', 'admin123');

    await request(app)
      .patch('/api/properties/main/archive')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ archived: true })
      .expect(200);

    const listResponse = await request(app).get('/api/properties').expect(200);
    expect(listResponse.body.properties).toHaveLength(1);
    expect(listResponse.body.properties.some((property: { id: string }) => property.id === 'main')).toBe(false);

    await request(app).get('/api/properties/main').expect(404);
  });

  it('archives a blog post and hides it from public blog endpoints', async () => {
    const adminToken = await login('admin@sachihouse.com', 'admin123');

    await request(app)
      .patch('/api/blog-posts/tokyo-family-guide/archive')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ archived: true })
      .expect(200);

    const publicList = await request(app).get('/api/blog-posts').expect(200);
    expect(publicList.body.posts.some((post: { id: string }) => post.id === 'tokyo-family-guide')).toBe(false);

    await request(app).get('/api/blog-posts/tokyo-family-guide').expect(404);

    const adminList = await request(app)
      .get('/api/blog-posts?includeArchived=true')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(adminList.body.posts.some((post: { id: string; archivedAt?: number | null }) => post.id === 'tokyo-family-guide' && Boolean(post.archivedAt))).toBe(true);
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

  it('rejects non-id uploads and accepts id uploads in OCR endpoint', async () => {
    const started = await request(app)
      .post('/api/properties/main/checkins/start')
      .expect(201);

    await request(app)
      .post('/api/properties/main/checkins/ocr')
      .send({ imageBase64: 'not-an-image', guestId: 'guest_1', checkinToken: started.body.checkinToken })
      .expect(400);

    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5iN2sAAAAASUVORK5CYII=';
    const response = await request(app)
      .post('/api/properties/main/checkins/ocr')
      .send({ imageBase64: tinyPng, guestId: 'guest_2', checkinToken: started.body.checkinToken })
      .expect(201);

    expect(response.body.guest.id).toBe('guest_2');
    expect(response.body.guest.documentType).toBeTruthy();
    expect(response.body.guest.evidenceUrl).toContain('data:image/');
  });

  it('submits check-in data and lists submissions for host', async () => {
    const started = await request(app)
      .post('/api/properties/main/checkins/start')
      .expect(201);

    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5iN2sAAAAASUVORK5CYII=';
    const ocr = await request(app)
      .post('/api/properties/main/checkins/ocr')
      .send({ imageBase64: tinyPng, guestId: 'guest_submit', checkinToken: started.body.checkinToken })
      .expect(201);

    const submit = await request(app)
      .post('/api/properties/main/checkins/submit')
      .set('User-Agent', 'Vitest CheckIn Bot/1.0')
      .set('X-Forwarded-For', '203.0.113.24')
      .send({
        checkinToken: started.body.checkinToken,
        checkInDate: '2026-06-20',
        checkOutDate: '2026-06-22',
        consent: {
          accepted: true,
          acceptedAt: 1760000000000,
          noticeVersion: 'v1',
        },
        guests: [
          {
            ...ocr.body.guest,
            fullName: 'Alice Example',
            nationality: 'JP',
          },
        ],
      })
      .expect(201);

    const hostToken = await login('host@sachihouse.com', 'host123');
    const list = await request(app)
      .get('/api/checkins?propertyId=main&guestName=alice')
      .set('Authorization', `Bearer ${hostToken}`)
      .expect(200);

    expect(list.body.submissions).toHaveLength(1);
    expect(list.body.submissions[0].id).toBe(submit.body.submission.id);
    expect(list.body.submissions[0].consent.noticeVersion).toBe('v1');
    expect(list.body.submissions[0].audit.ipAddress).toContain('203.0.113.24');
  });

  it('requires check-in token for OCR and submit endpoints', async () => {
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5iN2sAAAAASUVORK5CYII=';

    await request(app)
      .post('/api/properties/main/checkins/ocr')
      .send({ imageBase64: tinyPng, guestId: 'guest_secure' })
      .expect(401);

    await request(app)
      .post('/api/properties/main/checkins/submit')
      .send({
        checkInDate: '2026-06-20',
        checkOutDate: '2026-06-22',
        guests: [],
      })
      .expect(401);
  });

  it('requires consent confirmation before submitting check-in', async () => {
    const started = await request(app)
      .post('/api/properties/main/checkins/start')
      .expect(201);

    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5iN2sAAAAASUVORK5CYII=';
    const ocr = await request(app)
      .post('/api/properties/main/checkins/ocr')
      .send({ imageBase64: tinyPng, guestId: 'guest_consent', checkinToken: started.body.checkinToken })
      .expect(201);

    await request(app)
      .post('/api/properties/main/checkins/submit')
      .send({
        checkinToken: started.body.checkinToken,
        checkInDate: '2026-06-20',
        checkOutDate: '2026-06-22',
        guests: [ocr.body.guest],
      })
      .expect(400);
  });

  it('blocks guest role from accessing check-in management APIs', async () => {
    const adminToken = await login('admin@sachihouse.com', 'admin123');
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Guest Viewer',
        email: 'guest-viewer@sachihouse.com',
        password: 'guest1234',
        role: 'GUEST',
      })
      .expect(201);

    const guestToken = await login('guest-viewer@sachihouse.com', 'guest1234');
    await request(app)
      .get('/api/checkins')
      .set('Authorization', `Bearer ${guestToken}`)
      .expect(403);
  });
});
