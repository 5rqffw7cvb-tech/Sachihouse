import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../services/api';
import type { CleaningEvent, CleaningStay } from '../services/cleaningCalendar';

// Only the network call is faked; band/lane maths (utils/stayLanes) is real.
const m = vi.hoisted(() => ({ getCleaningCalendar: vi.fn() }));
vi.mock('../services/cleaningCalendar', () => ({
  getCleaningCalendar: (...args: unknown[]) => m.getCleaningCalendar(...args),
}));
vi.mock('../components/Seo', () => ({ Seo: () => null }));

const { default: Page } = await import('./CleaningCalendarPage');

const pad = (d: number) => String(d).padStart(2, '0');
const dayIso = (d: number) => `2026-10-${pad(d)}`;

const stay = (over: Partial<CleaningStay> = {}): CleaningStay => ({
  propertyId: 'p1',
  propertyName: 'House A',
  checkInDate: dayIso(5),
  checkOutDate: dayIso(8),
  checkInTime: '15:00',
  checkOutTime: '10:00',
  source: 'Airbnb',
  guestCount: 2,
  isBlock: false,
  ...over,
});

const ev = (over: Partial<CleaningEvent> = {}): CleaningEvent => ({
  propertyId: 'p1',
  propertyName: 'House A',
  date: dayIso(14),
  startTime: '09:00',
  endTime: '10:00',
  title: 'Plumber',
  ...over,
});

function serve(stays: CleaningStay[], events: CleaningEvent[] = []) {
  m.getCleaningCalendar.mockResolvedValue({ stays, events });
}

const cellIso = (iso: string) => document.querySelector<HTMLButtonElement>(`button[data-date="${iso}"]`);
const cell = (d: number) => {
  const el = cellIso(dayIso(d));
  if (!el) throw new Error(`no cell for ${dayIso(d)}`);
  return el;
};
const dots = (el: Element) => el.querySelectorAll('[data-event-dot]');
const hasClass = (root: Element, cls: string) =>
  root.classList.contains(cls) || Array.from(root.querySelectorAll('*')).some((n) => n.classList.contains(cls));
const sheet = () => {
  const el = screen.getByRole('button', { name: 'Close' }).closest('.fixed');
  if (!el) throw new Error('sheet not open');
  return el as HTMLElement;
};

async function renderPage() {
  render(
    <MemoryRouter initialEntries={['/cleaning/tok']}>
      <Routes>
        <Route path="/cleaning/:token" element={<Page />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(cellIso(dayIso(1))).not.toBeNull());
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T03:00:00Z'));
  m.getCleaningCalendar.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CleaningCalendarPage — stays and bands unchanged', () => {
  it('23: In/Out halves, turnover, block band, lane height, empty day disabled', async () => {
    serve([
      stay({ checkInDate: dayIso(5), checkOutDate: dayIso(8) }),
      stay({ checkInDate: dayIso(10), checkOutDate: dayIso(12) }),
      stay({ checkInDate: dayIso(12), checkOutDate: dayIso(15), source: 'Booking.com' }),
      stay({ checkInDate: dayIso(20), checkOutDate: dayIso(22), isBlock: true, source: 'Hostex', guestCount: null }),
    ]);
    await renderPage();

    expect(m.getCleaningCalendar).toHaveBeenCalledWith('tok', '2026-09-27', '2026-10-31');

    expect(within(cell(5)).getByText('In')).toBeInTheDocument();
    expect(within(cell(5)).queryByText('Out')).toBeNull();
    expect(within(cell(8)).getByText('Out')).toBeInTheDocument();
    expect(within(cell(8)).queryByText('In')).toBeNull();
    expect(cell(8).textContent).toContain('🧹');

    // Same-day turnover: split Out | In plus the lightning icon.
    expect(within(cell(12)).getByText('Out')).toBeInTheDocument();
    expect(within(cell(12)).getByText('In')).toBeInTheDocument();
    expect(cell(12).querySelector('svg')).not.toBeNull();

    // Block: grey band on the nights it holds, no In/Out, never a cleaning day.
    expect(hasClass(cell(20), 'bg-[#9ca3af]')).toBe(true);
    expect(hasClass(cell(21), 'bg-[#9ca3af]')).toBe(true);
    for (const d of [20, 21, 22]) {
      expect(cell(d).textContent).not.toContain('🧹');
      expect(within(cell(d)).queryByText('In')).toBeNull();
      expect(within(cell(d)).queryByText('Out')).toBeNull();
    }
    expect(cell(22)).toBeDisabled();

    expect(cell(5).style.minHeight).toBe('46px');
    expect(cell(25)).toBeDisabled();
    expect(dots(document.body)).toHaveLength(0);
  });

  it('23b: two overlapping stays in one house open a second lane (62px)', async () => {
    serve([
      stay({ checkInDate: dayIso(5), checkOutDate: dayIso(8) }),
      stay({ checkInDate: dayIso(6), checkOutDate: dayIso(9), source: 'Booking.com' }),
    ]);
    await renderPage();
    expect(cell(5).style.minHeight).toBe('62px');
    expect(cell(25).style.minHeight).toBe('62px');
  });
});

describe('CleaningCalendarPage — events are display only', () => {
  it('24: cleaning/busy unchanged by an event; event alone is no cleaning day; sheet order', async () => {
    serve(
      [
        stay({ propertyId: 'p1', propertyName: 'House A', checkInDate: dayIso(10), checkOutDate: dayIso(12), guestCount: 4 }),
        stay({ propertyId: 'p2', propertyName: 'House B', checkInDate: dayIso(9), checkOutDate: dayIso(12), guestCount: 2 }),
      ],
      [ev({ date: dayIso(12) }), ev({ date: dayIso(14) })],
    );
    await renderPage();

    expect(cell(12).textContent).toContain('🧹');
    expect(cell(12).textContent).toContain('4+2');
    expect(cell(12).className).toContain('bg-[#fff1e6]');
    // A busy day stays orange even with an event on it.
    expect(cell(12).className).not.toContain('bg-[#fef9c3]');
    expect(dots(cell(12))).toHaveLength(1);

    expect(cell(14).textContent).not.toContain('🧹');
    expect(cell(14).className).not.toContain('bg-[#fff1e6]');
    expect(cell(14).className).toContain('bg-[#fef9c3]');
    expect(dots(cell(14))).toHaveLength(1);

    fireEvent.click(cell(12));
    const s = sheet();
    const banner = within(s).getByText(/Busy day — 2 properties need cleaning/);
    const block = s.querySelector('[data-sheet-events]');
    expect(block).not.toBeNull();
    expect(block!.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(s).getAllByText('🧹 Out 10:00')).toHaveLength(2);
    expect(s.querySelectorAll('[data-sheet-event]')).toHaveLength(1);
  });

  it('24b: one checkout plus events of two houses is not a busy day', async () => {
    serve(
      [stay({ propertyId: 'p1', checkInDate: dayIso(16), checkOutDate: dayIso(18), guestCount: 3 })],
      [
        ev({ propertyId: 'p1', date: dayIso(18) }),
        ev({ propertyId: 'p2', propertyName: 'House B', date: dayIso(18) }),
        ev({ propertyId: 'p2', propertyName: 'House B', date: dayIso(19) }),
        ev({ propertyId: 'p1', date: dayIso(19) }),
      ],
    );
    await renderPage();

    expect(cell(18).textContent).toContain('🧹');
    expect(cell(18).textContent).toContain('3');
    expect(cell(18).className).not.toContain('bg-[#fff1e6]');
    expect(cell(19).textContent).not.toContain('🧹');
    expect(cell(19).className).not.toContain('bg-[#fff1e6]');

    fireEvent.click(cell(19));
    expect(within(sheet()).queryByText(/Busy day/)).toBeNull();
    expect(within(sheet()).queryByText(/🧹 Out/)).toBeNull();
  });

  it('25: a day with only an event is clickable and the sheet lists it', async () => {
    serve([stay()], [ev()]);
    await renderPage();

    expect(cell(14)).not.toBeDisabled();
    const d = dots(cell(14));
    expect(d).toHaveLength(1);
    expect(d[0]).toHaveStyle({ backgroundColor: '#2563eb' });
    expect(d[0].parentElement).toHaveAttribute('title', '1 event');
    expect(d[0].parentElement).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(cell(14));
    const s = sheet();
    expect(within(s).getByText('House A')).toBeInTheDocument();
    expect(within(s).getByText('📌 09:00–10:00 · Plumber')).toBeInTheDocument();
    expect(within(s).queryByText('No activity this day.')).toBeNull();
    expect(s.querySelectorAll('[data-sheet-event]')).toHaveLength(1);

    expect(cell(25)).toBeDisabled();
  });

  it('26: at most three dots, the sheet lists every event, no key warnings', async () => {
    const errSpy = vi.spyOn(console, 'error');
    serve([stay()], [ev(), ev(), ev(), ev()]);
    await renderPage();

    expect(dots(cell(14))).toHaveLength(3);
    expect(dots(cell(14))[0].parentElement).toHaveAttribute('title', '4 events');

    fireEvent.click(cell(14));
    expect(sheet().querySelectorAll('[data-sheet-event]')).toHaveLength(4);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('27: a house with only events gets chip, legend and colour, but no empty lane', async () => {
    serve([stay()], [ev({ propertyId: 'p2', propertyName: 'House B' })]);
    await renderPage();

    const chip = screen.getByRole('button', { name: 'House B' });
    // Chip + legend entry.
    expect(screen.getAllByText('House B')).toHaveLength(2);
    expect(dots(cell(14))[0]).toHaveStyle({ backgroundColor: '#db2777' });
    expect(cell(5).style.minHeight).toBe('46px');
    expect(cell(14).style.minHeight).toBe('46px');

    expect(cell(14).className).toContain('bg-[#fef9c3]');
    expect(cell(5).className).not.toContain('bg-[#fef9c3]');

    fireEvent.click(chip);
    expect(dots(cell(14))).toHaveLength(0);
    expect(cell(14)).toBeDisabled();
    expect(cell(14).className).not.toContain('bg-[#fef9c3]');
    // House A's stay is still there.
    expect(within(cell(5)).getByText('In')).toBeInTheDocument();

    fireEvent.click(chip);
    expect(dots(cell(14))).toHaveLength(1);
    expect(cell(14)).not.toBeDisabled();
  });

  it('27b: filtering a house hides its event in the sheet but keeps the other house', async () => {
    serve(
      [stay()],
      [ev({ title: 'A job' }), ev({ propertyId: 'p2', propertyName: 'House B', title: 'B job' })],
    );
    await renderPage();
    expect(dots(cell(14))).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'House B' }));
    expect(dots(cell(14))).toHaveLength(1);
    fireEvent.click(cell(14));
    expect(within(sheet()).getByText('📌 09:00–10:00 · A job')).toBeInTheDocument();
    expect(within(sheet()).queryByText(/B job/)).toBeNull();
  });

  it('28: refresh picks up new events; a failed refresh keeps them', async () => {
    m.getCleaningCalendar
      .mockResolvedValueOnce({ stays: [stay()], events: [] })
      .mockResolvedValueOnce({ stays: [stay()], events: [ev()] })
      .mockRejectedValueOnce(new Error('boom'));
    await renderPage();
    expect(dots(cell(14))).toHaveLength(0);
    expect(cell(14)).toBeDisabled();

    const refresh = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.click(refresh);
    await waitFor(() => expect(dots(cell(14))).toHaveLength(1));
    expect(m.getCleaningCalendar).toHaveBeenCalledTimes(2);

    await waitFor(() => expect(refresh).not.toBeDisabled());
    fireEvent.click(refresh);
    expect(await screen.findByText('boom')).toBeInTheDocument();
    expect(m.getCleaningCalendar).toHaveBeenCalledTimes(3);
    expect(dots(cell(14))).toHaveLength(1);
    expect(within(cell(5)).getByText('In')).toBeInTheDocument();
  });

  it('29: changing month refetches the new grid and shows its events', async () => {
    m.getCleaningCalendar.mockImplementation(async (_t: string, from: string) =>
      from === '2026-08-30'
        ? { stays: [], events: [ev({ date: '2026-09-10' })] }
        : { stays: [stay()], events: [] });
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await waitFor(() => expect(cellIso('2026-09-10')).not.toBeNull());
    expect(m.getCleaningCalendar).toHaveBeenLastCalledWith('tok', '2026-08-30', '2026-10-03');
    await waitFor(() => expect(dots(cellIso('2026-09-10')!)).toHaveLength(1));
    expect(cellIso('2026-09-10')).not.toBeDisabled();
  });

  it('30: a dead link shows "Link not valid" and no grid', async () => {
    m.getCleaningCalendar.mockRejectedValue(new ApiError('Not found', 404));
    render(
      <MemoryRouter initialEntries={['/cleaning/tok']}>
        <Routes>
          <Route path="/cleaning/:token" element={<Page />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Link not valid' })).toBeInTheDocument();
    expect(document.querySelectorAll('button[data-date]')).toHaveLength(0);
    expect(dots(document.body)).toHaveLength(0);
  });

  it('31: with no events nothing new appears except the legend entry', async () => {
    serve([stay()]);
    await renderPage();

    expect(dots(document.body)).toHaveLength(0);
    fireEvent.click(cell(6));
    expect(sheet().querySelector('[data-sheet-events]')).toBeNull();
    expect(within(sheet()).queryByText('No activity this day.')).toBeNull();
    expect(screen.getByText('busy (2+)')).toBeInTheDocument();
    expect(screen.getByText('event (dot = house)')).toBeInTheDocument();
    // A single house: no filter chips.
    expect(screen.queryByRole('button', { name: 'House A' })).toBeNull();
  });
});
