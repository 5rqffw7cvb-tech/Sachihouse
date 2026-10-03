import { describe, expect, it } from 'vitest';
import {
  arrivalsBetween,
  arrivalsOn,
  datesInRange,
  departuresOn,
  formatMoney,
  HostCalendarData,
  HostStay,
  mergePendingEvents,
  nightsBetween,
  propertyColor,
  stayingOn,
  stayNights,
  toIsoDate,
} from './hostApp';
import type { PropertyCalendarEvent } from './calendar';

const stay = (over: Partial<HostStay>): HostStay => ({
  key: `${over.propertyName ?? 'p'}-${over.checkInDate ?? '?'}`,
  propertyId: 'p1',
  propertyName: 'Ikebukuro 201',
  guestName: 'Tanaka Yuki',
  channel: 'Airbnb',
  checkInDate: '2026-09-01',
  checkOutDate: '2026-09-05',
  guestCount: 2,
  kind: 'booking',
  bookingId: null,
  amountTotal: null,
  currency: null,
  summary: null,
  description: null,
  feedName: null,
  ...over,
});

const TODAY = '2026-09-06';

describe('toIsoDate', () => {
  it('reads the local calendar date, not the UTC one', () => {
    // 00:30 on the 6th in Asia/Tokyo is still the 5th in UTC. Formatting via
    // toISOString would silently move every stay a day earlier for the only
    // timezone this app runs in.
    expect(toIsoDate(new Date(2026, 8, 6, 0, 30))).toBe('2026-09-06');
    expect(toIsoDate(new Date(2026, 8, 6, 23, 30))).toBe('2026-09-06');
  });
});

describe("the Today screen's three sections", () => {
  const arrivingToday = stay({ checkInDate: TODAY, checkOutDate: '2026-09-09', propertyName: 'A' });
  const arrivingLater = stay({ checkInDate: '2026-09-12', checkOutDate: '2026-09-15', propertyName: 'B' });
  const beyondHorizon = stay({ checkInDate: '2026-10-02', checkOutDate: '2026-10-06', propertyName: 'C' });
  const inTheHouse = stay({ checkInDate: '2026-09-03', checkOutDate: '2026-09-08', propertyName: 'D' });
  const leavingToday = stay({ checkInDate: '2026-09-02', checkOutDate: TODAY, propertyName: 'E' });
  const alreadyGone = stay({ checkInDate: '2026-08-28', checkOutDate: '2026-09-01', propertyName: 'F' });

  const all = [arrivingToday, arrivingLater, beyondHorizon, inTheHouse, leavingToday, alreadyGone];
  const horizon = '2026-09-20';

  it('lists arrivals from today to the horizon, soonest first', () => {
    expect(arrivalsBetween(all, TODAY, horizon).map((s) => s.propertyName)).toEqual(['A', 'B']);
  });

  it('never offers a synced block as an arrival or a departure', () => {
    // A channel manager's "not available" range takes the nights but has no
    // party: the host has nobody to let in and the cleaner nobody to clean
    // after, so it belongs in the house, not in either transition list.
    const block = stay({
      checkInDate: TODAY,
      checkOutDate: '2026-09-09',
      propertyName: 'Z',
      kind: 'imported-block',
      channel: 'Blocked',
      guestName: null,
    });
    const withBlock = [...all, block];

    expect(arrivalsBetween(withBlock, TODAY, horizon).map((s) => s.propertyName)).toEqual(['A', 'B']);
    expect(arrivalsOn(withBlock, TODAY).map((s) => s.propertyName)).toEqual(['A']);
    expect(departuresOn(withBlock, '2026-09-09').map((s) => s.propertyName)).toEqual(['A']);
    // It still has to say the house is occupied on the nights it covers.
    expect(stayingOn(withBlock, '2026-09-07').map((s) => s.propertyName)).toContain('Z');
  });

  it('counts an arrival on the horizon itself as inside the window', () => {
    expect(arrivalsBetween(all, TODAY, '2026-09-12').map((s) => s.propertyName)).toEqual(['A', 'B']);
    expect(arrivalsBetween(all, TODAY, '2026-09-11').map((s) => s.propertyName)).toEqual(['A']);
  });

  it('counts as staying only what is already in the house tonight', () => {
    expect(stayingOn(all, TODAY).map((s) => s.propertyName)).toEqual(['D']);
  });

  it('lists the departures for the day', () => {
    expect(departuresOn(all, TODAY).map((s) => s.propertyName)).toEqual(['E']);
  });

  it('keeps the three sections disjoint, so nobody is listed twice', () => {
    const keys = [
      ...arrivalsBetween(all, TODAY, horizon),
      ...stayingOn(all, TODAY),
      ...departuresOn(all, TODAY),
    ].map((s) => s.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('treats a same-day turnover as one departure and one arrival, never a stay', () => {
    const out = stay({ checkInDate: '2026-09-02', checkOutDate: TODAY, propertyName: 'G' });
    const into = stay({ checkInDate: TODAY, checkOutDate: '2026-09-10', propertyName: 'G' });
    const turnover = [out, into];

    expect(departuresOn(turnover, TODAY)).toHaveLength(1);
    expect(arrivalsOn(turnover, TODAY)).toHaveLength(1);
    expect(stayingOn(turnover, TODAY)).toHaveLength(0);
  });

  it('ignores a one-night stay that ended before today', () => {
    expect(stayingOn([alreadyGone], TODAY)).toHaveLength(0);
    expect(departuresOn([alreadyGone], TODAY)).toHaveLength(0);
  });
});

describe('the booking detail sheet fields', () => {
  it('counts nights, not days: check-out morning is not a night', () => {
    expect(nightsBetween('2026-09-06', '2026-09-09')).toBe(3);
    expect(nightsBetween('2026-09-06', '2026-09-07')).toBe(1);
  });

  it('survives a month boundary and a leap day', () => {
    expect(nightsBetween('2026-09-28', '2026-10-02')).toBe(4);
    expect(nightsBetween('2028-02-27', '2028-03-01')).toBe(3);
  });

  it('refuses to invent a night from a broken or backwards range', () => {
    expect(nightsBetween('2026-09-09', '2026-09-06')).toBe(0);
    expect(nightsBetween('2026-09-06', '2026-09-06')).toBe(0);
    expect(nightsBetween('not-a-date', '2026-09-06')).toBe(0);
  });

  it('writes yen the way the rest of the console does', () => {
    expect(formatMoney(128000, 'JPY')).toBe('¥128,000');
    expect(formatMoney(128000, 'jpy')).toBe('¥128,000');
    // No currency recorded is still yen here — every property is in Japan.
    expect(formatMoney(128000, null)).toBe('¥128,000');
  });

  it('falls back to the code for anything that is not yen', () => {
    expect(formatMoney(1200, 'USD')).toBe('USD 1,200');
  });
});

describe('selecting days on the calendar', () => {
  it('returns an inclusive run of dates', () => {
    expect(datesInRange('2026-09-10', '2026-09-12')).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
  });

  it('treats a single day as a run of one', () => {
    expect(datesInRange('2026-09-10', '2026-09-10')).toEqual(['2026-09-10']);
  });

  it('crosses a month and a year boundary without dropping a day', () => {
    expect(datesInRange('2026-08-30', '2026-09-02')).toEqual([
      '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02',
    ]);
    expect(datesInRange('2026-12-31', '2027-01-01')).toEqual(['2026-12-31', '2027-01-01']);
  });

  it('includes the leap day when the year has one', () => {
    expect(datesInRange('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });

  it('gives back nothing for a backwards or unparsable range', () => {
    expect(datesInRange('2026-09-12', '2026-09-10')).toEqual([]);
    expect(datesInRange('nonsense', '2026-09-10')).toEqual([]);
  });
});

describe('the nights a stay occupies', () => {
  it('excludes the check-out day, which is free again by morning', () => {
    expect(stayNights({ checkInDate: '2026-09-10', checkOutDate: '2026-09-13' }))
      .toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
  });

  it('gives one night for a one-night stay', () => {
    expect(stayNights({ checkInDate: '2026-09-10', checkOutDate: '2026-09-11' })).toEqual(['2026-09-10']);
  });

  it('gives no nights when check-out is not after check-in', () => {
    expect(stayNights({ checkInDate: '2026-09-10', checkOutDate: '2026-09-10' })).toEqual([]);
    expect(stayNights({ checkInDate: '2026-09-11', checkOutDate: '2026-09-10' })).toEqual([]);
  });

  it('agrees with nightsBetween, which the detail sheet prints', () => {
    expect(stayNights({ checkInDate: '2026-09-10', checkOutDate: '2026-09-13' }))
      .toHaveLength(nightsBetween('2026-09-10', '2026-09-13'));
  });
});

describe('property colours', () => {
  it('is stable per position and wraps past the end of the palette', () => {
    expect(propertyColor(0)).toBe(propertyColor(0));
    expect(propertyColor(0)).not.toBe(propertyColor(1));
    expect(propertyColor(5)).toBe(propertyColor(0));
  });
});

describe('mergePendingEvents', () => {
  const event = (over: Partial<PropertyCalendarEvent>): PropertyCalendarEvent => ({
    id: 'e1',
    propertyId: 'p1',
    title: 'Cleaner',
    note: '',
    date: '2026-10-10',
    startTime: '10:00',
    endTime: '11:00',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  });

  const entry = (propertyId: string, events: PropertyCalendarEvent[] = []): HostCalendarData => ({
    propertyId,
    stays: [stay({ propertyId })],
    manualBlockedDates: new Set(['2026-10-20']),
    blockedDates: new Set(['2026-10-20']),
    events,
  });

  it('puts a missing event back and keeps it pending', () => {
    const p1 = entry('p1');
    const calendars = new Map([['p1', p1]]);
    const created = event({ id: 'new' });

    const result = mergePendingEvents(calendars, [created]);

    expect(result.calendars).not.toBe(calendars);
    expect(result.calendars.get('p1')!.events).toEqual([created]);
    expect(result.stillPending).toEqual([created]);
  });

  it('drops an event from pending once a load has brought it back, without doubling it', () => {
    const created = event({ id: 'new' });
    const calendars = new Map([['p1', entry('p1', [created])]]);

    const result = mergePendingEvents(calendars, [created]);

    expect(result.calendars.get('p1')!.events).toHaveLength(1);
    expect(result.stillPending).toEqual([]);
  });

  it('keeps an event pending, and invents no entry, when its property has not loaded', () => {
    const calendars = new Map([['p1', entry('p1')]]);
    const elsewhere = event({ id: 'x', propertyId: 'p2' });

    const result = mergePendingEvents(calendars, [elsewhere]);

    expect(result.calendars.has('p2')).toBe(false);
    expect(result.calendars.get('p1')!.events).toEqual([]);
    expect(result.stillPending).toEqual([elsewhere]);
  });

  it('mutates neither the map nor the entry, and keeps the other fields by reference', () => {
    const existing = event({ id: 'old' });
    const p1 = entry('p1', [existing]);
    const p2 = entry('p2');
    const calendars = new Map([['p1', p1], ['p2', p2]]);
    const pending = [event({ id: 'new' })];

    const result = mergePendingEvents(calendars, pending);

    // Inputs untouched.
    expect(calendars.get('p1')).toBe(p1);
    expect(p1.events).toEqual([existing]);
    expect(pending).toHaveLength(1);
    // The changed entry is a new object sharing the untouched parts.
    const next = result.calendars.get('p1')!;
    expect(next).not.toBe(p1);
    expect(next.events.map((e) => e.id)).toEqual(['old', 'new']);
    expect(next.stays).toBe(p1.stays);
    expect(next.blockedDates).toBe(p1.blockedDates);
    expect(next.manualBlockedDates).toBe(p1.manualBlockedDates);
    // An entry nothing was added to is passed through as is.
    expect(result.calendars.get('p2')).toBe(p2);
  });

  it('hands back the very same map when nothing is inserted', () => {
    const created = event({ id: 'new' });
    const calendars = new Map([['p1', entry('p1', [created])]]);

    expect(mergePendingEvents(calendars, []).calendars).toBe(calendars);
    expect(mergePendingEvents(calendars, [created]).calendars).toBe(calendars);
    expect(mergePendingEvents(calendars, [event({ propertyId: 'p9' })]).calendars).toBe(calendars);
  });

  it('inserts an id listed twice in pending only once', () => {
    const created = event({ id: 'new' });
    const calendars = new Map([['p1', entry('p1')]]);

    const result = mergePendingEvents(calendars, [created, { ...created }]);

    expect(result.calendars.get('p1')!.events).toHaveLength(1);
    expect(result.stillPending).toHaveLength(1);
  });
});
