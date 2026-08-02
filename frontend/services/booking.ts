import { apiRequest } from './api';
import { BookingConfirmation } from '../types';

export type BookingStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'expired'
  | 'payment_failed'
  | 'cancelled_by_guest'
  | 'cancelled_by_host';

export interface GuestBooking {
  id: string;
  confirmationNo?: string;
  propertyId: string;
  status: BookingStatus;
  guestName: string;
  guestEmail: string;
  adults: number;
  children: number;
  infants: number;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  currency: string;
  // Whole yen — JPY has no minor unit, so never divide by 100 for display.
  amountTotal: number;
  holdExpiresAt?: number | null;
  refundAmount: number;
  cancelledAt?: number | null;
  refundIfCancelledNow: number;
  // Days before check-in a cancellation still qualifies for a refund. Set per
  // property by the host; falls back to 7 when unset.
  freeCancellationDays: number;
  // Times the guest has already corrected their own email via updateBookingEmail.
  // The server caps this (see MAX_GUEST_EMAIL_UPDATES) to stop it becoming a
  // way to spam an arbitrary address.
  emailUpdateCount: number;
  createdAt: number;
}

export interface CreateBookingInput {
  propertyId: string;
  guestName: string;
  guestEmail: string;
  guestPhone?: string;
  adults: number;
  children: number;
  infants: number;
  checkInDate: string;
  checkOutDate: string;
  locale: string;
}

export interface CreateBookingResponse {
  booking: GuestBooking;
  guestToken: string;
  checkoutUrl: string;
}

export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResponse> {
  return apiRequest<CreateBookingResponse>('/bookings', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getBooking(id: string, token: string): Promise<GuestBooking> {
  const res = await apiRequest<{ booking: GuestBooking }>(
    `/bookings/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`,
  );
  return res.booking;
}

// Backs the "Download PDF" button on the result page and the confirmation
// email — the same BookingConfirmation-shaped record the host's manual
// bookings use, rendered into a PDF client-side (see utils/bookingConfirmPdf).
export async function getBookingConfirmationForPdf(id: string, token: string): Promise<BookingConfirmation> {
  const res = await apiRequest<{ confirmation: BookingConfirmation }>(
    `/bookings/${encodeURIComponent(id)}/confirmation?token=${encodeURIComponent(token)}`,
  );
  return res.confirmation;
}

export async function cancelBooking(
  id: string,
  token: string,
): Promise<{ booking: GuestBooking; refundAmount: number }> {
  return apiRequest<{ booking: GuestBooking; refundAmount: number }>(
    `/bookings/${encodeURIComponent(id)}/cancel?token=${encodeURIComponent(token)}`,
    { method: 'POST' },
  );
}

// Called from the page Stripe sends a guest back to after they back out of
// Checkout, so the nights go back on sale immediately instead of waiting out
// the hold. Best-effort: swallow failures, since the hold's own expiry is
// still there as a fallback and this must never block the "you're fine,
// nothing was charged" screen the guest is looking at.
export async function abandonBooking(id: string, token: string): Promise<void> {
  await apiRequest<{ ok: true }>(
    `/bookings/${encodeURIComponent(id)}/abandon?token=${encodeURIComponent(token)}`,
    { method: 'POST' },
  );
}

export const MAX_GUEST_EMAIL_UPDATES = 3;

// Lets the guest correct a mistyped email themselves from the booking result
// page and resends the confirmation there. Capped server-side per booking.
export async function updateBookingEmail(
  id: string,
  token: string,
  email: string,
): Promise<{ booking: GuestBooking; sentTo: string }> {
  return apiRequest<{ booking: GuestBooking; sentTo: string }>(
    `/bookings/${encodeURIComponent(id)}/email?token=${encodeURIComponent(token)}`,
    { method: 'POST', body: JSON.stringify({ email }) },
  );
}

// Host/admin cancellation. Unlike a guest cancelling themselves, this always
// refunds in full — the guest did nothing wrong, so the host (not the guest)
// absorbs the Stripe processing fee. Requires an authenticated host/admin
// session; apiRequest attaches that token automatically.
export async function cancelBookingByHost(
  id: string,
  reason?: string,
): Promise<{ booking: GuestBooking; refundAmount: number }> {
  return apiRequest<{ booking: GuestBooking; refundAmount: number }>(
    `/bookings/${encodeURIComponent(id)}/cancel-by-host`,
    { method: 'POST', body: JSON.stringify({ reason }) },
  );
}

// The browser is redirected back from Stripe the moment payment succeeds, but
// the booking is only confirmed once Stripe's webhook reaches our server. That
// gap is normally under a second and occasionally a few seconds, so the result
// screen polls rather than reporting failure straight away.
export const BOOKING_POLL_INTERVAL_MS = 2000;
export const BOOKING_POLL_TIMEOUT_MS = 40000;
