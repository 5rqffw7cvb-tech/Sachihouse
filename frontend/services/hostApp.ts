import { ApiUser } from './api';
import { getPropertyCalendar, PropertyCalendar } from './calendar';
import { getAllProperties } from './storage';
import { PricingConfig } from '../types';

/**
 * Data layer for the host phone app.
 *
 * The console pages each fetch one property's calendar and render it whole.
 * The phone app asks a different question — "what happens today, across
 * everything I run?" — so this module flattens every source the calendar
 * endpoint returns into one list of stays it can sort by date.
 *
 * Nothing here is a new endpoint: it is the same /properties/:id/calendar the
 * host calendar already uses, one call per property.
 */

export interface HostProperty {
  id: string;
  name: string;
  address: string;
  /** Public slug, when the property has one — the property URL printed on a
   *  booking confirmation is built from it. */
  metalink?: string;
  /** The rate card a quote is computed from. */
  pricing: PricingConfig;
}

/**
 * Colours the calendar draws one property's band in.
 *
 * The same five, in the same order, as the cleaning calendar. A host who uses
 * both should not have to learn that blue means Ikebukuro on one screen and
 * Asakusa on the other.
 */
const PROPERTY_COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed'];

export function propertyColor(index: number): string {
  return PROPERTY_COLORS[index % PROPERTY_COLORS.length];
}

export type StayKind = 'booking' | 'hold' | 'imported';

export interface HostStay {
  /** Stable within one load — used as a React key, never sent anywhere. */
  key: string;
  propertyId: string;
  propertyName: string;
  /** Null for OTA imports, which strip the guest's name from the feed. */
  guestName: string | null;
  /** "Airbnb", "Booking.com", "Direct booking", "Manual", or a feed's own name. */
  channel: string;
  checkInDate: string;
  checkOutDate: string;
  guestCount: number | null;
  kind: StayKind;
  /** The underlying record, where one has an id we could act on later. */
  bookingId: string | null;
  /** Direct bookings only — what the guest paid us, in whole currency units. */
  amountTotal: number | null;
  currency: string | null;
  /** iCal imports only: the feed's own text. Most OTAs strip the guest's name
   *  but leave the reservation code in here, which is the only handle a host
   *  has when they need to look the booking up on the platform itself. */
  summary: string | null;
  description: string | null;
  /** The feed an import arrived on, which is not always the channel it names. */
  feedName: string | null;
}

/** Nights, counted the way the calendar blocks them: check-out morning frees
 *  the room, so it is not a night. */
export function nightsBetween(checkInDate: string, checkOutDate: string): number {
  const start = Date.parse(`${checkInDate}T00:00:00`);
  const end = Date.parse(`${checkOutDate}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

/** Money the way the rest of the app writes it — see HostCalendarPage, which
 *  has printed direct-booking totals as plain yen since before this screen. */
export function formatMoney(amount: number, currency: string | null): string {
  const code = (currency || 'JPY').toUpperCase();
  if (code === 'JPY') return `¥${amount.toLocaleString()}`;
  return `${code} ${amount.toLocaleString()}`;
}

/**
 * Same palette as CleaningCalendarPage, deliberately: a host who uses both the
 * cleaning calendar and this app should not have to learn two colour codes.
 */
const CHANNEL_COLORS: Record<string, string> = {
  Airbnb: '#FF5A5F',
  'Booking.com': '#003580',
  'Hostex Direct': '#0f9d58',
  Manual: '#6b7280',
  'Direct booking': '#0b57d0',
};
const DEFAULT_CHANNEL_COLOR = '#d97706';

export function channelColor(channel: string): string {
  return CHANNEL_COLORS[channel] ?? DEFAULT_CHANNEL_COLOR;
}

/** Local calendar date as YYYY-MM-DD. Never use toISOString here — it shifts
 *  the date backwards for anyone east of UTC, which is everyone in Japan. */
export function toIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

/** The properties this user actually runs — admins see all, hosts see theirs. */
export async function listHostProperties(user: ApiUser | null): Promise<HostProperty[]> {
  if (!user || (user.role !== 'ADMIN' && user.role !== 'HOST')) {
    return [];
  }

  const all = await getAllProperties({ includeArchived: false });
  const visible = user.role === 'ADMIN'
    ? all
    : all.filter((property) => (user.assignedPropertyIds ?? []).includes(property.id));

  // Alphabetical and stable: the calendar gives each property a fixed band row
  // and colour by position, so a list that reordered between loads would move
  // a property's colour under the host mid-glance.
  return visible
    .map((property) => ({
      id: property.id,
      name: property.name,
      address: property.address,
      metalink: property.metalink,
      pricing: property.pricing,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Flattens one property's calendar into stays. Exported for the calendar
 *  screen, which already holds the calendar it fetched. */
export function staysFromCalendar(calendar: PropertyCalendar): HostStay[] {
  const stays: HostStay[] = [];

  calendar.bookings.forEach((booking, index) => {
    stays.push({
      key: `${calendar.propertyId}:manual:${booking.id || index}`,
      propertyId: calendar.propertyId,
      propertyName: calendar.propertyName,
      guestName: booking.guestName || null,
      channel: 'Manual',
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      guestCount: null,
      kind: 'booking',
      bookingId: booking.id || null,
      amountTotal: null,
      currency: null,
      summary: null,
      description: null,
      feedName: null,
    });
  });

  calendar.directBookings.forEach((booking, index) => {
    stays.push({
      key: `${calendar.propertyId}:direct:${booking.id || index}`,
      propertyId: calendar.propertyId,
      propertyName: calendar.propertyName,
      guestName: booking.guestName || null,
      channel: 'Direct booking',
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      guestCount: null,
      // A hold is a night taken off the market that nobody has paid for yet.
      // It still blocks the calendar, so it belongs here — just not as a stay
      // the host should go and clean for.
      kind: booking.status === 'confirmed' ? 'booking' : 'hold',
      bookingId: booking.id || null,
      amountTotal: booking.amountTotal,
      currency: booking.currency,
      summary: null,
      description: null,
      feedName: null,
    });
  });

  calendar.importedEvents.forEach((event, index) => {
    stays.push({
      key: `${calendar.propertyId}:ical:${event.feedId}:${event.checkInDate}:${index}`,
      propertyId: calendar.propertyId,
      propertyName: calendar.propertyName,
      guestName: null,
      channel: event.channelName || event.feedName,
      checkInDate: event.checkInDate,
      checkOutDate: event.checkOutDate,
      guestCount: event.guestCount,
      kind: 'imported',
      bookingId: null,
      amountTotal: null,
      currency: null,
      summary: event.summary || null,
      description: event.description || null,
      feedName: event.feedName || null,
    });
  });

  return stays;
}

/**
 * Every stay across the given properties.
 *
 * One property failing must not blank the whole screen — a single expired iCal
 * feed would otherwise take today's arrivals down with it — so failures are
 * dropped and reported alongside whatever did load.
 */
export async function loadStays(
  propertyIds: string[],
): Promise<{ stays: HostStay[]; failedPropertyIds: string[] }> {
  const results = await Promise.allSettled(propertyIds.map((id) => getPropertyCalendar(id)));

  const stays: HostStay[] = [];
  const failedPropertyIds: string[] = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      stays.push(...staysFromCalendar(result.value));
    } else {
      failedPropertyIds.push(propertyIds[index]);
    }
  });

  return { stays, failedPropertyIds };
}

/** Every night a stay occupies: check-in through the night before check-out. */
export function stayNights(stay: Pick<HostStay, 'checkInDate' | 'checkOutDate'>): string[] {
  return datesInRange(stay.checkInDate, stay.checkOutDate).slice(0, -1);
}

/** Inclusive run of calendar dates. Steps by whole days on local midnights, so
 *  a DST change cannot drop or duplicate one. */
export function datesInRange(fromIso: string, toIso: string): string[] {
  const start = new Date(`${fromIso}T00:00:00`);
  const end = new Date(`${toIso}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];

  const dates: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    dates.push(toIsoDate(cursor));
  }
  return dates;
}

/** One property's calendar, as the calendar screen needs it. */
export interface HostCalendarData {
  propertyId: string;
  stays: HostStay[];
  /** Nights the host blocked by hand. The only ones this app can lift again —
   *  an iCal import belongs to the platform that sent it. */
  manualBlockedDates: Set<string>;
  /** Every unavailable night: manual blocks, imports, and booked nights. What
   *  a quote has to check before it promises a guest anything. */
  blockedDates: Set<string>;
}

function toCalendarData(calendar: PropertyCalendar): HostCalendarData {
  const stays = staysFromCalendar(calendar);
  const manual = new Set(calendar.manualBlockedDates);
  const blocked = new Set<string>([...manual, ...calendar.importedBlockedDates]);
  stays.forEach((stay) => stayNights(stay).forEach((night) => blocked.add(night)));
  return { propertyId: calendar.propertyId, stays, manualBlockedDates: manual, blockedDates: blocked };
}

/**
 * Every property's calendar at once, keyed by id.
 *
 * One property failing must not blank the month — a single expired iCal feed
 * would otherwise take the whole grid down — so failures are reported
 * alongside whatever did load.
 */
export async function loadCalendars(
  propertyIds: string[],
): Promise<{ calendars: Map<string, HostCalendarData>; failedPropertyIds: string[] }> {
  const results = await Promise.allSettled(propertyIds.map((id) => getPropertyCalendar(id)));

  const calendars = new Map<string, HostCalendarData>();
  const failedPropertyIds: string[] = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      calendars.set(propertyIds[index], toCalendarData(result.value));
    } else {
      failedPropertyIds.push(propertyIds[index]);
    }
  });

  return { calendars, failedPropertyIds };
}

export function arrivalsOn(stays: HostStay[], iso: string): HostStay[] {
  return stays
    .filter((stay) => stay.checkInDate === iso)
    .sort((a, b) => a.propertyName.localeCompare(b.propertyName));
}

/**
 * Arrivals still ahead, soonest first — who the host has to let in next.
 *
 * The window is inclusive at both ends, so `fromIso` being today keeps
 * this afternoon's check-in at the top where it belongs.
 */
export function arrivalsBetween(stays: HostStay[], fromIso: string, toIso: string): HostStay[] {
  return stays
    .filter((stay) => stay.checkInDate >= fromIso && stay.checkInDate <= toIso)
    .sort((a, b) => (
      a.checkInDate.localeCompare(b.checkInDate) || a.propertyName.localeCompare(b.propertyName)
    ));
}

/**
 * Stays already under way on `iso`: checked in before it, not yet checked out.
 *
 * Deliberately disjoint from arrivalsBetween and departuresOn. Someone
 * arriving this afternoon is still an arrival, not a guest in the house, and
 * someone leaving this morning is a departure — a guest appearing in two
 * sections at once is the fastest way to make the screen unreadable.
 */
export function stayingOn(stays: HostStay[], iso: string): HostStay[] {
  return stays
    .filter((stay) => stay.checkInDate < iso && stay.checkOutDate > iso)
    .sort((a, b) => a.propertyName.localeCompare(b.propertyName));
}

export function departuresOn(stays: HostStay[], iso: string): HostStay[] {
  return stays
    .filter((stay) => stay.checkOutDate === iso)
    .sort((a, b) => a.propertyName.localeCompare(b.propertyName));
}

/** The check-in link a guest fills in — the same URL the console's link picker
 *  hands out, so a link copied from the phone behaves identically. */
export function buildCheckInUrl(propertyId: string): string {
  return `${window.location.origin}${window.location.pathname}#/${propertyId}/checkin`;
}

/** Clipboard with a fallback: iOS Safari refuses navigator.clipboard outside a
 *  secure context, and a host testing over http:// on the LAN would otherwise
 *  get a silent no-op. */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}
