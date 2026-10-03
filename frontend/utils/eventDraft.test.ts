import { describe, expect, it } from 'vitest';
import {
  EVENT_FUTURE_DAYS,
  EVENT_PAST_DAYS,
  EventDraft,
  eventDateWindow,
  jstDateString,
  ONE_DAY_MS,
  validateEventDraft,
} from './eventDraft';

// 00:00 on 3 October 2026 in Tokyo, which is still the 2nd in UTC. A fixed
// instant so the window does not move with the day the suite runs.
const NOW = Date.UTC(2026, 9, 2, 15, 0);

const draft = (over: Partial<EventDraft> = {}): EventDraft => ({
  title: 'Cleaner',
  note: '',
  date: '2026-10-10',
  startTime: '10:00',
  endTime: '11:00',
  ...over,
});

describe('jstDateString', () => {
  it('reads the Tokyo date, not the UTC one, across JST midnight', () => {
    expect(jstDateString(Date.UTC(2026, 9, 2, 14, 59))).toBe('2026-10-02');
    expect(jstDateString(Date.UTC(2026, 9, 2, 15, 0))).toBe('2026-10-03');
  });
});

describe('eventDateWindow', () => {
  it('runs from 90 days back to 365 days ahead, in JST days', () => {
    expect(EVENT_PAST_DAYS).toBe(90);
    expect(EVENT_FUTURE_DAYS).toBe(365);
    expect(ONE_DAY_MS).toBe(86_400_000);
    expect(eventDateWindow(NOW)).toEqual({ from: '2026-07-05', to: '2027-10-03' });
  });
});

describe('validateEventDraft', () => {
  it('accepts a complete draft', () => {
    expect(validateEventDraft(draft(), NOW)).toBeNull();
  });

  it('wants a title, and whitespace is not one', () => {
    expect(validateEventDraft(draft({ title: '' }), NOW)).toBe('Give the event a title.');
    expect(validateEventDraft(draft({ title: '   ' }), NOW)).toBe('Give the event a title.');
  });

  it('caps the title at 200 characters', () => {
    expect(validateEventDraft(draft({ title: 'a'.repeat(200) }), NOW)).toBeNull();
    expect(validateEventDraft(draft({ title: 'a'.repeat(201) }), NOW))
      .toBe('Keep the title under 200 characters.');
  });

  it('wants a YYYY-MM-DD date', () => {
    expect(validateEventDraft(draft({ date: '' }), NOW)).toBe('Pick a date.');
    expect(validateEventDraft(draft({ date: '2026/10/10' }), NOW)).toBe('Pick a date.');
  });

  it('takes both ends of the window and refuses the day beyond each', () => {
    const outside = 'Events can only be added from 3 months back to a year ahead.';
    expect(validateEventDraft(draft({ date: '2026-07-05' }), NOW)).toBeNull();
    expect(validateEventDraft(draft({ date: '2027-10-03' }), NOW)).toBeNull();
    expect(validateEventDraft(draft({ date: '2026-07-04' }), NOW)).toBe(outside);
    expect(validateEventDraft(draft({ date: '2027-10-04' }), NOW)).toBe(outside);
  });

  it('wants both times', () => {
    const missing = 'Pick a start and an end time.';
    expect(validateEventDraft(draft({ startTime: '' }), NOW)).toBe(missing);
    expect(validateEventDraft(draft({ endTime: '' }), NOW)).toBe(missing);
    expect(validateEventDraft(draft({ startTime: '24:00' }), NOW)).toBe(missing);
  });

  it('wants the end after the start', () => {
    const order = 'The end time has to be after the start time.';
    expect(validateEventDraft(draft({ startTime: '10:00', endTime: '10:00' }), NOW)).toBe(order);
    expect(validateEventDraft(draft({ startTime: '10:00', endTime: '09:59' }), NOW)).toBe(order);
    expect(validateEventDraft(draft({ startTime: '23:58', endTime: '23:59' }), NOW)).toBeNull();
  });

  it('reports the first problem in the order of the form', () => {
    expect(validateEventDraft(draft({ title: '', date: '', endTime: '' }), NOW))
      .toBe('Give the event a title.');
    expect(validateEventDraft(draft({ date: '2020-01-01', endTime: '' }), NOW))
      .toBe('Events can only be added from 3 months back to a year ahead.');
  });
});
