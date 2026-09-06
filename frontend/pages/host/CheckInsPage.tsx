import React, { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Check, ChevronRight, Link2, Lock, Search, X } from 'lucide-react';
import { HostCard, HostEmpty, HostScreen } from '../../components/host/HostScreen';
import { useHostContext } from '../../components/host/HostShell';
import { listCheckIns } from '../../services/checkin';
import { buildCheckInUrl, copyText, todayIso } from '../../services/hostApp';
import { hasAccess } from '../../services/permissions';
import { CheckInSubmission } from '../../types';

type Filter = 'all' | 'missing' | 'arriving';

/**
 * The Hotel Business Act wants an ID image on file for guests without a Japan
 * address, and the submit endpoint enforces that. What still gets through is a
 * record saved before an image finished uploading — so "complete" here means
 * every guest on the record actually carries evidence, not that the form was
 * submitted.
 */
const isComplete = (submission: CheckInSubmission): boolean =>
  submission.guests.length > 0 && submission.guests.every((guest) => Boolean(guest.evidenceUrl));

const guestLabel = (submission: CheckInSubmission): string => {
  const [first] = submission.guests;
  const name = first?.fullName?.trim();
  if (!name) return 'Unnamed guest';
  return submission.guests.length > 1 ? `${name} +${submission.guests.length - 1}` : name;
};

const dateRange = (submission: CheckInSubmission): string => {
  try {
    return `${format(parseISO(submission.checkInDate), 'd MMM')} – ${format(parseISO(submission.checkOutDate), 'd MMM')}`;
  } catch {
    return `${submission.checkInDate} – ${submission.checkOutDate}`;
  }
};

const CheckInsPage: React.FC = () => {
  const { user, properties, propertiesError } = useHostContext();
  const today = todayIso();

  const [submissions, setSubmissions] = useState<CheckInSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [linkSheetOpen, setLinkSheetOpen] = useState(false);
  const [copiedPropertyId, setCopiedPropertyId] = useState<string | null>(null);

  const canRead = hasAccess(user, 'checkins');

  const propertyNames = useMemo(
    () => new Map(properties.map((property) => [property.id, property.name])),
    [properties],
  );

  useEffect(() => {
    if (!canRead) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;

    listCheckIns()
      .then((rows) => {
        if (cancelled) return;
        // Newest arrival first: a host opening this screen is almost always
        // looking at someone who has just come or is about to.
        setSubmissions([...rows].sort((a, b) => b.checkInDate.localeCompare(a.checkInDate)));
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Could not load check-in records.');
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, [canRead]);

  const missingCount = useMemo(
    () => submissions.filter((row) => !isComplete(row)).length,
    [submissions],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return submissions.filter((row) => {
      if (filter === 'missing' && isComplete(row)) return false;
      if (filter === 'arriving' && row.checkInDate < today) return false;
      if (!needle) return true;
      const haystack = [
        guestLabel(row),
        propertyNames.get(row.propertyId) ?? row.propertyId,
        ...row.guests.map((guest) => guest.fullName),
      ].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }, [submissions, filter, query, today, propertyNames]);

  const handleCopyLink = async (propertyId: string) => {
    await copyText(buildCheckInUrl(propertyId));
    setCopiedPropertyId(propertyId);
    window.setTimeout(() => setCopiedPropertyId(null), 2000);
  };

  if (!canRead) {
    return (
      <HostScreen title="Check-in">
        <HostCard>
          <div className="flex flex-col items-center text-center gap-3 px-6 py-12">
            <div className="w-11 h-11 rounded-full bg-subtle flex items-center justify-center">
              <Lock className="w-5 h-5 text-ink-muted" />
            </div>
            <p className="text-[15px] font-semibold text-ink">Host level 3 required</p>
            <p className="text-[13px] text-ink-muted">
              Guest ID records are limited to host level 3 and above. Ask an administrator to raise your level.
            </p>
          </div>
        </HostCard>
      </HostScreen>
    );
  }

  const chip = (value: Filter, label: string, count?: number) => (
    <button
      key={value}
      type="button"
      onClick={() => setFilter(value)}
      className={`h-[34px] px-3.5 rounded-full text-[13px] whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
        filter === value
          ? 'bg-brand text-white font-semibold'
          : 'bg-surface border border-line text-ink-soft font-medium'
      }`}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span className={`rounded-full px-1.5 text-[11px] font-bold ${
          filter === value ? 'bg-white/20 text-white' : 'bg-danger-tint text-danger'
        }`}>
          {count}
        </span>
      )}
    </button>
  );

  return (
    <HostScreen
      title="Check-in"
      error={propertiesError ?? error}
      isLoading={isLoading}
      action={
        <button
          type="button"
          onClick={() => setLinkSheetOpen(true)}
          className="h-10 px-3.5 rounded-full bg-surface border border-line flex items-center gap-1.5"
        >
          <Link2 className="w-[17px] h-[17px] text-ink-soft" />
          <span className="text-[13px] font-semibold text-ink">Link</span>
        </button>
      }
    >
      <div className="h-11 rounded-control bg-surface border border-line flex items-center gap-2.5 px-3.5">
        <Search className="w-[18px] h-[18px] text-ink-muted shrink-0" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search guest or property"
          className="flex-1 min-w-0 bg-transparent text-[16px] text-ink placeholder:text-ink-muted focus:outline-none"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
            <X className="w-4 h-4 text-ink-muted" />
          </button>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
        {chip('all', 'All')}
        {chip('missing', 'Missing ID', missingCount)}
        {chip('arriving', 'Arriving')}
      </div>

      <HostCard>
        {visible.length === 0 ? (
          <HostEmpty>
            {submissions.length === 0 ? 'No check-in records yet.' : 'Nothing matches this filter.'}
          </HostEmpty>
        ) : (
          visible.map((row, index) => (
            <div
              key={row.id}
              className={`flex items-center gap-3 px-4 h-[76px] ${
                index === visible.length - 1 ? '' : 'border-b border-line'
              }`}
            >
              <div className="w-[42px] h-[42px] rounded-[14px] bg-brand-tint shrink-0 flex items-center justify-center
                font-['Plus_Jakarta_Sans'] text-[15px] font-bold text-ink-soft">
                {guestLabel(row).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 flex flex-col">
                <span className="text-[15px] font-semibold text-ink truncate">{guestLabel(row)}</span>
                <span className="text-[13px] text-ink-muted truncate">
                  {propertyNames.get(row.propertyId) ?? row.propertyId} · {dateRange(row)}
                </span>
              </div>
              {isComplete(row) ? (
                <span className="bg-ok-tint text-ok rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0">
                  Complete
                </span>
              ) : (
                <span className="bg-warn-tint text-warn rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0">
                  No ID
                </span>
              )}
              <ChevronRight className="w-[18px] h-[18px] text-line-strong shrink-0" />
            </div>
          ))
        )}
      </HostCard>

      {linkSheetOpen && (
        <div
          className="fixed inset-0 z-50 bg-brand/60 backdrop-blur-sm flex items-end"
          onClick={() => setLinkSheetOpen(false)}
        >
          <div
            className="w-full bg-surface rounded-t-[24px] max-h-[70dvh] overflow-y-auto"
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-line">
              <h2 className="text-[16px]">Check-in link</h2>
              <button type="button" onClick={() => setLinkSheetOpen(false)} aria-label="Close" className="p-1">
                <X className="w-5 h-5 text-ink-soft" />
              </button>
            </div>
            <p className="px-5 pt-3 text-[13px] text-ink-muted">
              Send this to a guest before they arrive. It is the same link the desktop console hands out.
            </p>
            {properties.map((property) => (
              <button
                key={property.id}
                type="button"
                onClick={() => { void handleCopyLink(property.id); }}
                className="w-full flex items-center gap-3 px-5 h-16 border-b border-line text-left active:bg-subtle"
              >
                <span className="flex-1 min-w-0 text-[15px] font-medium text-ink truncate">{property.name}</span>
                <span className="shrink-0 flex items-center gap-1.5 text-[13px] font-semibold text-link">
                  {copiedPropertyId === property.id
                    ? <><Check className="w-4 h-4" /> Copied</>
                    : <><Link2 className="w-4 h-4" /> Copy</>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </HostScreen>
  );
};

export default CheckInsPage;
