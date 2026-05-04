import { apiRequest } from './api';
import { CheckInGuest, CheckInSubmission } from '../types';

export interface CheckInConsentPolicy {
  retentionDays: number;
  noticeVersion: string;
}

export interface OcrGuestPayload {
  imageBase64: string;
  guestId: string;
  checkinToken: string;
}

export interface CheckInListFilters {
  propertyId?: string;
  fromDate?: string;
  toDate?: string;
  guestName?: string;
  nationality?: string;
}

export async function ocrGuestDocument(propertyId: string, payload: OcrGuestPayload): Promise<CheckInGuest> {
  const response = await apiRequest<{ guest: CheckInGuest }>(`/properties/${propertyId}/checkins/ocr`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.guest;
}

export async function startCheckInSession(propertyId: string): Promise<{ checkinToken: string; expiresInSeconds: number; consentPolicy: CheckInConsentPolicy }> {
  return apiRequest<{ checkinToken: string; expiresInSeconds: number; consentPolicy: CheckInConsentPolicy }>(`/properties/${propertyId}/checkins/start`, {
    method: 'POST',
  });
}

export async function submitCheckIn(propertyId: string, payload: {
  checkinToken: string;
  checkInDate: string;
  checkOutDate: string;
  guests: CheckInGuest[];
  consent: {
    accepted: boolean;
    acceptedAt: number;
    noticeVersion: string;
  };
}): Promise<CheckInSubmission> {
  const response = await apiRequest<{ submission: CheckInSubmission }>(`/properties/${propertyId}/checkins/submit`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return response.submission;
}

export async function listCheckIns(filters?: CheckInListFilters): Promise<CheckInSubmission[]> {
  const query = new URLSearchParams();
  if (filters?.propertyId) query.set('propertyId', filters.propertyId);
  if (filters?.fromDate) query.set('fromDate', filters.fromDate);
  if (filters?.toDate) query.set('toDate', filters.toDate);
  if (filters?.guestName) query.set('guestName', filters.guestName);
  if (filters?.nationality) query.set('nationality', filters.nationality);

  const suffix = query.toString() ? `?${query.toString()}` : '';
  const response = await apiRequest<{ submissions: CheckInSubmission[] }>(`/checkins${suffix}`);
  return response.submissions;
}

export async function getCheckInDetail(checkInId: string): Promise<CheckInSubmission> {
  const response = await apiRequest<{ submission: CheckInSubmission }>(`/checkins/${checkInId}`);
  return response.submission;
}
