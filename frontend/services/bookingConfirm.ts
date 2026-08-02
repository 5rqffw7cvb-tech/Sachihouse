import { apiRequest } from './api';
import { BookingConfirmation } from '../types';

// Payload the host submits when creating a confirmation. Amounts are whole
// currency units (JPY has no minor unit). The server snapshots the property
// name/address/URL, but we send them too so the stored record matches the PDF.
export interface CreateBookingConfirmationPayload {
  propertyName: string;
  propertyAddress: string;
  propertyUrl: string;
  guestName: string;
  guestEmail?: string;
  guestPhone?: string;
  numGuests: number;
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string;
  checkOutTime: string;
  currency: string;
  roomFee: number;
  cleaningFee: number;
  extraFeeLabel?: string;
  extraFee: number;
  discountLabel?: string;
  discountAmount: number;
  totalAmount: number;
  depositAmount: number;
  balanceDue: number;
  notes?: string;
  includeInAccounting: boolean;
  // Language for the guest confirmation email. Only meaningful when
  // guestEmail is set; defaults to English server-side otherwise.
  locale?: string;
}

export interface BookingConfirmationListFilters {
  propertyId?: string;
  fromDate?: string;
  toDate?: string;
  guestName?: string;
}

export async function createBookingConfirmation(
  propertyId: string,
  payload: CreateBookingConfirmationPayload,
): Promise<BookingConfirmation> {
  const response = await apiRequest<{ confirmation: BookingConfirmation }>(
    `/properties/${propertyId}/booking-confirmations`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return response.confirmation;
}

export async function listBookingConfirmations(
  filters?: BookingConfirmationListFilters,
): Promise<BookingConfirmation[]> {
  const query = new URLSearchParams();
  if (filters?.propertyId) query.set('propertyId', filters.propertyId);
  if (filters?.fromDate) query.set('fromDate', filters.fromDate);
  if (filters?.toDate) query.set('toDate', filters.toDate);
  if (filters?.guestName) query.set('guestName', filters.guestName);

  const suffix = query.toString() ? `?${query.toString()}` : '';
  const response = await apiRequest<{ confirmations: BookingConfirmation[] }>(`/booking-confirmations${suffix}`);
  return response.confirmations;
}

export async function getBookingConfirmation(id: string): Promise<BookingConfirmation> {
  const response = await apiRequest<{ confirmation: BookingConfirmation }>(`/booking-confirmations/${id}`);
  return response.confirmation;
}

export async function updateBookingConfirmation(
  id: string,
  patch: { includeInAccounting?: boolean; notes?: string },
): Promise<BookingConfirmation> {
  const response = await apiRequest<{ confirmation: BookingConfirmation }>(`/booking-confirmations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return response.confirmation;
}

export async function deleteBookingConfirmation(id: string): Promise<void> {
  await apiRequest<void>(`/booking-confirmations/${id}`, { method: 'DELETE' });
}
