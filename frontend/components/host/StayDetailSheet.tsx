import React from 'react';
import { format, parseISO } from 'date-fns';
import { Check, Link2, X } from 'lucide-react';
import { channelColor, formatMoney, HostStay, nightsBetween } from '../../services/hostApp';
import { CheckInSubmission } from '../../types';

/**
 * What one booking actually is, for a host who just tapped its row.
 *
 * Everything here comes from the calendar payload the screen already holds —
 * opening this makes no request. That is why the contents differ by source:
 * a direct booking knows what was paid, an OTA import does not and instead
 * carries the feed's own text, which is usually where the reservation code
 * hides. Showing empty rows for the fields a source cannot answer would be
 * worse than showing fewer.
 */
export interface StayDetailSheetProps {
  stay: HostStay | null;
  /**
   * The matching guest ID record.
   *
   * Three states, and they mean different things: `undefined` — this screen
   * never looked, so the block is hidden; `null` — looked and found nothing,
   * so the host is offered the check-in link; a record — show it.
   */
  submission?: CheckInSubmission | null;
  onClose: () => void;
  /** Omitted where the screen has nothing to copy (no link, no permission). */
  onCopyCheckInLink?: (propertyId: string) => void;
  copied?: boolean;
}

const longDate = (iso: string): string => {
  try {
    return format(parseISO(iso), 'EEE d MMM yyyy');
  } catch {
    return iso;
  }
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-baseline gap-3 py-2.5 border-b border-line last:border-b-0">
    <span className="w-[92px] shrink-0 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
      {label}
    </span>
    <span className="flex-1 min-w-0 text-[15px] text-ink">{children}</span>
  </div>
);

export const StayDetailSheet: React.FC<StayDetailSheetProps> = ({
  stay,
  submission,
  onClose,
  onCopyCheckInLink,
  copied = false,
}) => {
  if (!stay) return null;

  const nights = nightsBetween(stay.checkInDate, stay.checkOutDate);
  const status = stay.kind === 'hold'
    ? { label: 'Unpaid hold', className: 'bg-hold-tint text-hold' }
    : stay.kind === 'imported'
      ? { label: `Synced from ${stay.feedName || stay.channel}`, className: 'bg-brand-tint text-ink-soft' }
      : { label: 'Confirmed', className: 'bg-ok-tint text-ok' };

  return (
    <div
      className="fixed inset-0 z-50 bg-brand/60 backdrop-blur-sm flex items-end animate-dialog-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full bg-surface rounded-t-[24px] max-h-[88dvh] overflow-y-auto animate-dialog-panel"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Booking detail"
      >
        <div className="sticky top-0 bg-surface pt-2.5">
          <div className="w-10 h-1 rounded-full bg-line-strong mx-auto" />
          <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-3.5 border-b border-line">
            <div className="min-w-0 flex flex-col gap-1.5">
              <h2 className="text-[20px] tracking-[-0.3px] truncate">
                {stay.guestName || `${stay.channel} guest`}
              </h2>
              <span className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-[3px] shrink-0"
                  style={{ background: channelColor(stay.channel) }}
                />
                <span className="text-[13px] text-ink-soft truncate">{stay.channel}</span>
              </span>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1 -mr-1">
              <X className="w-5 h-5 text-ink-soft" />
            </button>
          </div>
        </div>

        <div className="px-5 pt-1">
          <Field label="House">{stay.propertyName}</Field>
          <Field label="Check-in">{longDate(stay.checkInDate)}</Field>
          <Field label="Check-out">{longDate(stay.checkOutDate)}</Field>
          <Field label="Nights">{nights > 0 ? `${nights}` : '—'}</Field>
          {stay.guestCount !== null && <Field label="Guests">{stay.guestCount}</Field>}
          {stay.amountTotal !== null && (
            <Field label="Paid">{formatMoney(stay.amountTotal, stay.currency)}</Field>
          )}
          <Field label="Status">
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${status.className}`}>
              {status.label}
            </span>
          </Field>
          {stay.bookingId && (
            <Field label="Reference">
              <span className="text-[13px] font-mono text-ink-soft break-all">{stay.bookingId}</span>
            </Field>
          )}
        </div>

        {/* The feed text, verbatim. It is written by the OTA, not by us, so it
            renders as plain text and never as markup. */}
        {(stay.summary || stay.description) && (
          <div className="px-5 pt-4">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted mb-2">
              From the feed
            </h3>
            <pre className="bg-subtle border border-line rounded-control p-3 text-[12px] leading-relaxed
              text-ink-soft whitespace-pre-wrap break-words font-['Inter']">
              {[stay.summary, stay.description].filter(Boolean).join('\n')}
            </pre>
          </div>
        )}

        {submission !== undefined && (
          <div className="px-5 pt-4">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted mb-2">
              Check-in record
            </h3>
            {submission ? (
              <ul className="bg-subtle border border-line rounded-control overflow-hidden">
                {submission.guests.map((guest) => (
                  <li key={guest.id} className="flex items-center gap-3 px-3.5 py-2.5 border-b border-line last:border-b-0">
                    <span className="flex-1 min-w-0 flex flex-col">
                      <span className="text-[14px] font-medium text-ink truncate">
                        {guest.fullName || 'Unnamed guest'}
                      </span>
                      <span className="text-[12px] text-ink-muted truncate">
                        {[guest.nationality, guest.contactInfo].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </span>
                    {guest.evidenceUrl ? (
                      <span className="inline-flex items-center gap-1 bg-ok-tint text-ok rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0">
                        <Check className="w-3 h-3" strokeWidth={3} />ID
                      </span>
                    ) : (
                      <span className="bg-warn-tint text-warn rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0">
                        No ID
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="bg-warn-tint border border-warn/20 rounded-control px-3.5 py-3 flex flex-col gap-2.5">
                <span className="text-[13px] text-warn">
                  No check-in record for this arrival yet.
                </span>
                {onCopyCheckInLink && (
                  <button
                    type="button"
                    onClick={() => onCopyCheckInLink(stay.propertyId)}
                    className="h-10 rounded-control bg-surface border border-line-strong
                      flex items-center justify-center gap-1.5 text-[14px] font-semibold text-ink"
                  >
                    {copied
                      ? <><Check className="w-4 h-4" /> Link copied</>
                      : <><Link2 className="w-4 h-4" /> Copy check-in link</>}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default StayDetailSheet;
