import { describe, expect, it } from 'vitest';
import { CouponDraft, normalizeCouponCode, validateCouponDraft } from './couponDraft';

const draft = (overrides: Partial<CouponDraft> = {}): CouponDraft => ({
  code: 'SUMMER10',
  type: 'percentage',
  value: '10',
  startDate: '2026-09-01',
  endDate: '2026-09-30',
  propertyIds: ['main'],
  ...overrides,
});

describe('coupon code normalisation', () => {
  it('trims and uppercases, as the backend does before storing', () => {
    expect(normalizeCouponCode('  summer10 ')).toBe('SUMMER10');
  });
});

describe('coupon draft validation', () => {
  it('accepts a complete draft', () => {
    expect(validateCouponDraft(draft())).toBeNull();
  });

  it('requires a code', () => {
    expect(validateCouponDraft(draft({ code: '   ' }))).toBe('Enter a code.');
  });

  it('rejects a code that exists in another case', () => {
    // Codes are unique case-insensitively (idx_coupons_code_ci), so this is
    // the clash the API would refuse.
    expect(validateCouponDraft(draft({ code: 'summer10' }), ['SUMMER10']))
      .toBe('SUMMER10 already exists.');
  });

  it('allows a code that clashes with nothing', () => {
    expect(validateCouponDraft(draft({ code: 'AUTUMN10' }), ['SUMMER10'])).toBeNull();
  });

  it('rejects an empty value rather than reading it as zero', () => {
    expect(validateCouponDraft(draft({ value: '' }))).toBe('The value must be a whole number.');
    expect(validateCouponDraft(draft({ value: '  ' }))).toBe('The value must be a whole number.');
  });

  it('rejects a fractional value', () => {
    expect(validateCouponDraft(draft({ value: '10.5' }))).toBe('The value must be a whole number.');
  });

  it('holds a percentage to 1-100', () => {
    expect(validateCouponDraft(draft({ value: '0' }))).toBe('A percentage must be between 1 and 100.');
    expect(validateCouponDraft(draft({ value: '101' }))).toBe('A percentage must be between 1 and 100.');
    expect(validateCouponDraft(draft({ value: '1' }))).toBeNull();
    expect(validateCouponDraft(draft({ value: '100' }))).toBeNull();
  });

  it('lets a flat nightly rate be any non-negative whole number', () => {
    expect(validateCouponDraft(draft({ type: 'fixed_night', value: '0' }))).toBeNull();
    expect(validateCouponDraft(draft({ type: 'fixed_night', value: '12000' }))).toBeNull();
    expect(validateCouponDraft(draft({ type: 'fixed_night', value: '-1' })))
      .toBe('A nightly rate cannot be negative.');
  });

  it('does not apply the percentage ceiling to a nightly rate', () => {
    expect(validateCouponDraft(draft({ type: 'fixed_night', value: '9800' }))).toBeNull();
  });

  it('requires both dates', () => {
    expect(validateCouponDraft(draft({ startDate: '' }))).toBe('Both dates are required.');
    expect(validateCouponDraft(draft({ endDate: '' }))).toBe('Both dates are required.');
  });

  it('rejects an end date before the start', () => {
    expect(validateCouponDraft(draft({ startDate: '2026-09-30', endDate: '2026-09-01' })))
      .toBe('The start date must be on or before the end date.');
  });

  it('accepts a single-day window', () => {
    expect(validateCouponDraft(draft({ startDate: '2026-09-01', endDate: '2026-09-01' }))).toBeNull();
  });

  it('refuses a coupon with no property, which could never be redeemed', () => {
    // The API accepts this; findApplicableCoupon then never matches it.
    expect(validateCouponDraft(draft({ propertyIds: [] })))
      .toBe('Pick at least one property, or the code can never be redeemed.');
  });
});
