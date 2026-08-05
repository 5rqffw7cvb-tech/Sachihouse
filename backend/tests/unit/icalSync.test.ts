import { afterEach, describe, expect, it, vi } from 'vitest';
import { IcalSyncService } from '../../src/services/icalSync.js';
import { MemoryStore } from '../../src/store/memoryStore.js';
import { PropertyData } from '../../src/store/types.js';

function fakeIcsResponse(body: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    text: async () => body,
  });
}

function property(feeds: PropertyData['icalFeeds']): PropertyData & { id: string } {
  return { id: 'main', icalFeeds: feeds } as PropertyData & { id: string };
}

describe('IcalSyncService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attributes an imported event to its feed and expands the stay to individual nights', async () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:abc123@airbnb.com',
      'DTSTART;VALUE=DATE:20260810',
      'DTEND;VALUE=DATE:20260813',
      'SUMMARY:Reserved',
      'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMXXXX',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    vi.stubGlobal('fetch', fakeIcsResponse(ics));

    const service = new IcalSyncService({ enabled: true, ttlMs: 60_000, timeoutMs: 5000 });
    const prop = property([{ id: 'feed1', name: 'Airbnb', url: 'https://airbnb.example/cal.ics', lastSynced: '' }]);

    const events = await service.getImportedEvents(prop, 'fresh-if-stale');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      feedId: 'feed1',
      feedName: 'Airbnb',
      summary: 'Reserved',
      checkInDate: '2026-08-10',
      checkOutDate: '2026-08-13',
      dates: ['2026-08-10', '2026-08-11', '2026-08-12'],
      guestCount: null,
    });
    expect(events[0].description).toContain('airbnb.com/hosting/reservations');

    const blockedDates = await service.getBlockedDates(prop, [], 'fresh-if-stale');
    expect(blockedDates).toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
  });

  it('unfolds RFC 5545 continuation lines before reading SUMMARY/DESCRIPTION', async () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260901',
      'DTEND;VALUE=DATE:20260902',
      'SUMMARY:Reserved',
      'DESCRIPTION:This is a long note that a real platform would wrap across',
      '  multiple continuation lines per RFC 5545 folding rules.',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    vi.stubGlobal('fetch', fakeIcsResponse(ics));

    const service = new IcalSyncService({ enabled: true, ttlMs: 60_000, timeoutMs: 5000 });
    const prop = property([{ id: 'feed1', name: 'Booking.com', url: 'https://booking.example/cal.ics', lastSynced: '' }]);

    const [event] = await service.getImportedEvents(prop, 'fresh-if-stale');
    expect(event.description).toBe(
      'This is a long note that a real platform would wrap across multiple continuation lines per RFC 5545 folding rules.',
    );
  });

  it('extracts a guest count only when the feed actually states one', async () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260915',
      'DTEND;VALUE=DATE:20260917',
      'SUMMARY:Reserved - 3 guests',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    vi.stubGlobal('fetch', fakeIcsResponse(ics));

    const service = new IcalSyncService({ enabled: true, ttlMs: 60_000, timeoutMs: 5000 });
    const prop = property([{ id: 'feed1', name: 'Vrbo', url: 'https://vrbo.example/cal.ics', lastSynced: '' }]);

    const [event] = await service.getImportedEvents(prop, 'fresh-if-stale');
    expect(event.guestCount).toBe(3);
  });

  it('detects Airbnb and Booking.com from a Hostex-aggregated feed\'s reservation code', async () => {
    // Real shape of a Hostex export: one feed, multiple OTAs funneled through
    // it. The channel-prefix mapping (0=Airbnb, 9=Booking.com) was confirmed
    // against a real Hostex account, not documented publicly by Hostex.
    const ics = [
      'BEGIN:VCALENDAR',
      'PRODID:-//Xiaoge//Hostex Hosting Calendar 2.12.0//EN',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260805',
      'DTEND;VALUE=DATE:20260824',
      'SUMMARY:Reserved: Lucas Henrique Silva 2 guests',
      'DESCRIPTION:Hostex reservation code: 0-HM5R8EW9YC-iffeae12sl',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260901',
      'DTEND;VALUE=DATE:20260908',
      'SUMMARY:Reserved: Nguyen Thi Thanh Vi 4 guests',
      'DESCRIPTION:Hostex reservation code: 9-6715379079-ifng5powx4',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261126',
      'DTEND;VALUE=DATE:20261204',
      'SUMMARY:Reserved: Mai Hoang Tan 7 guests',
      'DESCRIPTION:Hostex reservation code: 5-6BUW8GT0W',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261209',
      'DTEND;VALUE=DATE:20261223',
      'SUMMARY:Reserved: David Barrera Jr. 3 guests',
      'DESCRIPTION:Hostex reservation code: 3-XYZ12345',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260828',
      'DTEND;VALUE=DATE:20260830',
      'SUMMARY:Hostex (Not available)',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    vi.stubGlobal('fetch', fakeIcsResponse(ics));

    const service = new IcalSyncService({ enabled: true, ttlMs: 60_000, timeoutMs: 5000 });
    const prop = property([{ id: 'feed1', name: 'Hostex', url: 'https://hostex.example/cal.ics', lastSynced: '' }]);

    const events = await service.getImportedEvents(prop, 'fresh-if-stale');
    const [airbnb, booking, hostexDirect, unknownPrefix, plainBlock] = events;

    expect(airbnb.channelName).toBe('Airbnb');
    expect(booking.channelName).toBe('Booking.com');
    expect(hostexDirect.channelName).toBe('Hostex Direct');
    // An unrecognized prefix must stay unclassified rather than guessed.
    expect(unknownPrefix.channelName).toBeNull();
    // A block with no reservation code at all is likewise unclassified.
    expect(plainBlock.channelName).toBeNull();
  });

  it('keeps each feed distinct when a property has more than one', async () => {
    const airbnbIcs = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261001',
      'DTEND;VALUE=DATE:20261002',
      'SUMMARY:Reserved',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const bookingIcs = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20261101',
      'DTEND;VALUE=DATE:20261102',
      'SUMMARY:CLOSED - Not available',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      text: async () => (url.includes('airbnb') ? airbnbIcs : bookingIcs),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const service = new IcalSyncService({ enabled: true, ttlMs: 60_000, timeoutMs: 5000 });
    const prop = property([
      { id: 'feed1', name: 'Airbnb', url: 'https://airbnb.example/cal.ics', lastSynced: '' },
      { id: 'feed2', name: 'Booking.com', url: 'https://booking.example/cal.ics', lastSynced: '' },
    ]);

    const events = await service.getImportedEvents(prop, 'fresh-if-stale');
    expect(events.map((e) => e.feedName).sort()).toEqual(['Airbnb', 'Booking.com']);
  });
});

describe('IcalSyncService persistence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists imported events to the store and serves history from it, keyed by the Hostex reservation code', async () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART;VALUE=DATE:20260810',
      'DTEND;VALUE=DATE:20260813',
      'SUMMARY:Reserved',
      'DESCRIPTION:Hostex reservation code: 0-ABC123-xyz',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    vi.stubGlobal('fetch', fakeIcsResponse(ics));

    const store = new MemoryStore();
    await store.init();
    const service = new IcalSyncService({ enabled: true, ttlMs: 60_000, timeoutMs: 5000 }, store);
    const prop = property([{ id: 'feed1', name: 'Hostex', url: 'https://hostex.example/cal.ics', lastSynced: '' }]);

    const events = await service.getImportedEvents(prop, 'fresh-if-stale');
    expect(events).toHaveLength(1);
    expect(events[0].externalId).toBe('0-ABC123-xyz');
    expect(await store.listImportedEvents('main')).toHaveLength(1);
  });

  it('keeps a stay that already checked out as history even after it drops out of the live feed', async () => {
    const store = new MemoryStore();
    await store.init();
    await store.upsertImportedEvents('main', [{
      externalId: 'old-1',
      feedId: 'feed1',
      feedName: 'Hostex',
      channelName: 'Airbnb',
      summary: 'Reserved',
      description: '',
      checkInDate: '2020-01-01',
      checkOutDate: '2020-01-03',
      dates: ['2020-01-01', '2020-01-02'],
      guestCount: null,
    }]);

    // The feed now comes back with zero reservations at all — but the old
    // stay already checked out years ago, so its absence is normal feed
    // churn, not a cancellation, and must not delete the history row.
    vi.stubGlobal('fetch', fakeIcsResponse(['BEGIN:VCALENDAR', 'END:VCALENDAR'].join('\r\n')));
    const service = new IcalSyncService({ enabled: true, ttlMs: 60_000, timeoutMs: 5000 }, store);
    const prop = property([{ id: 'feed1', name: 'Hostex', url: 'https://hostex.example/cal.ics', lastSynced: '' }]);
    await service.getImportedEvents(prop, 'fresh-if-stale');

    expect((await store.listImportedEvents('main')).map((e) => e.externalId)).toContain('old-1');
  });

  it('removes a not-yet-checked-out stay that disappeared from the feed (a real cancellation)', async () => {
    const store = new MemoryStore();
    await store.init();
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const futureOut = new Date(Date.now() + 33 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await store.upsertImportedEvents('main', [{
      externalId: 'cancelled-1',
      feedId: 'feed1',
      feedName: 'Hostex',
      channelName: 'Airbnb',
      summary: 'Reserved',
      description: '',
      checkInDate: future,
      checkOutDate: futureOut,
      dates: [future],
      guestCount: null,
    }]);

    vi.stubGlobal('fetch', fakeIcsResponse(['BEGIN:VCALENDAR', 'END:VCALENDAR'].join('\r\n')));
    const service = new IcalSyncService({ enabled: true, ttlMs: 60_000, timeoutMs: 5000 }, store);
    const prop = property([{ id: 'feed1', name: 'Hostex', url: 'https://hostex.example/cal.ics', lastSynced: '' }]);
    await service.getImportedEvents(prop, 'fresh-if-stale');

    expect((await store.listImportedEvents('main')).map((e) => e.externalId)).not.toContain('cancelled-1');
  });

  it('never prunes when a feed fetch fails, so a transient outage cannot look like a mass cancellation', async () => {
    const store = new MemoryStore();
    await store.init();
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const futureOut = new Date(Date.now() + 33 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await store.upsertImportedEvents('main', [{
      externalId: 'still-live-1',
      feedId: 'feed1',
      feedName: 'Airbnb',
      channelName: 'Airbnb',
      summary: 'Reserved',
      description: '',
      checkInDate: future,
      checkOutDate: futureOut,
      dates: [future],
      guestCount: null,
    }]);

    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('feed1')) {
        throw new Error('network down');
      }
      return { ok: true, text: async () => ['BEGIN:VCALENDAR', 'END:VCALENDAR'].join('\r\n') };
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = new IcalSyncService({ enabled: true, ttlMs: 60_000, timeoutMs: 5000 }, store);
    const prop = property([
      { id: 'feed1', name: 'Airbnb', url: 'https://airbnb.example/feed1.ics', lastSynced: '' },
      { id: 'feed2', name: 'Booking.com', url: 'https://booking.example/feed2.ics', lastSynced: '' },
    ]);
    await service.getImportedEvents(prop, 'fresh-if-stale');

    expect((await store.listImportedEvents('main')).map((e) => e.externalId)).toContain('still-live-1');
  });
});
