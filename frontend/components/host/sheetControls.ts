/**
 * Form control classes for the host app's bottom sheets.
 *
 * These are constants rather than inline strings because of a bug they exist to
 * prevent. `${fieldClass} w-[118px]` reads like an override and is not one:
 * Tailwind resolves two `w-*` utilities on the same element by their order in
 * its generated stylesheet, not by their order in the class attribute. On the
 * invoice sheet `w-full` won, the tax dropdown took the whole row, and the
 * amount field and delete button were pushed off the screen.
 *
 * So every control below sets each CSS property exactly once, and
 * sheetControls.test.ts holds that line. When a control needs a different
 * width, height or padding, add a constant here — do not append a utility to
 * one of these at the call site.
 *
 * Two other rules are baked in:
 *
 *  - `min-w-0 max-w-full`, because an <input> carries an intrinsic min-content
 *    width of about twenty characters and, as a flex item, that width beats a
 *    declared one and drags the sheet past the screen edge.
 *  - 16px text on every focusable control. iOS zooms the page when a focused
 *    field is smaller, and it does not zoom back out on blur.
 */

/** What every control shares: no width, height, padding, background or size. */
const CONTROL =
  'min-w-0 max-w-full rounded-control text-ink ' +
  'placeholder:text-ink-muted focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';

/** Full-width single-line field on the sheet's own background. */
export const fieldClass = `${CONTROL} w-full h-12 px-3.5 bg-subtle text-[16px] border border-line`;

/** Same, but height comes from the `rows` attribute. */
export const textareaClass = `${CONTROL} w-full px-3.5 py-2.5 bg-subtle text-[16px] border border-line`;

/** pl/pr rather than px: the native arrow needs the room, and `px-3.5 pr-8`
 *  would be two declarations fighting over padding-right. */
export const selectClass = `${CONTROL} w-full h-12 pl-3.5 pr-8 bg-subtle text-[16px] border border-line`;

/** A field holding something present but malformed — a half-typed T number. */
export const invalidFieldClass = `${CONTROL} w-full h-12 px-3.5 bg-subtle text-[16px] border border-danger`;

/** Line-item description: full width on a card that is already `bg-subtle`. */
export const lineTextClass = `${CONTROL} w-full h-11 px-3.5 bg-surface text-[16px] border border-line`;

/** Line-item amount: takes the space the fixed-width controls beside it leave. */
export const lineAmountClass =
  `${CONTROL} flex-1 h-11 px-3.5 bg-surface text-[16px] tabular-nums border border-line`;

/** Line-item tax rate. 104px fits '8%軽減' at 16px with room for the arrow. */
export const lineTaxClass = `${CONTROL} w-[104px] shrink-0 h-11 pl-3 pr-7 bg-surface text-[16px] border border-line`;

export const labelClass = 'block text-[12px] font-semibold uppercase tracking-wide text-ink-soft mb-1.5';

/**
 * The panel a sheet's content scrolls inside.
 *
 * overflow-x-hidden is load-bearing: Tailwind's overflow-y-auto sets only
 * overflow-y, and the spec computes the untouched overflow-x from `visible` to
 * `auto` — so anything a pixel too wide turns the sheet into a horizontal
 * scroller under the guest's thumb.
 */
export const sheetPanelClass =
  'w-full bg-surface rounded-t-[24px] max-h-[92dvh] overflow-y-auto overflow-x-hidden animate-dialog-panel';

export const sheetBackdropClass =
  'fixed inset-0 z-50 bg-brand/60 backdrop-blur-sm flex items-end animate-dialog-backdrop';
