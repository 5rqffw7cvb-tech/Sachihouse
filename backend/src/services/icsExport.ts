import { addDays, format, parseISO } from 'date-fns';

// A single booking to advertise on the export feed. Dates are YYYY-MM-DD with
// checkOut exclusive (guest leaves that morning), matching iCal DTEND semantics.
export interface ExportBooking {
  id: string;
  checkInDate: string;
  checkOutDate: string;
  guestName?: string;
}

interface BuildIcsOptions {
  propertyId: string;
  propertyName: string;
  // Manually blocked YYYY-MM-DD dates (each is a single blocked night).
  manualBlockedDates: string[];
  // Direct bookings to publish as reserved ranges.
  bookings: ExportBooking[];
}

// Folds RFC 5545 lines to <=75 octets. We keep it simple (ASCII summaries only)
// so a byte-length fold matches a character fold.
function foldLine(line: string): string {
  if (line.length <= 75) {
    return line;
  }
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    chunks.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  chunks.push(` ${rest}`);
  return chunks.join('\r\n');
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function toIcsDate(date: Date): string {
  return format(date, 'yyyyMMdd');
}

// Collapses a set of single blocked days into [start, endExclusive) ranges so we
// emit one VEVENT per consecutive stretch instead of one per night.
function coalesceRanges(dates: string[]): Array<{ start: Date; endExclusive: Date }> {
  const sorted = Array.from(new Set(dates)).sort();
  const ranges: Array<{ start: Date; endExclusive: Date }> = [];

  for (const iso of sorted) {
    const day = parseISO(iso);
    if (Number.isNaN(day.getTime())) {
      continue;
    }
    const last = ranges[ranges.length - 1];
    if (last && format(last.endExclusive, 'yyyy-MM-dd') === iso) {
      // Contiguous with the previous range: extend it by one night.
      last.endExclusive = addDays(day, 1);
    } else {
      ranges.push({ start: day, endExclusive: addDays(day, 1) });
    }
  }

  return ranges;
}

function buildEvent(uid: string, dtstamp: string, start: Date, endExclusive: Date, summary: string): string[] {
  return [
    'BEGIN:VEVENT',
    foldLine(`UID:${uid}`),
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${toIcsDate(start)}`,
    `DTEND;VALUE=DATE:${toIcsDate(endExclusive)}`,
    foldLine(`SUMMARY:${escapeText(summary)}`),
    'TRANSP:OPAQUE',
    'END:VEVENT',
  ];
}

// Builds an RFC 5545 VCALENDAR advertising this property's unavailable dates so
// other platforms (Airbnb, Booking.com, …) can import it. Only host-managed
// manual blocks and direct bookings are exported — dates imported from other
// platforms are intentionally excluded to avoid cross-platform sync loops.
export function buildPropertyIcs(options: BuildIcsOptions): string {
  const dtstamp = `${format(new Date(), "yyyyMMdd'T'HHmmss")}Z`;
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SachiHouse//Calendar Export//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldLine(`X-WR-CALNAME:${escapeText(options.propertyName || options.propertyId)}`),
  ];

  for (const range of coalesceRanges(options.manualBlockedDates)) {
    const uid = `block-${options.propertyId}-${toIcsDate(range.start)}@sachihouse`;
    lines.push(...buildEvent(uid, dtstamp, range.start, range.endExclusive, 'Blocked'));
  }

  for (const booking of options.bookings) {
    const start = parseISO(booking.checkInDate);
    const endExclusive = parseISO(booking.checkOutDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime()) || !(start < endExclusive)) {
      continue;
    }
    const uid = `booking-${options.propertyId}-${booking.id}@sachihouse`;
    const summary = booking.guestName ? `Reserved - ${booking.guestName}` : 'Reserved';
    lines.push(...buildEvent(uid, dtstamp, start, endExclusive, summary));
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
