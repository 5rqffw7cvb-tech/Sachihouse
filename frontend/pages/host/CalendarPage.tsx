import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Ban, ChevronLeft, ChevronRight, Plus, RefreshCw, Tag, X, Zap } from 'lucide-react';
import { HostCard, HostEmpty, HostScreen } from '../../components/host/HostScreen';
import { useHostContext } from '../../components/host/HostShell';
import { BlockSheet } from '../../components/host/BlockSheet';
import { EventSheet } from '../../components/host/EventSheet';
import { QuoteSheet } from '../../components/host/QuoteSheet';
import { StayDetailSheet } from '../../components/host/StayDetailSheet';
import { HOST_TAB_BAR_HEIGHT } from '../../components/host/HostTabBar';
import {
  addBlockedDates,
  createCalendarEvent,
  deleteCalendarEvent,
  removeBlockedDates,
  updateCalendarEvent,
} from '../../services/calendar';
import type {
  PropertyCalendarEvent,
  PropertyCalendarEventInput,
  PropertyCalendarEventPatch,
} from '../../services/calendar';
import {
  applyEventOp,
  arrivalsOn,
  channelColor,
  datesInRange,
  departuresOn,
  HostCalendarData,
  HostStay,
  loadCalendars,
  type PendingEventOp,
  propertyColor,
  putPendingOp,
  reconcilePendingEventOps,
  stayingOn,
  stayNights,
  toIsoDate,
  todayIso,
} from '../../services/hostApp';
import { assignLanes, nightRange } from '../../utils/stayLanes';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/** A night with no guest behind it: taken off the market by the host here,
 *  or by a channel manager whose feed only says "not available". */
const BLOCKED_COLOR = '#6b7280';

/** A pale yellow wash over a day with a host's event, so the day shows from
 *  across the month; the dots under the date still say whose it is. */
const EVENT_DAY_CLASS = 'bg-[#fef9c3]';

interface Segment {
  stay: HostStay;
  isStart: boolean;
  isEnd: boolean;
}

interface BandMap {
  /** Keyed `propertyId|lane|date`. */
  bands: Map<string, Segment[]>;
  /** Lanes a property needs this month, keyed by property id. */
  laneCounts: Map<string, number>;
}

/**
 * One entry per calendar day a stay touches, check-in through check-out
 * inclusive, so the band visibly starts on the arrival day ("In") and ends on
 * the departure day ("Out") rather than stopping a day short.
 *
 * A property gets one lane per party it holds at once. Lanes are assigned by
 * NIGHT, so a same-day turnover — where one guest leaves the morning another
 * arrives — stays in a single lane and keeps its compact "Out | In" cell. Only
 * a genuine overlap, two groups sharing the house over the same nights, opens
 * a second lane. Two segments in one lane on one day can therefore only mean a
 * turnover, which is what the cell renderer assumes.
 *
 * Keyed `propertyId|lane|date` — one flat map beats a map of maps for the
 * lookup every cell does for every lane of every property.
 */
function buildBands(calendars: Map<string, HostCalendarData>): BandMap {
  const bands = new Map<string, Segment[]>();
  const laneCounts = new Map<string, number>();

  calendars.forEach((calendar, propertyId) => {
    const { laned, laneCount } = assignLanes(
      calendar.stays,
      (stay) => nightRange(stay.checkInDate, stay.checkOutDate),
    );
    laneCounts.set(propertyId, laneCount);

    laned.forEach(({ item: stay, lane }) => {
      // A stay is drawn check-in through check-out so the band visibly opens
      // on "In" and closes on "Out". A block has neither: nobody arrives and
      // nobody leaves, so it covers only the nights it actually holds and is
      // marked as starting and ending nowhere — which keeps it out of the
      // half-bar and turnover branches the renderer reserves for a party.
      const isBlock = stay.kind === 'imported-block';
      const nights = isBlock ? nightRange(stay.checkInDate, stay.checkOutDate) : null;
      if (isBlock && !nights) return;
      const lastDay = nights ? nights.lastNight : stay.checkOutDate;

      datesInRange(stay.checkInDate, lastDay).forEach((iso) => {
        const key = `${stay.propertyId}|${lane}|${iso}`;
        const list = bands.get(key) ?? [];
        list.push({
          stay,
          isStart: !isBlock && iso === stay.checkInDate,
          isEnd: !isBlock && iso === stay.checkOutDate,
        });
        bands.set(key, list);
      });
    });
  });

  return { bands, laneCounts };
}

interface Selection {
  anchor: string;
  end: string;
}

type SheetState =
  | { kind: 'block' }
  | { kind: 'quote' }
  | { kind: 'create' }
  | { kind: 'edit'; event: PropertyCalendarEvent }
  | null;

const CalendarPage: React.FC = () => {
  const { properties, propertiesError } = useHostContext();
  const today = todayIso();

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [calendars, setCalendars] = useState<Map<string, HostCalendarData>>(new Map());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [openStay, setOpenStay] = useState<HostStay | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Events created, changed or removed here, until a load that started after
  // the change has answered. A load can read the server before the request
  // commits and land after it; without these, what the host just saved or
  // deleted would snap back until the next refresh. loadSeqRef numbers the
  // loads, so each op knows which loads are too old to trust.
  const loadSeqRef = useRef(0);
  const pendingOpsRef = useRef<PendingEventOp[]>([]);

  const propertyIds = useMemo(() => properties.map((property) => property.id), [properties]);

  useEffect(() => {
    if (propertyIds.length === 0) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    const seq = ++loadSeqRef.current;
    setError(null);
    // The grid is drawn from whatever has arrived, so the first property to
    // answer ends the blank screen instead of the last one. The spinner in
    // the header keeps turning until the rest are in, which is the honest
    // signal that the month is still filling rather than finished.
    setIsRefreshing(true);

    loadCalendars(propertyIds, (id, data) => {
      if (cancelled) return;
      const merged = reconcilePendingEventOps(new Map([[id, data]]), pendingOpsRef.current, seq);
      pendingOpsRef.current = merged.stillPending;
      setCalendars((prev) => new Map(prev).set(id, merged.calendars.get(id)!));
      setIsLoading(false);
    }, { refresh: reloadKey > 0 })
      .then((result) => {
        if (cancelled) return;
        // Reconcile: a property that has since been removed, or one that
        // failed this round, must not linger from the previous load.
        const merged = reconcilePendingEventOps(result.calendars, pendingOpsRef.current, seq);
        pendingOpsRef.current = merged.stillPending;
        setCalendars(merged.calendars);
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
  // Where a new event can go: a property on screen whose calendar has loaded,
  // since an event put on a missing calendar would have nowhere to show.
  // Computed each render like visibleProperties, which is itself a new array
  // every time, so a memo here would never hit.
  const eventProperties = visibleProperties.filter((property) => calendars.has(property.id));
  const { bands, laneCounts } = useMemo(() => buildBands(calendars), [calendars]);

  // A host's own appointments, grouped by day in the order the day runs. The
  // full property list is walked, not the visible one, so each event keeps
  // the colour its property has on the filter chips.
  const eventsByDate = useMemo(() => {
    const byDate = new Map<string, Array<{
      event: PropertyCalendarEvent;
      color: string;
      propertyName: string;
      order: number;
    }>>();
    properties.forEach((property, index) => {
      if (hiddenIds.has(property.id)) return;
      (calendars.get(property.id)?.events ?? []).forEach((event) => {
        const list = byDate.get(event.date) ?? [];
        list.push({ event, color: propertyColor(index), propertyName: property.name, order: index });
        byDate.set(event.date, list);
      });
    });
    byDate.forEach((list) => list.sort((a, b) =>
      a.event.startTime.localeCompare(b.event.startTime)
      || a.event.endTime.localeCompare(b.event.endTime)
      || a.order - b.order));
    return byDate;
  }, [properties, hiddenIds, calendars]);

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

  // No reload after an event change: the change is put straight into the
  // calendar it belongs to, and kept pending so a load already in flight
  // cannot undo it. Each op takes the number of the latest load after the
  // request has returned — a load started later read the server after it.
  const recordOp = (op: PendingEventOp) => {
    pendingOpsRef.current = putPendingOp(pendingOpsRef.current, op);
    setCalendars((prev) => applyEventOp(prev, op));
  };

  // Each closes only its own sheet: by the time the request returns, the
  // host may already be looking at another one.
  const createEvent = async (propertyId: string, input: PropertyCalendarEventInput) => {
    const event = await createCalendarEvent(propertyId, input);
    recordOp({ kind: 'upsert', event, seq: loadSeqRef.current });
    setSheet((current) => (current?.kind === 'create' ? null : current));
  };

  const updateEvent = async (event: PropertyCalendarEvent, patch: PropertyCalendarEventPatch) => {
    const updated = await updateCalendarEvent(event.id, patch);
    recordOp({ kind: 'upsert', event: updated, seq: loadSeqRef.current });
    setSheet((current) => (current?.kind === 'edit' && current.event.id === event.id ? null : current));
  };

  const deleteEvent = async (event: PropertyCalendarEvent) => {
    await deleteCalendarEvent(event.id);
    recordOp({ kind: 'delete', id: event.id, propertyId: event.propertyId, seq: loadSeqRef.current });
    setSheet((current) => (current?.kind === 'edit' && current.event.id === event.id ? null : current));
  };

  const allStays = useMemo(
    () => visibleProperties.flatMap((property) => calendars.get(property.id)?.stays ?? []),
    [visibleProperties, calendars],
  );
  const detailIso = selectedDates.length === 1 ? selectedDates[0] : null;

  /**
   * Everything sitting on the tapped day, in the order the day happens.
   *
   * This used to be arrivals and departures only, so tapping the middle of a
   * five-night stay answered with nothing at all — the one booking filling the
   * cell the host had just pointed at was the one thing they could not open.
   * A night in progress is an entry like any other; so is a night the host
   * took off the market, which is the other reason a cell is not free.
   *
   * The host's own events lead the list: they are what the host put on the
   * day themselves, and they never hold a night, so they sit apart from the
   * bookings and blocks below rather than among them.
   */
  const detailRows = useMemo(() => {
    if (!detailIso) return [];

    const rows: Array<{
      key: string;
      label: string;
      stay: HostStay | null;
      event: PropertyCalendarEvent | null;
      propertyName: string;
      channel: string | null;
      note: string | null;
      color?: string;
    }> = [];

    const fromStay = (stay: HostStay, label: string) => ({
      key: `${label}-${stay.key}`,
      label,
      stay,
      event: null,
      propertyName: stay.propertyName,
      channel: stay.channel,
      note: stay.kind === 'hold' ? 'Unpaid hold' : stay.kind === 'imported-block' ? 'No guest' : null,
    });

    (eventsByDate.get(detailIso) ?? []).forEach(({ event, color, propertyName }) => rows.push({
      key: `event-${event.id}`,
      label: `${event.startTime}–${event.endTime} · ${event.title}`,
      stay: null,
      event,
      propertyName,
      channel: null,
      note: event.note || null,
      color,
    }));

    // Check-out first: the morning happens before the afternoon, and it is the
    // one that decides whether anybody has to be in the building.
    departuresOn(allStays, detailIso).forEach((stay) => rows.push(fromStay(stay, 'Check-out')));
    arrivalsOn(allStays, detailIso).forEach((stay) => rows.push(fromStay(stay, 'Check-in')));
    stayingOn(allStays, detailIso)
      .filter((stay) => stay.kind !== 'imported-block')
      .forEach((stay) => rows.push(fromStay(stay, 'Staying')));

    // Blocks are matched on the nights they hold, not through stayingOn. They
    // have no arrival or departure row to appear under, and stayingOn counts
    // only the nights strictly inside a stay — which between them would drop
    // the first night of every block off the day it covers.
    allStays
      .filter((stay) => stay.kind === 'imported-block' && stayNights(stay).includes(detailIso))
      .forEach((stay) => rows.push(fromStay(stay, 'Blocked')));

    // A day the host blocked by hand has no stay behind it to open, but it is
    // why the cell is grey, and an empty card under a grey day is the same
    // dead end this list exists to close.
    for (const property of visibleProperties) {
      if (calendars.get(property.id)?.manualBlockedDates.has(detailIso)) {
        rows.push({
          key: `manual-${property.id}`,
          label: 'Blocked',
          stay: null,
          event: null,
          propertyName: property.name,
          channel: null,
          note: 'Blocked here',
        });
      }
    }

    return rows;
  }, [allStays, detailIso, visibleProperties, calendars, eventsByDate]);

  // One rendered band per lane. A property holding one party at a time still
  // contributes exactly one, so a month with no overlap looks as it always did.
  const laneRows = useMemo(
    () => visibleProperties.flatMap((property) => Array.from(
      { length: laneCounts.get(property.id) ?? 1 },
      (_, lane) => ({ property, lane }),
    )),
    [visibleProperties, laneCounts],
  );
  const rowCount = Math.max(1, laneRows.length);
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
                const turnovers = laneRows.filter(
                  ({ property, lane }) => (bands.get(`${property.id}|${lane}|${iso}`) ?? [])
                    .some((seg) => seg.isEnd),
                ).length;
                const dayEvents = eventsByDate.get(iso) ?? [];

                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => handleDayTap(iso)}
                    style={{ minHeight: `${30 + rowCount * 16}px` }}
                    className={`relative flex flex-col items-center gap-1 py-1 rounded-[8px] transition-colors ${
                      !inMonth ? 'opacity-40' : ''
                    } ${
                      isSelected
                        ? 'bg-brand-tint ring-2 ring-inset ring-brand'
                        : dayEvents.length > 0
                          ? `${EVENT_DAY_CLASS} active:bg-subtle`
                          : 'active:bg-subtle'
                    }`}
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

                    {/* Event dots get their own row, tucked into the gap-1
                        between the date row and the bands: -my-1 cancels
                        the extra gap this row adds, so the cell keeps its
                        height. */}
                    {dayEvents.length > 0 && (
                      <span
                        aria-hidden="true"
                        className="flex h-1 -my-1 max-w-full items-center justify-center gap-px overflow-hidden"
                      >
                        {dayEvents.slice(0, 3).map(({ event, color }) => (
                          <span
                            key={event.id}
                            data-event-dot
                            className="block w-1 h-1 shrink-0 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </span>
                    )}

                    <span className="flex flex-col gap-[2px] w-full px-px">
                      {laneRows.map(({ property, lane }) => {
                        const index = properties.findIndex((item) => item.id === property.id);
                        const color = propertyColor(index);
                        const segs = bands.get(`${property.id}|${lane}|${iso}`) ?? [];
                        // A manual block belongs to the property, not to a
                        // party, so it is drawn once on the first lane.
                        const manualBlocked = lane === 0
                          && calendars.get(property.id)?.manualBlockedDates.has(iso);

                        if (segs.length === 0) {
                          if (manualBlocked) {
                            return (
                              <span
                                key={`${property.id}|${lane}`}
                                className={`block h-[13px] w-full ${isWeekStart ? 'rounded-l-[4px]' : ''} ${
                                  isWeekEnd ? 'rounded-r-[4px]' : ''
                                }`}
                                style={{ background: BLOCKED_COLOR }}
                              />
                            );
                          }
                          return <span key={`${property.id}|${lane}`} className="block h-[13px] w-full" />;
                        }

                        if (segs.length >= 2) {
                          return (
                            <span key={`${property.id}|${lane}`} className="relative flex h-[13px] w-full gap-px">
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
                            <span key={`${property.id}|${lane}`} className="flex h-[13px] w-full">
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
                            <span key={`${property.id}|${lane}`} className="flex h-[13px] w-full">
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
                            key={`${property.id}|${lane}`}
                            className={`block h-[13px] w-full ${isWeekStart ? 'rounded-l-[4px]' : ''} ${
                              isWeekEnd ? 'rounded-r-[4px]' : ''
                            }`}
                            style={{ background: seg.stay.kind === 'imported-block' ? BLOCKED_COLOR : color }}
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
            <span className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-[2px] ring-1 ring-inset ring-[#facc15] ${EVENT_DAY_CLASS}`} />
              <span className="text-[12px] text-ink-soft">Event</span>
            </span>
            <span className="text-[12px] text-ink-muted">Tap a day to see it, a second to pick a range</span>
          </div>

          {detailIso && (
            <HostCard title={format(parseISO(detailIso), 'EEE, d MMMM')}>
              <>
                {detailRows.length === 0 ? (
                  <HostEmpty>Nothing on this day. Tap a second day to pick a range.</HostEmpty>
                ) : detailRows.map((row, index) => {
                  const body = (
                    <>
                      <span
                        className="w-1 h-8 rounded-sm shrink-0"
                        style={{ background: row.color ?? (row.channel ? channelColor(row.channel) : BLOCKED_COLOR) }}
                      />
                      <span className="flex-1 min-w-0 flex flex-col">
                        <span className="text-[14px] font-semibold text-ink truncate">
                          {row.label}
                          {row.stay?.guestName ? ` · ${row.stay.guestName}` : ''}
                        </span>
                        <span className="text-[12px] text-ink-muted truncate">
                          {[row.propertyName, row.channel, row.note].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </>
                  );
                  const className = `w-full flex items-center gap-3 px-4 py-2.5 min-h-14 text-left ${
                    index === detailRows.length - 1 ? '' : 'border-b border-line'
                  }`;

                  // A manual block is the row with nothing behind it to open
                  // here. Rendering it as a button that does nothing would
                  // promise a detail screen that does not exist.
                  if (row.stay) {
                    return (
                      <button
                        type="button"
                        key={row.key}
                        onClick={() => setOpenStay(row.stay)}
                        className={`${className} active:bg-subtle`}
                      >
                        {body}
                        <ChevronRight className="w-[18px] h-[18px] text-line-strong shrink-0" />
                      </button>
                    );
                  }
                  return row.event ? (
                    <button
                      type="button"
                      key={row.key}
                      onClick={() => setSheet({ kind: 'edit', event: row.event! })}
                      className={`${className} active:bg-subtle`}
                    >
                      {body}
                      <ChevronRight className="w-[18px] h-[18px] text-line-strong shrink-0" />
                    </button>
                  ) : (
                    <div key={row.key} className={className}>{body}</div>
                  );
                })}
                {eventProperties.length > 0 && (
                  <div className="border-t border-line">
                    <button
                      type="button"
                      disabled={isRefreshing}
                      onClick={() => setSheet({ kind: 'create' })}
                      className="w-full h-12 flex items-center justify-center gap-1.5 text-[14px] font-semibold text-brand active:bg-subtle disabled:opacity-50"
                    >
                      <Plus className="w-4 h-4" /> Add event
                    </button>
                    {isRefreshing && (
                      <p className="px-4 pb-2.5 text-center text-[12px] text-ink-muted">Updating calendar…</p>
                    )}
                  </div>
                )}
              </>
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
              onClick={() => setSheet({ kind: 'block' })}
              className="h-11 px-3.5 rounded-control bg-white/15 flex items-center gap-1.5 text-[13px] font-semibold"
            >
              <Ban className="w-4 h-4" /> Block
            </button>
            <button
              type="button"
              onClick={() => setSheet({ kind: 'quote' })}
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

      {sheet?.kind === 'block' && (
        <BlockSheet
          dates={selectedDates}
          properties={visibleProperties}
          calendars={calendars}
          onClose={() => setSheet(null)}
          onApply={applyBlock}
        />
      )}

      {sheet?.kind === 'quote' && (
        <QuoteSheet
          dates={selectedDates}
          properties={visibleProperties}
          calendars={calendars}
          onClose={() => { setSheet(null); setSelection(null); }}
          onCreated={reload}
        />
      )}

      {sheet?.kind === 'create' && detailIso && (
        <EventSheet
          date={detailIso}
          properties={eventProperties}
          busy={isRefreshing}
          onClose={() => setSheet(null)}
          onCreate={createEvent}
        />
      )}

      {sheet?.kind === 'edit' && (
        <EventSheet
          key={sheet.event.id}
          event={sheet.event}
          propertyName={properties.find((property) => property.id === sheet.event.propertyId)?.name ?? ''}
          busy={isRefreshing}
          onClose={() => setSheet(null)}
          onUpdate={updateEvent}
          onDelete={deleteEvent}
        />
      )}

      {/* No `submission` prop: this screen never fetches ID records, and
          claiming none exists would be a guess. */}
      <StayDetailSheet stay={openStay} onClose={() => setOpenStay(null)} />
    </HostScreen>
  );
};

export default CalendarPage;
