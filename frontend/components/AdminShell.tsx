import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Building2,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Loader2,
  Lock,
  Newspaper,
  Receipt,
  Tag,
  Ticket,
  Users,
  Wallet,
} from 'lucide-react';
import { ApiUser } from '../services/api';
import { getCurrentUser, subscribeToAuth } from '../services/auth';
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

/**
 * Access levels mirror the permission booleans in TopNavBar exactly. Keep the
 * two in sync — the sidebar and the gate both read from here, so a drift would
 * show a link the page then refuses to render.
 */
export type AdminAccess = 'host' | 'admin' | 'finance' | 'blog';

const hasAccess = (user: ApiUser | null, access: AdminAccess): boolean => {
  if (!user) return false;
  switch (access) {
    case 'admin':
      return user.role === 'ADMIN';
    case 'host':
      return user.role === 'ADMIN' || user.role === 'HOST';
    // Finance is reserved for admins and host level 4 only.
    case 'finance':
      return user.role === 'ADMIN' || (user.role === 'HOST' && (user.hostLevel ?? 0) >= 4);
    case 'blog':
      return user.role === 'ADMIN' || Boolean(user.canEditBlog);
    default:
      return false;
  }
};

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

  if (!authUser) {
    return (
      <div className="min-h-screen bg-[#e8e5e6] flex flex-col">
        <TopNavBar navTitleOverride={navTitleOverride} />
        <div className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-[#e4e2e3] w-full max-w-md text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-[#efedef] text-[#44474c] flex items-center justify-center">
              <Lock className="w-6 h-6" />
            </div>
            <h2 className="font-['Plus_Jakarta_Sans'] text-[22px] font-bold text-[#1b1c1d] mb-2">{signInTitle}</h2>
            <p className="text-sm text-[#44474c] mb-6">{signInMessage}</p>
            <button
              onClick={handleLogin}
              className="w-full bg-[#041627] hover:bg-[#041627]/90 text-white font-bold py-3 px-4 rounded-full transition-colors"
            >
              Login
            </button>
          </div>
        </div>
        <MobileBottomNav />
      </div>
    );
  }

  if (!hasAccess(authUser, access)) {
    return (
      <div className="min-h-screen bg-[#e8e5e6] flex flex-col">
        <TopNavBar navTitleOverride={navTitleOverride} />
        <div className="flex-1 flex items-center justify-center px-4 py-12 md:pt-[110px]">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 shadow-sm text-center w-full max-w-lg">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h1 className="font-['Plus_Jakarta_Sans'] text-2xl font-bold text-[#1b1c1d] mb-2">{deniedTitle}</h1>
            <p className="text-[#44474c] mb-6">{deniedMessage}</p>
            <Link
              to="/"
              className="inline-flex items-center px-5 py-2.5 rounded-full border border-[#041627] text-[#041627] font-semibold hover:bg-[#efedef] transition-colors"
            >
              Back to listings
            </Link>
          </div>
        </div>
        <MobileBottomNav />
      </div>
    );
  }

  const visibleGroups = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => hasAccess(authUser, item.access)) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white">
      <TopNavBar navTitleOverride={navTitleOverride} />

      {/* Desktop sidebar. Executive Obsidian Chrome. */}
      <aside
        className="hidden md:flex flex-col fixed left-0 w-64 bg-slate-950/90 backdrop-blur-xl border-r border-slate-800/80 overflow-y-auto z-40 shadow-2xl shadow-slate-950/50"
        style={{ top: `${TOPNAV_OFFSET}px`, height: `calc(100vh - ${TOPNAV_OFFSET}px)` }}
      >
        {/* User Role Badge Card */}
        {authUser && (
          <div className="px-4 pt-4 pb-2 border-b border-slate-800/60">
            <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-inner">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center font-bold text-white text-xs shadow-md shadow-indigo-500/20">
                {authUser.name ? authUser.name.charAt(0).toUpperCase() : 'A'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-extrabold text-slate-200 truncate">{authUser.name || authUser.email}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-indigo-400">
                    {authUser.role} {authUser.role === 'HOST' ? `Lvl ${authUser.hostLevel ?? 1}` : ''}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        <nav className="flex-1 px-3 py-4 space-y-5">
          {visibleGroups.map((group) => (
            <div key={group.title} className="space-y-1">
              <div className="px-3 text-[10px] font-mono font-extrabold uppercase tracking-widest text-slate-500">
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
                    className={`relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-xs transition-all duration-200 ${
                      isActive
                        ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-extrabold shadow-lg shadow-indigo-500/25 scale-[1.02]'
                        : 'text-slate-400 font-medium hover:bg-slate-800/60 hover:text-slate-200'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-white' : 'text-slate-500'}`} />
                    <span className="truncate">{label}</span>
                    {typeof badge === 'number' && badge > 0 && (
                      <span className={`ml-auto shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                        isActive ? 'bg-white/20 text-white' : 'bg-indigo-950 text-indigo-300 border border-indigo-800/50'
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

      <div className="md:pl-64">
        <main className={`w-full mx-auto pb-28 md:pb-12 ${paddingXClass} ${maxWidthClass}`}>
          {/* Clears the fixed TopNavBar. */}
          <div className="hidden md:block" style={{ height: `${TOPNAV_OFFSET}px` }} />

          {(title || actions) && (
            <div className={`flex flex-col md:flex-row md:items-center md:justify-between gap-4 py-6 md:py-8 border-b border-slate-800/80 mb-6 ${headerClassName}`}>
              <div className="min-w-0">
                {title && (
                  <div className="flex items-center gap-3">
                    <span className="w-1.5 h-7 rounded-full bg-gradient-to-b from-indigo-500 to-purple-600" />
                    <h1 className="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-extrabold tracking-tight text-white truncate">{title}</h1>
                  </div>
                )}
                {subtitle && <p className="text-xs md:text-sm text-slate-400 mt-1.5 font-medium ml-4">{subtitle}</p>}
              </div>
              {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="w-9 h-9 animate-spin text-indigo-500" />
            </div>
          ) : (
            children
          )}
        </main>

        {showFooter && <Footer />}
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default AdminShell;
