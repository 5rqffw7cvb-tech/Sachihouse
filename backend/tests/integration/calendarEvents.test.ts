import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { toJstDateString } from '../../src/domain/booking.js';
import { MemoryStore } from '../../src/store/memoryStore.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let app: ReturnType<typeof createApp>;
let store: MemoryStore;

function jstDaysFromNow(days: number): string {
  return toJstDateString(Date.now() + days * DAY_MS);
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  return res.body.token as string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function adminAuth() {
  return bearer(await login('admin@sachihouse.com', 'admin123'));
}

// Self-registered hosts start at host level 1 with no property assigned.
async function registerHost(email: string): Promise<{ auth: Record<string, string>; id: number; hostLevel: unknown }> {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'New Host', email, password: 'secret123' })
    .expect(201);
  return { auth: bearer(res.body.token), id: res.body.user.id, hostLevel: res.body.user.hostLevel };
}

async function assignHost(admin: Record<string, string>, propertyId: string, userId: number) {
  await request(app).post(`/api/properties/${propertyId}/hosts/${userId}`).set(admin).expect(204);
}

async function guestAuth(admin: Record<string, string>) {
  await request(app)
    .post('/api/users')
    .set(admin)
    .send({ name: 'Guest User', email: 'guest-user@sachihouse.com', password: 'guest1234', role: 'GUEST' })
    .expect(201);
  return bearer(await login('guest-user@sachihouse.com', 'guest1234'));
}

async function cleaningToken(admin: Record<string, string>): Promise<string> {
  const link = await request(app).get('/api/cleaning-calendar-link').set(admin).expect(200);
  return link.body.url.slice(link.body.url.indexOf('/cleaning/') + '/cleaning/'.length);
}

function eventBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Plumber visit',
    note: 'Bring the spare key',
    date: jstDaysFromNow(10),
    startTime: '10:00',
    endTime: '11:00',
    ...overrides,
  };
}

async function createEvent(auth: Record<string, string>, propertyId = 'main', overrides: Record<string, unknown> = {}) {
  const res = await request(app).post(`/api/properties/${propertyId}/events`).set(auth).send(eventBody(overrides)).expect(201);
  return res.body.event as Record<string, unknown> & { id: string };
}

function expectError(res: request.Response, status: number, message: string) {
  expect(res.status).toBe(status);
  expect(res.body).toEqual({ error: message });
}

beforeEach(async () => {
  store = new MemoryStore();
  await store.init();
  app = createApp(store);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('T1 permissions on calendar event routes', () => {
  it('rejects anonymous callers with 401 on POST, PATCH and DELETE', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin);

    expectError(await request(app).post('/api/properties/main/events').send(eventBody()), 401, 'Authentication required.');
    expectError(await request(app).patch(`/api/calendar-events/${ev.id}`).send({ title: 'x' }), 401, 'Authentication required.');
    expectError(await request(app).delete(`/api/calendar-events/${ev.id}`), 401, 'Authentication required.');
  });

  it('rejects GUEST users with 403 on POST, PATCH and DELETE', async () => {
    const admin = await adminAuth();
    const guest = await guestAuth(admin);
    const ev = await createEvent(admin);

    expectError(await request(app).post('/api/properties/main/events').set(guest).send(eventBody()), 403, 'Host or admin role required.');
    expectError(await request(app).patch(`/api/calendar-events/${ev.id}`).set(guest).send({ title: 'x' }), 403, 'Host or admin role required.');
    expectError(await request(app).delete(`/api/calendar-events/${ev.id}`).set(guest), 403, 'Host or admin role required.');
  });

  it('rejects a host not assigned to the property with 403', async () => {
    const admin = await adminAuth();
    const { auth: host } = await registerHost('unassigned@example.com');
    const ev = await createEvent(admin);

    expectError(await request(app).post('/api/properties/main/events').set(host).send(eventBody()), 403, 'Not allowed for this property.');
    expectError(await request(app).patch(`/api/calendar-events/${ev.id}`).set(host).send({ title: 'x' }), 403, 'Not allowed for this property.');
    expectError(await request(app).delete(`/api/calendar-events/${ev.id}`).set(host), 403, 'Not allowed for this property.');

    const stored = await store.getCalendarEvent(ev.id);
    expect(stored?.title).toBe('Plumber visit');
  });

  it('lets a level-1 host assigned to the property create, update and delete', async () => {
    const admin = await adminAuth();
    const { auth: host, id, hostLevel } = await registerHost('level1@example.com');
    expect(hostLevel).toBe(1);
    await assignHost(admin, 'main', id);

    const created = await request(app).post('/api/properties/main/events').set(host).send(eventBody()).expect(201);
    const ev = created.body.event;
    expect(ev).toMatchObject({
      propertyId: 'main',
      title: 'Plumber visit',
      note: 'Bring the spare key',
      startTime: '10:00',
      endTime: '11:00',
    });
    expect(ev.id).toMatch(/^cal_/);
    expect(typeof ev.createdAt).toBe('number');
    expect(typeof ev.updatedAt).toBe('number');

    const patched = await request(app).patch(`/api/calendar-events/${ev.id}`).set(host).send({ title: 'Electrician' }).expect(200);
    expect(patched.body.event).toMatchObject({ id: ev.id, title: 'Electrician', note: 'Bring the spare key', startTime: '10:00' });

    const deleted = await request(app).delete(`/api/calendar-events/${ev.id}`).set(host).expect(204);
    expect(deleted.text).toBe('');
    expect(await store.getCalendarEvent(ev.id)).toBeNull();
  });

  it('lets the seeded host (id 2, assigned main) manage events on main but not list_shin', async () => {
    const host = bearer(await login('host@sachihouse.com', 'host123'));
    const ev = await createEvent(host, 'main');
    await request(app).patch(`/api/calendar-events/${ev.id}`).set(host).send({ note: 'n' }).expect(200);
    expectError(await request(app).post('/api/properties/list_shin/events').set(host).send(eventBody()), 403, 'Not allowed for this property.');
  });

  it('lets an admin manage events on any property', async () => {
    const admin = await adminAuth();
    for (const propertyId of ['main', 'list_shin']) {
      const ev = await createEvent(admin, propertyId);
      expect(ev.propertyId).toBe(propertyId);
      await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ title: 'Changed' }).expect(200);
      await request(app).delete(`/api/calendar-events/${ev.id}`).set(admin).expect(204);
    }
  });
});

describe('T2 IDOR on event id', () => {
  it('a host assigned only to main cannot PATCH or DELETE an event of list_shin', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin, 'list_shin', { title: 'Shinjuku inspection' });
    const before = await store.getCalendarEvent(ev.id);

    const seededHost = bearer(await login('host@sachihouse.com', 'host123'));
    const { auth: level1, id } = await registerHost('idor@example.com');
    await assignHost(admin, 'main', id);

    for (const host of [seededHost, level1]) {
      expectError(
        await request(app).patch(`/api/calendar-events/${ev.id}`).set(host).send({ title: 'Hijacked', date: jstDaysFromNow(20) }),
        403,
        'Not allowed for this property.',
      );
      expectError(await request(app).delete(`/api/calendar-events/${ev.id}`).set(host), 403, 'Not allowed for this property.');
    }

    expect(await store.getCalendarEvent(ev.id)).toEqual(before);
  });
});

describe('T3 not found', () => {
  it('returns 404 for an unknown property on POST', async () => {
    const admin = await adminAuth();
    expectError(
      await request(app).post('/api/properties/does-not-exist/events').set(admin).send(eventBody()),
      404,
      'Property not found.',
    );
  });

  it('returns 404 for an unknown event on PATCH and DELETE', async () => {
    const admin = await adminAuth();
    expectError(await request(app).patch('/api/calendar-events/cal_doesnotexist').set(admin).send({ title: 'x' }), 404, 'Calendar event not found.');
    expectError(await request(app).delete('/api/calendar-events/cal_doesnotexist').set(admin), 404, 'Calendar event not found.');
  });

  it('returns 404 when deleting the same event twice', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin);
    await request(app).delete(`/api/calendar-events/${ev.id}`).set(admin).expect(204);
    expectError(await request(app).delete(`/api/calendar-events/${ev.id}`).set(admin), 404, 'Calendar event not found.');
    expectError(await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ title: 'x' }), 404, 'Calendar event not found.');
  });
});

describe('T4 POST validation', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['missing title', { title: undefined }, 'title is required.'],
    ['blank title', { title: '   ' }, 'title is required.'],
    ['numeric title', { title: 123 }, 'title is required.'],
    ['title over 200 chars', { title: 'a'.repeat(201) }, 'title must be at most 200 characters.'],
    ['note over 2000 chars', { note: 'n'.repeat(2001) }, 'note must be at most 2000 characters.'],
    ['numeric note', { note: 42 }, 'note must be a string.'],
    ['missing date', { date: undefined }, 'date must be YYYY-MM-DD.'],
    ['impossible date 2026-02-30', { date: '2026-02-30' }, 'date must be YYYY-MM-DD.'],
    ['slashed date 2026/03/01', { date: '2026/03/01' }, 'date must be YYYY-MM-DD.'],
    ['year-zero date 0000-01-01', { date: '0000-01-01' }, 'date must be YYYY-MM-DD.'],
    ['date before the 1900-01-01 floor (1899-12-31)', { date: '1899-12-31' }, 'date must be YYYY-MM-DD.'],
    ['startTime 24:00', { startTime: '24:00' }, 'startTime must be HH:mm.'],
    ['startTime 9:00', { startTime: '9:00' }, 'startTime must be HH:mm.'],
    ['missing startTime', { startTime: undefined }, 'startTime must be HH:mm.'],
    ['endTime 25:00', { endTime: '25:00' }, 'endTime must be HH:mm.'],
    ['missing endTime', { endTime: undefined }, 'endTime must be HH:mm.'],
    ['end equal to start', { startTime: '10:00', endTime: '10:00' }, 'endTime must be later than startTime.'],
    ['end before start', { startTime: '10:00', endTime: '09:59' }, 'endTime must be later than startTime.'],
  ];

  for (const [name, overrides, message] of cases) {
    it(`rejects ${name} with 400`, async () => {
      const admin = await adminAuth();
      const res = await request(app).post('/api/properties/main/events').set(admin).send(eventBody(overrides));
      expectError(res, 400, message);
      expect(await store.listCalendarEvents(['main'])).toEqual([]);
    });
  }

  it('accepts a 200-character title and a 2000-character note', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin, 'main', { title: 't'.repeat(200), note: 'n'.repeat(2000) });
    expect((ev.title as string).length).toBe(200);
    expect((ev.note as string).length).toBe(2000);
  });

  it('measures the title length after trimming', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin, 'main', { title: `  ${'t'.repeat(200)}  ` });
    expect((ev.title as string).length).toBe(200);
  });

  it('accepts the earliest allowed date 1900-01-01 (boundary)', async () => {
    const admin = await adminAuth();
    const res = await request(app).post('/api/properties/main/events').set(admin).send(eventBody({ date: '1900-01-01' }));
    expect(res.status).toBe(201);
    expect(res.body.event).toMatchObject({ propertyId: 'main', date: '1900-01-01' });
    expect(await store.getCalendarEvent(res.body.event.id)).toMatchObject({ date: '1900-01-01' });
  });

  it('accepts boundary times 00:00-23:59', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin, 'main', { startTime: '00:00', endTime: '23:59' });
    expect(ev).toMatchObject({ startTime: '00:00', endTime: '23:59' });
  });
});

describe('T5 PATCH validation', () => {
  it('compares a lone endTime with the stored startTime', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin, 'main', { startTime: '10:00', endTime: '11:00' });
    expectError(await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ endTime: '09:00' }), 400, 'endTime must be later than startTime.');
    expectError(await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ endTime: '10:00' }), 400, 'endTime must be later than startTime.');
    expect(await store.getCalendarEvent(ev.id)).toMatchObject({ startTime: '10:00', endTime: '11:00' });
  });

  it('compares a lone startTime with the stored endTime', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin, 'main', { startTime: '10:00', endTime: '11:00' });
    expectError(await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ startTime: '12:00' }), 400, 'endTime must be later than startTime.');
    expect(await store.getCalendarEvent(ev.id)).toMatchObject({ startTime: '10:00', endTime: '11:00' });

    const ok = await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ startTime: '10:30' }).expect(200);
    expect(ok.body.event).toMatchObject({ startTime: '10:30', endTime: '11:00', title: 'Plumber visit' });
  });

  it('allows moving both times together past the old end', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin, 'main', { startTime: '10:00', endTime: '11:00' });
    const ok = await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ startTime: '14:00', endTime: '15:00' }).expect(200);
    expect(ok.body.event).toMatchObject({ startTime: '14:00', endTime: '15:00' });
  });

  it('rejects an empty title, a bad date and bad times', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin);
    const before = await store.getCalendarEvent(ev.id);
    expectError(await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ title: '' }), 400, 'title is required.');
    expectError(await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ title: '   ' }), 400, 'title is required.');
    expectError(await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ title: 'a'.repeat(201) }), 400, 'title must be at most 200 characters.');
    expectError(await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ date: '2026-02-30' }), 400, 'date must be YYYY-MM-DD.');
    expectError(await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ date: '2026/03/01' }), 400, 'date must be YYYY-MM-DD.');
    expectError(await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ startTime: '9:00' }), 400, 'startTime must be HH:mm.');
    expectError(await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ endTime: '24:00' }), 400, 'endTime must be HH:mm.');
    expectError(await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ note: 'n'.repeat(2001) }), 400, 'note must be at most 2000 characters.');
    expect(await store.getCalendarEvent(ev.id)).toEqual(before);
  });

  it('rejects moving an event to year 0000 or before 1900-01-01 and keeps the old date', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin);
    const before = await store.getCalendarEvent(ev.id);
    expectError(await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ date: '0000-01-01' }), 400, 'date must be YYYY-MM-DD.');
    expectError(await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ date: '1899-12-31' }), 400, 'date must be YYYY-MM-DD.');
    expect(await store.getCalendarEvent(ev.id)).toEqual(before);
    expect(before).toMatchObject({ date: ev.date });

    const ok = await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ date: '1900-01-01' }).expect(200);
    expect(ok.body.event).toMatchObject({ date: '1900-01-01' });
  });

  it('leaves fields that are not sent unchanged and trims the title', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin);
    const res = await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ title: '  New title  ' }).expect(200);
    expect(res.body.event).toEqual({ ...ev, title: 'New title', updatedAt: res.body.event.updatedAt });
  });
});

describe('T6 note normalisation', () => {
  it('stores an absent or null note as an empty string on POST', async () => {
    const admin = await adminAuth();
    const absent = await createEvent(admin, 'main', { note: undefined });
    expect(absent.note).toBe('');
    const nulled = await createEvent(admin, 'main', { note: null });
    expect(nulled.note).toBe('');
  });

  it('trims title and note on POST', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin, 'main', { title: '  Gas check  ', note: '  call first \n' });
    expect(ev.title).toBe('Gas check');
    expect(ev.note).toBe('call first');
  });

  it('clears the note with null on PATCH, keeps it when absent, and trims it', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin, 'main', { note: 'keep me' });

    const untouched = await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ title: 'T' }).expect(200);
    expect(untouched.body.event.note).toBe('keep me');

    const trimmed = await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ note: '   spaced   ' }).expect(200);
    expect(trimmed.body.event.note).toBe('spaced');

    const cleared = await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ note: null }).expect(200);
    expect(cleared.body.event.note).toBe('');
    expect((await store.getCalendarEvent(ev.id))?.note).toBe('');
  });
});

describe('T7 metalink', () => {
  it('stores an event created through the metalink against the property id', async () => {
    const admin = await adminAuth();
    const res = await request(app).post('/api/properties/sachi-ojima/events').set(admin).send(eventBody()).expect(201);
    expect(res.body.event.propertyId).toBe('main');

    const host = bearer(await login('host@sachihouse.com', 'host123'));
    const viaHost = await request(app).post('/api/properties/sachi-ojima/events').set(host).send(eventBody()).expect(201);
    expect(viaHost.body.event.propertyId).toBe('main');
  });
});

describe('T8 PATCH ignores propertyId', () => {
  it('does not move an event to another property', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin, 'main');
    const res = await request(app)
      .patch(`/api/calendar-events/${ev.id}`)
      .set(admin)
      .send({ propertyId: 'list_shin', title: 'Moved?' })
      .expect(200);
    expect(res.body.event.propertyId).toBe('main');
    expect(res.body.event.title).toBe('Moved?');
    expect((await store.getCalendarEvent(ev.id))?.propertyId).toBe('main');
  });

  it('does not let a host smuggle an event onto its own property via propertyId', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin, 'list_shin');
    const host = bearer(await login('host@sachihouse.com', 'host123'));
    expectError(
      await request(app).patch(`/api/calendar-events/${ev.id}`).set(host).send({ propertyId: 'main' }),
      403,
      'Not allowed for this property.',
    );
    expect((await store.getCalendarEvent(ev.id))?.propertyId).toBe('list_shin');
  });
});

describe('T9 archived property', () => {
  it('still allows creating and updating events on an archived property', async () => {
    const admin = await adminAuth();
    const archived = await request(app).patch('/api/properties/list_shin/archive').set(admin).send({ archived: true }).expect(200);
    expect(archived.body.property.archivedAt).toBeTruthy();

    const ev = await createEvent(admin, 'list_shin');
    expect(ev.propertyId).toBe('list_shin');
    const res = await request(app).patch(`/api/calendar-events/${ev.id}`).set(admin).send({ title: 'Still here' }).expect(200);
    expect(res.body.event.title).toBe('Still here');
    await request(app).delete(`/api/calendar-events/${ev.id}`).set(admin).expect(204);
  });
});

describe('T10 store failures on create', () => {
  it("maps a store 'Property not found.' error to 404", async () => {
    const admin = await adminAuth();
    vi.spyOn(store, 'createCalendarEvent').mockRejectedValueOnce(new Error('Property not found.'));
    expectError(await request(app).post('/api/properties/main/events').set(admin).send(eventBody()), 404, 'Property not found.');
  });

  it('maps a foreign-key violation (23503) to 404, not 409', async () => {
    const admin = await adminAuth();
    vi.spyOn(store, 'createCalendarEvent').mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }));
    expectError(await request(app).post('/api/properties/main/events').set(admin).send(eventBody()), 404, 'Property not found.');
  });

  it('maps a plain object with code 23503 to 404', async () => {
    const admin = await adminAuth();
    vi.spyOn(store, 'createCalendarEvent').mockRejectedValueOnce({ code: '23503' });
    expectError(await request(app).post('/api/properties/main/events').set(admin).send(eventBody()), 404, 'Property not found.');
  });

  it('passes any other error to the 500 handler', async () => {
    const admin = await adminAuth();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(store, 'createCalendarEvent').mockRejectedValueOnce(new Error('boom'));
    expectError(await request(app).post('/api/properties/main/events').set(admin).send(eventBody()), 500, 'boom');
  });
});

describe('T11 /calendar includes events', () => {
  const OLD_KEYS = [
    'propertyId',
    'propertyName',
    'manualBlockedDates',
    'importedBlockedDates',
    'importedEvents',
    'bookings',
    'directBookings',
    'icalFeeds',
    'exportUrl',
  ];

  it('returns the 9 existing keys plus events, with full event objects including note', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin, 'main', { note: 'secret detail' });
    await createEvent(admin, 'list_shin', { title: 'Other house' });

    const cal = await request(app).get('/api/properties/main/calendar').set(admin).expect(200);
    expect(Object.keys(cal.body).sort()).toEqual([...OLD_KEYS, 'events'].sort());
    expect(cal.body.events).toEqual([ev]);
    expect(cal.body.events[0].note).toBe('secret detail');
  });

  it('returns an empty events array when there are none', async () => {
    const admin = await adminAuth();
    const cal = await request(app).get('/api/properties/main/calendar').set(admin).expect(200);
    expect(cal.body.events).toEqual([]);
  });

  it('limits events to [JST today - 90, JST today + 365]', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-31T16:00:00Z')); // 2026-04-01 01:00 JST
    const admin = await adminAuth();
    for (const date of ['2025-12-31', '2026-01-01', '2027-04-01', '2027-04-02']) {
      await createEvent(admin, 'main', { date, title: `ev ${date}` });
    }

    const cal = await request(app).get('/api/properties/main/calendar').set(admin).expect(200);
    expect(cal.body.events.map((e: { date: string }) => e.date)).toEqual(['2026-01-01', '2027-04-01']);
  });

  it('uses the property id when the calendar is opened through the metalink', async () => {
    const admin = await adminAuth();
    const ev = await createEvent(admin, 'main');
    const cal = await request(app).get('/api/properties/sachi-ojima/calendar').set(admin).expect(200);
    expect(cal.body.events.map((e: { id: string }) => e.id)).toEqual([ev.id]);
  });
});

describe('T12 events never affect availability', () => {
  it('leaves blocked dates, calendar blocks, the .ics export and quotes untouched', async () => {
    const admin = await adminAuth();
    const day = jstDaysFromNow(30);
    const nextDay = jstDaysFromNow(31);
    const compact = day.replace(/-/g, '');
    const quoteBody = { propertyId: 'main', checkIn: day, checkOut: nextDay, adults: 2, children: 0, infants: 0 };

    const blockedBefore = await request(app).get('/api/properties/main/blocked-dates').expect(200);
    const calBefore = await request(app).get('/api/properties/main/calendar').set(admin).expect(200);
    const quoteBefore = await request(app).post('/api/quotes').send(quoteBody).expect(200);
    const availBefore = await request(app).get(`/api/properties/availability?checkIn=${day}&checkOut=${nextDay}`).expect(200);

    await createEvent(admin, 'main', { date: day, title: 'UniqueEventTitleXYZ', startTime: '00:00', endTime: '23:59' });

    const blockedAfter = await request(app).get('/api/properties/main/blocked-dates').expect(200);
    expect(blockedAfter.body).toEqual(blockedBefore.body);
    expect(blockedAfter.body.blockedDates).not.toContain(day);

    const calAfter = await request(app).get('/api/properties/main/calendar').set(admin).expect(200);
    expect(calAfter.body.manualBlockedDates).toEqual(calBefore.body.manualBlockedDates);
    expect(calAfter.body.importedBlockedDates).toEqual(calBefore.body.importedBlockedDates);
    expect(calAfter.body.importedEvents).toEqual(calBefore.body.importedEvents);
    expect(calAfter.body.events).toHaveLength(1);

    const exportUrl: string = calAfter.body.exportUrl;
    const ics = await request(app).get(exportUrl.slice(exportUrl.indexOf('/api/'))).expect(200);
    expect(ics.text).not.toContain('UniqueEventTitleXYZ');
    expect(ics.text).not.toContain(compact);

    const quoteAfter = await request(app).post('/api/quotes').send(quoteBody).expect(200);
    expect(quoteAfter.body).toEqual(quoteBefore.body);

    const availAfter = await request(app).get(`/api/properties/availability?checkIn=${day}&checkOut=${nextDay}`).expect(200);
    expect(availAfter.body).toEqual(availBefore.body);
  });
});

describe('T13 cleaning calendar events', () => {
  it('lists events with exactly the 6 public keys, no note, and leaves stays unchanged', async () => {
    const admin = await adminAuth();
    const token = await cleaningToken(admin);
    const from = jstDaysFromNow(1);
    const to = jstDaysFromNow(40);

    await request(app)
      .post('/api/properties/main/booking-confirmations')
      .set(admin)
      .send({
        guestName: 'Alice Ho',
        checkInDate: jstDaysFromNow(5),
        checkOutDate: jstDaysFromNow(7),
        numGuests: 2,
        roomFee: 20000,
        cleaningFee: 3000,
        totalAmount: 23000,
        balanceDue: 23000,
      })
      .expect(201);

    const before = await request(app).get(`/api/cleaning-calendar/${token}?from=${from}&to=${to}`).expect(200);
    expect(before.body.events).toEqual([]);
    expect(before.body.stays.length).toBeGreaterThan(0);

    const ev = await createEvent(admin, 'main', { date: jstDaysFromNow(6), note: 'TopSecretNote', title: 'Deep clean' });
    await createEvent(admin, 'list_shin', { date: jstDaysFromNow(8), title: 'Shinjuku key swap' });

    const after = await request(app).get(`/api/cleaning-calendar/${token}?from=${from}&to=${to}`).expect(200);
    expect(Object.keys(after.body).sort()).toEqual(['events', 'stays']);
    expect(after.body.stays).toEqual(before.body.stays);
    expect(after.body.events).toEqual([
      { propertyId: 'main', propertyName: 'Sachi House Ojima', date: ev.date, startTime: '10:00', endTime: '11:00', title: 'Deep clean' },
      { propertyId: 'list_shin', propertyName: 'Sachi House Shinjuku', date: jstDaysFromNow(8), startTime: '10:00', endTime: '11:00', title: 'Shinjuku key swap' },
    ]);
    for (const item of after.body.events) {
      expect(Object.keys(item).sort()).toEqual(['date', 'endTime', 'propertyId', 'propertyName', 'startTime', 'title']);
    }
    expect(JSON.stringify(after.body)).not.toContain('TopSecretNote');
    expect(JSON.stringify(after.body)).not.toContain(ev.id);
  });

  it('leaves out events of archived properties', async () => {
    const admin = await adminAuth();
    const token = await cleaningToken(admin);
    const date = jstDaysFromNow(5);
    await createEvent(admin, 'main', { date, title: 'Ojima' });
    await createEvent(admin, 'list_shin', { date, title: 'Shinjuku' });
    await request(app).patch('/api/properties/list_shin/archive').set(admin).send({ archived: true }).expect(200);
    await createEvent(admin, 'list_shin', { date, title: 'Shinjuku after archive' });

    const res = await request(app).get(`/api/cleaning-calendar/${token}?from=${date}&to=${date}`).expect(200);
    expect(res.body.events.map((e: { title: string }) => e.title)).toEqual(['Ojima']);
  });

  it('filters by from/to inclusively', async () => {
    const admin = await adminAuth();
    const token = await cleaningToken(admin);
    for (const date of ['2026-12-09', '2026-12-10', '2026-12-20', '2026-12-21']) {
      await createEvent(admin, 'main', { date, title: date });
    }
    const res = await request(app).get(`/api/cleaning-calendar/${token}?from=2026-12-10&to=2026-12-20`).expect(200);
    expect(res.body.events.map((e: { date: string }) => e.date)).toEqual(['2026-12-10', '2026-12-20']);
  });

  it('rejects a wrong token with 404', async () => {
    const admin = await adminAuth();
    await createEvent(admin, 'main');
    await request(app).get('/api/cleaning-calendar/deadbeef').expect(404);
  });
});

describe('T14 calendar reflects updates and deletes', () => {
  it('drops an event moved outside the window and one that was deleted', async () => {
    const admin = await adminAuth();
    const token = await cleaningToken(admin);
    const date = jstDaysFromNow(5);
    const moved = await createEvent(admin, 'main', { date, title: 'Moved' });
    const removed = await createEvent(admin, 'main', { date, title: 'Removed' });

    let cal = await request(app).get('/api/properties/main/calendar').set(admin).expect(200);
    expect(cal.body.events.map((e: { id: string }) => e.id).sort()).toEqual([moved.id, removed.id].sort());

    await request(app).patch(`/api/calendar-events/${moved.id}`).set(admin).send({ date: jstDaysFromNow(400) }).expect(200);
    cal = await request(app).get('/api/properties/main/calendar').set(admin).expect(200);
    expect(cal.body.events.map((e: { id: string }) => e.id)).toEqual([removed.id]);

    let cleaning = await request(app).get(`/api/cleaning-calendar/${token}?from=${date}&to=${date}`).expect(200);
    expect(cleaning.body.events.map((e: { title: string }) => e.title)).toEqual(['Removed']);

    await request(app).delete(`/api/calendar-events/${removed.id}`).set(admin).expect(204);
    cal = await request(app).get('/api/properties/main/calendar').set(admin).expect(200);
    expect(cal.body.events).toEqual([]);
    cleaning = await request(app).get(`/api/cleaning-calendar/${token}?from=${date}&to=${date}`).expect(200);
    expect(cleaning.body.events).toEqual([]);
  });
});
