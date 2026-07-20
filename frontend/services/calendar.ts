import { apiRequest } from './api';
import { ICalFeed } from '../types';

export interface CalendarBooking {
  id: string;
  guestName: string;
  checkInDate: string;
  checkOutDate: string;
}

export interface PropertyCalendar {
  propertyId: string;
  propertyName: string;
  // Host-managed manual blocks (editable here).
  manualBlockedDates: string[];
  // Dates pulled in from other platforms via iCal import (read-only here).
  importedBlockedDates: string[];
  bookings: CalendarBooking[];
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
