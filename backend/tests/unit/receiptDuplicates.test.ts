import { describe, expect, it } from 'vitest';
import {
  findApprovedDuplicates,
  indexApprovedDuplicates,
  isComparable,
  yearsOf,
} from '../../src/domain/receiptDuplicates.js';
import { FinancialTransaction, PendingTransaction } from '../../src/store/types.js';

function approved(over: Partial<FinancialTransaction>): FinancialTransaction {
  return {
    id: 'txn-1',
    propertyId: 's01',
    transactionNo: 'T-0001',
    transactionDate: '2026-09-10',
    debitAccount: '消耗品費',
    debitAmount: 1280,
    creditAccount: '現金',
    creditAmount: 1280,
    description: 'ローソン',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...over,
  };
}

function pending(over: Partial<PendingTransaction>): PendingTransaction {
  return {
    id: 'p1',
    propertyId: 's01',
    gcsPath: 'gcs://bucket/a.jpg',
    receiptUrl: 'https://example.com/a.jpg',
    ocrProcessed: true,
    transactionDate: '2026-09-10',
    debitAccount: '消耗品費',
    debitAmount: 1280,
    creditAccount: '現金',
    creditAmount: 1280,
    description: '',
    vendor: 'ローソン',
    createdAt: 2_000,
    updatedAt: 2_000,
    ...over,
  };
}

describe('spotting a receipt that was already approved', () => {
  it('matches the same property, date and amount', () => {
    expect(findApprovedDuplicates(pending({}), [approved({})])).toHaveLength(1);
  });

  it('lets a different property, date or amount through', () => {
    const journal = [
      approved({ id: 'other-property', propertyId: 's02' }),
      approved({ id: 'other-day', transactionDate: '2026-09-11' }),
      approved({ id: 'other-amount', debitAmount: 1281 }),
    ];
    expect(findApprovedDuplicates(pending({}), journal)).toEqual([]);
  });

  it('still matches when the account was edited before approval', () => {
    // The host reclassifying 雑費 as 消耗品費 does not make it a second receipt,
    // and an approved entry keeps no vendor to compare against either — so the
    // rule deliberately rests on the three fields that survive both.
    const found = findApprovedDuplicates(
      pending({ debitAccount: '雑費' }),
      [approved({ debitAccount: '消耗品費' })],
    );
    expect(found).toHaveLength(1);
    expect(found[0].debitAccount).toBe('消耗品費');
  });

  it('says nothing about a receipt whose OCR has not run', () => {
    // Half the list is normally blank. Treating blank as a value would flag
    // every unread receipt against every other one.
    expect(isComparable(pending({ transactionDate: '', debitAmount: 0 }))).toBe(false);
    expect(findApprovedDuplicates(pending({ debitAmount: 0 }), [approved({ debitAmount: 0 })])).toEqual([]);
    expect(findApprovedDuplicates(pending({ transactionDate: '' }), [approved({ transactionDate: '' })])).toEqual([]);
  });

  it('puts the entry approved first at the top', () => {
    const found = findApprovedDuplicates(pending({}), [
      approved({ id: 'later', transactionNo: 'T-0009', createdAt: 5_000 }),
      approved({ id: 'earlier', transactionNo: 'T-0002', createdAt: 1_000 }),
    ]);
    // The host is trying to recognise a receipt they have seen before, so the
    // one they filed first is the one to show them.
    expect(found.map((row) => row.transactionNo)).toEqual(['T-0002', 'T-0009']);
  });

  it('answers for a whole list in one pass over the journal', () => {
    const list = [
      pending({ id: 'dup', debitAmount: 1280 }),
      pending({ id: 'clean', debitAmount: 640 }),
      pending({ id: 'unread', transactionDate: '', debitAmount: 0 }),
    ];
    const index = indexApprovedDuplicates(list, [approved({})]);

    expect(index.get('dup')).toHaveLength(1);
    expect(index.get('clean')).toEqual([]);
    // Every row gets an answer, so a caller never has to tell "no duplicates"
    // apart from "never checked".
    expect(index.get('unread')).toEqual([]);
    expect([...index.keys()].sort()).toEqual(['clean', 'dup', 'unread']);
  });
});

describe('which years the journal has to be read for', () => {
  it('returns each year once, in order, ignoring the unreadable', () => {
    expect(yearsOf([
      { transactionDate: '2026-09-10' },
      { transactionDate: '2025-12-31' },
      { transactionDate: '2026-01-02' },
      { transactionDate: '' },
    ])).toEqual([2025, 2026]);
  });
});
