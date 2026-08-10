import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Building2,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Lock,
  Newspaper,
  Receipt,
  Tag,
  Ticket,
  Users,
  Wallet,
} from 'lucide-react';
import { Button, Spinner } from './ui';
import { ApiUser } from '../services/api';
import { getCurrentUser, subscribeToAuth } from '../services/auth';
import { AdminAccess, hasAccess } from '../services/permissions';
import { useLanguage } from '../contexts/LanguageContext';
import { TopNavBar } from './TopNavBar';
import { MobileBottomNav } from './MobileBottomNav';
import { Footer } from './Footer';

/**
 * Shared chrome for every admin/host screen.
 *
 * Before this component each admin page repeated the same three states by hand
 * (loading / signed out / not permitted), each wrapping its own TopNavBar. The
 * shell owns those states plus a desktop sidebar so a page only ships its body.
 *
 * Desktop gets the sidebar; mobile keeps the existing MobileBottomNav untouched.
 */

/** Desktop TopNavBar is fixed: py-3 (24px) + a 36px control row + 1px border. */
const TOPNAV_OFFSET = 61;

export type AdminNavKey =
  | 'properties'
  | 'calendar'
  | 'checkins'
  | 'bookingConfirm'
  | 'finance'
  | 'receipts'
  | 'users'
  | 'coupons'
  | 'services'
  | 'blog';

// Access levels live in services/permissions so the route guard and this shell
// cannot answer the same question differently.
export type { AdminAccess } from '../services/permissions';

interface NavItem {
  key: AdminNavKey;
  to: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  access: AdminAccess;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

export interface AdminShellProps {
  /** Page heading. Omit it when the page renders its own header row instead —
   *  the shell then skips the heading block entirely. */
  title?: string;
  subtitle?: string;
  /** Buttons shown on the right of the heading row. */
  actions?: React.ReactNode;
  /** Permission required to view the page. The shell renders the denial screen. */
  access: AdminAccess;
  /** Which sidebar entry to mark active. Falls back to matching the URL. */
  activeKey?: AdminNavKey;
  /** Counters rendered as pills next to sidebar entries. */
  badges?: Partial<Record<AdminNavKey, number>>;
  /** Shows a spinner in place of the body. */
  isLoading?: boolean;
  /** Tailwind max-width class for the content column. */
  maxWidthClass?: string;
  /** Horizontal padding for the content column. Pages that go edge-to-edge on
   *  mobile (full-bleed tables) pass their own instead of the default gutter. */
  paddingXClass?: string;
  /** Extra classes on the heading row — lets a full-bleed page re-add the
   *  gutter the header still needs. */
  headerClassName?: string;
  /** Copy for the "no permission" screen. */
  deniedTitle?: string;
  deniedMessage?: string;
  /** Copy for the signed-out screen. */
  signInTitle?: string;
  signInMessage?: string;
  /** Admin screens read as a console, so the marketing footer is off by default. */
  showFooter?: boolean;
  /** Overrides the title TopNavBar shows on mobile. */
  navTitleOverride?: string;
  children: React.ReactNode;
}

export const AdminShell: React.FC<AdminShellProps> = ({
  title,
  subtitle,
  actions,
  access,
  activeKey,
  badges,
  isLoading = false,
  maxWidthClass = 'max-w-[1200px]',
  paddingXClass = 'px-3 md:px-8',
  headerClassName = '',
  deniedTitle = 'Permission required',
  deniedMessage = 'Your current account does not have permission to view this page.',
  signInTitle = 'Sign in required',
  signInMessage = 'Sign in with a host or admin account to continue.',
  showFooter = false,
  navTitleOverride,
  children,
}) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [authUser, setAuthUser] = useState<ApiUser | null>(getCurrentUser());

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => setAuthUser(user)).then((unsub) => { unsubscribe = unsub; });
    return () => unsubscribe();
  }, []);

  const groups: NavGroup[] = useMemo(() => [
    {
      title: 'Operations',
      items: [
        { key: 'properties', to: '/admin/properties', label: t('common_admin_property'), Icon: Building2, access: 'host' },
        { key: 'calendar', to: '/admin/calendar', label: 'Calendar', Icon: CalendarDays, access: 'host' },
      ],
    },
    {
      title: 'Reservations',
      items: [
        { key: 'checkins', to: '/admin/checkin-management', label: t('common_admin_checkin'), Icon: ClipboardCheck, access: 'host' },
        { key: 'bookingConfirm', to: '/admin/booking-confirm', label: 'Booking Confirm', Icon: FileText, access: 'host' },
      ],
    },
    {
      title: 'Finance',
      items: [
        { key: 'finance', to: '/admin/finance', label: t('common_admin_finance'), Icon: Wallet, access: 'finance' },
        { key: 'receipts', to: '/admin/upload-receipt', label: 'Upload Receipt', Icon: Receipt, access: 'finance' },
      ],
    },
    {
      title: 'System',
      items: [
        { key: 'users', to: '/admin/users', label: t('common_admin_users'), Icon: Users, access: 'admin' },
        { key: 'coupons', to: '/admin/coupons', label: 'Coupons', Icon: Ticket, access: 'admin' },
        { key: 'services', to: '/admin/services', label: 'Services', Icon: Tag, access: 'admin' },
        { key: 'blog', to: '/blog/admin', label: t('common_admin_blog'), Icon: Newspaper, access: 'blog' },
      ],
    },
  ], [t]);

  // Longest prefix wins so /admin/booking-confirm/history still lights up its parent.
  const resolvedKey: AdminNavKey | undefined = useMemo(() => {
    if (activeKey) return activeKey;
    const match = groups
      .flatMap((group) => group.items)
      .filter((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))
      .sort((a, b) => b.to.length - a.to.length)[0];
    return match?.key;
  }, [activeKey, groups, pathname]);

  const handleLogin = () => {
    navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);
  };

  // Both gates share one panel so a refusal reads the same wherever it comes from.
  const gate = (
    Icon: React.ComponentType<{ className?: string }>,
    iconTone: string,
    heading: string,
    message: string,
    action: React.ReactNode,
  ) => (
    <div className="min-h-screen bg-page flex flex-col">
      <TopNavBar navTitleOverride={navTitleOverride} />
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="bg-surface border border-line rounded-card p-8 w-full max-w-md text-center">
          <div className={`mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center ${iconTone}`}>
            <Icon className="w-6 h-6" />
          </div>
          <h2 className="text-[22px] font-bold text-ink mb-2">{heading}</h2>
          <p className="text-[14px] text-ink-soft mb-6">{message}</p>
          {action}
        </div>
      </div>
      <MobileBottomNav />
    </div>
  );

  if (!authUser) {
    return gate(
      Lock,
      'bg-brand-tint text-ink-soft',
      signInTitle,
      signInMessage,
      <Button variant="primary" onClick={handleLogin} className="w-full">Login</Button>,
    );
  }

  if (!hasAccess(authUser, access)) {
    return gate(
      AlertCircle,
      'bg-danger-tint text-danger',
      deniedTitle,
      deniedMessage,
      <Link
        to="/"
        className="inline-flex items-center h-10 px-4 rounded-control border border-line-strong
          text-[14px] font-semibold text-ink hover:bg-subtle transition-colors"
      >
        Back to listings
      </Link>,
    );
  }

  const visibleGroups = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => hasAccess(authUser, item.access)) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="min-h-screen bg-page text-ink">
      <TopNavBar navTitleOverride={navTitleOverride} />

      {/* Desktop sidebar. Sits below the fixed TopNavBar and spans the viewport. */}
      <aside
        className="hidden md:flex flex-col fixed left-0 w-60 bg-surface border-r border-line overflow-y-auto z-40"
        style={{ top: `${TOPNAV_OFFSET}px`, height: `calc(100vh - ${TOPNAV_OFFSET}px)` }}
      >
        {/* Who is signed in, and at what level — the question hosts ask most. */}
        <div className="px-3 pt-3 pb-3 border-b border-line">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-control bg-subtle">
            <div className="w-8 h-8 shrink-0 rounded-full bg-brand text-white flex items-center justify-center text-[13px] font-bold">
              {(authUser.name || authUser.email).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-ink truncate">{authUser.name || authUser.email}</p>
              <p className="text-[11px] text-ink-muted truncate">
                {authUser.role === 'HOST' ? `Host · Level ${authUser.hostLevel ?? 1}` : 'Administrator'}
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-2.5 py-3 space-y-4">
          {visibleGroups.map((group) => (
            <div key={group.title}>
              <div className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-muted">
                {group.title}
              </div>
              {group.items.map(({ key, to, label, Icon }) => {
                const isActive = key === resolvedKey;
                const badge = badges?.[key];
                return (
                  <Link
                    key={key}
                    to={to}
                    aria-current={isActive ? 'page' : undefined}
                    className={`relative flex items-center gap-2.5 rounded-control px-3 py-2 mb-0.5
                      text-[14px] transition-colors ${
                      isActive
                        ? 'bg-brand text-white font-semibold'
                        : 'text-ink-soft font-medium hover:bg-subtle hover:text-ink'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-ink-muted'}`} />
                    <span className="truncate">{label}</span>
                    {typeof badge === 'number' && badge > 0 && (
                      <span className={`ml-auto shrink-0 text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
                        isActive ? 'bg-white/20 text-white' : 'bg-warn-tint text-warn'
                      }`}>
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="md:pl-60">
        <main className={`w-full mx-auto pb-28 md:pb-12 ${paddingXClass} ${maxWidthClass}`}>
          {/* Clears the fixed TopNavBar. */}
          <div className="hidden md:block" style={{ height: `${TOPNAV_OFFSET}px` }} />

          {(title || actions) && (
            <div className={`flex flex-col md:flex-row md:items-start md:justify-between gap-4 py-6 md:py-7 ${headerClassName}`}>
              <div className="min-w-0">
                {title && <h1 className="text-[22px] md:text-[28px] font-bold text-ink truncate">{title}</h1>}
                {subtitle && <p className="text-[14px] text-ink-soft mt-1">{subtitle}</p>}
              </div>
              {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
            </div>
          )}

          {isLoading ? <Spinner /> : children}
        </main>

        {showFooter && <Footer />}
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default AdminShell;
