import { BookingDateSelection } from '../components/BookingWidget';

/**
 * The stay a guest picked on the listings search, carried between pages in the
 * URL so a property page can open on those dates and that party rather than
 * asking for them a second time.
 */

// Parsed as a local date on purpose: `new Date('2026-08-16')` is UTC midnight,
// which lands on the 15th for anyone west of Greenwich.
const parseYmd = (value: string | null): Date | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseCount = (value: string | null): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

export interface StayFromParams {
  /** Null unless both dates are present and the range is at least one night. */
  selection: BookingDateSelection | null;
  /** Null unless an adult count came through; children alone is not a party. */
  guests: { adults: number; children: number } | null;
}

export const readStayFromParams = (params: URLSearchParams): StayFromParams => {
  const checkIn = parseYmd(params.get('checkIn'));
  const checkOut = parseYmd(params.get('checkOut'));
  const adults = parseCount(params.get('adults'));
  const children = parseCount(params.get('children'));

  const hasRange = !!checkIn && !!checkOut && checkOut > checkIn;

  return {
    selection: hasRange ? { checkIn, checkOut, selecting: 'checkIn' } : null,
    guests: adults > 0 ? { adults, children } : null,
  };
};
