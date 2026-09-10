import React, { useMemo, useState } from 'react';
import { AlertCircle, Check, Download, Loader2, X } from 'lucide-react';
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
  const [guestName, setGuestName] = useState(stay.guestName ?? '');
  const [guestEmail, setGuestEmail] = useState('');
  const [numGuests, setNumGuests] = useState(String(stay.guestCount ?? 2));
  const [roomFee, setRoomFee] = useState(stay.amountTotal !== null ? String(stay.amountTotal) : '');
  const [cleaningFee, setCleaningFee] = useState('0');
  const [depositPaid, setDepositPaid] = useState('0');
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const nights = nightsBetween(stay.checkInDate, stay.checkOutDate);
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

  const canIssue = Boolean(guestName.trim()) && roomFee.trim() !== '' && totals.total > 0 && !saving;

  const handleIssue = async () => {
    if (!property) {
      setError('This stay has no property on your account, so there is no address to print.');
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
        checkInDate: stay.checkInDate,
        checkOutDate: stay.checkOutDate,
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
        // The nights are already held — by this very stay.
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
                {stay.propertyName} · {stay.checkInDate} → {stay.checkOutDate}
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
                {nights > 0 ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : 'Dates'} from
                {' '}<span className="font-semibold text-ink">{stay.channel}</span>.
                The dates and the house come from the booking and cannot be edited here — change them on the
                platform that holds it.
              </div>

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
