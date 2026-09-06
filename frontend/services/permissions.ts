import { ApiUser } from './api';

/**
 * Who may see what, in one place.
 *
 * The route guard and the admin shell both answer this question, and for a
 * while they answered it differently: ProtectedRoute only understood 'ADMIN',
 * so /admin/services was guarded as "any signed-in user" while the page itself
 * demanded an administrator. The screens stayed safe only because AdminShell
 * re-checked and the API returns 403 regardless — but the guard was lying.
 *
 * These levels mirror the permission expressions in TopNavBar and
 * MobileBottomNav. Change one, change all three, or the nav offers links the
 * page then refuses.
 */
export type AdminAccess =
  /** Any host or admin — day-to-day property operations. */
  | 'host'
  /** Administrators only — platform configuration. */
  | 'admin'
  /** Admins, or hosts at level 4. Finance and receipts. */
  | 'finance'
  /** Admins, or hosts at level 3+. Guest ID records — mirrors the rule
   *  GET /api/checkins enforces, so a nav can hide what the API would refuse. */
  | 'checkins'
  /** Admins, or anyone flagged as a blog editor. */
  | 'blog';

export function hasAccess(user: ApiUser | null | undefined, access: AdminAccess): boolean {
  if (!user) return false;
  switch (access) {
    case 'admin':
      return user.role === 'ADMIN';
    case 'host':
      return user.role === 'ADMIN' || user.role === 'HOST';
    case 'finance':
      return user.role === 'ADMIN' || (user.role === 'HOST' && (user.hostLevel ?? 0) >= 4);
    case 'checkins':
      return user.role === 'ADMIN' || (user.role === 'HOST' && (user.hostLevel ?? 0) >= 3);
    case 'blog':
      return user.role === 'ADMIN' || Boolean(user.canEditBlog);
    default:
      return false;
  }
}
