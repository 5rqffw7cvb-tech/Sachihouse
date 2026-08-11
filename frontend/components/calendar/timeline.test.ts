import { describe, expect, it } from 'vitest';
import { buildSegments, Night } from './timeline';

const days = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'];
const nights = (entries: [string, Night][]) => new Map(entries);

describe('buildSegments', () => {
  it('covers the whole range with free nights when nothing is booked', () => {
    const [only, ...rest] = buildSegments(days, nights([]));
    expect(rest).toHaveLength(0);
    expect(only).toMatchObject({ kind: 'free', start: 0, span: 5 });
  });

  it('joins consecutive nights of the same stay into one bar', () => {
    const stay: Night = { kind: 'booking', label: 'Tanaka', ref: 'b1' };
    const segments = buildSegments(days, nights([
      ['2026-08-11', stay],
      ['2026-08-12', stay],
      ['2026-08-13', stay],
    ]));
    const booking = segments.find((s) => s.kind === 'booking');
    expect(booking).toMatchObject({ start: 1, span: 3, label: 'Tanaka' });
  });

  it('keeps back-to-back stays separate even with no gap between them', () => {
    // The case a naive "is this night occupied?" check gets wrong: one guest
    // leaves the morning the next arrives, and the two would merge into a
    // single bar under the wrong name.
    const segments = buildSegments(days, nights([
      ['2026-08-10', { kind: 'booking', label: 'Tanaka', ref: 'b1' }],
      ['2026-08-11', { kind: 'booking', label: 'Tanaka', ref: 'b1' }],
      ['2026-08-12', { kind: 'booking', label: 'Smith', ref: 'b2' }],
      ['2026-08-13', { kind: 'booking', label: 'Smith', ref: 'b2' }],
    ]));
    const bookings = segments.filter((s) => s.kind === 'booking');
    expect(bookings).toHaveLength(2);
    expect(bookings[0]).toMatchObject({ label: 'Tanaka', start: 0, span: 2 });
    expect(bookings[1]).toMatchObject({ label: 'Smith', start: 2, span: 2 });
  });

  it('does not merge different kinds that happen to share a label', () => {
    const segments = buildSegments(days, nights([
      ['2026-08-10', { kind: 'booking', label: 'Tanaka', ref: 'b1' }],
      ['2026-08-11', { kind: 'hold', label: 'Tanaka', ref: 'b1' }],
    ]));
    expect(segments.filter((s) => s.kind !== 'free')).toHaveLength(2);
  });

  it('leaves free gaps between stays intact', () => {
    const segments = buildSegments(days, nights([
      ['2026-08-10', { kind: 'manual' }],
      ['2026-08-13', { kind: 'manual' }],
    ]));
    expect(segments.map((s) => [s.kind, s.start, s.span])).toEqual([
      ['manual', 0, 1],
      ['free', 1, 2],
      ['manual', 3, 1],
      ['free', 4, 1],
    ]);
  });

  it('spans the full range for a stay covering every day', () => {
    const stay: Night = { kind: 'imported', label: 'Airbnb', ref: 'e1' };
    const segments = buildSegments(days, nights(days.map((d) => [d, stay] as [string, Night])));
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ start: 0, span: 5, label: 'Airbnb' });
  });

  it('returns nothing for an empty range', () => {
    expect(buildSegments([], nights([]))).toEqual([]);
  });
});
