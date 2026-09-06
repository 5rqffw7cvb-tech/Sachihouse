import React, { useEffect, useMemo, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { HostCard, HostEmpty, HostScreen } from '../../components/host/HostScreen';
import { useHostContext } from '../../components/host/HostShell';
import { getPropertyCalendar } from '../../services/calendar';
import {
  arrivalsOn,
  channelColor,
  departuresOn,
  HostStay,
  staysFromCalendar,
  toIsoDate,
  todayIso,
} from '../../services/hostApp';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/** A host block with no stay behind it — same grey the cleaning calendar uses
 *  for a manual entry. */
const BLOCKED_COLOR = '#6b7280';

interface DayBars {
  left: string | null;
  right: string | null;
}

/**
 * One bar per night, split in half at the turnover.
 *
 * A stay occupies the nights from its check-in date up to (not including) its
 * check-out date, so the arrival day is only busy from midday and the
 * departure day only until morning. Painting those two as halves is what lets
 * a host see at a glance that a same-day turnover is a same-day turnover, and
 * not two nights blocked.
 */
function buildDayBars(stays: HostStay[], blockedDates: Set<string>, isoDates: string[]): Map<string, DayBars> {
  const bars = new Map<string, DayBars>();

  isoDates.forEach((iso) => {
    let left: string | null = null;
    let right: string | null = null;

    for (const stay of stays) {
      // Holds are nights someone has taken but not paid for. They still block
      // the calendar, so they are drawn — the detail list says which is which.
      const color = channelColor(stay.channel);
      if (stay.checkInDate < iso && iso < stay.checkOutDate) {
        left = left ?? color;
        right = right ?? color;
      } else if (stay.checkInDate === iso && iso < stay.checkOutDate) {
        right = right ?? color;
      } else if (stay.checkOutDate === iso && stay.checkInDate < iso) {
        left = left ?? color;
      }
    }

    if (blockedDates.has(iso)) {
      left = left ?? BLOCKED_COLOR;
      right = right ?? BLOCKED_COLOR;
    }

    bars.set(iso, { left, right });
  });

  return bars;
}

const CalendarPage: React.FC = () => {
  const { properties, propertiesError } = useHostContext();
  const today = todayIso();

  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedIso, setSelectedIso] = useState(today);
  const [stays, setStays] = useState<HostStay[]>([]);
  const [blockedDates, setBlockedDates] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!propertyId && properties.length > 0) {
      setPropertyId(properties[0].id);
    }
  }, [properties, propertyId]);

  useEffect(() => {
    if (!propertyId) {
      if (properties.length === 0) setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getPropertyCalendar(propertyId)
      .then((calendar) => {
        if (cancelled) return;
        setStays(staysFromCalendar(calendar));
        setBlockedDates(new Set(calendar.manualBlockedDates));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setStays([]);
        setBlockedDates(new Set());
        setError(cause instanceof Error ? cause.message : 'Could not load this calendar.');
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, [propertyId, properties.length]);

  const days = useMemo(
    () => eachDayOfInterval({ start: startOfWeek(startOfMonth(month)), end: endOfWeek(endOfMonth(month)) }),
    [month],
  );

  const bars = useMemo(
    () => buildDayBars(stays, blockedDates, days.map(toIsoDate)),
    [stays, blockedDates, days],
  );

  const legend = useMemo(() => {
    const channels = Array.from(new Set(stays.map((stay) => stay.channel)));
    if (blockedDates.size > 0) channels.push('Blocked');
    return channels;
  }, [stays, blockedDates]);

  const selectedArrivals = useMemo(() => arrivalsOn(stays, selectedIso), [stays, selectedIso]);
  const selectedDepartures = useMemo(() => departuresOn(stays, selectedIso), [stays, selectedIso]);
  const selectedProperty = properties.find((property) => property.id === propertyId);

  return (
    <HostScreen title="Calendar" error={propertiesError ?? error} isLoading={isLoading && !propertyId}>
      {properties.length === 0 ? (
        <HostCard>
          <HostEmpty>No properties are assigned to your account yet.</HostEmpty>
        </HostCard>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 h-11">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMonth((value) => subMonths(value, 1))}
                aria-label="Previous month"
                className="w-9 h-9 rounded-control flex items-center justify-center text-ink-soft active:bg-subtle"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <h2 className="text-[18px] text-center min-w-[150px]">{format(month, 'MMMM yyyy')}</h2>
              <button
                type="button"
                onClick={() => setMonth((value) => addMonths(value, 1))}
                aria-label="Next month"
                className="w-9 h-9 rounded-control flex items-center justify-center text-ink-soft active:bg-subtle"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => { setMonth(startOfMonth(new Date())); setSelectedIso(today); }}
              className="h-8 px-3 rounded-full bg-surface border border-line-strong text-[13px] font-semibold text-ink"
            >
              Today
            </button>
          </div>

          {properties.length > 1 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
              {properties.map((property) => (
                <button
                  key={property.id}
                  type="button"
                  onClick={() => setPropertyId(property.id)}
                  className={`h-[34px] px-3.5 rounded-full text-[13px] whitespace-nowrap shrink-0 ${
                    property.id === propertyId
                      ? 'bg-brand text-white font-semibold'
                      : 'bg-surface border border-line text-ink-soft font-medium'
                  }`}
                >
                  {property.name}
                </button>
              ))}
            </div>
          )}

          <HostCard>
            <div className="grid grid-cols-7 h-[26px] items-center border-b border-line">
              {WEEKDAYS.map((label, index) => (
                <span key={index} className="text-center text-[11px] font-semibold text-ink-muted">
                  {label}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-y-1.5 pt-1.5 pb-2.5">
              {days.map((day) => {
                const iso = toIsoDate(day);
                const dayBars = bars.get(iso) ?? { left: null, right: null };
                const inMonth = isSameMonth(day, month);
                const isToday = iso === today;
                const isSelected = iso === selectedIso;

                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => setSelectedIso(iso)}
                    className={`h-12 flex flex-col items-center gap-[5px] pt-1.5 ${
                      isSelected ? 'bg-brand-tint rounded-[10px]' : ''
                    }`}
                  >
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[13px] font-semibold ${
                        isToday ? 'bg-brand text-white' : inMonth ? 'text-ink' : 'text-line-strong'
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    <span className="w-full h-1.5 flex">
                      <span className="flex-1" style={{ background: dayBars.left ?? 'transparent' }} />
                      <span className="flex-1" style={{ background: dayBars.right ?? 'transparent' }} />
                    </span>
                  </button>
                );
              })}
            </div>
          </HostCard>

          {legend.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 px-0.5">
              {legend.map((channel) => (
                <span key={channel} className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-[2px]"
                    style={{ background: channel === 'Blocked' ? BLOCKED_COLOR : channelColor(channel) }}
                  />
                  <span className="text-[12px] text-ink-soft">{channel}</span>
                </span>
              ))}
            </div>
          )}

          <HostCard
            title={format(new Date(`${selectedIso}T00:00:00`), 'EEE, d MMMM')}
            action={<span className="text-[12px] text-ink-muted truncate">{selectedProperty?.name}</span>}
          >
            {selectedArrivals.length === 0 && selectedDepartures.length === 0 ? (
              <HostEmpty>Nothing scheduled on this day.</HostEmpty>
            ) : (
              [
                ...selectedDepartures.map((stay) => ({ stay, kind: 'out' as const })),
                ...selectedArrivals.map((stay) => ({ stay, kind: 'in' as const })),
              ].map(({ stay, kind }, index, all) => (
                <div
                  key={`${kind}-${stay.key}`}
                  className={`flex items-center gap-3 px-4 py-2.5 min-h-14 ${
                    index === all.length - 1 ? '' : 'border-b border-line'
                  }`}
                >
                  <span
                    className="w-1 h-8 rounded-sm shrink-0"
                    style={{ background: channelColor(stay.channel) }}
                  />
                  <div className="flex-1 min-w-0 flex flex-col">
                    <span className="text-[14px] font-semibold text-ink truncate">
                      {kind === 'out' ? 'Check-out' : 'Check-in'}
                      {stay.guestName ? ` · ${stay.guestName}` : ''}
                    </span>
                    <span className="text-[12px] text-ink-muted truncate">
                      {[
                        stay.channel,
                        stay.guestCount ? `${stay.guestCount} guests` : null,
                        stay.kind === 'hold' ? 'Unpaid hold' : null,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                </div>
              ))
            )}
          </HostCard>
        </>
      )}
    </HostScreen>
  );
};

export default CalendarPage;
