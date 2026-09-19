import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// While the auth check is still in flight, ProtectedRoute must not render the
// guarded page (that would flash secured content to a signed-out visitor) and
// it must not render as an indexable page either — this loading screen is not
// a real page, and a crawler unlucky enough to render it should not keep it
// out of, or in, the index based on a moment that's over before the guarded
// page or the /login redirect ever appears. See components/ProtectedRoute.tsx.
vi.mock('../services/auth', () => ({
  getCurrentUser: () => null,
  // Never resolves — simulates the auth check still being in flight forever,
  // so the component stays on its "!resolved" branch.
  subscribeToAuth: () => new Promise(() => {}),
}));

const { default: ProtectedRoute } = await import('./ProtectedRoute');

describe('ProtectedRoute (auth still resolving)', () => {
  it('renders a noindex robots tag instead of the guarded page or a redirect', async () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/admin/finance']}>
          <Routes>
            <Route
              path="/admin/finance"
              element={
                <ProtectedRoute>
                  <p>secret finance content</p>
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<p>login screen</p>} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );

    await waitFor(() =>
      expect(document.head.querySelector("meta[name='robots']")?.getAttribute('content')).toBe(
        'noindex,nofollow',
      ),
    );

    expect(screen.queryByText('secret finance content')).not.toBeInTheDocument();
    expect(screen.queryByText('login screen')).not.toBeInTheDocument();
  });
});
