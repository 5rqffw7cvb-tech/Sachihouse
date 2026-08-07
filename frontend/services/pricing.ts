import { apiRequest } from './api';

// Mirrors backend/src/types/domain.ts QuoteResult — the server-authoritative
// price, used only for the coupon-preview round trip (the base, no-coupon
// simulator price stays 100% client-side via utils/pricing.ts).
export interface QuoteResult {
  nights: number;
  payingGuests: number;
  baseNightlyRate: number;
  adultTotal: number;
  childTotal: number;
  longStayDiscount: number;
  cleaningFee: number;
  total: number;
}

export interface AppliedCoupon {
  code: string;
  type: 'percentage' | 'fixed_night';
  value: number;
}

export interface GetQuoteInput {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  infants: number;
  couponCode?: string;
}

export interface GetQuoteResponse {
  quote: QuoteResult;
  coupon: AppliedCoupon | null;
  couponError: string | null;
}

export async function getQuote(input: GetQuoteInput): Promise<GetQuoteResponse> {
  return apiRequest<GetQuoteResponse>('/quotes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
