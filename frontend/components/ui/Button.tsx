import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * The one button in the admin console.
 *
 * Before this existed the twelve admin pages shipped five different primary
 * fills (#041627, blue-600, slate-900, #1b1c1d, emerald-600) and six radii.
 * Everything routes through `variant` and `size` now — if a screen needs a
 * look that isn't here, add a variant rather than a one-off className.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand/90 border border-transparent',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-subtle',
  danger: 'bg-danger text-white hover:bg-danger/90 border border-transparent',
  ghost: 'bg-transparent text-ink-soft border border-transparent hover:bg-subtle hover:text-ink',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-[14px] gap-2',
};

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
};

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Lucide icon component, rendered before the label. */
  icon?: React.ComponentType<{ className?: string }>;
  /** Swaps the icon for a spinner and disables the button. */
  loading?: boolean;
  /** Escape hatch for layout only (margins, width) — never for colour. */
  className?: string;
  children?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}) => (
  <button
    {...rest}
    disabled={disabled || loading}
    className={`inline-flex items-center justify-center rounded-control font-semibold whitespace-nowrap
      transition-colors disabled:opacity-50 disabled:cursor-not-allowed
      focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand
      ${VARIANT[variant]} ${SIZE[size]} ${className}`}
  >
    {loading ? (
      <Loader2 className={`${ICON_SIZE[size]} animate-spin shrink-0`} />
    ) : Icon ? (
      <Icon className={`${ICON_SIZE[size]} shrink-0`} />
    ) : null}
    {children}
  </button>
);

export default Button;
