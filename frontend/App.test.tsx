import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DATA, DEFAULT_SITE_SETTINGS } from './services/storage';

// PropertyRoutes (defined inline in App.tsx) renders its own <Routes> under
// /:id/*. Any sub-path that doesn't match
// access/pricing/rules/manual/admin/photos/checkin falls through to a "*"
// route that must noindex — a 404 within a property is not a page search
// engines should keep, and it must not render as a blank page either.
//
// This stubs the network boundary (global fetch) rather than mocking
// services/storage's module exports: App.tsx reaches services/storage both
// through a static import (for getAllProperties/getSiteSettings) and through
// several separate `import('./services/storage')` calls (PropertyRoutes,
// SiteFaviconSync, handleDataUpdate), and mixing static and dynamic imports
// of the same module in one file was not reliably interceptable by
// vi.mock('./services/storage', ...) in this repo's environment — the
// dynamically-imported binding kept resolving to the real, unmocked function
// (confirmed by inspecting it at runtime) while the statically-imported ones
// mocked correctly. Stubbing fetch instead exercises the exact same code
// paths without depending on that module-mocking behavior.
const jsonResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body),
});

describe('PropertyRoutes wildcard route', () => {
  const entryUrl = window.location.href;

  afterEach(() => {
    vi.unstubAllGlobals();
    // The test navigates the real history to reach the route. Put it back, or
    // whichever file vitest runs next in this worker starts on a property URL.
    window.history.replaceState({}, '', entryUrl);
  });

  it('noindexes an unknown sub-path under a property slug instead of rendering blank', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/site-settings')) {
          return jsonResponse({ settings: DEFAULT_SITE_SETTINGS });
        }
        if (url.includes('/blocked-dates')) {
          return jsonResponse({ blockedDates: [] });
        }
        if (url.includes('/properties/sachi-ojima')) {
          return jsonResponse({ property: { ...DEFAULT_DATA, id: 'sachi-ojima', metalink: 'sachi-ojima' } });
        }
        return { ok: false, status: 404, text: async () => JSON.stringify({ error: 'not found' }) };
      }),
    );

    window.history.pushState({}, '', '/sachi-ojima/duong-dan-khong-ton-tai');

    const { default: App } = await import('./App');
    render(<App />);

    await waitFor(() => expect(screen.getByText('Page not found')).toBeInTheDocument(), { timeout: 30000 });

    const robots = document.head.querySelector("meta[name='robots']");
    expect(robots?.getAttribute('content')).toBe('noindex,nofollow');
    // Generous timeout on purpose: this renders the whole <App /> — every
    // provider and every lazy route — to reach one nested route, which takes
    // ~15s alone and longer under a loaded suite. See the handoff note about
    // exporting PropertyRoutes so this can render just that subtree instead.
  }, 45000);
});
