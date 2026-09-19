import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Seo } from './Seo';

const renderSeo = (props: React.ComponentProps<typeof Seo>, initialPath = '/') =>
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Seo {...props} />
      </MemoryRouter>
    </HelmetProvider>,
  );

describe('Seo', () => {
  // This must run first: the strip in components/Seo.tsx is guarded by a
  // module-level flag so it only ever runs once per page load, and every
  // other test in this file also mounts a <Seo> that would otherwise have
  // already flipped it.
  it('removes the static data-static-seo fallback tags once it mounts', async () => {
    const staticMeta = document.createElement('meta');
    staticMeta.setAttribute('name', 'description');
    staticMeta.setAttribute('content', 'static');
    staticMeta.setAttribute('data-static-seo', '');
    document.head.appendChild(staticMeta);

    try {
      renderSeo({ title: 'SachiHouse', description: 'Property listings.' });

      await waitFor(() =>
        expect(document.head.querySelectorAll("meta[name='description']")).toHaveLength(1),
      );
      expect(document.head.querySelector("meta[name='description']")?.getAttribute('content')).toBe(
        'Property listings.',
      );
      expect(document.head.querySelector('[data-static-seo]')).toBeNull();
    } finally {
      staticMeta.remove();
    }
  });

  it('sets the document title and description', async () => {
    renderSeo({ title: 'Sachi House Ojima', description: 'A family-friendly stay in Tokyo.' });

    await waitFor(() => expect(document.title).toBe('Sachi House Ojima'));
    expect(document.head.querySelector("meta[name='description']")?.getAttribute('content')).toBe(
      'A family-friendly stay in Tokyo.',
    );
  });

  it('builds an absolute canonical URL from the current route, dropping the query string', async () => {
    renderSeo(
      { title: 'Access', description: 'How to get here.' },
      '/sachi-ojima/access?checkIn=2026-01-01',
    );

    await waitFor(() =>
      expect(document.head.querySelector("link[rel='canonical']")?.getAttribute('href')).toBe(
        'https://sachi-house.net/sachi-ojima/access',
      ),
    );
    expect(document.head.querySelector("meta[property='og:url']")?.getAttribute('content')).toBe(
      'https://sachi-house.net/sachi-ojima/access',
    );
  });

  it('normalizes a trailing slash on the canonical URL', async () => {
    renderSeo({ title: 'Sachi House Ojima', description: 'A family-friendly stay in Tokyo.' }, '/sachi-ojima/');

    await waitFor(() =>
      expect(document.head.querySelector("link[rel='canonical']")?.getAttribute('href')).toBe(
        'https://sachi-house.net/sachi-ojima',
      ),
    );
  });

  it('keeps the root path as the canonical root', async () => {
    renderSeo({ title: 'SachiHouse', description: 'Property listings.' }, '/');

    await waitFor(() =>
      expect(document.head.querySelector("link[rel='canonical']")?.getAttribute('href')).toBe(
        'https://sachi-house.net/',
      ),
    );
  });

  it('emits a noindex robots tag when asked', async () => {
    renderSeo({ title: 'Not found', description: 'Nothing here.', noindex: true });

    await waitFor(() =>
      expect(document.head.querySelector("meta[name='robots']")?.getAttribute('content')).toBe('noindex,nofollow'),
    );
  });

  it('omits the robots tag by default', async () => {
    renderSeo({ title: 'SachiHouse', description: 'Property listings.' });

    await waitFor(() => expect(document.title).toBe('SachiHouse'));
    expect(document.head.querySelector("meta[name='robots']")).not.toBeInTheDocument();
  });

  it('omits canonical and og:url on a noindex page', async () => {
    renderSeo({ title: 'Host sign in', description: 'Sachi House host app sign in.', noindex: true });

    await waitFor(() =>
      expect(document.head.querySelector("meta[name='robots']")?.getAttribute('content')).toBe('noindex,nofollow'),
    );
    expect(document.head.querySelector("link[rel='canonical']")).not.toBeInTheDocument();
    expect(document.head.querySelector("meta[property='og:url']")).not.toBeInTheDocument();
  });
});
