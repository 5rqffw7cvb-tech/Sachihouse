import { describe, expect, it } from 'vitest';
import {
  calculateCleaningPay,
  CleaningPayDraft,
  formatYen,
  parsePercent,
  parseYen,
  payableFromDate,
  payableStays,
  shortDateRange,
  stayRef,
  stayWho,
} from './cleaningPay';

const draft = (overrides: Partial<CleaningPayDraft> = {}): CleaningPayDraft => ({
  cleaningFee: '8000',
  isCoHost: false,
  coHostPercent: '3',
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

describe('percent parsing', () => {
  it('accepts decimals and a percent sign', () => {
    expect(parsePercent('2.5')).toBe(2.5);
    expect(parsePercent('5%')).toBe(5);
    expect(parsePercent('2,5')).toBe(2.5);
  });

  it('treats empty, junk and negative input as zero', () => {
    expect(parsePercent('')).toBe(0);
    expect(parsePercent('abc')).toBe(0);
    expect(parsePercent('-3')).toBe(0);
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

  it('uses a changed co-host rate', () => {
    const result = calculateCleaningPay(draft({ isCoHost: true, coHostPercent: '5', guestPayment: '100000' }));
    expect(result.coHostShare).toBe(5000);
    expect(result.total).toBe(13000);
  });

  it('pays no share when the rate is cleared', () => {
    expect(calculateCleaningPay(draft({ isCoHost: true, coHostPercent: '', guestPayment: '100000' })).coHostShare).toBe(0);
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

describe('payable stays', () => {
  const stay = (overrides: Partial<Parameters<typeof stayRef>[0]> = {}) => ({
    propertyId: 'main',
    propertyName: 'Main House',
    guestName: null as string | null,
    channel: 'Airbnb',
    checkInDate: '2026-10-10',
    checkOutDate: '2026-10-13',
    kind: 'imported' as const,
    bookingId: null as string | null,
    ...overrides,
  });

  it('keeps stays in the house now and ones that left in the last 30 days', () => {
    const staying = stay({ checkInDate: '2026-10-15', checkOutDate: '2026-10-19' });
    const leftRecently = stay({ checkInDate: '2026-09-15', checkOutDate: '2026-09-17' });
    const leftLongAgo = stay({ checkInDate: '2026-09-10', checkOutDate: '2026-09-16' });
    const upcoming = stay({ checkInDate: '2026-10-20', checkOutDate: '2026-10-22' });
    expect(payableStays([leftLongAgo, upcoming, leftRecently, staying], '2026-10-17'))
      .toEqual([staying, leftRecently]);
  });

  it('drops holds and feed blocks', () => {
    const hold = stay({ kind: 'hold' as never });
    const block = stay({ kind: 'imported-block' as never });
    expect(payableStays([hold, block], '2026-10-17')).toEqual([]);
  });

  it('puts the newest check-out first', () => {
    const older = stay({ checkOutDate: '2026-10-05', checkInDate: '2026-10-01' });
    const newer = stay({ checkOutDate: '2026-10-14', checkInDate: '2026-10-12' });
    expect(payableStays([older, newer], '2026-10-17')).toEqual([newer, older]);
  });

  it('builds a stay ref from the booking id when there is one, else the channel', () => {
    expect(stayRef(stay())).toBe('main:2026-10-10:2026-10-13:Airbnb');
    expect(stayRef(stay({ bookingId: 'bk_1', channel: 'Direct booking' }))).toBe('main:2026-10-10:2026-10-13:bk_1');
  });

  it('starts the window 30 days back', () => {
    expect(payableFromDate('2026-10-17')).toBe('2026-09-17');
  });

  it('formats short date ranges and who stayed', () => {
    expect(shortDateRange('2026-09-30', '2026-10-03')).toBe('9/30–10/3');
    expect(stayWho({ guestName: 'Tanaka', channel: 'Direct booking' })).toBe('Tanaka · Direct booking');
    expect(stayWho({ guestName: null, channel: 'Airbnb' })).toBe('Airbnb');
  });
});
