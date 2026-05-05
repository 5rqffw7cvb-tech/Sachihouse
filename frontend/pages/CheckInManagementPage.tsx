import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { TopNavBar } from '../components/TopNavBar';
import { MobileBottomNav } from '../components/MobileBottomNav';
import { checkAuth, getCurrentUser, subscribeToAuth } from '../services/auth';
import { listCheckIns } from '../services/checkin';
import { DEFAULT_SITE_SETTINGS, getAllProperties, getSiteSettings } from '../services/storage';
import { CheckInSubmission, PropertyData, SiteSettings } from '../types';
import { ApiUser } from '../services/api';

function csvEscape(value: string | number | boolean): string {
  const normalized = String(value ?? '');
  if (normalized.includes(',') || normalized.includes('\n') || normalized.includes('"')) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const CheckInManagementPage: React.FC = () => {
  const [authUser, setAuthUser] = useState<ApiUser | null>(getCurrentUser());
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(checkAuth());
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<CheckInSubmission[]>([]);
  const [properties, setProperties] = useState<(PropertyData & { id: string })[]>([]);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);

  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);

  // Active (applied) filters
  const [propertyId, setPropertyId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [guestName, setGuestName] = useState('');
  const [nationality, setNationality] = useState('');

  // Draft (form) filters
  const [draftPropertyId, setDraftPropertyId] = useState('');
  const [draftFromDate, setDraftFromDate] = useState('');
  const [draftToDate, setDraftToDate] = useState('');
  const [draftGuestName, setDraftGuestName] = useState('');
  const [draftNationality, setDraftNationality] = useState('');

  const canAccess = authUser?.role === 'ADMIN' || authUser?.role === 'HOST';

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => {
      setAuthUser(user);
      setIsAuthenticated(!!user);
    }).then((unsub) => {
      unsubscribe = unsub;
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    getSiteSettings().then(setSiteSettings).catch(() => {});
  }, []);

  const loadData = async (overrides?: {
    propertyId?: string;
    fromDate?: string;
    toDate?: string;
    guestName?: string;
    nationality?: string;
  }) => {
    if (!canAccess) {
      setLoading(false);
      return;
    }

    const activeFilters = {
      propertyId,
      fromDate,
      toDate,
      guestName,
      nationality,
      ...overrides,
    };

    setLoading(true);
    setErrorMsg(null);
    try {
      const [rows, allProperties] = await Promise.all([
        listCheckIns({
          propertyId: activeFilters.propertyId || undefined,
          fromDate: activeFilters.fromDate || undefined,
          toDate: activeFilters.toDate || undefined,
          guestName: activeFilters.guestName || undefined,
          nationality: activeFilters.nationality || undefined,
        }),
        getAllProperties({ includeArchived: true }),
      ]);
      setSubmissions(rows);
      setProperties(allProperties);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load check-ins.';
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [canAccess]);

  const scopedProperties = useMemo(() => {
    if (!authUser) {
      return [] as (PropertyData & { id: string })[];
    }
    if (authUser.role === 'ADMIN') {
      return properties;
    }
    const assigned = new Set(authUser.assignedPropertyIds ?? []);
    return properties.filter((property) => assigned.has(property.id));
  }, [authUser, properties]);

  const propertyNameMap = useMemo(() => {
    return new Map(properties.map((property) => [property.id, property.name || property.id]));
  }, [properties]);

  const flattenedRows = useMemo(() => {
    return submissions.flatMap((submission) =>
      submission.guests.map((guest) => ({
        submission,
        guest,
      }))
    );
  }, [submissions]);

  const activeFilterCount = [
    propertyId,
    fromDate,
    toDate,
    guestName,
    nationality,
  ].filter(Boolean).length;

  const applyFilters = () => {
    setPropertyId(draftPropertyId);
    setFromDate(draftFromDate);
    setToDate(draftToDate);
    setGuestName(draftGuestName);
    setNationality(draftNationality);
    setIsMobileFiltersOpen(false);
    void loadData({
      propertyId: draftPropertyId,
      fromDate: draftFromDate,
      toDate: draftToDate,
      guestName: draftGuestName,
      nationality: draftNationality,
    });
  };

  const handleReset = () => {
    setDraftPropertyId('');
    setDraftFromDate('');
    setDraftToDate('');
    setDraftGuestName('');
    setDraftNationality('');
    setPropertyId('');
    setFromDate('');
    setToDate('');
    setGuestName('');
    setNationality('');
    setIsMobileFiltersOpen(false);
    void loadData({ propertyId: '', fromDate: '', toDate: '', guestName: '', nationality: '' });
  };

  const exportCsv = () => {
    if (flattenedRows.length === 0) {
      return;
    }

    const headers = [
      'checkin_id',
      'property_id',
      'property_name',
      'checkin_date',
      'checkout_date',
      'guest_name',
      'guest_birth_year',
      'guest_address',
      'guest_occupation',
      'guest_nationality',
      'document_type',
      'document_number',
      'evidence_url',
    ];

    const lines = [headers.join(',')];
    flattenedRows.forEach(({ submission, guest }) => {
      const row = [
        submission.id,
        submission.propertyId,
        propertyNameMap.get(submission.propertyId) || submission.propertyId,
        submission.checkInDate,
        submission.checkOutDate,
        guest.fullName || '',
        guest.birthYear ?? '',
        guest.address || '',
        guest.occupation || '',
        guest.nationality || '',
        guest.documentType || '',
        guest.documentNumber || '',
        guest.evidenceUrl || '',
      ];
      lines.push(row.map((value) => csvEscape(value as string | number | boolean)).join(','));
    });

    downloadCsv('checkins_filtered.csv', lines.join('\n'));
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#fbf9fa]">
        <TopNavBar />
        <div className="max-w-3xl mx-auto px-4 pt-[120px]">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 text-center">Please login as host/admin to access check-in management.</div>
        </div>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-[#fbf9fa]">
        <TopNavBar />
        <div className="max-w-3xl mx-auto px-4 pt-[120px]">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 text-center">Host or admin role required.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fbf9fa] text-[#1b1c1d] flex flex-col">
      <TopNavBar />
      <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 pt-4 md:pt-[110px] pb-24 md:pb-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-['Plus_Jakarta_Sans'] text-[22px] md:text-[26px] font-bold tracking-tight">Check-in Management</h1>
        </div>

        {/* Mobile filter toggle */}
        <div className="mb-4 md:hidden">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsMobileFiltersOpen((prev) => !prev)}
              className="flex min-w-0 flex-1 items-center justify-between rounded-xl border border-[#c4c6cd] bg-white px-4 py-3 text-left text-[14px] font-semibold text-[#1b1c1d]"
            >
              <span>Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
              {isMobileFiltersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="shrink-0 rounded-xl border border-[#c4c6cd] bg-white px-3 py-3 text-[13px] font-semibold text-[#44474c] transition-colors hover:bg-[#efedef]"
            >
              Clear
            </button>
          </div>
          {isMobileFiltersOpen && (
            <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-[#e4e2e3] bg-white p-3">
              <div>
                <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#74777d]">Property</label>
                <select value={draftPropertyId} onChange={(e) => setDraftPropertyId(e.target.value)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]">
                  <option value="">All properties</option>
                  {scopedProperties.map((property) => (
                    <option key={property.id} value={property.id}>{property.name || property.id}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#74777d]">From</label>
                  <input type="date" value={draftFromDate} onChange={(e) => setDraftFromDate(e.target.value)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
                </div>
                <div>
                  <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#74777d]">To</label>
                  <input type="date" value={draftToDate} onChange={(e) => setDraftToDate(e.target.value)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#74777d]">Guest Name</label>
                <input value={draftGuestName} onChange={(e) => setDraftGuestName(e.target.value)} placeholder="e.g. NGUYEN VAN A" className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
              </div>
              <div>
                <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#74777d]">Nationality</label>
                <input value={draftNationality} onChange={(e) => setDraftNationality(e.target.value)} placeholder="e.g. VNM" className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
              </div>
              <button type="button" onClick={applyFilters} className="rounded-lg bg-[#041627] px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#041627]/90">
                Apply filter
              </button>
            </div>
          )}
        </div>

        {/* Desktop filter row */}
        <div className="mb-5 hidden md:flex items-end flex-wrap gap-3">
          <div className="w-[180px]">
            <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#74777d]">Property</label>
            <select value={draftPropertyId} onChange={(e) => setDraftPropertyId(e.target.value)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]">
              <option value="">All properties</option>
              {scopedProperties.map((property) => (
                <option key={property.id} value={property.id}>{property.name || property.id}</option>
              ))}
            </select>
          </div>
          <div className="w-[148px]">
            <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#74777d]">From</label>
            <input type="date" value={draftFromDate} onChange={(e) => setDraftFromDate(e.target.value)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
          </div>
          <div className="w-[148px]">
            <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#74777d]">To</label>
            <input type="date" value={draftToDate} onChange={(e) => setDraftToDate(e.target.value)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
          </div>
          <div className="w-[180px]">
            <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#74777d]">Guest Name</label>
            <input value={draftGuestName} onChange={(e) => setDraftGuestName(e.target.value)} placeholder="e.g. NGUYEN" className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
          </div>
          <div className="w-[140px]">
            <label className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#74777d]">Nationality</label>
            <input value={draftNationality} onChange={(e) => setDraftNationality(e.target.value)} placeholder="e.g. VNM" className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
          </div>
          <button type="button" onClick={applyFilters} className="rounded-lg bg-[#041627] px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#041627]/90">Apply filter</button>
          <button type="button" onClick={handleReset} className="rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[13px] font-semibold text-[#44474c] transition-colors hover:bg-[#efedef]">Clear filter</button>
          <button type="button" onClick={exportCsv} disabled={flattenedRows.length === 0} className="rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[13px] font-semibold text-[#0f7a44] transition-colors hover:bg-[#e6f5ec] disabled:opacity-50 disabled:cursor-not-allowed">Export CSV</button>
        </div>

        {errorMsg && <div className="mb-4 text-sm text-red-700">{errorMsg}</div>}

        <section className="bg-white border border-[#e4e2e3] rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#e4e2e3] bg-[#fcfcfc] flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{flattenedRows.length} guest record{flattenedRows.length === 1 ? '' : 's'}</span>
            <button onClick={exportCsv} disabled={flattenedRows.length === 0} className="md:hidden rounded-lg border border-[#c4c6cd] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#0f7a44] transition-colors hover:bg-[#e6f5ec] disabled:opacity-40 disabled:cursor-not-allowed">Export CSV</button>
          </div>

          {loading ? (
            <div className="px-6 py-8 text-[#44474c] inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
          ) : flattenedRows.length === 0 ? (
            <div className="px-6 py-8 text-[14px] text-[#44474c]">No check-ins found.</div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-[1120px] text-sm">
                  <thead className="bg-[#f5f3f4] text-[#44474c]">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold uppercase text-[11px] tracking-wide">Check-in ID</th>
                      <th className="text-left px-3 py-2 font-semibold uppercase text-[11px] tracking-wide">Property</th>
                      <th className="text-left px-3 py-2 font-semibold uppercase text-[11px] tracking-wide">Stay</th>
                      <th className="text-left px-3 py-2 font-semibold uppercase text-[11px] tracking-wide">Guest</th>
                      <th className="text-left px-3 py-2 font-semibold uppercase text-[11px] tracking-wide">Born</th>
                      <th className="text-left px-3 py-2 font-semibold uppercase text-[11px] tracking-wide">Address</th>
                      <th className="text-left px-3 py-2 font-semibold uppercase text-[11px] tracking-wide">Occupation</th>
                      <th className="text-left px-3 py-2 font-semibold uppercase text-[11px] tracking-wide">Document</th>
                      <th className="text-left px-3 py-2 font-semibold uppercase text-[11px] tracking-wide">Nationality</th>
                      <th className="text-left px-3 py-2 font-semibold uppercase text-[11px] tracking-wide">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flattenedRows.map(({ submission, guest }) => (
                      <tr key={`${submission.id}-${guest.id}`} className="border-t border-[#efedef] align-top hover:bg-[#faf9f9] text-[13px]">
                        <td className="px-3 py-2 font-mono text-[11px] text-[#74777d]">{submission.id}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium leading-snug">{propertyNameMap.get(submission.propertyId) || submission.propertyId}</div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{submission.checkInDate}<br/><span className="text-[#74777d]">{submission.checkOutDate}</span></td>
                        <td className="px-3 py-2 font-medium">{guest.fullName || '-'}</td>
                        <td className="px-3 py-2 text-center">{guest.birthYear ?? '-'}</td>
                        <td className="px-3 py-2 max-w-[180px] truncate">{guest.address || '-'}</td>
                        <td className="px-3 py-2">{guest.occupation || '-'}</td>
                        <td className="px-3 py-2">
                          <div className="capitalize">{guest.documentType || '-'}</div>
                          <div className="text-[11px] text-[#74777d] font-mono">{guest.documentNumber || '-'}</div>
                        </td>
                        <td className="px-3 py-2 font-medium">{guest.nationality || '-'}</td>
                        <td className="px-3 py-2">
                          {guest.evidenceUrl ? (
                            <a href={guest.evidenceUrl} target="_blank" rel="noreferrer" className="text-[#003580] underline">View</a>
                          ) : (
                            <span className="text-[#74777d]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden divide-y divide-[#efedef]">
                {flattenedRows.map(({ submission, guest }) => (
                  <article key={`${submission.id}-${guest.id}`} className="bg-white px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-[14px] truncate">{guest.fullName || '-'}</div>
                        <div className="text-[12px] text-[#74777d] truncate">{propertyNameMap.get(submission.propertyId) || submission.propertyId}</div>
                      </div>
                      <div className="shrink-0 text-[10px] text-[#74777d] font-mono pt-0.5">{submission.id}</div>
                    </div>
                    <div className="mt-1 text-[12px] text-[#44474c]">{submission.checkInDate} → {submission.checkOutDate}</div>
                    <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-[12px]">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">Born</div>
                        <div className="font-medium">{guest.birthYear ?? '-'}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">Nationality</div>
                        <div className="font-medium">{guest.nationality || '-'}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">Occupation</div>
                        <div className="font-medium truncate">{guest.occupation || '-'}</div>
                      </div>
                      <div className="col-span-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">Document</div>
                        <div className="font-medium capitalize">{guest.documentType || '-'} <span className="text-[#74777d] font-mono text-[10px]">{guest.documentNumber || ''}</span></div>
                      </div>
                      <div>
                        {guest.evidenceUrl ? (
                          <><div className="text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">Evidence</div><a href={guest.evidenceUrl} target="_blank" rel="noreferrer" className="text-[#003580] underline font-medium">View</a></>
                        ) : null}
                      </div>
                      <div className="col-span-3">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">Address</div>
                        <div className="font-medium text-[12px]">{guest.address || '-'}</div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>

      </main>
      <MobileBottomNav />
      <footer className="bg-[#f5f3f4] text-[#1b1c1d] text-[12px] md:text-[14px] font-['Plus_Jakarta_Sans'] border-t border-[#e4e2e3] w-full py-6 md:py-8 px-4 md:px-6 flex flex-col md:flex-row justify-between items-center gap-4 md:gap-6 pb-20 md:pb-8 mt-auto">
        <div className="text-[16px] md:text-[18px] font-bold text-[#1b1c1d]">{siteSettings.footerTitle}</div>
        <div className="flex flex-wrap justify-center gap-3 md:gap-6">
          <a className="text-[#44474c] hover:text-[#1b1c1d] underline" href="#">Privacy Policy</a>
          <a className="text-[#44474c] hover:text-[#1b1c1d] underline" href="#">Terms of Service</a>
          <a className="text-[#44474c] hover:text-[#1b1c1d] underline" href="#">Host Guidelines</a>
          <a className="text-[#44474c] hover:text-[#1b1c1d] underline" href="#">Contact Support</a>
        </div>
        <div className="text-[#44474c]">{siteSettings.footerCopyright}</div>
      </footer>
    </div>
  );
};

export default CheckInManagementPage;
