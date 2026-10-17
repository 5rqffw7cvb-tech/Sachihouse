import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, Loader2, PencilLine, X } from 'lucide-react';
import { CleaningPayout } from '../../services/cleaningPayouts';
import { channelColor, HostStay, nightsBetween } from '../../services/hostApp';
import { formatYen, shortDateRange, stayRef } from '../../utils/cleaningPay';
import { sheetPanelClass } from './sheetControls';

/**
 * The stay a cleaning payout is for: a field that opens a second sheet with
 * the stays as rich rows — channel, guest, dates and whether it is paid —
 * instead of the phone's native picker, which can only show one line of
 * plain text per option.
 */

export const MANUAL_STAY = 'manual';

type Filter = 'unpaid' | 'paid' | 'all';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'paid', label: 'Paid' },
  { value: 'all', label: 'All' },
];

export interface StayPickerProps {
  stays: HostStay[] | null;
  paidByRef: Map<string, CleaningPayout>;
  today: string;
  /** A stayRef, MANUAL_STAY, or '' for nothing chosen. */
  value: string;
  onChange: (value: string) => void;
}

const ChannelBadge: React.FC<{ channel: string }> = ({ channel }) => (
  <span
    className="w-10 h-10 rounded-[12px] shrink-0 flex items-center justify-center
      text-white font-['Plus_Jakarta_Sans'] text-[15px] font-bold"
    style={{ backgroundColor: channelColor(channel) }}
    aria-hidden="true"
  >
    {channel.charAt(0).toUpperCase()}
  </span>
);

const chipClass = 'shrink-0 rounded-full px-1.5 py-[1px] text-[10px] font-bold tracking-[0.04em]';

/** Sits beside the guest's name, not at the row's end, so the dates line
 *  below keeps the full width and is never cut off. */
const StatusChip: React.FC<{ paid: boolean; staying: boolean }> = ({ paid, staying }) => {
  if (paid) return <span className={`${chipClass} bg-ok-tint text-ok`}>PAID</span>;
  if (staying) return <span className={`${chipClass} bg-brand-tint text-ink-soft`}>STAYING</span>;
  return null;
};

const StayRow: React.FC<{
  stay: HostStay;
  payout: CleaningPayout | undefined;
  staying: boolean;
}> = ({ stay, payout, staying }) => {
  const nights = nightsBetween(stay.checkInDate, stay.checkOutDate);
  return (
    <>
      <ChannelBadge channel={stay.channel} />
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-[15px] font-semibold text-ink truncate">{stay.guestName ?? stay.channel}</span>
          <StatusChip paid={Boolean(payout)} staying={staying} />
        </span>
        <span className="text-[13px] text-ink-muted truncate">
          {`${stay.propertyName} · ${shortDateRange(stay.checkInDate, stay.checkOutDate)} · ${nights} ${nights === 1 ? 'night' : 'nights'}`}
        </span>
      </span>
      {payout && (
        <span className="shrink-0 text-[13px] font-semibold text-ok tabular-nums">{formatYen(payout.total)}</span>
      )}
    </>
  );
};

export const StayPicker: React.FC<StayPickerProps> = ({ stays, paidByRef, today, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('unpaid');

  const selected = stays?.find((stay) => stayRef(stay) === value) ?? null;

  const groups = useMemo(() => {
    const visible = (stays ?? []).filter((stay) => {
      const paid = paidByRef.has(stayRef(stay));
      return filter === 'all' || (filter === 'paid' ? paid : !paid);
    });
    return [
      { title: 'In the house now', items: visible.filter((stay) => stay.checkOutDate > today) },
      { title: 'Checked out', items: visible.filter((stay) => stay.checkOutDate <= today) },
    ].filter((group) => group.items.length > 0);
  }, [stays, paidByRef, filter, today]);

  const counts = useMemo(() => {
    const all = stays?.length ?? 0;
    const paid = (stays ?? []).filter((stay) => paidByRef.has(stayRef(stay))).length;
    return { all, paid, unpaid: all - paid };
  }, [stays, paidByRef]);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={stays === null}
        aria-haspopup="dialog"
        className="w-full min-h-[64px] rounded-control border border-line bg-subtle px-3 py-2.5
          flex items-center gap-3 text-left active:bg-brand-tint disabled:active:bg-subtle"
      >
        {stays === null ? (
          <span className="flex-1 flex items-center gap-2 text-[15px] text-ink-muted">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading stays…
          </span>
        ) : selected ? (
          <StayRow
            stay={selected}
            payout={paidByRef.get(value)}
            staying={selected.checkOutDate > today}
          />
        ) : value === MANUAL_STAY ? (
          <>
            <span className="w-10 h-10 rounded-[12px] shrink-0 bg-surface border border-line flex items-center justify-center">
              <PencilLine className="w-[18px] h-[18px] text-ink-soft" />
            </span>
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="text-[15px] font-semibold text-ink">Entered by hand</span>
              <span className="text-[13px] text-ink-muted truncate">Not linked to a stay</span>
            </span>
          </>
        ) : (
          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="text-[15px] font-semibold text-ink">Choose a stay</span>
            <span className="text-[13px] text-ink-muted truncate">
              {counts.unpaid > 0 ? `${counts.unpaid} unpaid in the last 30 days` : 'Everything recent is paid'}
            </span>
          </span>
        )}
        <ChevronDown className="w-[18px] h-[18px] text-ink-muted shrink-0" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] bg-brand/40 flex items-end animate-dialog-backdrop"
          onClick={(event) => { event.stopPropagation(); setOpen(false); }}
          role="presentation"
        >
          <div
            className={sheetPanelClass}
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Choose a stay"
          >
            <div className="pt-2.5 sticky top-0 bg-surface z-10 border-b border-line">
              <div className="w-10 h-1 rounded-full bg-line-strong mx-auto" />
              <div className="flex items-center gap-2 px-5 pt-3 pb-3">
                <h2 className="flex-1 min-w-0 text-[20px] tracking-[-0.3px] truncate">Choose a stay</h2>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="shrink-0 p-1 -mr-1">
                  <X className="w-5 h-5 text-ink-soft" />
                </button>
              </div>
              <div className="px-5 pb-3">
                <div className="grid grid-cols-3 gap-1 rounded-control bg-subtle p-1" role="tablist">
                  {FILTERS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="tab"
                      aria-selected={filter === option.value}
                      onClick={() => setFilter(option.value)}
                      className={`h-9 rounded-[10px] text-[13px] font-semibold transition-colors ${
                        filter === option.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted'
                      }`}
                    >
                      {`${option.label} ${counts[option.value]}`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {groups.length === 0 ? (
              <p className="px-5 py-10 text-center text-[14px] text-ink-muted">
                {filter === 'unpaid' ? 'Nothing left to pay in the last 30 days.' : 'No stays here.'}
              </p>
            ) : groups.map((group) => (
              <section key={group.title}>
                <h3 className="px-5 pt-4 pb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
                  {group.title}
                </h3>
                <ul>
                  {group.items.map((stay) => {
                    const ref = stayRef(stay);
                    const isSelected = ref === value;
                    return (
                      <li key={stay.key}>
                        <button
                          type="button"
                          onClick={() => choose(ref)}
                          aria-pressed={isSelected}
                          className={`w-full px-5 py-2.5 flex items-center gap-3 text-left active:bg-subtle ${
                            isSelected ? 'bg-brand-tint' : ''
                          }`}
                        >
                          <StayRow stay={stay} payout={paidByRef.get(ref)} staying={stay.checkOutDate > today} />
                          {isSelected && <Check className="w-[18px] h-[18px] text-brand shrink-0" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}

            <div className="px-5 pt-4">
              <button
                type="button"
                onClick={() => choose(MANUAL_STAY)}
                className="w-full h-13 min-h-[52px] rounded-control border border-dashed border-line-strong
                  flex items-center justify-center gap-2 text-[15px] font-semibold text-ink-soft active:bg-subtle"
              >
                <PencilLine className="w-[18px] h-[18px]" />
                Enter by hand (no matching stay)
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StayPicker;
