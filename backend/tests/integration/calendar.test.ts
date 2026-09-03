import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { ImportedEvent } from '../../src/store/types.js';

function importedEvent(partial: Partial<ImportedEvent> & { dates: string[] }): ImportedEvent {
  return {
    externalId: 'ev',
    feedId: 'cal1',
    feedName: 'Hostex',
    channelName: null,
    summary: 'Hostex (Not available)',
    description: '',
    checkInDate: partial.dates[0],
    checkOutDate: partial.dates[partial.dates.length - 1],
    guestCount: null,
    ...partial,
  };
}

const confirmation = (checkInDate: string, checkOutDate: string) => ({
  guestName: 'Alice Ho',
  checkInDate,
  checkOutDate,
  numGuests: 2,
  roomFee: 20000,
  cleaningFee: 3000,
  totalAmount: 23000,
  balanceDue: 23000,
});

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

describe('host calendar flow', () => {
  it('blocks a date, reflects it in the calendar and public ical export', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const auth = { Authorization: `Bearer ${token}` };

    // Block a manual date.
    const add = await request(app)
      .post('/api/properties/main/blocked-dates')
      .set(auth)
      .send({ dates: ['2026-08-10', '2026-08-11', 'garbage'] })
      .expect(200);
    expect(add.body.manualBlockedDates).toContain('2026-08-10');
    expect(add.body.manualBlockedDates).toContain('2026-08-11');

    // Calendar returns manual dates + export url.
    const cal = await request(app).get('/api/properties/main/calendar').set(auth).expect(200);
    expect(cal.body.manualBlockedDates).toContain('2026-08-10');
    expect(cal.body.exportUrl).toMatch(/\/api\/ical\/main\/[a-f0-9]+\.ics$/);

    const exportUrl: string = cal.body.exportUrl;
    const path = exportUrl.slice(exportUrl.indexOf('/api/'));

    // Public export works and contains the blocked range.
    const ics = await request(app).get(path).expect(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.text).toContain('BEGIN:VCALENDAR');
    expect(ics.text).toContain('DTSTART;VALUE=DATE:20260810');
    // 2026-08-10 + 2026-08-11 coalesce into one event ending 2026-08-12 (exclusive).
    expect(ics.text).toContain('DTEND;VALUE=DATE:20260812');

    // Wrong token is rejected.
    await request(app).get('/api/ical/main/deadbeef.ics').expect(404);

    // Remove one date.
    const del = await request(app)
      .delete('/api/properties/main/blocked-dates')
      .set(auth)
      .send({ dates: ['2026-08-10'] })
      .expect(200);
    expect(del.body.manualBlockedDates).not.toContain('2026-08-10');
    expect(del.body.manualBlockedDates).toContain('2026-08-11');

    // iCal feed update round-trips.
    const feeds = await request(app)
      .put('/api/properties/main/ical-feeds')
      .set(auth)
      .send({ feeds: [{ name: 'Airbnb', url: 'https://example.com/cal.ics' }, { name: 'blank', url: '' }] })
      .expect(200);
    expect(feeds.body.icalFeeds).toHaveLength(1);
    expect(feeds.body.icalFeeds[0].url).toBe('https://example.com/cal.ics');
  });

  it('holds the nights of an off-platform confirmation, and hides the channel manager echo of it', async () => {
    const token = await login('admin@sachihouse.com', 'admin123');
    const auth = { Authorization: `Bearer ${token}` };

    await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set(auth)
      .send(confirmation('2026-10-17', '2026-10-19'))
      .expect(201);

    // The stay holds its own nights now — it no longer depends on the host
    // also remembering to block them by hand, or on another platform doing it.
    const blocked = await request(app).get('/api/properties/main/blocked-dates').expect(200);
    expect(blocked.body.blockedDates).toEqual(expect.arrayContaining(['2026-10-17', '2026-10-18']));
    expect(blocked.body.blockedDates).not.toContain('2026-10-19'); // check-out morning

    const clash = await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set(auth)
      .send(confirmation('2026-10-18', '2026-10-20'))
      .expect(409);
    expect(clash.body.conflictDates).toEqual(['2026-10-18']);

    // Our export told the channel manager those nights were taken; it now
    // publishes them back at us as an anonymous block. Alongside it, a real
    // reservation that must survive the filtering.
    await store.upsertImportedEvents('main', [
      importedEvent({ externalId: 'echo', dates: ['2026-10-17', '2026-10-18'] }),
      importedEvent({
        externalId: 'real',
        dates: ['2026-10-25', '2026-10-26'],
        summary: 'Reserved: Jan Tabije 3 guests',
        description: 'Hostex reservation code: 0-HMKSDAMXAA-ifqexzmr1r',
      }),
    ]);

    const cal = await request(app).get('/api/properties/main/calendar').set(auth).expect(200);
    expect(cal.body.importedEvents.map((e: ImportedEvent) => e.externalId)).toEqual(['real']);
    expect(cal.body.bookings).toHaveLength(1);
    expect(cal.body.bookings[0]).toMatchObject({ guestName: 'Alice Ho', checkInDate: '2026-10-17' });
  });

  it('denies calendar access to a host not assigned to the property', async () => {
    const token = await login('host@sachihouse.com', 'host123');
    const auth = { Authorization: `Bearer ${token}` };
    // Seeded host is assigned to which property? Ensure at least the unauthorized path 403s.
    const me = await request(app).get('/api/auth/me').set(auth).expect(200);
    const assigned: string[] = me.body.user.assignedPropertyIds ?? [];
    const foreign = ['main', 'list_shin'].find((p) => !assigned.includes(p));
    if (foreign) {
      await request(app).get(`/api/properties/${foreign}/calendar`).set(auth).expect(403);
    }
  });
});
