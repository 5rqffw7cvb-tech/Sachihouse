import { ApiUser } from './api';
import { getPropertyCalendar, PropertyCalendar } from './calendar';
import { getAllProperties } from './storage';

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

  return visible.map((property) => ({ id: property.id, name: property.name }));
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

export function arrivalsOn(stays: HostStay[], iso: string): HostStay[] {
  return stays
    .filter((stay) => stay.checkInDate === iso)
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
