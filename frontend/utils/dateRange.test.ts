import { describe, expect, it } from 'vitest';
import { BookingDateSelection, applyDatePick } from './dateRange';

const day = (iso: string): Date => {
  const [year, month, date] = iso.split('-').map(Number);
  return new Date(year, month - 1, date);
};

const empty: BookingDateSelection = { checkIn: null, checkOut: null, selecting: 'checkIn' };

describe('applyDatePick', () => {
  it('sets the check-in and moves on to the check-out', () => {
    const next = applyDatePick(empty, day('2026-09-10'));

    expect(next.checkIn).toEqual(day('2026-09-10'));
    expect(next.checkOut).toBeNull();
    expect(next.selecting).toBe('checkOut');
  });

  it('completes the stay and hands the next click back to check-in', () => {
    const started = applyDatePick(empty, day('2026-09-10'));
    const next = applyDatePick(started, day('2026-09-13'));

    expect(next.checkIn).toEqual(day('2026-09-10'));
    expect(next.checkOut).toEqual(day('2026-09-13'));
    expect(next.selecting).toBe('checkIn');
  });

  it('keeps a check-out that still sits after a newly picked check-in', () => {
    const selection: BookingDateSelection = {
      checkIn: day('2026-09-10'),
      checkOut: day('2026-09-20'),
      selecting: 'checkIn',
    };
    const next = applyDatePick(selection, day('2026-09-12'));

    expect(next.checkIn).toEqual(day('2026-09-12'));
    expect(next.checkOut).toEqual(day('2026-09-20'));
  });

  it('drops a check-out that the new check-in has overtaken', () => {
    const selection: BookingDateSelection = {
      checkIn: day('2026-09-10'),
      checkOut: day('2026-09-12'),
      selecting: 'checkIn',
    };
    const next = applyDatePick(selection, day('2026-09-15'));

    expect(next.checkIn).toEqual(day('2026-09-15'));
    expect(next.checkOut).toBeNull();
    expect(next.selecting).toBe('checkOut');
  });

  it('drops a check-out landing on the new check-in — a stay is at least a night', () => {
    const selection: BookingDateSelection = {
      checkIn: day('2026-09-10'),
      checkOut: day('2026-09-12'),
      selecting: 'checkIn',
    };
    const next = applyDatePick(selection, day('2026-09-12'));

    expect(next.checkOut).toBeNull();
  });

  it('restarts the range when a check-out is picked before the check-in', () => {
    const selection: BookingDateSelection = {
      checkIn: day('2026-09-10'),
      checkOut: null,
      selecting: 'checkOut',
    };
    const next = applyDatePick(selection, day('2026-09-05'));

    expect(next.checkIn).toEqual(day('2026-09-05'));
    expect(next.checkOut).toBeNull();
    expect(next.selecting).toBe('checkOut');
  });

  it('treats a check-out on the check-in itself as starting over', () => {
    const selection: BookingDateSelection = {
      checkIn: day('2026-09-10'),
      checkOut: null,
      selecting: 'checkOut',
    };
    const next = applyDatePick(selection, day('2026-09-10'));

    expect(next.checkIn).toEqual(day('2026-09-10'));
    expect(next.checkOut).toBeNull();
    expect(next.selecting).toBe('checkOut');
  });

  it('handles a check-out click with no check-in at all', () => {
    const next = applyDatePick({ ...empty, selecting: 'checkOut' }, day('2026-09-10'));

    expect(next.checkIn).toEqual(day('2026-09-10'));
    expect(next.checkOut).toBeNull();
    expect(next.selecting).toBe('checkOut');
  });

  it('never mutates the selection it was given', () => {
    const selection: BookingDateSelection = {
      checkIn: day('2026-09-10'),
      checkOut: day('2026-09-12'),
      selecting: 'checkIn',
    };
    const snapshot = { ...selection };
    applyDatePick(selection, day('2026-09-15'));

    expect(selection).toEqual(snapshot);
  });
});
