import { randomBytes } from 'node:crypto';
import type {
  Invoice,
  InvoiceLineItem,
  InvoiceRoundingMode,
  InvoiceTaxBreakdownRow,
  InvoiceTaxCategory,
} from '../store/types.js';

/**
 * Japanese qualified-invoice (適格請求書 / インボイス制度) arithmetic.
 *
 * Two rules from the NTA drive everything here and neither is negotiable:
 *
 *  1. Rounding happens **once per tax rate per invoice**, not per line. Adding
 *     up per-line tax and rounding each one produces a total that a tax office
 *     will reject, so lines carry only tax-inclusive amounts and the tax is
 *     derived from the per-rate subtotal below.
 *  2. The invoice must state, for every rate it uses, the rate itself, the
 *     total consideration at that rate, and the consumption tax on it — which
 *     is exactly what InvoiceTaxBreakdownRow is.
 *
 * Amounts are tax-inclusive (税込) whole yen throughout: what the guest paid is
 * what the booking recorded, and an invoice that totalled more than that would
 * be a different document from the one they settled.
 */

export const INVOICE_TAX_RATES: Record<InvoiceTaxCategory, number> = {
  // Accommodation is standard-rated.
  standard10: 0.1,
  // 軽減税率 — only reaches an invoice here when a stay bundles takeaway food.
  reduced8: 0.08,
  // 不課税・非課税, e.g. the Tokyo 宿泊税 a host collects on the metropolis's
  // behalf. It belongs on the invoice but carries no consumption tax.
  exempt: 0,
};

export const INVOICE_TAX_CATEGORIES = Object.keys(INVOICE_TAX_RATES) as InvoiceTaxCategory[];

export function isInvoiceTaxCategory(value: unknown): value is InvoiceTaxCategory {
  return typeof value === 'string' && value in INVOICE_TAX_RATES;
}

/**
 * A registration number is the letter T plus the 13-digit corporate number.
 * Stored uppercase with separators stripped so two hosts who type
 * "T-1234-..." and "t1234..." end up with the same string on their invoices.
 */
export function normalizeRegistrationNumber(value: string): string {
  return value.replace(/[\s\-‐-―ー]/g, '').toUpperCase();
}

export function isValidRegistrationNumber(value: string): boolean {
  return /^T\d{13}$/.test(normalizeRegistrationNumber(value));
}

/** T1234567890123 → T1234-5678-90123, which is how the NTA's own lookup prints it. */
export function formatRegistrationNumber(value: string): string {
  const normalized = normalizeRegistrationNumber(value);
  if (!isValidRegistrationNumber(normalized)) {
    return normalized;
  }
  return `${normalized.slice(0, 5)}-${normalized.slice(5, 9)}-${normalized.slice(9)}`;
}

function applyRounding(value: number, mode: InvoiceRoundingMode): number {
  switch (mode) {
    case 'ceil':
      return Math.ceil(value);
    case 'round':
      return Math.round(value);
    case 'floor':
    default:
      return Math.floor(value);
  }
}

/**
 * The consumption tax contained in a tax-inclusive amount: 税込 × 率/(1+率).
 *
 * The mode is the issuer's standing choice (切捨て/四捨五入/切上げ). It has to be
 * applied consistently, which is why it is a saved setting rather than a
 * per-invoice decision.
 */
export function taxFromInclusive(
  inclusiveTotal: number,
  rate: number,
  mode: InvoiceRoundingMode,
): number {
  if (rate <= 0) return 0;
  // Integer arithmetic, not `total * rate / (1 + rate)`. The float form makes
  // 33,000 at 10% come out as 2,999.9999999999995, which floors to ¥2,999 —
  // one yen short of the tax on a figure every Japanese guest recognises as
  // 30,000 + 3,000. Dividing exact integers is exact, so 330000/110 is 3000.
  const percent = Math.round(rate * 100);
  if (percent <= 0) return 0;
  return applyRounding((inclusiveTotal * percent) / (100 + percent), mode);
}

export function lineAmount(line: Pick<InvoiceLineItem, 'quantity' | 'unitPrice'>): number {
  return Math.round(line.quantity * line.unitPrice);
}

export interface InvoiceTotals {
  taxBreakdown: InvoiceTaxBreakdownRow[];
  subtotalTaxExclusive: number;
  totalTax: number;
  totalAmount: number;
}

/**
 * Rolls line items up into the per-rate table the invoice has to print.
 *
 * Rates with no lines are dropped: an invoice listing "8%対象 ¥0" invites the
 * reader to look for a reduced-rate item that is not there.
 */
export function computeInvoiceTotals(
  lines: InvoiceLineItem[],
  mode: InvoiceRoundingMode,
): InvoiceTotals {
  const byCategory = new Map<InvoiceTaxCategory, number>();
  for (const line of lines) {
    const amount = Math.round(line.amount);
    byCategory.set(line.taxCategory, (byCategory.get(line.taxCategory) ?? 0) + amount);
  }

  const taxBreakdown: InvoiceTaxBreakdownRow[] = INVOICE_TAX_CATEGORIES
    .filter((category) => byCategory.has(category))
    .map((category) => {
      const taxInclusiveTotal = byCategory.get(category) ?? 0;
      const taxRate = INVOICE_TAX_RATES[category];
      const taxAmount = taxFromInclusive(taxInclusiveTotal, taxRate, mode);
      return {
        taxCategory: category,
        taxRate,
        taxInclusiveTotal,
        taxExclusiveTotal: taxInclusiveTotal - taxAmount,
        taxAmount,
      };
    });

  const totalAmount = taxBreakdown.reduce((sum, row) => sum + row.taxInclusiveTotal, 0);
  const totalTax = taxBreakdown.reduce((sum, row) => sum + row.taxAmount, 0);

  return {
    taxBreakdown,
    subtotalTaxExclusive: totalAmount - totalTax,
    totalTax,
    totalAmount,
  };
}

/**
 * Human-readable invoice number, e.g. INV-2026-0007.
 *
 * The sequence is per issuer and per year and comes from the store, so two
 * hosts issuing at the same second never collide and one host's numbering has
 * no gaps — a gap is the first thing a tax audit asks about.
 */
export function buildInvoiceNo(prefix: string, fiscalYear: number, sequence: number): string {
  const safePrefix = (prefix || 'INV').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'INV';
  return `${safePrefix}-${fiscalYear}-${String(sequence).padStart(4, '0')}`;
}

export function generateInvoiceId(): string {
  return `INV-${randomBytes(8).toString('hex')}`;
}

export function generateLineItemId(): string {
  return randomBytes(6).toString('hex');
}

/** Identity of the stay an invoice was raised against, used to spot duplicates. */
export function invoiceSourceKey(sourceKind: Invoice['sourceKind'], sourceId: string | null): string | null {
  if (!sourceId) return null;
  return `${sourceKind}:${sourceId}`;
}

/** Nights, counted the way the calendar does: check-out morning is not a night. */
export function nightsBetween(checkInDate: string, checkOutDate: string): number {
  const start = Date.parse(`${checkInDate}T00:00:00Z`);
  const end = Date.parse(`${checkOutDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}
