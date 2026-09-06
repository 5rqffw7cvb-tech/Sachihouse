import React, { useMemo, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { AlertCircle, ArrowLeft, Check, CheckCircle2, Copy, Loader2, Minus, Plus, X } from 'lucide-react';
import { ApiError } from '../../services/api';
import { createBookingConfirmation, sendBookingConfirmationEmail } from '../../services/bookingConfirm';
import {
  copyText,
  formatMoney,
  HostCalendarData,
  HostProperty,
  toIsoDate,
} from '../../services/hostApp';
import {
  downloadAndAttachBookingConfirmationPdf,
  downloadBookingConfirmationPdf,
} from '../../utils/bookingConfirmPdf';
import { calculateHomestayPrice } from '../../utils/pricing';
import { BookingConfirmation } from '../../types';

/**
 * Quote the selected nights, then turn the agreed price into a confirmation.
 *
 * Two steps on purpose. Most of the time a host is answering "how much for
 * these dates?" in a chat thread and needs nothing but a number to paste back.
 * Only when the guest says yes does anything get created — and the price that
 * gets created is whatever the two of them settled on, not what the rate card
 * first suggested, which is why the amounts stay editable in step two.
 *
 * The create path is deliberately the same one the desktop form uses, down to
 * the PDF-then-email ordering: the confirmation number only exists after the
 * record is created, and it has to be printed on the PDF the guest receives.
 */
const DEFAULT_CHECK_IN_TIME = '15:00';
const DEFAULT_CHECK_OUT_TIME = '10:00';

const LOCALE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'zh', label: '中文' },
  { value: 'ko', label: '한국어' },
];

export interface QuoteSheetProps {
  /** The selected nights, sorted. Check-out is the morning after the last. */
  dates: string[];
  properties: HostProperty[];
  calendars: Map<string, HostCalendarData>;
  onClose: () => void;
  /** Fired once a confirmation exists, so the calendar can pick it up. */
  onCreated: () => void;
}

const longDate = (iso: string): string => {
  try {
    return format(parseISO(iso), 'EEE d MMM yyyy');
  } catch {
    return iso;
  }
};

const Stepper: React.FC<{
  label: string;
  hint?: string;
  value: number;
  min?: number;
  onChange: (value: number) => void;
}> = ({ label, hint, value, min = 0, onChange }) => (
  <div className="flex items-center gap-3 py-2.5 border-b border-line last:border-b-0">
    <span className="flex-1 min-w-0 flex flex-col">
      <span className="text-[15px] text-ink">{label}</span>
      {hint && <span className="text-[12px] text-ink-muted">{hint}</span>}
    </span>
    <span className="shrink-0 flex items-center gap-1">
      <button
        type="button"
        aria-label={`One fewer ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        className="w-11 h-11 rounded-control border border-line-strong flex items-center justify-center
          text-ink disabled:opacity-30"
      >
        <Minus className="w-4 h-4" />
      </button>
      <span className="w-8 text-center text-[16px] font-semibold text-ink tabular-nums">{value}</span>
      <button
        type="button"
        aria-label={`One more ${label}`}
        onClick={() => onChange(value + 1)}
        className="w-11 h-11 rounded-control border border-line-strong flex items-center justify-center text-ink"
      >
        <Plus className="w-4 h-4" />
      </button>
    </span>
  </div>
);

const fieldClass =
  'w-full h-12 px-3.5 rounded-control bg-subtle border border-line text-[16px] text-ink ' +
  'placeholder:text-ink-muted focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';
const labelClass = 'block text-[12px] font-semibold uppercase tracking-wide text-ink-soft mb-1.5';

export const QuoteSheet: React.FC<QuoteSheetProps> = ({
  dates,
  properties,
  calendars,
  onClose,
  onCreated,
}) => {
  const [step, setStep] = useState<'quote' | 'confirm'>('quote');
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? '');
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);

  const [roomFee, setRoomFee] = useState('');
  const [cleaningFee, setCleaningFee] = useState('');
  const [feesTouched, setFeesTouched] = useState(false);
  const [deposit, setDeposit] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [locale, setLocale] = useState('en');
  const [notes, setNotes] = useState('');
  const [includeInAccounting, setIncludeInAccounting] = useState(false);

  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<BookingConfirmation | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const checkInDate = dates[0];
  const checkOutDate = useMemo(
    () => toIsoDate(addDays(parseISO(dates[dates.length - 1]), 1)),
    [dates],
  );
  const nights = dates.length;
  const property = properties.find((item) => item.id === propertyId) ?? null;

  /** Nights in this selection the chosen property cannot actually sell. */
  const conflicts = useMemo(() => {
    const calendar = calendars.get(propertyId);
    if (!calendar) return [];
    return dates.filter((date) => calendar.blockedDates.has(date));
  }, [calendars, propertyId, dates]);

  const suggestion = useMemo(() => {
    if (!property || nights <= 0 || adults + children < 1) return null;
    const result = calculateHomestayPrice(adults, children, infants, nights, property.pricing);
    if (!result.isValid) return { error: result.message ?? 'Too many guests for this rate card.' };
    return {
      roomFee: Math.round(result.breakdown.discountedSubtotal),
      cleaningFee: result.breakdown.cleaningFee,
    };
  }, [property, nights, adults, children, infants]);

  const suggestionError = suggestion && 'error' in suggestion ? suggestion.error : null;
  const priced = suggestion && !('error' in suggestion) ? suggestion : null;

  // The rate card drives the amounts until the host overrides them, and then it
  // stops: a price agreed in a chat thread outranks the calculator.
  const effectiveRoomFee = feesTouched ? Number(roomFee) || 0 : priced?.roomFee ?? 0;
  const effectiveCleaningFee = feesTouched ? Number(cleaningFee) || 0 : priced?.cleaningFee ?? 0;
  const depositNum = Math.max(0, Math.round(Number(deposit) || 0));
  const total = Math.max(0, Math.round(effectiveRoomFee + effectiveCleaningFee));
  const balanceDue = Math.max(0, total - depositNum);
  const numGuests = adults + children + infants;

  const startEditingFees = () => {
    if (feesTouched) return;
    setRoomFee(String(priced?.roomFee ?? 0));
    setCleaningFee(String(priced?.cleaningFee ?? 0));
    setFeesTouched(true);
  };

  const quoteText = [
    property?.name ?? '',
    `Check-in:  ${longDate(checkInDate)} ${DEFAULT_CHECK_IN_TIME}`,
    `Check-out: ${longDate(checkOutDate)} ${DEFAULT_CHECK_OUT_TIME}`,
    `${nights} ${nights === 1 ? 'night' : 'nights'} · ${numGuests} ${numGuests === 1 ? 'guest' : 'guests'}`,
    '',
    `Room      ${formatMoney(effectiveRoomFee, 'JPY')}`,
    `Cleaning  ${formatMoney(effectiveCleaningFee, 'JPY')}`,
    `Total     ${formatMoney(total, 'JPY')}`,
  ].join('\n');

  const handleCopyQuote = async () => {
    await copyText(quoteText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleCreate = async () => {
    if (!property) { setError('Choose a property first.'); return; }
    if (!guestName.trim()) { setError('The guest name is required.'); return; }
    if (conflicts.length > 0) {
      setError(`These nights are already taken: ${conflicts.join(', ')}.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    setEmailError(null);
    const hasEmail = Boolean(guestEmail.trim());

    try {
      const confirmation = await createBookingConfirmation(property.id, {
        propertyName: property.name,
        propertyAddress: property.address,
        propertyUrl: `${window.location.origin}/#/${property.metalink || property.id}`,
        guestName: guestName.trim(),
        guestEmail: guestEmail.trim() || undefined,
        guestPhone: guestPhone.trim() || undefined,
        locale,
        numGuests,
        checkInDate,
        checkOutDate,
        checkInTime: DEFAULT_CHECK_IN_TIME,
        checkOutTime: DEFAULT_CHECK_OUT_TIME,
        currency: 'JPY',
        roomFee: Math.round(effectiveRoomFee),
        cleaningFee: Math.round(effectiveCleaningFee),
        extraFee: 0,
        discountAmount: 0,
        totalAmount: total,
        depositAmount: depositNum,
        balanceDue,
        notes: notes.trim() || undefined,
        includeInAccounting,
        // The email must carry a PDF stamped with the real confirmation number,
        // which only exists once this call returns — so the server holds its own
        // email back and we send it below.
        attachPdf: hasEmail,
      });

      setCreated(confirmation);
      onCreated();

      if (hasEmail) {
        try {
          const { base64, fileName } = await downloadAndAttachBookingConfirmationPdf(confirmation);
          await sendBookingConfirmationEmail(confirmation.id, {
            pdfBase64: base64,
            pdfFileName: fileName,
            locale,
          });
        } catch (cause) {
          setEmailError(cause instanceof Error ? cause.message : 'The confirmation was created but the email failed to send.');
        }
      } else {
        await downloadBookingConfirmationPdf(confirmation);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        const taken = (cause.body as { conflictDates?: string[] } | undefined)?.conflictDates;
        setError(taken?.length
          ? `These nights are already taken: ${taken.join(', ')}.`
          : cause.message);
      } else {
        setError(cause instanceof Error ? cause.message : 'Could not create the booking confirmation.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const header = (title: string, subtitle: string, back?: () => void) => (
    <div className="pt-2.5 sticky top-0 bg-surface z-10">
      <div className="w-10 h-1 rounded-full bg-line-strong mx-auto" />
      <div className="flex items-start gap-2 px-5 pt-3 pb-3.5 border-b border-line">
        {back && (
          <button type="button" onClick={back} aria-label="Back" className="shrink-0 p-1 -ml-1 mt-0.5">
            <ArrowLeft className="w-5 h-5 text-ink-soft" />
          </button>
        )}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <h2 className="text-[20px] tracking-[-0.3px] truncate">{title}</h2>
          <span className="text-[13px] text-ink-muted truncate">{subtitle}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1 -mr-1 mt-0.5">
          <X className="w-5 h-5 text-ink-soft" />
        </button>
      </div>
    </div>
  );

  const dateLine = `${longDate(checkInDate)} → ${longDate(checkOutDate)}`;

  return (
    <div
      className="fixed inset-0 z-50 bg-brand/60 backdrop-blur-sm flex items-end animate-dialog-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full bg-surface rounded-t-[24px] max-h-[92dvh] overflow-y-auto animate-dialog-panel"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Quote"
      >
        {created ? (
          <>
            {header('Booking confirmed', created.confirmationNo)}
            <div className="px-5 pt-6 flex flex-col items-center text-center gap-3">
              <div className="w-16 h-16 rounded-full bg-ok-tint text-ok flex items-center justify-center">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <p className="text-[16px] font-semibold text-ink">
                {created.guestName} · {formatMoney(created.totalAmount, created.currency)}
              </p>
              <p className="text-[13px] text-ink-muted">
                {emailError
                  ? 'The confirmation was created, but the email did not go out.'
                  : created.guestEmail
                    ? `Confirmation and PDF sent to ${created.guestEmail}.`
                    : 'No guest email was given, so the PDF was downloaded instead.'}
              </p>
              {emailError && (
                <div className="w-full flex items-start gap-2.5 bg-danger-tint text-danger border border-danger/20
                  rounded-control px-3.5 py-3 text-[13px] text-left">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="flex-1 min-w-0">{emailError}</span>
                </div>
              )}
              <button
                type="button"
                onClick={onClose}
                className="mt-2 w-full h-13 min-h-[52px] rounded-control bg-brand text-white
                  font-['Plus_Jakarta_Sans'] text-[15px] font-bold"
              >
                Done
              </button>
            </div>
          </>
        ) : step === 'quote' ? (
          <>
            {header('Quote', `${nights} ${nights === 1 ? 'night' : 'nights'} · ${dateLine}`)}

            <div className="px-5 pt-4 flex flex-col gap-4">
              {properties.length > 1 && (
                <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5">
                  {properties.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => { setPropertyId(item.id); setFeesTouched(false); }}
                      className={`h-[34px] px-3.5 rounded-full text-[13px] whitespace-nowrap shrink-0 ${
                        item.id === propertyId
                          ? 'bg-brand text-white font-semibold'
                          : 'bg-surface border border-line text-ink-soft font-medium'
                      }`}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              )}

              {conflicts.length > 0 && (
                <div className="flex items-start gap-2.5 bg-warn-tint text-warn border border-warn/20
                  rounded-control px-3.5 py-3 text-[13px]">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="flex-1 min-w-0">
                    {conflicts.length} of these nights are already taken at {property?.name}.
                    Quote them and you will not be able to confirm.
                  </span>
                </div>
              )}

              <div className="bg-subtle border border-line rounded-card px-4">
                <Stepper label="Adults" value={adults} min={1} onChange={setAdults} />
                <Stepper
                  label="Children"
                  hint={property ? `${property.pricing.childAgeMin}–${property.pricing.childAgeMax} years` : undefined}
                  value={children}
                  onChange={setChildren}
                />
                <Stepper label="Infants" hint="Free" value={infants} onChange={setInfants} />
              </div>

              {suggestionError ? (
                <div className="flex items-start gap-2.5 bg-danger-tint text-danger border border-danger/20
                  rounded-control px-3.5 py-3 text-[13px]">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="flex-1 min-w-0">{suggestionError}</span>
                </div>
              ) : (
                <div className="bg-surface border border-line rounded-card px-4 py-1">
                  <div className="flex items-center justify-between py-2.5 border-b border-line">
                    <span className="text-[14px] text-ink-soft">Room · {nights} × {adults + children} paying</span>
                    <span className="text-[15px] text-ink tabular-nums">{formatMoney(effectiveRoomFee, 'JPY')}</span>
                  </div>
                  <div className="flex items-center justify-between py-2.5 border-b border-line">
                    <span className="text-[14px] text-ink-soft">Cleaning</span>
                    <span className="text-[15px] text-ink tabular-nums">{formatMoney(effectiveCleaningFee, 'JPY')}</span>
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <span className="text-[15px] font-semibold text-ink">Total</span>
                    <span className="font-['Plus_Jakarta_Sans'] text-[20px] font-bold text-ink tabular-nums">
                      {formatMoney(total, 'JPY')}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => { void handleCopyQuote(); }}
                  disabled={!priced}
                  className="flex-1 h-13 min-h-[52px] rounded-control bg-surface border border-line-strong
                    flex items-center justify-center gap-2 text-[15px] font-semibold text-ink disabled:opacity-50"
                >
                  {copied ? <><Check className="w-[18px] h-[18px]" /> Copied</> : <><Copy className="w-[18px] h-[18px]" /> Copy quote</>}
                </button>
                <button
                  type="button"
                  onClick={() => setStep('confirm')}
                  disabled={!priced}
                  className="flex-1 h-13 min-h-[52px] rounded-control bg-brand text-white
                    font-['Plus_Jakarta_Sans'] text-[15px] font-bold disabled:opacity-50"
                >
                  Confirm booking
                </button>
              </div>

              <p className="text-[12px] text-ink-muted leading-relaxed">
                Copy the quote into your chat with the guest. Come back and confirm once they agree —
                the price stays editable, so an agreed number wins over this one.
              </p>
            </div>
          </>
        ) : (
          <>
            {header('Confirm booking', `${property?.name ?? ''} · ${formatMoney(total, 'JPY')}`, () => setStep('quote'))}

            <div className="px-5 pt-4 flex flex-col gap-4">
              {error && (
                <div className="flex items-start gap-2.5 bg-danger-tint text-danger border border-danger/20
                  rounded-control px-3.5 py-3 text-[13px]">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="flex-1 min-w-0">{error}</span>
                </div>
              )}

              <label className="block">
                <span className={labelClass}>Guest name *</span>
                <input
                  value={guestName}
                  onChange={(event) => setGuestName(event.target.value)}
                  className={fieldClass}
                  placeholder="Tanaka Yuki"
                  autoCapitalize="words"
                />
              </label>

              <label className="block">
                <span className={labelClass}>Email</span>
                <input
                  value={guestEmail}
                  onChange={(event) => setGuestEmail(event.target.value)}
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  className={fieldClass}
                  placeholder="Leave empty to download the PDF instead"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={labelClass}>Phone</span>
                  <input
                    value={guestPhone}
                    onChange={(event) => setGuestPhone(event.target.value)}
                    type="tel"
                    inputMode="tel"
                    className={fieldClass}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Email language</span>
                  <select
                    value={locale}
                    onChange={(event) => setLocale(event.target.value)}
                    className={`${fieldClass} pr-8`}
                  >
                    {LOCALE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={labelClass}>Room fee</span>
                  <input
                    value={feesTouched ? roomFee : String(priced?.roomFee ?? 0)}
                    onFocus={startEditingFees}
                    onChange={(event) => { startEditingFees(); setRoomFee(event.target.value); }}
                    inputMode="numeric"
                    className={fieldClass}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Cleaning fee</span>
                  <input
                    value={feesTouched ? cleaningFee : String(priced?.cleaningFee ?? 0)}
                    onFocus={startEditingFees}
                    onChange={(event) => { startEditingFees(); setCleaningFee(event.target.value); }}
                    inputMode="numeric"
                    className={fieldClass}
                  />
                </label>
              </div>

              <label className="block">
                <span className={labelClass}>Deposit already paid</span>
                <input
                  value={deposit}
                  onChange={(event) => setDeposit(event.target.value)}
                  inputMode="numeric"
                  className={fieldClass}
                  placeholder="0"
                />
              </label>

              <label className="block">
                <span className={labelClass}>Notes for the guest</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={2}
                  className={`${fieldClass} h-auto py-2.5`}
                />
              </label>

              <button
                type="button"
                onClick={() => setIncludeInAccounting((value) => !value)}
                aria-pressed={includeInAccounting}
                className="flex items-center gap-3.5 min-h-11 text-left"
              >
                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-[15px] font-semibold text-ink">Count in accounting</span>
                  <span className="text-[12px] text-ink-muted leading-snug">
                    Adds this revenue to the finance reports.
                  </span>
                </span>
                <span className={`w-[50px] h-[30px] rounded-full p-[3px] shrink-0 flex items-center transition-colors ${
                  includeInAccounting ? 'bg-brand justify-end' : 'bg-line-strong justify-start'
                }`}>
                  <span className="w-6 h-6 rounded-full bg-surface" />
                </span>
              </button>

              <div className="bg-subtle border border-line rounded-card px-4 py-1">
                <div className="flex items-center justify-between py-2.5 border-b border-line">
                  <span className="text-[14px] text-ink-soft">Total</span>
                  <span className="text-[15px] font-semibold text-ink tabular-nums">{formatMoney(total, 'JPY')}</span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-[14px] text-ink-soft">Balance due on arrival</span>
                  <span className="text-[15px] font-semibold text-ink tabular-nums">{formatMoney(balanceDue, 'JPY')}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => { void handleCreate(); }}
                disabled={submitting || !guestName.trim()}
                className="h-13 min-h-[52px] rounded-control bg-brand text-white
                  font-['Plus_Jakarta_Sans'] text-[15px] font-bold flex items-center justify-center gap-2
                  disabled:opacity-50"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {guestEmail.trim() ? 'Create and email the guest' : 'Create confirmation'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default QuoteSheet;
