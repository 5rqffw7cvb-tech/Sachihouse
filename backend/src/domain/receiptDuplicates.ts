import { FinancialTransaction, PendingTransaction } from '../store/types.js';

/**
 * Telling a receipt that has already been approved from one that has not.
 *
 * The desktop journal only ever compared unapproved rows against each other,
 * which catches the same photo uploaded twice in one sitting and nothing else.
 * The way a receipt actually gets paid for twice is slower: it is approved,
 * the paper stays in a pocket, and weeks later somebody photographs it again.
 * By then the first copy has left pending_transactions entirely, so no amount
 * of comparing pending rows can see it.
 *
 * What an approved entry keeps is therefore what the rule can use. Approval
 * drops the vendor — financial_transactions has no column for it — so the
 * comparison is the property, the date and the amount, and those three are
 * enough to be worth stopping for: the same shop, the same day, the same yen.
 *
 * It is a question, never a verdict. Two ¥500 coffees on one afternoon are a
 * real pair of receipts, and the person holding both pieces of paper is the
 * one who can say so. Everything here does is put the approved entry in front
 * of them before they decide.
 */

/** The approved entry a pending receipt might be a second copy of. */
export interface ApprovedDuplicate {
  id: string;
  transactionNo: string;
  transactionDate: string;
  debitAccount: string;
  debitAmount: number;
  description: string;
}

/** What the comparison needs from a pending row. Narrower than the row itself
 *  so a draft the host is still editing can be checked before it is saved. */
export interface DuplicateCandidate {
  propertyId: string;
  transactionDate: string;
  debitAmount: number;
}

/**
 * A row with no date or no amount says nothing to compare.
 *
 * That is the normal state of a receipt whose OCR has not run yet, and
 * treating it as matching every other blank row would flag the whole unread
 * half of the list against itself.
 */
export function isComparable(candidate: DuplicateCandidate): boolean {
  return Boolean(candidate.transactionDate) && candidate.debitAmount > 0;
}

function matchKey(propertyId: string, transactionDate: string, debitAmount: number): string {
  return `${propertyId}|${transactionDate}|${debitAmount}`;
}

function toDuplicate(txn: FinancialTransaction): ApprovedDuplicate {
  return {
    id: txn.id,
    transactionNo: txn.transactionNo,
    transactionDate: txn.transactionDate,
    debitAccount: txn.debitAccount,
    debitAmount: txn.debitAmount,
    description: txn.description,
  };
}

/** Every approved entry this candidate could be a second copy of, oldest
 *  first — the first one approved is the one the host will recognise. */
export function findApprovedDuplicates(
  candidate: DuplicateCandidate,
  approved: FinancialTransaction[],
): ApprovedDuplicate[] {
  if (!isComparable(candidate)) {
    return [];
  }
  const wanted = matchKey(candidate.propertyId, candidate.transactionDate, candidate.debitAmount);
  return approved
    .filter((txn) => matchKey(txn.propertyId, txn.transactionDate, txn.debitAmount) === wanted)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(toDuplicate);
}

/**
 * The same question asked once for a whole list, keyed by pending id.
 *
 * Indexed rather than filtered per row: the pending list is read on every
 * visit to the receipts screen, and running the journal end to end once per
 * unapproved receipt is work that grows with the square of a busy month.
 */
export function indexApprovedDuplicates(
  pendings: PendingTransaction[],
  approved: FinancialTransaction[],
): Map<string, ApprovedDuplicate[]> {
  const byKey = new Map<string, FinancialTransaction[]>();
  for (const txn of approved) {
    const key = matchKey(txn.propertyId, txn.transactionDate, txn.debitAmount);
    const list = byKey.get(key);
    if (list) list.push(txn);
    else byKey.set(key, [txn]);
  }

  const result = new Map<string, ApprovedDuplicate[]>();
  for (const pending of pendings) {
    if (!isComparable(pending)) {
      result.set(pending.id, []);
      continue;
    }
    const matches = byKey.get(matchKey(pending.propertyId, pending.transactionDate, pending.debitAmount)) ?? [];
    result.set(pending.id, [...matches].sort((a, b) => a.createdAt - b.createdAt).map(toDuplicate));
  }
  return result;
}

/** The calendar years a set of receipts falls in — what the journal has to be
 *  read for, rather than reading all of it. */
export function yearsOf(candidates: Array<{ transactionDate: string }>): number[] {
  const years = new Set<number>();
  for (const candidate of candidates) {
    const year = Number(candidate.transactionDate?.slice(0, 4));
    if (Number.isInteger(year) && year > 1970) years.add(year);
  }
  return [...years].sort();
}
