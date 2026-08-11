import React, { useEffect, useMemo, useState } from 'react';
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
import { Building2, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Loader2, RefreshCw, Plus, Settings2, Sparkles, Trash2, X } from 'lucide-react';
import { AdminShell } from '../components/AdminShell';
import { Alert, Button, Card, EmptyState, Field, Select, Spinner } from '../components/ui';
import { PropertyTimeline, TimelineRow } from '../components/calendar/PropertyTimeline';
import { Night, Segment } from '../components/calendar/timeline';
import { getCurrentUser, subscribeToAuth } from '../services/auth';
import { getAllProperties } from '../services/storage';
import {
  addBlockedDates,
  DirectBooking,
  getPropertyCalendar,
  ImportedCalendarEvent,
  PropertyCalendar,
  regenerateIcalExportToken,
  removeBlockedDates,
  updateIcalFeeds,
} from '../services/calendar';
import { ApiUser } from '../services/api';
import { cancelBookingByHost, forceCancelBookingByHost } from '../services/booking';
import { getCleaningCalendarLink, regenerateCleaningCalendarLink } from '../services/cleaningCalendar';
import { ICalFeed, PropertyData } from '../types';

type PropertyItem = PropertyData & { id: string };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// A paid stay and an unpaid hold both take the night off the market, but they
// are not the same thing to a host, so the calendar distinguishes them.
type Occupancy = { name: string; kind: 'booking' | 'hold' };

// Maps each imported night to the event that covers it, so a calendar cell
// can show which platform blocked it and open the raw details on click.
function buildImportedEventMap(calendar: PropertyCalendar | null): Map<string, ImportedCalendarEvent> {
  const map = new Map<string, ImportedCalendarEvent>();
  for (const event of calendar?.importedEvents ?? []) {
    for (const iso of event.dates) {
      if (!map.has(iso)) map.set(iso, event);
    }
  }
  return map;
}

// Solid, near-brand colors for channels we can confidently name (detected
// from the feed's own text, e.g. a Hostex reservation code) — a bolder look
// than the generic "some iCal feed" amber signals that this label is a real
// classification, not a guess. Anything not in this map (including a channel
// we can't detect) falls back to the soft amber default.
const IMPORTED_CHANNEL_STYLES: Record<string, { chip: string; text: string }> = {
  Airbnb: { chip: 'bg-danger text-white hover:bg-danger', text: 'text-danger' },
  'Booking.com': { chip: 'bg-info text-white hover:bg-brand', text: 'text-info' },
  'Hostex Direct': { chip: 'bg-ok text-white hover:bg-ok', text: 'text-ok' },
};
const DEFAULT_IMPORTED_STYLE = { chip: 'bg-warn-tint text-warn hover:bg-warn-tint', text: 'text-warn' };

function importedEventStyle(channelName: string | null | undefined): { chip: string; text: string } {
  return (channelName && IMPORTED_CHANNEL_STYLES[channelName]) || DEFAULT_IMPORTED_STYLE;
}

// Expands bookings into a map of YYYY-MM-DD -> occupancy for the nights they
// take (check-out morning is free again, so it is excluded).
function buildOccupancyMap(calendar: PropertyCalendar | null): Map<string, Occupancy> {
  const map = new Map<string, Occupancy>();

  const claim = (checkInDate: string, checkOutDate: string, name: string, kind: Occupancy['kind']) => {
    const start = parseISO(checkInDate);
    const end = parseISO(checkOutDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(start < end)) return;
    for (const day of eachDayOfInterval({ start, end })) {
      const iso = format(day, 'yyyy-MM-dd');
      if (iso === checkOutDate) continue; // checkout day is available again
      if (!map.has(iso)) map.set(iso, { name, kind });
    }
  };

  for (const booking of calendar?.bookings ?? []) {
    claim(booking.checkInDate, booking.checkOutDate, booking.guestName || 'Reserved', 'booking');
  }
  // Without this the nights a guest already paid for would render as available
  // and clickable, which is worse than not showing them at all.
  for (const booking of calendar?.directBookings ?? []) {
    claim(
      booking.checkInDate,
      booking.checkOutDate,
      booking.guestName || 'Reserved',
      booking.status === 'confirmed' ? 'booking' : 'hold',
    );
  }

  return map;
}

const HostCalendarPage: React.FC = () => {
  const [authUser, setAuthUser] = useState<ApiUser | null>(getCurrentUser());
  const [properties, setProperties] = useState<PropertyItem[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [calendar, setCalendar] = useState<PropertyCalendar | null>(null);
  // Every accessible property's calendar, keyed by id. The timeline needs them
  // all at once; the panels below still work off the selected one.
  const [allCalendars, setAllCalendars] = useState<Map<string, PropertyCalendar>>(new Map());
  const [loadingTimeline, setLoadingTimeline] = useState(true);
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(new Date()));
  const [loadingProps, setLoadingProps] = useState(true);
  const [loadingCal, setLoadingCal] = useState(false);
  const [busyDates, setBusyDates] = useState<Set<string>>(new Set());
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Settings are hidden until asked for — the board is what the page is for.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // iCal import feed editor (local draft until Save).
  const [feedDraft, setFeedDraft] = useState<ICalFeed[]>([]);
  const [savingFeeds, setSavingFeeds] = useState(false);
  const [feedsSaved, setFeedsSaved] = useState(false);

  // Cleaning-staff calendar share link (one link, all properties).
  const [cleaningLink, setCleaningLink] = useState<string | null>(null);
  const [cleaningLinkCopied, setCleaningLinkCopied] = useState(false);
  const [regeneratingCleaningLink, setRegeneratingCleaningLink] = useState(false);

  const canAccess = authUser?.role === 'ADMIN' || authUser?.role === 'HOST';
  const isAdminUser = authUser?.role === 'ADMIN';

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => setAuthUser(user)).then((unsub) => { unsubscribe = unsub; });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Admin-only: this link is shared across every property, so a host
    // regenerating it would knock every other host's cleaning staff off
    // the calendar too. The backend enforces this too (403 for a host).
    if (!isAdminUser) return;
    getCleaningCalendarLink().then(setCleaningLink).catch(() => {});
  }, [isAdminUser]);

  const copyCleaningLink = async () => {
    if (!cleaningLink) return;
    try {
      await navigator.clipboard.writeText(cleaningLink);
      setCleaningLinkCopied(true);
      setTimeout(() => setCleaningLinkCopied(false), 1800);
    } catch {
      setErrorMsg('Could not copy to clipboard.');
    }
  };

  const handleRegenerateCleaningLink = async () => {
    if (!window.confirm('Generate a new cleaning-calendar link? The old one will stop working — anyone using it (including staff who added it to their home screen) will need the new link.')) return;
    setRegeneratingCleaningLink(true);
    try {
      const url = await regenerateCleaningCalendarLink();
      setCleaningLink(url);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to regenerate the cleaning-calendar link.');
    } finally {
      setRegeneratingCleaningLink(false);
    }
  };

  const scopedProperties = useMemo(() => {
    if (!authUser) return [] as PropertyItem[];
    if (authUser.role === 'ADMIN') return properties;
    const assigned = new Set(authUser.assignedPropertyIds ?? []);
    return properties.filter((p) => assigned.has(p.id));
  }, [authUser, properties]);

  // Load the property list once we know who the user is.
  useEffect(() => {
    if (!canAccess) { setLoadingProps(false); return; }
    let cancelled = false;
    (async () => {
      setLoadingProps(true);
      try {
        const all = await getAllProperties({ includeArchived: true });
        if (!cancelled) setProperties(all);
      } catch (err) {
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : 'Failed to load properties.');
      } finally {
        if (!cancelled) setLoadingProps(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canAccess]);

  // Auto-select the first accessible property.
  useEffect(() => {
    if (!selectedPropertyId && scopedProperties.length > 0) {
      setSelectedPropertyId(scopedProperties[0].id);
    }
  }, [scopedProperties, selectedPropertyId]);

  const loadCalendar = async (propertyId: string) => {
    if (!propertyId) { setCalendar(null); return; }
    setLoadingCal(true);
    setErrorMsg(null);
    try {
      const data = await getPropertyCalendar(propertyId);
      setCalendar(data);
      setFeedDraft(data.icalFeeds);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load calendar.');
      setCalendar(null);
    } finally {
      setLoadingCal(false);
    }
  };

  useEffect(() => {
    void loadCalendar(selectedPropertyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPropertyId]);

  // Fetch every accessible calendar for the timeline. allSettled so one broken
  // feed does not blank the whole board — that property simply shows as free.
  useEffect(() => {
    if (scopedProperties.length === 0) { setLoadingTimeline(false); return; }
    let cancelled = false;
    (async () => {
      setLoadingTimeline(true);
      const results = await Promise.allSettled(
        scopedProperties.map((p) => getPropertyCalendar(p.id).then((c) => [p.id, c] as const)),
      );
      if (cancelled) return;
      const next = new Map<string, PropertyCalendar>();
      for (const r of results) {
        if (r.status === 'fulfilled') next.set(r.value[0], r.value[1]);
      }
      setAllCalendars(next);
      setLoadingTimeline(false);
    })();
    return () => { cancelled = true; };
  }, [scopedProperties]);

  const manualSet = useMemo(() => new Set(calendar?.manualBlockedDates ?? []), [calendar]);
  const importedSet = useMemo(() => new Set(calendar?.importedBlockedDates ?? []), [calendar]);
  const occupancyMap = useMemo(() => buildOccupancyMap(calendar), [calendar]);
  const importedEventMap = useMemo(() => buildImportedEventMap(calendar), [calendar]);
  const [selectedImportedEvent, setSelectedImportedEvent] = useState<ImportedCalendarEvent | null>(null);

  const gridDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [viewMonth]);

  const todayIso = format(new Date(), 'yyyy-MM-dd');

  // The timeline shows the selected month, one column per day.
  const timelineDays = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(viewMonth), end: endOfMonth(viewMonth) })
      .map((d) => format(d, 'yyyy-MM-dd')),
    [viewMonth],
  );

  // Precedence matters: a paid stay outranks a hold, which outranks an imported
  // block, which outranks a manual one. Whichever claims a night decides how it
  // is drawn and whether it can be clicked.
  const timelineRows: TimelineRow[] = useMemo(() => scopedProperties.map((property) => {
    const cal = allCalendars.get(property.id);
    const nights = new Map<string, Night>();

    for (const iso of cal?.manualBlockedDates ?? []) nights.set(iso, { kind: 'manual' });

    for (const event of cal?.importedEvents ?? []) {
      const label = event.channelName || event.feedName || 'iCal';
      for (const iso of event.dates) nights.set(iso, { kind: 'imported', label, ref: `${event.feedId}:${event.checkInDate}` });
    }
    // Imported nights with no event attached still have to look blocked.
    for (const iso of cal?.importedBlockedDates ?? []) {
      if (!nights.has(iso) || nights.get(iso)!.kind === 'manual') {
        nights.set(iso, { kind: 'imported', label: 'iCal' });
      }
    }

    for (const booking of cal?.directBookings ?? []) {
      const kind = booking.status === 'confirmed' ? 'booking' : 'hold';
      for (const iso of eachDayOfInterval({
        start: parseISO(booking.checkInDate),
        end: parseISO(booking.checkOutDate),
      }).slice(0, -1).map((d) => format(d, 'yyyy-MM-dd'))) {
        nights.set(iso, { kind, label: booking.guestName, ref: booking.id });
      }
    }

    return {
      id: property.id,
      name: property.name || property.id,
      imageUrl: property.galleryImages?.[0]?.url || property.hostImageUrl,
      nights,
    };
  }), [scopedProperties, allCalendars]);

  /** Block or free a night on any property, not just the selected one. */
  const toggleNight = async (propertyId: string, iso: string) => {
    const key = `${propertyId}:${iso}`;
    if (busyDates.has(key)) return;
    const cal = allCalendars.get(propertyId);
    if (!cal) return;
    const isBlocked = (cal.manualBlockedDates ?? []).includes(iso);

    setBusyDates((prev) => new Set(prev).add(key));
    setErrorMsg(null);
    try {
      const next = isBlocked
        ? await removeBlockedDates(propertyId, [iso])
        : await addBlockedDates(propertyId, [iso]);
      setAllCalendars((prev) => {
        const clone = new Map(prev);
        const entry = clone.get(propertyId);
        if (entry) clone.set(propertyId, { ...entry, manualBlockedDates: next });
        return clone;
      });
      setCalendar((prev) => (prev && prev.propertyId === propertyId ? { ...prev, manualBlockedDates: next } : prev));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update the date.');
    } finally {
      setBusyDates((prev) => {
        const clone = new Set(prev);
        clone.delete(key);
        return clone;
      });
    }
  };

  /** Clicking a property's name in the timeline opens its settings. */
  const openSettingsFor = (propertyId: string) => {
    setSelectedPropertyId(propertyId);
    setSettingsOpen(true);
  };

  /** Opening an imported bar shows the raw event, same as the old grid did. */
  const handleSelectSegment = (propertyId: string, segment: Segment) => {
    if (segment.kind !== 'imported') return;
    const iso = timelineDays[segment.start];
    const event = (allCalendars.get(propertyId)?.importedEvents ?? []).find((e) => e.dates.includes(iso));
    if (event) setSelectedImportedEvent(event);
  };

  const toggleDay = async (iso: string) => {
    if (!calendar) return;
    // Imported dates, direct bookings and unpaid holds are read-only here.
    if (importedSet.has(iso) || occupancyMap.has(iso)) return;
    if (busyDates.has(iso)) return;

    const isBlocked = manualSet.has(iso);
    setBusyDates((prev) => new Set(prev).add(iso));
    setErrorMsg(null);
    try {
      const next = isBlocked
        ? await removeBlockedDates(calendar.propertyId, [iso])
        : await addBlockedDates(calendar.propertyId, [iso]);
      setCalendar((prev) => (prev ? { ...prev, manualBlockedDates: next } : prev));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update the date.');
    } finally {
      setBusyDates((prev) => {
        const clone = new Set(prev);
        clone.delete(iso);
        return clone;
      });
    }
  };

  // Always a full refund — the guest did nothing wrong, so the host (not the
  // guest) absorbs the Stripe processing fee. Only a paid booking can be
  // cancelled this way; an unpaid hold just expires on its own.
  const handleCancelBooking = async (booking: DirectBooking) => {
    const reason = window.prompt(
      `Cancel ${booking.guestName}'s booking (${booking.checkInDate} → ${booking.checkOutDate})?\n\n`
      + `This refunds ¥${booking.amountTotal.toLocaleString()} in full and cannot be undone. `
      + `The guest is emailed automatically.\n\nOptional reason (included in that email):`,
    );
    if (reason === null) return; // dismissed the prompt
    setCancellingId(booking.id);
    setErrorMsg(null);
    try {
      await cancelBookingByHost(booking.id, reason || undefined);
      if (calendar) void loadCalendar(calendar.propertyId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to cancel the booking.');
    } finally {
      setCancellingId(null);
    }
  };

  // Admin-only escape hatch: cancels without calling Stripe at all. Meant for
  // a booking whose payment intent Stripe can never refund any more — most
  // commonly a leftover test-mode booking after switching to a live secret
  // key — or one already refunded manually outside the system.
  const handleForceCancelBooking = async (booking: DirectBooking) => {
    const reason = window.prompt(
      `Force-cancel ${booking.guestName}'s booking (${booking.checkInDate} → ${booking.checkOutDate})?\n\n`
      + 'This does NOT call Stripe and does NOT refund anything automatically. '
      + 'Only use this when a refund is impossible (e.g. a leftover test-mode booking) '
      + 'or the guest was already refunded manually.\n\nOptional reason (included in the guest email):',
    );
    if (reason === null) return;
    setCancellingId(booking.id);
    setErrorMsg(null);
    try {
      await forceCancelBookingByHost(booking.id, reason || undefined);
      if (calendar) void loadCalendar(calendar.propertyId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to force-cancel the booking.');
    } finally {
      setCancellingId(null);
    }
  };

  const copyExportUrl = async () => {
    if (!calendar?.exportUrl) return;
    try {
      await navigator.clipboard.writeText(calendar.exportUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setErrorMsg('Could not copy to clipboard.');
    }
  };

  const handleRegenerate = async () => {
    if (!calendar) return;
    if (!window.confirm('Regenerate the export link? Any platform using the old link will stop receiving updates until you share the new one.')) return;
    try {
      const exportUrl = await regenerateIcalExportToken(calendar.propertyId);
      setCalendar((prev) => (prev ? { ...prev, exportUrl } : prev));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to regenerate the export link.');
    }
  };

  // ---- iCal import feed editor ----
  const addFeedRow = () => {
    setFeedsSaved(false);
    setFeedDraft((prev) => [
      ...prev,
      { id: `feed_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: '', url: '', lastSynced: '' },
    ]);
  };

  const updateFeedRow = (id: string, field: 'name' | 'url', value: string) => {
    setFeedsSaved(false);
    setFeedDraft((prev) => prev.map((f) => (f.id === id ? { ...f, [field]: value } : f)));
  };

  const removeFeedRow = (id: string) => {
    setFeedsSaved(false);
    setFeedDraft((prev) => prev.filter((f) => f.id !== id));
  };

  const saveFeeds = async () => {
    if (!calendar) return;
    setSavingFeeds(true);
    setErrorMsg(null);
    try {
      const cleaned = feedDraft.filter((f) => f.url.trim());
      const saved = await updateIcalFeeds(calendar.propertyId, cleaned);
      setCalendar((prev) => (prev ? { ...prev, icalFeeds: saved } : prev));
      setFeedDraft(saved);
      setFeedsSaved(true);
      // Re-pull so imported dates from any new feed show up.
      void loadCalendar(calendar.propertyId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save iCal feeds.');
    } finally {
      setSavingFeeds(false);
    }
  };

  return (
    <AdminShell
      title="Calendar"
      subtitle="Block dates manually and sync availability with other platforms via iCal."
      access="host"
      activeKey="calendar"
      signInMessage="Please login as host/admin to manage the calendar."
      deniedTitle="Host or admin role required"
      deniedMessage="Your current account does not have permission to manage the calendar."
      actions={(
        <Button
          icon={Settings2}
          onClick={() => setSettingsOpen(true)}
          disabled={scopedProperties.length === 0}
        >
          Settings
        </Button>
      )}
    >
        {errorMsg && <Alert tone="danger" onDismiss={() => setErrorMsg(null)}>{errorMsg}</Alert>}

        {/* Every property against the month, so "who can I put where" is one glance. */}
        <Card padded={false} className="mb-5">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                icon={ChevronLeft}
                aria-label="Previous month"
                onClick={() => setViewMonth((m) => subMonths(m, 1))}
              />
              <span className="text-[15px] font-bold text-ink min-w-[9.5rem] text-center">
                {format(viewMonth, 'MMMM yyyy')}
              </span>
              <Button
                variant="ghost"
                size="sm"
                icon={ChevronRight}
                aria-label="Next month"
                onClick={() => setViewMonth((m) => addMonths(m, 1))}
              />
              <Button size="sm" className="ml-2" onClick={() => setViewMonth(startOfMonth(new Date()))}>Today</Button>
            </div>
            {loadingTimeline && <Loader2 className="h-4 w-4 animate-spin text-ink-muted" />}
          </div>

          {loadingTimeline ? (
            <Spinner label="Loading calendars…" />
          ) : timelineRows.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No properties to show"
              description="Properties assigned to your account will appear here."
            />
          ) : (
            <PropertyTimeline
              days={timelineDays}
              rows={timelineRows}
              todayIso={todayIso}
              busyNights={busyDates}
              onToggleNight={toggleNight}
              onSelectSegment={handleSelectSegment}
              onSelectProperty={openSettingsFor}
              activePropertyId={settingsOpen ? selectedPropertyId : undefined}
            />
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-t border-line text-[12px] text-ink-soft">
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm bg-brand" /> Direct booking</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm bg-hold-tint ring-1 ring-inset ring-hold/30" /> Unpaid hold</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm bg-info-tint ring-1 ring-inset ring-info/25" /> Imported from a channel</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm bg-ink-muted/25 ring-1 ring-inset ring-ink-muted/30" /> Blocked by you</span>
            <span className="text-ink-muted">Click an empty night to block it, a blocked bar to free it, an imported bar for its raw details.</span>
          </div>
        </Card>


        {/* Imported-block details, shown on tap. Lives outside the drawer:
            a bar can be clicked while the drawer is shut. */}
        {/* Imported-block details, shown on tap */}
        {selectedImportedEvent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm" onClick={() => setSelectedImportedEvent(null)}>
            <div className="w-full max-w-sm rounded-card bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={`text-[11px] font-semibold uppercase tracking-wide ${importedEventStyle(selectedImportedEvent.channelName).text}`}>
                    Imported from {selectedImportedEvent.channelName || selectedImportedEvent.feedName}
                    {selectedImportedEvent.channelName && selectedImportedEvent.channelName !== selectedImportedEvent.feedName && (
                      <span className="ml-1.5 normal-case font-normal tracking-normal text-ink-muted">via {selectedImportedEvent.feedName}</span>
                    )}
                  </div>
                  <div className="mt-1 text-[15px] font-semibold text-ink">{selectedImportedEvent.summary}</div>
                </div>
                <button type="button" onClick={() => setSelectedImportedEvent(null)} className="rounded-control p-1 text-ink-muted hover:bg-subtle" aria-label="Close">
                  ✕
                </button>
              </div>
              <div className="mt-3 space-y-1.5 text-[13px] text-ink-soft">
                <div>{selectedImportedEvent.checkInDate} → {selectedImportedEvent.checkOutDate}</div>
                <div>{selectedImportedEvent.guestCount != null ? `${selectedImportedEvent.guestCount} guest${selectedImportedEvent.guestCount === 1 ? '' : 's'}` : 'Guest count not provided by this platform'}</div>
              </div>
              {selectedImportedEvent.description && (
                <div className="mt-3 rounded-control bg-subtle p-3 text-[12px] text-ink-soft whitespace-pre-wrap break-words">
                  {selectedImportedEvent.description}
                </div>
              )}
              <p className="mt-3 text-[11px] text-ink-muted">Whatever this platform includes in its calendar feed is shown as-is — most platforms send limited guest details for privacy.</p>
            </div>
          </div>
        )}


        {/* One settings drawer for the whole page. On a phone it is a
            full-height sheet opened from the header button; from tablet up it
            is anchored beside the nav rail and opened by clicking a property's
            name in the timeline. Either way the settings are out of the way
            until asked for, because the board is what the page is for. */}
        {settingsOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
              onClick={() => setSettingsOpen(false)}
              aria-hidden
            />
            <aside
              role="dialog"
              aria-modal="true"
              aria-label="Calendar settings"
              className="fixed z-50 bg-page shadow-2xl flex flex-col
                inset-0 md:inset-y-auto md:top-[61px] md:bottom-0 md:left-60 md:right-auto md:w-2/5 md:min-w-[420px]
                md:border-r md:border-line"
            >
              <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-line bg-surface shrink-0">
                <div className="min-w-0">
                  <h2 className="text-[17px] font-bold text-ink truncate">Calendar settings</h2>
                  <p className="text-[13px] text-ink-muted truncate">
                    {scopedProperties.find((p) => p.id === selectedPropertyId)?.name || 'Select a property'}
                  </p>
                </div>
                <Button variant="ghost" icon={X} aria-label="Close settings" onClick={() => setSettingsOpen(false)} />
              </header>

              {/* Extra bottom padding on a phone so the last card clears
                  MobileBottomNav, which is fixed at the same stacking level. */}
              <div className="flex-1 overflow-y-auto px-5 pt-5 pb-28 md:pb-6 space-y-5">
                <Field label="Property">
                  <Select
                    value={selectedPropertyId}
                    onChange={(e) => setSelectedPropertyId(e.target.value)}
                    disabled={loadingProps}
                  >
                    {loadingProps && <option>Loading…</option>}
                    {!loadingProps && scopedProperties.length === 0 && <option value="">No properties available</option>}
                    {scopedProperties.map((p) => (
                      <option key={p.id} value={p.id}>{p.name || p.id}</option>
                    ))}
                  </Select>
                </Field>

                {loadingCal && <Spinner label="Loading calendar…" />}

        {/* Cleaning-staff calendar link — one link covers every property, no login required on the other end. Admin-only: regenerating it affects every host's staff at once. */}
        {isAdminUser && (
          <div className="mb-4 rounded-card border border-line bg-surface p-4">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-warn" />
                  <span className="text-[13px] font-semibold text-ink">Cleaning calendar (share with staff)</span>
                </div>
                <p className="mt-1 text-[12px] text-ink-muted">Send this link to your cleaning staff — they can add it to their phone's home screen like an app. Shows checkout/check-in times for every property, no login needed.</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <input
                    readOnly
                    value={cleaningLink ?? 'Loading…'}
                    onFocus={(e) => e.target.select()}
                    className="flex-1 min-w-[200px] rounded-control border border-line-strong bg-subtle px-3 py-2 text-[12.5px] text-ink-soft"
                  />
                  <button
                    type="button"
                    onClick={() => void copyCleaningLink()}
                    disabled={!cleaningLink}
                    className="inline-flex items-center gap-1.5 rounded-control border border-line-strong px-3 py-2 text-[12.5px] font-semibold text-ink hover:bg-subtle transition-colors disabled:opacity-50"
                  >
                    {cleaningLinkCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {cleaningLinkCopied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRegenerateCleaningLink()}
                    disabled={!cleaningLink || regeneratingCleaningLink}
                    className="inline-flex items-center gap-1.5 rounded-control px-3 py-2 text-[12.5px] font-semibold text-danger hover:bg-danger-tint transition-colors disabled:opacity-50"
                  >
                    {regeneratingCleaningLink ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Regenerate
                  </button>
                </div>
          </div>
        )}


                {calendar && (
                  <>
                    {/* Direct bookings taken on our own site, newest check-in first. */}
                    {(calendar?.directBookings?.length ?? 0) > 0 && (
                      <section className="rounded-card border border-line bg-surface p-5">
                        <h2 className="text-[15px] font-semibold text-ink">Direct bookings</h2>
                        <p className="mt-1 text-[12px] text-ink-muted">
                          Booked and paid on this site. Unpaid holds disappear on their own if the guest does not finish paying.
                        </p>

                        <div className="mt-4 overflow-x-auto">
                          <table className="w-full min-w-[520px] text-left text-[13px]">
                            <thead>
                              <tr className="text-[11px] uppercase tracking-wide text-ink-muted">
                                <th className="pb-2 pr-3 font-medium">Guest</th>
                                <th className="pb-2 pr-3 font-medium">Stay</th>
                                <th className="pb-2 pr-3 font-medium">Amount</th>
                                <th className="pb-2 pr-3 font-medium">Status</th>
                                <th className="pb-2 font-medium text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...calendar!.directBookings]
                                .sort((a, b) => a.checkInDate.localeCompare(b.checkInDate))
                                .map((booking) => (
                                  <tr key={booking.id} className="border-t border-line">
                                    <td className="py-2.5 pr-3 text-ink">{booking.guestName}</td>
                                    <td className="py-2.5 pr-3 text-ink-soft whitespace-nowrap">
                                      {booking.checkInDate} → {booking.checkOutDate}
                                    </td>
                                    <td className="py-2.5 pr-3 text-ink whitespace-nowrap">
                                      ¥{booking.amountTotal.toLocaleString()}
                                    </td>
                                    <td className="py-2.5 pr-3">
                                      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                        booking.status === 'confirmed'
                                          ? 'bg-info-tint text-info'
                                          : 'bg-hold-tint text-hold'
                                      }`}>
                                        {booking.status === 'confirmed' ? 'Paid' : 'Awaiting payment'}
                                      </span>
                                    </td>
                                    <td className="py-2.5 text-right">
                                      {booking.status === 'confirmed' && (
                                        <div className="flex items-center justify-end gap-1.5">
                                          <button
                                            type="button"
                                            onClick={() => void handleCancelBooking(booking)}
                                            disabled={cancellingId === booking.id}
                                            className="rounded-control border border-danger/25 px-2.5 py-1 text-[11px] font-semibold text-danger hover:bg-danger-tint transition-colors disabled:opacity-50"
                                          >
                                            {cancellingId === booking.id ? 'Cancelling…' : 'Cancel'}
                                          </button>
                                          {authUser?.role === 'ADMIN' && (
                                            <button
                                              type="button"
                                              onClick={() => void handleForceCancelBooking(booking)}
                                              disabled={cancellingId === booking.id}
                                              title="Cancel without calling Stripe or refunding automatically"
                                              className="rounded-control border border-line px-2.5 py-1 text-[11px] font-semibold text-ink-muted hover:bg-subtle transition-colors disabled:opacity-50"
                                            >
                                              Force cancel
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    )}

                    {/* iCal panel */}
                    <div className="space-y-5">
                      <div className="space-y-5">
                      {/* Export link */}
                      <section className="bg-surface border border-line rounded-card p-4 md:p-5">
                        <h2 className="text-[15px] font-semibold mb-1">Export calendar (iCal)</h2>
                        <p className="text-[12px] text-ink-muted mb-3">Give this link to Airbnb, Booking.com, etc. so they import your blocked dates and direct bookings.</p>
                        <div className="flex items-stretch gap-2">
                          <input
                            readOnly
                            value={calendar.exportUrl}
                            onFocus={(e) => e.currentTarget.select()}
                            className="flex-1 min-w-0 rounded-control border border-line-strong bg-subtle px-3 py-2 text-[12px] text-ink-soft outline-none"
                          />
                          <button type="button" onClick={copyExportUrl} className="shrink-0 inline-flex items-center gap-1.5 rounded-control bg-brand px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#333] transition-colors">
                            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <button type="button" onClick={handleRegenerate} className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-ink-muted hover:text-ink transition-colors">
                          <RefreshCw className="h-3.5 w-3.5" /> Regenerate link
                        </button>
                      </section>

                      {/* Import feeds */}
                      <section className="bg-surface border border-line rounded-card p-4 md:p-5">
                        <h2 className="text-[15px] font-semibold mb-1">Import calendars (iCal)</h2>
                        <p className="text-[12px] text-ink-muted mb-3">Paste iCal URLs from other platforms. We refresh them about once a minute and block the imported dates automatically.</p>

                        <div className="space-y-3">
                          {feedDraft.length === 0 && <p className="text-[12px] text-ink-muted">No import feeds yet.</p>}
                          {feedDraft.map((feed) => (
                            <div key={feed.id} className="rounded-control border border-line p-3">
                              <div className="flex items-center gap-2 mb-2">
                                <input
                                  value={feed.name}
                                  onChange={(e) => updateFeedRow(feed.id, 'name', e.target.value)}
                                  placeholder="Label (e.g. Airbnb)"
                                  className="flex-1 min-w-0 rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-[12px] outline-none focus:border-brand transition-colors"
                                />
                                <button type="button" onClick={() => removeFeedRow(feed.id)} className="shrink-0 p-1.5 rounded-control text-danger hover:bg-danger-tint transition-colors" aria-label="Remove feed">
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                              <input
                                value={feed.url}
                                onChange={(e) => updateFeedRow(feed.id, 'url', e.target.value)}
                                placeholder="https://…/calendar.ics"
                                className="w-full rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-[12px] outline-none focus:border-brand transition-colors"
                              />
                              {feed.lastSynced && <p className="mt-1 text-[10px] text-ink-muted">Last synced: {feed.lastSynced}</p>}
                            </div>
                          ))}
                        </div>

                        <div className="mt-3 flex items-center justify-between">
                          <button type="button" onClick={addFeedRow} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-soft hover:text-ink transition-colors">
                            <Plus className="h-4 w-4" /> Add feed
                          </button>
                          <button type="button" onClick={saveFeeds} disabled={savingFeeds} className="inline-flex items-center gap-1.5 rounded-control bg-brand px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-[#333] disabled:opacity-60 transition-colors">
                            {savingFeeds ? <Loader2 className="h-4 w-4 animate-spin" /> : (feedsSaved ? <Check className="h-4 w-4" /> : null)} {feedsSaved ? 'Saved' : 'Save feeds'}
                          </button>
                        </div>
                      </section>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </aside>
          </>
        )}

    </AdminShell>
  );
};

export default HostCalendarPage;
