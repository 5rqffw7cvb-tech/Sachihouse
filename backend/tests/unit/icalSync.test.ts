import { afterEach, describe, expect, it, vi } from 'vitest';
import { IcalSyncService } from '../../src/services/icalSync.js';
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
