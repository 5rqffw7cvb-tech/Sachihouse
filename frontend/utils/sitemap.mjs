/**
 * Turns a flat list of URLs into a sitemap.xml document. Pure by design: the
 * network call that gathers the entries (see scripts/generate-sitemap.mjs)
 * stays out of this file so the XML shape can be unit tested without a
 * server, and so a partial/failed fetch still produces valid output.
 */

const escapeXml = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export function buildSitemapXml(entries) {
  // First occurrence of a `loc` wins — a property listed once for its base
  // page and again as a fallback should not appear twice.
  const seen = new Set();
  const deduped = entries.filter((entry) => {
    if (seen.has(entry.loc)) return false;
    seen.add(entry.loc);
    return true;
  });

  const sorted = [...deduped].sort((a, b) => a.loc.localeCompare(b.loc));

  const urlTags = sorted
    .map((entry) => {
      const parts = [`    <loc>${escapeXml(entry.loc)}</loc>`];
      if (entry.lastmod) parts.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
      if (entry.changefreq) parts.push(`    <changefreq>${escapeXml(entry.changefreq)}</changefreq>`);
      if (typeof entry.priority === 'number') parts.push(`    <priority>${entry.priority}</priority>`);
      return `  <url>\n${parts.join('\n')}\n  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlTags}\n</urlset>\n`;
}
