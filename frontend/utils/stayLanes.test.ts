import { describe, expect, it } from 'vitest';
import { assignLanes, nightRange, nightsOverlap } from './stayLanes';

interface Stay {
  name: string;
  checkInDate: string;
  checkOutDate: string;
}

const stay = (name: string, checkInDate: string, checkOutDate: string): Stay => ({
  name, checkInDate, checkOutDate,
});

const rangeOf = (s: Stay) => nightRange(s.checkInDate, s.checkOutDate);

/** Lane per stay name, which is what the calendars actually read. */
const lanes = (stays: Stay[]): Record<string, number> => {
  const layout = assignLanes(stays, rangeOf);
  return Object.fromEntries(layout.laned.map(({ item, lane }) => [item.name, lane]));
};

describe('nights a stay occupies', () => {
  it('ends the night before check-out, because the room is free that morning', () => {
    expect(nightRange('2026-09-17', '2026-09-20')).toEqual({
      firstNight: '2026-09-17',
      lastNight: '2026-09-19',
    });
  });

  it('gives a one-night stay a single night', () => {
    expect(nightRange('2026-09-17', '2026-09-18')).toEqual({
      firstNight: '2026-09-17',
      lastNight: '2026-09-17',
    });
  });

  it('crosses a month boundary', () => {
    expect(nightRange('2026-08-31', '2026-09-01')).toEqual({
      firstNight: '2026-08-31',
      lastNight: '2026-08-31',
    });
  });

  it('reports no nights for a stay that ends on or before it starts', () => {
    expect(nightRange('2026-09-17', '2026-09-17')).toBeNull();
    expect(nightRange('2026-09-20', '2026-09-17')).toBeNull();
  });

  it('reports no nights for unparseable dates', () => {
    expect(nightRange('', '2026-09-17')).toBeNull();
    expect(nightRange('not-a-date', 'also-not')).toBeNull();
  });
});

describe('night overlap', () => {
  it('is false for a same-day turnover', () => {
    const out = nightRange('2026-09-17', '2026-09-19')!;
    const inn = nightRange('2026-09-19', '2026-09-22')!;
    expect(nightsOverlap(out, inn)).toBe(false);
  });

  it('is true when one night is shared', () => {
    const a = nightRange('2026-09-17', '2026-09-20')!;
    const b = nightRange('2026-09-19', '2026-09-22')!;
    expect(nightsOverlap(a, b)).toBe(true);
  });
});

describe('lane assignment', () => {
  it('puts a lone stay in lane 0', () => {
    const layout = assignLanes([stay('A', '2026-09-17', '2026-09-20')], rangeOf);
    expect(layout.laneCount).toBe(1);
    expect(layout.laned[0].lane).toBe(0);
  });

  it('reports one lane for an empty calendar, so a row still has height', () => {
    expect(assignLanes([], rangeOf).laneCount).toBe(1);
  });

  it('splits the two groups sharing a house', () => {
    // The case this exists for: 17-20 and 19-22 share the nights of 19.
    const layout = assignLanes(
      [stay('group1', '2026-09-17', '2026-09-20'), stay('group2', '2026-09-19', '2026-09-22')],
      rangeOf,
    );
    expect(layout.laneCount).toBe(2);
    expect(lanes([stay('group1', '2026-09-17', '2026-09-20'), stay('group2', '2026-09-19', '2026-09-22')]))
      .toEqual({ group1: 0, group2: 1 });
  });

  it('keeps a same-day turnover in one lane', () => {
    // Regression guard: counting days rather than nights would split these and
    // cost the calendars their compact turnover cell.
    const layout = assignLanes(
      [stay('leaving', '2026-09-17', '2026-09-19'), stay('arriving', '2026-09-19', '2026-09-22')],
      rangeOf,
    );
    expect(layout.laneCount).toBe(1);
    expect(lanes([stay('leaving', '2026-09-17', '2026-09-19'), stay('arriving', '2026-09-19', '2026-09-22')]))
      .toEqual({ leaving: 0, arriving: 0 });
  });

  it('reuses a lane once its occupant has left', () => {
    expect(lanes([
      stay('a', '2026-09-01', '2026-09-05'),
      stay('b', '2026-09-03', '2026-09-08'),
      stay('c', '2026-09-10', '2026-09-12'),
    ])).toEqual({ a: 0, b: 1, c: 0 });
  });

  it('opens a third lane only for three genuinely concurrent parties', () => {
    const layout = assignLanes([
      stay('a', '2026-09-01', '2026-09-10'),
      stay('b', '2026-09-02', '2026-09-09'),
      stay('c', '2026-09-03', '2026-09-08'),
    ], rangeOf);
    expect(layout.laneCount).toBe(3);
  });

  it('uses no more lanes than the busiest night needs', () => {
    // Four stays, but never more than two at once.
    const layout = assignLanes([
      stay('a', '2026-09-01', '2026-09-04'),
      stay('b', '2026-09-02', '2026-09-06'),
      stay('c', '2026-09-05', '2026-09-08'),
      stay('d', '2026-09-07', '2026-09-10'),
    ], rangeOf);
    expect(layout.laneCount).toBe(2);
  });

  it('assigns the same lanes however the input is ordered', () => {
    const forward = lanes([
      stay('a', '2026-09-01', '2026-09-05'),
      stay('b', '2026-09-03', '2026-09-08'),
    ]);
    const backward = lanes([
      stay('b', '2026-09-03', '2026-09-08'),
      stay('a', '2026-09-01', '2026-09-05'),
    ]);
    expect(forward).toEqual(backward);
  });

  it('returns items in the caller\'s order, not sorted', () => {
    const layout = assignLanes(
      [stay('late', '2026-09-20', '2026-09-22'), stay('early', '2026-09-01', '2026-09-03')],
      rangeOf,
    );
    expect(layout.laned.map(({ item }) => item.name)).toEqual(['late', 'early']);
  });

  it('parks a stay with no nights in lane 0 without reserving a lane for it', () => {
    const layout = assignLanes(
      [stay('broken', '2026-09-17', '2026-09-17'), stay('real', '2026-09-17', '2026-09-20')],
      rangeOf,
    );
    expect(layout.laneCount).toBe(1);
    expect(layout.laned.find(({ item }) => item.name === 'broken')!.lane).toBe(0);
    expect(layout.laned.find(({ item }) => item.name === 'real')!.lane).toBe(0);
  });
});
