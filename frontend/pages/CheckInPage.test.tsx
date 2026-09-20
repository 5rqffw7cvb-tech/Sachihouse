import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../contexts/LanguageContext';
import type { PropertyData } from '../types';

/**
 * The two stay dates of the check-in form. They used to be
 * `<input type="date">`; they are now buttons opening the shared calendar, and
 * the times beside them are untouched native inputs.
 */

vi.mock('../services/checkin', () => ({
  startCheckInSession: vi.fn(async () => ({
    checkinToken: 'tok-1',
    expiresInSeconds: 900,
    consentPolicy: { retentionDays: 180, noticeVersion: 'v1' },
  })),
  matchCheckInBooking: vi.fn(async () => true),
  ocrGuestDocument: vi.fn(),
  submitCheckIn: vi.fn(),
}));

vi.mock('../services/storage', () => ({
  getSiteSettings: vi.fn(async () => ({ navTitle: 'SachiHouse' })),
}));

vi.mock('../services/auth', () => ({
  getCurrentUser: () => null,
  subscribeToAuth: vi.fn(async () => () => {}),
  logout: vi.fn(),
}));

vi.mock('../utils/checkinPhotoStore', () => ({
  clearCheckInPhotos: vi.fn(async () => {}),
  deleteCheckInPhoto: vi.fn(async () => {}),
  getCheckInPhoto: vi.fn(async () => null),
  saveCheckInPhoto: vi.fn(async () => {}),
}));

const { default: CheckInPage } = await import('./CheckInPage');

const property = {
  id: 's01',
  name: 'Sachi House 01',
  subtitle: '',
  description: '',
  address: '',
  mapEmbedUrl: '',
  hostName: 'Host',
} as unknown as PropertyData;

/** Renders the form past the residency question, which gates it. */
async function renderForm() {
  const view = render(
    <MemoryRouter>
      <LanguageProvider>
        <CheckInPage data={property} propertyId="s01" />
      </LanguageProvider>
    </MemoryRouter>,
  );

  const resident = await screen.findByRole('button', { name: 'Yes, I live in Japan' });
  fireEvent.click(resident);
  await screen.findByRole('button', { name: 'Check-in' });
  return view;
}

/** A day cell inside the open sheet. */
const dayCell = (dialog: HTMLElement, day: number): HTMLElement => {
  const cell = within(dialog).getAllByRole('button').find((node) => node.textContent?.trim() === String(day));
  if (!cell) throw new Error(`No day cell for ${day}`);
  return cell;
};

describe('CheckInPage stay dates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Only Date is faked, so the page's autosave timer still behaves. A
    // mid-month day keeps the default range (the 15th to the 16th) and its
    // neighbours inside the month grid on screen.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 15, 10, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has no native date input left, and still both time inputs', async () => {
    const { container } = await renderForm();

    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(0);
    expect(container.querySelectorAll('input[type="time"]')).toHaveLength(2);
  });

  it('shows a formatted date on each trigger, not a raw value or a key', async () => {
    await renderForm();

    const checkInTrigger = screen.getByRole('button', { name: 'Check-in' });
    const checkOutTrigger = screen.getByRole('button', { name: 'Check-out' });

    // "Sep 20, 2026" — a localised label, never YYYY-MM-DD and never the
    // translation key itself.
    for (const trigger of [checkInTrigger, checkOutTrigger]) {
      const label = trigger.textContent?.trim() ?? '';
      expect(label).not.toBe('');
      expect(label).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(label).not.toMatch(/^[a-z_]+$/);
      expect(label).toMatch(/\d{4}$/);
    }
  });

  it('opens the sheet from a trigger and writes a past check-in back to it', async () => {
    await renderForm();

    const before = screen.getByRole('button', { name: 'Check-in' }).textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Check-in' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // The 3rd is in the past — impossible before, and the reason the picker
    // exists. The default check-out (the 16th) still follows it, so the range
    // is complete and the sheet closes on this one tap.
    fireEvent.click(dayCell(dialog, 3));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const afterIn = screen.getByRole('button', { name: 'Check-in' }).textContent ?? '';
    const afterOut = screen.getByRole('button', { name: 'Check-out' }).textContent ?? '';
    expect(afterIn).not.toBe(before);
    expect(afterIn).toBe('Sep 3, 2026');
    expect(afterOut).toBe('Sep 16, 2026');
  });

  it('asks for the other end when the new check-in lands past the old check-out', async () => {
    await renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Check-in' }));
    const dialog = await screen.findByRole('dialog');

    // The 20th is after the default check-out, so that check-out is dropped
    // and the form must not hear a word until the second tap.
    fireEvent.click(dayCell(dialog, 20));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check-out' })).toHaveTextContent('Sep 16, 2026');

    fireEvent.click(dayCell(dialog, 22));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'Check-in' })).toHaveTextContent('Sep 20, 2026');
    expect(screen.getByRole('button', { name: 'Check-out' })).toHaveTextContent('Sep 22, 2026');
  });

  it('marks only the trigger that opened the sheet as expanded', async () => {
    await renderForm();

    const checkIn = () => screen.getByRole('button', { name: 'Check-in' });
    const checkOut = () => screen.getByRole('button', { name: 'Check-out' });

    // Shut: neither is expanded, and both still advertise the dialog.
    expect(checkIn()).toHaveAttribute('aria-expanded', 'false');
    expect(checkOut()).toHaveAttribute('aria-expanded', 'false');
    expect(checkIn()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(checkOut()).toHaveAttribute('aria-haspopup', 'dialog');

    // Opened from check-out: only that one owns the open sheet.
    fireEvent.click(checkOut());
    await screen.findByRole('dialog');
    expect(checkOut()).toHaveAttribute('aria-expanded', 'true');
    expect(checkIn()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(checkOut()).toHaveAttribute('aria-expanded', 'false');

    // And the other way round.
    fireEvent.click(checkIn());
    await screen.findByRole('dialog');
    expect(checkIn()).toHaveAttribute('aria-expanded', 'true');
    expect(checkOut()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes from the sheet X and hands focus back to the trigger that opened it', async () => {
    await renderForm();

    const checkOut = () => screen.getByRole('button', { name: 'Check-out' });
    fireEvent.click(checkOut());
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(checkOut()).toHaveAttribute('aria-expanded', 'false');
    expect(checkOut()).toHaveFocus();
  });

  it('leaves the dates alone when the sheet is dismissed without a full range', async () => {
    await renderForm();

    const before = screen.getByRole('button', { name: 'Check-out' }).textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Check-out' }));
    await screen.findByRole('dialog');

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Check-out' }).textContent).toBe(before);
  });
});
