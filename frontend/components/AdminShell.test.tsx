import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiUser } from '../services/api';

// TopNavBar / MobileBottomNav pull in site settings and network calls that say
// nothing about what this component decides. Stub them to keep the test on the
// gate and the navigation it renders.
vi.mock('./TopNavBar', () => ({ TopNavBar: () => <nav data-testid="topnav" /> }));
vi.mock('./MobileBottomNav', () => ({ MobileBottomNav: () => <nav data-testid="mobilenav" /> }));
vi.mock('./Footer', () => ({ Footer: () => <footer /> }));
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'en', setLanguage: () => {} }),
}));

let currentUser: ApiUser | null = null;
vi.mock('../services/auth', () => ({
  getCurrentUser: () => currentUser,
  subscribeToAuth: async (cb: (u: ApiUser | null) => void) => {
    cb(currentUser);
    return () => {};
  },
}));

const { AdminShell } = await import('./AdminShell');

const user = (over: Partial<ApiUser>): ApiUser => ({
  id: 1,
  name: 'Test Person',
  email: 'test@example.com',
  role: 'GUEST',
  canEditBlog: false,
  assignedPropertyIds: [],
  hostLevel: null,
  ...over,
});

const renderShell = (props: Partial<React.ComponentProps<typeof AdminShell>> = {}) =>
  render(
    <MemoryRouter>
      <AdminShell title="Test Page" access="admin" {...props}>
        <p>secret content</p>
      </AdminShell>
    </MemoryRouter>,
  );

beforeEach(() => { currentUser = null; });

describe('AdminShell gate', () => {
  it('asks a signed-out visitor to sign in and shows nothing else', () => {
    renderShell({ signInTitle: 'Please sign in' });
    expect(screen.getByText('Please sign in')).toBeInTheDocument();
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });

  it('refuses a host on an admin-only page', () => {
    currentUser = user({ role: 'HOST', hostLevel: 4 });
    renderShell({ access: 'admin', deniedTitle: 'Admin role required' });
    expect(screen.getByText('Admin role required')).toBeInTheDocument();
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });

  it('withholds finance from a host below level 4', () => {
    currentUser = user({ role: 'HOST', hostLevel: 3 });
    renderShell({ access: 'finance' });
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });

  it('admits a host at level 4 to finance', () => {
    currentUser = user({ role: 'HOST', hostLevel: 4 });
    renderShell({ access: 'finance' });
    expect(screen.getByText('secret content')).toBeInTheDocument();
  });

  it('renders the page for a permitted user', () => {
    currentUser = user({ role: 'ADMIN' });
    renderShell();
    expect(screen.getByText('secret content')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Test Page' })).toBeInTheDocument();
  });
});

describe('AdminShell navigation', () => {
  it('offers a host only the groups it is entitled to', () => {
    currentUser = user({ role: 'HOST', hostLevel: 1 });
    renderShell({ access: 'host' });

    expect(screen.getByRole('link', { name: /Calendar/ })).toBeInTheDocument();
    // Level 1 has no finance, and no host has platform administration.
    expect(screen.queryByRole('link', { name: /Upload Receipt/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Coupons/ })).not.toBeInTheDocument();
    expect(screen.queryByText('SYSTEM')).not.toBeInTheDocument();
  });

  it('opens finance to a level 4 host', () => {
    currentUser = user({ role: 'HOST', hostLevel: 4 });
    renderShell({ access: 'host' });
    expect(screen.getByRole('link', { name: /Upload Receipt/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Coupons/ })).not.toBeInTheDocument();
  });

  it('marks the active entry for assistive tech', () => {
    currentUser = user({ role: 'ADMIN' });
    renderShell({ access: 'admin', activeKey: 'coupons' });
    expect(screen.getByRole('link', { name: /Coupons/ })).toHaveAttribute('aria-current', 'page');
  });

  it('shows the signed-in identity and level', () => {
    currentUser = user({ role: 'HOST', hostLevel: 2, name: 'Sachi Host' });
    renderShell({ access: 'host' });
    expect(screen.getByText('Sachi Host')).toBeInTheDocument();
    expect(screen.getByText(/Level 2/)).toBeInTheDocument();
  });
});
