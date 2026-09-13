import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiUser } from '../../services/api';
import type { HostStay } from '../../services/hostApp';

const loadStays = vi.fn();
vi.mock('../../services/hostApp', async (importOriginal) => ({
  // Only the fetch is faked. arrivalsBetween, stayingOn and departuresOn are
  // the logic under test here, so they stay real.
  ...(await importOriginal<typeof import('../../services/hostApp')>()),
  loadStays: (ids: string[], onProperty?: unknown, options?: unknown) => loadStays(ids, onProperty, options),
}));

vi.mock('../../services/checkin', () => ({ listCheckIns: async () => [] }));

const user: ApiUser = {
  id: 1,
  name: 'Host',
  email: 'host@example.com',
  role: 'ADMIN',
  canEditBlog: false,
  assignedPropertyIds: [],
  hostLevel: 4,
};
vi.mock('../../components/host/HostShell', () => ({
  useHostContext: () => ({
    user,
    properties: [{ id: 's01', name: 'Sachi House 01' }],
    propertiesError: null,
    reloadProperties: () => {},
  }),
}));

const { default: StaysPage } = await import('./StaysPage');

const today = new Date();
const iso = (offsetDays: number): string => {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const stay = (over: Partial<HostStay>): HostStay => ({
  key: `k-${Math.random()}`,
  propertyId: 's01',
  propertyName: 'Sachi House 01',
  guestName: 'Tanaka Yuki',
  channel: 'Airbnb',
  checkInDate: iso(-2),
  checkOutDate: iso(3),
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

function renderWith(stays: HostStay[]) {
  loadStays.mockResolvedValue({ stays, failedPropertyIds: [] });
  return render(<StaysPage />);
}

/** The card headings, in the order they are painted. */
const sectionOrder = (): string[] =>
  screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent ?? '');

describe('the order the Stays screen answers questions in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('leads with who is in the houses, then who leaves today, then who is coming', async () => {
    renderWith([
      stay({ checkInDate: iso(-2), checkOutDate: iso(3), guestName: 'In the house' }),
      stay({ checkInDate: iso(-4), checkOutDate: iso(0), guestName: 'Leaving today' }),
      stay({ checkInDate: iso(2), checkOutDate: iso(5), guestName: 'Arriving later' }),
    ]);

    await screen.findByText('In the house');
    expect(sectionOrder()).toEqual(['Staying', 'Departures today', 'Next arrivals']);
  });

  it('shrinks Staying to its heading when nobody is in', async () => {
    renderWith([stay({ checkInDate: iso(2), checkOutDate: iso(5), guestName: 'Arriving later' })]);

    await screen.findByText('Arriving later');
    const staying = screen.getByRole('heading', { level: 2, name: 'Staying' }).closest('section')!;

    // One line, not a paragraph explaining zero: on a phone that sentence cost
    // a third of the screen to say what the count already says.
    expect(within(staying).getByText('0')).toBeInTheDocument();
    expect(within(staying).queryByText(/Nobody is in the houses/)).not.toBeInTheDocument();
  });

  it('says nothing about cleaning', async () => {
    renderWith([stay({ checkInDate: iso(-4), checkOutDate: iso(0), guestName: 'Leaving today' })]);

    await screen.findByText('Leaving today');
    // Turnovers belong to the cleaning calendar, which is its own screen with
    // its own audience; repeating them here only crowded the departures.
    expect(screen.queryByText(/Cleaning/)).not.toBeInTheDocument();
  });

  it('still lists a departure under its own heading', async () => {
    renderWith([stay({ checkInDate: iso(-4), checkOutDate: iso(0), guestName: 'Leaving today' })]);

    const departures = (await screen.findByRole('heading', { level: 2, name: 'Departures today' })).closest('section')!;
    await waitFor(() => expect(within(departures).getByText('Leaving today')).toBeInTheDocument());
  });
});
