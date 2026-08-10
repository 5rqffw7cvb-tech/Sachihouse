import React from 'react';

/**
 * Form primitives. The shared `CONTROL` string is what keeps every input,
 * select and textarea in the console the same height, radius and focus ring.
 */
const CONTROL =
  'w-full bg-subtle border border-line rounded-control text-[14px] text-ink ' +
  'placeholder:text-ink-muted transition-colors ' +
  'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 ' +
  'disabled:opacity-60 disabled:cursor-not-allowed';

export interface FieldProps {
  label?: string;
  /** Helper text under the control. */
  hint?: string;
  /** Replaces the hint and turns the text red. */
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Wraps a control with its label, hint and error text. */
export const Field: React.FC<FieldProps> = ({ label, hint, error, required, className = '', children }) => (
  <div className={className}>
    {label && (
      <label className="block text-[12px] font-semibold uppercase tracking-wide text-ink-soft mb-1.5">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </label>
    )}
    {children}
    {(error || hint) && (
      <p className={`mt-1.5 text-[12px] ${error ? 'text-danger' : 'text-ink-muted'}`}>{error || hint}</p>
    )}
  </div>
);

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({ className = '', ...rest }) => (
  <input {...rest} className={`${CONTROL} h-10 px-3.5 ${className}`} />
);

export const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({ className = '', ...rest }) => (
  <textarea {...rest} className={`${CONTROL} px-3.5 py-2.5 ${className}`} />
);

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ className = '', children, ...rest }) => (
  <select {...rest} className={`${CONTROL} h-10 px-3 pr-8 cursor-pointer ${className}`}>
    {children}
  </select>
);

export default Field;
