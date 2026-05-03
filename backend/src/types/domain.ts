export type Role = 'ADMIN' | 'HOST' | 'GUEST';

export interface PricingTier {
  guests: number;
  price: number;
}

export interface CleaningTier {
  minGuests: number;
  maxGuests: number;
  price: number;
}

export interface PricingConfig {
  rates: PricingTier[];
  cleaning: CleaningTier[];
  childDiscountPercent: number;
  childAgeMin: number;
  childAgeMax: number;
  longStayDiscountPercent: number;
  longStayMinNights: number;
}

export interface QuoteInput {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  infants: number;
}

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
