import React, { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { CalendarDays, X } from 'lucide-react';
import { BookingDateSelection, applyDatePick } from '../utils/dateRange';
import DateRangeCalendar from './DateRangeCalendar';
import { useLanguage } from '../contexts/LanguageContext';
import { getDateFnsLocale } from '../utils/translations';

// Local-date parse: `new Date('2026-08-16')` is UTC midnight, which lands on
// the 15th for anyone west of Greenwich.
const fromYmd = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  date.setHours(0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toYmd = (date: Date): string => date.toLocaleDateString('sv-SE');

interface DateRangeFieldProps {
  /** YYYY-MM-DD, or '' for unset. */
  checkIn: string;
  checkOut: string;
  onChange: (checkIn: string, checkOut: string) => void;
  /** Nights nothing can be booked on, greyed out in the calendar. */
  isDateUnavailable?: (day: Date) => boolean;
  /** Fired the first time the calendar opens, so availability can be fetched lazily. */
  onOpen?: () => void;
  /** Popover edge to line up with the trigger; right for controls near the viewport edge. */
  align?: 'left' | 'right';
  className?: string;
}

/**
 * A date range shown as one button that opens the shared calendar — the same
 * grid, rules and styling the search prompt uses. Replaces pairs of native
 * `<input type="date">`, which cannot show what is already booked and look
 * different in every browser.
 */
const DateRangeField: React.FC<DateRangeFieldProps> = ({
  checkIn,
  checkOut,
  onChange,
  isDateUnavailable,
  onOpen,
  align = 'left',
  className = '',
}) => {
  const { t, language } = useLanguage();
  const dateLocale = getDateFnsLocale(language);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // While the calendar is open the half-finished range lives here, so a
  // partial pick never escapes as a filter with only one end set.
  const [draft, setDraft] = useState<BookingDateSelection>(() => ({
    checkIn: fromYmd(checkIn),
    checkOut: fromYmd(checkOut),
    selecting: 'checkIn',
  }));

  // Re-sync when the value changes from outside (cleared filters, a restored
  // search) — but not mid-pick, which would fight the guest's clicks.
  useEffect(() => {
    if (open) return;
    setDraft({ checkIn: fromYmd(checkIn), checkOut: fromYmd(checkOut), selecting: 'checkIn' });
  }, [checkIn, checkOut, open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const label = draft.checkIn && draft.checkOut
    ? `${format(draft.checkIn, 'd MMM', { locale: dateLocale })} – ${format(draft.checkOut, 'd MMM', { locale: dateLocale })}`
    : t('sim_add_dates');

  const handleSelectDay = (day: Date) => {
    const next = applyDatePick(draft, day);
    setDraft(next);
    // Only publish a complete stay; a lone check-in is not a filter.
    if (next.checkIn && next.checkOut) {
      onChange(toYmd(next.checkIn), toYmd(next.checkOut));
      setOpen(false);
    }
  };

  const clear = () => {
    setDraft({ checkIn: null, checkOut: null, selecting: 'checkIn' });
    onChange('', '');
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          setOpen((value) => {
            if (!value) onOpen?.();
            return !value;
          });
        }}
        aria-expanded={open}
        className={`flex h-10 w-full items-center gap-2 rounded-lg border bg-white px-3 text-left text-[14px] transition-colors hover:border-[#a9adb5] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627] ${open ? 'border-[#041627]' : 'border-[#d7dae0]'} ${draft.checkIn && draft.checkOut ? 'text-[#1b1c1d]' : 'text-[#74777d]'}`}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-[#74777d]" />
        <span className="truncate">{label}</span>
      </button>

      {open && (
        <div
          className={`absolute top-[calc(100%+8px)] z-40 w-[320px] max-w-[calc(100vw-2rem)] rounded-2xl border border-[#e4e2e3] bg-white p-4 shadow-2xl ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#74777d]">
              {draft.selecting === 'checkIn' || !draft.checkIn
                ? t('search_modal_pick_checkin')
                : t('search_modal_pick_checkout')}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('sim_done')}
              className="rounded-full p-1 text-[#74777d] transition-colors hover:bg-[#efedef] hover:text-[#1b1c1d]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <DateRangeCalendar
            selection={draft}
            onSelectDay={handleSelectDay}
            isDateUnavailable={isDateUnavailable}
          />

          <div className="mt-3 flex items-center justify-between border-t border-[#e4e2e3] pt-3">
            <span className="flex items-center gap-1.5 text-[11px] text-[#74777d]">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-[#f5f3f4]">
                <X className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
              {t('search_modal_legend_full')}
            </span>
            <button
              type="button"
              onClick={clear}
              className="text-[12px] font-semibold text-[#63768a] underline hover:text-[#1b1c1d]"
            >
              {t('sim_clear_dates')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DateRangeField;
