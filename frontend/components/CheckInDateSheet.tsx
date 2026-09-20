import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addMonths, format } from 'date-fns';
import type { Locale } from 'date-fns';
import { X } from 'lucide-react';
import { BookingDateSelection, applyDatePick } from '../utils/dateRange';
import DateRangeCalendar from './DateRangeCalendar';
import { useLanguage } from '../contexts/LanguageContext';
import { getDateFnsLocale } from '../utils/translations';

// Copied from DateRangeField rather than shared: these two live in the one
// other component that speaks YYYY-MM-DD to this calendar, and lifting them
// into a util would put every date field in the app in the blast radius of a
// change meant for the check-in form.
// Local-date parse: `new Date('2026-08-16')` is UTC midnight, which lands on
// the 15th for anyone west of Greenwich.
const fromYmd = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  date.setHours(0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toYmd = (date: Date): string => date.toLocaleDateString('sv-SE');

/**
 * The label the check-in form shows on its date buttons. 'PP' is the
 * localised medium date — "Sep 20, 2026", "2026年9月20日" — where a hand-built
 * pattern would read as broken English word order in ja/zh/ko.
 */
export const formatCheckInDateLabel = (value: string, locale: Locale): string => {
  const date = fromYmd(value);
  return date ? format(date, 'PP', { locale }) : '';
};

interface CheckInDateSheetProps {
  open: boolean;
  /** Which end takes the first tap — decided by the trigger that was pressed. */
  initialSelecting: 'checkIn' | 'checkOut';
  /** YYYY-MM-DD, the value currently in the form. */
  checkIn: string;
  checkOut: string;
  /** Only fired once both ends are set; the caller never sees half a range. */
  onApply: (checkIn: string, checkOut: string) => void;
  onClose: () => void;
  monthsBack?: number;
  monthsAhead?: number;
}

/**
 * The stay dates of the check-in form, picked on the shared calendar grid
 * instead of two `<input type="date">` — whose phone UI we do not control and
 * which looks different on every device.
 *
 * Unlike the booking calendars this one reaches into the past: a guest fills
 * the form in on arrival, sometimes a day or two late.
 */
const CheckInDateSheet: React.FC<CheckInDateSheetProps> = ({
  open,
  initialSelecting,
  checkIn,
  checkOut,
  onApply,
  onClose,
  monthsBack = 24,
  monthsAhead = 24,
}) => {
  const { t, language } = useLanguage();
  const dateLocale = getDateFnsLocale(language);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Two years either way stands in for the native input's unlimited range:
  // wide enough for any late filing, narrow enough that the month arrows do
  // not walk forever.
  const minDate = useMemo(() => addMonths(new Date(), -monthsBack), [monthsBack]);

  // The half-finished range lives here, so a lone check-in never reaches the
  // form — which must always hold a complete pair of dates.
  const [draft, setDraft] = useState<BookingDateSelection>(() => ({
    checkIn: fromYmd(checkIn),
    checkOut: fromYmd(checkOut),
    selecting: initialSelecting,
  }));

  // Re-sync on opening only. Keyed on `open` alone on purpose: the values it
  // reads change as the guest picks, and re-running then would keep resetting
  // the range back to what the form still holds.
  useEffect(() => {
    if (!open) return;
    setDraft({ checkIn: fromYmd(checkIn), checkOut: fromYmd(checkOut), selecting: initialSelecting });
  }, [open]);

  // Escape to dismiss, and keep the page behind from scrolling under the sheet.
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move focus into the dialog without opening a mobile keyboard, which
    // focusing the first control would do.
    dialogRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleSelectDay = (day: Date) => {
    const next = applyDatePick(draft, day);
    setDraft(next);
    // Commit both ends in one go: the form autosaves on a timer, and a
    // half-written range would be what it saved.
    if (next.checkIn && next.checkOut) {
      onApply(toYmd(next.checkIn), toYmd(next.checkOut));
      onClose();
    }
  };

  const formatDraftDate = (date: Date | null) =>
    date ? format(date, 'PP', { locale: dateLocale }) : t('sim_add_dates');

  const summaryClass = (isActive: boolean) =>
    `min-w-0 flex-1 rounded-xl border px-3 py-2 text-left ${isActive ? 'border-gray-900' : 'border-gray-200'}`;

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="animate-dialog-backdrop fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkin-date-sheet-title"
        onClick={(event) => event.stopPropagation()}
        className="animate-dialog-panel max-h-[92dvh] w-full max-w-md overflow-y-auto overflow-x-hidden rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl outline-none sm:rounded-3xl sm:pb-4"
      >
        {/* Grab handle: the sheet rises from the bottom edge on a phone, so it
            needs to read as something that can be dismissed. */}
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-200 sm:hidden" />

        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="checkin-date-sheet-title" className="text-sm font-bold text-gray-900">
            {draft.selecting === 'checkIn' || !draft.checkIn
              ? t('search_modal_pick_checkin')
              : t('search_modal_pick_checkout')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('book_close')}
            className="rounded-full p-1 text-gray-400 hover:bg-gray-50 hover:text-gray-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setDraft((current) => ({ ...current, selecting: 'checkIn' }))}
            className={summaryClass(draft.selecting === 'checkIn')}
          >
            <span className="block text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              {t('checkin_date_in')}
            </span>
            <span className="block truncate text-sm font-medium text-gray-900">{formatDraftDate(draft.checkIn)}</span>
          </button>
          <button
            type="button"
            onClick={() => setDraft((current) => ({ ...current, selecting: 'checkOut' }))}
            className={summaryClass(draft.selecting === 'checkOut')}
          >
            <span className="block text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              {t('checkin_date_out')}
            </span>
            <span className="block truncate text-sm font-medium text-gray-900">{formatDraftDate(draft.checkOut)}</span>
          </button>
        </div>

        {/* No isDateUnavailable: the check-in form knows nothing about the
            booking calendar, so every day here is pickable. */}
        <DateRangeCalendar
          selection={draft}
          onSelectDay={handleSelectDay}
          minDate={minDate}
          maxMonthsAhead={monthsAhead}
        />

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white"
        >
          {t('sim_done')}
        </button>
      </div>
    </div>
  );
};

export default CheckInDateSheet;
