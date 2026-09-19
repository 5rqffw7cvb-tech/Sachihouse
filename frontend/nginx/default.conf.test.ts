import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Static assertions against the nginx template. No `nginx` binary or running
// Docker daemon was available in this environment to run `nginx -t` against
// the real config (Docker Desktop's engine was not reachable here), so this
// parses the template's `location { ... }` blocks directly instead. None of
// these blocks nest braces, so a flat regex is enough to pull each one out.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const template = readFileSync(path.join(__dirname, 'default.conf.template'), 'utf8');

interface LocationBlock {
  selector: string;
  body: string;
}

// Comments are stripped before parsing: the word "location" reads perfectly
// naturally inside a comment, and left in place it makes the block regex start
// matching there and swallow the real block that follows it.
const directivesOnly = template.replace(/^[ \t]*#.*$/gm, '');

const locationBlocks: LocationBlock[] = Array.from(
  directivesOnly.matchAll(/location\s+([^{]+?)\s*\{([^}]*)\}/g),
).map((match) => ({ selector: match[1].trim(), body: match[2] }));

// Routes that carry a bearer token in the path itself, or otherwise must
// never surface in search results (backend/src/app.ts:1565, :2799).
const PRIVATE_SELECTORS = [
  '= /booking/result',
  '~ ^/cleaning/',
  '~ ^/(admin|app|login|booking|cleaning)(/|$)',
  '~ ^/[^/]+/(admin|checkin)/?$',
];

describe('nginx/default.conf.template', () => {
  it('parsed at least one location block per selector this suite checks', () => {
    // A regression that renames/removes a selector should fail loudly here
    // rather than have every other assertion below silently pass on zero
    // matches.
    for (const selector of PRIVATE_SELECTORS) {
      expect(locationBlocks.some((block) => block.selector === selector)).toBe(true);
    }
  });

  it('sends X-Robots-Tag: noindex, nofollow on every private route', () => {
    for (const selector of PRIVATE_SELECTORS) {
      const block = locationBlocks.find((b) => b.selector === selector);
      expect(block?.body).toMatch(/X-Robots-Tag\s+"noindex,\s*nofollow"/);
    }
  });

  it('turns off access logging for the two bearer-token-in-path routes', () => {
    const bookingResult = locationBlocks.find((b) => b.selector === '= /booking/result');
    const cleaning = locationBlocks.find((b) => b.selector === '~ ^/cleaning/');
    expect(bookingResult?.body).toMatch(/access_log\s+off\s*;/);
    expect(cleaning?.body).toMatch(/access_log\s+off\s*;/);
  });

  it('sets a no-referrer policy on the two bearer-token-in-path routes', () => {
    const bookingResult = locationBlocks.find((b) => b.selector === '= /booking/result');
    const cleaning = locationBlocks.find((b) => b.selector === '~ ^/cleaning/');
    expect(bookingResult?.body).toMatch(/Referrer-Policy\s+"no-referrer"/);
    expect(cleaning?.body).toMatch(/Referrer-Policy\s+"no-referrer"/);
  });

  it('sends X-Content-Type-Options: nosniff on every location block', () => {
    expect(locationBlocks.length).toBeGreaterThan(0);
    for (const block of locationBlocks) {
      expect(block.body, `location ${block.selector}`).toMatch(/X-Content-Type-Options\s+"nosniff"/);
    }
  });

  // The trap that made every assertion above pass while the directives were
  // dead at runtime: a try_files whose last parameter is a URI makes nginx
  // internal-redirect and re-run location selection, so the request finishes
  // in `location /` and takes its add_header/access_log from there instead.
  // Any block that bothers to set its own headers must therefore end its
  // try_files with a status code, which keeps index.html a plain file lookup
  // served from this block.
  it('never lets a header-bearing block end try_files on a URI', () => {
    const headerBearing = locationBlocks.filter(
      (block) => /add_header\s+X-Robots-Tag/.test(block.body) || /access_log\s+off/.test(block.body),
    );
    expect(headerBearing.length).toBe(PRIVATE_SELECTORS.length);
    for (const block of headerBearing) {
      const tryFiles = block.body.match(/try_files\s+([^;]+);/);
      expect(tryFiles, `location ${block.selector} has no try_files`).not.toBeNull();
      const lastParam = tryFiles![1].trim().split(/\s+/).pop();
      expect(lastParam, `location ${block.selector}`).toMatch(/^=\d{3}$/);
    }
  });

  it('sends a Referrer-Policy on every location block', () => {
    for (const block of locationBlocks) {
      expect(block.body, `location ${block.selector}`).toMatch(/Referrer-Policy\s+"/);
    }
  });
});
