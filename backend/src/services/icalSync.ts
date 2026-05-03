import { addDays, format, isValid, parseISO, subDays } from 'date-fns';
import { PropertyData } from '../store/types.js';

type FetchMode = 'stale-ok' | 'fresh-if-stale';

interface IcalSyncOptions {
  enabled: boolean;
  ttlMs: number;
  timeoutMs: number;
}

interface CacheEntry {
  expiresAt: number;
  blockedDates: string[];
}

function parseICSDate(raw: string): Date | null {
  if (!raw || raw.length < 8) {
    return null;
  }

  const date = parseISO(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`);
  return isValid(date) ? date : null;
}

function parseICSBlockedDates(content: string): string[] {
  const lines = content.split(/\r\n|\n|\r/);
  const blocked = new Set<string>();

  let inEvent = false;
  let dtStart: Date | null = null;
  let dtEnd: Date | null = null;

  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) {
      inEvent = true;
      dtStart = null;
      dtEnd = null;
      continue;
    }

    if (line.startsWith('END:VEVENT')) {
      inEvent = false;
      if (dtStart && dtEnd && dtStart < dtEnd) {
        const endInclusive = subDays(dtEnd, 1);
        if (dtStart <= endInclusive) {
          for (let cursor = dtStart; cursor <= endInclusive; cursor = addDays(cursor, 1)) {
            blocked.add(format(cursor, 'yyyy-MM-dd'));
          }
        }
      }
      continue;
    }

    if (!inEvent) {
      continue;
    }

    if (line.startsWith('DTSTART')) {
      const value = line.split(':')[1] ?? '';
      dtStart = parseICSDate(value);
      continue;
    }

    if (line.startsWith('DTEND')) {
      const value = line.split(':')[1] ?? '';
      dtEnd = parseICSDate(value);
    }
  }

  return Array.from(blocked).sort();
}

function mergeDates(baseDates: string[], icalDates: string[]): string[] {
  return Array.from(new Set([...baseDates, ...icalDates])).sort();
}

function isLikelyPlaceholder(url: string): boolean {
  return /example\.com/i.test(url) || url.includes('...');
}

async function fetchIcalFeed(url: string, timeoutMs: number): Promise<string[]> {
  const cleaned = url.trim();
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
      return [];
    }

    const text = await response.text();
    if (!text.includes('BEGIN:VCALENDAR')) {
      return [];
    }

    return parseICSBlockedDates(text);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export class IcalSyncService {
  private readonly options: IcalSyncOptions;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<string[]>>();

  constructor(options: IcalSyncOptions) {
    this.options = options;
  }

  private async refresh(propertyId: string, feeds: PropertyData['icalFeeds']): Promise<string[]> {
    const existing = this.inflight.get(propertyId);
    if (existing) {
      return existing;
    }

    const next = (async () => {
      const allDates = new Set<string>();
      for (const feed of feeds) {
        const dates = await fetchIcalFeed(feed.url, this.options.timeoutMs);
        for (const date of dates) {
          allDates.add(date);
        }
      }
      const blockedDates = Array.from(allDates).sort();
      this.cache.set(propertyId, {
        blockedDates,
        expiresAt: Date.now() + this.options.ttlMs,
      });
      return blockedDates;
    })();

    this.inflight.set(propertyId, next);
    try {
      return await next;
    } finally {
      this.inflight.delete(propertyId);
    }
  }

  async getBlockedDates(property: PropertyData & { id: string }, baseDates: string[], mode: FetchMode): Promise<string[]> {
    if (!this.options.enabled || !property.icalFeeds.length) {
      return baseDates;
    }

    const cached = this.cache.get(property.id);
    const isFresh = !!cached && cached.expiresAt > Date.now();

    if (isFresh) {
      return mergeDates(baseDates, cached.blockedDates);
    }

    if (mode === 'stale-ok' && cached) {
      void this.refresh(property.id, property.icalFeeds);
      return mergeDates(baseDates, cached.blockedDates);
    }

    try {
      const refreshed = await this.refresh(property.id, property.icalFeeds);
      return mergeDates(baseDates, refreshed);
    } catch {
      if (cached) {
        return mergeDates(baseDates, cached.blockedDates);
      }
      return baseDates;
    }
  }
}
