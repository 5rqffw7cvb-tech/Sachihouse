
import React, { useState, useEffect, useMemo } from 'react';
import { PropertyData } from '../types';
import { isDateBlocked } from '../services/storage';
import { CalendarDays, ChevronLeft, ChevronRight, Info, Sparkles, Tag } from 'lucide-react';
import {
  format, addMonths, addDays, endOfMonth, eachDayOfInterval,
  isBefore, isSameDay, isWithinInterval, differenceInDays,
} from 'date-fns';
import BookingWidget from '../components/BookingWidget';
import { BookingDateSelection, applyDatePick } from '../utils/dateRange';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { getDateFnsLocale } from '../utils/translations';
import { readStayForPage } from '../utils/stayParams';

interface PricingPageProps {
  data: PropertyData;
}

const startOfDay = (date: Date): Date => {
  const newDate = new Date(date);
  newDate.setHours(0, 0, 0, 0);
  return newDate;
};

const startOfMonth = (date: Date): Date => {
  const newDate = new Date(date);
  newDate.setDate(1);
  newDate.setHours(0, 0, 0, 0);
  return newDate;
};

const PricingPage: React.FC<PricingPageProps> = ({ data }) => {
  const today = startOfDay(new Date());
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [searchParams] = useSearchParams();
  // Dates and party carried over from the listings search, if the guest came
  // from there.
  const [arrivingStay] = useState(() => readStayForPage(searchParams));
  // The page owns the stay dates so the big availability calendar and the
  // booking panel beside it are always showing the same selection.
  const [selection, setSelection] = useState<BookingDateSelection>(() => {
    if (arrivingStay.selection) return arrivingStay.selection;
    const start = startOfDay(new Date());
    return { checkIn: start, checkOut: addDays(start, 3), selecting: 'checkIn' };
  });
  const location = useLocation();
  const { t, language } = useLanguage();
  const dateLocale = getDateFnsLocale(language);
  const weekdayLabels = [t('weekday_sun'), t('weekday_mon'), t('weekday_tue'), t('weekday_wed'), t('weekday_thu'), t('weekday_fri'), t('weekday_sat')];

  // isDateBlocked reads a module-level cache, so a feed refresh has to be turned
  // into a render for newly taken nights to grey out on this calendar too.
  const [, setBlockedVersion] = useState(0);
  useEffect(() => {
    const handler = () => setBlockedVersion((n) => n + 1);
    window.addEventListener('ical-updated', handler);
    return () => window.removeEventListener('ical-updated', handler);
  }, []);

  // Scroll to hash on mount or hash change
  useEffect(() => {
    if (location.hash === '#rules') {
      const element = document.getElementById('rules');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [location]);

  const { checkIn, checkOut } = selection;
  const nights = checkIn && checkOut ? differenceInDays(checkOut, checkIn) : 0;
  const isAtEarliestMonth = !isBefore(startOfMonth(today), currentMonth);

  // Helper to render a single month of the availability calendar. Days here are
  // real controls: clicking one drives the booking panel's dates.
  const renderCalendar = (monthDate: Date) => {
    const start = startOfMonth(monthDate);
    const end = endOfMonth(monthDate);
    const days = eachDayOfInterval({ start, end });
    const padding = Array(start.getDay()).fill(null);

    return (
      <div>
        <h3 className="text-center font-bold text-gray-900 mb-4 text-base">{format(monthDate, 'MMMM yyyy', { locale: dateLocale })}</h3>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-gray-400 mb-2 uppercase tracking-wider">
          {weekdayLabels.map((d, i) => <div key={i}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {padding.map((_, i) => <div key={`pad-${i}`} />)}
          {days.map((day) => {
            const isPast = isBefore(day, today);
            const blocked = isDateBlocked(day);
            const isDisabled = isPast || blocked;
            const isStart = checkIn && isSameDay(day, checkIn);
            const isEnd = checkOut && isSameDay(day, checkOut);
            const inRange = checkIn && checkOut && isWithinInterval(day, { start: checkIn, end: checkOut });

            let dayClass = 'aspect-square flex items-center justify-center rounded-lg text-sm transition-all duration-150 ';
            if (isDisabled) {
              dayClass += 'bg-gray-50 text-gray-300 line-through decoration-gray-300 cursor-not-allowed';
            } else if (isStart || isEnd) {
              dayClass += 'bg-[var(--color-primary-600)] text-white font-bold shadow-sm';
            } else if (inRange) {
              dayClass += 'bg-[var(--color-primary-50)] text-[var(--color-primary-700)] font-semibold';
            } else {
              dayClass += 'text-gray-700 font-medium ring-1 ring-gray-100 hover:ring-[var(--color-primary-600)] hover:bg-[var(--color-primary-50)] cursor-pointer';
            }
            // Today stays findable even once it is part of the selected range.
            if (!isDisabled && isSameDay(day, today) && !isStart && !isEnd) {
              dayClass += ' ring-2 ring-gray-900/60';
            }

            return (
              <button
                type="button"
                key={day.toISOString()}
                disabled={isDisabled}
                onClick={() => setSelection(applyDatePick(selection, day))}
                className={dayClass}
              >
                {format(day, 'd')}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // Helper to find cleaning fee for a specific guest count
  const getCleaningFee = (guestCount: number) => {
      const tier = data.pricing.cleaning.find(c => guestCount >= c.minGuests && guestCount <= c.maxGuests);
      return tier ? tier.price : 0;
  };

  // Cheapest per-guest rate — used as the "from" price in the page header.
  const lowestRate = useMemo(
    () => data.pricing.rates.reduce((min, r) => Math.min(min, r.price), Infinity),
    [data.pricing.rates]
  );

  return (
    <>
      {/* Mobile: a dedicated, compact "Book Direct" screen — just the
          booking widget, positioned to be visible without scrolling. The
          rates table and availability calendar below are desktop-only;
          reachable there via the Book Direct nav item. */}
      <div className="lg:hidden px-3 pt-4 pb-4">
        <BookingWidget
          pricing={data.pricing}
          adminEmail={data.adminEmail}
          propertyId={data.id}
          directBooking={data.directBooking}
          selection={selection}
          onSelectionChange={setSelection}
          initialGuests={arrivingStay.guests}
          compact
        />
      </div>

      {/* Desktop: availability + rates on the left, a sticky booking panel on
          the right, all sharing one date selection. */}
      <div className="hidden lg:block bg-gray-50/60 min-h-[70vh]">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-10">
      <div className="mb-8">
        <h1 className="text-[28px] font-bold text-gray-900 leading-[1.25] mb-2">{data.titles.pricing}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-[16px] text-gray-500 leading-[1.6]">{data.titles.pricingSubtitle}</p>
          {Number.isFinite(lowestRate) && (
            <span className="text-sm font-semibold text-[var(--color-primary-700)] bg-[var(--color-primary-50)] px-3 py-1 rounded-full">
              {t('price_from_guest').replace('{price}', `¥${lowestRate.toLocaleString()}`)}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

          {/* Left Column: availability calendar, then the rate reference */}
          <div className="lg:col-span-7 xl:col-span-8 space-y-8">

            {/* Availability Section */}
            <div className="bg-white rounded-3xl border border-gray-100 shadow-xl shadow-gray-100/50 overflow-hidden">
                <div className="px-8 py-6 border-b border-gray-100 flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                            <CalendarDays className="w-5 h-5 text-[var(--color-primary-600)]" /> {t('price_avail')}
                        </h2>
                        <p className="text-gray-500 text-sm mt-1">{t('price_calendar_hint')}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <button
                            onClick={() => setCurrentMonth(addMonths(currentMonth, -1))}
                            disabled={isAtEarliestMonth}
                            aria-label={t('price_prev')}
                            className="p-2 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                            aria-label={t('price_next')}
                            className="p-2 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className="p-8 grid grid-cols-1 xl:grid-cols-2 gap-10">
                    {renderCalendar(currentMonth)}
                    {renderCalendar(addMonths(currentMonth, 1))}
                </div>

                <div className="px-8 py-4 bg-gray-50 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-4 text-xs font-medium text-gray-500">
                        <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded bg-white ring-1 ring-gray-200"></span> {t('price_available')}
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded bg-gray-100"></span> {t('price_blocked')}
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded bg-[var(--color-primary-600)]"></span> {t('sim_legend_selected')}
                        </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                        {checkIn && checkOut ? (
                            <span className="font-semibold text-gray-900">
                                {format(checkIn, 'MMM d', { locale: dateLocale })} – {format(checkOut, 'MMM d', { locale: dateLocale })}
                                <span className="text-gray-500 font-medium"> · {nights} {t('price_nights')}</span>
                            </span>
                        ) : (
                            <span className="text-gray-500">{t('sim_add_dates')}</span>
                        )}
                        <button
                            onClick={() => setSelection({ checkIn: null, checkOut: null, selecting: 'checkIn' })}
                            className="text-xs font-semibold text-gray-500 underline hover:text-gray-900"
                        >
                            {t('sim_clear_dates')}
                        </button>
                    </div>
                </div>
            </div>

            {/* Pricing Rules Section */}
            <div id="rules" className="bg-white rounded-3xl border border-gray-100 shadow-xl shadow-gray-100/50 overflow-hidden scroll-mt-24">
                <div className="px-8 py-6 border-b border-gray-100">
                    <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                        <Tag className="w-5 h-5 text-[var(--color-primary-600)]"/> {t('price_rates')}
                    </h2>
                    <p className="text-gray-500 text-sm mt-1">{t('price_rates_desc')}</p>
                </div>

                <div className="p-0">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-gray-500 font-medium uppercase text-xs">
                            <tr>
                                <th className="px-8 py-3">{t('price_table_guests')}</th>
                                <th className="px-8 py-3">{t('price_table_price_guest')}</th>
                                <th className="px-8 py-3 text-right">{t('price_table_cleaning')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {data.pricing.rates.map((rate, index) => (
                                <tr key={index} className="hover:bg-[var(--color-primary-50)]/40 transition-colors">
                                    <td className="px-8 py-3.5 font-medium text-gray-900">{rate.guests} {rate.guests > 1 ? t('price_guests') : t('price_guest')}</td>
                                    <td className="px-8 py-3.5 text-gray-600">¥{rate.price.toLocaleString()} {t('price_per_night')}</td>
                                    <td className="px-8 py-3.5 text-right text-gray-600">¥{getCleaningFee(rate.guests).toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="p-6 bg-gray-50 border-t border-gray-100 grid grid-cols-1 xl:grid-cols-2 gap-4">
                     <div className="flex items-start gap-3 p-3 bg-white rounded-xl border border-gray-100 shadow-sm">
                        <div className="p-2 bg-[var(--color-primary-50)] text-[var(--color-primary-600)] rounded-lg">
                            <Sparkles className="w-4 h-4" />
                        </div>
                        <div>
                            <span className="block font-bold text-gray-900 text-sm">{t('price_long_stay')}</span>
                            <span className="text-xs text-gray-500">
                                {t('price_long_stay_desc')
                                    .replace('{percent}', String(data.pricing.longStayDiscountPercent))
                                    .replace('{nights}', String(data.pricing.longStayMinNights))}
                            </span>
                        </div>
                     </div>
                     <div className="flex items-start gap-3 p-3 bg-white rounded-xl border border-gray-100 shadow-sm">
                        <div className="p-2 bg-[var(--color-primary-50)] text-[var(--color-primary-600)] rounded-lg">
                            <Info className="w-4 h-4" />
                        </div>
                        <div>
                            <span className="block font-bold text-gray-900 text-sm">{t('price_children_discount')}</span>
                            <span className="text-xs text-gray-500">
                                {t('price_children_discount_desc')
                                    .replace('{min}', String(data.pricing.childAgeMin))
                                    .replace('{max}', String(data.pricing.childAgeMax))
                                    .replace('{percent}', String(data.pricing.childDiscountPercent))}
                            </span>
                        </div>
                     </div>
                </div>
            </div>
          </div>

          {/* Right Column: the booking panel, sticky beside the calendar */}
          <div className="lg:col-span-5 xl:col-span-4">
              <BookingWidget
                  pricing={data.pricing}
                  adminEmail={data.adminEmail}
                  propertyId={data.id}
                  directBooking={data.directBooking}
                  selection={selection}
                  onSelectionChange={setSelection}
                  initialGuests={arrivingStay.guests}
              />
          </div>
      </div>
      </div>
      </div>
    </>
  );
};

export default PricingPage;
