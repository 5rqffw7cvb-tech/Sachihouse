import { describe, expect, it } from 'vitest';
import { applyCouponToPricing, findApplicableCoupon } from '../../src/domain/coupon.js';
import { calculateQuote } from '../../src/domain/pricing.js';
import { Coupon } from '../../src/store/types.js';
import { PricingConfig } from '../../src/types/domain.js';

const pricingConfig: PricingConfig = {
  rates: [
    { guests: 2, price: 10000 },
    { guests: 4, price: 16000 },
  ],
  cleaning: [
    { minGuests: 1, maxGuests: 4, price: 5000 },
  ],
  childDiscountPercent: 30,
  childAgeMin: 3,
  childAgeMax: 10,
  longStayDiscountPercent: 10,
  longStayMinNights: 7,
};

function makeCoupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: 'coupon_1',
    code: 'SH-ABC123',
    type: 'percentage',
    value: 20,
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    active: true,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('findApplicableCoupon', () => {
  it('finds a coupon by code, case-insensitively and trimmed', () => {
    const coupon = makeCoupon();
    const result = findApplicableCoupon([coupon], ' sh-abc123 ', '2026-08-05', '2026-08-08');
    expect('coupon' in result && result.coupon.id).toBe('coupon_1');
  });

  it('rejects an unknown code', () => {
    const result = findApplicableCoupon([makeCoupon()], 'SH-NOPE99', '2026-08-05', '2026-08-08');
    expect('error' in result).toBe(true);
  });

  it('rejects an inactive coupon', () => {
    const result = findApplicableCoupon([makeCoupon({ active: false })], 'SH-ABC123', '2026-08-05', '2026-08-08');
    expect('error' in result && result.error).toMatch(/no longer active/);
  });

  it('accepts a stay fully inside the coupon date range', () => {
    const result = findApplicableCoupon([makeCoupon()], 'SH-ABC123', '2026-08-01', '2026-08-31');
    expect('coupon' in result).toBe(true);
  });

  it('rejects a stay that starts before the coupon range', () => {
    const result = findApplicableCoupon([makeCoupon()], 'SH-ABC123', '2026-07-30', '2026-08-05');
    expect('error' in result && result.error).toMatch(/not valid for the selected dates/);
  });

  it('rejects a stay that only partially overlaps the coupon range — no proration', () => {
    // Checks out one day after the coupon's last valid day.
    const result = findApplicableCoupon([makeCoupon()], 'SH-ABC123', '2026-08-25', '2026-09-02');
    expect('error' in result && result.error).toMatch(/not valid for the selected dates/);
  });
});

describe('applyCouponToPricing', () => {
  it('scales every guest-count tier by the same percentage, preserving the spread between tiers', () => {
    const coupon = makeCoupon({ type: 'percentage', value: 20 });
    const adjusted = applyCouponToPricing(pricingConfig, coupon);
    expect(adjusted.rates).toEqual([
      { guests: 2, price: 8000 },
      { guests: 4, price: 12800 },
    ]);
  });

  it('collapses every guest-count tier to the same flat rate for a fixed_night coupon', () => {
    const coupon = makeCoupon({ type: 'fixed_night', value: 8000 });
    const adjusted = applyCouponToPricing(pricingConfig, coupon);
    expect(adjusted.rates).toEqual([
      { guests: 2, price: 8000 },
      { guests: 4, price: 8000 },
    ]);
  });

  it('leaves cleaning fees and discount settings untouched', () => {
    const coupon = makeCoupon({ type: 'fixed_night', value: 8000 });
    const adjusted = applyCouponToPricing(pricingConfig, coupon);
    expect(adjusted.cleaning).toEqual(pricingConfig.cleaning);
    expect(adjusted.childDiscountPercent).toBe(pricingConfig.childDiscountPercent);
    expect(adjusted.longStayDiscountPercent).toBe(pricingConfig.longStayDiscountPercent);
  });

  it('a fixed_night coupon makes a 4-guest stay cost the same nightly rate as a 2-guest stay', () => {
    const coupon = makeCoupon({ type: 'fixed_night', value: 8000 });
    const adjusted = applyCouponToPricing(pricingConfig, coupon);

    const twoGuestQuote = calculateQuote(adjusted, {
      checkIn: '2026-08-01', checkOut: '2026-08-02', adults: 2, children: 0, infants: 0,
    });
    const fourGuestQuote = calculateQuote(adjusted, {
      checkIn: '2026-08-01', checkOut: '2026-08-02', adults: 4, children: 0, infants: 0,
    });

    expect(twoGuestQuote.baseNightlyRate).toBe(8000);
    expect(fourGuestQuote.baseNightlyRate).toBe(8000);
  });
});
