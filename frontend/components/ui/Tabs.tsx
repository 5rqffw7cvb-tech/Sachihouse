import React from 'react';

/**
 * Segmented control for a page's sub-sections — the property editor's form
 * groups, the finance console's reports. Sits directly under the shell header,
 * so it is deliberately quieter than the sidebar's active state.
 */
export interface TabItem<T extends string> {
  id: T;
  label: string;
  /** Widened to ElementType so the pages' existing NAV_ITEMS tables fit as-is. */
  icon?: React.ElementType;
}

export interface TabsProps<T extends string> {
  items: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}

export function Tabs<T extends string>({ items, active, onChange, className = '' }: TabsProps<T>) {
  return (
    <div
      role="tablist"
      className={`flex flex-wrap gap-1 p-1 bg-subtle border border-line rounded-card mb-5 ${className}`}
    >
      {items.map(({ id, label, icon: Icon }) => {
        const isActive = id === active;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(id)}
            className={`inline-flex items-center gap-2 px-3.5 h-9 rounded-control text-[14px]
              transition-colors whitespace-nowrap ${
              isActive
                ? 'bg-surface text-ink font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                : 'text-ink-soft font-medium hover:text-ink'
            }`}
          >
            {Icon && <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-brand' : 'text-ink-muted'}`} />}
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
