import { describe, expect, it } from 'vitest';
import {
  calculateRefund,
  canTransition,
  daysBetweenDates,
  getStayDates,
  isIsoDateString,
  resolveFreeCancellationDays,
  toJstDateString,
  toJstHour,
  validateBookingWindow,
} from '../../src/domain/booking.js';
import { Booking, PropertyData } from '../../src/store/types.js';

// An instant expressed as UTC, so the JST expectations below are unambiguous.
function utc(iso: string): number {
  return Date.parse(iso);
}

const enabledProperty: Pick<PropertyData, 'directBooking'> = {
  directBooking: { enabled: true },
};

describe('getStayDates', () => {
  it('lists every night and excludes the check-out date', () => {
    expect(getStayDates('2026-08-01', '2026-08-04')).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
  });

  it('returns a single night for a one-night stay', () => {
    expect(getStayDates('2026-08-01', '2026-08-02')).toEqual(['2026-08-01']);
  });

  it('spans month and year boundaries', () => {
    expect(getStayDates('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
  });

  it('rejects a check-out that is not after check-in', () => {
    expect(() => getStayDates('2026-08-02', '2026-08-02')).toThrow();
    expect(() => getStayDates('2026-08-03', '2026-08-02')).toThrow();
  });

  it('rejects malformed and impossible dates', () => {
    expect(() => getStayDates('2026-8-1', '2026-08-04')).toThrow();
    expect(() => getStayDates('2026-02-30', '2026-03-02')).toThrow();
  });
});

describe('isIsoDateString', () => {
  it('accepts real calendar dates only', () => {
    expect(isIsoDateString('2026-02-28')).toBe(true);
    expect(isIsoDateString('2024-02-29')).toBe(true);   // leap year
    expect(isIsoDateString('2026-02-29')).toBe(false);  // not a leap year
    expect(isIsoDateString('2026-13-01')).toBe(false);
    expect(isIsoDateString(20260101)).toBe(false);
  });
});

describe('Tokyo time helpers', () => {
  it('rolls the date forward for instants that are still "yesterday" in UTC', () => {
    // 23:00 UTC is already 08:00 the next morning in Tokyo.
    expect(toJstDateString(utc('2026-08-01T23:00:00Z'))).toBe('2026-08-02');
    expect(toJstHour(utc('2026-08-01T23:00:00Z'))).toBe(8);
  });

  it('keeps the same date for mid-day UTC instants', () => {
    expect(toJstDateString(utc('2026-08-01T09:00:00Z'))).toBe('2026-08-01');
    expect(toJstHour(utc('2026-08-01T09:00:00Z'))).toBe(18);
  });
});

describe('daysBetweenDates', () => {
  it('counts whole days across a DST-free span', () => {
    expect(daysBetweenDates('2026-08-01', '2026-08-08')).toBe(7);
    expect(daysBetweenDates('2026-08-08', '2026-08-01')).toBe(-7);
    expect(daysBetweenDates('2026-08-01', '2026-08-01')).toBe(0);
  });
});

describe('canTransition', () => {
  it('allows the payment outcomes from a hold', () => {
    expect(canTransition('pending_payment', 'confirmed')).toBe(true);
    expect(canTransition('pending_payment', 'expired')).toBe(true);
    expect(canTransition('pending_payment', 'payment_failed')).toBe(true);
  });

  it('allows cancelling a confirmed booking', () => {
    expect(canTransition('confirmed', 'cancelled_by_guest')).toBe(true);
    expect(canTransition('confirmed', 'cancelled_by_host')).toBe(true);
  });

  it('refuses to resurrect a released hold', () => {
    // A webhook arriving after the sweeper ran must not re-take the nights.
    expect(canTransition('expired', 'confirmed')).toBe(false);
    expect(canTransition('payment_failed', 'confirmed')).toBe(false);
    expect(canTransition('cancelled_by_guest', 'confirmed')).toBe(false);
  });

  it('refuses to move a confirmed booking back to a hold', () => {
    expect(canTransition('confirmed', 'pending_payment')).toBe(false);
    expect(canTransition('confirmed', 'expired')).toBe(false);
  });
});

describe('validateBookingWindow', () => {
  const now = utc('2026-08-01T01:00:00Z'); // 10:00 JST on 2026-08-01

  it('accepts a normal future stay', () => {
    const result = validateBookingWindow(enabledProperty, '2026-08-10', '2026-08-13', now);
    expect(result).toEqual({ ok: true, nights: 3 });
  });

  it('rejects a check-in already in the past', () => {
    const result = validateBookingWindow(enabledProperty, '2026-07-31', '2026-08-02', now);
    expect(result).toEqual({ ok: false, error: 'Check-in date is in the past.' });
  });

  it('allows same-day arrival before the cut-off and blocks it after', () => {
    // Default cut-off is 12:00 JST; `now` is 10:00 JST.
    expect(validateBookingWindow(enabledProperty, '2026-08-01', '2026-08-02', now).ok).toBe(true);

    const afterCutoff = utc('2026-08-01T04:00:00Z'); // 13:00 JST
    const result = validateBookingWindow(enabledProperty, '2026-08-01', '2026-08-02', afterCutoff);
    expect(result).toEqual({ ok: false, error: 'Same-day bookings close at 12:00 JST.' });
  });

  it('honours a custom same-day cut-off', () => {
    const property = { directBooking: { enabled: true, sameDayCutoffHour: 18 } };
    const at13Jst = utc('2026-08-01T04:00:00Z');
    expect(validateBookingWindow(property, '2026-08-01', '2026-08-02', at13Jst).ok).toBe(true);
  });

  it('enforces the minimum stay', () => {
    const property = { directBooking: { enabled: true, minNights: 3 } };
    const result = validateBookingWindow(property, '2026-08-10', '2026-08-12', now);
    expect(result).toEqual({ ok: false, error: 'Minimum stay is 3 night(s).' });
    expect(validateBookingWindow(property, '2026-08-10', '2026-08-13', now).ok).toBe(true);
  });

  it('enforces how far ahead the calendar is open', () => {
    const property = { directBooking: { enabled: true, maxAdvanceDays: 30 } };
    // 2026-08-31 is exactly 30 days out and still allowed.
    expect(validateBookingWindow(property, '2026-08-31', '2026-09-02', now).ok).toBe(true);
    const result = validateBookingWindow(property, '2026-09-01', '2026-09-03', now);
    expect(result).toEqual({ ok: false, error: 'Bookings open at most 30 days ahead.' });
  });

  it('rejects an inverted date range', () => {
    const result = validateBookingWindow(enabledProperty, '2026-08-12', '2026-08-10', now);
    expect(result).toEqual({ ok: false, error: 'Check-out must be after check-in.' });
  });
});

describe('calculateRefund', () => {
  function confirmedBooking(overrides: Partial<Booking> = {}): Pick<
    Booking,
    'status' | 'amountTotal' | 'stripeFeeAmount' | 'checkInDate' | 'refundAmount'
  > {
    return {
      status: 'confirmed',
      amountTotal: 30000,
      stripeFeeAmount: 1080, // 3.6% of 30000
      checkInDate: '2026-08-10',
      refundAmount: 0,
      ...overrides,
    };
  }

  it('refunds the amount minus the Stripe fee at exactly 7 days out', () => {
    const now = utc('2026-08-02T15:00:00Z'); // 2026-08-03 JST -> 7 days before check-in
    const result = calculateRefund(confirmedBooking(), now);
    expect(result).toEqual({ refundAmount: 28920, daysUntilCheckIn: 7, reason: 'free_cancellation' });
  });

  it('refunds at 8 days out', () => {
    const now = utc('2026-08-02T00:00:00Z'); // 2026-08-02 JST
    expect(calculateRefund(confirmedBooking(), now)).toMatchObject({
      refundAmount: 28920,
      daysUntilCheckIn: 8,
      reason: 'free_cancellation',
    });
  });

  it('refunds nothing at 6 days out', () => {
    const now = utc('2026-08-04T00:00:00Z'); // 2026-08-04 JST
    expect(calculateRefund(confirmedBooking(), now)).toEqual({
      refundAmount: 0,
      daysUntilCheckIn: 6,
      reason: 'too_late',
    });
  });

  it('uses the Tokyo date, not the server date, at the boundary', () => {
    // 2026-08-02T16:00Z is still 2026-08-02 in UTC but already 2026-08-03 in
    // Tokyo, which is what moves this from 8 days out to 7.
    expect(calculateRefund(confirmedBooking(), utc('2026-08-02T16:00:00Z')).daysUntilCheckIn).toBe(7);
    expect(calculateRefund(confirmedBooking(), utc('2026-08-02T14:00:00Z')).daysUntilCheckIn).toBe(8);
  });

  it('refunds the full amount when the host cancels, even inside 7 days', () => {
    const now = utc('2026-08-09T00:00:00Z');
    expect(calculateRefund(confirmedBooking(), now, { byHost: true })).toMatchObject({
      refundAmount: 30000,
      reason: 'host_cancellation',
    });
  });

  it('never refunds a booking that was not confirmed', () => {
    const now = utc('2026-08-01T00:00:00Z');
    expect(calculateRefund(confirmedBooking({ status: 'pending_payment' }), now).refundAmount).toBe(0);
    expect(calculateRefund(confirmedBooking({ status: 'expired' }), now).refundAmount).toBe(0);
  });

  it('does not refund twice', () => {
    const now = utc('2026-08-01T00:00:00Z');
    const alreadyRefunded = confirmedBooking({ refundAmount: 30000 });
    expect(calculateRefund(alreadyRefunded, now)).toMatchObject({
      refundAmount: 0,
      reason: 'nothing_to_refund',
    });
  });

  it('never returns a negative refund when the fee exceeds what is left', () => {
    const now = utc('2026-08-01T00:00:00Z');
    const booking = confirmedBooking({ amountTotal: 1000, stripeFeeAmount: 1500 });
    expect(calculateRefund(booking, now).refundAmount).toBe(0);
  });

  it('honours a property-specific free-cancellation window instead of the 7-day default', () => {
    // 5 days out: refundable under a 3-day policy, not under the 7-day default.
    const now = utc('2026-08-05T00:00:00Z');
    const booking = confirmedBooking();
    expect(calculateRefund(booking, now)).toMatchObject({ refundAmount: 0, reason: 'too_late' });
    expect(calculateRefund(booking, now, { freeCancellationDays: 3 })).toMatchObject({
      refundAmount: 28920,
      reason: 'free_cancellation',
    });
  });

  it('a 0-day policy only blocks a refund once check-in has actually passed', () => {
    const dayOfCheckIn = utc('2026-08-10T00:00:00Z');
    expect(calculateRefund(confirmedBooking(), dayOfCheckIn, { freeCancellationDays: 0 })).toMatchObject({
      refundAmount: 28920,
      reason: 'free_cancellation',
    });
  });
});

describe('resolveFreeCancellationDays', () => {
  it('defaults to 7 when the property has not set one', () => {
    expect(resolveFreeCancellationDays(enabledProperty)).toBe(7);
  });

  it('uses the property-specific value when set', () => {
    const property = { directBooking: { enabled: true, freeCancellationDays: 14 } };
    expect(resolveFreeCancellationDays(property)).toBe(14);
  });

  it('falls back to the default for a nonsensical stored value', () => {
    const property = { directBooking: { enabled: true, freeCancellationDays: -3 } };
    expect(resolveFreeCancellationDays(property)).toBe(7);
  });
});
