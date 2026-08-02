import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { FakeMailer } from '../helpers/fakeMailer.js';

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
let mailer: FakeMailer;

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  return res.body.token as string;
}

async function setCheckInInfo() {
  const token = await login('admin@sachihouse.com', 'admin123');
  const current = await request(app).get('/api/properties/main').expect(200);
  await request(app)
    .put('/api/properties/main')
    .set({ Authorization: `Bearer ${token}` })
    .send({
      ...current.body.property,
      checkInInfo: {
        wifiName: 'SachiHouse-Guest',
        wifiPassword: 'welcome2026',
        entryCode: 'Keybox code: 4821',
        emergencyContactPhone: '+81 90 1234 5678',
        googleMapsUrl: 'https://maps.app.goo.gl/example',
      },
    })
    .expect(200);
}

async function createManualConfirmation(
  guestEmail: string,
  dates: { checkInDate: string; checkOutDate: string } = { checkInDate: '2026-09-01', checkOutDate: '2026-09-03' },
) {
  const token = await login('admin@sachihouse.com', 'admin123');
  const res = await request(app)
    .post('/api/properties/main/booking-confirmations')
    .set({ Authorization: `Bearer ${token}` })
    .send({
      propertyName: 'Sachi House Ojima',
      propertyAddress: 'Tokyo',
      propertyUrl: 'https://sachi-house.net/#/main',
      guestName: 'Hanako Tanaka',
      guestEmail,
      numGuests: 2,
      ...dates,
      checkInTime: '15:00',
      checkOutTime: '10:00',
      currency: 'JPY',
      roomFee: 20000,
      cleaningFee: 5000,
      extraFee: 0,
      discountAmount: 0,
      totalAmount: 25000,
      depositAmount: 25000,
      balanceDue: 0,
    })
    .expect(201);
  return res.body.confirmation as { confirmationNo: string };
}

function minimalGuest(id: string) {
  return { id, evidenceUrl: 'gcs://fake-bucket/fake-evidence.jpg', fullName: 'Hanako Tanaka' };
}

beforeEach(async () => {
  store = new MemoryStore();
  await store.init();
  mailer = new FakeMailer();
  app = createApp(store, { mailer });
});

describe('booking-specific check-in link matching', () => {
  it('matches a real confirmation number for the property', async () => {
    const confirmation = await createManualConfirmation('hanako@example.com');
    const res = await request(app)
      .get(`/api/properties/main/checkins/match?bk=${confirmation.confirmationNo}`)
      .expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('matches case-insensitively', async () => {
    const confirmation = await createManualConfirmation('hanako@example.com');
    const res = await request(app)
      .get(`/api/properties/main/checkins/match?bk=${confirmation.confirmationNo.toLowerCase()}`)
      .expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('reports no match for a made-up booking id', async () => {
    const res = await request(app)
      .get('/api/properties/main/checkins/match?bk=BC-99999999-ZZZZ')
      .expect(200);
    expect(res.body).toEqual({ ok: false });
  });

  it('rate-limits repeated guesses from the same IP', async () => {
    for (let i = 0; i < 10; i += 1) {
      await request(app).get('/api/properties/main/checkins/match?bk=BC-99999999-ZZZZ').expect(200);
    }
    await request(app).get('/api/properties/main/checkins/match?bk=BC-99999999-ZZZZ').expect(429);
  });

  it('404s for an unknown property', async () => {
    await request(app).get('/api/properties/does-not-exist/checkins/match?bk=BC-99999999-ZZZZ').expect(404);
  });

  it('stops matching once the stay is well past checkout (default 2-day grace)', async () => {
    const confirmation = await createManualConfirmation('hanako@example.com', {
      checkInDate: isoDaysFromNow(-6),
      checkOutDate: isoDaysFromNow(-3),
    });
    const res = await request(app)
      .get(`/api/properties/main/checkins/match?bk=${confirmation.confirmationNo}`)
      .expect(200);
    expect(res.body).toEqual({ ok: false });
  });

  it('still matches within the grace window right after checkout', async () => {
    const confirmation = await createManualConfirmation('hanako@example.com', {
      checkInDate: isoDaysFromNow(-3),
      checkOutDate: isoDaysFromNow(-1),
    });
    const res = await request(app)
      .get(`/api/properties/main/checkins/match?bk=${confirmation.confirmationNo}`)
      .expect(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('post-checkin welcome email', () => {
  it('sends house info to the guest when the check-in was reached via a matched booking link', async () => {
    await setCheckInInfo();
    const confirmation = await createManualConfirmation('hanako@example.com');
    // Creating the manual confirmation itself already emailed the guest;
    // isolate what the check-in submission sends on top of that.
    mailer.sent.length = 0;

    const session = await request(app).post('/api/properties/main/checkins/start').expect(201);
    await request(app)
      .post('/api/properties/main/checkins/submit')
      .send({
        checkinToken: session.body.checkinToken,
        checkInDate: '2026-09-01',
        checkOutDate: '2026-09-03',
        guests: [minimalGuest('g1')],
        consent: { accepted: true, acceptedAt: Date.now(), noticeVersion: session.body.consentPolicy.noticeVersion },
        bk: confirmation.confirmationNo,
        locale: 'en',
      })
      .expect(201);

    const mail = mailer.to('hanako@example.com');
    expect(mail).toHaveLength(1);
    expect(mail[0].text).toContain('welcome2026');
    expect(mail[0].text).toContain('Keybox code: 4821');
    expect(mail[0].text).toContain('+81 90 1234 5678');
    expect(mail[0].text).toContain('maps.app.goo.gl');
  });

  it('sends nothing for the generic per-property link (no bk at all)', async () => {
    await setCheckInInfo();
    await createManualConfirmation('hanako@example.com');
    // Creating the manual confirmation itself already emailed the guest;
    // isolate what the check-in submission sends on top of that.
    mailer.sent.length = 0;

    const session = await request(app).post('/api/properties/main/checkins/start').expect(201);
    await request(app)
      .post('/api/properties/main/checkins/submit')
      .send({
        checkinToken: session.body.checkinToken,
        checkInDate: '2026-09-01',
        checkOutDate: '2026-09-03',
        guests: [minimalGuest('g1')],
        consent: { accepted: true, acceptedAt: Date.now(), noticeVersion: session.body.consentPolicy.noticeVersion },
      })
      .expect(201);

    expect(mailer.sent).toHaveLength(0);
  });

  it('does not fail the check-in submission if bk no longer matches anything', async () => {
    await setCheckInInfo();

    const session = await request(app).post('/api/properties/main/checkins/start').expect(201);
    await request(app)
      .post('/api/properties/main/checkins/submit')
      .send({
        checkinToken: session.body.checkinToken,
        checkInDate: '2026-09-01',
        checkOutDate: '2026-09-03',
        guests: [minimalGuest('g1')],
        consent: { accepted: true, acceptedAt: Date.now(), noticeVersion: session.body.consentPolicy.noticeVersion },
        bk: 'BC-99999999-ZZZZ',
        locale: 'en',
      })
      .expect(201);

    expect(mailer.sent).toHaveLength(0);
  });

  it('does not send the welcome email for an expired bk, even if the match check was bypassed', async () => {
    await setCheckInInfo();
    const confirmation = await createManualConfirmation('hanako@example.com', {
      checkInDate: isoDaysFromNow(-6),
      checkOutDate: isoDaysFromNow(-3),
    });
    mailer.sent.length = 0;

    const session = await request(app).post('/api/properties/main/checkins/start').expect(201);
    await request(app)
      .post('/api/properties/main/checkins/submit')
      .send({
        checkinToken: session.body.checkinToken,
        checkInDate: isoDaysFromNow(-6),
        checkOutDate: isoDaysFromNow(-3),
        guests: [minimalGuest('g1')],
        consent: { accepted: true, acceptedAt: Date.now(), noticeVersion: session.body.consentPolicy.noticeVersion },
        bk: confirmation.confirmationNo,
        locale: 'en',
      })
      .expect(201);

    expect(mailer.sent).toHaveLength(0);
  });
});
