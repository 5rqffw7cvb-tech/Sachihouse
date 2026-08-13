import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { addMonths, eachDayOfInterval, endOfMonth, format, isBefore, isSameDay, isWithinInterval } from 'date-fns';
import { BookingDateSelection } from '../utils/dateRange';
import { useLanguage } from '../contexts/LanguageContext';
import { getDateFnsLocale } from '../utils/translations';

const startOfDay = (date: Date): Date => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const startOfMonth = (date: Date): Date => {
  const next = new Date(date);
  next.setDate(1);
  next.setHours(0, 0, 0, 0);
  return next;
};

interface DateRangeCalendarProps {
  selection: BookingDateSelection;
  /** Called with the clicked day; the caller decides what it does to the range. */
  onSelectDay: (day: Date) => void;
  /** Nights that cannot be booked at all, on top of the automatic past-date rule. */
  isDateUnavailable?: (day: Date) => boolean;
  /** How far ahead the month arrows may walk. */
  maxMonthsAhead?: number;
}

const DateRangeCalendar: React.FC<DateRangeCalendarProps> = ({
  selection,
  onSelectDay,
  isDateUnavailable,
  maxMonthsAhead = 12,
}) => {
  const { t, language } = useLanguage();
  const dateLocale = getDateFnsLocale(language);
  const today = startOfDay(new Date());
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selection.checkIn ?? new Date()));

  const { checkIn, checkOut } = selection;
  const weekdayLabels = [t('weekday_sun'), t('weekday_mon'), t('weekday_tue'), t('weekday_wed'), t('weekday_thu'), t('weekday_fri'), t('weekday_sat')];

  const firstMonth = startOfMonth(today);
  const lastMonth = startOfMonth(addMonths(today, maxMonthsAhead));
  const canGoBack = isBefore(firstMonth, viewMonth);
  const canGoForward = isBefore(viewMonth, lastMonth);

  const start = startOfMonth(viewMonth);
  const days = eachDayOfInterval({ start, end: endOfMonth(viewMonth) });
  const padding = Array(start.getDay()).fill(null);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setViewMonth(addMonths(viewMonth, -1))}
          disabled={!canGoBack}
          aria-label={t('price_prev')}
          className="rounded-full p-2 text-ink-soft transition-colors hover:bg-subtle disabled:opacity-25"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-['Plus_Jakarta_Sans'] text-[16px] font-bold text-ink">
          {format(viewMonth, 'MMMM yyyy', { locale: dateLocale })}
        </span>
        <button
          type="button"
          onClick={() => setViewMonth(addMonths(viewMonth, 1))}
          disabled={!canGoForward}
          aria-label={t('price_next')}
          className="rounded-full p-2 text-ink-soft transition-colors hover:bg-subtle disabled:opacity-25"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1 text-center">
        {weekdayLabels.map((label, index) => (
          <div
            key={label}
            className={`py-1 text-[11px] font-bold uppercase tracking-[0.04em] ${index === 0 || index === 6 ? 'text-danger/70' : 'text-ink-muted'}`}
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {padding.map((_, index) => <div key={`pad-${index}`} />)}
        {days.map((day) => {
          const isPast = isBefore(day, today);
          const isUnavailable = isDateUnavailable?.(day) ?? false;
          const isDisabled = isPast || isUnavailable;

          const isStart = !!checkIn && isSameDay(day, checkIn);
          const isEnd = !!checkOut && isSameDay(day, checkOut);
          const inRange = !!checkIn && !!checkOut && isWithinInterval(day, { start: checkIn, end: checkOut });
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;

          let cellClass = 'relative flex aspect-square flex-col items-center justify-center rounded-lg text-[14px] transition-colors ';
          if (isDisabled) {
            cellClass += 'cursor-not-allowed bg-subtle text-ink-muted/45';
          } else if (isStart || isEnd) {
            cellClass += 'bg-brand font-bold text-white';
          } else if (inRange) {
            cellClass += 'bg-brand/10 font-semibold text-brand';
          } else {
            cellClass += `cursor-pointer font-medium hover:bg-brand/10 ${isWeekend ? 'text-danger' : 'text-ink'}`;
          }
          // Today stays findable even inside a highlighted range.
          if (!isDisabled && !isStart && !isEnd && isSameDay(day, today)) {
            cellClass += ' ring-1 ring-inset ring-ink/30';
          }

          return (
            <button
              type="button"
              key={day.toISOString()}
              disabled={isDisabled}
              onClick={() => onSelectDay(day)}
              aria-label={format(day, 'PPP', { locale: dateLocale })}
              className={cellClass}
            >
              <span className={isUnavailable && !isPast ? 'leading-none' : ''}>{format(day, 'd')}</span>
              {/* Booked-out days carry the cross from the day grid rather than
                  relying on colour alone, which the strikethrough elsewhere in
                  the app does not survive at this size. */}
              {isUnavailable && !isPast && <X className="mt-0.5 h-3 w-3" strokeWidth={2.5} />}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default DateRangeCalendar;
