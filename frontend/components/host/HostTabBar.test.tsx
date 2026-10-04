import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ApiUser } from '../../services/api';
import { HostTabBar } from './HostTabBar';

const makeUser = (over: Partial<ApiUser>): ApiUser => ({
  id: 1,
  name: 'User',
  email: 'user@example.com',
  role: 'HOST',
  canEditBlog: false,
  assignedPropertyIds: ['s01'],
  hostLevel: 1,
  ...over,
});

function renderBar(user: ApiUser | null, path = '/app/finance') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HostTabBar user={user} />
    </MemoryRouter>,
  );
}

const labels = () => screen.getAllByRole('link').map((link) => link.textContent);
const linkNamed = (name: string) => screen.getByRole('link', { name });

describe('HostTabBar: which tabs a user gets', () => {
  it('gives an admin all six tabs in order, Finance pointing at /app/finance', () => {
    renderBar(makeUser({ role: 'ADMIN', hostLevel: null }));
    expect(labels()).toEqual(['Stays', 'Calendar', 'Check-in', 'Receipt', 'Finance', 'Account']);
    expect(linkNamed('Finance')).toHaveAttribute('href', '/app/finance');
  });

  it('gives a level-4 host all six tabs', () => {
    renderBar(makeUser({ role: 'HOST', hostLevel: 4 }));
    expect(labels()).toEqual(['Stays', 'Calendar', 'Check-in', 'Receipt', 'Finance', 'Account']);
  });

  it('gives a level-3 host four tabs: no Receipt, no Finance', () => {
    renderBar(makeUser({ role: 'HOST', hostLevel: 3 }));
    expect(labels()).toEqual(['Stays', 'Calendar', 'Check-in', 'Account']);
    expect(screen.queryByRole('link', { name: 'Finance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Receipt' })).not.toBeInTheDocument();
  });

  it('gives a level-2 host three tabs', () => {
    renderBar(makeUser({ role: 'HOST', hostLevel: 2 }));
    expect(labels()).toEqual(['Stays', 'Calendar', 'Account']);
  });

  it('gives a host with no level three tabs', () => {
    renderBar(makeUser({ role: 'HOST', hostLevel: null }));
    expect(labels()).toEqual(['Stays', 'Calendar', 'Account']);
  });

  it('gives no user three tabs', () => {
    renderBar(null);
    expect(labels()).toEqual(['Stays', 'Calendar', 'Account']);
  });

  it('does not give a GUEST the Finance tab even with hostLevel 4', () => {
    renderBar(makeUser({ role: 'GUEST', hostLevel: 4 }));
    expect(screen.queryByRole('link', { name: 'Finance' })).not.toBeInTheDocument();
  });
});

describe('HostTabBar: active state and layout', () => {
  it('marks Finance as the current page on /app/finance, and not Stays', () => {
    renderBar(makeUser({ role: 'ADMIN', hostLevel: null }), '/app/finance');
    expect(linkNamed('Finance')).toHaveAttribute('aria-current', 'page');
    expect(linkNamed('Stays')).not.toHaveAttribute('aria-current');
    expect(linkNamed('Receipt')).not.toHaveAttribute('aria-current');
  });

  it('marks only Receipt on /app/receipt (Finance not active)', () => {
    renderBar(makeUser({ role: 'ADMIN', hostLevel: null }), '/app/receipt');
    expect(linkNamed('Receipt')).toHaveAttribute('aria-current', 'page');
    expect(linkNamed('Finance')).not.toHaveAttribute('aria-current');
    expect(linkNamed('Stays')).not.toHaveAttribute('aria-current');
  });

  it('marks only Stays on /app', () => {
    renderBar(makeUser({ role: 'ADMIN', hostLevel: null }), '/app');
    expect(linkNamed('Stays')).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });

  it('lays an admin bar out in six equal columns', () => {
    renderBar(makeUser({ role: 'ADMIN', hostLevel: null }));
    const nav = screen.getByRole('navigation');
    expect(nav.style.gridTemplateColumns).toContain('repeat(6');
    expect(within(nav).getAllByRole('link')).toHaveLength(6);
  });

  it('lays a level-3 host bar out in four columns', () => {
    renderBar(makeUser({ role: 'HOST', hostLevel: 3 }));
    expect(screen.getByRole('navigation').style.gridTemplateColumns).toContain('repeat(4');
  });

  it('keeps each tab at h-12 so the tap target stays 48px', () => {
    renderBar(makeUser({ role: 'ADMIN', hostLevel: null }));
    screen.getAllByRole('link').forEach((link) => expect(link.className).toContain('h-12'));
  });
});
