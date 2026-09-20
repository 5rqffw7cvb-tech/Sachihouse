import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../contexts/LanguageContext';
import CheckInDateSheet, { formatCheckInDateLabel } from './CheckInDateSheet';
import { enUS } from 'date-fns/locale';

/**
 * The sheet replaces the two `<input type="date">` of the check-in form. Its
 * contract: the form only ever hears about a *complete* pair of dates, and it
 * hears about it once.
 */

const FROZEN_NOW = new Date(2026, 8, 15, 10, 0, 0);
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const renderSheet = (props: Partial<React.ComponentProps<typeof CheckInDateSheet>> = {}) => {
  const onApply = vi.fn();
  const onClose = vi.fn();
  const result = render(
    <LanguageProvider>
      <CheckInDateSheet
        open
        initialSelecting="checkIn"
        checkIn=""
        checkOut=""
        onApply={onApply}
        onClose={onClose}
        {...props}
      />
    </LanguageProvider>,
  );
  return { onApply, onClose, ...result };
};

/** A day cell in the month grid (the summary buttons carry a label + a date). */
const dayCell = (day: number): HTMLElement => {
  const cell = screen.getAllByRole('button').find((node) => node.textContent?.trim() === String(day));
  if (!cell) throw new Error(`No day cell for ${day}`);
  return cell;
};

describe('CheckInDateSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('commits both ends once, after a past check-in and a later check-out', () => {
    const { onApply } = renderSheet({ initialSelecting: 'checkIn' });

    // A stay that already started: the whole point of the new picker.
    fireEvent.click(dayCell(10));
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(dayCell(12));
    expect(onApply).toHaveBeenCalledTimes(1);

    const [nextIn, nextOut] = onApply.mock.calls[0];
    expect(nextIn).toMatch(YMD);
    expect(nextOut).toMatch(YMD);
    expect(nextIn < nextOut).toBe(true);
    expect(nextIn).toBe('2026-09-10');
    expect(nextOut).toBe('2026-09-12');
  });

  it('tells the form nothing when only one end was picked before closing', () => {
    const { onApply, onClose } = renderSheet({ initialSelecting: 'checkIn', checkIn: '', checkOut: '' });

    fireEvent.click(dayCell(10));
    // The footer button is the only "Done" now that the header X answers to
    // "Close", so this query needs no disambiguation.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('gives the header X and the footer button distinct accessible names', () => {
    renderSheet();

    // Each name resolves to exactly one control: getByRole throws on several
    // matches, so these two calls are the assertion.
    const close = screen.getByRole('button', { name: 'Close' });
    const done = screen.getByRole('button', { name: 'Done' });

    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Done' })).toHaveLength(1);
    expect(close).not.toBe(done);
    // The X is the icon-only one, so its name can only come from aria-label;
    // "Done" is the full-width button that reads its own text.
    expect(close).toHaveAttribute('aria-label', 'Close');
    expect(close.textContent?.trim()).toBe('');
    expect(done.textContent?.trim()).toBe('Done');
  });

  it('closes from the header X without touching the form', () => {
    const { onApply, onClose } = renderSheet({ initialSelecting: 'checkIn', checkIn: '', checkOut: '' });

    fireEvent.click(dayCell(10));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('commits on a single tap when it opened on the check-out end', () => {
    const { onApply } = renderSheet({
      initialSelecting: 'checkOut',
      checkIn: '2026-09-10',
      checkOut: '2026-09-12',
    });

    fireEvent.click(dayCell(18));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('2026-09-10', '2026-09-18');
  });

  it('closes on Escape without touching the form', () => {
    const { onApply, onClose } = renderSheet();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('closes on a backdrop tap without touching the form', () => {
    const { onApply, onClose, container } = renderSheet();

    fireEvent.click(container.firstChild as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('does not close when the panel itself is tapped', () => {
    const { onClose } = renderSheet();

    fireEvent.click(screen.getByRole('dialog'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('titles itself by the end being picked', () => {
    const { rerender } = renderSheet({ initialSelecting: 'checkIn' });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Select check-in date');

    // Once a check-in is down, the next tap is a check-out and the title says so.
    fireEvent.click(dayCell(10));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Select check-out date');

    rerender(
      <LanguageProvider>
        <CheckInDateSheet
          open
          initialSelecting="checkOut"
          checkIn="2026-09-10"
          checkOut="2026-09-12"
          onApply={vi.fn()}
          onClose={vi.fn()}
        />
      </LanguageProvider>,
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Select check-out date');
  });

  it('renders nothing while closed', () => {
    const { container } = renderSheet({ open: false });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('formatCheckInDateLabel', () => {
  it('turns a YYYY-MM-DD into the localised medium date', () => {
    expect(formatCheckInDateLabel('2026-09-20', enUS)).toBe('Sep 20, 2026');
  });

  it('reads the day in local time, not UTC', () => {
    // `new Date('2026-09-20')` is UTC midnight and would print the 19th west
    // of Greenwich — the bug this parse exists to avoid.
    expect(formatCheckInDateLabel('2026-01-01', enUS)).toBe('Jan 1, 2026');
  });

  it('gives an empty label for an empty or malformed value', () => {
    expect(formatCheckInDateLabel('', enUS)).toBe('');
    expect(formatCheckInDateLabel('20-09-2026', enUS)).toBe('');
  });
});
