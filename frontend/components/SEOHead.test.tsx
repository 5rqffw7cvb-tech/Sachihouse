import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import SEOHead from './SEOHead';
import type { PropertyData } from '../types';

const baseData = { name: 'Sachi House Ojima', metaTitle: undefined, description: 'A family stay in Tokyo.' } as unknown as PropertyData;

const renderHead = (titleSuffix?: string) =>
  render(
    <HelmetProvider>
      <MemoryRouter>
        <SEOHead data={baseData} titleSuffix={titleSuffix} />
      </MemoryRouter>
    </HelmetProvider>,
  );

// App.tsx mounts one <SEOHead titleSuffix=...> per property sub-route
// (index/access/pricing/rules/manual/photos). Search Console had flagged
// these as duplicate titles before titleSuffix existed — this is the
// regression test that they now render six distinct <title>s.
describe('SEOHead titleSuffix', () => {
  const subPages: Array<string | undefined> = [undefined, 'Access', 'Pricing', 'House rules', 'Guest manual', 'Photo tour'];

  it.each(subPages)('renders a title for suffix %s', async (suffix) => {
    renderHead(suffix);
    await waitFor(() =>
      expect(document.title).toBe(suffix ? `Sachi House Ojima | ${suffix}` : 'Sachi House Ojima'),
    );
  });

  it('produces six distinct titles across the property sub-routes', async () => {
    const titles: string[] = [];
    for (const suffix of subPages) {
      const { unmount } = renderHead(suffix);
      await waitFor(() => expect(document.title.length).toBeGreaterThan(0));
      titles.push(document.title);
      unmount();
    }

    expect(new Set(titles).size).toBe(subPages.length);
  });

  it('renders nothing when there is no property data yet', () => {
    const { container } = render(
      <HelmetProvider>
        <MemoryRouter>
          <SEOHead data={null} titleSuffix="Access" />
        </MemoryRouter>
      </HelmetProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
