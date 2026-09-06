import React, { useState } from 'react';
import { AlertCircle, Ban, Check, Loader2, Undo2, X } from 'lucide-react';
import { HostCalendarData, HostProperty, propertyColor } from '../../services/hostApp';

/**
 * Block or release the selected nights, one property at a time.
 *
 * There is no property picker: every property gets a row showing what the
 * selection means for it, because the answer differs per property — three
 * nights free on one, already booked on another. Picking first and finding out
 * afterwards is the wrong order.
 *
 * Only manual blocks can be lifted. A night held by an iCal import belongs to
 * the platform that sent it; "unblocking" it here would put the room back on
 * sale while Airbnb still has it sold.
 */
export interface BlockSheetProps {
  dates: string[];
  properties: HostProperty[];
  calendars: Map<string, HostCalendarData>;
  onClose: () => void;
  onApply: (propertyId: string, dates: string[], action: 'block' | 'unblock') => Promise<void>;
}

interface Split {
  /** Free to block. */
  free: string[];
  /** Blocked by hand, so releasable. */
  manual: string[];
  /** Held by a booking or another platform — not ours to touch. */
  taken: string[];
}

function splitSelection(dates: string[], calendar: HostCalendarData | undefined): Split {
  const free: string[] = [];
  const manual: string[] = [];
  const taken: string[] = [];

  dates.forEach((date) => {
    if (!calendar) { free.push(date); return; }
    if (calendar.manualBlockedDates.has(date)) manual.push(date);
    else if (calendar.blockedDates.has(date)) taken.push(date);
    else free.push(date);
  });

  return { free, manual, taken };
}

const nightsWord = (count: number) => `${count} ${count === 1 ? 'night' : 'nights'}`;

export const BlockSheet: React.FC<BlockSheetProps> = ({
  dates,
  properties,
  calendars,
  onClose,
  onApply,
}) => {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);

  const run = async (propertyId: string, target: string[], action: 'block' | 'unblock') => {
    setPendingId(propertyId);
    setError(null);
    try {
      await onApply(propertyId, target, action);
      setDoneId(propertyId);
      window.setTimeout(() => setDoneId(null), 1800);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the calendar.');
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-brand/60 backdrop-blur-sm flex items-end animate-dialog-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full bg-surface rounded-t-[24px] max-h-[86dvh] overflow-y-auto animate-dialog-panel"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Block nights"
      >
        <div className="pt-2.5">
          <div className="w-10 h-1 rounded-full bg-line-strong mx-auto" />
          <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-3.5 border-b border-line">
            <div className="min-w-0 flex flex-col gap-0.5">
              <h2 className="text-[20px] tracking-[-0.3px]">Block nights</h2>
              <span className="text-[13px] text-ink-muted">
                {nightsWord(dates.length)} selected
              </span>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1 -mr-1">
              <X className="w-5 h-5 text-ink-soft" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-4 flex items-start gap-2.5 bg-danger-tint text-danger border border-danger/20
            rounded-control px-3.5 py-3 text-[13px]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1 min-w-0">{error}</span>
          </div>
        )}

        <ul className="px-5 py-2">
          {properties.map((property, index) => {
            const split = splitSelection(dates, calendars.get(property.id));
            const busy = pendingId === property.id;
            const justDone = doneId === property.id;

            const action: 'block' | 'unblock' | null = split.free.length > 0
              ? 'block'
              : split.manual.length > 0 ? 'unblock' : null;
            const target = action === 'block' ? split.free : split.manual;

            return (
              <li key={property.id} className="flex items-center gap-3 py-3 border-b border-line last:border-b-0">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: propertyColor(index) }}
                />
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="text-[15px] font-medium text-ink truncate">{property.name}</span>
                  <span className="text-[12px] text-ink-muted truncate">
                    {[
                      split.free.length ? `${split.free.length} free` : null,
                      split.manual.length ? `${split.manual.length} blocked` : null,
                      split.taken.length ? `${split.taken.length} booked` : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </span>

                {justDone ? (
                  <span className="shrink-0 flex items-center gap-1.5 text-[13px] font-semibold text-ok">
                    <Check className="w-4 h-4" /> Saved
                  </span>
                ) : action === null ? (
                  <span className="shrink-0 text-[13px] text-ink-muted">Booked</span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => { void run(property.id, target, action); }}
                    className={`shrink-0 h-10 px-3.5 rounded-control flex items-center gap-1.5
                      text-[13px] font-semibold disabled:opacity-60 ${
                        action === 'block'
                          ? 'bg-brand text-white'
                          : 'bg-surface border border-line-strong text-ink'
                      }`}
                  >
                    {busy
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : action === 'block'
                        ? <Ban className="w-4 h-4" />
                        : <Undo2 className="w-4 h-4" />}
                    {action === 'block' ? `Block ${split.free.length}` : `Unblock ${split.manual.length}`}
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <p className="px-5 pt-1 text-[12px] text-ink-muted leading-relaxed">
          Only nights you blocked by hand can be released here. Nights held by a booking or
          synced from another platform stay put.
        </p>
      </div>
    </div>
  );
};

export default BlockSheet;
