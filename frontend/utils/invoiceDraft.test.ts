import { describe, expect, it } from 'vitest';
import { buildInvoiceDraft, computeInvoiceTotals, draftLine, taxFromInclusive } from './invoiceDraft';
import { InvoiceCandidate } from '../types';

const candidate = (overrides: Partial<InvoiceCandidate> = {}): InvoiceCandidate => ({
  key: 'booking_confirmation:bc_1',
  sourceKind: 'booking_confirmation',
  sourceId: 'bc_1',
  sourceLabel: 'Manual',
  propertyId: 'main',
  propertyName: 'Sachi House',
  propertyAddress: '東京都豊島区',
  guestName: 'Booking Name',
  checkInDate: '2026-09-01',
  checkOutDate: '2026-09-04',
  nights: 3,
  numGuests: 2,
  currency: 'JPY',
  roomFee: 30_000,
  cleaningFee: 5_000,
  extraFee: 0,
  discountAmount: 0,
  totalAmount: 35_000,
  reference: 'BC-20260901-AB12',
  checkIn: null,
  existingInvoice: null,
  ...overrides,
});

describe('client-side tax preview', () => {
  // The server recomputes and its answer is authoritative, so the two have to
  // agree exactly — a preview that says ¥3,000 and a PDF that says ¥2,999
  // would be worse than no preview at all.
  it('extracts the tax from a tax-inclusive figure without floating-point drift', () => {
    expect(taxFromInclusive(33_000, 0.1, 'floor')).toBe(3_000);
    expect(taxFromInclusive(5_400, 0.08, 'floor')).toBe(400);
  });

  it('rounds once per rate and lists only the rates in use', () => {
    const totals = computeInvoiceTotals(
      [draftLine('room', 33_000), draftLine('breakfast', 5_400, 'reduced8')],
      'floor',
    );
    expect(totals.taxBreakdown.map((row) => row.taxCategory)).toEqual(['standard10', 'reduced8']);
    expect(totals.totalTax).toBe(3_400);
    expect(totals.totalAmount).toBe(38_400);
  });
});

describe('buildInvoiceDraft', () => {
  it('bills the check-in form’s main guest, not the name on the booking', () => {
    const draft = buildInvoiceDraft(candidate({
      checkIn: {
        submissionId: 'ci_1',
        fullName: 'TANAKA YUKI',
        address: '大阪府大阪市…',
        nationality: 'Japan',
        guestCount: 2,
      },
    }));

    expect(draft.customerName).toBe('TANAKA YUKI');
    expect(draft.customerAddress).toBe('大阪府大阪市…');
    expect(draft.customerSource).toBe('checkin');
  });

  it('falls back to the booking name when nobody checked in', () => {
    const draft = buildInvoiceDraft(candidate());
    expect(draft.customerName).toBe('Booking Name');
    expect(draft.customerSource).toBe('booking');
  });

  it('splits room and cleaning into their own lines, totalling what was paid', () => {
    const draft = buildInvoiceDraft(candidate());
    expect(draft.lineItems).toHaveLength(2);
    expect(computeInvoiceTotals(draft.lineItems, 'floor').totalAmount).toBe(35_000);
  });

  it('keeps a discount inside the tax base rather than beside it', () => {
    const draft = buildInvoiceDraft(candidate({
      roomFee: 30_000,
      cleaningFee: 5_000,
      discountAmount: 5_000,
      discountLabel: '長期割',
      totalAmount: 30_000,
    }));

    const discountLine = draft.lineItems.find((line) => line.description === '長期割');
    expect(discountLine?.amount).toBe(-5_000);
    expect(discountLine?.taxCategory).toBe('standard10');
    expect(computeInvoiceTotals(draft.lineItems, 'floor').totalAmount).toBe(30_000);
  });

  it('opens an OTA import with a blank amount rather than a plausible zero total', () => {
    const draft = buildInvoiceDraft(candidate({
      sourceKind: 'imported',
      sourceLabel: 'Airbnb',
      guestName: null,
      roomFee: 0,
      cleaningFee: 0,
      totalAmount: 0,
    }));

    expect(draft.lineItems).toHaveLength(1);
    expect(draft.lineItems[0].amount).toBe(0);
    expect(draft.customerName).toBe('');
    expect(draft.customerSource).toBe('manual');
  });
});
