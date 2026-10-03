/**
 * What a host's calendar event has to look like before it is worth sending.
 *
 * These rules are a copy of parseCalendarEventFields in backend/src/app.ts,
 * kept here so a mistake shows up in the sheet rather than as a 400 after a
 * round trip. Being a copy, it can drift — eventDraft.test.ts states each rule
 * so the drift is visible.
 *
 * One rule is stricter than the API's: the date has to sit inside the window
 * the server sends events back for (90 days back, 365 ahead, in JST days). An
 * event saved outside it is accepted and then never shown again, which reads
 * to the host as an event that was lost.
 */

export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const EVENT_PAST_DAYS = 90;
export const EVENT_FUTURE_DAYS = 365;

const TITLE_MAX = 200;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HM_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The calendar date in Tokyo at the given instant, as YYYY-MM-DD.
 *
 * Mirrors toJstDateString in backend/src/domain/booking.ts. toISOString is
 * safe here only because the offset has already been added: it reads the
 * shifted instant in UTC, which is the JST wall clock whatever the device's
 * own time zone is.
 */
export function jstDateString(timestamp: number): string {
  return new Date(timestamp + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** First and last date (both included) an event may be put on. */
export function eventDateWindow(now: number = Date.now()): { from: string; to: string } {
  return {
    from: jstDateString(now - EVENT_PAST_DAYS * ONE_DAY_MS),
    to: jstDateString(now + EVENT_FUTURE_DAYS * ONE_DAY_MS),
  };
}

export interface EventDraft {
  title: string;
  note: string;
  date: string;
  startTime: string;
  endTime: string;
}

/**
 * @returns The first problem in the order a host reads the form, or null.
 */
export function validateEventDraft(draft: EventDraft, now: number = Date.now()): string | null {
  const title = draft.title.trim();
  if (!title) return 'Give the event a title.';
  if (title.length > TITLE_MAX) return 'Keep the title under 200 characters.';

  if (!ISO_DATE.test(draft.date)) return 'Pick a date.';
  // ISO dates compare correctly as strings.
  const { from, to } = eventDateWindow(now);
  if (draft.date < from || draft.date > to) {
    return 'Events can only be added from 3 months back to a year ahead.';
  }

  if (!HM_TIME.test(draft.startTime) || !HM_TIME.test(draft.endTime)) {
    return 'Pick a start and an end time.';
  }
  // Zero-padded HH:mm compares correctly as strings too.
  if (draft.endTime <= draft.startTime) return 'The end time has to be after the start time.';

  return null;
}
