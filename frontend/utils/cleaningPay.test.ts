import { describe, expect, it } from 'vitest';
import { calculateCleaningPay, CleaningPayDraft, formatYen, parseYen } from './cleaningPay';

const draft = (overrides: Partial<CleaningPayDraft> = {}): CleaningPayDraft => ({
  cleaningFee: '8000',
  isCoHost: false,
  guestPayment: '',
  bonus: '',
  supplies: '',
  ...overrides,
});

describe('yen parsing', () => {
  it('accepts commas, yen signs and spaces', () => {
    expect(parseYen(' ¥12,500 ')).toBe(12500);
    expect(parseYen('￥3,000')).toBe(3000);
  });

  it('treats empty, junk and negative input as zero', () => {
    expect(parseYen('')).toBe(0);
    expect(parseYen('abc')).toBe(0);
    expect(parseYen('-500')).toBe(0);
  });
});

describe('cleaning pay', () => {
  it('pays the flat fee for a plain clean', () => {
    expect(calculateCleaningPay(draft()).total).toBe(8000);
  });

  it('adds 3% of the guest payment for a co-host', () => {
    const result = calculateCleaningPay(draft({ isCoHost: true, guestPayment: '100000' }));
    expect(result.coHostShare).toBe(3000);
    expect(result.total).toBe(11000);
  });

  it('ignores the guest payment when not a co-host', () => {
    expect(calculateCleaningPay(draft({ guestPayment: '100000' })).coHostShare).toBe(0);
  });

  it('rounds the co-host share to whole yen', () => {
    expect(calculateCleaningPay(draft({ isCoHost: true, guestPayment: '12345' })).coHostShare).toBe(370);
  });

  it('adds bonus and supplies on top', () => {
    const result = calculateCleaningPay(draft({
      isCoHost: true,
      guestPayment: '50000',
      bonus: '1000',
      supplies: '2,480',
    }));
    expect(result).toEqual({
      cleaningFee: 8000,
      coHostShare: 1500,
      bonus: 1000,
      supplies: 2480,
      total: 12980,
    });
  });
});

describe('yen formatting', () => {
  it('groups thousands', () => {
    expect(formatYen(12980)).toBe('¥12,980');
  });
});
