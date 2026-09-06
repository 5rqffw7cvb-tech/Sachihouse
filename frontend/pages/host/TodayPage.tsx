import React, { useEffect, useMemo, useState } from 'react';
import { addDays, format, parseISO } from 'date-fns';
import { AlertCircle, Check, ChevronRight, Link2, RefreshCw, Sparkles } from 'lucide-react';
import { HostCard, HostCount, HostEmpty, HostScreen } from '../../components/host/HostScreen';
import { useHostContext } from '../../components/host/HostShell';
import { StayDetailSheet } from '../../components/host/StayDetailSheet';
import {
  arrivalsBetween,
  buildCheckInUrl,
  copyText,
  departuresOn,
  HostStay,
  loadStays,
  stayingOn,
  toIsoDate,
  todayIso,
} from '../../services/hostApp';
import { listCheckIns } from '../../services/checkin';
import { hasAccess } from '../../services/permissions';
import { CheckInSubmission } from '../../types';

/** How far ahead "next arrivals" looks. Two weeks is roughly how far out a
 *  host can still do something about a booking — chase an ID, book a cleaner. */
const HORIZON_DAYS = 14;
/** An ID that has not arrived yet is only worth shouting about when the guest
 *  is nearly here. Beyond that it is noise on the one screen that must stay
 *  glanceable. */
const ID_CHASE_DAYS = 1;

/** First letter of the guest's name, or of the channel when an OTA feed
 *  withheld it — never an empty circle. */
const initialFor = (stay: HostStay): string =>
  (stay.guestName || stay.channel || '?').trim().charAt(0).toUpperCase();

const displayName = (stay: HostStay): string => stay.guestName || `${stay.channel} guest`;

const StayRow: React.FC<{
  stay: HostStay;
  subtitle: string;
  badge?: React.ReactNode;
  last?: boolean;
  onOpen: (stay: HostStay) => void;
}> = ({ stay, subtitle, badge, last = false, onOpen }) => (
  <button
    type="button"
    onClick={() => onOpen(stay)}
    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-subtle ${
      last ? '' : 'border-b border-line'
    }`}
  >
    <span className="w-10 h-10 rounded-[14px] bg-brand-tint shrink-0 flex items-center justify-center
      font-['Plus_Jakarta_Sans'] text-[15px] font-bold text-ink-soft">
      {initialFor(stay)}
    </span>
    <span className="flex-1 min-w-0 flex flex-col">
      <span className="text-[15px] font-semibold text-ink truncate">{displayName(stay)}</span>
      <span className="text-[13px] text-ink-muted truncate">{subtitle}</span>
    </span>
    {badge}
    <ChevronRight className="w-[18px] h-[18px] text-line-strong shrink-0" />
  </button>
);

const TodayPage: React.FC = () => {
  const { user, properties, propertiesError } = useHostContext();
  const today = todayIso();
  const tomorrow = toIsoDate(addDays(new Date(), 1));
  const horizon = toIsoDate(addDays(new Date(), HORIZON_DAYS));

  const [stays, setStays] = useState<HostStay[]>([]);
  const [submissions, setSubmissions] = useState<CheckInSubmission[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedPropertyId, setCopiedPropertyId] = useState<string | null>(null);
  const [openStay, setOpenStay] = useState<HostStay | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Level 1–2 hosts cannot read guest ID records at all, so this screen shows
  // the day without ID badges rather than an error it can do nothing about.
  const canSeeCheckIns = hasAccess(user, 'checkins');

  useEffect(() => {
    if (properties.length === 0) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setError(null);

    const propertyIds = properties.map((property) => property.id);
    const staysPromise = loadStays(propertyIds);
    // The whole arrival window, not just today: an ID is worth checking while
    // there is still time to ask for it.
    const submissionsPromise = canSeeCheckIns
      ? listCheckIns({ fromDate: today, toDate: horizon }).catch(() => null)
      : Promise.resolve(null);

    Promise.all([staysPromise, submissionsPromise])
      .then(([staysResult, submissionsResult]) => {
        if (cancelled) return;
        setStays(staysResult.stays);
        setSubmissions(submissionsResult);
        if (staysResult.failedPropertyIds.length > 0) {
          const names = staysResult.failedPropertyIds
            .map((id) => properties.find((property) => property.id === id)?.name ?? id)
            .join(', ');
          setError(`Could not load the calendar for ${names}. Everything else is up to date.`);
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Could not load your schedule.");
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
        setIsRefreshing(false);
      });

    return () => { cancelled = true; };
  }, [properties, today, horizon, canSeeCheckIns, reloadKey]);

  const nextArrivals = useMemo(
    () => arrivalsBetween(stays, today, horizon),
    [stays, today, horizon],
  );
  const staying = useMemo(() => stayingOn(stays, today), [stays, today]);
  const departures = useMemo(() => departuresOn(stays, today), [stays, today]);

  /** A stay counts as checked in when a submission exists for the same
   *  property and arrival date. Names cannot be matched — OTA feeds do not
   *  carry them — so the date and property are all there is to go on. */
  const submissionByKey = useMemo(() => {
    if (!submissions) return null;
    return new Map(submissions.map((row) => [`${row.propertyId}:${row.checkInDate}`, row]));
  }, [submissions]);

  const missingId = useMemo(() => {
    if (!submissionByKey) return [];
    const chaseBy = toIsoDate(addDays(new Date(), ID_CHASE_DAYS));
    return nextArrivals.filter((stay) => (
      stay.checkInDate <= chaseBy && !submissionByKey.has(`${stay.propertyId}:${stay.checkInDate}`)
    ));
  }, [nextArrivals, submissionByKey]);

  /**
   * What the detail sheet may claim about a booking's ID record.
   *
   * Submissions were only fetched for arrivals from today onwards, so for a
   * guest already in the house — or one who left this morning — we simply did
   * not look. Returning `undefined` there hides the block; returning `null`
   * would tell the host no record exists, which we do not know.
   */
  const submissionFor = (stay: HostStay): CheckInSubmission | null | undefined => {
    if (!submissionByKey || stay.checkInDate < today) return undefined;
    return submissionByKey.get(`${stay.propertyId}:${stay.checkInDate}`) ?? null;
  };

  /** "Today" and "Tomorrow" carry more than a date does on the one screen a
   *  host checks in the morning. Anything further out gets the real date. */
  const dayLabel = (iso: string): string => {
    if (iso === today) return 'Today';
    if (iso === tomorrow) return 'Tomorrow';
    try {
      return format(parseISO(iso), 'EEE d MMM');
    } catch {
      return iso;
    }
  };

  const guestsLabel = (stay: HostStay): string | null =>
    stay.guestCount ? `${stay.guestCount} guests` : null;

  const handleCopyLink = async (propertyId: string) => {
    await copyText(buildCheckInUrl(propertyId));
    setCopiedPropertyId(propertyId);
    window.setTimeout(() => setCopiedPropertyId(null), 2000);
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    setReloadKey((key) => key + 1);
  };

  const idBadge = (stay: HostStay) => {
    if (!submissionByKey) return null;
    const done = submissionByKey.has(`${stay.propertyId}:${stay.checkInDate}`);
    return done ? (
      <span className="inline-flex items-center gap-1 bg-ok-tint text-ok rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0">
        <Check className="w-3 h-3" strokeWidth={3} />ID
      </span>
    ) : (
      <span className="bg-warn-tint text-warn rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0">
        No ID
      </span>
    );
  };

  return (
    <HostScreen
      title="Today"
      subtitle={format(new Date(), 'EEEE, d MMMM')}
      error={propertiesError ?? error}
      isLoading={isLoading}
      action={
        <button
          type="button"
          onClick={handleRefresh}
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
          {missingId.map((stay) => (
            <div
              key={`missing-${stay.key}`}
              className="flex items-start gap-3 bg-warn-tint border border-warn/20 rounded-card px-4 py-3.5"
            >
              <AlertCircle className="w-[18px] h-[18px] text-warn shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0 flex flex-col">
                <span className="text-[14px] font-bold text-warn">Guest ID not submitted</span>
                <span className="text-[13px] text-warn truncate">
                  {displayName(stay)} · {stay.propertyName} · {dayLabel(stay.checkInDate)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => { void handleCopyLink(stay.propertyId); }}
                className="h-[34px] px-3.5 rounded-control bg-surface border border-line-strong self-center shrink-0
                  flex items-center gap-1.5 text-[13px] font-semibold text-ink"
              >
                {copiedPropertyId === stay.propertyId
                  ? <><Check className="w-3.5 h-3.5" /> Copied</>
                  : <><Link2 className="w-3.5 h-3.5" /> Send link</>}
              </button>
            </div>
          ))}

          <HostCard title="Next arrivals" action={<HostCount>{nextArrivals.length}</HostCount>}>
            {nextArrivals.length === 0
              ? <HostEmpty>No arrivals in the next {HORIZON_DAYS} days.</HostEmpty>
              : nextArrivals.map((stay, index) => (
                <StayRow
                  key={stay.key}
                  stay={stay}
                  subtitle={[dayLabel(stay.checkInDate), stay.propertyName, guestsLabel(stay)]
                    .filter(Boolean).join(' · ')}
                  badge={idBadge(stay)}
                  last={index === nextArrivals.length - 1}
                  onOpen={setOpenStay}
                />
              ))}
          </HostCard>

          <HostCard title="Staying" action={<HostCount>{staying.length}</HostCount>}>
            {staying.length === 0
              ? <HostEmpty>Nobody is in the houses tonight.</HostEmpty>
              : staying.map((stay, index) => (
                <StayRow
                  key={stay.key}
                  stay={stay}
                  subtitle={[stay.propertyName, `leaves ${dayLabel(stay.checkOutDate)}`, guestsLabel(stay)]
                    .filter(Boolean).join(' · ')}
                  last={index === staying.length - 1}
                  onOpen={setOpenStay}
                />
              ))}
          </HostCard>

          <HostCard title="Departures today" action={<HostCount>{departures.length}</HostCount>}>
            {departures.length === 0 ? (
              <HostEmpty>No one leaves today.</HostEmpty>
            ) : (
              <>
                {departures.map((stay) => (
                  <StayRow
                    key={stay.key}
                    stay={stay}
                    subtitle={[stay.propertyName, guestsLabel(stay)].filter(Boolean).join(' · ')}
                    onOpen={setOpenStay}
                  />
                ))}
                {/* Every departure is a turnover. Listing the cleaning under it
                    is what a host actually plans the afternoon around. */}
                <div className="flex items-center gap-3 px-4 py-3.5 bg-subtle">
                  <div className="w-10 h-10 rounded-[14px] bg-surface border border-line shrink-0 flex items-center justify-center">
                    <Sparkles className="w-[18px] h-[18px] text-ink-soft" />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col">
                    <span className="text-[15px] font-semibold text-ink truncate">
                      Cleaning · {departures.map((stay) => stay.propertyName).join(', ')}
                    </span>
                    <span className="text-[13px] text-ink-muted truncate">
                      {departures.length === 1 ? 'After check-out' : `${departures.length} turnovers`}
                    </span>
                  </div>
                </div>
              </>
            )}
          </HostCard>
        </>
      )}

      <StayDetailSheet
        stay={openStay}
        submission={openStay ? submissionFor(openStay) : undefined}
        onClose={() => setOpenStay(null)}
        onCopyCheckInLink={(propertyId) => { void handleCopyLink(propertyId); }}
        copied={openStay ? copiedPropertyId === openStay.propertyId : false}
      />
    </HostScreen>
  );
};

export default TodayPage;
