import { Coupon } from '../store/types.js';
import { PricingConfig } from '../types/domain.js';

export type CouponLookupResult =
  | { coupon: Coupon }
  | { error: string };

// A coupon only applies when the guest's entire stay falls within
// [startDate, endDate] — a stay that only partially overlaps is rejected
// outright rather than prorated across nights inside vs. outside the range.
export function findApplicableCoupon(
  coupons: Coupon[] | undefined,
  code: string,
  checkIn: string,
  checkOut: string,
): CouponLookupResult {
  const normalized = code.trim().toUpperCase();
  if (!normalized) {
    return { error: 'Invalid coupon code.' };
  }
  const coupon = (coupons ?? []).find((c) => c.code === normalized);
  if (!coupon) {
    return { error: 'Invalid coupon code.' };
  }
  if (!coupon.active) {
    return { error: 'This coupon is no longer active.' };
  }
  if (checkIn < coupon.startDate || checkOut > coupon.endDate) {
    return { error: 'This coupon is not valid for the selected dates.' };
  }
  return { coupon };
}

// Transforms every guest-count tier's nightly rate before calculateQuote()
// runs, rather than special-casing coupons inside it — a `percentage`
// coupon scales every tier by the same factor (2-guest stays and 4-guest
// stays both get X% off, preserving the tiers' relative spread), while a
// `fixed_night` coupon collapses every tier to the same flat rate (the room
// costs exactly that many yen/night no matter the guest count). Cleaning
// fees and the child/long-stay discounts are untouched — they still apply
// on top of the adjusted nightly rate exactly as they normally would.
export function applyCouponToPricing(config: PricingConfig, coupon: Coupon): PricingConfig {
  return {
    ...config,
    rates: config.rates.map((tier) => ({
      ...tier,
      price: coupon.type === 'percentage'
        ? Math.round(tier.price * (1 - coupon.value / 100))
        : coupon.value,
    })),
  };
}
