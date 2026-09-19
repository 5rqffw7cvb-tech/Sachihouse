import { describe, expect, it } from 'vitest';
import { resolveLegacyHashPath } from './legacyHashRoute';

describe('resolveLegacyHashPath', () => {
  it('resolves the bare hash root to the site root', () => {
    expect(resolveLegacyHashPath('https://sachi-house.net/#/')).toBe('/');
  });

  it('resolves a legacy property sub-page', () => {
    expect(resolveLegacyHashPath('https://sachi-house.net/#/sachi-ojima/access')).toBe('/sachi-ojima/access');
  });

  it('keeps the query string that rode along inside the hash', () => {
    expect(resolveLegacyHashPath('https://sachi-house.net/#/sachi-ojima?checkIn=2026-01-01')).toBe(
      '/sachi-ojima?checkIn=2026-01-01',
    );
  });

  it('leaves a plain in-page anchor alone', () => {
    expect(resolveLegacyHashPath('https://sachi-house.net/pricing#rules')).toBeNull();
  });

  it('leaves a URL with no hash alone', () => {
    expect(resolveLegacyHashPath('https://sachi-house.net/sachi-ojima/access')).toBeNull();
  });

  it('does not redirect a URL that is already a real BrowserRouter path', () => {
    // A guest already on the migrated /blog path must not be bounced back
    // through the shim on a later re-render/reload — there is no hash to
    // rewrite here, so this must be a no-op, not a redirect loop.
    expect(resolveLegacyHashPath('https://sachi-house.net/blog')).toBeNull();
  });

  it('ignores a bare "#" with nothing after it', () => {
    expect(resolveLegacyHashPath('https://sachi-house.net/')).toBeNull();
  });

  it('rejects a protocol-relative path smuggled inside the hash', () => {
    expect(resolveLegacyHashPath('https://sachi-house.net/#//evil.com')).toBeNull();
  });

  it('keeps a real query string that rode outside the hash', () => {
    expect(
      resolveLegacyHashPath('https://sachi-house.net/?utm_source=mail#/sachi-ojima'),
    ).toBe('/sachi-ojima?utm_source=mail');
  });
});
