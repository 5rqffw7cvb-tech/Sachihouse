/**
 * Admin console design system.
 *
 * Every admin screen builds from these. Colour, radius and control height live
 * here and in the @theme block of index.css — a page that writes its own hex or
 * its own `rounded-*` is drifting, and drift is what this set exists to stop.
 */
export { Button } from './Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button';

export { Card } from './Card';
export type { CardProps } from './Card';

export { Field, Input, Select, Textarea } from './Field';
export type { FieldProps } from './Field';

export { Table } from './Table';
export type { Column, TableProps } from './Table';

export { Tabs } from './Tabs';
export type { TabItem, TabsProps } from './Tabs';

export { Alert, Badge, EmptyState, Spinner } from './Feedback';
export type { AlertTone, Tone } from './Feedback';
