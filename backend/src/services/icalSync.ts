import { addDays, format, isValid, parseISO, subDays } from 'date-fns';
import { ImportedEvent, PropertyData } from '../store/types.js';

export type { ImportedEvent };

type FetchMode = 'stale-ok' | 'fresh-if-stale';

interface IcalSyncOptions {
  enabled: boolean;
  ttlMs: number;
  timeoutMs: number;
}

// The subset of DataStore this service needs to persist imported events —
// kept narrow so unit tests can construct a service without a full store.
export interface ImportedEventStore {
  upsertImportedEvents(propertyId: string, events: ImportedEvent[]): Promise<void>;
  pruneMissingImportedEvents(propertyId: string, keepExternalIds: string[], cutoffDateIso: string): Promise<void>;
  listImportedEvents(propertyId: string): Promise<ImportedEvent[]>;
}

// Hostex is a channel manager: one aggregated feed carries bookings synced in
// from several OTAs, and encodes which one in its own reservation code, e.g.
// "Hostex reservation code: 0-HM5R8EW9YC-iffeae12sl". This mapping is not
// publicly documented by Hostex — it was confirmed against a real Hostex
// account by cross-checking the channel prefix against what the Hostex
// dashboard itself reports for the same reservation. Any prefix not listed
// here (or a feed that isn't Hostex at all) is left unclassified rather than
// guessed.
const HOSTEX_CHANNEL_PREFIXES: Record<string, string> = {
  '0': 'Airbnb',
  '9': 'Booking.com',
  // Booked through Hostex's own widget/dashboard, not synced in from an OTA.
  // Named distinctly from our own site's "Direct booking" (a Stripe-paid
  // Booking row) so the two are never confused on the host calendar.
  '5': 'Hostex Direct',
};

function detectHostexChannel(description: string): string | null {
  const match = description.match(/Hostex reservation code:\s*(\d+)-/i);
  return match ? HOSTEX_CHANNEL_PREFIXES[match[1]] ?? null : null;
}

// The full Hostex reservation code (not just the channel-prefix digit) is
// already a unique-per-reservation string — reuse it as the persistence
// key so re-fetching the same feed updates the same row instead of creating
// a duplicate.
function extractReservationCode(description: string): string | null {
  const match = description.match(/Hostex reservation code:\s*([\w-]+)/i);
  return match ? match[1].trim() : null;
}

interface CacheEntry {
  expiresAt: number;
  blockedDates: string[];
  events: ImportedEvent[];
}

function parseICSDate(raw: string): Date | null {
  if (!raw || raw.length < 8) {
    return null;
  }

  const date = parseISO(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`);
  return isValid(date) ? date : null;
}

// RFC 5545 folds long lines with a CRLF followed by a single space or tab —
// without unfolding first, a folded SUMMARY/DESCRIPTION would be silently
// truncated at whatever column the sender wrapped it at.
function unfoldLines(content: string): string[] {
  const rawLines = content.split(/\r\n|\n|\r/);
  const unfolded: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

// Reverses the TEXT escaping RFC 5545 requires (backslash, comma, semicolon,
// newline) so SUMMARY/DESCRIPTION display as the sender actually wrote them.
function unescapeText(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '\\' && i + 1 < value.length) {
      const next = value[i + 1];
      if (next === 'n' || next === 'N') {
        out += '\n';
        i++;
        continue;
      }
      if (next === ',' || next === ';' || next === '\\') {
        out += next;
        i++;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

// Most OTA feeds never mention a guest count in plain text at all — this only
// catches the rare feed that does (e.g. "2 guests", "Guests: 2"). Absence is
// the common case, not a parsing failure.
function extractGuestCount(text: string): number | null {
  const match = text.match(/(\d+)\s*guests?\b/i) ?? text.match(/guests?\s*[:\-]\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function parseICSEvents(content: string, feedId: string, feedName: string): ImportedEvent[] {
  const lines = unfoldLines(content);
  const events: ImportedEvent[] = [];

  let inEvent = false;
  let dtStart: Date | null = null;
  let dtEnd: Date | null = null;
  let summary = '';
  let description = '';

  let uid = '';

  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) {
      inEvent = true;
      dtStart = null;
      dtEnd = null;
      summary = '';
      description = '';
      uid = '';
      continue;
    }

    if (line.startsWith('END:VEVENT')) {
      inEvent = false;
      if (dtStart && dtEnd && dtStart < dtEnd) {
        const endInclusive = subDays(dtEnd, 1);
        if (dtStart <= endInclusive) {
          const dates: string[] = [];
          for (let cursor = dtStart; cursor <= endInclusive; cursor = addDays(cursor, 1)) {
            dates.push(format(cursor, 'yyyy-MM-dd'));
          }
          const checkInDate = format(dtStart, 'yyyy-MM-dd');
          const checkOutDate = format(dtEnd, 'yyyy-MM-dd');
          // Prefer a real identifier (Hostex's own reservation code, or the
          // feed's UID) over the composite fallback — either survives a
          // guest's dates being edited, the fallback does not.
          const externalId = extractReservationCode(description) || uid
            || `${feedId}|${checkInDate}|${checkOutDate}|${summary}`;
          events.push({
            externalId,
            feedId,
            feedName,
            channelName: detectHostexChannel(description),
            summary: summary || 'Reserved',
            description,
            checkInDate,
            checkOutDate,
            dates,
            guestCount: extractGuestCount(`${summary} ${description}`),
          });
        }
      }
      continue;
    }

    if (!inEvent) {
      continue;
    }

    if (line.startsWith('DTSTART')) {
      dtStart = parseICSDate(line.split(':')[1] ?? '');
      continue;
    }

    if (line.startsWith('DTEND')) {
      dtEnd = parseICSDate(line.split(':')[1] ?? '');
      continue;
    }

    if (/^SUMMARY[:;]/i.test(line)) {
      summary = unescapeText(line.slice(line.indexOf(':') + 1));
      continue;
    }

    if (/^DESCRIPTION[:;]/i.test(line)) {
      description = unescapeText(line.slice(line.indexOf(':') + 1));
      continue;
    }

    if (/^UID[:;]/i.test(line)) {
      uid = unescapeText(line.slice(line.indexOf(':') + 1));
    }
  }

  return events;
}

function mergeDates(baseDates: string[], icalDates: string[]): string[] {
  return Array.from(new Set([...baseDates, ...icalDates])).sort();
}

function isLikelyPlaceholder(url: string): boolean {
  return /example\.com/i.test(url) || url.includes('...');
}

// Returns `null` specifically when the fetch itself failed (network error,
// timeout, non-2xx, unparseable response) — as opposed to a feed that
// fetched fine and genuinely lists zero reservations right now. The caller
// uses this distinction to decide whether it's safe to treat "missing from
// this fetch" as a cancellation; a transient failure must never be allowed
// to look like "the OTA has no more bookings" and wipe real future stays.
async function fetchIcalFeed(
  feed: { id: string; name: string; url: string },
  timeoutMs: number,
): Promise<ImportedEvent[] | null> {
  const cleaned = feed.url.trim();
  if (!cleaned || !/^https?:\/\//i.test(cleaned) || isLikelyPlaceholder(cleaned)) {
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(cleaned, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'SachiHouse iCal Sync/1.0',
      },
    });

    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    if (!text.includes('BEGIN:VCALENDAR')) {
      return null;
    }

    return parseICSEvents(text, feed.id, feed.name || 'Imported');
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export class IcalSyncService {
  private readonly options: IcalSyncOptions;
  private readonly store?: ImportedEventStore;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<CacheEntry>>();

  constructor(options: IcalSyncOptions, store?: ImportedEventStore) {
    this.options = options;
    this.store = store;
  }

  private async refresh(propertyId: string, feeds: PropertyData['icalFeeds']): Promise<CacheEntry> {
    const existing = this.inflight.get(propertyId);
    if (existing) {
      return existing;
    }

    const next = (async () => {
      const events: ImportedEvent[] = [];
      let allFeedsOk = true;
      for (const feed of feeds) {
        const result = await fetchIcalFeed(feed, this.options.timeoutMs);
        if (result === null) {
          allFeedsOk = false;
          continue;
        }
        events.push(...result);
      }

      if (this.store) {
        await this.store.upsertImportedEvents(propertyId, events);
        // Only reconcile cancellations when every configured feed answered
        // this round — a feed that timed out must never look like "the OTA
        // has nothing left" and wipe real future bookings from that feed.
        // Also require at least one feed to be configured to prevent accidental
        // data loss if feeds are accidentally cleared.
        if (allFeedsOk && feeds.length > 0) {
          const cutoff = format(new Date(), 'yyyy-MM-dd');
          await this.store.pruneMissingImportedEvents(propertyId, events.map((e) => e.externalId), cutoff);
        }
      }

      const blockedDates = Array.from(new Set(events.flatMap((event) => event.dates))).sort();
      const entry: CacheEntry = { blockedDates, events, expiresAt: Date.now() + this.options.ttlMs };
      this.cache.set(propertyId, entry);
      return entry;
    })();

    this.inflight.set(propertyId, next);
    try {
      return await next;
    } finally {
      this.inflight.delete(propertyId);
    }
  }

  private async getEntry(property: PropertyData & { id: string }, mode: FetchMode): Promise<CacheEntry | null> {
    if (!this.options.enabled || !property.icalFeeds.length) {
      return null;
    }

    const cached = this.cache.get(property.id);
    const isFresh = !!cached && cached.expiresAt > Date.now();
    if (isFresh) {
      return cached;
    }

    if (mode === 'stale-ok' && cached) {
      void this.refresh(property.id, property.icalFeeds);
      return cached;
    }

    try {
      return await this.refresh(property.id, property.icalFeeds);
    } catch {
      return cached ?? null;
    }
  }

  async getBlockedDates(property: PropertyData & { id: string }, baseDates: string[], mode: FetchMode): Promise<string[]> {
    const entry = await this.getEntry(property, mode);
    return entry ? mergeDates(baseDates, entry.blockedDates) : baseDates;
  }

  // Per-event detail (which feed, raw SUMMARY/DESCRIPTION) for the host and
  // cleaning calendars. Triggers the same cache/staleness-driven refresh as
  // getBlockedDates, but — unlike it — the returned list is sourced from the
  // persisted store when one is configured, so a stay that already checked
  // out and rolled out of the OTA's live feed window stays visible as
  // history instead of disappearing the moment the feed stops listing it.
  async getImportedEvents(property: PropertyData & { id: string }, mode: FetchMode): Promise<ImportedEvent[]> {
    const entry = await this.getEntry(property, mode);
    if (this.store) {
      return this.store.listImportedEvents(property.id);
    }
    return entry ? entry.events : [];
  }
}
