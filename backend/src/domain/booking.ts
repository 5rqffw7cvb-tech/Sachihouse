import { randomBytes } from 'node:crypto';
import { Booking, BookingStatus, PropertyData } from '../store/types.js';

// Japan observes no daylight saving, so a fixed offset is exact and saves
// pulling in a timezone database. Every guest-facing date rule (is the stay in
// the past? how many days until check-in?) is evaluated in this zone, never in
// whatever zone the server happens to run in.
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_MIN_NIGHTS = 1;
export const DEFAULT_MAX_ADVANCE_DAYS = 365;
export const DEFAULT_SAME_DAY_CUTOFF_HOUR = 12;

// Guests may cancel up to this many days before check-in for a refund.
export const FREE_CANCELLATION_DAYS = 7;

export function generateBookingId(): string {
  return `BK-${randomBytes(6).toString('hex')}`;
}

export function generateGuestToken(): string {
  return randomBytes(32).toString('hex');
}

// The calendar date in Tokyo at the given instant, as YYYY-MM-DD.
export function toJstDateString(timestamp: number): string {
  return new Date(timestamp + JST_OFFSET_MS).toISOString().slice(0, 10);
}

// The hour of day (0-23) in Tokyo at the given instant.
export function toJstHour(timestamp: number): number {
  return new Date(timestamp + JST_OFFSET_MS).getUTCHours();
}

export function isIsoDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  // Rejects impossible calendar dates like 2026-02-30, which Date.parse accepts
  // in some engines by rolling over into the next month.
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

// Whole days from one calendar date to another. Both are treated as plain
// dates, so the result is unaffected by clock time or offsets.
export function daysBetweenDates(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

// Every night of the stay. Check-out is exclusive: the guest leaves that
// morning, so that date stays bookable by the next guest.
export function getStayDates(checkIn: string, checkOut: string): string[] {
  if (!isIsoDateString(checkIn) || !isIsoDateString(checkOut)) {
    throw new Error('Invalid check-in/check-out dates.');
  }
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (!(start < end)) {
    throw new Error('Invalid check-in/check-out dates.');
  }

  const dates: string[] = [];
  for (let cursor = start; cursor < end; cursor += DAY_MS) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

// Allowed status moves. Anything absent here is rejected, so a late webhook can
// never resurrect a hold the sweeper already released.
const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending_payment: ['confirmed', 'expired', 'payment_failed', 'cancelled_by_guest'],
  confirmed: ['cancelled_by_guest', 'cancelled_by_host'],
  expired: [],
  payment_failed: [],
  cancelled_by_guest: [],
  cancelled_by_host: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export type BookingWindowResult = { ok: true; nights: number } | { ok: false; error: string };

// Enforces the per-property booking window: minimum stay, how far ahead we sell,
// and the cut-off after which same-day arrivals are no longer accepted.
export function validateBookingWindow(
  property: Pick<PropertyData, 'directBooking'>,
  checkIn: string,
  checkOut: string,
  now: number,
): BookingWindowResult {
  let stayDates: string[];
  try {
    stayDates = getStayDates(checkIn, checkOut);
  } catch {
    return { ok: false, error: 'Check-out must be after check-in.' };
  }

  const config = property.directBooking ?? { enabled: false };
  const minNights = config.minNights ?? DEFAULT_MIN_NIGHTS;
  const maxAdvanceDays = config.maxAdvanceDays ?? DEFAULT_MAX_ADVANCE_DAYS;
  const cutoffHour = config.sameDayCutoffHour ?? DEFAULT_SAME_DAY_CUTOFF_HOUR;

  const today = toJstDateString(now);
  const daysUntilCheckIn = daysBetweenDates(today, checkIn);

  if (daysUntilCheckIn < 0) {
    return { ok: false, error: 'Check-in date is in the past.' };
  }
  if (daysUntilCheckIn === 0 && toJstHour(now) >= cutoffHour) {
    return { ok: false, error: `Same-day bookings close at ${String(cutoffHour).padStart(2, '0')}:00 JST.` };
  }
  if (daysUntilCheckIn > maxAdvanceDays) {
    return { ok: false, error: `Bookings open at most ${maxAdvanceDays} days ahead.` };
  }
  if (stayDates.length < minNights) {
    return { ok: false, error: `Minimum stay is ${minNights} night(s).` };
  }

  return { ok: true, nights: stayDates.length };
}

export interface RefundOutcome {
  refundAmount: number;
  // Whole days from today (JST) to the check-in date; negative once the stay started.
  daysUntilCheckIn: number;
  reason: 'free_cancellation' | 'host_cancellation' | 'too_late' | 'nothing_to_refund';
}

// Refund rules:
//   - guest cancels N+ days out  → full amount minus the Stripe processing fee,
//     which Stripe keeps even on a refund (disclosed in the cancellation policy);
//   - guest cancels inside N days → nothing;
//   - host cancels                → full amount, we absorb the fee ourselves.
// N defaults to FREE_CANCELLATION_DAYS but each property can set its own via
// directBooking.freeCancellationDays.
export function calculateRefund(
  booking: Pick<Booking, 'status' | 'amountTotal' | 'stripeFeeAmount' | 'checkInDate' | 'refundAmount'>,
  now: number,
  options: { byHost?: boolean; freeCancellationDays?: number } = {},
): RefundOutcome {
  const freeCancellationDays = Number.isFinite(options.freeCancellationDays) && options.freeCancellationDays! >= 0
    ? options.freeCancellationDays!
    : FREE_CANCELLATION_DAYS;
  const daysUntilCheckIn = daysBetweenDates(toJstDateString(now), booking.checkInDate);
  const alreadyRefunded = booking.refundAmount ?? 0;
  const remaining = Math.max(0, booking.amountTotal - alreadyRefunded);

  if (booking.status !== 'confirmed' || remaining === 0) {
    return { refundAmount: 0, daysUntilCheckIn, reason: 'nothing_to_refund' };
  }

  if (options.byHost) {
    return { refundAmount: remaining, daysUntilCheckIn, reason: 'host_cancellation' };
  }

  if (daysUntilCheckIn >= freeCancellationDays) {
    const net = Math.max(0, booking.amountTotal - booking.stripeFeeAmount - alreadyRefunded);
    return { refundAmount: net, daysUntilCheckIn, reason: 'free_cancellation' };
  }

  return { refundAmount: 0, daysUntilCheckIn, reason: 'too_late' };
}

export function resolveFreeCancellationDays(property: Pick<PropertyData, 'directBooking'>): number {
  const configured = property.directBooking?.freeCancellationDays;
  return Number.isFinite(configured) && configured! >= 0 ? configured! : FREE_CANCELLATION_DAYS;
}

export function isDirectBookingEnabled(property: Pick<PropertyData, 'directBooking'>): boolean {
  return property.directBooking?.enabled === true;
}
