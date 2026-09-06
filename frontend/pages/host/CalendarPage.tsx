import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { Ban, ChevronLeft, ChevronRight, RefreshCw, Tag, X, Zap } from 'lucide-react';
import { HostCard, HostEmpty, HostScreen } from '../../components/host/HostScreen';
import { useHostContext } from '../../components/host/HostShell';
import { BlockSheet } from '../../components/host/BlockSheet';
import { QuoteSheet } from '../../components/host/QuoteSheet';
import { StayDetailSheet } from '../../components/host/StayDetailSheet';
import { HOST_TAB_BAR_HEIGHT } from '../../components/host/HostTabBar';
import { addBlockedDates, removeBlockedDates } from '../../services/calendar';
import {
  arrivalsOn,
  channelColor,
  datesInRange,
  departuresOn,
  HostCalendarData,
  HostStay,
  loadCalendars,
  propertyColor,
  toIsoDate,
  todayIso,
} from '../../services/hostApp';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/** A night the host took off the market by hand — no guest behind it. */
const BLOCKED_COLOR = '#6b7280';

interface Segment {
  stay: HostStay;
  isStart: boolean;
  isEnd: boolean;
}

/**
 * One entry per calendar day a stay touches, check-in through check-out
 * inclusive, so the band visibly starts on the arrival day ("In") and ends on
 * the departure day ("Out") rather than stopping a day short. Two segments on
 * one day for one property is a same-day turnover, and the cell splits.
 *
 * Keyed `propertyId|date` — one flat map beats a map of maps for the lookup
 * every cell does for every property row.
 */
function buildBands(calendars: Map<string, HostCalendarData>): Map<string, Segment[]> {
  const bands = new Map<string, Segment[]>();

  calendars.forEach((calendar) => {
    calendar.stays.forEach((stay) => {
      datesInRange(stay.checkInDate, stay.checkOutDate).forEach((iso) => {
        const key = `${stay.propertyId}|${iso}`;
        const list = bands.get(key) ?? [];
        list.push({ stay, isStart: iso === stay.checkInDate, isEnd: iso === stay.checkOutDate });
        bands.set(key, list);
      });
    });
  });

  return bands;
}

interface Selection {
  anchor: string;
  end: string;
}

const CalendarPage: React.FC = () => {
  const { properties, propertiesError } = useHostContext();
  const today = todayIso();

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [calendars, setCalendars] = useState<Map<string, HostCalendarData>>(new Map());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [sheet, setSheet] = useState<'block' | 'quote' | null>(null);
  const [openStay, setOpenStay] = useState<HostStay | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const propertyIds = useMemo(() => properties.map((property) => property.id), [properties]);

  useEffect(() => {
    if (propertyIds.length === 0) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setError(null);

    loadCalendars(propertyIds)
      .then((result) => {
        if (cancelled) return;
        setCalendars(result.calendars);
        if (result.failedPropertyIds.length > 0) {
          const names = result.failedPropertyIds
            .map((id) => properties.find((property) => property.id === id)?.name ?? id)
            .join(', ');
          setError(`Could not load ${names}. The rest of the month is up to date.`);
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Could not load your calendars.');
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
        setIsRefreshing(false);
      });

    return () => { cancelled = true; };
  }, [propertyIds, properties, reloadKey]);

  const reload = useCallback(() => {
    setIsRefreshing(true);
    setReloadKey((key) => key + 1);
  }, []);

  const visibleProperties = properties.filter((property) => !hiddenIds.has(property.id));
  const bands = useMemo(() => buildBands(calendars), [calendars]);

  const days = useMemo(
    () => eachDayOfInterval({ start: startOfWeek(startOfMonth(month)), end: endOfWeek(endOfMonth(month)) }),
    [month],
  );

  const selectedDates = useMemo(() => {
    if (!selection) return [];
    const [from, to] = selection.anchor <= selection.end
      ? [selection.anchor, selection.end]
      : [selection.end, selection.anchor];
    return datesInRange(from, to);
  }, [selection]);
  const selectedSet = useMemo(() => new Set(selectedDates), [selectedDates]);

  /**
   * Tap once to pick a day, tap again to reach to it.
   *
   * Drag-select is the desktop gesture and it fights scrolling on a phone, so
   * the range is two taps: the first sets an anchor, the second the far end. A
   * third tap starts over, which is what someone who has just mis-picked
   * expects to happen.
   */
  const handleDayTap = (iso: string) => {
    setSelection((current) => {
      if (!current) return { anchor: iso, end: iso };
      if (current.anchor !== current.end) return { anchor: iso, end: iso };
      if (current.anchor === iso) return null;
      return { anchor: current.anchor, end: iso };
    });
  };

  const applyBlock = async (propertyId: string, dates: string[], action: 'block' | 'unblock') => {
    if (action === 'block') await addBlockedDates(propertyId, dates);
    else await removeBlockedDates(propertyId, dates);
    reload();
  };

  const allStays = useMemo(
    () => visibleProperties.flatMap((property) => calendars.get(property.id)?.stays ?? []),
    [visibleProperties, calendars],
  );
  const detailIso = selectedDates.length === 1 ? selectedDates[0] : null;
  const detailArrivals = useMemo(
    () => (detailIso ? arrivalsOn(allStays, detailIso) : []),
    [allStays, detailIso],
  );
  const detailDepartures = useMemo(
    () => (detailIso ? departuresOn(allStays, detailIso) : []),
    [allStays, detailIso],
  );

  const rowCount = Math.max(1, visibleProperties.length);
  const nightsLabel = `${selectedDates.length} ${selectedDates.length === 1 ? 'night' : 'nights'}`;

  return (
    <HostScreen
      title="Calendar"
      error={propertiesError ?? error}
      isLoading={isLoading}
      action={
        <button
          type="button"
          onClick={reload}
          aria-label="Refresh"
          className="w-10 h-10 rounded-full bg-surface border border-line flex items-center justify-center text-ink-soft"
        >
          <RefreshCw className={`w-[19px] h-[19px] ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      }
    >
      {properties.length === 0 ? (
        <HostCard>
          <HostEmpty>No properties are assigned to your account yet.</HostEmpty>
        </HostCard>
      ) : (
        <>
          {properties.length > 1 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
              {properties.map((property, index) => {
                const on = !hiddenIds.has(property.id);
                const color = propertyColor(index);
                return (
                  <button
                    key={property.id}
                    type="button"
                    onClick={() => setHiddenIds((current) => {
                      const next = new Set(current);
                      if (next.has(property.id)) next.delete(property.id);
                      else next.add(property.id);
                      return next;
                    })}
                    style={on ? { backgroundColor: color } : undefined}
                    className={`h-[34px] px-3.5 rounded-full text-[13px] font-semibold whitespace-nowrap shrink-0
                      inline-flex items-center gap-1.5 ${
                        on ? 'text-white' : 'bg-surface border border-line text-ink-muted'
                      }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: on ? 'rgba(255,255,255,0.85)' : color }}
                    />
                    {property.name}
                  </button>
                );
              })}
            </div>
          )}

          <HostCard padded className="!px-2 !py-3">
            <div className="flex items-center justify-between px-1 mb-2">
              <button
                type="button"
                onClick={() => setMonth((value) => subMonths(value, 1))}
                aria-label="Previous month"
                className="w-10 h-10 rounded-control flex items-center justify-center text-ink-soft active:bg-subtle"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <h2 className="text-[16px]">{format(month, 'MMMM yyyy')}</h2>
              <button
                type="button"
                onClick={() => setMonth((value) => addMonths(value, 1))}
                aria-label="Next month"
                className="w-10 h-10 rounded-control flex items-center justify-center text-ink-soft active:bg-subtle"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map((label, index) => (
                <span key={index} className="text-center text-[10px] font-semibold text-ink-muted py-1">
                  {label}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-y-1">
              {days.map((day) => {
                const iso = toIsoDate(day);
                const inMonth = isSameMonth(day, month);
                const isToday = iso === today;
                const isSelected = selectedSet.has(iso);
                const isWeekStart = day.getDay() === 0;
                const isWeekEnd = day.getDay() === 6;
                const turnovers = visibleProperties.filter(
                  (property) => (bands.get(`${property.id}|${iso}`) ?? []).some((seg) => seg.isEnd),
                ).length;

                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => handleDayTap(iso)}
                    style={{ minHeight: `${30 + rowCount * 16}px` }}
                    className={`relative flex flex-col items-center gap-1 py-1 rounded-[8px] transition-colors ${
                      !inMonth ? 'opacity-40' : ''
                    } ${isSelected ? 'bg-brand-tint ring-2 ring-inset ring-brand' : 'active:bg-subtle'}`}
                  >
                    <span className="flex items-center gap-0.5 leading-none">
                      <span
                        className={
                          isToday
                            ? 'inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-brand px-1 text-[12px] font-bold text-white'
                            : 'text-[12px] font-medium text-ink'
                        }
                      >
                        {day.getDate()}
                      </span>
                      {turnovers > 1 && (
                        <Zap className="w-2.5 h-2.5 text-warn" aria-label={`${turnovers} turnovers`} />
                      )}
                    </span>

                    <span className="flex flex-col gap-[2px] w-full px-px">
                      {visibleProperties.map((property) => {
                        const index = properties.findIndex((item) => item.id === property.id);
                        const color = propertyColor(index);
                        const segs = bands.get(`${property.id}|${iso}`) ?? [];
                        const manualBlocked = calendars.get(property.id)?.manualBlockedDates.has(iso);

                        if (segs.length === 0) {
                          if (manualBlocked) {
                            return (
                              <span
                                key={property.id}
                                className={`block h-[13px] w-full ${isWeekStart ? 'rounded-l-[4px]' : ''} ${
                                  isWeekEnd ? 'rounded-r-[4px]' : ''
                                }`}
                                style={{ background: BLOCKED_COLOR }}
                              />
                            );
                          }
                          return <span key={property.id} className="block h-[13px] w-full" />;
                        }

                        if (segs.length >= 2) {
                          return (
                            <span key={property.id} className="relative flex h-[13px] w-full gap-px">
                              <span
                                className={`flex-1 flex items-center justify-center rounded-r-[4px] text-[7px] font-bold uppercase text-white ${
                                  isWeekStart ? 'rounded-l-[4px]' : ''
                                }`}
                                style={{ background: color }}
                              >
                                Out
                              </span>
                              <span
                                className={`flex-1 flex items-center justify-center rounded-l-[4px] text-[7px] font-bold uppercase text-white ${
                                  isWeekEnd ? 'rounded-r-[4px]' : ''
                                }`}
                                style={{ background: color }}
                              >
                                In
                              </span>
                            </span>
                          );
                        }

                        const seg = segs[0];
                        if (seg.isStart && !seg.isEnd) {
                          return (
                            <span key={property.id} className="flex h-[13px] w-full">
                              <span className="flex-1" />
                              <span
                                className={`flex-1 flex items-center justify-center rounded-l-[4px] text-[7px] font-bold uppercase text-white ${
                                  isWeekEnd ? 'rounded-r-[4px]' : ''
                                }`}
                                style={{ background: color }}
                              >
                                In
                              </span>
                            </span>
                          );
                        }
                        if (seg.isEnd && !seg.isStart) {
                          return (
                            <span key={property.id} className="flex h-[13px] w-full">
                              <span
                                className={`flex-1 flex items-center justify-center rounded-r-[4px] text-[7px] font-bold uppercase text-white ${
                                  isWeekStart ? 'rounded-l-[4px]' : ''
                                }`}
                                style={{ background: color }}
                              >
                                Out
                              </span>
                              <span className="flex-1" />
                            </span>
                          );
                        }
                        return (
                          <span
                            key={property.id}
                            className={`block h-[13px] w-full ${isWeekStart ? 'rounded-l-[4px]' : ''} ${
                              isWeekEnd ? 'rounded-r-[4px]' : ''
                            }`}
                            style={{ background: color }}
                          />
                        );
                      })}
                    </span>
                  </button>
                );
              })}
            </div>
          </HostCard>

          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 px-0.5">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: BLOCKED_COLOR }} />
              <span className="text-[12px] text-ink-soft">Blocked</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-warn" />
              <span className="text-[12px] text-ink-soft">Turnover</span>
            </span>
            <span className="text-[12px] text-ink-muted">Tap a day, then a second to pick a range</span>
          </div>

          {detailIso && (detailArrivals.length > 0 || detailDepartures.length > 0) && (
            <HostCard title={format(parseISO(detailIso), 'EEE, d MMMM')}>
              {[
                ...detailDepartures.map((stay) => ({ stay, kind: 'out' as const })),
                ...detailArrivals.map((stay) => ({ stay, kind: 'in' as const })),
              ].map(({ stay, kind }, index, all) => (
                <button
                  type="button"
                  key={`${kind}-${stay.key}`}
                  onClick={() => setOpenStay(stay)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 min-h-14 text-left active:bg-subtle ${
                    index === all.length - 1 ? '' : 'border-b border-line'
                  }`}
                >
                  <span className="w-1 h-8 rounded-sm shrink-0" style={{ background: channelColor(stay.channel) }} />
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="text-[14px] font-semibold text-ink truncate">
                      {kind === 'out' ? 'Check-out' : 'Check-in'}
                      {stay.guestName ? ` · ${stay.guestName}` : ''}
                    </span>
                    <span className="text-[12px] text-ink-muted truncate">
                      {[stay.propertyName, stay.channel, stay.kind === 'hold' ? 'Unpaid hold' : null]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <ChevronRight className="w-[18px] h-[18px] text-line-strong shrink-0" />
                </button>
              ))}
            </HostCard>
          )}

          {/* Room for the action bar so it never sits on top of the last card. */}
          {selectedDates.length > 0 && <div className="h-16 shrink-0" aria-hidden />}
        </>
      )}

      {selectedDates.length > 0 && (
        <div
          className="fixed left-0 right-0 z-40 px-3"
          style={{ bottom: `calc(${HOST_TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom, 16px) + 0.5rem)` }}
        >
          <div className="bg-brand text-white rounded-card shadow-lg flex items-center gap-2 pl-4 pr-2 py-2">
            <span className="flex-1 min-w-0 flex flex-col">
              <span className="text-[14px] font-semibold">{nightsLabel}</span>
              <span className="text-[12px] text-white/70 truncate">
                {format(parseISO(selectedDates[0]), 'd MMM')}
                {selectedDates.length > 1 && ` – ${format(parseISO(selectedDates[selectedDates.length - 1]), 'd MMM')}`}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setSheet('block')}
              className="h-11 px-3.5 rounded-control bg-white/15 flex items-center gap-1.5 text-[13px] font-semibold"
            >
              <Ban className="w-4 h-4" /> Block
            </button>
            <button
              type="button"
              onClick={() => setSheet('quote')}
              className="h-11 px-3.5 rounded-control bg-surface text-ink flex items-center gap-1.5 text-[13px] font-semibold"
            >
              <Tag className="w-4 h-4" /> Quote
            </button>
            <button
              type="button"
              onClick={() => setSelection(null)}
              aria-label="Clear selection"
              className="w-9 h-11 flex items-center justify-center text-white/70"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {sheet === 'block' && (
        <BlockSheet
          dates={selectedDates}
          properties={visibleProperties}
          calendars={calendars}
          onClose={() => setSheet(null)}
          onApply={applyBlock}
        />
      )}

      {sheet === 'quote' && (
        <QuoteSheet
          dates={selectedDates}
          properties={visibleProperties}
          calendars={calendars}
          onClose={() => { setSheet(null); setSelection(null); }}
          onCreated={reload}
        />
      )}

      {/* No `submission` prop: this screen never fetches ID records, and
          claiming none exists would be a guess. */}
      <StayDetailSheet stay={openStay} onClose={() => setOpenStay(null)} />
    </HostScreen>
  );
};

export default CalendarPage;
