import { describe, expect, it } from 'vitest';
import { collapseDateRuns } from './timeline';

describe('collapsing loose blocked dates into runs', () => {
  it('returns nothing for no dates', () => {
    expect(collapseDateRuns([])).toEqual([]);
  });

  it('keeps a single date as a one-night run', () => {
    expect(collapseDateRuns(['2026-09-17'])).toEqual([
      { firstNight: '2026-09-17', lastNight: '2026-09-17' },
    ]);
  });

  it('joins consecutive dates into one run', () => {
    expect(collapseDateRuns(['2026-09-17', '2026-09-18', '2026-09-19'])).toEqual([
      { firstNight: '2026-09-17', lastNight: '2026-09-19' },
    ]);
  });

  it('breaks the run on a gap', () => {
    expect(collapseDateRuns(['2026-09-17', '2026-09-18', '2026-09-20'])).toEqual([
      { firstNight: '2026-09-17', lastNight: '2026-09-18' },
      { firstNight: '2026-09-20', lastNight: '2026-09-20' },
    ]);
  });

  it('sorts before collapsing, so feed order does not fragment a run', () => {
    expect(collapseDateRuns(['2026-09-19', '2026-09-17', '2026-09-18'])).toEqual([
      { firstNight: '2026-09-17', lastNight: '2026-09-19' },
    ]);
  });

  it('ignores duplicates', () => {
    expect(collapseDateRuns(['2026-09-17', '2026-09-17', '2026-09-18'])).toEqual([
      { firstNight: '2026-09-17', lastNight: '2026-09-18' },
    ]);
  });

  it('joins across a month boundary', () => {
    expect(collapseDateRuns(['2026-08-30', '2026-08-31', '2026-09-01'])).toEqual([
      { firstNight: '2026-08-30', lastNight: '2026-09-01' },
    ]);
  });

  it('joins across a leap day', () => {
    expect(collapseDateRuns(['2028-02-28', '2028-02-29', '2028-03-01'])).toEqual([
      { firstNight: '2028-02-28', lastNight: '2028-03-01' },
    ]);
  });

  it('drops empty strings rather than starting a run from one', () => {
    expect(collapseDateRuns(['', '2026-09-17'])).toEqual([
      { firstNight: '2026-09-17', lastNight: '2026-09-17' },
    ]);
  });
});
