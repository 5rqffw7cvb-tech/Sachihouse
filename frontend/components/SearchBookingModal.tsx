import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, Search, Users, X } from 'lucide-react';
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
}

const addDaysYmd = (ymd: string, days: number): string => {
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('sv-SE');
};

const SearchBookingModal: React.FC<SearchBookingModalProps> = ({
  open,
  onClose,
  onSubmit,
  allowedLocations,
  guestOptions,
  todayYmd,
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

  const fieldClass = 'w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2.5 text-[15px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]';
  const labelClass = 'mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#44474c]';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 px-3 py-4 backdrop-blur-sm sm:items-center sm:px-4"
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
        className="relative w-full max-w-md max-h-full overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl outline-none sm:p-8"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('search_modal_skip')}
          className="absolute right-4 top-4 rounded-full p-2 text-[#63768a] transition-colors hover:bg-[#efedef] hover:text-[#1b1c1d]"
        >
          <X className="h-5 w-5" />
        </button>

        <h2
          id="search-modal-title"
          className="font-['Plus_Jakarta_Sans'] pr-10 text-[24px] font-bold uppercase leading-[1.2] tracking-[0.02em] text-[#041627]"
        >
          {t('search_modal_title')}
        </h2>
        <p className="mt-2 text-[14px] leading-[1.6] text-[#44474c]">{t('search_modal_subtitle')}</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {hasLocationFilter && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="search-modal-country" className={labelClass}>{t('listing_country')}</label>
                <select
                  id="search-modal-country"
                  value={countryCode}
                  onChange={(event) => {
                    setCountryCode(event.target.value.toUpperCase());
                    setProvinceCode('');
                  }}
                  className={fieldClass}
                >
                  <option value="">{t('listing_all_countries')}</option>
                  {countryOptions.map((country) => (
                    <option key={country.countryCode} value={country.countryCode}>{country.countryName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="search-modal-province" className={labelClass}>{t('listing_province')}</label>
                <select
                  id="search-modal-province"
                  value={provinceCode}
                  disabled={!countryCode}
                  onChange={(event) => setProvinceCode(event.target.value.toUpperCase())}
                  className={`${fieldClass} disabled:bg-[#f5f3f4] disabled:text-[#8a8d92]`}
                >
                  <option value="">{t('listing_all_provinces')}</option>
                  {provinceOptions.map((province) => (
                    <option key={province.provinceCode} value={province.provinceCode}>{province.provinceName}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div>
            <label htmlFor="search-modal-checkin" className={labelClass}>
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> {t('listing_checkin')}</span>
            </label>
            <input
              id="search-modal-checkin"
              type="date"
              value={checkIn}
              min={todayYmd}
              onChange={(event) => {
                const next = event.target.value;
                setCheckIn(next);
                // Keep the stay valid: a check-out that no longer sits after
                // check-in jumps to the following night.
                if (next && checkOut && checkOut <= next) {
                  setCheckOut(addDaysYmd(next, 1));
                }
              }}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="search-modal-checkout" className={labelClass}>
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> {t('listing_checkout')}</span>
            </label>
            <input
              id="search-modal-checkout"
              type="date"
              value={checkOut}
              min={checkIn ? addDaysYmd(checkIn, 1) : todayYmd}
              onChange={(event) => setCheckOut(event.target.value)}
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="search-modal-guests" className={labelClass}>
              <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> {t('listing_guests')}</span>
            </label>
            <select
              id="search-modal-guests"
              value={minGuests}
              onChange={(event) => setMinGuests(event.target.value)}
              className={fieldClass}
            >
              <option value="">{t('listing_any')}</option>
              {guestOptions.map((value) => (
                <option key={value} value={value}>{value}+ {t('listing_guests')}</option>
              ))}
            </select>
          </div>

          {!datesValid && (
            <p className="text-[13px] text-[#ba1a1a]">{t('search_modal_date_error')}</p>
          )}

          <button
            type="submit"
            disabled={!datesValid}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#041627] px-4 py-3.5 text-[15px] font-bold uppercase tracking-[0.04em] text-white transition-colors hover:bg-[#041627]/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Search className="h-4 w-4" />
            {t('search_modal_submit')}
          </button>
        </form>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-lg px-4 py-2 text-[13px] font-semibold text-[#63768a] transition-colors hover:bg-[#efedef] hover:text-[#1b1c1d]"
        >
          {t('search_modal_skip')}
        </button>
      </div>
    </div>
  );
};

export default SearchBookingModal;
