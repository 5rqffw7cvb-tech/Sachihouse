import { apiRequest } from './api';

// What cleaning staff need for one stay's turnover — deliberately no guest
// name or contact details, since this endpoint is reachable by anyone with
// the link (token-guarded, but still a link that can be forwarded).
export interface CleaningStay {
  propertyId: string;
  propertyName: string;
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string;
  checkOutTime: string;
  source: string;
  guestCount: number | null;
  // A channel manager's "these nights are taken" range rather than a
  // reservation. It fills the calendar but nobody checks in or out of it, so
  // it must never be shown as a turnover to go and clean.
  isBlock: boolean;
}

// A host's calendar event as cleaning staff see it — no id and no note, for
// the same reason a stay carries no guest name: anyone with the link can read it.
export interface CleaningEvent {
  propertyId: string;
  propertyName: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
}

export interface CleaningCalendarData {
  stays: CleaningStay[];
  events: CleaningEvent[];
}

// Public: no auth token required, the link's own secret is the credential.
export async function getCleaningCalendar(token: string, from: string, to: string): Promise<CleaningCalendarData> {
  const res = await apiRequest<{ stays: CleaningStay[]; events?: CleaningEvent[] }>(
    `/cleaning-calendar/${encodeURIComponent(token)}?from=${from}&to=${to}`,
  );
  // An older backend (or a cached proxy response) may not send events at all.
  return { stays: res.stays, events: res.events ?? [] };
}

// Host/admin only: fetches (and lazily creates) the one shareable link.
export async function getCleaningCalendarLink(): Promise<string> {
  const res = await apiRequest<{ url: string }>('/cleaning-calendar-link');
  return res.url;
}

// Invalidates the previous link — anyone still using it gets a 404.
export async function regenerateCleaningCalendarLink(): Promise<string> {
  const res = await apiRequest<{ url: string }>('/cleaning-calendar-link/regenerate', { method: 'POST' });
  return res.url;
}
