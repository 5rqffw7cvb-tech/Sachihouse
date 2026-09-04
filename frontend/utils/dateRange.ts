import { addDays, eachDayOfInterval, isBefore, isSameDay } from 'date-fns';

/**
 * The one definition of a stay selection and of what clicking a day does to it.
 *
 * Lives here rather than beside any one calendar because four of them now
 * share it — the booking widget, the pricing page panel, the listings search
 * prompt and the filter field — and they must agree, or the same click would
 * mean different things on different screens.
 */

// The chosen range, plus which end the next click lands on.
export interface BookingDateSelection {
  checkIn: Date | null;
  checkOut: Date | null;
  selecting: 'checkIn' | 'checkOut';
}

export const applyDatePick = (selection: BookingDateSelection, day: Date): BookingDateSelection => {
  const { checkIn, checkOut, selecting } = selection;

  if (selecting === 'checkIn') {
    // Keep an existing check-out only while it still falls after the new check-in.
    const keepsCheckOut = checkOut && !isBefore(checkOut, day) && !isSameDay(checkOut, day);
    return { checkIn: day, checkOut: keepsCheckOut ? checkOut : null, selecting: 'checkOut' };
  }

  // Picking a check-out on or before the check-in reads as "start over here".
  if (!checkIn || isBefore(day, checkIn) || isSameDay(day, checkIn)) {
    return { checkIn: day, checkOut: null, selecting: 'checkOut' };
  }

  return { checkIn, checkOut: day, selecting: 'checkIn' };
};

const atMidnight = (date: Date): Date => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

/**
 * The nights a stay actually occupies: check-in night through the night before
 * check-out. The check-out date itself is a morning, not a night.
 */
export const stayNights = (checkIn: Date, checkOut: Date): Date[] => {
  const start = atMidnight(checkIn);
  const end = atMidnight(checkOut);
  if (!isBefore(start, end)) return [];
  return eachDayOfInterval({ start, end: addDays(end, -1) });
};

/**
 * Whether a calendar day can be clicked, given what the next click means.
 *
 * `isNightUnavailable` answers about *nights*, so it must not be asked about a
 * day the guest would only ever see the morning of. A stay ending on the 20th
 * leaves before the guest arriving that afternoon — the 20th being taken says
 * nothing about whether that stay can be booked, and refusing it costs a night
 * on either side of every arrival.
 *
 * The mirror of that: while picking a check-out, a free day sitting beyond a
 * taken night is not reachable either, because the stay would have to pass
 * through the night someone else has.
 */
export const isDayPickable = (
  selection: BookingDateSelection,
  day: Date,
  isNightUnavailable: (day: Date) => boolean,
): boolean => {
  const { checkIn, selecting } = selection;

  if (selecting === 'checkOut' && checkIn && isBefore(atMidnight(checkIn), atMidnight(day))) {
    return stayNights(checkIn, day).every((night) => !isNightUnavailable(night));
  }

  // Every other click lands on a check-in — including one at or before the
  // current check-in, which applyDatePick reads as starting the range over.
  return !isNightUnavailable(day);
};
