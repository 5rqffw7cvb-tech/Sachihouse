// Every link ever shared for this site — bookmarks, emails, search results —
// points at a HashRouter route (`https://sachi-house.net/#/sachi-ojima/access`).
// Moving to BrowserRouter makes those links land on the homepage instead of the
// intended page, since the real path now lives before the `#`, not after it.
// This shim reads the hash once at boot and rewrites the URL so the router
// still resolves to the page the link meant.
export function resolveLegacyHashPath(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const { hash } = url;
  // A plain in-page anchor (`#rules`) is not a route — leave it alone.
  if (!hash || !hash.startsWith('#/')) {
    return null;
  }

  // Drop the leading `#`; whatever query string rode along inside the hash
  // (`#/slug?checkIn=2026-01-01`) comes with it, since it was never a real
  // query string to begin with.
  const hashPath = hash.slice(1);
  const [rawPath, hashQuery = ''] = hashPath.split('?');

  // Reject "#//evil.com"-style protocol-relative paths in addition to
  // absolute URLs, since they also start with "/" but resolve off-origin —
  // same guard as the redirect param on the login page.
  if (!rawPath.startsWith('/') || rawPath.startsWith('//')) {
    return null;
  }

  // A real query string that lived outside the hash (e.g. a `utm_source`
  // appended before anyone rewrote the URL) must survive the rewrite; a key
  // set inside the hash's own query string wins if both set it.
  const mergedParams = new URLSearchParams(url.search);
  for (const [key, value] of new URLSearchParams(hashQuery)) {
    mergedParams.set(key, value);
  }
  const mergedQuery = mergedParams.toString();

  return mergedQuery ? `${rawPath}?${mergedQuery}` : rawPath;
}
