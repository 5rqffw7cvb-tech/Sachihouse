import React, { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Baby, CalendarDays, ChevronDown, ChevronLeft, MapPin, Minus, Plus, Search, User, Users, X } from 'lucide-react';
import { BookingDateSelection, applyDatePick } from './BookingWidget';
import DateRangeCalendar from './DateRangeCalendar';
import { useLanguage } from '../contexts/LanguageContext';
import { getDateFnsLocale } from '../utils/translations';

export interface SearchModalLocation {
  countryCode: string;
  countryName: string;
  provinceCode: string;
  provinceName: string;
}

export interface SearchModalValues {
  countryCode: string;
  provinceCode: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
}

interface SearchBookingModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: SearchModalValues) => void;
  // Country/province pairs the site is configured to offer. Empty means the
  // location row is dropped entirely rather than shown with nothing to pick.
  allowedLocations: SearchModalLocation[];
  // Largest party any property can take; caps the guest steppers.
  maxGuests: number;
  // Nights nobody in the current area can host. A day only lands here once
  // every matching property is taken, so the guest is never blocked from a
  // date that some property could still serve.
  isDateUnavailable?: (day: Date) => boolean;
  // Region the unavailability above was computed for, so the calendar can be
  // recomputed when the guest narrows the area.
  onAreaChange?: (area: { countryCode: string; provinceCode: string }) => void;
  // Optional photo behind the title. Without one the header falls back to a
  // flat brand wash, which still reads as designed rather than broken.
  heroImageUrl?: string;
}

const startOfDay = (date: Date): Date => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const toYmd = (date: Date): string => date.toLocaleDateString('sv-SE');

// Which panel of the dialog is showing. Swapping the body rather than stacking
// popovers keeps the calendar and the guest steppers usable at phone width.
type ModalView = 'form' | 'calendar' | 'guests';

// One cell of the grouped search box: a caption above its value, with the whole
// cell acting as the click target.
const Cell: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  active?: boolean;
}> = ({ icon: Icon, label, children, onClick, className = '', active = false }) => {
  const body = (
    <>
      <span className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
        <Icon className="h-3.5 w-3.5" /> {label}
      </span>
      {children}
    </>
  );

  if (!onClick) {
    return <div className={`px-4 py-3 ${className}`}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full cursor-pointer px-4 py-3 text-left transition-colors hover:bg-subtle ${active ? 'bg-subtle' : ''} ${className}`}
    >
      {body}
    </button>
  );
};

const VALUE_TEXT = 'block truncate text-[15px] font-semibold text-ink';

// A labelled +/- stepper, used for both guest kinds.
const Stepper: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
  value: number;
  min: number;
  onChange: (next: number) => void;
  canIncrease: boolean;
}> = ({ icon: Icon, title, hint, value, min, onChange, canIncrease }) => (
  <div className="flex items-center justify-between gap-4 py-4">
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" />
      <div>
        <div className="text-[15px] font-bold text-ink">{title}</div>
        <div className="text-[12px] text-ink-muted">{hint}</div>
      </div>
    </div>
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label={`${title} −`}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-ink-soft transition-colors hover:border-brand hover:text-brand disabled:opacity-30 disabled:hover:border-line-strong disabled:hover:text-ink-soft"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="w-6 text-center text-[15px] font-bold text-ink">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={!canIncrease}
        aria-label={`${title} +`}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-ink-soft transition-colors hover:border-brand hover:text-brand disabled:opacity-30 disabled:hover:border-line-strong disabled:hover:text-ink-soft"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  </div>
);

const SearchBookingModal: React.FC<SearchBookingModalProps> = ({
  open,
  onClose,
  onSubmit,
  allowedLocations,
  maxGuests,
  isDateUnavailable,
  onAreaChange,
  heroImageUrl,
}) => {
  const { t, language } = useLanguage();
  const dateLocale = getDateFnsLocale(language);
  const dialogRef = useRef<HTMLDivElement>(null);

  const [view, setView] = useState<ModalView>('form');
  const [countryCode, setCountryCode] = useState('');
  const [provinceCode, setProvinceCode] = useState('');
  // Pre-filled with tonight so the guest can search in one tap; they only
  // touch the fields they actually want to change.
  const [selection, setSelection] = useState<BookingDateSelection>(() => {
    const today = startOfDay(new Date());
    return { checkIn: today, checkOut: addDays(today, 1), selecting: 'checkIn' };
  });
  // Split rather than one total because children are priced separately, and a
  // party of "4" costs differently depending on how many of them are kids.
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);

  const countryOptions = useMemo(
    () => Array.from(new Map(allowedLocations.map((location) => [location.countryCode, location])).values()),
    [allowedLocations],
  );
  const provinceOptions = allowedLocations.filter((location) => location.countryCode === countryCode);
  const hasLocationFilter = countryOptions.length > 0;

  const { checkIn, checkOut } = selection;
  const datesValid = !!checkIn && !!checkOut && checkIn < checkOut;
  const totalGuests = adults + children;

  // Tell the page which area to compute sold-out nights for.
  useEffect(() => {
    onAreaChange?.({ countryCode, provinceCode });
  }, [countryCode, provinceCode, onAreaChange]);

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

  const handleSubmit = () => {
    if (!datesValid) return;
    onSubmit({
      countryCode,
      provinceCode,
      checkIn: toYmd(checkIn!),
      checkOut: toYmd(checkOut!),
      adults,
      children,
    });
  };

  const formatDate = (date: Date | null) =>
    date ? format(date, 'EEE, d MMM', { locale: dateLocale }) : t('sim_add_dates');

  const guestSummary = [
    `${adults} ${adults === 1 ? t('search_modal_adult') : t('search_modal_adults')}`,
    children > 0 ? `${children} ${children === 1 ? t('search_modal_child') : t('search_modal_children')}` : '',
  ].filter(Boolean).join(', ');

  const openCalendar = (selecting: BookingDateSelection['selecting']) => {
    setSelection((current) => ({ ...current, selecting }));
    setView('calendar');
  };

  const headerTitle = view === 'calendar'
    ? (selection.selecting === 'checkIn' ? t('search_modal_pick_checkin') : t('search_modal_pick_checkout'))
    : view === 'guests'
      ? t('listing_guests')
      : t('search_modal_title');

  return (
    <div
      className="animate-dialog-backdrop fixed inset-0 z-[60] flex items-end justify-center bg-ink/60 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-modal-title"
        onClick={(event) => event.stopPropagation()}
        className="animate-dialog-panel relative max-h-full w-full max-w-md overflow-y-auto rounded-3xl bg-surface shadow-2xl outline-none"
      >
        {/* Header — photo, brand wash, title over the top of both. */}
        <div className="relative h-32 overflow-hidden sm:h-36">
          {heroImageUrl && (
            <img src={heroImageUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-brand via-brand/85 to-brand/45" />

          {view === 'form' ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('search_modal_skip')}
              className="absolute right-3 top-3 rounded-full bg-white/15 p-2 text-white backdrop-blur-sm transition-colors hover:bg-white/30"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setView('form')}
              aria-label={t('search_modal_back')}
              className="absolute left-3 top-3 rounded-full bg-white/15 p-2 text-white backdrop-blur-sm transition-colors hover:bg-white/30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}

          <div className="relative flex h-full flex-col justify-end p-6">
            <h2
              id="search-modal-title"
              className="font-['Plus_Jakarta_Sans'] text-[22px] font-bold leading-[1.2] text-white"
            >
              {headerTitle}
            </h2>
            {view === 'form' && (
              <p className="mt-1 text-[13px] leading-[1.5] text-white/80">{t('search_modal_subtitle')}</p>
            )}
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {view === 'form' && (
            <>
              {/* One grouped box rather than loose fields — it reads as a
                  single search bar, the way booking sites present this. */}
              <div className="divide-y divide-line overflow-hidden rounded-card border border-line-strong">
                {hasLocationFilter && (
                  <div className="grid grid-cols-2 divide-x divide-line">
                    <Cell icon={MapPin} label={t('listing_country')}>
                      <span className="relative block">
                        <select
                          aria-label={t('listing_country')}
                          value={countryCode}
                          onChange={(event) => {
                            setCountryCode(event.target.value.toUpperCase());
                            setProvinceCode('');
                          }}
                          className={`${VALUE_TEXT} w-full cursor-pointer appearance-none border-0 bg-transparent p-0 pr-6 focus:outline-none`}
                        >
                          <option value="">{t('listing_all_countries')}</option>
                          {countryOptions.map((country) => (
                            <option key={country.countryCode} value={country.countryCode}>{country.countryName}</option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                      </span>
                    </Cell>
                    <Cell icon={MapPin} label={t('listing_province')}>
                      <span className="relative block">
                        <select
                          aria-label={t('listing_province')}
                          value={provinceCode}
                          disabled={!countryCode}
                          onChange={(event) => setProvinceCode(event.target.value.toUpperCase())}
                          className={`${VALUE_TEXT} w-full cursor-pointer appearance-none border-0 bg-transparent p-0 pr-6 focus:outline-none disabled:text-ink-muted`}
                        >
                          <option value="">{t('listing_all_provinces')}</option>
                          {provinceOptions.map((province) => (
                            <option key={province.provinceCode} value={province.provinceCode}>{province.provinceName}</option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                      </span>
                    </Cell>
                  </div>
                )}

                <div className="grid grid-cols-2 divide-x divide-line">
                  <Cell
                    icon={CalendarDays}
                    label={t('listing_checkin')}
                    onClick={() => openCalendar('checkIn')}
                  >
                    <span className={VALUE_TEXT}>{formatDate(checkIn)}</span>
                  </Cell>
                  <Cell
                    icon={CalendarDays}
                    label={t('listing_checkout')}
                    onClick={() => openCalendar('checkOut')}
                  >
                    <span className={VALUE_TEXT}>{formatDate(checkOut)}</span>
                  </Cell>
                </div>

                <Cell icon={Users} label={t('listing_guests')} onClick={() => setView('guests')}>
                  <span className={VALUE_TEXT}>{guestSummary}</span>
                </Cell>
              </div>

              {!datesValid && (
                <p className="mt-3 text-[13px] text-danger">{t('search_modal_date_error')}</p>
              )}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={!datesValid}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-control bg-brand px-4 py-3.5 text-[15px] font-bold tracking-[0.02em] text-white transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Search className="h-4 w-4" />
                {t('search_modal_submit')}
              </button>

              <button
                type="button"
                onClick={onClose}
                className="mt-2 w-full rounded-control px-4 py-2.5 text-[13px] font-semibold text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
              >
                {t('search_modal_skip')}
              </button>
            </>
          )}

          {view === 'calendar' && (
            <>
              <DateRangeCalendar
                selection={selection}
                isDateUnavailable={isDateUnavailable}
                onSelectDay={(day) => {
                  const next = applyDatePick(selection, day);
                  setSelection(next);
                  // Back to the form as soon as the stay is complete; a
                  // half-picked range keeps the calendar open for the other end.
                  if (next.checkIn && next.checkOut) setView('form');
                }}
              />

              <div className="mt-4 flex items-center gap-4 border-t border-line pt-4 text-[12px] text-ink-muted">
                <span className="flex items-center gap-1.5">
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-subtle">
                    <X className="h-2.5 w-2.5" strokeWidth={3} />
                  </span>
                  {t('search_modal_legend_full')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3.5 w-3.5 rounded bg-brand" />
                  {t('sim_legend_selected')}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setView('form')}
                className="mt-4 w-full rounded-control bg-brand px-4 py-3 text-[15px] font-bold text-white transition-colors hover:bg-brand/90"
              >
                {t('sim_done')}
              </button>
            </>
          )}

          {view === 'guests' && (
            <>
              <div className="divide-y divide-line">
                <Stepper
                  icon={User}
                  title={t('search_modal_adults')}
                  hint={t('search_modal_adults_hint')}
                  value={adults}
                  min={1}
                  onChange={setAdults}
                  canIncrease={totalGuests < maxGuests}
                />
                <Stepper
                  icon={Baby}
                  title={t('search_modal_children')}
                  hint={t('search_modal_children_hint')}
                  value={children}
                  min={0}
                  onChange={setChildren}
                  canIncrease={totalGuests < maxGuests}
                />
              </div>

              <p className="mt-4 text-[12px] leading-[1.5] text-ink-muted">
                {t('search_modal_guests_note').replace('{max}', String(maxGuests))}
              </p>

              <button
                type="button"
                onClick={() => setView('form')}
                className="mt-4 w-full rounded-control bg-brand px-4 py-3 text-[15px] font-bold text-white transition-colors hover:bg-brand/90"
              >
                {t('sim_done')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchBookingModal;
