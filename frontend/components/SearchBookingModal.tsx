import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, MapPin, Search, Users, X } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

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
  minGuests: string;
}

interface SearchBookingModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: SearchModalValues) => void;
  // Country/province pairs the site is configured to offer. Empty means the
  // location row is dropped entirely rather than shown with nothing to pick.
  allowedLocations: SearchModalLocation[];
  guestOptions: number[];
  // Today as YYYY-MM-DD in the guest's own timezone, so `min` on the date
  // inputs matches the day they think it is.
  todayYmd: string;
  // Optional photo behind the title. Without one the header falls back to a
  // flat brand wash, which still reads as designed rather than broken.
  heroImageUrl?: string;
}

const addDaysYmd = (ymd: string, days: number): string => {
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('sv-SE');
};

// One cell of the grouped search box: a caption above its control, with the
// whole cell acting as the control's click target.
const Cell: React.FC<{
  htmlFor: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  className?: string;
}> = ({ htmlFor, icon: Icon, label, children, className = '' }) => (
  <label htmlFor={htmlFor} className={`block cursor-pointer px-4 py-3 transition-colors hover:bg-subtle ${className}`}>
    <span className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
      <Icon className="h-3.5 w-3.5" /> {label}
    </span>
    {children}
  </label>
);

// Native controls, stripped bare so the surrounding cell supplies the frame.
const BARE_CONTROL = 'w-full border-0 bg-transparent p-0 text-[15px] font-semibold text-ink focus:outline-none';

const BareSelect: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ children, ...rest }) => (
  <span className="relative block">
    <select {...rest} className={`${BARE_CONTROL} cursor-pointer appearance-none pr-6`}>
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
  </span>
);

const SearchBookingModal: React.FC<SearchBookingModalProps> = ({
  open,
  onClose,
  onSubmit,
  allowedLocations,
  guestOptions,
  todayYmd,
  heroImageUrl,
}) => {
  const { t } = useLanguage();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Pre-filled with tonight so the guest can search in one tap; they only
  // touch the fields they actually want to change.
  const [countryCode, setCountryCode] = useState('');
  const [provinceCode, setProvinceCode] = useState('');
  const [checkIn, setCheckIn] = useState(todayYmd);
  const [checkOut, setCheckOut] = useState(() => addDaysYmd(todayYmd, 1));
  const [minGuests, setMinGuests] = useState('2');

  const countryOptions = Array.from(
    new Map(allowedLocations.map((location) => [location.countryCode, location])).values(),
  );
  const provinceOptions = allowedLocations.filter((location) => location.countryCode === countryCode);
  const hasLocationFilter = countryOptions.length > 0;

  const datesValid = !!checkIn && !!checkOut && checkIn < checkOut;

  // Escape to dismiss, and keep the page behind from scrolling under the sheet.
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move focus into the dialog without opening a mobile keyboard or date
    // picker, which focusing the first input would do.
    dialogRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!datesValid) return;
    onSubmit({ countryCode, provinceCode, checkIn, checkOut, minGuests });
  };

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
        <div className="relative h-36 overflow-hidden sm:h-40">
          {heroImageUrl && (
            <img src={heroImageUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-brand via-brand/85 to-brand/45" />

          <button
            type="button"
            onClick={onClose}
            aria-label={t('search_modal_skip')}
            className="absolute right-3 top-3 rounded-full bg-white/15 p-2 text-white backdrop-blur-sm transition-colors hover:bg-white/30"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="relative flex h-full flex-col justify-end p-6">
            <h2
              id="search-modal-title"
              className="font-['Plus_Jakarta_Sans'] text-[24px] font-bold leading-[1.2] text-white"
            >
              {t('search_modal_title')}
            </h2>
            <p className="mt-1 text-[13px] leading-[1.5] text-white/80">{t('search_modal_subtitle')}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6">
          {/* One grouped box rather than four loose fields — it reads as a
              single search bar, the way booking sites present this. */}
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line-strong">
            {hasLocationFilter && (
              <div className="grid grid-cols-2 divide-x divide-line">
                <Cell htmlFor="search-modal-country" icon={MapPin} label={t('listing_country')}>
                  <BareSelect
                    id="search-modal-country"
                    value={countryCode}
                    onChange={(event) => {
                      setCountryCode(event.target.value.toUpperCase());
                      setProvinceCode('');
                    }}
                  >
                    <option value="">{t('listing_all_countries')}</option>
                    {countryOptions.map((country) => (
                      <option key={country.countryCode} value={country.countryCode}>{country.countryName}</option>
                    ))}
                  </BareSelect>
                </Cell>
                <Cell htmlFor="search-modal-province" icon={MapPin} label={t('listing_province')}>
                  <BareSelect
                    id="search-modal-province"
                    value={provinceCode}
                    disabled={!countryCode}
                    onChange={(event) => setProvinceCode(event.target.value.toUpperCase())}
                  >
                    <option value="">{t('listing_all_provinces')}</option>
                    {provinceOptions.map((province) => (
                      <option key={province.provinceCode} value={province.provinceCode}>{province.provinceName}</option>
                    ))}
                  </BareSelect>
                </Cell>
              </div>
            )}

            <div className="grid grid-cols-2 divide-x divide-line">
              <Cell htmlFor="search-modal-checkin" icon={CalendarDays} label={t('listing_checkin')}>
                <input
                  id="search-modal-checkin"
                  type="date"
                  value={checkIn}
                  min={todayYmd}
                  onChange={(event) => {
                    const next = event.target.value;
                    setCheckIn(next);
                    // Keep the stay valid: a check-out that no longer sits
                    // after check-in jumps to the following night.
                    if (next && checkOut && checkOut <= next) {
                      setCheckOut(addDaysYmd(next, 1));
                    }
                  }}
                  className={BARE_CONTROL}
                />
              </Cell>
              <Cell htmlFor="search-modal-checkout" icon={CalendarDays} label={t('listing_checkout')}>
                <input
                  id="search-modal-checkout"
                  type="date"
                  value={checkOut}
                  min={checkIn ? addDaysYmd(checkIn, 1) : todayYmd}
                  onChange={(event) => setCheckOut(event.target.value)}
                  className={BARE_CONTROL}
                />
              </Cell>
            </div>

            <Cell htmlFor="search-modal-guests" icon={Users} label={t('listing_guests')}>
              <BareSelect
                id="search-modal-guests"
                value={minGuests}
                onChange={(event) => setMinGuests(event.target.value)}
              >
                <option value="">{t('listing_any')}</option>
                {guestOptions.map((value) => (
                  <option key={value} value={value}>{value}+ {t('listing_guests')}</option>
                ))}
              </BareSelect>
            </Cell>
          </div>

          {!datesValid && (
            <p className="mt-3 text-[13px] text-danger">{t('search_modal_date_error')}</p>
          )}

          <button
            type="submit"
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
        </form>
      </div>
    </div>
  );
};

export default SearchBookingModal;
