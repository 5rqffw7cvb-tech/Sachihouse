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

export interface PropertyCalendar {
  propertyId: string;
  propertyName: string;
  // Host-managed manual blocks (editable here).
  manualBlockedDates: string[];
  // Dates pulled in from other platforms via iCal import (read-only here).
  importedBlockedDates: string[];
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
