import React, { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, Check, Download, Loader2, PencilLine, X } from 'lucide-react';
import { createBookingConfirmation } from '../../services/bookingConfirm';
import { downloadBookingConfirmationPdf } from '../../utils/bookingConfirmPdf';
import { HostProperty, HostStay, nightsBetween } from '../../services/hostApp';
import { ApiError } from '../../services/api';
import { fieldClass, labelClass, sheetBackdropClass, sheetPanelClass } from './sheetControls';

/**
 * Turning a stay that already exists into a confirmation the guest can keep.
 *
 * A reservation taken directly and noted on a channel manager comes back to us
 * as an anonymous iCal block. The stay is real, the guest wants a PDF, and
 * until now there was no way to produce one: the booking-confirmation form
 * refuses dates the calendar shows as unavailable, and those nights are
 * unavailable precisely because of the stay being written up. Hence
 * documentsExistingStay on the payload — the server then only refuses when it
 * already holds a stay record of its own for those nights.
 *
 * The money is typed rather than guessed. An OTA feed carries no price at all,
 * and a number invented from the rate card would be wrong for exactly the
 * bookings that need this screen — the ones negotiated off-platform.
 *
 * The dates start from the stay and can be corrected, because a channel
 * manager's block is often a day out and a guest may have agreed a change
 * off-platform. Editing them writes the PDF only: this screen issues a
 * document, it does not move the booking, and the calendar keeps the nights it
 * already holds blocked.
 *
 * That asymmetry is why the fields are locked behind an explicit Edit and a
 * warning. Open inputs would say the dates are simply this confirmation's to
 * set, when in truth the guest ends up holding a PDF that disagrees with the
 * platform the stay actually lives on. The host should be choosing that, not
 * discovering it.
 */

interface BookingConfirmSheetProps {
  stay: HostStay;
  /** The stay's property, for the address and URL printed on the PDF. */
  property: HostProperty | null;
  onClose: () => void;
}

const toWhole = (value: string): number => {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
};

export const BookingConfirmSheet: React.FC<BookingConfirmSheetProps> = ({ stay, property, onClose }) => {
  const [checkInDate, setCheckInDate] = useState(stay.checkInDate);
  const [checkOutDate, setCheckOutDate] = useState(stay.checkOutDate);
  const [guestName, setGuestName] = useState(stay.guestName ?? '');
  const [guestEmail, setGuestEmail] = useState('');
  const [numGuests, setNumGuests] = useState(String(stay.guestCount ?? 2));
  const [roomFee, setRoomFee] = useState(stay.amountTotal !== null ? String(stay.amountTotal) : '');
  const [cleaningFee, setCleaningFee] = useState('0');
  const [depositPaid, setDepositPaid] = useState('0');
  const [notes, setNotes] = useState('');

  // Locked, warned, then editable. A stay from another platform is a record of
  // something already agreed, so changing its dates is a deliberate act rather
  // than a field to tab through — and what actually changes is only the PDF,
  // which is not what an open date input implies.
  const [dateMode, setDateMode] = useState<'locked' | 'warning' | 'editing'>('locked');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const nights = nightsBetween(checkInDate, checkOutDate);
  const datesValid = Boolean(checkInDate) && Boolean(checkOutDate) && checkInDate < checkOutDate;
  const datesMoved = checkInDate !== stay.checkInDate || checkOutDate !== stay.checkOutDate;
  const totals = useMemo(() => {
    const room = toWhole(roomFee);
    const cleaning = toWhole(cleaningFee);
    const deposit = toWhole(depositPaid);
    const total = room + cleaning;
    return { room, cleaning, deposit, total, balance: total - deposit };
  }, [roomFee, cleaningFee, depositPaid]);

  const currency = stay.currency || 'JPY';
  const money = (amount: number): string => {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: currency === 'JPY' ? 0 : 2,
      }).format(amount);
    } catch {
      return `${currency} ${amount.toLocaleString('en-US')}`;
    }
  };

  const canIssue = Boolean(guestName.trim()) && roomFee.trim() !== '' && totals.total > 0 && datesValid && !saving;

  const handleIssue = async () => {
    if (!property) {
      setError('This stay has no property on your account, so there is no address to print.');
      return;
    }
    if (!datesValid) {
      setError('Check-out has to be after check-in.');
      return;
    }
    const guests = Math.max(1, toWhole(numGuests));
    setSaving(true);
    setError(null);
    try {
      const confirmation = await createBookingConfirmation(property.id, {
        propertyName: property.name,
        propertyAddress: property.address,
        propertyUrl: `${window.location.origin}/#/${property.metalink || property.id}`,
        guestName: guestName.trim(),
        guestEmail: guestEmail.trim() || undefined,
        numGuests: guests,
        checkInDate,
        checkOutDate,
        checkInTime: '15:00',
        checkOutTime: '10:00',
        currency,
        roomFee: totals.room,
        cleaningFee: totals.cleaning,
        extraFee: 0,
        discountAmount: 0,
        totalAmount: totals.total,
        depositAmount: totals.deposit,
        balanceDue: totals.balance,
        notes: notes.trim() || undefined,
        // Off by default: a stay booked and paid on another platform is that
        // platform's revenue line, and counting it here would double it.
        includeInAccounting: false,
        // These nights are held by the stay being written up, so the
        // availability check must not read them as a rival. Still set when the
        // host has moved the dates: an OTA block is often a day out, and the
        // server keeps the guard that matters — nights already covered by a
        // confirmation or a paid booking of ours are refused either way.
        documentsExistingStay: true,
      });
      await downloadBookingConfirmationPdf(confirmation);
      setDone(confirmation.confirmationNo);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        const dates = (cause.body as { conflictDates?: string[] } | undefined)?.conflictDates;
        setError(dates?.length
          ? `A confirmation already covers ${dates.join(', ')}. Look for it in the console rather than issuing a second one.`
          : cause.message);
      } else {
        setError(cause instanceof Error ? cause.message : 'Could not issue the confirmation.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={sheetBackdropClass} onClick={onClose} role="presentation">
      <div
        className={sheetPanelClass}
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Issue booking confirmation"
      >
        <div className="pt-2.5 sticky top-0 bg-surface z-10">
          <div className="w-10 h-1 rounded-full bg-line-strong mx-auto" />
          <div className="flex items-start gap-2 px-5 pt-3 pb-3.5 border-b border-line">
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <h2 className="text-[20px] tracking-[-0.3px] truncate">Booking confirmation</h2>
              <span className="text-[13px] text-ink-muted truncate">
                {stay.propertyName} · booked {stay.checkInDate} → {stay.checkOutDate}
              </span>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1 -mr-1 mt-0.5">
              <X className="w-5 h-5 text-ink-soft" />
            </button>
          </div>
        </div>

        <div className="px-5 pt-4 flex flex-col gap-4">
          {error && (
            <div className="flex items-start gap-2.5 bg-danger-tint text-danger border border-danger/20
              rounded-control px-3.5 py-3 text-[13px]">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1 min-w-0">{error}</span>
            </div>
          )}

          {done ? (
            <div className="flex flex-col gap-3 py-2">
              <div className="flex items-start gap-2.5 bg-ok-tint text-ok border border-ok/20
                rounded-control px-3.5 py-3 text-[13px]">
                <Check className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="flex-1 min-w-0">
                  {done} issued. The PDF has been saved to this device — send it on to the guest from there.
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="h-13 min-h-[52px] rounded-control bg-brand text-white
                  font-['Plus_Jakarta_Sans'] text-[15px] font-bold"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div className="rounded-control border border-line bg-subtle px-3.5 py-3 text-[13px] text-ink-soft
                leading-snug">
                From <span className="font-semibold text-ink">{stay.channel}</span>, at{' '}
                <span className="font-semibold text-ink">{stay.propertyName}</span>. The house is fixed —
                issue from the right booking to change it.
              </div>

              {dateMode === 'locked' && (
                <div className="rounded-control border border-line bg-surface px-3.5 py-3
                  flex items-center gap-3">
                  <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                    <span className="text-[15px] text-ink truncate">
                      {checkInDate} → {checkOutDate}
                    </span>
                    <span className={`text-[12px] ${datesMoved ? 'text-warn font-semibold' : 'text-ink-muted'}`}>
                      {nights} {nights === 1 ? 'night' : 'nights'} · in 15:00, out 10:00
                      {datesMoved ? ' · edited for the PDF' : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setDateMode('warning')}
                    className="shrink-0 h-9 px-3 rounded-control border border-line-strong bg-surface
                      flex items-center gap-1.5 text-[13px] font-semibold text-ink"
                  >
                    <PencilLine className="w-3.5 h-3.5" />
                    Edit
                  </button>
                </div>
              )}

              {dateMode === 'warning' && (
                <div className="rounded-control border border-warn/30 bg-warn-tint px-3.5 py-3
                  flex flex-col gap-2.5">
                  <span className="flex items-start gap-2.5 text-[13px] text-warn leading-snug">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span className="flex-1 min-w-0">
                      This changes the PDF only. The booking stays as {stay.channel} has it, and the
                      calendar keeps {stay.checkInDate} → {stay.checkOutDate} blocked exactly as they
                      are. The guest will hold you to whatever the PDF says — so if the stay itself
                      really moved, change it on {stay.channel} as well.
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setDateMode('locked')}
                      className="flex-1 h-10 rounded-control border border-line-strong bg-surface
                        text-[14px] font-semibold text-ink"
                    >
                      Keep them
                    </button>
                    <button
                      type="button"
                      onClick={() => setDateMode('editing')}
                      className="flex-1 h-10 rounded-control bg-warn text-white text-[14px] font-semibold"
                    >
                      Edit anyway
                    </button>
                  </span>
                </div>
              )}

              {dateMode === 'editing' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className={labelClass}>Check-in *</span>
                      <input
                        type="date"
                        value={checkInDate}
                        onChange={(event) => { setCheckInDate(event.target.value); setError(null); }}
                        className={fieldClass}
                      />
                    </label>
                    <label className="block">
                      <span className={labelClass}>Check-out *</span>
                      <input
                        type="date"
                        value={checkOutDate}
                        onChange={(event) => { setCheckOutDate(event.target.value); setError(null); }}
                        className={fieldClass}
                      />
                    </label>
                  </div>

                  {!datesValid ? (
                    <p className="-mt-2 text-[12px] text-danger leading-snug">
                      Check-out has to be after check-in.
                    </p>
                  ) : (
                    <div className="-mt-2 flex flex-col items-start gap-1">
                      <p className={`text-[12px] leading-snug ${datesMoved ? 'text-warn' : 'text-ink-muted'}`}>
                        {nights} {nights === 1 ? 'night' : 'nights'}
                        {datesMoved
                          ? ` on the PDF — the calendar still holds ${stay.checkInDate} to ${stay.checkOutDate}.`
                          : ', matching the booking.'}
                      </p>
                      {datesMoved && (
                        <button
                          type="button"
                          onClick={() => {
                            setCheckInDate(stay.checkInDate);
                            setCheckOutDate(stay.checkOutDate);
                            setError(null);
                          }}
                          className="text-[12px] font-semibold text-link underline"
                        >
                          Put the booking dates back
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}

              <label className="block">
                <span className={labelClass}>Guest name *</span>
                <input
                  value={guestName}
                  onChange={(event) => { setGuestName(event.target.value); setError(null); }}
                  className={fieldClass}
                  placeholder={stay.guestName ? undefined : 'The feed did not carry a name'}
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={labelClass}>Guests</span>
                  <input
                    value={numGuests}
                    onChange={(event) => setNumGuests(event.target.value)}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    className={`${fieldClass} tabular-nums`}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Room fee *</span>
                  <input
                    value={roomFee}
                    onChange={(event) => { setRoomFee(event.target.value); setError(null); }}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    className={`${fieldClass} tabular-nums`}
                    placeholder="0"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={labelClass}>Cleaning fee</span>
                  <input
                    value={cleaningFee}
                    onChange={(event) => setCleaningFee(event.target.value)}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    className={`${fieldClass} tabular-nums`}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Already paid</span>
                  <input
                    value={depositPaid}
                    onChange={(event) => setDepositPaid(event.target.value)}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    className={`${fieldClass} tabular-nums`}
                  />
                </label>
              </div>

              <div className="rounded-control border border-line bg-subtle px-3.5 py-3 flex flex-col gap-1.5">
                <span className="flex items-baseline justify-between gap-3 text-[14px]">
                  <span className="text-ink-soft">Total</span>
                  <span className="font-semibold text-ink tabular-nums">{money(totals.total)}</span>
                </span>
                <span className="flex items-baseline justify-between gap-3 text-[14px]">
                  <span className="text-ink-soft">Balance due</span>
                  <span className={`font-semibold tabular-nums ${
                    totals.balance > 0 ? 'text-warn' : 'text-ok'
                  }`}>
                    {money(totals.balance)}
                  </span>
                </span>
              </div>

              <label className="block">
                <span className={labelClass}>Guest email</span>
                <input
                  value={guestEmail}
                  onChange={(event) => setGuestEmail(event.target.value)}
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  className={fieldClass}
                  placeholder="Optional — printed on the PDF"
                />
              </label>

              <label className="block">
                <span className={labelClass}>Notes</span>
                <input
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className={fieldClass}
                  placeholder="Late arrival, parking…"
                />
              </label>

              <button
                type="button"
                onClick={() => { void handleIssue(); }}
                disabled={!canIssue}
                className="h-13 min-h-[52px] rounded-control bg-brand text-white
                  font-['Plus_Jakarta_Sans'] text-[15px] font-bold flex items-center justify-center gap-2
                  disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Issue and download PDF
              </button>
              <p className="-mt-1 text-[12px] text-ink-muted leading-snug">
                Kept out of the accounting totals: a stay paid on another platform is already counted there.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BookingConfirmSheet;
