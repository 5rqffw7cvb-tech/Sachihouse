import type { HostStay } from '../services/hostApp';

/**
 * What one cleaning job pays out.
 *
 * The rules are simple and live in one place so the sheet and its test agree:
 *  - a whole-house clean is a flat fee, 8,000 yen unless overridden;
 *  - a co-host also earns a share of what the guest paid for that stay,
 *    3% unless the host types another rate;
 *  - a bonus is whatever the host types in;
 *  - supplies bought for the house are reimbursed at cost.
 *
 * Inputs are the raw strings from the form fields, so a half-typed or empty
 * field counts as zero instead of turning the total into NaN.
 */

export const DEFAULT_CLEANING_FEE = 8000;
/** Percent, as typed in the form. */
export const DEFAULT_CO_HOST_PERCENT = 3;

export interface CleaningPayDraft {
  cleaningFee: string;
  isCoHost: boolean;
  coHostPercent: string;
  guestPayment: string;
  bonus: string;
  supplies: string;
}

export interface CleaningPayBreakdown {
  cleaningFee: number;
  coHostShare: number;
  bonus: number;
  supplies: number;
  total: number;
}

/** Reads a percentage such as '3', '2.5' or '3%'; empty or junk is zero. */
export function parsePercent(value: string): number {
  const percent = Number(value.replace(/[%％\s]/g, '').replace(',', '.'));
  return Number.isFinite(percent) && percent > 0 ? percent : 0;
}

/** Reads a yen amount typed with or without commas, ¥ or spaces. */
export function parseYen(value: string): number {
  const amount = Number(value.replace(/[¥￥,\s]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
}

export function calculateCleaningPay(draft: CleaningPayDraft): CleaningPayBreakdown {
  const cleaningFee = parseYen(draft.cleaningFee);
  // Rounded once on the share itself, so the breakdown lines add up to the total.
  const coHostShare = draft.isCoHost ? Math.round(parseYen(draft.guestPayment) * parsePercent(draft.coHostPercent) / 100) : 0;
  const bonus = parseYen(draft.bonus);
  const supplies = parseYen(draft.supplies);
  return {
    cleaningFee,
    coHostShare,
    bonus,
    supplies,
    total: cleaningFee + coHostShare + bonus + supplies,
  };
}

export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}

/** Stays the calculator offers: in the house now, or checked out in the last
 *  PAYABLE_PAST_DAYS days. Holds and feed blocks have nobody to clean after. */
export const PAYABLE_PAST_DAYS = 30;

type PayableStay = Pick<
  HostStay,
  'propertyId' | 'propertyName' | 'guestName' | 'channel' | 'checkInDate' | 'checkOutDate' | 'kind' | 'bookingId'
>;

/**
 * Identifies a stay across loads, so a payout recorded today still matches it
 * tomorrow. HostStay.key will not do: for iCal imports it carries the event's
 * position in the feed, which moves whenever the feed adds a reservation.
 */
export function stayRef(stay: PayableStay): string {
  return `${stay.propertyId}:${stay.checkInDate}:${stay.checkOutDate}:${stay.bookingId ?? stay.channel}`;
}

function shiftIsoDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The window's first day: payouts for stays that checked out before it are
 *  not loaded either. */
export function payableFromDate(todayIso: string): string {
  return shiftIsoDate(todayIso, -PAYABLE_PAST_DAYS);
}

/** Newest check-out first, so the stay that just left sits at the top. */
export function payableStays<T extends PayableStay>(stays: T[], todayIso: string): T[] {
  const from = payableFromDate(todayIso);
  return stays
    .filter((stay) => stay.kind === 'booking' || stay.kind === 'imported')
    .filter((stay) => stay.checkInDate <= todayIso && stay.checkOutDate >= from)
    .sort((a, b) => b.checkOutDate.localeCompare(a.checkOutDate)
      || a.propertyName.localeCompare(b.propertyName));
}

/** "10/12–10/15" — the year is obvious inside a 30-day window. */
export function shortDateRange(checkInDate: string, checkOutDate: string): string {
  const short = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
  return `${short(checkInDate)}–${short(checkOutDate)}`;
}

/** Who the stay was, as far as the calendar knows: OTA feeds drop the name. */
export function stayWho(stay: Pick<HostStay, 'guestName' | 'channel'>): string {
  return stay.guestName ? `${stay.guestName} · ${stay.channel}` : stay.channel;
}
