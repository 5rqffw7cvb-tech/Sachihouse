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

export interface CsvImportResult {
  imported: number;
  errors: Array<{ row: number; message: string }>;
}

export async function importCheckInsCsv(csvContent: string): Promise<CsvImportResult> {
  return apiRequest<CsvImportResult>('/checkins/import', {
    method: 'POST',
    body: JSON.stringify({ csvContent }),
  });
}

export const CSV_IMPORT_HEADERS = [
  'property_id',
  'check_in_date',
  'check_out_date',
  'full_name',
  'birth_year',
  'nationality',
  'gender',
  'address',
  'occupation',
  'document_type',
  'document_number',
  'session_ref',
] as const;

export const CSV_IMPORT_TEMPLATE = [
  CSV_IMPORT_HEADERS.join(','),
  'villa-1,2025-12-20,2025-12-25,NGUYEN VAN A,1985,VNM,MALE,HA NOI,EMPLOYEE,passport,A12345678,',
  'villa-1,2025-12-20,2025-12-25,TRAN THI B,1990,VNM,FEMALE,HA NOI,TEACHER,national_id,030123456789,',
].join('\n');
