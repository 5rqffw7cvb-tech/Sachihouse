import { describe, expect, it } from 'vitest';
import { AdminAccess, hasAccess } from './permissions';
import { ApiUser } from './api';

const user = (over: Partial<ApiUser>): ApiUser => ({
  id: 1,
  name: 'Test',
  email: 'test@example.com',
  role: 'GUEST',
  canEditBlog: false,
  assignedPropertyIds: [],
  hostLevel: null,
  ...over,
});

const ADMIN = user({ role: 'ADMIN' });
const GUEST = user({ role: 'GUEST' });
const BLOG_EDITOR = user({ role: 'GUEST', canEditBlog: true });
const host = (level: 1 | 2 | 3 | 4 | null) => user({ role: 'HOST', hostLevel: level });

const ALL: AdminAccess[] = ['host', 'admin', 'finance', 'blog'];

describe('hasAccess', () => {
  it('refuses everything when nobody is signed in', () => {
    for (const access of ALL) {
      expect(hasAccess(null, access), access).toBe(false);
      expect(hasAccess(undefined, access), access).toBe(false);
    }
  });

  it('lets an administrator through every gate', () => {
    for (const access of ALL) {
      expect(hasAccess(ADMIN, access), access).toBe(true);
    }
  });

  it('refuses a plain guest at every gate', () => {
    for (const access of ALL) {
      expect(hasAccess(GUEST, access), access).toBe(false);
    }
  });

  describe('host', () => {
    it('admits hosts of any level', () => {
      for (const level of [1, 2, 3, 4] as const) {
        expect(hasAccess(host(level), 'host'), `level ${level}`).toBe(true);
      }
      expect(hasAccess(host(null), 'host')).toBe(true);
    });

    it('does not admit hosts to admin-only areas', () => {
      expect(hasAccess(host(4), 'admin')).toBe(false);
    });
  });

  describe('finance', () => {
    // The rule that is easiest to get wrong, and the one that exposes revenue
    // and tax records if it drifts.
    it('admits only hosts at level 4', () => {
      expect(hasAccess(host(1), 'finance')).toBe(false);
      expect(hasAccess(host(2), 'finance')).toBe(false);
      expect(hasAccess(host(3), 'finance')).toBe(false);
      expect(hasAccess(host(4), 'finance')).toBe(true);
    });

    it('treats a missing host level as unqualified', () => {
      expect(hasAccess(host(null), 'finance')).toBe(false);
    });
  });

  describe('blog', () => {
    it('admits a non-host flagged as a blog editor', () => {
      expect(hasAccess(BLOG_EDITOR, 'blog')).toBe(true);
    });

    it('refuses a host who is not a blog editor', () => {
      expect(hasAccess(host(4), 'blog')).toBe(false);
    });

    it('does not let the blog flag unlock anything else', () => {
      expect(hasAccess(BLOG_EDITOR, 'admin')).toBe(false);
      expect(hasAccess(BLOG_EDITOR, 'host')).toBe(false);
      expect(hasAccess(BLOG_EDITOR, 'finance')).toBe(false);
    });
  });
});
