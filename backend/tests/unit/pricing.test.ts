import { describe, expect, it } from 'vitest';
import { calculateNights, calculateQuote, getCleaningFee, getRateByGuests } from '../../src/domain/pricing.js';
import { PricingConfig } from '../../src/types/domain.js';

const pricingConfig: PricingConfig = {
  rates: [
    { guests: 1, price: 5000 },
    { guests: 2, price: 5000 },
    { guests: 3, price: 4700 },
    { guests: 4, price: 4500 },
  ],
  cleaning: [
    { minGuests: 1, maxGuests: 2, price: 5000 },
    { minGuests: 3, maxGuests: 4, price: 8000 },
  ],
  childDiscountPercent: 30,
  childAgeMin: 3,
  childAgeMax: 10,
  longStayDiscountPercent: 10,
  longStayMinNights: 7,
};

describe('pricing domain', () => {
  it('calculates nights for a valid date range', () => {
    expect(calculateNights('2026-06-01', '2026-06-04')).toBe(3);
  });

  it('rejects same-day bookings', () => {
    expect(() => calculateNights('2026-06-01', '2026-06-01')).toThrow('Check-out must be after check-in.');
  });

  it('returns configured rate and cleaning fee by guest count', () => {
    expect(getRateByGuests(pricingConfig, 3)).toBe(4700);
    expect(getCleaningFee(pricingConfig, 3)).toBe(8000);
  });

  it('calculates the quote with child discount and long-stay discount', () => {
    const quote = calculateQuote(pricingConfig, {
      checkIn: '2026-06-01',
      checkOut: '2026-06-09',
      adults: 2,
      children: 1,
      infants: 1,
    });

    expect(quote.nights).toBe(8);
    expect(quote.payingGuests).toBe(3);
    expect(quote.baseNightlyRate).toBe(4700);
    expect(quote.adultTotal).toBe(75200);
    expect(quote.childTotal).toBe(26320);
    expect(quote.longStayDiscount).toBe(10152);
    expect(quote.cleaningFee).toBe(8000);
    expect(quote.total).toBe(99368);
  });
});
