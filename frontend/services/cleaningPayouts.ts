import { apiRequest } from './api';

/** A cleaning job already paid — see backend CleaningPayout. */
export interface CleaningPayout {
  id: string;
  propertyId: string | null;
  stayRef: string | null;
  label: string;
  checkInDate: string | null;
  checkOutDate: string | null;
  cleaningFee: number;
  coHostPercent: number | null;
  guestPayment: number;
  coHostShare: number;
  bonus: number;
  supplies: number;
  total: number;
  paidAt: number;
  paidByUserId: number;
  paidByName: string;
}

export interface CleaningPayoutInput {
  propertyId: string | null;
  stayRef: string | null;
  label: string;
  checkInDate: string | null;
  checkOutDate: string | null;
  cleaningFee: number;
  coHostPercent: number | null;
  guestPayment: number;
  bonus: number;
  supplies: number;
}

/** Payouts for stays that checked out on or after `fromDate` (default: the
 *  server's 30 days back), plus manual ones paid since then. */
export async function listCleaningPayouts(fromDate?: string): Promise<CleaningPayout[]> {
  const query = fromDate ? `?from=${encodeURIComponent(fromDate)}` : '';
  const response = await apiRequest<{ payouts: CleaningPayout[] }>(`/cleaning-payouts${query}`);
  return response.payouts;
}

export async function createCleaningPayout(input: CleaningPayoutInput): Promise<CleaningPayout> {
  const response = await apiRequest<{ payout: CleaningPayout }>('/cleaning-payouts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.payout;
}

export async function deleteCleaningPayout(id: string): Promise<void> {
  await apiRequest(`/cleaning-payouts/${id}`, { method: 'DELETE' });
}
