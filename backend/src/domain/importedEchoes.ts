import { ImportedEvent } from '../store/types.js';

/**
 * Recognising our own export coming back through a channel manager.
 *
 * Our iCal export publishes manual blocks and off-platform confirmations so
 * other platforms stop selling those nights. A channel manager that subscribes
 * to it does exactly that — and then re-publishes the same nights on its *own*
 * export feed as an anonymous "not available" block, which we import back. The
 * stay then exists twice: once as the confirmation the host entered, once as a
 * block attributed to Hostex. On the cleaning calendar that reads as a
 * same-day turnover on every single night of the stay; on the host calendar
 * the echo hides the booking it came from.
 *
 * The export side already refuses to re-publish what it imported, but that
 * only breaks the loop in one direction — it cannot recognise its own block
 * returning under someone else's UID.
 */

/** A night range we already own: a manual confirmation, or a direct booking. */
export interface OwnStayNights {
  /** Every night (check-out morning excluded) claimed by our own records. */
  nights: Set<string>;
}

// A real OTA reservation always arrives with an identity — a reservation code
// in the DESCRIPTION, or a guest name in the SUMMARY. An echo of our own block
// has neither: the channel manager only knows those nights are unavailable, not
// who is in them. Requiring anonymity is what keeps a genuine double booking
// (two guests, same dates, two platforms) visible instead of being swallowed.
const ANONYMOUS_SUMMARY = /\b(not available|unavailable|blocked|closed)\b/i;
const RESERVATION_CODE = /reservation code\s*:/i;

export function isAnonymousBlock(event: ImportedEvent): boolean {
  if (RESERVATION_CODE.test(event.description ?? '')) {
    return false;
  }
  return ANONYMOUS_SUMMARY.test(event.summary ?? '');
}

/**
 * True when every night this event covers is already claimed by one of our own
 * records. Whole-range containment rather than an exact date match on purpose:
 * a channel manager is free to coalesce two adjacent blocks of ours into one
 * event, and that merged block is still nothing but our own data returning.
 *
 * An anonymous block that covers even one night we don't own is left alone —
 * that night is real news from the other platform.
 */
export function isEchoOfOwnStay(event: ImportedEvent, own: OwnStayNights): boolean {
  if (!isAnonymousBlock(event) || event.dates.length === 0) {
    return false;
  }
  return event.dates.every((date) => own.nights.has(date));
}

export interface EchoSplit {
  /** Events to show: real OTA reservations, plus blocks we didn't originate. */
  kept: ImportedEvent[];
  /** Suppressed echoes of our own export. */
  echoes: ImportedEvent[];
  /**
   * Nights that no *kept* event accounts for but an echo did — these must stop
   * being reported as imported-blocked, or the calendar would still draw the
   * suppressed block, just without a name on it.
   */
  echoOnlyNights: Set<string>;
}

export function splitEchoedEvents(events: ImportedEvent[], own: OwnStayNights): EchoSplit {
  const kept: ImportedEvent[] = [];
  const echoes: ImportedEvent[] = [];

  for (const event of events) {
    (isEchoOfOwnStay(event, own) ? echoes : kept).push(event);
  }

  const keptNights = new Set(kept.flatMap((event) => event.dates));
  const echoOnlyNights = new Set(
    echoes.flatMap((event) => event.dates).filter((date) => !keptNights.has(date)),
  );

  return { kept, echoes, echoOnlyNights };
}
