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
  summary: string;
  description: string;
  checkInDate: string;
  checkOutDate: string;
  dates: string[];
  guestCount: number | null;
}

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
}

export async function getPropertyCalendar(propertyId: string): Promise<PropertyCalendar> {
  return apiRequest<PropertyCalendar>(`/properties/${propertyId}/calendar`);
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
