import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CleaningPayout } from '../../services/cleaningPayouts';
import type { HostStay } from '../../services/hostApp';
import { stayRef } from '../../utils/cleaningPay';
import { MANUAL_STAY, StayPicker } from './StayPicker';

const TODAY = '2026-10-17';

const stay = (over: Partial<HostStay>): HostStay => ({
  key: over.key ?? 'k',
  propertyId: 'main',
  propertyName: 'Main House',
  guestName: null,
  channel: 'Airbnb',
  checkInDate: '2026-10-10',
  checkOutDate: '2026-10-13',
  guestCount: null,
  kind: 'imported',
  bookingId: null,
  amountTotal: null,
  currency: null,
  summary: null,
  description: null,
  feedName: null,
  ...over,
});

const staying = stay({ key: 'a', guestName: 'Tanaka', channel: 'Direct booking', bookingId: 'b1', checkInDate: '2026-10-16', checkOutDate: '2026-10-19' });
const leftUnpaid = stay({ key: 'b', checkInDate: '2026-10-10', checkOutDate: '2026-10-13' });
const leftPaid = stay({ key: 'c', channel: 'Booking.com', checkInDate: '2026-10-01', checkOutDate: '2026-10-04' });

const payout = { id: 'p1', total: 12980, stayRef: stayRef(leftPaid) } as CleaningPayout;
const paidByRef = new Map([[stayRef(leftPaid), payout]]);

function renderPicker(value = '', onChange = vi.fn()) {
  render(
    <StayPicker
      stays={[staying, leftUnpaid, leftPaid]}
      paidByRef={paidByRef}
      today={TODAY}
      value={value}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe('StayPicker', () => {
  it('shows how many stays are unpaid before one is chosen', () => {
    renderPicker();
    expect(screen.getByText('Choose a stay')).toBeTruthy();
    expect(screen.getByText('2 unpaid in the last 30 days')).toBeTruthy();
  });

  it('lists unpaid stays by default, grouped by whether they are still in the house', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /Choose a stay/ }));
    expect(screen.getByText('In the house now')).toBeTruthy();
    expect(screen.getByText('Checked out')).toBeTruthy();
    expect(screen.getByText('Tanaka')).toBeTruthy();
    expect(screen.getByText('STAYING')).toBeTruthy();
    expect(screen.queryByText('PAID')).toBeNull();
  });

  it('shows paid stays with their amount under the Paid filter', () => {
    renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /Choose a stay/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Paid 1' }));
    expect(screen.getByText('PAID')).toBeTruthy();
    expect(screen.getByText('¥12,980')).toBeTruthy();
    expect(screen.queryByText('Tanaka')).toBeNull();
  });

  it('reports the chosen stay and closes', () => {
    const onChange = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /Choose a stay/ }));
    fireEvent.click(screen.getByText('Tanaka'));
    expect(onChange).toHaveBeenCalledWith(stayRef(staying));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers manual entry', () => {
    const onChange = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /Choose a stay/ }));
    fireEvent.click(screen.getByText('Enter by hand (no matching stay)'));
    expect(onChange).toHaveBeenCalledWith(MANUAL_STAY);
  });

  it('shows the chosen stay in the field', () => {
    renderPicker(stayRef(staying));
    expect(screen.getByText('Tanaka')).toBeTruthy();
    expect(screen.getByText('Main House · 10/16–10/19 · 3 nights')).toBeTruthy();
  });
});
