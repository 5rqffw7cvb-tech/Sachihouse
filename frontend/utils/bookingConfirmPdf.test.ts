import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { BookingConfirmation } from '../types';
import { downloadBookingConfirmationPdf } from './bookingConfirmPdf';

// propertyGuideLinks() is not exported — it is only reachable through the
// public download/attach functions below. We stub jspdf/html2canvas (the
// dynamic imports inside renderBookingConfirmationPdf) and record every
// pdf.textWithLink(label, x, y, { url }) call, which is exactly how the
// guide links end up in the rendered document.
const textWithLinkCalls: Array<{ label: string; url: string }> = [];

vi.mock('html2canvas', () => ({
  default: vi.fn(async () => ({
    width: 1588,
    height: 2000,
    toDataURL: () => 'data:image/jpeg;base64,AAAA',
  })),
}));

vi.mock('jspdf', () => {
  class FakeJsPDF {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    addImage() {}
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    text() {}
    addPage() {}
    textWithLink(label: string, _x: number, _y: number, opts: { url: string }) {
      textWithLinkCalls.push({ label, url: opts.url });
    }
    save() {}
    output() {
      return 'data:application/pdf;base64,AAAA';
    }
  }
  return { jsPDF: FakeJsPDF };
});

function makeConfirmation(overrides: Partial<BookingConfirmation> = {}): BookingConfirmation {
  return {
    id: 'c1',
    confirmationNo: 'SH-0001',
    propertyId: 'p1',
    propertyName: 'Sachi House Ojima',
    propertyAddress: '1-2-3 Ojima, Koto-ku, Tokyo',
    propertyUrl: 'https://sachi-house.net/sachi-ojima',
    guestName: 'Nguyen Van A',
    numGuests: 2,
    checkInDate: '2026-01-10',
    checkOutDate: '2026-01-12',
    checkInTime: '15:00',
    checkOutTime: '10:00',
    currency: 'JPY',
    roomFee: 20000,
    cleaningFee: 3000,
    extraFee: 0,
    discountAmount: 0,
    totalAmount: 23000,
    depositAmount: 23000,
    balanceDue: 0,
    includeInAccounting: true,
    source: 'manual',
    createdByUserId: 1,
    createdByName: 'Host',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('propertyGuideLinks (via downloadBookingConfirmationPdf)', () => {
  beforeEach(() => {
    textWithLinkCalls.length = 0;
  });

  it('normalizes a legacy hash-route base URL to path-based guide links with no "#"', async () => {
    await downloadBookingConfirmationPdf(makeConfirmation({ propertyUrl: 'https://sachi-house.net/#/sachi-ojima' }));

    expect(textWithLinkCalls).toHaveLength(3);
    const urls = textWithLinkCalls.map((c) => c.url);
    expect(urls).toEqual([
      'https://sachi-house.net/sachi-ojima/access',
      'https://sachi-house.net/sachi-ojima/rules',
      'https://sachi-house.net/sachi-ojima/manual',
    ]);
    urls.forEach((url) => expect(url).not.toContain('#'));
  });

  it('builds guide links straight from a modern path-based base URL', async () => {
    await downloadBookingConfirmationPdf(makeConfirmation({ propertyUrl: 'https://sachi-house.net/sachi-ojima' }));

    expect(textWithLinkCalls.map((c) => c.url)).toEqual([
      'https://sachi-house.net/sachi-ojima/access',
      'https://sachi-house.net/sachi-ojima/rules',
      'https://sachi-house.net/sachi-ojima/manual',
    ]);
  });

  it('strips a trailing slash before appending the sub-page', async () => {
    await downloadBookingConfirmationPdf(makeConfirmation({ propertyUrl: 'https://sachi-house.net/sachi-ojima/' }));

    expect(textWithLinkCalls.map((c) => c.url)).toEqual([
      'https://sachi-house.net/sachi-ojima/access',
      'https://sachi-house.net/sachi-ojima/rules',
      'https://sachi-house.net/sachi-ojima/manual',
    ]);
  });

  it('strips a trailing slash on the legacy hash-route root ("/#/") too', async () => {
    await downloadBookingConfirmationPdf(makeConfirmation({ propertyUrl: 'https://sachi-house.net/sachi-ojima/#/' }));

    const urls = textWithLinkCalls.map((c) => c.url);
    urls.forEach((url) => expect(url).not.toContain('#'));
    expect(urls[0]).toBe('https://sachi-house.net/sachi-ojima/access');
  });

  it('emits no guide links when the property has no URL on file', async () => {
    await downloadBookingConfirmationPdf(makeConfirmation({ propertyUrl: '' }));

    expect(textWithLinkCalls).toHaveLength(0);
  });
});
