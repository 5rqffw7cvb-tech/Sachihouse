// Runs as `prebuild`, before every `vite build`. Walks the live property and
// blog lists so a new listing shows up in search results without anyone
// remembering to hand-edit a sitemap.
//
// The API is unreachable in some build environments (no backend running, no
// VITE_API_BASE_URL set) and that must never be the reason a deploy fails —
// a sitemap missing today's new property is a much smaller problem than a
// broken build, so a fetch failure falls back to the static routes alone.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSitemapXml } from '../utils/sitemap.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'sitemap.xml');
const SITE_ORIGIN = 'https://sachi-house.net';
const API_BASE = process.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

// Every publicly indexable route that is not derived from live data.
// Private/auth-gated routes (login, /app, /admin, /booking, /cleaning) are
// deliberately absent — they are kept out of search results by a per-page
// <Seo noindex> tag instead of a robots.txt Disallow (see public/robots.txt).
const STATIC_ROUTES = ['/', '/blog', '/become-host'];

// Sub-pages of a property that are public marketing content. `admin` and
// `checkin` are excluded on purpose: neither is meant to be found by search.
const PROPERTY_SUB_PAGES = ['access', 'pricing', 'rules', 'manual', 'photos'];

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} responded with ${res.status}`);
  }
  return res.json();
}

async function collectEntries() {
  const entries = STATIC_ROUTES.map((route) => ({ loc: `${SITE_ORIGIN}${route}` }));

  const [propertiesResult, postsResult] = await Promise.allSettled([
    fetchJson(`${API_BASE}/properties`),
    fetchJson(`${API_BASE}/blog-posts`),
  ]);

  if (propertiesResult.status === 'fulfilled') {
    const properties = propertiesResult.value.properties || [];
    for (const property of properties) {
      const slug = property.metalink || property.id;
      if (!slug) continue;
      const encodedSlug = encodeURIComponent(slug);
      entries.push({ loc: `${SITE_ORIGIN}/${encodedSlug}` });
      for (const subPage of PROPERTY_SUB_PAGES) {
        entries.push({ loc: `${SITE_ORIGIN}/${encodedSlug}/${subPage}` });
      }
    }
  } else {
    console.warn('[generate-sitemap] Could not fetch properties, omitting them:', propertiesResult.reason?.message);
  }

  if (postsResult.status === 'fulfilled') {
    const posts = postsResult.value.posts || [];
    for (const post of posts) {
      if (!post.id) continue;
      entries.push({ loc: `${SITE_ORIGIN}/blog/${encodeURIComponent(post.id)}` });
    }
  } else {
    console.warn('[generate-sitemap] Could not fetch blog posts, omitting them:', postsResult.reason?.message);
  }

  const ok = propertiesResult.status === 'fulfilled' && postsResult.status === 'fulfilled';
  return { entries, ok };
}

async function main() {
  const { entries, ok } = await collectEntries();

  if (!ok) {
    console.warn('[generate-sitemap] One or more sources failed to fetch.');
    console.warn('[generate-sitemap] Keeping the previously committed public/sitemap.xml as-is.');
    console.warn('[generate-sitemap] Set SITEMAP_STRICT=1 to fail the build instead of falling back.');
    process.exit(process.env.SITEMAP_STRICT === '1' ? 1 : 0);
    return;
  }

  await writeFile(OUTPUT_PATH, buildSitemapXml(entries), 'utf8');
  console.log(`[generate-sitemap] Wrote ${entries.length} URLs to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  // Whatever went wrong, the build must go on — a stale or absent sitemap.xml
  // is not worth breaking every deploy over.
  console.warn('[generate-sitemap] Failed, leaving any existing sitemap.xml in place:', error?.message);
  process.exit(process.env.SITEMAP_STRICT === '1' ? 1 : 0);
});
