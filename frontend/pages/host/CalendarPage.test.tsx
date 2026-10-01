import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { format, parseISO } from 'date-fns';
import { ApiUser } from '../../services/api';
import type { HostCalendarData, HostStay } from '../../services/hostApp';

const loadCalendars = vi.fn();
vi.mock('../../services/hostApp', async (importOriginal) => ({
  // Only the fetch is faked. arrivalsOn, departuresOn, stayingOn and
  // stayNights are what decides which rows a day has, so they stay real.
  ...(await importOriginal<typeof import('../../services/hostApp')>()),
  loadCalendars: (ids: string[], onProperty?: unknown, options?: unknown) =>
    loadCalendars(ids, onProperty, options),
}));

vi.mock('../../services/calendar', () => ({
  addBlockedDates: vi.fn(),
  removeBlockedDates: vi.fn(),
}));

const user: ApiUser = {
  id: 1,
  name: 'Host',
  email: 'host@example.com',
  role: 'ADMIN',
  canEditBlog: false,
  assignedPropertyIds: [],
  hostLevel: 4,
};
// One frozen object, not a fresh literal per render: the page's load effect
// depends on `properties`, so handing it a new array every render spins it
// forever.
const hostContext = {
  user,
  properties: [{ id: 's01', name: 'Sachi House 01', address: '', pricing: {} }],
  propertiesError: null,
  reloadProperties: () => {},
};
vi.mock('../../components/host/HostShell', () => ({ useHostContext: () => hostContext }));

const { default: CalendarPage } = await import('./CalendarPage');

/** A date in the month the screen opens on, so the cell is on screen. */
const now = new Date();
const dayIso = (day: number): string =>
  `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;

const stay = (over: Partial<HostStay>): HostStay => ({
  key: `k-${Math.random()}`,
  propertyId: 's01',
  propertyName: 'Sachi House 01',
  guestName: 'Tanaka Yuki',
  channel: 'Airbnb',
  checkInDate: dayIso(10),
  checkOutDate: dayIso(15),
  guestCount: 2,
  kind: 'booking',
  bookingId: null,
  amountTotal: null,
  currency: null,
  summary: null,
  description: null,
  feedName: null,
  ...over,
});

function renderWith(stays: HostStay[], manualBlockedDates: string[] = []) {
  const data: HostCalendarData = {
    propertyId: 's01',
    stays,
    manualBlockedDates: new Set(manualBlockedDates),
    blockedDates: new Set(manualBlockedDates),
  };
  loadCalendars.mockImplementation(async (_ids, onProperty) => {
    (onProperty as ((id: string, d: HostCalendarData) => void) | undefined)?.('s01', data);
    return { calendars: new Map([['s01', data]]), failedPropertyIds: [] };
  });
  return render(<CalendarPage />);
}

/** Taps the day cell for `day` in the visible month. */
async function tapDay(day: number) {
  const cells = await screen.findAllByRole('button');
  const cell = cells.find((node) => node.textContent?.trim().startsWith(String(day))
    && node.querySelector('span'));
  fireEvent.click(cell!);
}

/** The day panel, found by the date it is headed with — the page has other
 *  headings, and this also checks the panel is for the day that was tapped. */
const panel = (day: number) =>
  screen.getByText(format(parseISO(dayIso(day)), 'EEE, d MMMM')).closest('section')!;

describe('opening a booking from the calendar', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the stay when a night in the middle of it is tapped', async () => {
    // The bug: arrivals and departures were the only rows, so tapping the
    // middle of a five-night stay answered with nothing — the one booking
    // filling the cell was the one thing that could not be opened.
    renderWith([stay({ checkInDate: dayIso(10), checkOutDate: dayIso(15) })]);
    await tapDay(12);

    expect(within(panel(12)).getByText(/Staying · Tanaka Yuki/)).toBeInTheDocument();
  });

  it('opens that stay detail when the row is tapped', async () => {
    renderWith([stay({ checkInDate: dayIso(10), checkOutDate: dayIso(15) })]);
    await tapDay(12);
    fireEvent.click(within(panel(12)).getByText(/Staying · Tanaka Yuki/));

    expect(await screen.findByRole('dialog', { name: 'Booking detail' })).toBeInTheDocument();
  });

  it('still names the check-out and the check-in on a turnover day', async () => {
    renderWith([
      stay({ checkInDate: dayIso(8), checkOutDate: dayIso(12), guestName: 'Leaving' }),
      stay({ checkInDate: dayIso(12), checkOutDate: dayIso(16), guestName: 'Arriving' }),
    ]);
    await tapDay(12);

    const rows = within(panel(12)).getAllByRole('button');
    // The morning before the afternoon: the check-out is what decides whether
    // anybody has to be in the building.
    expect(rows[0]).toHaveTextContent('Check-out · Leaving');
    expect(rows[1]).toHaveTextContent('Check-in · Arriving');
  });

  it('explains a synced block on every night it holds, first one included', async () => {
    // stayingOn counts only the nights strictly inside a stay, and a block has
    // no arrival row to make up for it, so its first night used to vanish.
    renderWith([stay({
      kind: 'imported-block',
      guestName: null,
      channel: 'Blocked',
      checkInDate: dayIso(20),
      checkOutDate: dayIso(22),
    })]);

    await tapDay(20);
    expect(within(panel(20)).getByText('Blocked')).toBeInTheDocument();

    // Tapping the same day again clears the pick, so the next tap is a fresh
    // single day rather than the far end of a range.
    await tapDay(20);
    await tapDay(21);
    expect(within(panel(21)).getByText('Blocked')).toBeInTheDocument();
  });

  it('says why a hand-blocked day is not free, without pretending it opens', async () => {
    renderWith([], [dayIso(18)]);
    await tapDay(18);

    expect(within(panel(18)).getByText('Blocked')).toBeInTheDocument();
    // Nothing behind it to show, so it must not be a button promising a screen.
    expect(within(panel(18)).queryAllByRole('button')).toHaveLength(0);
  });

  it('says plainly that a free day is free', async () => {
    renderWith([]);
    await tapDay(14);

    expect(within(panel(14)).getByText(/Nothing on this day/)).toBeInTheDocument();
  });
});
