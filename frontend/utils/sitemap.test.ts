import { describe, expect, it } from 'vitest';
import { buildSitemapXml } from './sitemap.mjs';

describe('buildSitemapXml', () => {
  it('renders a valid urlset with one <url> per entry', () => {
    const xml = buildSitemapXml([
      { loc: 'https://sachi-house.net/' },
      { loc: 'https://sachi-house.net/blog' },
    ]);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('<loc>https://sachi-house.net/</loc>');
    expect(xml).toContain('<loc>https://sachi-house.net/blog</loc>');
    expect(xml.match(/<url>/g)).toHaveLength(2);
  });

  it('escapes XML-significant characters in a loc', () => {
    const xml = buildSitemapXml([{ loc: "https://sachi-house.net/blog?q=A&B<C>D\"E'F" }]);

    expect(xml).toContain('<loc>https://sachi-house.net/blog?q=A&amp;B&lt;C&gt;D&quot;E&apos;F</loc>');
    expect(xml).not.toContain('q=A&B<C>D"E\'F');
  });

  it('drops a duplicate loc, keeping the first occurrence', () => {
    const xml = buildSitemapXml([
      { loc: 'https://sachi-house.net/blog', lastmod: '2026-01-01' },
      { loc: 'https://sachi-house.net/blog', lastmod: '2026-02-02' },
    ]);

    expect(xml.match(/<url>/g)).toHaveLength(1);
    expect(xml).toContain('<lastmod>2026-01-01</lastmod>');
    expect(xml).not.toContain('2026-02-02');
  });

  it('sorts entries so the output is stable across runs', () => {
    const xml = buildSitemapXml([
      { loc: 'https://sachi-house.net/sachi-ojima' },
      { loc: 'https://sachi-house.net/blog' },
      { loc: 'https://sachi-house.net/' },
    ]);

    const order = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
    expect(order).toEqual([
      'https://sachi-house.net/',
      'https://sachi-house.net/blog',
      'https://sachi-house.net/sachi-ojima',
    ]);
  });

  it('includes optional lastmod, changefreq and priority when given', () => {
    const xml = buildSitemapXml([
      { loc: 'https://sachi-house.net/', lastmod: '2026-01-01', changefreq: 'daily', priority: 1 },
    ]);

    expect(xml).toContain('<lastmod>2026-01-01</lastmod>');
    expect(xml).toContain('<changefreq>daily</changefreq>');
    expect(xml).toContain('<priority>1</priority>');
  });

  it('produces an empty but valid urlset for no entries', () => {
    const xml = buildSitemapXml([]);

    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).not.toContain('<url>');
  });
});
