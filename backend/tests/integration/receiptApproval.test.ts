import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { FakePaymentGateway } from '../helpers/fakePaymentGateway.js';
import { FakeMailer } from '../helpers/fakeMailer.js';

let app: ReturnType<typeof createApp>;
let store: MemoryStore;

async function login(
  email = 'admin@sachihouse.com',
  password = 'admin123',
): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.token as string;
}

/**
 * A level-4 host with finance access, assigned to no property at all.
 *
 * Finance access is a level, not a scope: it says this person may work on the
 * books, which is not the same as saying whose.
 */
async function outsiderToken(): Promise<string> {
  const admin = await login();
  const created = await request(app)
    .post('/api/users')
    .set({ Authorization: `Bearer ${admin}` })
    .send({ name: 'Other Host', email: 'other@example.com', password: 'password123', role: 'HOST' })
    .expect(201);
  await request(app)
    .put(`/api/users/${created.body.user.id}/host-level`)
    .set({ Authorization: `Bearer ${admin}` })
    .send({ level: 4 })
    .expect(200);
  return login('other@example.com', 'password123');
}

/** A receipt the OCR has already read, so it has something to compare. */
async function seedReceipt(over: Record<string, unknown> = {}) {
  const actor = { id: 1, role: 'ADMIN', assignedPropertyIds: [], hostLevel: 4 } as never;
  return store.createPendingTransaction({
    propertyId: 'main',
    gcsPath: 'gcs://bucket/receipt.jpg',
    ocrProcessed: true,
    transactionDate: '2026-09-10',
    debitAccount: '消耗品費',
    debitAmount: 1280,
    creditAccount: '現金',
    creditAmount: 1280,
    description: 'ローソン',
    vendor: 'ローソン',
    ...over,
  }, actor);
}

beforeEach(async () => {
  store = new MemoryStore();
  await store.init();
  app = createApp(store, { payments: new FakePaymentGateway(), mailer: new FakeMailer() });
});

describe('approving a receipt from the app', () => {
  it('moves it into the journal', async () => {
    const token = await login();
    const receipt = await seedReceipt();

    const res = await request(app)
      .post(`/api/finance/pending/${receipt.id}/approve`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(201);

    expect(res.body.debitAmount).toBe(1280);
    expect(await store.listPendingTransactions(['main'])).toHaveLength(0);
  });

  it('refuses a second copy of something already approved, and says which entry', async () => {
    const token = await login();
    const first = await seedReceipt();
    await request(app)
      .post(`/api/finance/pending/${first.id}/approve`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(201);

    // The same paper photographed again weeks later. By now the first copy has
    // left pending_transactions, so nothing that compares pending rows to each
    // other could possibly see it.
    const second = await seedReceipt();
    const res = await request(app)
      .post(`/api/finance/pending/${second.id}/approve`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(409);

    expect(res.body.duplicates).toHaveLength(1);
    expect(res.body.duplicates[0].debitAmount).toBe(1280);
    // Refused means refused: the receipt is still waiting, not silently gone.
    expect(await store.listPendingTransactions(['main'])).toHaveLength(1);
  });

  it('approves anyway when the host says they have looked', async () => {
    const token = await login();
    const first = await seedReceipt();
    await request(app)
      .post(`/api/finance/pending/${first.id}/approve`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(201);

    const second = await seedReceipt();
    await request(app)
      .post(`/api/finance/pending/${second.id}/approve`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ force: true })
      .expect(201);

    // Two ¥1,280 receipts on one day is a real thing that happens; the person
    // holding both pieces of paper is the one who gets to decide.
    expect(await store.listFinancialTransactions(['main'], 2026)).toHaveLength(2);
  });

  it('does not stand in the way of a different amount on the same day', async () => {
    const token = await login();
    const first = await seedReceipt();
    await request(app)
      .post(`/api/finance/pending/${first.id}/approve`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(201);

    const other = await seedReceipt({ debitAmount: 640, creditAmount: 640 });
    await request(app)
      .post(`/api/finance/pending/${other.id}/approve`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(201);
  });

  it('will not let a host touch a receipt for a property that is not theirs', async () => {
    const token = await outsiderToken();
    const receipt = await seedReceipt();

    // 404 rather than 403, for both the missing and the forbidden: an id must
    // not be probeable for existence.
    await request(app)
      .put(`/api/finance/pending/${receipt.id}`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ debitAmount: 1 })
      .expect(404);
    await request(app)
      .post(`/api/finance/pending/${receipt.id}/approve`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(404);
    await request(app)
      .delete(`/api/finance/pending/${receipt.id}`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(404);

    // Nothing moved: not into the journal, not out of the pending table.
    expect(await store.listPendingTransactions(['main'])).toHaveLength(1);
    expect(await store.listFinancialTransactions(['main'], 2026)).toHaveLength(0);
  });

  it('forcing does not get past the ownership check either', async () => {
    const token = await outsiderToken();
    const receipt = await seedReceipt();

    await request(app)
      .post(`/api/finance/pending/${receipt.id}/approve`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ force: true })
      .expect(404);
  });

  it('deletes a receipt the host does own', async () => {
    const token = await login();
    const receipt = await seedReceipt();

    await request(app)
      .delete(`/api/finance/pending/${receipt.id}`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(204);

    expect(await store.listPendingTransactions(['main'])).toHaveLength(0);
  });

  it('flags the duplicate on the list, before the host taps approve', async () => {
    const token = await login();
    const first = await seedReceipt();
    await request(app)
      .post(`/api/finance/pending/${first.id}/approve`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(201);
    await seedReceipt();
    await seedReceipt({ debitAmount: 640, creditAmount: 640 });

    const res = await request(app)
      .get('/api/finance/pending?propertyIds=main')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);

    type Row = { debitAmount: number; approvedDuplicates: unknown[] };
    const byAmount = new Map((res.body as Row[]).map((row) => [row.debitAmount, row]));
    expect(byAmount.get(1280)!.approvedDuplicates).toHaveLength(1);
    // Every row answers, so the screen never has to guess whether a missing
    // field means "checked, clean" or "not checked".
    expect(byAmount.get(640)!.approvedDuplicates).toEqual([]);
  });
});
