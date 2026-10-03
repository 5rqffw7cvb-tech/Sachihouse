import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiUser } from '../services/api';
import type { PropertyCalendar, PropertyCalendarEvent } from '../services/calendar';
import { format } from 'date-fns';
import { eventDateWindow, jstDateString } from '../utils/eventDraft';

// The shell's nav, auth gate and site chrome say nothing about the board.
vi.mock('../components/AdminShell', () => ({
  AdminShell: ({ actions, children }: { actions?: React.ReactNode; children?: React.ReactNode }) => (
    <div>{actions}{children}</div>
  ),
}));

const admin: ApiUser = {
  id: 1,
  name: 'Admin',
  email: 'admin@example.com',
  role: 'ADMIN',
  canEditBlog: false,
  assignedPropertyIds: [],
  hostLevel: null,
};
vi.mock('../services/auth', () => ({
  getCurrentUser: () => admin,
  subscribeToAuth: async (cb: (u: ApiUser | null) => void) => {
    cb(admin);
    return () => {};
  },
}));

// One frozen list: the page's load effects depend on it.
const houses = [
  { id: 'p1', name: 'House A', galleryImages: [] },
  { id: 'p2', name: 'House B', galleryImages: [] },
];

const m = vi.hoisted(() => ({
  getAllProperties: vi.fn(),
  getPropertyCalendar: vi.fn(),
  addBlockedDates: vi.fn(),
  removeBlockedDates: vi.fn(),
  createCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  updateIcalFeeds: vi.fn(),
  regenerateIcalExportToken: vi.fn(),
  cancelBookingByHost: vi.fn(),
  forceCancelBookingByHost: vi.fn(),
  getCleaningCalendarLink: vi.fn(),
  regenerateCleaningCalendarLink: vi.fn(),
}));

vi.mock('../services/storage', () => ({
  getAllProperties: (...args: unknown[]) => m.getAllProperties(...args),
}));
vi.mock('../services/calendar', () => ({
  getPropertyCalendar: (...args: unknown[]) => m.getPropertyCalendar(...args),
  addBlockedDates: (...args: unknown[]) => m.addBlockedDates(...args),
  removeBlockedDates: (...args: unknown[]) => m.removeBlockedDates(...args),
  createCalendarEvent: (...args: unknown[]) => m.createCalendarEvent(...args),
  updateCalendarEvent: (...args: unknown[]) => m.updateCalendarEvent(...args),
  deleteCalendarEvent: (...args: unknown[]) => m.deleteCalendarEvent(...args),
  updateIcalFeeds: (...args: unknown[]) => m.updateIcalFeeds(...args),
  regenerateIcalExportToken: (...args: unknown[]) => m.regenerateIcalExportToken(...args),
}));
vi.mock('../services/booking', () => ({
  cancelBookingByHost: (...args: unknown[]) => m.cancelBookingByHost(...args),
  forceCancelBookingByHost: (...args: unknown[]) => m.forceCancelBookingByHost(...args),
}));
vi.mock('../services/cleaningCalendar', () => ({
  getCleaningCalendarLink: (...args: unknown[]) => m.getCleaningCalendarLink(...args),
  regenerateCleaningCalendarLink: (...args: unknown[]) => m.regenerateCleaningCalendarLink(...args),
}));

const { default: HostCalendarPage } = await import('./HostCalendarPage');

const cal = (id: string, over: Partial<PropertyCalendar> = {}): PropertyCalendar => ({
  propertyId: id,
  propertyName: id,
  manualBlockedDates: [],
  importedBlockedDates: [],
  importedEvents: [],
  bookings: [],
  directBookings: [],
  icalFeeds: [],
  exportUrl: '',
  events: [],
  ...over,
});

const ev = (over: Partial<PropertyCalendarEvent>): PropertyCalendarEvent => ({
  id: 'e1',
  propertyId: 'p1',
  title: 'Cleaner',
  note: '',
  date: '2026-10-10',
  startTime: '10:00',
  endTime: '11:00',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

/** Each house's calendar as the server would send it; a fresh copy per call. */
let calendars: Record<string, Partial<PropertyCalendar>> = {};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T03:00:00Z'));

  for (const fn of Object.values(m)) fn.mockReset();
  calendars = { p1: {}, p2: {} };
  m.getAllProperties.mockResolvedValue(houses);
  m.getPropertyCalendar.mockImplementation(async (id: string) =>
    cal(id, JSON.parse(JSON.stringify(calendars[id] ?? {}))));
  m.getCleaningCalendarLink.mockResolvedValue('https://example.com/cleaning');
});

afterEach(() => {
  vi.useRealTimers();
});

const dotName = (n: number, iso: string, house = 'House A') =>
  `${n} event${n === 1 ? '' : 's'} on ${iso} — ${house}`;

/** Renders and waits until the board has loaded every calendar. */
async function renderPage() {
  render(<HostCalendarPage />);
  const add = await screen.findByRole('button', { name: 'Add event' });
  await waitFor(() => expect(add).toBeEnabled());
  // Rows are on screen once the timeline has its calendars.
  await screen.findByRole('button', { name: 'House A, 2026-10-01, available — block this night' });
  return add;
}

const sheet = (name: 'New event' | 'Edit event') => screen.getByRole('dialog', { name });
const dateInput = (dialog: HTMLElement) => within(dialog).getByLabelText('Date *') as HTMLInputElement;
const save = (dialog: HTMLElement) =>
  fireEvent.click(within(dialog).getByRole('button', { name: /Save event/ }));

describe('HostCalendarPage — host events on the board', () => {
  it('38: shows a dot for an event and the legend entry', async () => {
    calendars.p1 = { events: [ev({})] };
    await renderPage();

    const dot = screen.getByRole('button', { name: dotName(1, '2026-10-10') });
    expect(dot).toHaveAttribute('title', '10:00–11:00 · Cleaner');
    expect(screen.queryByRole('button', { name: /event.*House B/ })).toBeNull();
    expect(screen.getByText('Event (does not block)')).toBeInTheDocument();
  });

  it('39: creates from the header, sheet portalled to body, dot appears without a reload', async () => {
    const add = await renderPage();
    const loads = m.getPropertyCalendar.mock.calls.length;
    m.createCalendarEvent.mockImplementation(async (propertyId: string, input: Record<string, string>) =>
      ev({ id: 'e9', propertyId, ...input }));

    fireEvent.click(add);
    const dialog = sheet('New event');
    expect(dialog.closest('[role="presentation"]')!.parentElement).toBe(document.body);
    expect(dateInput(dialog).value).toBe('2026-10-15');

    fireEvent.change(within(dialog).getByLabelText('Title *'), { target: { value: 'Cleaner' } });
    fireEvent.change(dateInput(dialog), { target: { value: '2026-10-12' } });
    save(dialog);

    expect(await screen.findByRole('button', { name: dotName(1, '2026-10-12') })).toBeInTheDocument();
    expect(m.createCalendarEvent).toHaveBeenCalledTimes(1);
    expect(m.createCalendarEvent).toHaveBeenCalledWith('p1', {
      title: 'Cleaner',
      note: '',
      date: '2026-10-12',
      startTime: '10:00',
      endTime: '11:00',
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New event' })).toBeNull());
    expect(m.getPropertyCalendar.mock.calls.length).toBe(loads);
  });

  it('40: the default date follows the month shown, kept inside the event window', async () => {
    const add = await renderPage();
    const next = screen.getByRole('button', { name: 'Next month' });
    const closeSheet = () => fireEvent.click(within(sheet('New event')).getByRole('button', { name: 'Close' }));

    fireEvent.click(next); // November 2026
    expect(screen.getByText('November 2026')).toBeInTheDocument();
    fireEvent.click(add);
    expect(dateInput(sheet('New event')).value).toBe('2026-11-01');
    closeSheet();

    for (let i = 0; i < 12; i++) fireEvent.click(next); // November 2027
    expect(screen.getByText('November 2027')).toBeInTheDocument();
    fireEvent.click(add);
    expect(dateInput(sheet('New event')).value).toBe(eventDateWindow().to);
    expect(eventDateWindow().to).toBe('2027-10-15');
    closeSheet();

    // And the other side: a month before the window starts.
    const prev = screen.getByRole('button', { name: 'Previous month' });
    for (let i = 0; i < 17; i++) fireEvent.click(prev); // June 2026
    expect(screen.getByText('June 2026')).toBeInTheDocument();
    fireEvent.click(add);
    expect(dateInput(sheet('New event')).value).toBe(eventDateWindow().from);
  });

  it('40b (W2): the board on the device month prefills today in JST, even when JST is already in another month', async () => {
    // Look for an instant around the Oct/Nov boundary where the device month
    // and the JST month differ. That depends on the process time zone, which a
    // worker thread cannot change at runtime (setting process.env.TZ there has
    // no effect), so the instant is found for whatever zone the run has.
    const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
    let instant: number | null = null;
    for (let t = Date.parse('2026-10-30T00:00:00Z'); t <= Date.parse('2026-11-02T00:00:00Z'); t += 15 * 60 * 1000) {
      if (format(new Date(t), 'yyyy-MM') !== jstDateString(t).slice(0, 7)) {
        instant = t;
        break;
      }
    }
    // In Asia/Tokyo no such instant exists: fall back to 23:30 JST on 31 Oct,
    // where the device month and the JST month agree and today is not the 1st.
    const now = instant ?? Date.parse('2026-10-31T14:30:00Z');
    vi.setSystemTime(new Date(now));

    const deviceMonth = format(new Date(now), 'yyyy-MM');
    const todayJst = jstDateString(now);
    if (instant !== null) expect(todayJst.startsWith(deviceMonth), `tz=${tz}`).toBe(false);
    else expect(todayJst.startsWith(deviceMonth), `tz=${tz}`).toBe(true);

    render(<HostCalendarPage />);
    const add = await screen.findByRole('button', { name: 'Add event' });
    await waitFor(() => expect(add).toBeEnabled());
    await screen.findAllByRole('button', { name: /^House A, \d{4}-\d{2}-\d{2}, available/ });
    // The board opens on the device month.
    expect(screen.getByText(format(new Date(now), 'MMMM yyyy'))).toBeInTheDocument();

    fireEvent.click(add);
    const value = dateInput(sheet('New event')).value;
    expect(value, `tz=${tz}`).toBe(todayJst);
    expect(value).not.toBe(`${deviceMonth}-01`);
  });

  it('41: editing the date moves the dot', async () => {
    calendars.p1 = { events: [ev({})] };
    await renderPage();
    m.updateCalendarEvent.mockImplementation(async (id: string, patch: Record<string, string>) =>
      ev({ id, ...patch }));

    fireEvent.click(screen.getByRole('button', { name: dotName(1, '2026-10-10') }));
    const dialog = sheet('Edit event');
    expect((within(dialog).getByLabelText('Title *') as HTMLInputElement).value).toBe('Cleaner');
    expect(within(dialog).getByText('House A')).toBeInTheDocument();
    fireEvent.change(dateInput(dialog), { target: { value: '2026-10-20' } });
    save(dialog);

    expect(await screen.findByRole('button', { name: dotName(1, '2026-10-20') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: dotName(1, '2026-10-10') })).toBeNull();
    expect(m.updateCalendarEvent).toHaveBeenCalledWith('e1', {
      title: 'Cleaner',
      note: '',
      date: '2026-10-20',
      startTime: '10:00',
      endTime: '11:00',
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit event' })).toBeNull());
  });

  it('42: deleting removes the dot', async () => {
    calendars.p1 = { events: [ev({})] };
    await renderPage();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    m.deleteCalendarEvent.mockResolvedValue(undefined);

    fireEvent.click(screen.getByRole('button', { name: dotName(1, '2026-10-10') }));
    fireEvent.click(within(sheet('Edit event')).getByRole('button', { name: /Delete event/ }));

    await waitFor(() => expect(screen.queryByRole('button', { name: dotName(1, '2026-10-10') })).toBeNull());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(m.deleteCalendarEvent).toHaveBeenCalledWith('e1');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit event' })).toBeNull());
  });

  it('43: a failed save keeps the sheet, what was typed and the dot', async () => {
    calendars.p1 = { events: [ev({})] };
    await renderPage();
    m.updateCalendarEvent.mockRejectedValue(new Error('Event not found'));

    fireEvent.click(screen.getByRole('button', { name: dotName(1, '2026-10-10') }));
    const dialog = sheet('Edit event');
    fireEvent.change(within(dialog).getByLabelText('Title *'), { target: { value: 'Plumber' } });
    fireEvent.change(dateInput(dialog), { target: { value: '2026-10-20' } });
    save(dialog);

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Event not found');
    expect(sheet('Edit event')).toBe(dialog);
    expect((within(dialog).getByLabelText('Title *') as HTMLInputElement).value).toBe('Plumber');
    expect(screen.getByRole('button', { name: dotName(1, '2026-10-10') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: dotName(1, '2026-10-20') })).toBeNull();
  });

  it('44: a day with several events opens a list in time order, to edit one or add another', async () => {
    calendars.p1 = {
      events: [
        ev({ id: 'e1', title: 'Plumber', startTime: '14:00', endTime: '15:00', note: 'Kitchen sink' }),
        ev({ id: 'e2', title: 'Cleaner', startTime: '09:00', endTime: '10:00' }),
      ],
    };
    await renderPage();

    const dot = screen.getByRole('button', { name: dotName(2, '2026-10-10') });
    expect(dot).toHaveTextContent('2');
    fireEvent.click(dot);

    let list = screen.getByRole('dialog', { name: 'Events on 2026-10-10' });
    const rows = within(list).getAllByRole('button', { name: /·/ });
    expect(rows.map((r) => r.textContent)).toEqual([
      '09:00–10:00 · Cleaner',
      '14:00–15:00 · PlumberKitchen sink',
    ]);
    expect(within(list).getByText('House A')).toBeInTheDocument();

    fireEvent.click(rows[1]);
    expect(screen.queryByRole('dialog', { name: 'Events on 2026-10-10' })).toBeNull();
    let dialog = sheet('Edit event');
    expect((within(dialog).getByLabelText('Title *') as HTMLInputElement).value).toBe('Plumber');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Edit event' })).toBeNull();

    fireEvent.click(dot);
    list = screen.getByRole('dialog', { name: 'Events on 2026-10-10' });
    fireEvent.click(within(list).getByRole('button', { name: /Add event on this day/ }));
    expect(screen.queryByRole('dialog', { name: 'Events on 2026-10-10' })).toBeNull();
    dialog = sheet('New event');
    expect(dateInput(dialog).value).toBe('2026-10-10');
    expect((within(dialog).getByRole('combobox') as HTMLSelectElement).value).toBe('p1');
  });

  it('44b: "Add event on this day" from the second house preselects that house', async () => {
    calendars.p2 = {
      events: [
        ev({ id: 'e3', propertyId: 'p2', date: '2026-10-11', title: 'A' }),
        ev({ id: 'e4', propertyId: 'p2', date: '2026-10-11', title: 'B' }),
      ],
    };
    await renderPage();

    fireEvent.click(screen.getByRole('button', { name: dotName(2, '2026-10-11', 'House B') }));
    const list = screen.getByRole('dialog', { name: 'Events on 2026-10-11' });
    fireEvent.click(within(list).getByRole('button', { name: /Add event on this day/ }));
    const select = within(sheet('New event')).getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('p2');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['p2', 'p1']);
  });

  it('45: a free night with a dot is still blocked on click', async () => {
    calendars.p1 = { events: [ev({})] };
    await renderPage();
    m.addBlockedDates.mockResolvedValue(['2026-10-10']);

    fireEvent.click(screen.getByRole('button', { name: 'House A, 2026-10-10, available — block this night' }));

    await waitFor(() => expect(m.addBlockedDates).toHaveBeenCalledWith('p1', ['2026-10-10']));
    expect(m.addBlockedDates).toHaveBeenCalledTimes(1);
    // The night is now a manual block bar; the dot is still on it.
    expect(await screen.findByRole('button', { name: 'Blocked' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'House A, 2026-10-10, available — block this night' })).toBeNull();
    expect(screen.getByRole('button', { name: dotName(1, '2026-10-10') })).toBeInTheDocument();
    expect(m.updateCalendarEvent).not.toHaveBeenCalled();
    expect(m.createCalendarEvent).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /event/i })).toBeNull();
  });
});
