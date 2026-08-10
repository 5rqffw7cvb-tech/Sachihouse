import React from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react';

/**
 * Status vocabulary shared by every admin screen: one hue per meaning, so a
 * green pill means the same thing on the coupon list as on the check-in table.
 */
export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info';

const BADGE: Record<Tone, string> = {
  neutral: 'bg-brand-tint text-ink-soft',
  ok: 'bg-ok-tint text-ok',
  warn: 'bg-warn-tint text-warn',
  danger: 'bg-danger-tint text-danger',
  info: 'bg-info-tint text-info',
};

export const Badge: React.FC<{ tone?: Tone; children: React.ReactNode; className?: string }> = ({
  tone = 'neutral',
  children,
  className = '',
}) => (
  <span
    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full
      text-[12px] font-semibold whitespace-nowrap ${BADGE[tone]} ${className}`}
  >
    {children}
  </span>
);

const ALERT: Record<Exclude<Tone, 'neutral'>, { cls: string; Icon: React.ComponentType<{ className?: string }> }> = {
  ok: { cls: 'bg-ok-tint text-ok border-ok/20', Icon: CheckCircle2 },
  warn: { cls: 'bg-warn-tint text-warn border-warn/20', Icon: AlertCircle },
  danger: { cls: 'bg-danger-tint text-danger border-danger/20', Icon: AlertCircle },
  info: { cls: 'bg-info-tint text-info border-info/20', Icon: Info },
};

/** Dismissible banner. Replaces the hand-rolled error/info strips on six pages. */
export const Alert: React.FC<{
  tone?: Exclude<Tone, 'neutral'>;
  onDismiss?: () => void;
  children: React.ReactNode;
}> = ({ tone = 'info', onDismiss, children }) => {
  const { cls, Icon } = ALERT[tone];
  return (
    <div className={`flex items-start gap-2.5 border rounded-card px-4 py-3 text-[14px] mb-5 ${cls}`}>
      <Icon className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">{children}</div>
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

/** The "nothing here yet" panel — same shape whether a list is empty or filtered to nothing. */
export const EmptyState: React.FC<{
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ icon: Icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center text-center px-6 py-14">
    {Icon && (
      <div className="w-11 h-11 rounded-full bg-subtle flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-ink-muted" />
      </div>
    )}
    <p className="text-[15px] font-semibold text-ink">{title}</p>
    {description && <p className="text-[13px] text-ink-muted mt-1 max-w-sm">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/** In-panel loading state. Use the shell's `isLoading` for whole-page loads. */
export const Spinner: React.FC<{ label?: string }> = ({ label }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-14 text-ink-muted">
    <Loader2 className="w-6 h-6 animate-spin text-brand" />
    {label && <p className="text-[13px] font-medium">{label}</p>}
  </div>
);
