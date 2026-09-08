import {
  InvoiceCandidate,
  InvoiceLineItem,
  InvoiceRoundingMode,
  InvoiceTaxBreakdownRow,
  InvoiceTaxCategory,
} from '../types';

/**
 * Turning a stay into an invoice draft, shared by the console page and the
 * phone app's sheet so the two produce identical documents.
 *
 * The tax arithmetic is duplicated from backend/src/domain/invoice.ts on
 * purpose: the server recomputes it and its answer is authoritative, but the
 * host has to see the ¥ figure before pressing "issue", and shipping the whole
 * total round-tripped to the server per keystroke would be worse. Both sides
 * use integer arithmetic, so they agree exactly — see the comment in
 * taxFromInclusive about why the float form is wrong.
 */

export const TAX_CATEGORY_RATES: Record<InvoiceTaxCategory, number> = {
  standard10: 0.1,
  reduced8: 0.08,
  exempt: 0,
};

export const TAX_CATEGORY_ORDER: InvoiceTaxCategory[] = ['standard10', 'reduced8', 'exempt'];

/** Japanese label with the English gloss the whole feature is bilingual in. */
export const TAX_CATEGORY_LABELS: Record<InvoiceTaxCategory, { ja: string; en: string }> = {
  standard10: { ja: '10%対象', en: 'Standard 10%' },
  reduced8: { ja: '8%対象（軽減税率）', en: 'Reduced 8%' },
  exempt: { ja: '対象外', en: 'Not taxable' },
};

export function taxFromInclusive(
  inclusiveTotal: number,
  rate: number,
  mode: InvoiceRoundingMode,
): number {
  const percent = Math.round(rate * 100);
  if (percent <= 0) return 0;
  const exact = (inclusiveTotal * percent) / (100 + percent);
  if (mode === 'ceil') return Math.ceil(exact);
  if (mode === 'round') return Math.round(exact);
  return Math.floor(exact);
}

export interface InvoiceTotals {
  taxBreakdown: InvoiceTaxBreakdownRow[];
  subtotalTaxExclusive: number;
  totalTax: number;
  totalAmount: number;
}

/** Rolls lines up per tax rate, rounding once per rate as the NTA requires. */
export function computeInvoiceTotals(
  lines: Array<Pick<InvoiceLineItem, 'amount' | 'taxCategory'>>,
  mode: InvoiceRoundingMode,
): InvoiceTotals {
  const byCategory = new Map<InvoiceTaxCategory, number>();
  lines.forEach((line) => {
    const amount = Math.round(line.amount);
    byCategory.set(line.taxCategory, (byCategory.get(line.taxCategory) ?? 0) + amount);
  });

  const taxBreakdown = TAX_CATEGORY_ORDER
    .filter((category) => byCategory.has(category))
    .map((category) => {
      const taxInclusiveTotal = byCategory.get(category) ?? 0;
      const taxRate = TAX_CATEGORY_RATES[category];
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

  return { taxBreakdown, subtotalTaxExclusive: totalAmount - totalTax, totalTax, totalAmount };
}

/** A line as the editor holds it: no server id yet, amount is what gets sent. */
export type DraftLineItem = Omit<InvoiceLineItem, 'id'> & { key: string };

let lineKeySeed = 0;
export function newLineKey(): string {
  lineKeySeed += 1;
  return `line-${lineKeySeed}`;
}

export function draftLine(
  description: string,
  amount: number,
  taxCategory: InvoiceTaxCategory = 'standard10',
  quantity = 1,
): DraftLineItem {
  return {
    key: newLineKey(),
    description,
    quantity,
    unitPrice: quantity === 0 ? 0 : Math.round(amount / quantity),
    amount: Math.round(amount),
    taxCategory,
  };
}

export interface InvoiceDraft {
  candidate: InvoiceCandidate;
  issueDate: string;
  customerName: string;
  customerAddress: string;
  customerEmail: string;
  customerPhone: string;
  customerSource: 'checkin' | 'booking' | 'manual';
  lineItems: DraftLineItem[];
  notes: string;
}

function isoToday(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The draft a host starts from.
 *
 * Names and addresses come from the check-in form's main guest when there is
 * one — that is the only place in the system with a real, verified name and a
 *住所 for the 宛名, which is the whole reason the feature reads check-ins at
 * all. An OTA import has neither a name nor a price, so it opens with empty
 * amounts rather than a plausible-looking zero total the host might not notice.
 */
export function buildInvoiceDraft(
  candidate: InvoiceCandidate,
  options?: { defaultTaxCategory?: InvoiceTaxCategory; defaultNotes?: string },
): InvoiceDraft {
  const taxCategory = options?.defaultTaxCategory ?? 'standard10';
  const stayLabel = `宿泊料金 ${candidate.checkInDate}〜${candidate.checkOutDate}（${candidate.nights}泊）`;

  const lineItems: DraftLineItem[] = [];
  if (candidate.roomFee !== 0 || candidate.totalAmount === 0) {
    lineItems.push(draftLine(stayLabel, candidate.roomFee, taxCategory));
  }
  if (candidate.cleaningFee > 0) {
    lineItems.push(draftLine('清掃料金 / Cleaning fee', candidate.cleaningFee, taxCategory));
  }
  if (candidate.extraFee > 0) {
    lineItems.push(draftLine(candidate.extraFeeLabel?.trim() || '追加料金 / Additional charge', candidate.extraFee, taxCategory));
  }
  if (candidate.discountAmount > 0) {
    // Negative, in the same tax category, so it nets off the subtotal before
    // the tax is worked out — a discount shown outside the tax table would
    // leave the invoice claiming tax on money nobody paid.
    lineItems.push(
      draftLine(candidate.discountLabel?.trim() || '割引 / Discount', -candidate.discountAmount, taxCategory),
    );
  }
  if (lineItems.length === 0) {
    lineItems.push(draftLine(stayLabel, 0, taxCategory));
  }

  const checkIn = candidate.checkIn;
  return {
    candidate,
    issueDate: isoToday(),
    customerName: checkIn?.fullName || candidate.guestName || '',
    customerAddress: checkIn?.address || '',
    customerEmail: '',
    customerPhone: checkIn?.contactInfo || '',
    customerSource: checkIn ? 'checkin' : candidate.guestName ? 'booking' : 'manual',
    lineItems,
    notes: options?.defaultNotes ?? '',
  };
}

export function formatYen(amount: number, currency = 'JPY'): string {
  const code = (currency || 'JPY').toUpperCase();
  if (code === 'JPY') return `¥${Math.round(amount).toLocaleString('ja-JP')}`;
  return `${code} ${Math.round(amount).toLocaleString('en-US')}`;
}

/** T1234567890123 → T1234-5678-90123, the way the NTA's lookup prints it. */
export function formatRegistrationNumber(value: string): string {
  const normalized = value.replace(/[\s\-]/g, '').toUpperCase();
  if (!/^T\d{13}$/.test(normalized)) return normalized;
  return `${normalized.slice(0, 5)}-${normalized.slice(5, 9)}-${normalized.slice(9)}`;
}

export function isValidRegistrationNumber(value: string): boolean {
  return /^T\d{13}$/.test(value.replace(/[\s\-]/g, '').toUpperCase());
}
