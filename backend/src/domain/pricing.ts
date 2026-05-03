import { differenceInCalendarDays, parseISO } from 'date-fns';
import { PricingConfig, QuoteInput, QuoteResult } from '../types/domain.js';

export function calculateNights(checkIn: string, checkOut: string): number {
  const nights = differenceInCalendarDays(parseISO(checkOut), parseISO(checkIn));
  if (nights <= 0) {
    throw new Error('Check-out must be after check-in.');
  }
  return nights;
}

export function getPayingGuests(input: Pick<QuoteInput, 'adults' | 'children'>): number {
  return input.adults + input.children;
}

export function getRateByGuests(config: PricingConfig, payingGuests: number): number {
  const tier = config.rates.find((item) => item.guests === payingGuests);
  if (!tier) {
    throw new Error(`Maximum paying guests allowed is ${Math.max(...config.rates.map((item) => item.guests))}.`);
  }
  return tier.price;
}

export function getCleaningFee(config: PricingConfig, payingGuests: number): number {
  const tier = config.cleaning.find((item) => payingGuests >= item.minGuests && payingGuests <= item.maxGuests);
  if (!tier) {
    throw new Error('No cleaning fee configured for selected guest count.');
  }
  return tier.price;
}

export function calculateQuote(config: PricingConfig, input: QuoteInput): QuoteResult {
  const nights = calculateNights(input.checkIn, input.checkOut);
  const payingGuests = getPayingGuests(input);
  const baseNightlyRate = getRateByGuests(config, payingGuests);
  const adultTotal = input.adults * baseNightlyRate * nights;
  const childUnitRate = Math.round(baseNightlyRate * (1 - config.childDiscountPercent / 100));
  const childTotal = input.children * childUnitRate * nights;
  const subtotal = adultTotal + childTotal;
  const longStayDiscount = nights >= config.longStayMinNights
    ? Math.round(subtotal * (config.longStayDiscountPercent / 100))
    : 0;
  const cleaningFee = getCleaningFee(config, payingGuests);
  const total = subtotal - longStayDiscount + cleaningFee;

  return {
    nights,
    payingGuests,
    baseNightlyRate,
    adultTotal,
    childTotal,
    longStayDiscount,
    cleaningFee,
    total,
  };
}
