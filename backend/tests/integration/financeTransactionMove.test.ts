import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { FakePaymentGateway } from '../helpers/fakePaymentGateway.js';
import { FakeMailer } from '../helpers/fakeMailer.js';

let app: ReturnType<typeof createApp>;
let store: MemoryStore;

async function login(email = 'admin@sachihouse.com', password = 'admin123'): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  return res.body.token as string;
}

/** A level-4 host with finance access, assigned to no property. */
async function outsiderToken(): Promise<string> {
  return (await outsider()).token;
}

async function outsider(): Promise<{ token: string; userId: number }> {
  const admin = await login();
  const created = await request(app)
    .post('/api/users')
    .set({ Authorization: `Bearer ${admin}` })
    .send({ name: 'Main Host', email: 'mainhost@example.com', password: 'password123', role: 'HOST' })
    .expect(201);
  const userId = created.body.user.id;
  await request(app)
    .put(`/api/users/${userId}/host-level`)
    .set({ Authorization: `Bearer ${admin}` })
    .send({ level: 4 })
    .expect(200);
  return { token: await login('mainhost@example.com', 'password123'), userId };
}

async function assignHost(adminToken: string, propertyId: string, userId: number) {
  await request(app)
    .post(`/api/properties/${propertyId}/hosts/${userId}`)
    .set({ Authorization: `Bearer ${adminToken}` })
    .expect(204);
}

async function listIds(adminToken: string, propertyId: string): Promise<string[]> {
  const res = await request(app)
    .get(`/api/finance/transactions?propertyIds=${propertyId}`)
    .set({ Authorization: `Bearer ${adminToken}` })
    .expect(200);
  return res.body.map((t: { id: string }) => t.id);
}

async function createTxn(token: string, propertyId = 'main') {
  const res = await request(app)
    .post('/api/finance/transactions')
    .set({ Authorization: `Bearer ${token}` })
    .send({
      propertyId,
      transactionNo: 'T-1',
      transactionDate: '2026-03-10',
      debitAccount: '消耗品費',
      debitAmount: 1200,
      creditAccount: '現金',
      creditAmount: 1200,
      description: 'Towels',
    })
    .expect(201);
  return res.body as { id: string; propertyId: string };
}

beforeEach(async () => {
  store = new MemoryStore();
  await store.init();
  app = createApp(store, { payments: new FakePaymentGateway(), mailer: new FakeMailer() });
});

describe('PUT /api/finance/transactions/:id — moving a transaction to another property', () => {
  it('persists the new propertyId together with the full edit payload', async () => {
    const token = await login();
    const txn = await createTxn(token, 'main');

    const res = await request(app)
      .put(`/api/finance/transactions/${txn.id}`)
      .set({ Authorization: `Bearer ${token}` })
      .send({
        propertyId: 'list_shin',
        transactionNo: 'T-1',
        transactionDate: '2026-03-10',
        debitAccount: '消耗品費',
        debitAmount: 1200,
        creditAccount: '現金',
        creditAmount: 1200,
        description: 'Towels',
      })
      .expect(200);
    expect(res.body.propertyId).toBe('list_shin');
    expect(res.body.description).toBe('Towels');

    const inMain = await request(app)
      .get('/api/finance/transactions?propertyIds=main')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(inMain.body.map((t: { id: string }) => t.id)).not.toContain(txn.id);

    const inShin = await request(app)
      .get('/api/finance/transactions?propertyIds=list_shin')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(inShin.body.map((t: { id: string }) => t.id)).toContain(txn.id);
  });

  it('keeps the property when propertyId is unchanged', async () => {
    const token = await login();
    const txn = await createTxn(token, 'main');
    const res = await request(app)
      .put(`/api/finance/transactions/${txn.id}`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ propertyId: 'main', description: 'Edited' })
      .expect(200);
    expect(res.body.propertyId).toBe('main');
    expect(res.body.description).toBe('Edited');
  });

  it('rejects a non-admin moving a transaction to a property they are not assigned to', async () => {
    const admin = await login();
    const txn = await createTxn(admin, 'main');
    const host = await outsiderToken();

    await request(app)
      .put(`/api/finance/transactions/${txn.id}`)
      .set({ Authorization: `Bearer ${host}` })
      .send({ propertyId: 'list_shin' })
      .expect(403);
  });
});

describe('PUT/DELETE /api/finance/transactions/:id — ownership of the existing row', () => {
  it('answers 404 when an admin edits a transaction that does not exist', async () => {
    const admin = await login();
    const res = await request(app)
      .put('/api/finance/transactions/does-not-exist')
      .set({ Authorization: `Bearer ${admin}` })
      .send({ description: 'Ghost' })
      .expect(404);
    expect(res.body).toEqual({ error: 'Transaction not found.' });
  });

  it('answers 404 when an admin deletes a transaction that does not exist', async () => {
    const admin = await login();
    const res = await request(app)
      .delete('/api/finance/transactions/does-not-exist')
      .set({ Authorization: `Bearer ${admin}` })
      .expect(404);
    expect(res.body).toEqual({ error: 'Transaction not found.' });
  });

  it('rejects an unassigned host editing a transaction of another property, leaving it unchanged', async () => {
    const admin = await login();
    const txn = await createTxn(admin, 'main');
    const host = await outsiderToken();

    const res = await request(app)
      .put(`/api/finance/transactions/${txn.id}`)
      .set({ Authorization: `Bearer ${host}` })
      .send({ description: 'Hacked' })
      .expect(403);
    expect(res.body).toEqual({ error: 'Access denied to this property.' });

    const list = await request(app)
      .get('/api/finance/transactions?propertyIds=main')
      .set({ Authorization: `Bearer ${admin}` })
      .expect(200);
    const row = list.body.find((t: { id: string }) => t.id === txn.id);
    expect(row).toBeDefined();
    expect(row.description).toBe('Towels');
  });

  it('rejects an unassigned host deleting a transaction of another property, leaving it in place', async () => {
    const admin = await login();
    const txn = await createTxn(admin, 'main');
    const host = await outsiderToken();

    const res = await request(app)
      .delete(`/api/finance/transactions/${txn.id}`)
      .set({ Authorization: `Bearer ${host}` })
      .expect(403);
    expect(res.body).toEqual({ error: 'Access denied to this property.' });
    expect(await listIds(admin, 'main')).toContain(txn.id);
  });

  it('lets a host assigned to the property edit its transaction', async () => {
    const admin = await login();
    const txn = await createTxn(admin, 'main');
    const { token, userId } = await outsider();
    await assignHost(admin, 'main', userId);

    const res = await request(app)
      .put(`/api/finance/transactions/${txn.id}`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ description: 'Edited' })
      .expect(200);
    expect(res.body.description).toBe('Edited');
    expect(res.body.propertyId).toBe('main');
  });

  it('rejects a host assigned to the source property moving the transaction to an unassigned one', async () => {
    const admin = await login();
    const txn = await createTxn(admin, 'main');
    const { token, userId } = await outsider();
    await assignHost(admin, 'main', userId);

    const res = await request(app)
      .put(`/api/finance/transactions/${txn.id}`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ propertyId: 'list_shin' })
      .expect(403);
    expect(res.body).toEqual({ error: 'Access denied to the target property.' });
    expect(await listIds(admin, 'main')).toContain(txn.id);
    expect(await listIds(admin, 'list_shin')).not.toContain(txn.id);
  });

  it('lets a host assigned to the property delete its transaction', async () => {
    const admin = await login();
    const txn = await createTxn(admin, 'main');
    const { token, userId } = await outsider();
    await assignHost(admin, 'main', userId);

    await request(app)
      .delete(`/api/finance/transactions/${txn.id}`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(204);
    expect(await listIds(admin, 'main')).not.toContain(txn.id);
  });
});
