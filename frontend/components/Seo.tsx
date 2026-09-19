import React, { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';

// The one place a canonical URL gets built. Now that the site is a
// BrowserRouter app, `location.pathname` alone is the whole real path — no
// hash to strip, no origin to guess.
export const SITE_ORIGIN = 'https://sachi-house.net';

// index.html ships a static <title>/<meta description>/og:*/twitter:* set
// (tagged data-static-seo) so the pre-hydration document and any crawler
// that never runs JS still get real metadata. react-helmet-async cannot
// remove those for us on React 19: its own dedupe path (HELMET_ATTRIBUTE =
// 'data-rh', updateTags) only runs when `major < 19` — on React 19 it hands
// off to a React19Dispatcher that hoists <title>/<meta> tags directly via
// React's built-in head-tag support and never touches the DOM itself. React's
// hoisting does not dedupe against tags that were already in the document
// when it mounted, so without this the static and the per-page tags both sit
// in <head> at once. Stripping happens in an effect (after commit) so the
// React-hoisted tags already exist before the static ones disappear — no
// render has a document with no title/description at all. Guarded so it only
// runs once per page load; every following <Seo> mount is a no-op here.
let staticSeoStripped = false;

interface SeoProps {
  title: string;
  description: string;
  image?: string;
  type?: string;
  /** Keeps a page (login, an admin screen, a not-found state) out of search
   *  results without touching robots.txt, which would also block the crawler
   *  from following links on the page. */
  noindex?: boolean;
  /** Overrides the path used to build the canonical URL. Falls back to the
   *  current route. */
  canonicalPath?: string;
}

export const Seo: React.FC<SeoProps> = ({
  title,
  description,
  image,
  type = 'website',
  noindex = false,
  canonicalPath,
}) => {
  const { pathname } = useLocation();
  const path = canonicalPath ?? pathname;
  // A trailing slash on anything but the root would otherwise count as a
  // second URL for the same page in Google's eyes.
  const normalizedPath = path !== '/' ? path.replace(/\/+$/, '') : path;
  const canonicalUrl = `${SITE_ORIGIN}${normalizedPath || '/'}`;

  useEffect(() => {
    if (staticSeoStripped) return;
    staticSeoStripped = true;
    document.head.querySelectorAll('[data-static-seo]').forEach((el) => el.remove());
  }, []);

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      {/* A noindex page must never publish a canonical/og:url — Google has been
          seen indexing the URL-only anyway when it can crawl a canonical link
          on a page it was told to skip. */}
      {!noindex && <link rel="canonical" href={canonicalUrl} />}

      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={type} />
      {!noindex && <meta property="og:url" content={canonicalUrl} />}
      {image && <meta property="og:image" content={image} />}

      <meta name="twitter:card" content={image ? 'summary_large_image' : 'summary'} />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      {image && <meta name="twitter:image" content={image} />}

      {noindex && <meta name="robots" content="noindex,nofollow" />}
    </Helmet>
  );
};

export default Seo;
