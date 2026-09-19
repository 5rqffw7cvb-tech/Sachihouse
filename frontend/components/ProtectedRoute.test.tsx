import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiUser } from '../services/api';

// Regression coverage for the HashRouter -> BrowserRouter migration: the
// redirect-back target used to be read from `window.location.hash`, which no
// longer exists once real paths are used. It must now come from the router's
// own `location.pathname`/`location.search` so a real path like
// `/admin/finance?tab=x` survives a bounce through /login unchanged.

let currentUser: ApiUser | null = null;
vi.mock('../services/auth', () => ({
  getCurrentUser: () => currentUser,
  subscribeToAuth: async (cb: (u: ApiUser | null) => void) => {
    cb(currentUser);
    return () => {};
  },
}));

const { default: ProtectedRoute } = await import('./ProtectedRoute');

const LoginScreen: React.FC = () => {
  const { search } = useLocation();
  return (
    <p>
      login screen
      <span data-testid="login-search">{search}</span>
    </p>
  );
};

const renderAt = (initialPath: string) =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="/admin/finance"
          element={
            <ProtectedRoute>
              <p>secret finance content</p>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<LoginScreen />} />
      </Routes>
    </MemoryRouter>,
  );

describe('ProtectedRoute routing (BrowserRouter real paths)', () => {
  it('renders the guarded page on a real path when signed in', async () => {
    currentUser = { id: 1, name: 'Admin', email: 'a@b.com', role: 'ADMIN', canEditBlog: false, assignedPropertyIds: [], hostLevel: null };
    renderAt('/admin/finance?tab=payouts');
    await waitFor(() => expect(screen.getByText('secret finance content')).toBeInTheDocument());
  });

  it('redirects a signed-out visitor to /login without depending on a hash', async () => {
    currentUser = null;
    // A HashRouter build would never even see this real path — the whole
    // location lived after '#'. Under BrowserRouter this is the actual path.
    renderAt('/admin/finance?tab=payouts');
    await waitFor(() => expect(screen.getByText('login screen')).toBeInTheDocument());
    expect(screen.getByTestId('login-search').textContent).toBe(
      `?redirect=${encodeURIComponent('/admin/finance?tab=payouts')}`,
    );
  });
});
