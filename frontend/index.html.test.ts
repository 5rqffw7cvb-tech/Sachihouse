import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// index.html is never loaded by jsdom under vitest (there is no document
// bootstrap step here), so this reads the static markup directly.
//
// React 19 hoists every <title>/<meta> a mounted <Helmet> renders straight
// into <head>, and does not dedupe against tags already there when it
// mounts — react-helmet-async's own dedupe path (HELMET_ATTRIBUTE = 'data-rh')
// is dead code on React >= 19 (see node_modules/react-helmet-async's
// isReact19 branch), so it cannot clean these up either. So the static
// fallback tags in index.html must be tagged data-static-seo, and
// components/Seo.tsx strips them in an effect once the real ones are in the
// DOM. This test asserts the static markup still ships the fallback (for the
// pre-hydration document and any crawler that never runs JS) and that every
// one of those tags is marked data-static-seo so Seo.tsx can find and remove
// it — and that the tags Seo.tsx never sets (og:site_name, viewport,
// theme-color) are *not* marked, since nothing should ever remove those.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const staticSeoTagPattern = /<[^>]*data-static-seo[^>]*>/gi;
const staticSeoTags = html.match(staticSeoTagPattern) || [];

const hasStaticSeoTag = (matcher: RegExp) => staticSeoTags.some((tag) => matcher.test(tag));

describe('index.html static <head> tags', () => {
  it('ships a data-static-seo meta description as a pre-hydration fallback', () => {
    expect(hasStaticSeoTag(/name=["']description["']/i)).toBe(true);
  });

  it('ships data-static-seo og:title/og:description/og:type/og:image tags', () => {
    expect(hasStaticSeoTag(/property=["']og:title["']/i)).toBe(true);
    expect(hasStaticSeoTag(/property=["']og:description["']/i)).toBe(true);
    expect(hasStaticSeoTag(/property=["']og:type["']/i)).toBe(true);
    expect(hasStaticSeoTag(/property=["']og:image["']/i)).toBe(true);
  });

  it('ships data-static-seo twitter:card/twitter:title/twitter:description tags', () => {
    expect(hasStaticSeoTag(/name=["']twitter:card["']/i)).toBe(true);
    expect(hasStaticSeoTag(/name=["']twitter:title["']/i)).toBe(true);
    expect(hasStaticSeoTag(/name=["']twitter:description["']/i)).toBe(true);
  });

  it('does not ship a canonical or og:url — those are wrong on every route but /', () => {
    expect(html).not.toMatch(/rel=["']canonical["']/i);
    expect(html).not.toMatch(/property=["']og:url["']/i);
  });

  it('marks the fallback <title> data-static-seo so Seo.tsx can remove it', () => {
    expect(html).toMatch(/<title\s+data-static-seo>.*<\/title>/i);
  });

  it('still ships og:site_name without data-static-seo (a per-page constant, not something Seo.tsx sets)', () => {
    expect(html).toMatch(/property=["']og:site_name["']/i);
    expect(hasStaticSeoTag(/property=["']og:site_name["']/i)).toBe(false);
  });

  it('does not mark viewport or theme-color data-static-seo — they must survive the strip', () => {
    expect(hasStaticSeoTag(/name=["']viewport["']/i)).toBe(false);
    expect(hasStaticSeoTag(/name=["']theme-color["']/i)).toBe(false);
  });
});
