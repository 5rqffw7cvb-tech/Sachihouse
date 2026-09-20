import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addMonths } from 'date-fns';
import { LanguageProvider } from '../contexts/LanguageContext';
import DateRangeCalendar from './DateRangeCalendar';
import { BookingDateSelection } from '../utils/dateRange';

/**
 * The floor of the calendar. `minDate` was added for the check-in form, which
 * must reach into the past; every other caller (BookingWidget,
 * SearchBookingModal, ListingsPage) passes nothing and must keep the old
 * behaviour — today is the earliest day, and the month arrow cannot walk back
 * out of the current month.
 */

// A mid-month day, so "yesterday" is a cell in the same month grid.
const FROZEN_NOW = new Date(2026, 8, 15, 10, 0, 0);

const emptySelection: BookingDateSelection = { checkIn: null, checkOut: null, selecting: 'checkIn' };

const renderCalendar = (props: Partial<React.ComponentProps<typeof DateRangeCalendar>> = {}) => {
  const onSelectDay = vi.fn();
  render(
    <LanguageProvider>
      <DateRangeCalendar selection={emptySelection} onSelectDay={onSelectDay} {...props} />
    </LanguageProvider>,
  );
  return { onSelectDay };
};

/** The grid cell for a day number in the month on screen. */
const dayCell = (day: number): HTMLElement => {
  const cell = screen.getAllByRole('button').find((node) => node.textContent?.trim() === String(day));
  if (!cell) throw new Error(`No day cell for ${day}`);
  return cell;
};

describe('DateRangeCalendar minDate', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FROZEN_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('without minDate refuses yesterday and will not walk back a month', () => {
    const { onSelectDay } = renderCalendar();

    expect(dayCell(14)).toBeDisabled();
    expect(dayCell(15)).toBeEnabled();
    expect(dayCell(16)).toBeEnabled();
    expect(screen.getByLabelText('Previous Month')).toBeDisabled();

    fireEvent.click(dayCell(14));
    expect(onSelectDay).not.toHaveBeenCalled();
  });

  it('with a minDate a year back lets yesterday be picked and the month walk back', () => {
    const { onSelectDay } = renderCalendar({ minDate: addMonths(FROZEN_NOW, -12) });

    expect(dayCell(14)).toBeEnabled();
    expect(screen.getByLabelText('Previous Month')).toBeEnabled();

    fireEvent.click(dayCell(14));
    expect(onSelectDay).toHaveBeenCalledTimes(1);
    const picked = onSelectDay.mock.calls[0][0] as Date;
    expect(picked.getFullYear()).toBe(2026);
    expect(picked.getMonth()).toBe(8);
    expect(picked.getDate()).toBe(14);
  });

  it('still opens on the current month even when minDate is far in the past', () => {
    renderCalendar({ minDate: addMonths(FROZEN_NOW, -12) });

    expect(screen.getByText('September 2026')).toBeInTheDocument();
  });

  it('keeps the forward limit measured from today, not from minDate', () => {
    // maxMonthsAhead is still anchored on today, so a past minDate must not
    // buy the guest extra months at the far end.
    renderCalendar({ minDate: addMonths(FROZEN_NOW, -12), maxMonthsAhead: 1 });

    const next = screen.getByLabelText('Next Month');
    fireEvent.click(next);
    expect(screen.getByText('October 2026')).toBeInTheDocument();
    expect(next).toBeDisabled();
  });
});
