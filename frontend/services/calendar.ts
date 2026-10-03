import { apiRequest } from './api';
import { ICalFeed } from '../types';

export interface CalendarBooking {
  id: string;
  guestName: string;
  checkInDate: string;
  checkOutDate: string;
}

// A booking a guest made and paid for on our own site. `pending_payment` is a
// short-lived hold taken while they are on the payment page.
export interface DirectBooking {
  id: string;
  status: 'pending_payment' | 'confirmed';
  guestName: string;
  checkInDate: string;
  checkOutDate: string;
  amountTotal: number;
  currency: string;
}

// A single imported reservation/block, as sent by the source OTA feed. Most
// platforms strip guest details from their exported .ics for privacy, so
// guestCount is best-effort and often null.
export interface ImportedCalendarEvent {
  feedId: string;
  feedName: string;
  // Best-effort original OTA (e.g. "Airbnb") detected from the feed's own
  // text when the feed itself is an aggregator like Hostex. Null when it
  // cannot be determined — falls back to feedName in the UI.
  channelName: string | null;
  // True when the feed published this range as "these nights are taken"
  // rather than as a reservation — a channel manager mirroring somebody
  // else's calendar. No guest, no money, no turnover: the calendars draw it
  // as a block, never as a stay.
  isBlock: boolean;
  summary: string;
  description: string;
  checkInDate: string;
  checkOutDate: string;
  dates: string[];
  guestCount: number | null;
}

// A host's own appointment or task on a property's calendar. It never blocks
// a night, so it stays out of blockedDates and the .ics export. `note` is
// always a string ('' when empty); `date` is YYYY-MM-DD, times are HH:mm.
export interface PropertyCalendarEvent {
  id: string;
  propertyId: string;
  title: string;
  note: string;
  date: string;
  startTime: string;
  endTime: string;
  createdAt: number;
  updatedAt: number;
}

// The property travels on the URL, not in the body.
export interface PropertyCalendarEventInput {
  title: string;
  note?: string;
  date: string;
  startTime: string;
  endTime: string;
}

export type PropertyCalendarEventPatch = Partial<PropertyCalendarEventInput>;

export interface PropertyCalendar {
  propertyId: string;
  propertyName: string;
  // Host-managed manual blocks (editable here).
  manualBlockedDates: string[];
  // Dates pulled in from other platforms via iCal import (read-only here).
  importedBlockedDates: string[];
  // Same import, but as individual events with feed attribution and raw
  // SUMMARY/DESCRIPTION text — what the calendar's "which platform" view reads.
  importedEvents: ImportedCalendarEvent[];
  // Host-entered confirmations for off-platform stays.
  bookings: CalendarBooking[];
  // Guest-made online bookings. These occupy the calendar too.
  directBookings: DirectBooking[];
  icalFeeds: ICalFeed[];
  exportUrl: string;
  // Host appointments. Optional because an older backend may not send it, and
  // the server only returns a JST window of -90/+365 days. Read with `?? []`.
  events?: PropertyCalendarEvent[];
}

/** Whether to make the server pull the iCal feeds before it answers.
 *
 * By default it replies from what was last synced and refreshes behind the
 * request, which is what keeps opening a calendar quick. Pass `refresh` where
 * the wait is the point — a refresh control the host just pressed, or a feed
 * they have only this second added. */
export interface CalendarFetchOptions {
  refresh?: boolean;
}

export async function getPropertyCalendar(
  propertyId: string,
  options?: CalendarFetchOptions,
): Promise<PropertyCalendar> {
  const query = options?.refresh ? '?refresh=1' : '';
  return apiRequest<PropertyCalendar>(`/properties/${propertyId}/calendar${query}`);
}

// The full effective calendar (manual blocks + iCal imports from other
// platforms + direct-booking holds), flattened to individual dates. Used to
// stop a host from recording a manual booking on a night another platform
// already has.
export async function getBlockedDatesForProperty(propertyId: string): Promise<string[]> {
  const res = await apiRequest<{ blockedDates: string[] }>(`/properties/${propertyId}/blocked-dates`);
  return res.blockedDates;
}

export async function addBlockedDates(propertyId: string, dates: string[]): Promise<string[]> {
  const res = await apiRequest<{ manualBlockedDates: string[] }>(`/properties/${propertyId}/blocked-dates`, {
    method: 'POST',
    body: JSON.stringify({ dates }),
  });
  return res.manualBlockedDates;
}

export async function removeBlockedDates(propertyId: string, dates: string[]): Promise<string[]> {
  const res = await apiRequest<{ manualBlockedDates: string[] }>(`/properties/${propertyId}/blocked-dates`, {
    method: 'DELETE',
    body: JSON.stringify({ dates }),
  });
  return res.manualBlockedDates;
}

export async function createCalendarEvent(
  propertyId: string,
  input: PropertyCalendarEventInput,
): Promise<PropertyCalendarEvent> {
  const res = await apiRequest<{ event: PropertyCalendarEvent }>(`/properties/${propertyId}/events`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.event;
}

// Note the route prefix: an event is addressed by its own id once it exists,
// not under the property it was created on.
export async function updateCalendarEvent(
  eventId: string,
  patch: PropertyCalendarEventPatch,
): Promise<PropertyCalendarEvent> {
  const res = await apiRequest<{ event: PropertyCalendarEvent }>(`/calendar-events/${eventId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return res.event;
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  await apiRequest<void>(`/calendar-events/${eventId}`, { method: 'DELETE' });
}

export async function updateIcalFeeds(propertyId: string, feeds: ICalFeed[]): Promise<ICalFeed[]> {
  const res = await apiRequest<{ icalFeeds: ICalFeed[] }>(`/properties/${propertyId}/ical-feeds`, {
    method: 'PUT',
    body: JSON.stringify({ feeds }),
  });
  return res.icalFeeds;
}

export async function regenerateIcalExportToken(propertyId: string): Promise<string> {
  const res = await apiRequest<{ exportUrl: string }>(
    `/properties/${propertyId}/ical-export-token/regenerate`,
    { method: 'POST' },
  );
  return res.exportUrl;
}
