import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { HOST_TAB_BAR_HEIGHT } from './HostTabBar';

/**
 * The frame every host-app screen sits in: a title row that clears the phone's
 * status bar, and a body that scrolls under it and stops above the tab bar.
 *
 * The top spacer is `env(safe-area-inset-top)`, not a drawn bar. Installed to
 * the home screen the page runs full-bleed and iOS paints the real clock on
 * top of this space; in a normal browser tab the inset is 0 and the title just
 * sits at the top, which is also right.
 */
export interface HostScreenProps {
  title: string;
  /** Small line under the title — a date, a Japanese page name. */
  subtitle?: string;
  /** Right-hand control in the title row. */
  action?: React.ReactNode;
  isLoading?: boolean;
  error?: string | null;
  children: React.ReactNode;
}

export const HostScreen: React.FC<HostScreenProps> = ({
  title,
  subtitle,
  action,
  isLoading = false,
  error,
  children,
}) => (
  <div className="min-h-[100dvh] bg-page flex flex-col">
    <div style={{ height: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }} className="shrink-0" />

    <header className="shrink-0 flex items-center justify-between gap-3 px-4 h-16">
      <div className="min-w-0 flex flex-col">
        <h1 className="text-[24px] tracking-[-0.4px] truncate">{title}</h1>
        {subtitle && <span className="text-[13px] text-ink-muted truncate">{subtitle}</span>}
      </div>
      {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
    </header>

    <main
      className="flex-1 px-4 pt-1 flex flex-col gap-3.5"
      style={{ paddingBottom: `calc(${HOST_TAB_BAR_HEIGHT}px + 1rem + env(safe-area-inset-bottom, 16px))` }}
    >
      {error && (
        <div className="flex items-start gap-2.5 bg-danger-tint text-danger border border-danger/20 rounded-card px-4 py-3 text-[13px]">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1 min-w-0">{error}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-ink-muted">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : (
        children
      )}
    </main>
  </div>
);

/** White panel with the console's hairline and radius — the one container. */
export const HostCard: React.FC<{
  title?: React.ReactNode;
  action?: React.ReactNode;
  /** Off when the children are full-bleed rows that reach the card's edge. */
  padded?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ title, action, padded = false, className = '', children }) => (
  <section className={`bg-surface border border-line rounded-card overflow-hidden ${className}`}>
    {(title || action) && (
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line">
        {typeof title === 'string' ? <h2 className="text-[16px] truncate">{title}</h2> : title}
        {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
      </header>
    )}
    <div className={padded ? 'p-4' : ''}>{children}</div>
  </section>
);

/** The "nothing here" line inside a card. Same wording shape as the console's
 *  EmptyState, sized for a phone. */
export const HostEmpty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="px-4 py-8 text-center text-[14px] text-ink-muted">{children}</p>
);

/** Rounded count pill next to a card title. */
export const HostCount: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-[12px] font-semibold text-ink-soft bg-brand-tint rounded-full px-2.5 py-0.5">
    {children}
  </span>
);

export default HostScreen;
