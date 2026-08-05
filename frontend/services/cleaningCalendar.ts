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
}

// Public: no auth token required, the link's own secret is the credential.
export async function getCleaningCalendar(token: string, from: string, to: string): Promise<CleaningStay[]> {
  const res = await apiRequest<{ stays: CleaningStay[] }>(
    `/cleaning-calendar/${encodeURIComponent(token)}?from=${from}&to=${to}`,
  );
  return res.stays;
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
