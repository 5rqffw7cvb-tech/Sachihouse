import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A Disallow'd path stops the crawler from ever fetching the page, so it
// never sees a per-page <Seo noindex> tag either — the site now keeps every
// private route out of search results via that meta tag instead, and
// robots.txt must not reintroduce a Disallow that would defeat it.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const robotsTxt = readFileSync(path.join(publicDir, 'robots.txt'), 'utf8');

describe('robots.txt', () => {
  it('has no Disallow directive', () => {
    expect(robotsTxt).not.toMatch(/^\s*Disallow:/im);
  });

  it('allows crawling everything', () => {
    expect(robotsTxt).toMatch(/^Allow:\s*\/\s*$/im);
  });

  it('points at the sitemap', () => {
    expect(robotsTxt).toMatch(/^Sitemap:\s*https:\/\/sachi-house\.net\/sitemap\.xml\s*$/im);
  });

  // This test used to live in public/robots.test.ts itself, which Vite's
  // static-copy build shipped straight into dist/ alongside robots.txt —
  // a .test.ts file served to the public. public/ must only ever contain
  // files meant to be served as-is.
  it('keeps test/build files out of the served public directory', () => {
    const offenders = readdirSync(publicDir).filter((name) => /\.(ts|tsx|mjs|map)$/.test(name));
    expect(offenders).toEqual([]);
  });
});
