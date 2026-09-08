import { describe, expect, it } from 'vitest';
import {
  buildInvoiceNo,
  computeInvoiceTotals,
  formatRegistrationNumber,
  isValidRegistrationNumber,
  normalizeRegistrationNumber,
  taxFromInclusive,
} from '../../src/domain/invoice.js';
import type { InvoiceLineItem } from '../../src/store/types.js';

const line = (
  amount: number,
  taxCategory: InvoiceLineItem['taxCategory'] = 'standard10',
): InvoiceLineItem => ({
  id: Math.random().toString(36).slice(2),
  description: 'line',
  quantity: 1,
  unitPrice: amount,
  amount,
  taxCategory,
});

describe('registration numbers', () => {
  it('accepts T plus 13 digits however the host types the separators', () => {
    expect(normalizeRegistrationNumber('t1234-5678-90123')).toBe('T1234567890123');
    expect(isValidRegistrationNumber('t1234-5678-90123')).toBe(true);
    expect(formatRegistrationNumber('T1234567890123')).toBe('T1234-5678-90123');
  });

  it('rejects anything that is not the real shape', () => {
    expect(isValidRegistrationNumber('1234567890123')).toBe(false);   // no T
    expect(isValidRegistrationNumber('T123456789012')).toBe(false);   // 12 digits
    expect(isValidRegistrationNumber('T12345678901234')).toBe(false); // 14 digits
  });
});

describe('consumption tax on a tax-inclusive amount', () => {
  it('extracts 10% from a tax-inclusive figure', () => {
    // 33,000 tax-inclusive is 30,000 + 3,000.
    expect(taxFromInclusive(33_000, 0.1, 'floor')).toBe(3_000);
  });

  it('honours the issuer rounding choice on a fraction', () => {
    // 10,000 × 10/110 = 909.09…
    expect(taxFromInclusive(10_000, 0.1, 'floor')).toBe(909);
    expect(taxFromInclusive(10_000, 0.1, 'round')).toBe(909);
    expect(taxFromInclusive(10_000, 0.1, 'ceil')).toBe(910);
  });
});

describe('computeInvoiceTotals', () => {
  it('rounds once per rate, not once per line', () => {
    // Three ¥10,000 lines. Per line the tax is 909.09… → 909 each, 2,727 total.
    // Rounded once on the ¥30,000 subtotal it is 2,727.27… → 2,727 as well, but
    // the rule is what matters: the breakdown must come from the subtotal.
    const totals = computeInvoiceTotals([line(10_000), line(10_000), line(10_000)], 'floor');
    expect(totals.taxBreakdown).toHaveLength(1);
    expect(totals.taxBreakdown[0].taxInclusiveTotal).toBe(30_000);
    expect(totals.taxBreakdown[0].taxAmount).toBe(taxFromInclusive(30_000, 0.1, 'floor'));
    expect(totals.totalAmount).toBe(30_000);
  });

  it('separates the rates an invoice actually uses and prints no others', () => {
    const totals = computeInvoiceTotals(
      [line(33_000), line(5_400, 'reduced8'), line(400, 'exempt')],
      'floor',
    );

    expect(totals.taxBreakdown.map((row) => row.taxCategory)).toEqual([
      'standard10',
      'reduced8',
      'exempt',
    ]);

    const [standard, reduced, exempt] = totals.taxBreakdown;
    expect(standard.taxAmount).toBe(3_000);
    expect(standard.taxExclusiveTotal).toBe(30_000);
    expect(reduced.taxAmount).toBe(400);
    expect(reduced.taxExclusiveTotal).toBe(5_000);
    // 宿泊税 and the like sit on the invoice but carry no consumption tax.
    expect(exempt.taxRate).toBe(0);
    expect(exempt.taxAmount).toBe(0);

    expect(totals.totalAmount).toBe(38_800);
    expect(totals.totalTax).toBe(3_400);
    expect(totals.subtotalTaxExclusive).toBe(35_400);
  });

  it('keeps the total equal to what the guest paid when a discount line is negative', () => {
    const totals = computeInvoiceTotals([line(33_000), line(-3_000)], 'floor');
    expect(totals.totalAmount).toBe(30_000);
    expect(totals.taxBreakdown[0].taxAmount).toBe(taxFromInclusive(30_000, 0.1, 'floor'));
  });
});

describe('invoice numbers', () => {
  it('is zero-padded and carries the issuer prefix and year', () => {
    expect(buildInvoiceNo('INV', 2026, 7)).toBe('INV-2026-0007');
    expect(buildInvoiceNo('sachi', 2026, 123)).toBe('SACHI-2026-0123');
  });

  it('falls back to INV rather than emitting a number with no prefix', () => {
    expect(buildInvoiceNo('', 2026, 1)).toBe('INV-2026-0001');
    expect(buildInvoiceNo('---', 2026, 1)).toBe('INV-2026-0001');
  });
});
