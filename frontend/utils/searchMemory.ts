/**
 * The last search a guest made, remembered briefly so that wandering into a
 * property and back does not cost them the dates and party they just entered.
 *
 * Deliberately short-lived: a stay picked half an hour ago is stale intent, and
 * silently re-applying it would be worse than asking again.
 */

const STORAGE_KEY = 'sachi_last_search';
export const SEARCH_MEMORY_TTL_MS = 10 * 60 * 1000;

export interface RememberedSearch {
  countryCode: string;
  provinceCode: string;
  /** YYYY-MM-DD */
  checkIn: string;
  /** YYYY-MM-DD, exclusive */
  checkOut: string;
  adults: number;
  children: number;
  infants: number;
}

interface StoredSearch extends RememberedSearch {
  savedAt: number;
}

const isYmd = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

const asCount = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

export const rememberSearch = (search: RememberedSearch): void => {
  try {
    const payload: StoredSearch = { ...search, savedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage can be full or blocked; the search simply is not remembered.
  }
};

export const forgetSearch = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — a failed clear only means the entry expires on its own.
  }
};

/**
 * The remembered search, or null when there is none, it has expired, or what
 * was stored no longer parses. Expired entries are cleared on read so they do
 * not linger.
 */
export const recallSearch = (): RememberedSearch | null => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSearch>;
    const savedAt = Number(parsed.savedAt);

    if (!Number.isFinite(savedAt) || Date.now() - savedAt > SEARCH_MEMORY_TTL_MS) {
      forgetSearch();
      return null;
    }
    if (!isYmd(parsed.checkIn) || !isYmd(parsed.checkOut) || !(parsed.checkIn < parsed.checkOut)) {
      forgetSearch();
      return null;
    }

    const adults = asCount(parsed.adults);
    if (adults < 1) {
      forgetSearch();
      return null;
    }

    return {
      countryCode: typeof parsed.countryCode === 'string' ? parsed.countryCode : '',
      provinceCode: typeof parsed.provinceCode === 'string' ? parsed.provinceCode : '',
      checkIn: parsed.checkIn,
      checkOut: parsed.checkOut,
      adults,
      children: asCount(parsed.children),
      infants: asCount(parsed.infants),
    };
  } catch {
    forgetSearch();
    return null;
  }
};
