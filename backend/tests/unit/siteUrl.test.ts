import { describe, expect, it } from 'vitest';
import { normalizeSiteUrl } from '../../src/app.js';

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
