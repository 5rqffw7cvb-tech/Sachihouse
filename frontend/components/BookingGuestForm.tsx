import React, { useState } from 'react';
import { format } from 'date-fns';
import { X, Lock, Loader2, AlertCircle, CalendarDays, Users } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { getDateFnsLocale } from '../utils/translations';
import { ApiError } from '../services/api';
import { createBooking } from '../services/booking';

interface BookingGuestFormProps {
  propertyId: string;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  adults: number;
  children: number;
  infants: number;
  estimatedTotal: number;
  // Days before check-in a cancellation still qualifies for a refund. Set per
  // property by the host; defaults to 7 when the property has not set one.
  freeCancellationDays?: number;
  onClose: () => void;
  // Raised when the requested nights were taken while the guest was deciding,
  // so the widget can send them back to the calendar.
  onDatesUnavailable: (conflictDates: string[]) => void;
}

const BookingGuestForm: React.FC<BookingGuestFormProps> = ({
  propertyId,
  checkIn,
  checkOut,
  nights,
  adults,
  children,
  infants,
  estimatedTotal,
  freeCancellationDays = 7,
  onClose,
  onDatesUnavailable,
}) => {
  const { t, language } = useLanguage();
  const dateLocale = getDateFnsLocale(language);

  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestEmailConfirm, setGuestEmailConfirm] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!guestName.trim()) {
      setError(t('book_err_name'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail.trim())) {
      setError(t('book_err_email'));
      return;
    }
    if (guestEmail.trim().toLowerCase() !== guestEmailConfirm.trim().toLowerCase()) {
      setError(t('book_err_email_mismatch'));
      return;
    }
    if (!consented) {
      setError(t('book_err_consent'));
      return;
    }

    setSubmitting(true);
    try {
      const result = await createBooking({
        propertyId,
        guestName: guestName.trim(),
        guestEmail: guestEmail.trim(),
        guestPhone: guestPhone.trim() || undefined,
        adults,
        children,
        infants,
        checkInDate: format(checkIn, 'yyyy-MM-dd'),
        checkOutDate: format(checkOut, 'yyyy-MM-dd'),
        locale: language,
      });

      // The token is the guest's only way back into this booking, and Stripe is
      // about to navigate away from the page. Persist it before leaving so a
      // guest who loses the confirmation email can still be helped.
      try {
        window.localStorage.setItem(`booking_token_${result.booking.id}`, result.guestToken);
      } catch {
        // A full or disabled storage must not block the payment.
      }

      window.location.href = result.checkoutUrl;
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError && err.status === 409) {
        const conflicts = (err.body as { conflictDates?: string[] })?.conflictDates ?? [];
        onDatesUnavailable(conflicts);
        return;
      }
      setError(err instanceof ApiError ? err.message : t('book_err_generic'));
    }
  };

  const inputClass = 'w-full border border-gray-300 rounded-lg px-4 py-3 text-base focus:outline-none '
    + 'focus:border-gray-900 focus:ring-1 focus:ring-gray-900 transition-colors';

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-form-title"
    >
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 id="booking-form-title" className="text-lg font-bold text-gray-900">{t('book_form_title')}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label={t('book_close')}
            className="p-2 -mr-2 text-gray-500 hover:text-gray-900 disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex items-center gap-2 text-gray-700">
              <CalendarDays className="w-4 h-4 text-gray-400 shrink-0" />
              <span>
                {format(checkIn, 'MMM dd, yyyy', { locale: dateLocale })}
                {' → '}
                {format(checkOut, 'MMM dd, yyyy', { locale: dateLocale })}
                {' · '}
                {nights} {t('book_nights')}
              </span>
            </div>
            <div className="flex items-center gap-2 text-gray-700">
              <Users className="w-4 h-4 text-gray-400 shrink-0" />
              <span>
                {adults} {t('sim_adults').toLowerCase()}
                {children > 0 ? `, ${children} ${t('sim_children').toLowerCase()}` : ''}
                {infants > 0 ? `, ${infants} ${t('sim_infants').toLowerCase()}` : ''}
              </span>
            </div>
            <div className="flex justify-between items-baseline pt-2 border-t border-gray-200 text-gray-900">
              <span className="font-bold">{t('book_total')}</span>
              <span className="font-bold text-xl">¥{estimatedTotal.toLocaleString()}</span>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="booking-name" className="block text-sm font-bold text-gray-700 mb-1.5">
                {t('book_guest_name')} <span className="text-red-500">*</span>
              </label>
              <input
                id="booking-name"
                type="text"
                autoComplete="name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                className={inputClass}
                disabled={submitting}
              />
            </div>

            <div>
              <label htmlFor="booking-email" className="block text-sm font-bold text-gray-700 mb-1.5">
                {t('book_guest_email')} <span className="text-red-500">*</span>
              </label>
              <input
                id="booking-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                className={inputClass}
                disabled={submitting}
              />
              <p className="text-xs text-gray-500 mt-1.5">{t('book_email_note')}</p>
            </div>

            <div>
              <label htmlFor="booking-email-confirm" className="block text-sm font-bold text-gray-700 mb-1.5">
                {t('book_guest_email_confirm')} <span className="text-red-500">*</span>
              </label>
              <input
                id="booking-email-confirm"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={guestEmailConfirm}
                onChange={(e) => setGuestEmailConfirm(e.target.value)}
                onPaste={(e) => e.preventDefault()}
                className={inputClass}
                disabled={submitting}
              />
              <p className="text-xs text-gray-500 mt-1.5">{t('book_email_confirm_note')}</p>
            </div>

            <div>
              <label htmlFor="booking-phone" className="block text-sm font-bold text-gray-700 mb-1.5">
                {t('book_guest_phone')} <span className="text-gray-400 font-normal">({t('book_optional')})</span>
              </label>
              <input
                id="booking-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                className={inputClass}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-4">
            <h3 className="text-sm font-bold text-gray-900 mb-2">{t('book_policy_title')}</h3>
            <ul className="text-xs text-gray-600 space-y-1 list-disc list-inside">
              <li>{t('book_policy_free').replace(/\{days\}/g, String(freeCancellationDays))}</li>
              <li>{t('book_policy_late').replace(/\{days\}/g, String(freeCancellationDays))}</li>
            </ul>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              disabled={submitting}
              className="mt-0.5 w-5 h-5 rounded border-gray-300 text-gray-900 focus:ring-gray-900 shrink-0"
            />
            <span className="text-sm text-gray-700">{t('book_consent')}</span>
          </label>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-[var(--color-primary-600)] hover:opacity-90 text-white font-bold text-base py-4 rounded-xl
                       shadow-lg shadow-black/10 transition-all flex items-center justify-center gap-2
                       disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {t('book_submitting')}
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                {t('book_submit')}
              </>
            )}
          </button>

          <p className="text-xs text-gray-400 text-center leading-relaxed">{t('book_secure_note')}</p>
        </form>
      </div>
    </div>
  );
};

export default BookingGuestForm;
