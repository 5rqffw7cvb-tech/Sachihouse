import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
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
import { ChevronLeft, ChevronRight, Loader2, Sparkles, X, Zap } from 'lucide-react';
import { ApiError } from '../services/api';
import { CleaningStay, getCleaningCalendar } from '../services/cleaningCalendar';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Short, glanceable tag for a property on a cramped mobile calendar cell —
// its uppercase letters and digits, e.g. "SachiHouse7" -> "SH7".
function shortCode(name: string): string {
  const code = name.replace(/[^A-Z0-9]/g, '');
  return (code || name.slice(0, 3).toUpperCase()).slice(0, 4);
}

// Same palette as the host calendar's imported-event colors, plus two more
// for sources that only exist on this page (Manual, Direct booking) — kept
// visually consistent so a host who uses both pages recognizes the colors.
const SOURCE_STYLES: Record<string, string> = {
  Airbnb: 'bg-[#FF5A5F] text-white',
  'Booking.com': 'bg-[#003580] text-white',
  'Hostex Direct': 'bg-[#0f9d58] text-white',
  Manual: 'bg-[#6b7280] text-white',
  'Direct booking': 'bg-[#0b57d0] text-white',
};
const DEFAULT_SOURCE_STYLE = 'bg-[#d97706] text-white';

function sourceStyle(source: string): string {
  return SOURCE_STYLES[source] || DEFAULT_SOURCE_STYLE;
}

interface DayActivity {
  checkouts: CleaningStay[];
  checkins: CleaningStay[];
}

function buildDayMap(stays: CleaningStay[]): Map<string, DayActivity> {
  const map = new Map<string, DayActivity>();
  const ensure = (iso: string) => {
    let entry = map.get(iso);
    if (!entry) {
      entry = { checkouts: [], checkins: [] };
      map.set(iso, entry);
    }
    return entry;
  };
  for (const stay of stays) {
    ensure(stay.checkOutDate).checkouts.push(stay);
    ensure(stay.checkInDate).checkins.push(stay);
  }
  return map;
}

// Injects the iOS "Add to Home Screen" meta tags only while this page is
// mounted — staff are told to add this specific link, and it should open
// full-screen without Safari's browser chrome once they do.
function useHomeScreenMeta() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Cleaning Calendar';

    const created: HTMLElement[] = [];
    const addMeta = (name: string, content: string) => {
      const el = document.createElement('meta');
      el.setAttribute('name', name);
      el.setAttribute('content', content);
      document.head.appendChild(el);
      created.push(el);
    };
    addMeta('apple-mobile-web-app-capable', 'yes');
    addMeta('mobile-web-app-capable', 'yes');
    addMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
    addMeta('apple-mobile-web-app-title', 'Cleaning');

    const touchIcon = document.createElement('link');
    touchIcon.rel = 'apple-touch-icon';
    touchIcon.href = 'https://cdn-icons-png.flaticon.com/512/2111/2111320.png';
    document.head.appendChild(touchIcon);

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    const prevTheme = themeMeta?.getAttribute('content') ?? null;
    themeMeta?.setAttribute('content', '#111827');

    return () => {
      document.title = prevTitle;
      created.forEach((el) => document.head.removeChild(el));
      document.head.removeChild(touchIcon);
      if (prevTheme !== null) themeMeta?.setAttribute('content', prevTheme);
    };
  }, []);
}

const CleaningCalendarPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  useHomeScreenMeta();

  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(new Date()));
  const [stays, setStays] = useState<CleaningStay[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [activePropertyIds, setActivePropertyIds] = useState<Set<string> | null>(null);

  const gridDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [viewMonth]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const from = format(gridDays[0], 'yyyy-MM-dd');
        const to = format(gridDays[gridDays.length - 1], 'yyyy-MM-dd');
        const data = await getCleaningCalendar(token, from, to);
        if (!cancelled) setStays(data);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to load the cleaning calendar.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, viewMonth]);

  const dayMap = useMemo(() => buildDayMap(stays), [stays]);

  const properties = useMemo(() => {
    const map = new Map<string, string>();
    for (const stay of stays) map.set(stay.propertyId, stay.propertyName);
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [stays]);

  const visibleIds = activePropertyIds ?? new Set(properties.map((p) => p.id));
  const todayIso = format(new Date(), 'yyyy-MM-dd');
  const selectedActivity = selectedDate ? dayMap.get(selectedDate) : undefined;

  const togglePropertyFilter = (id: string) => {
    setActivePropertyIds((prev) => {
      const base = prev ?? new Set(properties.map((p) => p.id));
      const next = new Set(base);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (notFound) {
    return (
      <div className="min-h-screen bg-[#111827] flex items-center justify-center p-6">
        <div className="max-w-sm w-full rounded-2xl bg-white p-6 text-center shadow-xl">
          <div className="text-2xl">🔒</div>
          <h1 className="mt-2 text-[16px] font-semibold text-[#1b1c1d]">Link not valid</h1>
          <p className="mt-2 text-[13px] text-[#74777d]">This cleaning-calendar link is no longer active. Ask your manager for the current link.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f3f4f6] flex flex-col">
      <header className="bg-[#111827] text-white px-4 pt-6 pb-5 sticky top-0 z-20 shadow-md">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[#fbbf24]" />
          <h1 className="text-[17px] font-bold tracking-tight">Cleaning Calendar</h1>
        </div>
        <p className="mt-0.5 text-[12px] text-[#9ca3af]">Checkout &amp; check-in schedule for all properties</p>
      </header>

      <main className="flex-1 max-w-lg w-full mx-auto px-3 py-4">
        {properties.length > 1 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {properties.map((p) => {
              const active = visibleIds.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePropertyFilter(p.id)}
                  className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${active ? 'bg-[#111827] text-white' : 'bg-white text-[#74777d] border border-[#e4e2e3]'}`}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-[#e4e2e3] p-3">
          <div className="flex items-center justify-between mb-3 px-1">
            <button type="button" onClick={() => setViewMonth((m) => subMonths(m, 1))} className="p-2.5 rounded-xl hover:bg-[#f5f3f4] active:bg-[#ececec] transition-colors" aria-label="Previous month">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="text-[15px] font-bold">{format(viewMonth, 'MMMM yyyy')}</div>
            <button type="button" onClick={() => setViewMonth((m) => addMonths(m, 1))} className="p-2.5 rounded-xl hover:bg-[#f5f3f4] active:bg-[#ececec] transition-colors" aria-label="Next month">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-[10px] font-semibold text-[#9ca3af] py-1">{d}</div>
            ))}
          </div>

          {loading ? (
            <div className="py-16 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-[#9ca3af]" />
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {gridDays.map((day) => {
                const iso = format(day, 'yyyy-MM-dd');
                const inMonth = isSameMonth(day, viewMonth);
                const isToday = iso === todayIso;
                const activity = dayMap.get(iso);
                const checkouts = (activity?.checkouts ?? []).filter((s) => visibleIds.has(s.propertyId));
                const checkins = (activity?.checkins ?? []).filter((s) => visibleIds.has(s.propertyId));

                const propertyRows = checkouts.map((c) => {
                  const sameDayTurnover = checkins.some((i) => i.propertyId === c.propertyId);
                  return { stay: c, sameDayTurnover };
                });

                return (
                  <button
                    key={iso}
                    type="button"
                    onClick={() => setSelectedDate(iso)}
                    disabled={checkouts.length === 0 && checkins.length === 0}
                    className={`relative min-h-[56px] rounded-lg border p-1 flex flex-col items-center gap-0.5 text-[12px] transition-colors ${isToday ? 'border-[#0b57d0]' : 'border-transparent'} ${!inMonth ? 'opacity-30' : ''} ${propertyRows.length || checkins.length ? 'bg-[#fafafa] hover:bg-[#f0f0f0] cursor-pointer' : 'cursor-default'}`}
                  >
                    <span className="font-medium leading-none">{format(day, 'd')}</span>
                    <div className="flex flex-wrap items-center justify-center gap-0.5 w-full">
                      {propertyRows.slice(0, 2).map(({ stay, sameDayTurnover }) => (
                        <span
                          key={`${stay.propertyId}-${stay.source}`}
                          className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[8px] font-bold uppercase leading-none ${sourceStyle(stay.source)}`}
                        >
                          {shortCode(stay.propertyName)}
                          {sameDayTurnover && <Zap className="h-2 w-2" />}
                        </span>
                      ))}
                      {checkins.length > 0 && propertyRows.length === 0 && (
                        <span className="text-[8px] font-semibold text-[#9ca3af]">arriving</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {errorMsg && <div className="mt-3 rounded-xl bg-[#fdeef0] px-3 py-2 text-[12px] text-[#ba1a1a]">{errorMsg}</div>}
        </div>

        <div className="mt-4 rounded-2xl bg-white border border-[#e4e2e3] p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9ca3af] mb-2">Legend</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-[#44474c]">
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-[#FF5A5F]" /> Airbnb</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-[#003580]" /> Booking.com</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-[#0f9d58]" /> Hostex Direct</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-[#0b57d0]" /> Direct booking</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-[#6b7280]" /> Manual</span>
            <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3 text-[#f59e0b]" /> Same-day turnover</span>
          </div>
        </div>
      </main>

      {selectedDate && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setSelectedDate(null)}>
          <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-white p-5 pb-8 sm:pb-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[15px] font-bold text-[#1b1c1d]">{format(new Date(`${selectedDate}T00:00:00`), 'EEEE, MMM d')}</h2>
              <button type="button" onClick={() => setSelectedDate(null)} className="rounded-lg p-1.5 text-[#74777d] hover:bg-[#f5f3f4]" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            {!selectedActivity?.checkouts.length && !selectedActivity?.checkins.length && (
              <p className="text-[13px] text-[#9ca3af]">No activity this day.</p>
            )}

            {selectedActivity?.checkouts.filter((s) => visibleIds.has(s.propertyId)).map((stay) => {
              const sameDayTurnover = selectedActivity.checkins.some((i) => i.propertyId === stay.propertyId);
              return (
                <div key={`out-${stay.propertyId}-${stay.checkOutDate}-${stay.source}`} className="mb-2 rounded-xl border border-[#e4e2e3] p-3">
                  {sameDayTurnover && (
                    <div className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-[#fef3c7] px-2 py-0.5 text-[10px] font-bold text-[#92400e]">
                      <Zap className="h-3 w-3" /> Same-day turnover — clean fast
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] font-semibold text-[#1b1c1d]">{stay.propertyName}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${sourceStyle(stay.source)}`}>{stay.source}</span>
                  </div>
                  <div className="mt-1 text-[12.5px] text-[#44474c]">
                    🧹 Checkout at <strong>{stay.checkOutTime}</strong>
                    {stay.guestCount != null && <> · {stay.guestCount} guest{stay.guestCount === 1 ? '' : 's'} just left</>}
                  </div>
                </div>
              );
            })}

            {selectedActivity?.checkins.filter((s) => visibleIds.has(s.propertyId)).map((stay) => (
              <div key={`in-${stay.propertyId}-${stay.checkInDate}-${stay.source}`} className="mb-2 rounded-xl border border-dashed border-[#e4e2e3] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-semibold text-[#1b1c1d]">{stay.propertyName}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${sourceStyle(stay.source)}`}>{stay.source}</span>
                </div>
                <div className="mt-1 text-[12.5px] text-[#44474c]">
                  🛬 New guest arriving at <strong>{stay.checkInTime}</strong>
                  {stay.guestCount != null && <> · {stay.guestCount} guest{stay.guestCount === 1 ? '' : 's'}</>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CleaningCalendarPage;
