import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { CheckCircle2, Loader2, AlertCircle, XCircle, CalendarDays, Users, Home, Download } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { getDateFnsLocale } from '../utils/translations';
import {
  BOOKING_POLL_INTERVAL_MS,
  BOOKING_POLL_TIMEOUT_MS,
  MAX_GUEST_EMAIL_UPDATES,
  GuestBooking,
  cancelBooking,
  getBooking,
  getBookingConfirmationForPdf,
  updateBookingEmail,
} from '../services/booking';
import { downloadBookingConfirmationPdf } from '../utils/bookingConfirmPdf';
import { ApiError } from '../services/api';

type Phase = 'loading' | 'waiting' | 'ready' | 'timeout' | 'error';

const BookingResultPage: React.FC = () => {
  const { t, language } = useLanguage();
  const dateLocale = getDateFnsLocale(language);
  const [searchParams] = useSearchParams();

  const bookingId = searchParams.get('id') ?? '';
  // The token normally arrives in the return URL. Falling back to what the
  // booking form stored keeps the page usable if the guest trims the URL or
  // opens it again later from history.
  const token = searchParams.get('token')
    ?? (bookingId ? window.localStorage.getItem(`booking_token_${bookingId}`) : null)
    ?? '';

  const [booking, setBooking] = useState<GuestBooking | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [showEmailEdit, setShowEmailEdit] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailUpdating, setEmailUpdating] = useState(false);
  const [emailUpdateError, setEmailUpdateError] = useState<string | null>(null);
  const [emailUpdated, setEmailUpdated] = useState(false);
  const [pdfDownloading, setPdfDownloading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const startedAt = useRef(Date.now());
  const autoDownloadedRef = useRef(false);
  // Present when the guest arrived via the confirmation email's "Download PDF"
  // button, so the download can fire on its own once the booking has loaded —
  // the button below still works as a manual fallback either way.
  const autoDownloadPdf = searchParams.get('downloadPdf') === '1';

  const load = useCallback(async () => {
    if (!bookingId || !token) {
      setPhase('error');
      setError(t('result_err_link'));
      return;
    }
    try {
      const next = await getBooking(bookingId, token);
      setBooking(next);
      // Payment succeeds before Stripe's webhook reaches us, so a hold that is
      // still pending is expected for a moment rather than a failure.
      if (next.status === 'pending_payment') {
        setPhase(Date.now() - startedAt.current > BOOKING_POLL_TIMEOUT_MS ? 'timeout' : 'waiting');
      } else {
        setPhase('ready');
      }
    } catch (err) {
      setPhase('error');
      setError(err instanceof ApiError && err.status === 404 ? t('result_err_link') : t('result_err_generic'));
    }
  }, [bookingId, token, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (phase !== 'waiting') {
      return;
    }
    const timer = window.setTimeout(load, BOOKING_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [phase, booking, load]);

  const handleCancel = async () => {
    if (!booking || !window.confirm(t('manage_cancel_confirm'))) {
      return;
    }
    setCancelling(true);
    setCancelError(null);
    try {
      const result = await cancelBooking(booking.id, token);
      setBooking(result.booking);
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : t('result_err_generic'));
    } finally {
      setCancelling(false);
    }
  };

  const handleEmailUpdate = async () => {
    if (!booking) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      setEmailUpdateError(t('book_err_email'));
      return;
    }
    setEmailUpdating(true);
    setEmailUpdateError(null);
    try {
      const result = await updateBookingEmail(booking.id, token, newEmail.trim());
      setBooking(result.booking);
      setEmailUpdated(true);
      setShowEmailEdit(false);
      setNewEmail('');
    } catch (err) {
      setEmailUpdateError(err instanceof ApiError ? err.message : t('result_err_generic'));
    } finally {
      setEmailUpdating(false);
    }
  };

  const handleDownloadPdf = useCallback(async () => {
    if (!booking) return;
    setPdfDownloading(true);
    setPdfError(null);
    try {
      const confirmation = await getBookingConfirmationForPdf(booking.id, token);
      await downloadBookingConfirmationPdf(confirmation);
    } catch (err) {
      setPdfError(err instanceof ApiError ? err.message : t('result_err_generic'));
    } finally {
      setPdfDownloading(false);
    }
  }, [booking, token, t]);

  useEffect(() => {
    if (autoDownloadPdf && phase === 'ready' && booking?.status === 'confirmed' && !autoDownloadedRef.current) {
      autoDownloadedRef.current = true;
      void handleDownloadPdf();
    }
  }, [autoDownloadPdf, phase, booking, handleDownloadPdf]);

  const formatDate = (iso: string) => format(parseISO(iso), 'MMM dd, yyyy', { locale: dateLocale });

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-[#e8e5e6] py-10 px-4">
      <div className="max-w-xl mx-auto bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
        {children}
      </div>
    </div>
  );

  if (phase === 'loading' || phase === 'waiting') {
    return shell(
      <div className="p-10 text-center">
        <Loader2 className="w-10 h-10 animate-spin text-[var(--color-primary-600)] mx-auto mb-5" />
        <h1 className="text-xl font-bold text-gray-900 mb-2">{t('result_checking_title')}</h1>
        <p className="text-gray-600 text-sm leading-relaxed">{t('result_checking_body')}</p>
      </div>,
    );
  }

  if (phase === 'error') {
    return shell(
      <div className="p-10 text-center">
        <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-5" />
        <h1 className="text-xl font-bold text-gray-900 mb-2">{t('result_err_title')}</h1>
        <p className="text-gray-600 text-sm mb-6">{error}</p>
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--color-primary-600)] hover:underline">
          <Home className="w-4 h-4" /> {t('result_back_home')}
        </Link>
      </div>,
    );
  }

  // `timeout` means the payment probably went through but the confirmation has
  // not reached us yet. It is deliberately not phrased as a failure — telling a
  // guest who just paid that something failed is worse than asking them to wait.
  if (phase === 'timeout' || !booking) {
    return shell(
      <div className="p-10 text-center">
        <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-5" />
        <h1 className="text-xl font-bold text-gray-900 mb-2">{t('result_slow_title')}</h1>
        <p className="text-gray-600 text-sm mb-6 leading-relaxed">{t('result_slow_body')}</p>
        <button
          onClick={() => { startedAt.current = Date.now(); setPhase('loading'); load(); }}
          className="px-5 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-bold hover:bg-gray-800"
        >
          {t('result_retry')}
        </button>
      </div>,
    );
  }

  const isCancelled = booking.status === 'cancelled_by_guest' || booking.status === 'cancelled_by_host';
  const isConfirmed = booking.status === 'confirmed';

  const header = isConfirmed
    ? { icon: <CheckCircle2 className="w-10 h-10 text-green-600" />, title: t('result_confirmed_title'), body: t('result_confirmed_body') }
    : isCancelled
      ? { icon: <XCircle className="w-10 h-10 text-gray-400" />, title: t('result_cancelled_title'), body: t('result_cancelled_body') }
      : { icon: <AlertCircle className="w-10 h-10 text-red-500" />, title: t('result_failed_title'), body: t('result_failed_body') };

  return shell(
    <>
      <div className="p-8 text-center border-b border-gray-100">
        <div className="flex justify-center mb-4">{header.icon}</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{header.title}</h1>
        <p className="text-gray-600 text-sm leading-relaxed">{header.body}</p>
        {booking.confirmationNo && (
          <div className="mt-5 inline-block bg-gray-50 border border-gray-200 rounded-xl px-5 py-3">
            <div className="text-[11px] uppercase font-bold text-gray-500 tracking-wider mb-1">
              {t('result_confirmation_no')}
            </div>
            <div className="font-mono font-bold text-lg text-gray-900">{booking.confirmationNo}</div>
          </div>
        )}

        {isConfirmed && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => void handleDownloadPdf()}
              disabled={pdfDownloading}
              className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-60 transition-colors"
            >
              {pdfDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {t('result_download_pdf')}
            </button>
            {pdfError && <p className="mt-2 text-xs text-red-600">{pdfError}</p>}
          </div>
        )}

        {isConfirmed && (
          <div className="mt-5 text-sm text-gray-600">
            {emailUpdated ? (
              <p className="text-green-700 font-medium">{t('result_email_updated')}: {booking.guestEmail}</p>
            ) : (
              <p>{t('result_sent_to')}: <span className="font-semibold text-gray-900">{booking.guestEmail}</span></p>
            )}

            {!showEmailEdit && booking.emailUpdateCount < MAX_GUEST_EMAIL_UPDATES && (
              <button
                type="button"
                onClick={() => { setShowEmailEdit(true); setNewEmail(booking.guestEmail); }}
                className="mt-1 text-xs font-semibold text-[var(--color-primary-600)] hover:underline"
              >
                {t('result_wrong_email')}
              </button>
            )}
            {booking.emailUpdateCount >= MAX_GUEST_EMAIL_UPDATES && !showEmailEdit && (
              <p className="mt-1 text-xs text-gray-400">{t('result_email_limit_reached')}</p>
            )}

            {showEmailEdit && (
              <div className="mt-3 text-left bg-gray-50 border border-gray-200 rounded-xl p-4">
                <label htmlFor="result-new-email" className="block text-xs font-bold text-gray-700 mb-1.5">
                  {t('result_wrong_email')}
                </label>
                <input
                  id="result-new-email"
                  type="email"
                  inputMode="email"
                  value={newEmail}
                  onChange={(e) => { setNewEmail(e.target.value); setEmailUpdateError(null); }}
                  disabled={emailUpdating}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                />
                <p className="mt-1.5 text-[11px] text-gray-400">
                  {t('result_email_attempts_left')}: {Math.max(0, MAX_GUEST_EMAIL_UPDATES - booking.emailUpdateCount)}
                </p>
                {emailUpdateError && <p className="mt-1.5 text-xs text-red-600">{emailUpdateError}</p>}
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleEmailUpdate()}
                    disabled={emailUpdating}
                    className="flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-xs font-bold text-white hover:bg-gray-800 disabled:opacity-60"
                  >
                    {emailUpdating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {t('result_email_resend')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowEmailEdit(false); setEmailUpdateError(null); }}
                    disabled={emailUpdating}
                    className="text-xs font-semibold text-gray-500 hover:text-gray-800"
                  >
                    {t('book_close')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-8 space-y-4">
        <div className="flex items-start gap-3 text-sm text-gray-700">
          <CalendarDays className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
          <span>
            {formatDate(booking.checkInDate)} → {formatDate(booking.checkOutDate)}
            {' · '}{booking.nights} {t('book_nights')}
          </span>
        </div>
        <div className="flex items-start gap-3 text-sm text-gray-700">
          <Users className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
          <span>
            {booking.adults} {t('sim_adults').toLowerCase()}
            {booking.children > 0 ? `, ${booking.children} ${t('sim_children').toLowerCase()}` : ''}
            {booking.infants > 0 ? `, ${booking.infants} ${t('sim_infants').toLowerCase()}` : ''}
          </span>
        </div>

        <div className="flex justify-between items-baseline pt-4 border-t border-gray-100">
          <span className="font-bold text-gray-900">{t('book_total')}</span>
          <span className="font-bold text-xl text-gray-900">¥{booking.amountTotal.toLocaleString()}</span>
        </div>

        {booking.refundAmount > 0 && (
          <div>
            <div className="flex justify-between items-baseline text-sm text-green-700">
              <span>{t('manage_refunded')}</span>
              <span className="font-bold">¥{booking.refundAmount.toLocaleString()}</span>
            </div>
            {booking.refundAmount < booking.amountTotal && (
              <p className="text-right text-[11px] text-gray-400 mt-0.5">
                ({t('book_total')} ¥{booking.amountTotal.toLocaleString()} − {t('manage_refund_fee_label')} ¥
                {(booking.amountTotal - booking.refundAmount).toLocaleString()})
              </p>
            )}
          </div>
        )}

        {isConfirmed && (
          <div className="pt-4 space-y-3">
            <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-4 text-xs text-gray-600 leading-relaxed">
              {booking.refundIfCancelledNow > 0 ? (
                <>
                  <p className="font-semibold text-gray-800">
                    {t('manage_refund_if_now')} ¥{booking.refundIfCancelledNow.toLocaleString()}
                  </p>
                  {booking.refundIfCancelledNow < booking.amountTotal && (
                    <p className="mt-1 text-gray-500">
                      ({t('book_total')} ¥{booking.amountTotal.toLocaleString()} − {t('manage_refund_fee_label')} ¥
                      {(booking.amountTotal - booking.refundIfCancelledNow).toLocaleString()})
                    </p>
                  )}
                  <p className="mt-1.5 text-[11px] text-gray-400">{t('manage_refund_disclaimer')}</p>
                </>
              ) : (
                t('manage_no_refund_now').replace(/\{days\}/g, String(booking.freeCancellationDays))
              )}
            </div>

            {cancelError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{cancelError}</p>
              </div>
            )}

            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="w-full border border-gray-300 text-gray-700 font-bold py-3 rounded-xl hover:bg-gray-50
                         disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
            >
              {cancelling && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('manage_cancel_button')}
            </button>
          </div>
        )}

        <div className="pt-4 text-center">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--color-primary-600)] hover:underline">
            <Home className="w-4 h-4" /> {t('result_back_home')}
          </Link>
        </div>
      </div>
    </>,
  );
};

export default BookingResultPage;
