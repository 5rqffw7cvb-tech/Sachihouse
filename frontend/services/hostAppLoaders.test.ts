import { describe, expect, it, vi } from 'vitest';
import { PropertyCalendar } from './calendar';

const getPropertyCalendar = vi.fn<(id: string) => Promise<PropertyCalendar>>();
vi.mock('./calendar', () => ({ getPropertyCalendar: (id: string) => getPropertyCalendar(id) }));

const { loadCalendars, loadStays } = await import('./hostApp');

function calendar(propertyId: string, checkInDate: string): PropertyCalendar {
  return {
    propertyId,
    propertyName: propertyId.toUpperCase(),
    manualBlockedDates: [],
    importedBlockedDates: [],
    importedEvents: [{
      feedId: 'feed1',
      feedName: 'Hostex',
      channelName: 'Airbnb',
      isBlock: false,
      summary: 'Reserved',
      description: '',
      checkInDate,
      checkOutDate: '2026-09-30',
      dates: [checkInDate],
      guestCount: 2,
    }],
    bookings: [],
    directBookings: [],
    icalFeeds: [],
    exportUrl: '',
  };
}

/** A promise this test decides when to settle. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('loading every property calendar', () => {
  it('hands over each property as it lands, not once they all have', async () => {
    // The server refreshes an iCal feed before answering, so one property
    // routinely takes seconds longer than another. Awaiting them as a set is
    // what left the screen blank until the slowest one was in.
    const slow = deferred<PropertyCalendar>();
    getPropertyCalendar.mockImplementation(async (id) => (
      id === 'fast' ? calendar('fast', '2026-09-02') : slow.promise
    ));

    const seen: string[] = [];
    const pending = loadCalendars(['fast', 'slow'], (id) => { seen.push(id); });

    await vi.waitFor(() => expect(seen).toEqual(['fast']));

    slow.resolve(calendar('slow', '2026-09-04'));
    const result = await pending;

    expect(seen).toEqual(['fast', 'slow']);
    expect([...result.calendars.keys()].sort()).toEqual(['fast', 'slow']);
    expect(result.failedPropertyIds).toEqual([]);
  });

  it('reports the property that failed and keeps the ones that did not', async () => {
    getPropertyCalendar.mockImplementation(async (id) => {
      if (id === 'broken') throw new Error('feed is down');
      return calendar(id, '2026-09-02');
    });

    const seen: string[] = [];
    const result = await loadCalendars(['ok', 'broken'], (id) => { seen.push(id); });

    // A failure must never be announced as data: nothing was delivered for it.
    expect(seen).toEqual(['ok']);
    expect([...result.calendars.keys()]).toEqual(['ok']);
    expect(result.failedPropertyIds).toEqual(['broken']);
  });

  it('gives loadStays the stays of the property that just answered, and only those', async () => {
    getPropertyCalendar.mockImplementation(async (id) => calendar(id, id === 'a' ? '2026-09-02' : '2026-09-04'));

    const delivered = new Map<string, string[]>();
    const result = await loadStays(['a', 'b'], (id, own) => {
      delivered.set(id, own.map((stay) => stay.checkInDate));
    });

    // The screen merges on property id, so a batch carrying another
    // property's stays would double them up or drop them.
    expect(delivered.get('a')).toEqual(['2026-09-02']);
    expect(delivered.get('b')).toEqual(['2026-09-04']);
    expect(result.stays).toHaveLength(2);
  });
});
