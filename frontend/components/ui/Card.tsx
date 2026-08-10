import React from 'react';

/**
 * The container every admin panel sits in: white surface, hairline border,
 * one radius. `padded` is on by default; turn it off when the child is a
 * Table or anything else that needs to reach the card's edge.
 */
export interface CardProps {
  /** Optional heading row along the top of the card. */
  title?: React.ReactNode;
  /** Right-aligned controls in the heading row. */
  actions?: React.ReactNode;
  padded?: boolean;
  className?: string;
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ title, actions, padded = true, className = '', children }) => (
  <section className={`bg-surface border border-line rounded-card overflow-hidden ${className}`}>
    {(title || actions) && (
      <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-line">
        {typeof title === 'string'
          ? <h2 className="text-[16px] font-bold text-ink truncate">{title}</h2>
          : title}
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </header>
    )}
    <div className={padded ? 'p-5' : ''}>{children}</div>
  </section>
);

export default Card;
