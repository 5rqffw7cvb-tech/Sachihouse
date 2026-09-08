import { Coupon } from '../types';

/**
 * What a coupon has to look like before it is worth sending to the API.
 *
 * These rules are a copy of parseCouponPayload in backend/src/app.ts, kept
 * here so a mistake shows up under the field the admin is typing in rather
 * than as a 400 after a round trip. Being a copy, it can drift — couponDraft
 * .test.ts states each rule so the drift is visible.
 *
 * One rule is stricter than the API's: a coupon with no property attached is
 * accepted by the backend and can then never be redeemed, because
 * findApplicableCoupon only matches when the stay's property is in the
 * coupon's list. Refusing it here is the difference between a code that does
 * nothing and an admin who knows why.
 */
export interface CouponDraft {
  code: string;
  type: Coupon['type'];
  /** Raw field text: an empty or half-typed number must fail, not read as 0. */
  value: string;
  startDate: string;
  endDate: string;
  propertyIds: string[];
}

/** trim + uppercase, matching normalizeCouponCode in backend/src/domain/coupon.ts. */
export const normalizeCouponCode = (code: string): string => code.trim().toUpperCase();

/**
 * @param takenCodes Codes that already exist, in any case. Codes are unique
 *   case-insensitively, so this catches the clash before the API does.
 * @returns The first problem in the order an admin reads the form, or null.
 */
export function validateCouponDraft(draft: CouponDraft, takenCodes: Iterable<string> = []): string | null {
  const code = normalizeCouponCode(draft.code);
  if (!code) return 'Enter a code.';

  for (const taken of takenCodes) {
    if (normalizeCouponCode(taken) === code) return `${code} already exists.`;
  }

  // Number('') is 0 and Number(' ') is 0, so an empty field would otherwise
  // pass as a valid whole number and create a 0% coupon.
  const value = draft.value.trim() === '' ? Number.NaN : Number(draft.value);
  if (!Number.isInteger(value)) return 'The value must be a whole number.';
  if (draft.type === 'percentage' && (value < 1 || value > 100)) {
    return 'A percentage must be between 1 and 100.';
  }
  if (draft.type === 'fixed_night' && value < 0) return 'A nightly rate cannot be negative.';

  if (!draft.startDate || !draft.endDate) return 'Both dates are required.';
  // ISO dates compare correctly as strings, which is why they are stored that way.
  if (draft.startDate > draft.endDate) return 'The start date must be on or before the end date.';

  if (draft.propertyIds.length === 0) {
    return 'Pick at least one property, or the code can never be redeemed.';
  }

  return null;
}
