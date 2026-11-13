import React, { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { AlertCircle, CalendarDays, ChevronDown, ChevronLeft, MapPin, Minus, Plus, Search, X } from 'lucide-react';
import { BookingDateSelection, applyDatePick } from '../utils/dateRange';
import DateRangeCalendar from './DateRangeCalendar';
import { useLanguage } from '../contexts/LanguageContext';
import { getDateFnsLocale } from '../utils/translations';
import { RememberedSearch } from '../utils/searchMemory';

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
  infants: number;
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
  // A search the guest made minutes ago, so they are not made to re-enter it.
  initialSearch?: RememberedSearch | null;
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

// Local-date parse: `new Date('2026-08-16')` is UTC midnight, a day early for
// anyone west of Greenwich.
const fromYmd = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Which panel of the dialog is showing. Only the calendar earns one: it needs
// the whole width, while everything else answers in place.
type ModalView = 'form' | 'calendar';

// One visible focus treatment for every control in the dialog. It only shows
// for keyboard focus, so a tap does not leave a ring behind.
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

// Round icon button for the header. 44px hit area on touch screens (Apple HIG),
// 36px under a pointer, where the 24px WCAG minimum is met comfortably.
const ICON_BUTTON = `flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-subtle hover:text-ink active:bg-line sm:h-9 sm:w-9 ${FOCUS_RING}`;

// One cell of the grouped search box: a caption above its value, with the whole
// cell acting as the click target.
const Cell: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}> = ({ icon: Icon, label, children, onClick, className = '' }) => {
  const body = (
    <>
      <span className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
      </span>
      {children}
    </>
  );

  if (!onClick) {
    // Holds a native select. The ring is drawn on the cell, since the select
    // itself is borderless and a ring hugging its text would look stray.
    return (
      <div className={`min-h-[64px] px-4 py-3 transition-colors hover:bg-subtle has-[select:focus-visible]:bg-subtle has-[select:focus-visible]:ring-2 has-[select:focus-visible]:ring-inset has-[select:focus-visible]:ring-brand ${className}`}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`block min-h-[64px] w-full cursor-pointer px-4 py-3 text-left transition-colors hover:bg-subtle active:bg-line/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand ${className}`}
    >
      {body}
    </button>
  );
};

const VALUE_TEXT = 'block truncate text-[15px] font-semibold text-ink';

// 44px on touch, 36px under a pointer — same reasoning as ICON_BUTTON.
const STEPPER_BUTTON = `flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-surface text-ink-soft transition-colors hover:border-ink hover:text-ink active:bg-subtle disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-strong disabled:hover:text-ink-soft sm:h-9 sm:w-9 ${FOCUS_RING}`;

// A guest row: title, the rule that applies to it, and a round -/+ pair. Laid
// out to match the booking widget on each property page, so the control a guest
// meets here is the same one they meet at the point of booking. Padded to line
// up with the cells above it, since it now sits in the same box.
const GuestRow: React.FC<{
  title: string;
  hint: string;
  value: number;
  min: number;
  onChange: (next: number) => void;
  canIncrease: boolean;
}> = ({ title, hint, value, min, onChange, canIncrease }) => (
  <div className="flex items-center justify-between gap-4 px-4 py-3">
    <div className="min-w-0">
      <div className="text-[15px] font-semibold text-ink">{title}</div>
      <div className="text-[12px] leading-[1.45] text-ink-muted">{hint}</div>
    </div>
    <div className="flex shrink-0 items-center gap-2 sm:gap-3">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label={`${title} −`}
        className={STEPPER_BUTTON}
      >
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      {/* Announced on change, so a screen reader hears the new count after
          −/+ without focus having to move. */}
      <span aria-live="polite" className="w-6 text-center text-[16px] font-semibold tabular-nums text-ink">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={!canIncrease}
        aria-label={`${title} +`}
        className={STEPPER_BUTTON}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
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
  initialSearch,
}) => {
  const { t, language } = useLanguage();
  const dateLocale = getDateFnsLocale(language);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [view, setView] = useState<ModalView>('form');
  // Start in the area the site actually operates in rather than "everywhere":
  // with one configured location that choice is not a question, and with
  // several the first is still a better opening bid than none. A remembered
  // search wins, including its explicit "all countries" (an empty string is a
  // real answer here, so ?? and not ||).
  const [countryCode, setCountryCode] = useState(
    initialSearch?.countryCode ?? allowedLocations[0]?.countryCode ?? '',
  );
  const [provinceCode, setProvinceCode] = useState(
    initialSearch?.provinceCode ?? allowedLocations[0]?.provinceCode ?? '',
  );
  // Falls back to tonight so the guest can search in one tap; they only touch
  // the fields they actually want to change.
  const [selection, setSelection] = useState<BookingDateSelection>(() => {
    const today = startOfDay(new Date());
    const remembered = initialSearch ? fromYmd(initialSearch.checkIn) : null;
    const rememberedOut = initialSearch ? fromYmd(initialSearch.checkOut) : null;
    // A remembered stay that has since started is no use; fall back to tonight.
    if (remembered && rememberedOut && remembered >= today) {
      return { checkIn: remembered, checkOut: rememberedOut, selecting: 'checkIn' };
    }
    return { checkIn: today, checkOut: addDays(today, 1), selecting: 'checkIn' };
  });
  // Split rather than one total because children are priced separately, and a
  // party of "4" costs differently depending on how many of them are kids.
  const [adults, setAdults] = useState(initialSearch?.adults ?? 2);
  const [children, setChildren] = useState(initialSearch?.children ?? 0);
  // Free, and outside the paying tiers — mirrors how the booking widget counts
  // them, so the party carried to the property page needs no translation.
  const [infants, setInfants] = useState(initialSearch?.infants ?? 0);

  const countryOptions = useMemo(
    () => Array.from(new Map(allowedLocations.map((location) => [location.countryCode, location])).values()),
    [allowedLocations],
  );
  const provinceOptions = allowedLocations.filter((location) => location.countryCode === countryCode);
  // One configured location is not a choice — it is a fact about the site, and
  // belongs under the title rather than behind two dropdowns whose only other
  // option is "all". Two or more and the dropdowns come back.
  const soleLocation = allowedLocations.length === 1 ? allowedLocations[0] : null;
  const hasLocationChoice = allowedLocations.length > 1;
  // With no dropdowns on screen the area is not the guest's to choose, so it is
  // read off the configuration rather than off state a stale remembered search
  // could have emptied. Where there is a choice, an empty code means the guest
  // asked for everywhere and must be left alone.
  const areaCountryCode = hasLocationChoice ? countryCode : soleLocation?.countryCode ?? '';
  const areaProvinceCode = hasLocationChoice ? provinceCode : soleLocation?.provinceCode ?? '';

  const { checkIn, checkOut } = selection;
  const datesValid = !!checkIn && !!checkOut && checkIn < checkOut;
  // Infants sit outside the paying tiers, so they do not consume capacity.
  const payingGuests = adults + children;

  // Tell the page which area to compute sold-out nights for.
  useEffect(() => {
    onAreaChange?.({ countryCode: areaCountryCode, provinceCode: areaProvinceCode });
  }, [areaCountryCode, areaProvinceCode, onAreaChange]);

  // Reopening always lands on the form. The dialog stays mounted between
  // openings — which is what keeps the guest's answers — so without this,
  // dismissing it from the calendar would bring it back to the calendar.
  // Keyed on `open` alone: the effect below re-runs on every parent render,
  // and resetting the view from there would eject a guest mid-pick.
  useEffect(() => {
    if (open) setView('form');
  }, [open]);

  // Escape to dismiss, Tab kept inside the dialog, and the page behind held
  // still. Focus goes back to whatever had it before, so a keyboard user who
  // reopened the prompt from the search bar lands back on that bar.
  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
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
      // Only hand focus back if the element is still on the page.
      if (previouslyFocused && previouslyFocused !== document.body && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
    // Keyed on `open` alone. The parent hands over a fresh onClose on every
    // render, and re-running this would yank focus back to the dialog in the
    // middle of a guest using the steppers, and lose the element to return to.
  }, [open]);

  if (!open) return null;

  const handleSubmit = () => {
    if (!datesValid) return;
    onSubmit({
      countryCode: areaCountryCode,
      provinceCode: areaProvinceCode,
      checkIn: toYmd(checkIn!),
      checkOut: toYmd(checkOut!),
      adults,
      children,
      infants,
    });
  };

  const formatDate = (date: Date | null) =>
    date ? format(date, 'EEE, d MMM', { locale: dateLocale }) : t('sim_add_dates');

  const openCalendar = (selecting: BookingDateSelection['selecting']) => {
    setSelection((current) => ({ ...current, selecting }));
    setView('calendar');
  };

  const nights = datesValid
    ? Math.round((checkOut!.getTime() - checkIn!.getTime()) / 86_400_000)
    : 0;

  const headerTitle = view === 'calendar'
    ? (selection.selecting === 'checkIn' ? t('search_modal_pick_checkin') : t('search_modal_pick_checkout'))
    : t('search_modal_title');

  return (
    <div
      className="animate-dialog-backdrop fixed inset-0 z-[60] flex items-end justify-center bg-ink/60 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      {/* A bottom sheet on phones (thumb reach, and it reads as dismissible),
          a centred card from the small breakpoint up. The body scrolls on its
          own between a fixed header and footer, so the search button never
          drops out of view however many rows the form grows. */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="search-modal-title"
        aria-describedby={view === 'form' ? 'search-modal-subtitle' : undefined}
        onClick={(event) => event.stopPropagation()}
        className="animate-dialog-panel relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-surface shadow-2xl outline-none sm:max-h-[min(720px,90dvh)] sm:rounded-3xl"
      >
        {/* Grabber: says "sheet over the page", not "new page". Decorative —
            dismissal is the close button, the backdrop and Escape. */}
        <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-line-strong" />
        </div>

        {/* Header. The photo that used to fill 140px here was decoration in a
            dialog whose whole job is to take three answers and get out of the
            way — on a phone it pushed the search button below the fold. */}
        <div className="flex items-start gap-2 px-5 pt-3 sm:px-6 sm:pt-5">
          {view === 'calendar' && (
            <button
              type="button"
              onClick={() => setView('form')}
              aria-label={t('search_modal_back')}
              className={`-ml-2 ${ICON_BUTTON}`}
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          )}

          <div className="min-w-0 flex-1 py-1.5 sm:py-1">
            <h2
              id="search-modal-title"
              className="font-['Plus_Jakarta_Sans'] text-[20px] font-bold leading-[1.25] tracking-[-0.01em] text-ink"
            >
              {headerTitle}
            </h2>
            {view === 'form' && (
              <p id="search-modal-subtitle" className="mt-1 flex items-start gap-1.5 text-[13px] leading-[1.5] text-ink-muted">
                {soleLocation && <MapPin className="mt-[3px] h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />}
                <span>
                  {soleLocation
                    ? `${soleLocation.provinceName}, ${soleLocation.countryName}`
                    : t('search_modal_subtitle')}
                </span>
              </p>
            )}
          </div>

          {/* On both panels: the calendar is still the same dialog, and
              leaving it should not take two steps. */}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('search_modal_skip')}
            className={`-mr-2 ${ICON_BUTTON}`}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-4 sm:px-6">
          {view === 'form' && (
            <>
              {/* One grouped box rather than loose fields — it reads as a
                  single search bar, the way booking sites present this. */}
              <div className="divide-y divide-line overflow-hidden rounded-card border border-line-strong">
                {hasLocationChoice && (
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
                        <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
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
                        <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
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
                    {/* Length of stay: the number a guest checks a range
                        against, without counting days in their head. */}
                    {nights > 0 && (
                      <span className="mt-0.5 block text-[12px] font-medium tabular-nums text-ink-muted">
                        {nights} {t('book_nights')}
                      </span>
                    )}
                  </Cell>
                </div>

                {/* Inline rather than behind a sub-view: two taps to say "3
                    adults" was a page transition each way for a number the
                    guest can set right here. */}
                <GuestRow
                  title={t('sim_adults')}
                  hint={t('search_modal_adults_hint')}
                  value={adults}
                  min={1}
                  onChange={setAdults}
                  canIncrease={payingGuests < maxGuests}
                />
                <GuestRow
                  title={t('sim_children')}
                  hint={t('search_modal_children_hint')}
                  value={children}
                  min={0}
                  onChange={setChildren}
                  canIncrease={payingGuests < maxGuests}
                />
                <GuestRow
                  title={t('sim_infants')}
                  hint={t('search_modal_infants_hint')}
                  value={infants}
                  min={0}
                  onChange={setInfants}
                  canIncrease={infants < 3}
                />
              </div>

              {/* Only once the guest is actually stopped by it — a standing
                  note about capacity is noise until the + stops responding. */}
              {payingGuests >= maxGuests && (
                <p className="mt-2 text-[12px] leading-[1.5] text-ink-muted">
                  {t('search_modal_guests_note').replace('{max}', String(maxGuests))}
                </p>
              )}

              {/* Icon as well as colour, so the warning does not depend on
                  telling red from grey. */}
              {!datesValid && (
                <p role="alert" className="mt-3 flex items-start gap-1.5 text-[13px] leading-[1.5] text-danger">
                  <AlertCircle className="mt-[2px] h-4 w-4 shrink-0" aria-hidden="true" />
                  {t('search_modal_date_error')}
                </p>
              )}
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

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3 text-[12px] text-ink-muted">
                <span className="flex items-center gap-1.5">
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-subtle" aria-hidden="true">
                    <X className="h-2.5 w-2.5" strokeWidth={3} />
                  </span>
                  {t('search_modal_legend_full')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3.5 w-3.5 rounded bg-brand" aria-hidden="true" />
                  {t('sim_legend_selected')}
                </span>
                {/* Half a range narrows the calendar to the nights that stay
                    reachable, so there has to be a way back out of it — the
                    other three calendars have carried this button all along. */}
                <button
                  type="button"
                  onClick={() => setSelection({ checkIn: null, checkOut: null, selecting: 'checkIn' })}
                  className={`ml-auto min-h-[36px] cursor-pointer rounded-control px-2 font-semibold underline underline-offset-2 transition-colors hover:text-ink ${FOCUS_RING}`}
                >
                  {t('sim_clear_dates')}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer: the one primary action, always in reach. Clears the home
            indicator on phones that have one. */}
        <div className="border-t border-line bg-surface px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-4">
          {view === 'form' ? (
            <>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!datesValid}
                className={`flex min-h-[48px] w-full cursor-pointer items-center justify-center gap-2 rounded-control bg-brand px-4 py-3 text-[15px] font-bold tracking-[0.01em] text-white shadow-sm transition-[background-color,transform] duration-150 hover:bg-brand/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${FOCUS_RING}`}
              >
                <Search className="h-4 w-4 text-accent-soft" aria-hidden="true" />
                {t('search_modal_submit')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className={`mt-1 min-h-[44px] w-full cursor-pointer rounded-control px-4 py-2 text-[13px] font-semibold text-ink-soft underline-offset-2 transition-colors hover:text-ink hover:underline ${FOCUS_RING}`}
              >
                {t('search_modal_skip')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setView('form')}
              className={`min-h-[48px] w-full cursor-pointer rounded-control bg-brand px-4 py-3 text-[15px] font-bold text-white transition-[background-color,transform] duration-150 hover:bg-brand/90 active:scale-[0.98] ${FOCUS_RING}`}
            >
              {t('sim_done')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchBookingModal;
