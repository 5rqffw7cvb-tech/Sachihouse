import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { AlertCircle, Check, ChevronRight, Link2, RefreshCw, Sparkles } from 'lucide-react';
import { HostCard, HostCount, HostEmpty, HostScreen } from '../../components/host/HostScreen';
import { useHostContext } from '../../components/host/HostShell';
import {
  arrivalsOn,
  buildCheckInUrl,
  copyText,
  departuresOn,
  HostStay,
  loadStays,
  todayIso,
} from '../../services/hostApp';
import { listCheckIns } from '../../services/checkin';
import { hasAccess } from '../../services/permissions';
import { CheckInSubmission } from '../../types';

/** First letter of the guest's name, or of the channel when an OTA feed
 *  withheld it — never an empty circle. */
const initialFor = (stay: HostStay): string =>
  (stay.guestName || stay.channel || '?').trim().charAt(0).toUpperCase();

const displayName = (stay: HostStay): string => stay.guestName || `${stay.channel} guest`;

const StayRow: React.FC<{
  stay: HostStay;
  time?: string;
  badge?: React.ReactNode;
  last?: boolean;
}> = ({ stay, time, badge, last = false }) => (
  <div className={`flex items-center gap-3 px-4 py-3.5 ${last ? '' : 'border-b border-line'}`}>
    <div className="w-10 h-10 rounded-[14px] bg-brand-tint shrink-0 flex items-center justify-center
      font-['Plus_Jakarta_Sans'] text-[15px] font-bold text-ink-soft">
      {initialFor(stay)}
    </div>
    <div className="flex-1 min-w-0 flex flex-col">
      <span className="text-[15px] font-semibold text-ink truncate">{displayName(stay)}</span>
      <span className="text-[13px] text-ink-muted truncate">
        {[time, stay.propertyName, stay.guestCount ? `${stay.guestCount} guests` : null]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </div>
    {badge}
    <ChevronRight className="w-[18px] h-[18px] text-line-strong shrink-0" />
  </div>
);

const TodayPage: React.FC = () => {
  const { user, properties, propertiesError } = useHostContext();
  const today = todayIso();

  const [stays, setStays] = useState<HostStay[]>([]);
  const [submissions, setSubmissions] = useState<CheckInSubmission[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedPropertyId, setCopiedPropertyId] = useState<string | null>(null);
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
    const submissionsPromise = canSeeCheckIns
      ? listCheckIns({ fromDate: today, toDate: today }).catch(() => null)
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
        setError(cause instanceof Error ? cause.message : "Could not load today's schedule.");
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
        setIsRefreshing(false);
      });

    return () => { cancelled = true; };
  }, [properties, today, canSeeCheckIns, reloadKey]);

  const arrivals = useMemo(() => arrivalsOn(stays, today), [stays, today]);
  const departures = useMemo(() => departuresOn(stays, today), [stays, today]);

  /** A stay counts as checked in when a submission exists for the same
   *  property and arrival date. Names cannot be matched — OTA feeds do not
   *  carry them — so the date and property are all there is to go on. */
  const submittedKeys = useMemo(() => {
    if (!submissions) return null;
    return new Set(submissions.map((row) => `${row.propertyId}:${row.checkInDate}`));
  }, [submissions]);

  const missingId = useMemo(() => {
    if (!submittedKeys) return [];
    return arrivals.filter((stay) => !submittedKeys.has(`${stay.propertyId}:${stay.checkInDate}`));
  }, [arrivals, submittedKeys]);

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
    if (!submittedKeys) return null;
    const done = submittedKeys.has(`${stay.propertyId}:${stay.checkInDate}`);
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
                  {displayName(stay)} · {stay.propertyName}
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

          <HostCard
            title="Arrivals"
            action={<HostCount>{arrivals.length}</HostCount>}
          >
            {arrivals.length === 0
              ? <HostEmpty>No one arrives today.</HostEmpty>
              : arrivals.map((stay, index) => (
                <StayRow
                  key={stay.key}
                  stay={stay}
                  badge={idBadge(stay)}
                  last={index === arrivals.length - 1}
                />
              ))}
          </HostCard>

          <HostCard
            title="Departures"
            action={<HostCount>{departures.length}</HostCount>}
          >
            {departures.length === 0 ? (
              <HostEmpty>No one leaves today.</HostEmpty>
            ) : (
              <>
                {departures.map((stay) => (
                  <StayRow key={stay.key} stay={stay} />
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
    </HostScreen>
  );
};

export default TodayPage;
