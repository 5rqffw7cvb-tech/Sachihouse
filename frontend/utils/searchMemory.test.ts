import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_MEMORY_TTL_MS, forgetSearch, recallSearch, rememberSearch } from './searchMemory';

const A_SEARCH = {
  countryCode: 'JP',
  provinceCode: 'TOKYO',
  checkIn: '2026-09-01',
  checkOut: '2026-09-04',
  adults: 2,
  children: 1,
  infants: 1,
};

afterEach(() => {
  vi.useRealTimers();
  forgetSearch();
});

describe('search memory', () => {
  it('returns null when nothing was ever saved', () => {
    expect(recallSearch()).toBeNull();
  });

  it('gives the search back unchanged within the window', () => {
    rememberSearch(A_SEARCH);
    expect(recallSearch()).toEqual(A_SEARCH);
  });

  it('still remembers just before the ten minutes are up', () => {
    vi.useFakeTimers();
    rememberSearch(A_SEARCH);

    vi.advanceTimersByTime(SEARCH_MEMORY_TTL_MS - 1_000);
    expect(recallSearch()).toEqual(A_SEARCH);
  });

  it('forgets once the window has passed, and clears the entry', () => {
    vi.useFakeTimers();
    rememberSearch(A_SEARCH);

    vi.advanceTimersByTime(SEARCH_MEMORY_TTL_MS + 1);
    expect(recallSearch()).toBeNull();
    // Expired entries are dropped rather than left to be re-read.
    expect(localStorage.getItem('sachi_last_search')).toBeNull();
  });

  it('forgets on demand', () => {
    rememberSearch(A_SEARCH);
    forgetSearch();
    expect(recallSearch()).toBeNull();
  });

  it('rejects a stored entry whose dates make no stay', () => {
    rememberSearch({ ...A_SEARCH, checkOut: A_SEARCH.checkIn });
    expect(recallSearch()).toBeNull();
  });

  it('rejects a party with no adults', () => {
    rememberSearch({ ...A_SEARCH, adults: 0 });
    expect(recallSearch()).toBeNull();
  });

  it('survives a corrupted entry', () => {
    localStorage.setItem('sachi_last_search', '{not json');
    expect(recallSearch()).toBeNull();
  });

  it('treats missing child and infant counts as zero', () => {
    localStorage.setItem('sachi_last_search', JSON.stringify({
      checkIn: '2026-09-01',
      checkOut: '2026-09-02',
      adults: 2,
      savedAt: Date.now(),
    }));

    expect(recallSearch()).toEqual({
      countryCode: '',
      provinceCode: '',
      checkIn: '2026-09-01',
      checkOut: '2026-09-02',
      adults: 2,
      children: 0,
      infants: 0,
    });
  });
});
