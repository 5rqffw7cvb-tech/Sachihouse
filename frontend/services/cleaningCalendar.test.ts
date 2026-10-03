import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { getCleaningCalendar, type CleaningEvent, type CleaningStay } from './cleaningCalendar';

// The network boundary is stubbed, not apiRequest, so the real URL building
// and error mapping run. API_BASE depends on the env: URLs are checked by
// their ending only.
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

const s: CleaningStay = {
  propertyId: 'p1',
  propertyName: 'House A',
  checkInDate: '2026-10-05',
  checkOutDate: '2026-10-08',
  checkInTime: '15:00',
  checkOutTime: '10:00',
  source: 'Airbnb',
  guestCount: 2,
  isBlock: false,
};

const e: CleaningEvent = {
  propertyId: 'p1',
  propertyName: 'House A',
  date: '2026-10-14',
  startTime: '09:00',
  endTime: '10:00',
  title: 'Plumber',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getCleaningCalendar', () => {
  it('32a: an older backend without events yields an empty list', async () => {
    stubFetch(200, { stays: [s] });
    await expect(getCleaningCalendar('tok', '2026-10-01', '2026-10-31')).resolves.toEqual({ stays: [s], events: [] });
  });

  it('32a2: events: null is also treated as none', async () => {
    stubFetch(200, { stays: [s], events: null });
    const data = await getCleaningCalendar('tok', '2026-10-01', '2026-10-31');
    expect(data.events).toEqual([]);
  });

  it('32b: events are passed through unchanged', async () => {
    stubFetch(200, { stays: [s], events: [e, { ...e, title: 'Second' }] });
    await expect(getCleaningCalendar('tok', '2026-10-01', '2026-10-31')).resolves.toEqual({
      stays: [s],
      events: [e, { ...e, title: 'Second' }],
    });
  });

  it('32c: URL is unchanged (token encoded, from/to as query)', async () => {
    const fetchMock = stubFetch(200, { stays: [], events: [] });
    await getCleaningCalendar('tok', '2026-10-01', '2026-10-31');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/cleaning-calendar\/tok\?from=2026-10-01&to=2026-10-31$/);

    await getCleaningCalendar('a b/c', '2026-10-01', '2026-10-31');
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/cleaning-calendar\/a%20b%2Fc\?from=2026-10-01&to=2026-10-31$/);
  });

  it('32d: 404 rejects with ApiError status 404', async () => {
    stubFetch(404, { error: 'Not found' });
    const err = await getCleaningCalendar('tok', '2026-10-01', '2026-10-31').catch((x: unknown) => x);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
  });
});
