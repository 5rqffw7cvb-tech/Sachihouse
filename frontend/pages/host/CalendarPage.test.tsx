import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { format, parseISO } from 'date-fns';
import { ApiUser } from '../../services/api';
import type { HostCalendarData, HostStay } from '../../services/hostApp';
import { propertyColor } from '../../services/hostApp';
import type { PropertyCalendarEvent } from '../../services/calendar';
import { jstDateString, ONE_DAY_MS } from '../../utils/eventDraft';

const loadCalendars = vi.fn();
const createCalendarEvent = vi.fn();
const updateCalendarEvent = vi.fn();
const deleteCalendarEvent = vi.fn();
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
  createCalendarEvent: (...args: unknown[]) => createCalendarEvent(...args),
  updateCalendarEvent: (...args: unknown[]) => updateCalendarEvent(...args),
  deleteCalendarEvent: (...args: unknown[]) => deleteCalendarEvent(...args),
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
// Two houses, for the tests that need the property filter and per-house
// colours. Frozen for the same reason as hostContext.
const twoHouseContext = {
  user,
  properties: [
    { id: 's01', name: 'Sachi House 01', address: '', pricing: {} },
    { id: 's02', name: 'Sachi House 02', address: '', pricing: {} },
  ],
  propertiesError: null,
  reloadProperties: () => {},
};
let activeContext: typeof hostContext = hostContext;
vi.mock('../../components/host/HostShell', () => ({ useHostContext: () => activeContext }));

const { default: CalendarPage } = await import('./CalendarPage');

// File-wide, outside every describe: renderHouses swaps in the two-house
// account, and no test may inherit that from the one before it.
beforeEach(() => {
  activeContext = hostContext;
});

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

function renderWith(
  stays: HostStay[],
  manualBlockedDates: string[] = [],
  events: PropertyCalendarEvent[] = [],
) {
  const data: HostCalendarData = {
    propertyId: 's01',
    stays,
    manualBlockedDates: new Set(manualBlockedDates),
    blockedDates: new Set(manualBlockedDates),
    events,
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
    // The one button in the card is the Add event action under the rows.
    const buttons = within(panel(18)).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(/Add event/);
  });

  it('says plainly that a free day is free', async () => {
    renderWith([]);
    await tapDay(14);

    expect(within(panel(14)).getByText(/Nothing on this day/)).toBeInTheDocument();
  });
});

const calEvent = (over: Partial<PropertyCalendarEvent>): PropertyCalendarEvent => ({
  id: `e-${Math.random()}`,
  propertyId: 's01',
  title: 'Plumber visit',
  note: '',
  date: dayIso(12),
  startTime: '10:00',
  endTime: '11:00',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

/** Renders the two-house account, each house with only the events given. */
function renderHouses(byId: Record<string, PropertyCalendarEvent[]>) {
  activeContext = twoHouseContext;
  const calendars = new Map<string, HostCalendarData>(
    twoHouseContext.properties.map(({ id }): [string, HostCalendarData] => [id, {
      propertyId: id,
      stays: [],
      manualBlockedDates: new Set<string>(),
      blockedDates: new Set<string>(),
      events: byId[id] ?? [],
    }]),
  );
  loadCalendars.mockImplementation(async (_ids, onProperty) => {
    calendars.forEach((data, id) =>
      (onProperty as ((id: string, d: HostCalendarData) => void) | undefined)?.(id, data));
    return { calendars, failedPropertyIds: [] };
  });
  return render(<CalendarPage />);
}

/** The day cell for `day`, found the same way tapDay finds it. Synchronous,
 *  so it can sit inside waitFor without nesting one timeout in another. */
function dayCell(day: number): HTMLElement {
  const cells = screen.getAllByRole('button');
  const cell = cells.find((node) => node.textContent?.trim().startsWith(String(day))
    && node.querySelector('span'));
  if (!cell) throw new Error(`no day cell for ${day}`);
  return cell;
}

const dots = (cell: HTMLElement) =>
  Array.from(cell.querySelectorAll<HTMLElement>('[data-event-dot]'));

/** How jsdom spells a colour once it is set as a style, for comparing. */
const asStyle = (color: string): string => {
  const probe = document.createElement('span');
  probe.style.backgroundColor = color;
  return probe.style.backgroundColor;
};

describe('host events on the calendar', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists the event first on the day, with its time, title, house and note', async () => {
    renderWith(
      [stay({ checkInDate: dayIso(8), checkOutDate: dayIso(12), guestName: 'Leaving' })],
      [],
      [calEvent({ note: 'Bring the spare key' })],
    );
    await tapDay(12);

    const card = panel(12);
    expect(within(card).getByText('10:00–11:00 · Plumber visit')).toBeInTheDocument();
    expect(within(card).getByText('Sachi House 01 · Bring the spare key')).toBeInTheDocument();
    const text = card.textContent ?? '';
    expect(text.indexOf('Plumber visit')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Check-out')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Plumber visit')).toBeLessThan(text.indexOf('Check-out'));
    expect(within(card).queryByText(/Nothing on this day/)).toBeNull();
  });

  it('does not call a day with only an event empty, and the event row opens it', async () => {
    renderWith([], [], [calEvent({})]);
    await tapDay(12);

    const card = panel(12);
    expect(within(card).getByText('10:00–11:00 · Plumber visit')).toBeInTheDocument();
    expect(within(card).queryByText(/Nothing on this day/)).toBeNull();
    // Two buttons: the event row, which opens the event, then Add event.
    const buttons = within(card).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent('10:00–11:00 · Plumber visit');
    expect(buttons[1]).toHaveAccessibleName(/Add event/);

    fireEvent.click(buttons[0]);
    expect(await screen.findByRole('dialog', { name: 'Edit event' })).toBeInTheDocument();
  });

  it('orders events by start, then end, then house order', async () => {
    renderHouses({
      // 'Long' sits in the first house and 'Short' in the second, so house
      // order alone would put Long first: only the end-time tie-break puts
      // Short ahead of it.
      s01: [
        calEvent({ title: 'Long', startTime: '09:00', endTime: '10:00' }),
        calEvent({ title: 'Early house A', startTime: '08:00', endTime: '09:00' }),
      ],
      s02: [
        calEvent({ propertyId: 's02', title: 'Short', startTime: '09:00', endTime: '09:30' }),
        calEvent({ propertyId: 's02', title: 'Early house B', startTime: '08:00', endTime: '09:00' }),
      ],
    });
    await tapDay(12);

    const text = panel(12).textContent ?? '';
    const at = (t: string) => text.indexOf(t);
    expect(at('Early house A')).toBeGreaterThanOrEqual(0);
    expect(at('Early house A')).toBeLessThan(at('Early house B'));
    expect(at('Early house B')).toBeLessThan(at('Short'));
    expect(at('Short')).toBeLessThan(at('Long'));
  });

  it('draws at most three dots in the house colours, with no text added to the cell', async () => {
    renderHouses({
      s01: [
        calEvent({ startTime: '09:00', endTime: '09:30' }),
        calEvent({ startTime: '11:00', endTime: '11:30' }),
      ],
      s02: [
        calEvent({ propertyId: 's02', startTime: '10:00', endTime: '10:30' }),
        calEvent({ propertyId: 's02', startTime: '12:00', endTime: '12:30' }),
      ],
    });

    await waitFor(() => expect(dots(dayCell(12)).length).toBeGreaterThan(0));
    const cell = dayCell(12);
    const found = dots(cell);
    expect(found).toHaveLength(3);
    expect(found.map((dot) => dot.style.backgroundColor)).toEqual(
      [propertyColor(0), propertyColor(1), propertyColor(0)].map(asStyle),
    );
    expect(found[0].parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(cell.textContent?.trim()).toBe('12');
  });

  it('puts the dots on a row of their own, not in the date row', async () => {
    renderWith([], [], [calEvent({})]);

    await waitFor(() => expect(dots(dayCell(12))).toHaveLength(1));
    const cell = dayCell(12);
    const wrapper = dots(cell)[0].parentElement!;
    // A direct child of the cell, so it is not squeezed in beside the day
    // number and the turnover icon.
    expect(wrapper.parentElement).toBe(cell);
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
    expect(wrapper).toHaveClass('max-w-full', 'overflow-hidden');
    // The date row is still there, holding the number and no dots.
    const dateRow = Array.from(cell.children).find((child) => child.textContent?.trim() === '12');
    expect(dateRow).toBeDefined();
    expect(dateRow).not.toBe(wrapper);
    expect(dateRow!.querySelector('[data-event-dot]')).toBeNull();
  });

  it('leaves out the events of a house the host has hidden', async () => {
    renderHouses({
      s01: [calEvent({ title: 'Plumber visit' })],
      s02: [calEvent({ propertyId: 's02', title: 'Cleaner' })],
    });

    await waitFor(() => expect(dots(dayCell(12))).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Sachi House 01' }));

    const found = dots(dayCell(12));
    expect(found).toHaveLength(1);
    expect(found[0].style.backgroundColor).toBe(asStyle(propertyColor(1)));

    await tapDay(12);
    const card = panel(12);
    expect(within(card).getByText(/Cleaner/)).toBeInTheDocument();
    expect(within(card).queryByText(/Plumber visit/)).toBeNull();
  });

  it('does not block or grey out a day that only has an event', async () => {
    renderWith([], [], [calEvent({})]);
    await tapDay(12);

    expect(within(panel(12)).getByText(/Plumber visit/)).toBeInTheDocument();
    expect(within(panel(12)).queryByText('Blocked')).toBeNull();
  });

  it('names events in the legend', async () => {
    renderWith([]);
    expect(await screen.findByText('Event')).toBeInTheDocument();
  });
});

/** A promise the test settles by hand, to hold a request in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

type OnProperty = (id: string, d: HostCalendarData) => void;

const calendarData = (events: PropertyCalendarEvent[] = []): HostCalendarData => ({
  propertyId: 's01',
  stays: [],
  manualBlockedDates: new Set<string>(),
  blockedDates: new Set<string>(),
  events,
});

/** Makes every later load answer at once with `data` for the one house. */
function loadAnswers(data: HostCalendarData) {
  loadCalendars.mockImplementation(async (_ids, onProperty) => {
    (onProperty as OnProperty | undefined)?.('s01', data);
    return { calendars: new Map([['s01', data]]), failedPropertyIds: [] };
  });
}

const addButton = (day: number) =>
  within(panel(day)).getByRole('button', { name: /Add event/ });
const queryAddButton = () => screen.queryByRole('button', { name: /Add event/ });

/** Taps the day, waits for the calendar to settle and opens the event sheet. */
async function openEventSheet(day = 12) {
  await tapDay(day);
  await waitFor(() => expect(addButton(day)).toBeEnabled());
  fireEvent.click(addButton(day));
  return screen.findByRole('dialog', { name: 'New event' });
}

const saveButton = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: /Save event/ });
const typeTitle = (dialog: HTMLElement, value: string) =>
  fireEvent.change(within(dialog).getByLabelText('Title *'), { target: { value } });

/** Taps the day, then the event row with this label, and waits for the sheet
 *  that edits it. */
async function openEditSheet(day = 12, label = '10:00–11:00 · Plumber visit') {
  await tapDay(day);
  const text = await within(panel(day)).findByText(label);
  fireEvent.click(text.closest('button')!);
  return screen.findByRole('dialog', { name: 'Edit event' });
}

const deleteButton = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: /Delete event/ });

type LoadResult = { calendars: Map<string, HostCalendarData>; failedPropertyIds: string[] };

/** Makes the next load wait for the test, keeping its per-house callback. */
function holdNextLoad() {
  const load = deferred<LoadResult>();
  const held: { onProperty?: OnProperty } = {};
  loadCalendars.mockImplementation((_ids, cb) => {
    held.onProperty = cb as OnProperty;
    return load.promise;
  });
  return { load, held };
}

const editDialog = () => screen.queryByRole('dialog', { name: 'Edit event' });

describe('adding an event from the day card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createCalendarEvent.mockReset();
  });

  it('offers Add event on a free day, under the empty message', async () => {
    renderWith([]);
    await tapDay(14);

    const card = panel(14);
    const empty = within(card).getByText(/Nothing on this day/);
    const add = addButton(14);
    expect(empty.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(add.parentElement).toHaveClass('border-t');
  });

  it('puts Add event after the rows of a busy day, behind a dividing line', async () => {
    renderWith(
      [stay({ checkInDate: dayIso(10), checkOutDate: dayIso(15) })],
      [],
      [calEvent({})],
    );
    await tapDay(12);

    const card = panel(12);
    const buttons = within(card).getAllByRole('button');
    const add = addButton(12);
    // The stay row and the event row are buttons too, so Add event being the
    // last button puts it after both; the event row is checked by position as well.
    expect(buttons.length).toBeGreaterThan(1);
    expect(buttons[buttons.length - 1]).toBe(add);
    const eventRow = within(card).getByText('10:00–11:00 · Plumber visit');
    expect(eventRow.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(add.parentElement).toHaveClass('border-t');
  });

  it('has no Add event while a range of days is picked', async () => {
    renderWith([]);
    await tapDay(12);
    await waitFor(() => expect(addButton(12)).toBeEnabled());
    await tapDay(14);

    await waitFor(() => expect(queryAddButton()).toBeNull());
  });

  it('has no Add event when no house has a calendar to put it on', async () => {
    loadCalendars.mockImplementation(async () =>
      ({ calendars: new Map(), failedPropertyIds: ['s01'] }));
    render(<CalendarPage />);
    expect(await screen.findByText(/Could not load Sachi House 01/)).toBeInTheDocument();

    await tapDay(12);
    expect(panel(12)).toBeInTheDocument();
    expect(queryAddButton()).toBeNull();
  });

  it('asks for the house only when there is more than one to pick from', async () => {
    renderWith([]);
    const dialog = await openEventSheet();
    expect(within(dialog).queryByRole('combobox')).toBeNull();
  });

  it('lists both houses, first one picked, on a two-house account', async () => {
    renderHouses({});
    const dialog = await openEventSheet();
    const select = within(dialog).getByRole('combobox') as HTMLSelectElement;
    expect(within(select).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Sachi House 01', 'Sachi House 02']);
    expect(select.value).toBe('s01');
  });

  it('does not offer a hidden house, and saves to the one left', async () => {
    renderHouses({});
    fireEvent.click(await screen.findByRole('button', { name: 'Sachi House 01' }));
    const dialog = await openEventSheet();
    expect(within(dialog).queryByRole('combobox')).toBeNull();

    createCalendarEvent.mockResolvedValue(calEvent({ propertyId: 's02', title: 'Cleaner' }));
    typeTitle(dialog, 'Cleaner');
    fireEvent.click(saveButton(dialog));
    await waitFor(() => expect(createCalendarEvent).toHaveBeenCalledTimes(1));
    expect(createCalendarEvent.mock.calls[0][0]).toBe('s02');
  });

  it('starts on the tapped day, 10:00 to 11:00, and wants a title', async () => {
    renderWith([]);
    const dialog = await openEventSheet();
    expect(within(dialog).getByLabelText('Date *')).toHaveValue(dayIso(12));
    expect(within(dialog).getByLabelText('Starts')).toHaveValue('10:00');
    expect(within(dialog).getByLabelText('Ends')).toHaveValue('11:00');

    fireEvent.click(saveButton(dialog));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give the event a title.');

    typeTitle(dialog, '   ');
    // Typing clears the message; saving whitespace brings it back.
    expect(within(dialog).queryByRole('alert')).toBeNull();
    fireEvent.click(saveButton(dialog));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give the event a title.');
    expect(createCalendarEvent).not.toHaveBeenCalled();
  });

  it('refuses an end that is not after the start', async () => {
    renderWith([]);
    const dialog = await openEventSheet();
    typeTitle(dialog, 'Cleaner');
    fireEvent.change(within(dialog).getByLabelText('Ends'), { target: { value: '10:00' } });
    fireEvent.click(saveButton(dialog));

    expect(within(dialog).getByRole('alert'))
      .toHaveTextContent('The end time has to be after the start time.');
    expect(createCalendarEvent).not.toHaveBeenCalled();
  });

  it('refuses a date outside the window the calendar shows', async () => {
    renderWith([]);
    const dialog = await openEventSheet();
    typeTitle(dialog, 'Cleaner');
    const date = within(dialog).getByLabelText('Date *');
    const outside = 'Events can only be added from 3 months back to a year ahead.';

    fireEvent.change(date, { target: { value: jstDateString(Date.now() + 400 * ONE_DAY_MS) } });
    fireEvent.click(saveButton(dialog));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(outside);

    fireEvent.change(date, { target: { value: jstDateString(Date.now() - 100 * ONE_DAY_MS) } });
    fireEvent.click(saveButton(dialog));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(outside);
    expect(createCalendarEvent).not.toHaveBeenCalled();
  });

  it('shows the saved event at once, without reloading the calendar', async () => {
    renderWith([]);
    const dialog = await openEventSheet();
    createCalendarEvent.mockResolvedValue(calEvent({ title: 'Cleaner', date: dayIso(12) }));
    typeTitle(dialog, 'Cleaner');
    fireEvent.click(saveButton(dialog));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New event' })).toBeNull());
    expect(within(panel(12)).getByText('10:00–11:00 · Cleaner')).toBeInTheDocument();
    expect(dots(dayCell(12))).toHaveLength(1);
    expect(createCalendarEvent).toHaveBeenCalledWith('s01', {
      title: 'Cleaner',
      note: '',
      date: dayIso(12),
      startTime: '10:00',
      endTime: '11:00',
    });
    expect(loadCalendars).toHaveBeenCalledTimes(1);
  });

  it('saves to the house picked, in that house colour', async () => {
    renderHouses({});
    const dialog = await openEventSheet();
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 's02' } });
    typeTitle(dialog, 'Cleaner');
    createCalendarEvent.mockResolvedValue(calEvent({ propertyId: 's02', title: 'Cleaner' }));
    fireEvent.click(saveButton(dialog));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New event' })).toBeNull());
    expect(createCalendarEvent.mock.calls[0][0]).toBe('s02');
    const card = panel(12);
    expect(within(card).getByText('10:00–11:00 · Cleaner')).toBeInTheDocument();
    expect(within(card).getByText('Sachi House 02')).toBeInTheDocument();
    const found = dots(dayCell(12));
    expect(found).toHaveLength(1);
    expect(found[0].style.backgroundColor).toBe(asStyle(propertyColor(1)));
  });

  it('holds Save while sending, and keeps the form when the server says no', async () => {
    renderWith([]);
    const dialog = await openEventSheet();
    const request = deferred<PropertyCalendarEvent>();
    createCalendarEvent.mockReturnValue(request.promise);
    typeTitle(dialog, 'Cleaner');
    fireEvent.click(saveButton(dialog));

    await waitFor(() => expect(saveButton(dialog)).toBeDisabled());
    await act(async () => { request.reject(new Error('Server said no')); });

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Server said no');
    expect(within(dialog).getByLabelText('Title *')).toHaveValue('Cleaner');
    expect(saveButton(dialog)).toBeEnabled();
    expect(screen.getByRole('dialog', { name: 'New event' })).toBe(dialog);
    expect(createCalendarEvent).toHaveBeenCalledTimes(1);
  });

  it('holds Add event while the calendar is loading', async () => {
    const data = calendarData();
    loadCalendars.mockImplementation((_ids, onProperty) => {
      (onProperty as OnProperty)('s01', data);
      return new Promise(() => {});
    });
    render(<CalendarPage />);
    await tapDay(12);

    const card = panel(12);
    expect(addButton(12)).toBeDisabled();
    expect(within(card).getByText('Updating calendar…')).toBeInTheDocument();
  });

  it('holds Save while a refresh is under way', async () => {
    renderWith([]);
    const dialog = await openEventSheet();
    typeTitle(dialog, 'Cleaner');
    expect(saveButton(dialog)).toBeEnabled();

    loadCalendars.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(saveButton(dialog)).toBeDisabled());
    expect(within(dialog).getByText('Updating calendar…')).toBeInTheDocument();
    fireEvent.click(saveButton(dialog));
    expect(createCalendarEvent).not.toHaveBeenCalled();
  });

  it('keeps a new event through a load that read the server before it was saved', async () => {
    renderWith([]);
    const dialog = await openEventSheet();
    typeTitle(dialog, 'Cleaner');

    // A: the POST, held open.
    const post = deferred<PropertyCalendarEvent>();
    createCalendarEvent.mockReturnValue(post.promise);
    fireEvent.click(saveButton(dialog));
    await waitFor(() => expect(saveButton(dialog)).toBeDisabled());

    // B: a refresh started while the POST is in flight. Its answer is the
    // server as it was before the event existed.
    const load = deferred<{ calendars: Map<string, HostCalendarData>; failedPropertyIds: string[] }>();
    let onProperty: OnProperty | undefined;
    loadCalendars.mockImplementation((_ids, cb) => {
      onProperty = cb as OnProperty;
      return load.promise;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(loadCalendars).toHaveBeenCalledTimes(2));

    const created = calEvent({ id: 'e-created', title: 'Cleaner', date: dayIso(12) });
    const label = '10:00–11:00 · Cleaner';
    await act(async () => { post.resolve(created); });
    expect(await within(panel(12)).findByText(label)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'New event' })).toBeNull();

    // B lands: first the per-house answer, then the reconcile, both without E.
    const stale = calendarData();
    await act(async () => {
      onProperty!('s01', stale);
      load.resolve({ calendars: new Map([['s01', stale]]), failedPropertyIds: [] });
    });
    await waitFor(() => expect(addButton(12)).toBeEnabled());
    expect(within(panel(12)).getAllByText(label)).toHaveLength(1);
    expect(dots(dayCell(12))).toHaveLength(1);

    // Third load: the server now has E. Shown once, not twice.
    loadAnswers(calendarData([created]));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(loadCalendars).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(addButton(12)).toBeEnabled());
    expect(within(panel(12)).getAllByText(label)).toHaveLength(1);
    expect(dots(dayCell(12))).toHaveLength(1);

    // Fourth load: E is gone on the server (removed elsewhere). The op was
    // dropped by the third load, which started after the POST returned, so
    // nothing holds E and it goes too.
    loadAnswers(calendarData());
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(loadCalendars).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(within(panel(12)).queryByText(label)).toBeNull());
    expect(dots(dayCell(12))).toHaveLength(0);
  });

  it('lets go of a new event once a load started after the save answers without it', async () => {
    renderWith([]);
    const dialog = await openEventSheet();
    createCalendarEvent.mockResolvedValue(calEvent({ id: 'e-new', title: 'Cleaner' }));
    typeTitle(dialog, 'Cleaner');
    fireEvent.click(saveButton(dialog));

    const label = '10:00–11:00 · Cleaner';
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New event' })).toBeNull());
    expect(within(panel(12)).getByText(label)).toBeInTheDocument();
    expect(dots(dayCell(12))).toHaveLength(1);

    // The server no longer has it (removed elsewhere). This load started after
    // the POST returned, so it is the truth and the event goes.
    loadAnswers(calendarData());
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(loadCalendars).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(addButton(12)).toBeEnabled());
    expect(within(panel(12)).queryByText(label)).toBeNull();
    expect(dots(dayCell(12))).toHaveLength(0);
  });

  it('saves to a house still on the calendar when a refresh loses the one the sheet had', async () => {
    renderHouses({});
    const dialog = await openEventSheet();
    expect((within(dialog).getByRole('combobox') as HTMLSelectElement).value).toBe('s01');

    // s01 fails this round, so only s02 is left to put an event on.
    const s02 = { ...calendarData(), propertyId: 's02' };
    loadCalendars.mockImplementation(async (_ids, onProperty) => {
      (onProperty as OnProperty)('s02', s02);
      return { calendars: new Map([['s02', s02]]), failedPropertyIds: ['s01'] };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(loadCalendars).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(saveButton(dialog)).toBeEnabled());

    createCalendarEvent.mockResolvedValue(calEvent({ propertyId: 's02', title: 'Cleaner' }));
    typeTitle(dialog, 'Cleaner');
    fireEvent.click(saveButton(dialog));
    await waitFor(() => expect(createCalendarEvent).toHaveBeenCalledTimes(1));
    expect(createCalendarEvent.mock.calls[0][0]).toBe('s02');
  });

  it('will not close while the POST is in flight, then closes once it lands', async () => {
    renderWith([]);
    const dialog = await openEventSheet();
    const post = deferred<PropertyCalendarEvent>();
    createCalendarEvent.mockReturnValue(post.promise);
    typeTitle(dialog, 'Cleaner');
    fireEvent.click(saveButton(dialog));
    await waitFor(() => expect(saveButton(dialog)).toBeDisabled());

    fireEvent.click(dialog.parentElement!);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog', { name: 'New event' })).toBe(dialog);

    await act(async () => { post.resolve(calEvent({ title: 'Cleaner' })); });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New event' })).toBeNull());
  });

  it('still closes on the backdrop and on Close when nothing is being sent', async () => {
    renderWith([]);
    let dialog = await openEventSheet();
    fireEvent.click(dialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New event' })).toBeNull());

    fireEvent.click(addButton(12));
    dialog = await screen.findByRole('dialog', { name: 'New event' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New event' })).toBeNull());
  });

  it('has no Delete in the sheet that makes a new event', async () => {
    renderWith([]);
    const dialog = await openEventSheet();
    expect(within(dialog).queryByRole('button', { name: /Delete event/ })).toBeNull();
  });
});

describe('changing and removing an event from the day card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createCalendarEvent.mockReset();
    updateCalendarEvent.mockReset();
    deleteCalendarEvent.mockReset();
  });

  const label = '10:00–11:00 · Plumber visit';

  it('opens the event with every field filled in, the house named and no house to pick', async () => {
    const event = calEvent({
      id: 'e-2',
      propertyId: 's02',
      note: 'Bring the spare key',
      startTime: '09:30',
      endTime: '10:15',
    });
    renderHouses({ s02: [event] });
    const dialog = await openEditSheet(12, '09:30–10:15 · Plumber visit');

    expect(screen.queryByRole('dialog', { name: 'New event' })).toBeNull();
    expect(within(dialog).getByRole('heading', { name: 'Edit event' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Title *')).toHaveValue('Plumber visit');
    expect(within(dialog).getByLabelText('Note')).toHaveValue('Bring the spare key');
    expect(within(dialog).getByLabelText('Date *')).toHaveValue(dayIso(12));
    expect(within(dialog).getByLabelText('Starts')).toHaveValue('09:30');
    expect(within(dialog).getByLabelText('Ends')).toHaveValue('10:15');
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    expect(within(dialog).getByText('Sachi House 02')).toBeInTheDocument();
    expect(deleteButton(dialog)).toBeInTheDocument();
  });

  it('checks the changes the same way a new event is checked', async () => {
    const event = calEvent({ id: 'e-2', propertyId: 's02', startTime: '09:30', endTime: '10:15' });
    renderHouses({ s02: [event] });
    const dialog = await openEditSheet(12, '09:30–10:15 · Plumber visit');
    await waitFor(() => expect(saveButton(dialog)).toBeEnabled());

    typeTitle(dialog, '');
    fireEvent.click(saveButton(dialog));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give the event a title.');

    typeTitle(dialog, 'Plumber visit');
    fireEvent.change(within(dialog).getByLabelText('Ends'), { target: { value: '09:30' } });
    fireEvent.click(saveButton(dialog));
    expect(within(dialog).getByRole('alert'))
      .toHaveTextContent('The end time has to be after the start time.');

    fireEvent.change(within(dialog).getByLabelText('Ends'), { target: { value: '10:15' } });
    fireEvent.change(within(dialog).getByLabelText('Date *'), {
      target: { value: jstDateString(Date.now() + 400 * ONE_DAY_MS) },
    });
    fireEvent.click(saveButton(dialog));
    expect(within(dialog).getByRole('alert'))
      .toHaveTextContent('Events can only be added from 3 months back to a year ahead.');
    expect(updateCalendarEvent).not.toHaveBeenCalled();
  });

  it('saves the trimmed changes and shows them at once, without reloading', async () => {
    const event = calEvent({ id: 'e-1' });
    renderWith([], [], [event]);
    const dialog = await openEditSheet();
    await waitFor(() => expect(saveButton(dialog)).toBeEnabled());

    typeTitle(dialog, '  Cleaner  ');
    fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: 'Back door' } });
    fireEvent.change(within(dialog).getByLabelText('Ends'), { target: { value: '12:00' } });
    updateCalendarEvent.mockResolvedValue({
      ...event, title: 'Cleaner', note: 'Back door', endTime: '12:00', updatedAt: 1,
    });
    fireEvent.click(saveButton(dialog));

    await waitFor(() => expect(editDialog()).toBeNull());
    expect(updateCalendarEvent).toHaveBeenCalledTimes(1);
    expect(updateCalendarEvent).toHaveBeenCalledWith('e-1', {
      title: 'Cleaner',
      note: 'Back door',
      date: dayIso(12),
      startTime: '10:00',
      endTime: '12:00',
    });
    const card = panel(12);
    expect(within(card).getByText('10:00–12:00 · Cleaner')).toBeInTheDocument();
    expect(within(card).queryByText(label)).toBeNull();
    expect(within(card).queryByText(/Plumber visit/)).toBeNull();
    expect(dots(dayCell(12))).toHaveLength(1);
    expect(loadCalendars).toHaveBeenCalledTimes(1);
  });

  it('moves the event to the new day when its date is changed', async () => {
    const event = calEvent({ id: 'e-1' });
    renderWith([], [], [event]);
    const dialog = await openEditSheet();
    await waitFor(() => expect(saveButton(dialog)).toBeEnabled());

    fireEvent.change(within(dialog).getByLabelText('Date *'), { target: { value: dayIso(14) } });
    updateCalendarEvent.mockResolvedValue({ ...event, date: dayIso(14), updatedAt: 1 });
    fireEvent.click(saveButton(dialog));

    await waitFor(() => expect(editDialog()).toBeNull());
    expect(updateCalendarEvent.mock.calls[0][1]).toMatchObject({ date: dayIso(14) });
    expect(within(panel(12)).getByText(/Nothing on this day/)).toBeInTheDocument();
    expect(dots(dayCell(12))).toHaveLength(0);
    expect(dots(dayCell(14))).toHaveLength(1);
    expect(loadCalendars).toHaveBeenCalledTimes(1);
  });

  it('deletes the event after the host confirms, without reloading', async () => {
    const event = calEvent({ id: 'e-1' });
    renderWith([], [], [event]);
    const dialog = await openEditSheet();
    await waitFor(() => expect(deleteButton(dialog)).toBeEnabled());
    expect(dots(dayCell(12))).toHaveLength(1);

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteCalendarEvent.mockResolvedValue(undefined);
    fireEvent.click(deleteButton(dialog));

    await waitFor(() => expect(editDialog()).toBeNull());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('Delete this event? This cannot be undone.');
    expect(deleteCalendarEvent).toHaveBeenCalledTimes(1);
    expect(deleteCalendarEvent).toHaveBeenCalledWith('e-1');
    expect(within(panel(12)).queryByText(label)).toBeNull();
    expect(dots(dayCell(12))).toHaveLength(0);
    expect(loadCalendars).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the host backs out of the confirm', async () => {
    renderWith([], [], [calEvent({ id: 'e-1' })]);
    const dialog = await openEditSheet();
    await waitFor(() => expect(deleteButton(dialog)).toBeEnabled());

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(deleteButton(dialog));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(deleteCalendarEvent).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Edit event' })).toBe(dialog);
    expect(deleteButton(dialog)).toBeEnabled();
    expect(within(panel(12)).getByText(label)).toBeInTheDocument();
    expect(dots(dayCell(12))).toHaveLength(1);
  });

  it('keeps the form and the row when the server refuses the change', async () => {
    renderWith([], [], [calEvent({ id: 'e-1' })]);
    const dialog = await openEditSheet();
    await waitFor(() => expect(saveButton(dialog)).toBeEnabled());
    updateCalendarEvent.mockRejectedValue(new Error('Calendar event not found.'));
    typeTitle(dialog, 'Cleaner');
    fireEvent.click(saveButton(dialog));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Calendar event not found.');
    expect(screen.getByRole('dialog', { name: 'Edit event' })).toBe(dialog);
    expect(within(dialog).getByLabelText('Title *')).toHaveValue('Cleaner');
    expect(saveButton(dialog)).toBeEnabled();
    expect(within(panel(12)).getByText(label)).toBeInTheDocument();
    expect(within(panel(12)).queryByText(/Cleaner/)).toBeNull();
  });

  it('keeps the sheet and the row when the server refuses the delete', async () => {
    renderWith([], [], [calEvent({ id: 'e-1' })]);
    const dialog = await openEditSheet();
    await waitFor(() => expect(deleteButton(dialog)).toBeEnabled());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteCalendarEvent.mockRejectedValue(new Error('Calendar event not found.'));
    fireEvent.click(deleteButton(dialog));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Calendar event not found.');
    expect(screen.getByRole('dialog', { name: 'Edit event' })).toBe(dialog);
    expect(deleteButton(dialog)).toBeEnabled();
    expect(within(panel(12)).getByText(label)).toBeInTheDocument();
    expect(dots(dayCell(12))).toHaveLength(1);
  });

  it('holds Save and Delete while the change is being sent', async () => {
    renderWith([], [], [calEvent({ id: 'e-1' })]);
    const dialog = await openEditSheet();
    await waitFor(() => expect(saveButton(dialog)).toBeEnabled());
    const patch = deferred<PropertyCalendarEvent>();
    updateCalendarEvent.mockReturnValue(patch.promise);
    typeTitle(dialog, 'Cleaner');
    fireEvent.click(saveButton(dialog));

    await waitFor(() => expect(saveButton(dialog)).toBeDisabled());
    expect(deleteButton(dialog)).toBeDisabled();
    await act(async () => { patch.reject(new Error('Server said no')); });
    expect(saveButton(dialog)).toBeEnabled();
    expect(deleteButton(dialog)).toBeEnabled();
  });

  it('opens the event while the calendar loads, but holds Save and Delete until it is done', async () => {
    const data = calendarData([calEvent({ id: 'e-1' })]);
    loadCalendars.mockImplementation((_ids, onProperty) => {
      (onProperty as OnProperty)('s01', data);
      return new Promise(() => {});
    });
    render(<CalendarPage />);
    const dialog = await openEditSheet();

    expect(saveButton(dialog)).toBeDisabled();
    expect(deleteButton(dialog)).toBeDisabled();
    expect(within(dialog).getByText('Updating calendar…')).toBeInTheDocument();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(deleteButton(dialog));
    expect(confirm).not.toHaveBeenCalled();
    expect(deleteCalendarEvent).not.toHaveBeenCalled();
  });

  it('holds Save and Delete when a refresh starts under the open sheet', async () => {
    renderWith([], [], [calEvent({ id: 'e-1' })]);
    const dialog = await openEditSheet();
    await waitFor(() => expect(saveButton(dialog)).toBeEnabled());
    expect(deleteButton(dialog)).toBeEnabled();

    loadCalendars.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(saveButton(dialog)).toBeDisabled());
    expect(deleteButton(dialog)).toBeDisabled();
    expect(within(dialog).getByText('Updating calendar…')).toBeInTheDocument();
  });

  it('will not close while the PATCH is in flight, then closes once it lands', async () => {
    const event = calEvent({ id: 'e-1' });
    renderWith([], [], [event]);
    const dialog = await openEditSheet();
    await waitFor(() => expect(saveButton(dialog)).toBeEnabled());
    const patch = deferred<PropertyCalendarEvent>();
    updateCalendarEvent.mockReturnValue(patch.promise);
    typeTitle(dialog, 'Cleaner');
    fireEvent.click(saveButton(dialog));
    await waitFor(() => expect(saveButton(dialog)).toBeDisabled());

    fireEvent.click(dialog.parentElement!);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog', { name: 'Edit event' })).toBe(dialog);

    await act(async () => { patch.resolve({ ...event, title: 'Cleaner', updatedAt: 1 }); });
    await waitFor(() => expect(editDialog()).toBeNull());
  });

  it('will not close while the DELETE is in flight, then closes once it lands', async () => {
    renderWith([], [], [calEvent({ id: 'e-1' })]);
    const dialog = await openEditSheet();
    await waitFor(() => expect(deleteButton(dialog)).toBeEnabled());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const del = deferred<void>();
    deleteCalendarEvent.mockReturnValue(del.promise);
    fireEvent.click(deleteButton(dialog));
    await waitFor(() => expect(deleteButton(dialog)).toBeDisabled());

    fireEvent.click(dialog.parentElement!);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog', { name: 'Edit event' })).toBe(dialog);

    await act(async () => { del.resolve(); });
    await waitFor(() => expect(editDialog()).toBeNull());
  });

  it('closes on the backdrop and on Close when nothing is being sent', async () => {
    renderWith([], [], [calEvent({ id: 'e-1' })]);
    let dialog = await openEditSheet();
    fireEvent.click(dialog.parentElement!);
    await waitFor(() => expect(editDialog()).toBeNull());

    fireEvent.click(within(panel(12)).getByText(label).closest('button')!);
    dialog = await screen.findByRole('dialog', { name: 'Edit event' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(editDialog()).toBeNull());
    expect(updateCalendarEvent).not.toHaveBeenCalled();
    expect(deleteCalendarEvent).not.toHaveBeenCalled();
  });

  it('does not bring back a deleted event through a load that read the server before the delete', async () => {
    const event = calEvent({ id: 'e-1' });
    renderWith([], [], [event]);
    const dialog = await openEditSheet();
    await waitFor(() => expect(deleteButton(dialog)).toBeEnabled());

    // A: the DELETE, held open.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const del = deferred<void>();
    deleteCalendarEvent.mockReturnValue(del.promise);
    fireEvent.click(deleteButton(dialog));
    await waitFor(() => expect(deleteButton(dialog)).toBeDisabled());

    // B: a refresh started while the DELETE is in flight. It read the server
    // while the event was still there.
    const { load, held } = holdNextLoad();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(loadCalendars).toHaveBeenCalledTimes(2));

    await act(async () => { del.resolve(); });
    await waitFor(() => expect(editDialog()).toBeNull());
    expect(within(panel(12)).queryByText(label)).toBeNull();

    // B lands with the event, per house and then in the reconcile.
    const stale = calendarData([event]);
    await act(async () => {
      held.onProperty!('s01', stale);
      load.resolve({ calendars: new Map([['s01', stale]]), failedPropertyIds: [] });
    });
    await waitFor(() => expect(addButton(12)).toBeEnabled());
    expect(within(panel(12)).queryByText(label)).toBeNull();
    expect(dots(dayCell(12))).toHaveLength(0);

    // A later load, from a server without it: still gone.
    loadAnswers(calendarData());
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(loadCalendars).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(addButton(12)).toBeEnabled());
    expect(within(panel(12)).queryByText(label)).toBeNull();
    expect(dots(dayCell(12))).toHaveLength(0);
  });

  it('does not undo a change through a load that read the server before the PATCH', async () => {
    const event = calEvent({ id: 'e-1' });
    renderWith([], [], [event]);
    const dialog = await openEditSheet();
    await waitFor(() => expect(saveButton(dialog)).toBeEnabled());

    const patch = deferred<PropertyCalendarEvent>();
    updateCalendarEvent.mockReturnValue(patch.promise);
    typeTitle(dialog, 'Cleaner');
    fireEvent.click(saveButton(dialog));
    await waitFor(() => expect(saveButton(dialog)).toBeDisabled());

    const { load, held } = holdNextLoad();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(loadCalendars).toHaveBeenCalledTimes(2));

    const changed = { ...event, title: 'Cleaner', updatedAt: 1 };
    const newLabel = '10:00–11:00 · Cleaner';
    await act(async () => { patch.resolve(changed); });
    await waitFor(() => expect(editDialog()).toBeNull());
    expect(within(panel(12)).getByText(newLabel)).toBeInTheDocument();

    // B lands with the old title.
    const stale = calendarData([event]);
    await act(async () => {
      held.onProperty!('s01', stale);
      load.resolve({ calendars: new Map([['s01', stale]]), failedPropertyIds: [] });
    });
    await waitFor(() => expect(addButton(12)).toBeEnabled());
    expect(within(panel(12)).getAllByText(newLabel)).toHaveLength(1);
    expect(within(panel(12)).queryByText(/Plumber visit/)).toBeNull();
    expect(dots(dayCell(12))).toHaveLength(1);
  });
});
