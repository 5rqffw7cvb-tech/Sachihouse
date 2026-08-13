import { isBefore, isSameDay } from 'date-fns';

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
