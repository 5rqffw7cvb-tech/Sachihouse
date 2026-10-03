import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import {
  createCalendarEvent,
  deleteCalendarEvent,
  type PropertyCalendarEvent,
  type PropertyCalendarEventInput,
  updateCalendarEvent,
} from './calendar';

// The network boundary is stubbed, not apiRequest, so these exercise the real
// URL building, JSON body and error mapping. API_BASE depends on the env, so
// URLs are checked by their ending only.
const respond = (status: number, body?: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
});

function stubFetch(status: number, body?: unknown) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => respond(status, body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function firstCall(fetchMock: ReturnType<typeof stubFetch>) {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [input, init] = fetchMock.mock.calls[0];
  return { url: String(input), init: init ?? {} };
}

const event: PropertyCalendarEvent = {
  id: 'e1',
  propertyId: 'p1',
  title: 'Plumber visit',
  note: 'Bring the spare key',
  date: '2026-10-20',
  startTime: '10:00',
  endTime: '11:30',
  createdAt: 1790000000000,
  updatedAt: 1790000000000,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createCalendarEvent', () => {
  it('POSTs the input under the property and returns the created event', async () => {
    const fetchMock = stubFetch(201, { event });
    const input: PropertyCalendarEventInput = {
      title: 'Plumber visit',
      note: 'Bring the spare key',
      date: '2026-10-20',
      startTime: '10:00',
      endTime: '11:30',
    };

    const result = await createCalendarEvent('p1', input);

    const { url, init } = firstCall(fetchMock);
    expect(url.endsWith('/properties/p1/events')).toBe(true);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(input);
    expect(result).toEqual(event);
  });

  it('rejects with the server message and status when the input is refused', async () => {
    stubFetch(400, { error: 'endTime must be later than startTime.' });

    const pending = createCalendarEvent('p1', {
      title: 'Backwards',
      date: '2026-10-20',
      startTime: '12:00',
      endTime: '11:00',
    });

    await expect(pending).rejects.toBeInstanceOf(ApiError);
    await expect(pending).rejects.toMatchObject({
      message: 'endTime must be later than startTime.',
      status: 400,
    });
  });
});

describe('updateCalendarEvent', () => {
  it('PATCHes the event by its own id with only the changed fields', async () => {
    const updated = { ...event, title: 'Electrician visit', updatedAt: event.updatedAt + 1 };
    const fetchMock = stubFetch(200, { event: updated });

    const result = await updateCalendarEvent('e1', { title: 'Electrician visit' });

    const { url, init } = firstCall(fetchMock);
    expect(url.endsWith('/calendar-events/e1')).toBe(true);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ title: 'Electrician visit' });
    expect(result).toEqual(updated);
  });
});

describe('deleteCalendarEvent', () => {
  it('DELETEs the event by its id with no body and resolves to nothing', async () => {
    const fetchMock = stubFetch(204);

    const result = await deleteCalendarEvent('e1');

    const { url, init } = firstCall(fetchMock);
    expect(url.endsWith('/calendar-events/e1')).toBe(true);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(result).toBeUndefined();
  });

  it('rejects with the server message when the event is gone', async () => {
    stubFetch(404, { error: 'Calendar event not found.' });

    const pending = deleteCalendarEvent('missing');

    await expect(pending).rejects.toBeInstanceOf(ApiError);
    await expect(pending).rejects.toMatchObject({
      message: 'Calendar event not found.',
      status: 404,
    });
  });
});
