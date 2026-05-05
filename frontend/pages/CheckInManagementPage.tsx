import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
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

  const [propertyId, setPropertyId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [guestName, setGuestName] = useState('');
  const [nationality, setNationality] = useState('');

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

  const handleReset = () => {
    setPropertyId('');
    setFromDate('');
    setToDate('');
    setGuestName('');
    setNationality('');
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
      <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 pt-[110px] pb-24 md:pb-10">
        <h1 className="font-['Plus_Jakarta_Sans'] text-2xl md:text-[28px] font-bold tracking-tight mb-4">Check-in Management</h1>

        <section className="mb-4 bg-white border border-[#e4e2e3] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#e4e2e3] bg-[#fcfcfc] text-sm font-semibold">Filters</div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)} className="border border-[#c4c6cd] rounded-lg px-3 py-2 text-sm">
              <option value="">All properties</option>
              {scopedProperties.map((property) => (
                <option key={property.id} value={property.id}>{property.name || property.id}</option>
              ))}
            </select>
            <input value={fromDate} onChange={(event) => setFromDate(event.target.value)} type="date" className="border border-[#c4c6cd] rounded-lg px-3 py-2 text-sm" />
            <input value={toDate} onChange={(event) => setToDate(event.target.value)} type="date" className="border border-[#c4c6cd] rounded-lg px-3 py-2 text-sm" />
            <input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Guest name" className="border border-[#c4c6cd] rounded-lg px-3 py-2 text-sm" />
            <input value={nationality} onChange={(event) => setNationality(event.target.value)} placeholder="Nationality" className="border border-[#c4c6cd] rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="px-4 pb-4 flex flex-wrap gap-2">
            <button onClick={() => void loadData()} className="px-4 py-2 rounded-full bg-[#041627] text-white font-semibold text-sm">Apply</button>
            <button onClick={handleReset} className="px-4 py-2 rounded-full bg-[#efedef] text-[#2e3338] font-semibold text-sm">Reset</button>
            <button onClick={exportCsv} disabled={flattenedRows.length === 0} className="px-4 py-2 rounded-full bg-[#e6f5ec] text-[#0f7a44] font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed">Export CSV</button>
          </div>
        </section>

        {errorMsg && <div className="mb-4 text-sm text-red-700">{errorMsg}</div>}

        <section className="bg-white border border-[#e4e2e3] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#e4e2e3] bg-[#fcfcfc] text-sm font-semibold">
            Results ({flattenedRows.length} guest record{flattenedRows.length === 1 ? '' : 's'})
          </div>

          {loading ? (
            <div className="p-10 text-[#44474c] inline-flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin" /> Loading...</div>
          ) : flattenedRows.length === 0 ? (
            <div className="p-10 text-[#44474c]">No check-ins found.</div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-[1120px] text-sm">
                  <thead className="bg-[#f5f3f4] text-[#44474c]">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold uppercase text-xs tracking-wide">Check-in ID</th>
                      <th className="text-left px-4 py-3 font-semibold uppercase text-xs tracking-wide">Property</th>
                      <th className="text-left px-4 py-3 font-semibold uppercase text-xs tracking-wide">Stay</th>
                      <th className="text-left px-4 py-3 font-semibold uppercase text-xs tracking-wide">Guest</th>
                      <th className="text-left px-4 py-3 font-semibold uppercase text-xs tracking-wide">Birth Year</th>
                      <th className="text-left px-4 py-3 font-semibold uppercase text-xs tracking-wide">Address</th>
                      <th className="text-left px-4 py-3 font-semibold uppercase text-xs tracking-wide">Occupation</th>
                      <th className="text-left px-4 py-3 font-semibold uppercase text-xs tracking-wide">Document</th>
                      <th className="text-left px-4 py-3 font-semibold uppercase text-xs tracking-wide">Nationality</th>
                      <th className="text-left px-4 py-3 font-semibold uppercase text-xs tracking-wide">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flattenedRows.map(({ submission, guest }) => (
                      <tr key={`${submission.id}-${guest.id}`} className="border-t border-[#efedef] align-top hover:bg-[#faf9f9]">
                        <td className="px-4 py-3 font-mono text-xs">{submission.id}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{propertyNameMap.get(submission.propertyId) || submission.propertyId}</div>
                          <div className="text-xs text-[#74777d] font-mono">{submission.propertyId}</div>
                        </td>
                        <td className="px-4 py-3">{submission.checkInDate} {'->'} {submission.checkOutDate}</td>
                        <td className="px-4 py-3">{guest.fullName || '-'}</td>
                        <td className="px-4 py-3">{guest.birthYear ?? '-'}</td>
                        <td className="px-4 py-3">{guest.address || '-'}</td>
                        <td className="px-4 py-3">{guest.occupation || '-'}</td>
                        <td className="px-4 py-3">
                          <div>{guest.documentType || '-'}</div>
                          <div className="text-xs text-[#74777d] font-mono">{guest.documentNumber || '-'}</div>
                        </td>
                        <td className="px-4 py-3">{guest.nationality || '-'}</td>
                        <td className="px-4 py-3">
                          {guest.evidenceUrl ? (
                            <a href={guest.evidenceUrl} target="_blank" rel="noreferrer" className="text-[#003580] underline">View</a>
                          ) : (
                            <span className="text-[#74777d]">No file</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden p-3 space-y-3 bg-[#fbf9fa]">
                {flattenedRows.map(({ submission, guest }) => (
                  <article key={`${submission.id}-${guest.id}`} className="rounded-xl border border-[#e4e2e3] bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-sm">{guest.fullName || '-'}</div>
                        <div className="text-xs text-[#74777d]">{propertyNameMap.get(submission.propertyId) || submission.propertyId}</div>
                      </div>
                      <div className="text-[11px] text-[#74777d] font-mono">{submission.id}</div>
                    </div>
                    <div className="mt-2 text-xs text-[#44474c]">{submission.checkInDate} {'->'} {submission.checkOutDate}</div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="text-[#74777d]">Birth Year</div>
                        <div className="font-medium">{guest.birthYear ?? '-'}</div>
                      </div>
                      <div>
                        <div className="text-[#74777d]">Nationality</div>
                        <div className="font-medium">{guest.nationality || '-'}</div>
                      </div>
                      <div>
                        <div className="text-[#74777d]">Occupation</div>
                        <div className="font-medium">{guest.occupation || '-'}</div>
                      </div>
                      <div>
                        <div className="text-[#74777d]">Document</div>
                        <div className="font-medium">{guest.documentType || '-'}</div>
                        <div className="text-[11px] text-[#74777d] font-mono">{guest.documentNumber || '-'}</div>
                      </div>
                      <div className="col-span-2">
                        <div className="text-[#74777d]">Address</div>
                        <div className="font-medium">{guest.address || '-'}</div>
                      </div>
                    </div>
                    <div className="mt-3">
                      {guest.evidenceUrl ? (
                        <a href={guest.evidenceUrl} target="_blank" rel="noreferrer" className="text-[#003580] underline text-sm">View evidence</a>
                      ) : (
                        <span className="text-[#74777d] text-sm">No file</span>
                      )}
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
