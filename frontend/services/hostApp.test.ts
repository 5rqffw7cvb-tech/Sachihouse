import { describe, expect, it } from 'vitest';
import {
  arrivalsBetween,
  arrivalsOn,
  departuresOn,
  HostStay,
  stayingOn,
  toIsoDate,
} from './hostApp';

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
