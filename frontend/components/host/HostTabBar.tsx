import React from 'react';
import { NavLink } from 'react-router-dom';
import { CalendarDays, ClipboardCheck, Home, Receipt, User } from 'lucide-react';
import { ApiUser } from '../../services/api';
import { AdminAccess, hasAccess } from '../../services/permissions';

/**
 * The host app's only navigation. Five destinations, always on screen — the
 * console's MobileBottomNav hides half its entries behind an account dropdown,
 * which is the thing that made hosts stop using it on a phone.
 *
 * Height is deliberate: 48px items clear the 44px minimum tap target even
 * before the bar's own padding, and the bottom padding carries the home-bar
 * inset so the last row is never under the gesture area.
 */
export const HOST_TAB_BAR_HEIGHT = 76;

interface Tab {
  to: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** Omitted when any host or admin may see it. */
  access?: AdminAccess;
  /** `end` so the index route does not stay active on every child path. */
  end?: boolean;
}

const TABS: Tab[] = [
  { to: '/app', label: 'Today', Icon: Home, end: true },
  { to: '/app/calendar', label: 'Calendar', Icon: CalendarDays },
  { to: '/app/checkins', label: 'Check-in', Icon: ClipboardCheck, access: 'checkins' },
  { to: '/app/receipt', label: 'Receipt', Icon: Receipt, access: 'finance' },
  { to: '/app/account', label: 'Account', Icon: User },
];

export const HostTabBar: React.FC<{ user: ApiUser | null }> = ({ user }) => {
  // A host below level 4 has no finance access and one below level 3 no
  // check-in access, so the bar is four or three wide for them. Rendering the
  // tab and letting the page refuse would be a nav that lies about where it
  // can go.
  const tabs = TABS.filter((tab) => !tab.access || hasAccess(user, tab.access));

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 grid gap-1 px-2 pt-1.5
        bg-surface/92 backdrop-blur-md border-t border-line
        shadow-[0_-4px_12px_rgba(0,0,0,0.03)]"
      style={{
        gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
        paddingBottom: 'calc(0.375rem + env(safe-area-inset-bottom, 16px))',
      }}
    >
      {tabs.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center gap-[3px] h-12 rounded-control transition-colors ${
              isActive ? 'bg-brand-tint text-ink' : 'text-ink-soft active:bg-subtle'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <Icon className="w-[22px] h-[22px]" />
              <span
                className={`font-['Plus_Jakarta_Sans'] text-[10px] leading-none tracking-[0.01em] ${
                  isActive ? 'font-bold' : 'font-medium'
                }`}
              >
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
};

export default HostTabBar;
