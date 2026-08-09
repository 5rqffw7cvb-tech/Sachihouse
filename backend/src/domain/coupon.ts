import { Coupon } from '../store/types.js';
import { PricingConfig } from '../types/domain.js';

export type CouponLookupResult =
  | { coupon: Coupon }
  | { error: string };

// Codes are hand-typed by an admin rather than generated, so this is the one
// place normalization happens — reused by app.ts's lookup and by both store
// implementations' uniqueness checks, so it can never drift between them.
export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

// `coupon` is a single already-fetched-by-code record (or null if the code
// doesn't exist at all) — the caller does the store lookup, this function is
// pure. A coupon only applies when it's assigned to the requesting property
// AND the guest's entire stay falls within [startDate, endDate] — a stay
// that only partially overlaps is rejected outright rather than prorated.
// "Not found" and "exists but not assigned to this property" deliberately
// share the same generic error so a guest can't use trial-and-error to learn
// which properties a code is valid for.
export function findApplicableCoupon(
  coupon: Coupon | null,
  propertyId: string,
  checkIn: string,
  checkOut: string,
): CouponLookupResult {
  if (!coupon || !coupon.propertyIds.includes(propertyId)) {
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
