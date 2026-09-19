import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// GlobalLayout and BlogSidebar pull in site settings / network calls that say
// nothing about the canonical URL this page builds — stub them the same way
// components/AdminShell.test.tsx stubs its chrome.
vi.mock('../components/GlobalLayout', () => ({
  GlobalLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../components/BlogSidebar', () => ({ BlogSidebar: () => <aside /> }));
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'en', setLanguage: () => {} }),
}));
vi.mock('../services/blogService', () => ({
  blogService: { getPosts: async () => [] },
}));

const { default: BlogPage } = await import('./BlogPage');

const renderAt = (initialPath: string) =>
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <BlogPage />
      </MemoryRouter>
    </HelmetProvider>,
  );

describe('BlogPage canonical URL', () => {
  it('percent-encodes a space in a category filter instead of publishing a `+`', async () => {
    renderAt('/blog?category=Tokyo Guide');

    await waitFor(() => {
      const canonical = document.head.querySelector("link[rel='canonical']");
      expect(canonical).not.toBeNull();
      expect(canonical?.getAttribute('href')).toBe('https://sachi-house.net/blog?category=Tokyo%20Guide');
    });

    expect(document.head.querySelector("link[rel='canonical']")?.getAttribute('href')).not.toContain('+');
  });

  it('keeps the plain /blog canonical when there is no filter', async () => {
    renderAt('/blog');

    await waitFor(() => {
      expect(document.head.querySelector("link[rel='canonical']")?.getAttribute('href')).toBe(
        'https://sachi-house.net/blog',
      );
    });
  });
});
