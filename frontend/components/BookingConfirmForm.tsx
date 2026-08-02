import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react';
import { getAllProperties } from '../services/storage';
import { createBookingConfirmation, sendBookingConfirmationEmail } from '../services/bookingConfirm';
import { getBlockedDatesForProperty } from '../services/calendar';
import {
  downloadAndAttachBookingConfirmationPdf,
  downloadBookingConfirmationPdf,
  generateBookingConfirmationPdfAttachment,
} from '../utils/bookingConfirmPdf';
import { calculateHomestayPrice } from '../utils/pricing';
import { BookingConfirmation, PropertyData } from '../types';
import { ApiError, ApiUser } from '../services/api';

type PropertyItem = PropertyData & { id: string };

const DEFAULT_CHECK_IN_TIME = '15:00';
const DEFAULT_CHECK_OUT_TIME = '10:00';

function buildPropertyUrl(property: PropertyItem): string {
  const slug = property.metalink || property.id;
  return `${window.location.origin}/#/${slug}`;
}

function nightsBetween(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  const start = new Date(`${checkIn}T00:00:00`).getTime();
  const end = new Date(`${checkOut}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

// Every night of the stay as YYYY-MM-DD, check-out excluded — mirrors the
// backend's getStayDates so the two never disagree about what "blocked" means.
function stayDates(checkIn: string, checkOut: string): string[] {
  if (!checkIn || !checkOut) return [];
  const start = new Date(`${checkIn}T00:00:00`).getTime();
  const end = new Date(`${checkOut}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return [];
  const dates: string[] = [];
  for (let cursor = start; cursor < end; cursor += 24 * 60 * 60 * 1000) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return dates;
}

const LOCALE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'zh', label: '中文' },
  { value: 'ko', label: '한국어' },
];

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'JPY',
      maximumFractionDigits: (currency || 'JPY') === 'JPY' ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-US')}`;
  }
}

const inputClass =
  'w-full rounded-xl border border-[#c4c6cd] bg-white px-3.5 py-2.5 text-[14px] text-[#1b1c1d] outline-none focus:border-[#1b1c1d] transition-colors';
const labelClass = 'block text-[12px] font-semibold text-[#44474c] mb-1.5';

interface Props {
  authUser: ApiUser | null;
  /** Called right after a confirmation is created (before the PDF download). */
  onCreated?: (confirmation: BookingConfirmation) => void;
  /** Called by the "Done" button on the success screen. */
  onDone?: () => void;
  doneLabel?: string;
}

export const BookingConfirmForm: React.FC<Props> = ({ authUser, onCreated, onDone, doneLabel = 'Done' }) => {
  const [properties, setProperties] = useState<PropertyItem[]>([]);
  const [loadingProps, setLoadingProps] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<BookingConfirmation | null>(null);
  const [emailSendError, setEmailSendError] = useState<string | null>(null);
  const [resendingEmail, setResendingEmail] = useState(false);

  // Form state
  const [propertyId, setPropertyId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [checkInDate, setCheckInDate] = useState('');
  const [checkOutDate, setCheckOutDate] = useState('');
  const [checkInTime, setCheckInTime] = useState(DEFAULT_CHECK_IN_TIME);
  const [checkOutTime, setCheckOutTime] = useState(DEFAULT_CHECK_OUT_TIME);
  const [currency, setCurrency] = useState('JPY');
  const [roomFee, setRoomFee] = useState('');
  const [cleaningFee, setCleaningFee] = useState('');
  const [extraFeeLabel, setExtraFeeLabel] = useState('');
  const [extraFee, setExtraFee] = useState('');
  const [discountLabel, setDiscountLabel] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [includeInAccounting, setIncludeInAccounting] = useState(false);
  const [guestLocale, setGuestLocale] = useState('en');

  // Track whether the host has manually edited the auto-filled amounts so the
  // pricing recompute never clobbers their typed values.
  const [roomFeeTouched, setRoomFeeTouched] = useState(false);
  const [cleaningFeeTouched, setCleaningFeeTouched] = useState(false);

  // The effective calendar for the selected property (manual blocks + iCal
  // imports from other platforms + direct-booking holds), so a manual entry
  // can't silently double-book a night another channel already has.
  const [blockedDates, setBlockedDates] = useState<Set<string>>(new Set());

  const canAccess = authUser?.role === 'ADMIN' || authUser?.role === 'HOST';

  useEffect(() => {
    if (!canAccess) {
      setLoadingProps(false);
      return;
    }
    let cancelled = false;
    setLoadingProps(true);
    getAllProperties({ includeArchived: true })
      .then((all) => {
        if (cancelled) return;
        setProperties(all);
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load properties.');
      })
      .finally(() => { if (!cancelled) setLoadingProps(false); });
    return () => { cancelled = true; };
  }, [canAccess]);

  const scopedProperties = useMemo(() => {
    if (!authUser) return [] as PropertyItem[];
    if (authUser.role === 'ADMIN') return properties;
    const assigned = new Set(authUser.assignedPropertyIds ?? []);
    return properties.filter((p) => assigned.has(p.id));
  }, [authUser, properties]);

  const selectedProperty = useMemo(
    () => scopedProperties.find((p) => p.id === propertyId) ?? null,
    [scopedProperties, propertyId],
  );

  useEffect(() => {
    if (!propertyId) {
      setBlockedDates(new Set());
      return;
    }
    let cancelled = false;
    getBlockedDatesForProperty(propertyId)
      .then((dates) => { if (!cancelled) setBlockedDates(new Set(dates)); })
      .catch(() => { if (!cancelled) setBlockedDates(new Set()); });
    return () => { cancelled = true; };
  }, [propertyId]);

  const nights = nightsBetween(checkInDate, checkOutDate);
  const numGuests = adults + children + infants;

  // Nights in the chosen range another platform (or booking) already holds.
  // Checked client-side for immediate feedback; the server re-checks this
  // itself and is the actual guard against a double-booked night.
  const conflictDates = useMemo(
    () => stayDates(checkInDate, checkOutDate).filter((date) => blockedDates.has(date)),
    [checkInDate, checkOutDate, blockedDates],
  );

  // Suggested amounts from the property's pricing config.
  const pricingSuggestion = useMemo(() => {
    if (!selectedProperty || nights <= 0 || adults + children < 1) return null;
    const result = calculateHomestayPrice(adults, children, infants, nights, selectedProperty.pricing);
    if (!result.isValid) return { error: result.message ?? 'Guests exceed pricing tiers.' };
    return {
      roomFee: Math.round(result.breakdown.discountedSubtotal),
      cleaningFee: result.breakdown.cleaningFee,
    };
  }, [selectedProperty, nights, adults, children, infants]);

  // Auto-fill the room/cleaning amounts from the pricing suggestion until the
  // host edits them by hand.
  useEffect(() => {
    if (!pricingSuggestion || 'error' in pricingSuggestion) return;
    if (!roomFeeTouched) setRoomFee(String(pricingSuggestion.roomFee));
    if (!cleaningFeeTouched) setCleaningFee(String(pricingSuggestion.cleaningFee));
  }, [pricingSuggestion, roomFeeTouched, cleaningFeeTouched]);

  const num = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
  };

  const roomFeeNum = num(roomFee);
  const cleaningFeeNum = num(cleaningFee);
  const extraFeeNum = num(extraFee);
  const discountNum = num(discountAmount);
  const depositNum = num(depositAmount);
  const totalAmount = Math.max(0, roomFeeNum + cleaningFeeNum + extraFeeNum - discountNum);
  const balanceDue = Math.max(0, totalAmount - depositNum);

  const applySuggestion = () => {
    if (!pricingSuggestion || 'error' in pricingSuggestion) return;
    setRoomFee(String(pricingSuggestion.roomFee));
    setCleaningFee(String(pricingSuggestion.cleaningFee));
    setRoomFeeTouched(false);
    setCleaningFeeTouched(false);
  };

  const validationError = (): string | null => {
    if (!selectedProperty) return 'Please choose a property.';
    if (!guestName.trim()) return 'Guest name is required.';
    if (!checkInDate || !checkOutDate) return 'Check-in and check-out dates are required.';
    if (nights <= 0) return 'Check-out must be after check-in.';
    if (numGuests < 1) return 'At least one guest is required.';
    if (conflictDates.length > 0) {
      return `These dates are already blocked on the calendar: ${conflictDates.join(', ')}.`;
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const error = validationError();
    if (error) { setErrorMsg(error); return; }
    if (!selectedProperty) return;

    setSubmitting(true);
    setErrorMsg(null);
    setEmailSendError(null);
    const hasGuestEmail = Boolean(guestEmail.trim());
    try {
      const confirmation = await createBookingConfirmation(selectedProperty.id, {
        propertyName: selectedProperty.name,
        // The server always re-resolves this itself (exact address if the
        // property has one, else the public address) — sent here only so the
        // request shape matches what the preview above shows.
        propertyAddress: selectedProperty.directBooking?.exactAddress?.trim() || selectedProperty.address,
        propertyUrl: buildPropertyUrl(selectedProperty),
        guestName: guestName.trim(),
        guestEmail: guestEmail.trim() || undefined,
        guestPhone: guestPhone.trim() || undefined,
        locale: guestLocale,
        numGuests,
        checkInDate,
        checkOutDate,
        checkInTime,
        checkOutTime,
        currency: currency.trim().toUpperCase() || 'JPY',
        roomFee: roomFeeNum,
        cleaningFee: cleaningFeeNum,
        extraFeeLabel: extraFeeLabel.trim() || undefined,
        extraFee: extraFeeNum,
        discountLabel: discountLabel.trim() || undefined,
        discountAmount: discountNum,
        totalAmount,
        depositAmount: depositNum,
        balanceDue,
        notes: notes.trim() || undefined,
        includeInAccounting,
        // The confirmation email needs the real confirmationNo baked into the
        // PDF, which only exists once this call returns — so when there's a
        // guest email, the server skips sending it here and we send it
        // ourselves below, PDF attached.
        attachPdf: hasGuestEmail,
      });
      setCreated(confirmation);
      onCreated?.(confirmation);

      if (hasGuestEmail) {
        try {
          const { base64, fileName } = await downloadAndAttachBookingConfirmationPdf(confirmation);
          await sendBookingConfirmationEmail(confirmation.id, { pdfBase64: base64, pdfFileName: fileName, locale: guestLocale });
        } catch (mailErr) {
          setEmailSendError(mailErr instanceof Error ? mailErr.message : 'Failed to send the confirmation email.');
        }
      } else {
        await downloadBookingConfirmationPdf(confirmation);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const dates = (err.body as { conflictDates?: string[] } | undefined)?.conflictDates;
        setErrorMsg(dates?.length
          ? `These dates are already blocked on the calendar: ${dates.join(', ')}.`
          : err.message);
        // The client-side check missed this (e.g. another tab just imported
        // new iCal blocks) — refresh so the warning below reflects reality.
        getBlockedDatesForProperty(selectedProperty.id)
          .then((d) => setBlockedDates(new Set(d)))
          .catch(() => {});
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to create booking confirmation.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resendConfirmationEmail = async () => {
    if (!created) return;
    setResendingEmail(true);
    setEmailSendError(null);
    try {
      const { base64, fileName } = await generateBookingConfirmationPdfAttachment(created);
      await sendBookingConfirmationEmail(created.id, { pdfBase64: base64, pdfFileName: fileName, locale: guestLocale });
    } catch (err) {
      setEmailSendError(err instanceof Error ? err.message : 'Failed to send the confirmation email.');
    } finally {
      setResendingEmail(false);
    }
  };

  const resetForNext = () => {
    setCreated(null);
    setEmailSendError(null);
    setGuestName('');
    setGuestEmail('');
    setGuestPhone('');
    setGuestLocale('en');
    setCheckInDate('');
    setCheckOutDate('');
    setRoomFee('');
    setCleaningFee('');
    setExtraFeeLabel('');
    setExtraFee('');
    setDiscountLabel('');
    setDiscountAmount('');
    setDepositAmount('');
    setNotes('');
    setIncludeInAccounting(false);
    setRoomFeeTouched(false);
    setCleaningFeeTouched(false);
  };

  if (created) {
    return (
      <div className="rounded-2xl border border-[#e4e2e3] bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-[18px] font-bold">Confirmation created</h2>
        <p className="mt-1 text-[13px] text-[#74777d]">
          {created.confirmationNo} · {created.guestName} · {formatMoney(created.totalAmount, created.currency)}
        </p>
        <p className="mt-1 text-[12px] text-[#9a9ca0]">The PDF has been downloaded. It is also saved to your revenue list.</p>
        {created.guestEmail && (
          emailSendError ? (
            <div className="mx-auto mt-3 max-w-md rounded-xl border border-[#f5c2c7] bg-[#fdeef0] px-4 py-3 text-left">
              <p className="text-[12.5px] text-[#ba1a1a]">
                Could not email the confirmation (with PDF) to {created.guestEmail}: {emailSendError}
              </p>
              <button
                type="button"
                onClick={() => void resendConfirmationEmail()}
                disabled={resendingEmail}
                className="mt-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-[#ba1a1a] hover:underline disabled:opacity-60"
              >
                {resendingEmail ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Retry sending
              </button>
            </div>
          ) : (
            <p className="mt-1 text-[12px] text-[#1a7f4b]">A confirmation email with the PDF attached was sent to {created.guestEmail}.</p>
          )
        )}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => void downloadBookingConfirmationPdf(created)}
            className="flex items-center gap-1.5 rounded-xl bg-[#1b1c1d] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#333] transition-colors"
          >
            <Download className="h-4 w-4" /> Download again
          </button>
          <button
            type="button"
            onClick={resetForNext}
            className="rounded-xl border border-[#c4c6cd] bg-white px-4 py-2.5 text-[13px] font-semibold hover:bg-[#f5f3f4] transition-colors"
          >
            Create another
          </button>
          {onDone && (
            <button
              type="button"
              onClick={onDone}
              className="rounded-xl border border-[#c4c6cd] bg-white px-4 py-2.5 text-[13px] font-semibold hover:bg-[#f5f3f4] transition-colors"
            >
              {doneLabel}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {errorMsg && (
        <div className="mb-4 rounded-xl border border-[#f5c2c7] bg-[#fdeef0] px-4 py-3 text-[13px] text-[#ba1a1a]">{errorMsg}</div>
      )}
      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        <div className="space-y-5">
          {/* Property */}
          <section className="rounded-2xl border border-[#e4e2e3] bg-white p-5">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.06em] text-[#74777d] mb-3">Property</h2>
            {loadingProps ? (
              <div className="flex items-center gap-2 text-[13px] text-[#74777d]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : (
              <>
                <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className={inputClass}>
                  <option value="">Select a property…</option>
                  {scopedProperties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {selectedProperty && (
                  <div className="mt-3 rounded-xl bg-[#f7f5f6] px-4 py-3 text-[12.5px] text-[#44474c] leading-relaxed">
                    <div className="font-semibold text-[#1b1c1d]">{selectedProperty.name}</div>
                    <div>{selectedProperty.directBooking?.exactAddress?.trim() || selectedProperty.address || '—'}</div>
                    <div className="text-[#2563EB] break-all">{buildPropertyUrl(selectedProperty)}</div>
                    {selectedProperty.directBooking?.exactAddress?.trim() && (
                      <div className="mt-1 text-[11px] text-[#9a9ca0]">Exact address on file — this is what the guest will see, not the public address.</div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          {/* Guest */}
          <section className="rounded-2xl border border-[#e4e2e3] bg-white p-5">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.06em] text-[#74777d] mb-3">Guest</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className={labelClass}>Guest name *</label>
                <input className={inputClass} value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Full name" />
              </div>
              <div>
                <label className={labelClass}>Email</label>
                <input className={inputClass} value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder="guest@email.com" />
                {guestEmail.trim() && (
                  <p className="mt-1 text-[11px] text-[#74777d]">A confirmation email will be sent to this address on creation.</p>
                )}
              </div>
              <div>
                <label className={labelClass}>Phone</label>
                <input className={inputClass} value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="+81…" />
              </div>
              {guestEmail.trim() && (
                <div>
                  <label className={labelClass}>Confirmation email language</label>
                  <select className={inputClass} value={guestLocale} onChange={(e) => setGuestLocale(e.target.value)}>
                    {LOCALE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className={labelClass}>Adults</label>
                <input type="number" min={0} className={inputClass} value={adults} onChange={(e) => setAdults(Math.max(0, Number(e.target.value) || 0))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Children</label>
                  <input type="number" min={0} className={inputClass} value={children} onChange={(e) => setChildren(Math.max(0, Number(e.target.value) || 0))} />
                </div>
                <div>
                  <label className={labelClass}>Infants</label>
                  <input type="number" min={0} className={inputClass} value={infants} onChange={(e) => setInfants(Math.max(0, Number(e.target.value) || 0))} />
                </div>
              </div>
            </div>
          </section>

          {/* Stay */}
          <section className="rounded-2xl border border-[#e4e2e3] bg-white p-5">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.06em] text-[#74777d] mb-3">Stay</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Check-in date *</label>
                <input type="date" className={inputClass} value={checkInDate} onChange={(e) => setCheckInDate(e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Check-in time</label>
                <input type="time" className={inputClass} value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Check-out date *</label>
                <input type="date" className={inputClass} value={checkOutDate} onChange={(e) => setCheckOutDate(e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Check-out time</label>
                <input type="time" className={inputClass} value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} />
              </div>
            </div>
            {nights > 0 && <p className="mt-2 text-[12px] text-[#74777d]">{nights} night{nights === 1 ? '' : 's'} · {numGuests} guest{numGuests === 1 ? '' : 's'}</p>}
            {conflictDates.length > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-[#f5c2c7] bg-[#fdeef0] px-3.5 py-2.5">
                <AlertTriangle className="h-4 w-4 text-[#ba1a1a] shrink-0 mt-0.5" />
                <p className="text-[12px] text-[#ba1a1a] leading-relaxed">
                  Already blocked on the calendar (another platform or booking): {conflictDates.join(', ')}.
                </p>
              </div>
            )}
          </section>

          {/* Amounts */}
          <section className="rounded-2xl border border-[#e4e2e3] bg-white p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[13px] font-bold uppercase tracking-[0.06em] text-[#74777d]">Amounts</h2>
              {pricingSuggestion && !('error' in pricingSuggestion) && (
                <button type="button" onClick={applySuggestion} className="flex items-center gap-1 text-[12px] font-semibold text-[#2563EB] hover:underline">
                  <RefreshCw className="h-3.5 w-3.5" /> Recalculate from pricing
                </button>
              )}
            </div>
            {pricingSuggestion && 'error' in pricingSuggestion && (
              <p className="mb-3 text-[12px] text-[#b26a00]">{pricingSuggestion.error} Enter the amounts manually.</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Accommodation fee</label>
                <input inputMode="numeric" className={inputClass} value={roomFee} onChange={(e) => { setRoomFee(e.target.value); setRoomFeeTouched(true); }} placeholder="0" />
              </div>
              <div>
                <label className={labelClass}>Cleaning fee</label>
                <input inputMode="numeric" className={inputClass} value={cleaningFee} onChange={(e) => { setCleaningFee(e.target.value); setCleaningFeeTouched(true); }} placeholder="0" />
              </div>
              <div>
                <label className={labelClass}>Extra fee label</label>
                <input className={inputClass} value={extraFeeLabel} onChange={(e) => setExtraFeeLabel(e.target.value)} placeholder="e.g. Early check-in" />
              </div>
              <div>
                <label className={labelClass}>Extra fee</label>
                <input inputMode="numeric" className={inputClass} value={extraFee} onChange={(e) => setExtraFee(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className={labelClass}>Discount label</label>
                <input className={inputClass} value={discountLabel} onChange={(e) => setDiscountLabel(e.target.value)} placeholder="e.g. Returning guest" />
              </div>
              <div>
                <label className={labelClass}>Other discount</label>
                <input inputMode="numeric" className={inputClass} value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className={labelClass}>Deposit paid</label>
                <input inputMode="numeric" className={inputClass} value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className={labelClass}>Currency</label>
                <input className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="JPY" />
              </div>
            </div>
            <div>
              <label className={`${labelClass} mt-3`}>Notes (optional)</label>
              <textarea className={`${inputClass} min-h-[72px] resize-y`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the guest should know…" />
            </div>
          </section>
        </div>

        {/* Summary sidebar */}
        <aside className="h-fit space-y-4">
          <div className="rounded-2xl border border-[#e4e2e3] bg-white p-5">
            <h2 className="text-[13px] font-bold uppercase tracking-[0.06em] text-[#74777d] mb-3">Summary</h2>
            <dl className="space-y-2 text-[13px]">
              <div className="flex justify-between"><dt className="text-[#74777d]">Accommodation</dt><dd className="tabular-nums">{formatMoney(roomFeeNum, currency)}</dd></div>
              <div className="flex justify-between"><dt className="text-[#74777d]">Cleaning</dt><dd className="tabular-nums">{formatMoney(cleaningFeeNum, currency)}</dd></div>
              {extraFeeNum > 0 && <div className="flex justify-between"><dt className="text-[#74777d]">{extraFeeLabel.trim() || 'Extra'}</dt><dd className="tabular-nums">{formatMoney(extraFeeNum, currency)}</dd></div>}
              {discountNum > 0 && <div className="flex justify-between text-[#1a7f4b]"><dt>{discountLabel.trim() || 'Discount'}</dt><dd className="tabular-nums">−{formatMoney(discountNum, currency)}</dd></div>}
              <div className="flex justify-between border-t border-[#e4e2e3] pt-2 font-bold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(totalAmount, currency)}</dd></div>
              <div className="flex justify-between"><dt className="text-[#74777d]">Deposit paid</dt><dd className="tabular-nums">−{formatMoney(depositNum, currency)}</dd></div>
              <div className="flex justify-between rounded-lg bg-[#1b1c1d] px-3 py-2 text-white font-bold"><dt>Balance due</dt><dd className="tabular-nums">{formatMoney(balanceDue, currency)}</dd></div>
            </dl>

            <label className="mt-4 flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" checked={includeInAccounting} onChange={(e) => setIncludeInAccounting(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#1b1c1d]" />
              <span className="text-[12px] text-[#44474c] leading-snug">Include this revenue in accounting reports</span>
            </label>

            <button
              type="submit"
              disabled={submitting || conflictDates.length > 0}
              className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl bg-[#1b1c1d] px-4 py-3 text-[14px] font-bold text-white hover:bg-[#333] disabled:opacity-60 transition-colors"
            >
              {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</> : <><Download className="h-4 w-4" /> Generate PDF</>}
            </button>
          </div>
        </aside>
      </form>
    </>
  );
};

/** Signals other tabs (e.g. the revenue list) that a confirmation was created. */
export const BOOKING_CONFIRM_CREATED_KEY = 'booking-confirm:created';
export function signalBookingConfirmCreated(): void {
  try {
    localStorage.setItem(BOOKING_CONFIRM_CREATED_KEY, String(Date.now()));
  } catch {
    // ignore storage failures — refresh signalling is best-effort
  }
}
