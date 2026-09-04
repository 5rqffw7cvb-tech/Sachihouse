import { describe, expect, it } from 'vitest';
import { BookingDateSelection, applyDatePick, isDayPickable, stayNights } from './dateRange';

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

// The 20th is taken: someone arrives that afternoon and stays four nights.
const taken = new Set(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23']);
const isNightUnavailable = (date: Date): boolean =>
  taken.has(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);

describe('stayNights', () => {
  it('stops the night before check-out', () => {
    expect(stayNights(day('2026-09-18'), day('2026-09-20'))).toEqual([day('2026-09-18'), day('2026-09-19')]);
  });

  it('has no nights when check-out does not follow check-in', () => {
    expect(stayNights(day('2026-09-18'), day('2026-09-18'))).toEqual([]);
    expect(stayNights(day('2026-09-18'), day('2026-09-17'))).toEqual([]);
  });
});

describe('isDayPickable', () => {
  const pickingCheckOut = (checkIn: string): BookingDateSelection => ({
    checkIn: day(checkIn),
    checkOut: null,
    selecting: 'checkOut',
  });

  it('refuses a taken night as a check-in', () => {
    expect(isDayPickable(empty, day('2026-09-20'), isNightUnavailable)).toBe(false);
    expect(isDayPickable(empty, day('2026-09-19'), isNightUnavailable)).toBe(true);
  });

  it('allows checking out on the morning of a taken night', () => {
    // The stay uses the 18th and 19th; the guest is gone before the next
    // arrival on the 20th. This is the case the calendar used to refuse.
    expect(isDayPickable(pickingCheckOut('2026-09-18'), day('2026-09-20'), isNightUnavailable)).toBe(true);
  });

  it('refuses a check-out the stay could only reach through a taken night', () => {
    expect(isDayPickable(pickingCheckOut('2026-09-18'), day('2026-09-21'), isNightUnavailable)).toBe(false);
    expect(isDayPickable(pickingCheckOut('2026-09-18'), day('2026-09-25'), isNightUnavailable)).toBe(false);
  });

  it('allows a check-out on the first free morning after someone else leaves', () => {
    expect(isDayPickable(pickingCheckOut('2026-09-24'), day('2026-09-26'), isNightUnavailable)).toBe(true);
  });

  it('treats a click at or before the check-in as picking a check-in again', () => {
    // applyDatePick restarts the range there, so the check-in rule applies.
    expect(isDayPickable(pickingCheckOut('2026-09-25'), day('2026-09-20'), isNightUnavailable)).toBe(false);
    expect(isDayPickable(pickingCheckOut('2026-09-25'), day('2026-09-25'), isNightUnavailable)).toBe(true);
  });

  it('ignores a time of day carried on the check-in', () => {
    const afternoon = new Date(2026, 8, 18, 15, 0, 0);
    const selection: BookingDateSelection = { checkIn: afternoon, checkOut: null, selecting: 'checkOut' };

    expect(isDayPickable(selection, day('2026-09-19'), isNightUnavailable)).toBe(true);
    expect(isDayPickable(selection, day('2026-09-20'), isNightUnavailable)).toBe(true);
    expect(isDayPickable(selection, day('2026-09-21'), isNightUnavailable)).toBe(false);
  });
});
