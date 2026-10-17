/**
 * What one cleaning job pays out.
 *
 * The rules are simple and live in one place so the sheet and its test agree:
 *  - a whole-house clean is a flat fee, 8,000 yen unless overridden;
 *  - a co-host also earns 3% of what the guest paid for that stay;
 *  - a bonus is whatever the host types in;
 *  - supplies bought for the house are reimbursed at cost.
 *
 * Inputs are the raw strings from the form fields, so a half-typed or empty
 * field counts as zero instead of turning the total into NaN.
 */

export const DEFAULT_CLEANING_FEE = 8000;
export const CO_HOST_RATE = 0.03;

export interface CleaningPayDraft {
  cleaningFee: string;
  isCoHost: boolean;
  guestPayment: string;
  bonus: string;
  supplies: string;
}

export interface CleaningPayBreakdown {
  cleaningFee: number;
  coHostShare: number;
  bonus: number;
  supplies: number;
  total: number;
}

/** Reads a yen amount typed with or without commas, ¥ or spaces. */
export function parseYen(value: string): number {
  const amount = Number(value.replace(/[¥￥,\s]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
}

export function calculateCleaningPay(draft: CleaningPayDraft): CleaningPayBreakdown {
  const cleaningFee = parseYen(draft.cleaningFee);
  // Rounded once on the share itself, so the breakdown lines add up to the total.
  const coHostShare = draft.isCoHost ? Math.round(parseYen(draft.guestPayment) * CO_HOST_RATE) : 0;
  const bonus = parseYen(draft.bonus);
  const supplies = parseYen(draft.supplies);
  return {
    cleaningFee,
    coHostShare,
    bonus,
    supplies,
    total: cleaningFee + coHostShare + bonus + supplies,
  };
}

export function formatYen(amount: number): string {
  return `¥${amount.toLocaleString('ja-JP')}`;
}
