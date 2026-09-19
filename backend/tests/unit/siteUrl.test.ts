import { describe, expect, it } from 'vitest';
import { buildSiteUrl, normalizeSiteUrl } from '../../src/app.js';

describe('normalizeSiteUrl', () => {
  it('adds https to a bare host', () => {
    // This exact value in production made Stripe reject every success_url with
    // "An explicit scheme (such as https) must be provided", 502-ing the whole
    // booking flow.
    expect(normalizeSiteUrl('sachi-house.net')).toBe('https://sachi-house.net');
  });

  it('leaves an explicit scheme alone', () => {
    expect(normalizeSiteUrl('https://sachi-house.net')).toBe('https://sachi-house.net');
    expect(normalizeSiteUrl('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('strips trailing slashes so joined paths do not double up', () => {
    expect(normalizeSiteUrl('https://sachi-house.net/')).toBe('https://sachi-house.net');
    expect(normalizeSiteUrl('sachi-house.net///')).toBe('https://sachi-house.net');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeSiteUrl('  sachi-house.net  ')).toBe('https://sachi-house.net');
  });

  it('falls back to the local dev origin when unset or blank', () => {
    expect(normalizeSiteUrl(undefined)).toBe('http://localhost:5173');
    expect(normalizeSiteUrl('   ')).toBe('http://localhost:5173');
  });

  it('keeps a host that merely starts with the letters http', () => {
    expect(normalizeSiteUrl('httpbin.example.com')).toBe('https://httpbin.example.com');
  });
});

describe('buildSiteUrl', () => {
  // The public site moved from HashRouter to BrowserRouter: an outbound link
  // built with a leading '#' (the old `${siteUrl}/#${pathAndQuery}` shape)
  // would send a guest to the homepage of the new app instead of the intended
  // real path, so no '#' may ever appear in the generated URL again.
  it('joins the site origin and the real path with no hash', () => {
    expect(buildSiteUrl('https://sachi-house.net', '/sachi-ojima/checkin')).toBe(
      'https://sachi-house.net/sachi-ojima/checkin',
    );
  });

  it('never contains a "#" character', () => {
    const url = buildSiteUrl('https://sachi-house.net', '/booking/result?id=abc123&token=xyz');
    expect(url).not.toContain('#');
  });

  it('preserves a query string appended to the path', () => {
    expect(buildSiteUrl('https://sachi-house.net', '/booking/cancelled?id=abc123')).toBe(
      'https://sachi-house.net/booking/cancelled?id=abc123',
    );
  });

  it('composes cleanly with normalizeSiteUrl for a bare host', () => {
    const siteUrl = normalizeSiteUrl('sachi-house.net');
    expect(buildSiteUrl(siteUrl, '/sachi-ojima/manual')).toBe('https://sachi-house.net/sachi-ojima/manual');
  });

  it('adds a leading slash to a path missing one', () => {
    expect(buildSiteUrl('https://sachi-house.net', 'admin/booking-confirm')).toBe(
      'https://sachi-house.net/admin/booking-confirm',
    );
  });
});
