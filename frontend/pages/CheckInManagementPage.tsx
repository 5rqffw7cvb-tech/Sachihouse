import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Upload, X } from 'lucide-react';
import { TopNavBar } from '../components/TopNavBar';
import { MobileBottomNav } from '../components/MobileBottomNav';
import { checkAuth, getCurrentUser, subscribeToAuth } from '../services/auth';
import { listCheckIns, importCheckInsCsv, CSV_IMPORT_TEMPLATE, CsvImportResult } from '../services/checkin';
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

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<CsvImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Detail modal
  const [selectedRow, setSelectedRow] = useState<{ submission: CheckInSubmission; guest: CheckInSubmission['guests'][number] } | null>(null);

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

  const today = new Date().toISOString().substring(0, 10);
  const canAccess = authUser?.role === 'ADMIN' || authUser?.role === 'HOST';
  const hasCheckInPermission = authUser?.role === 'ADMIN' || (() => {
    const perm = authUser?.checkInPermission;
    return !!perm && today >= perm.validFrom && today <= perm.validUntil;
  })();

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
    if (!canAccess || !hasCheckInPermission) {
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
  }, [canAccess, hasCheckInPermission]);

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

  const downloadTemplate = () => {
    downloadCsv('checkin_import_template.csv', CSV_IMPORT_TEMPLATE);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const text = await file.text();
    setIsImporting(true);
    try {
      const result = await importCheckInsCsv(text);
      setImportResult(result);
      if (result.imported > 0) {
        void loadData({});
      }
    } catch (err) {
      setImportResult({ imported: 0, errors: [{ row: 0, message: err instanceof Error ? err.message : 'Import failed' }] });
    } finally {
      setIsImporting(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#e8e5e6]">
        <TopNavBar />
        <div className="max-w-3xl mx-auto px-4 pt-[120px]">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 text-center">Please login as host/admin to access check-in management.</div>
        </div>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-[#e8e5e6]">
        <TopNavBar />
        <div className="max-w-3xl mx-auto px-4 pt-[120px]">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 text-center">Host or admin role required.</div>
        </div>
      </div>
    );
  }

  if (!hasCheckInPermission) {
    return (
      <div className="min-h-screen bg-[#e8e5e6]">
        <TopNavBar />
        <div className="max-w-3xl mx-auto px-4 pt-[120px]">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center">
              <span className="text-2xl">🔒</span>
            </div>
            <h2 className="font-['Plus_Jakarta_Sans'] font-bold text-[18px] text-[#1b1c1d] mb-2">Check-in access not permitted</h2>
            <p className="text-sm text-[#44474c]">Your account does not have an active check-in permission period. Please contact an admin to set up access.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#e8e5e6] text-[#1b1c1d] flex flex-col">
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
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isImporting} className="inline-flex items-center gap-1.5 rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[13px] font-semibold text-[#1b1c1d] transition-colors hover:bg-[#efedef] disabled:opacity-50">
            {isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Import CSV
          </button>
          <button type="button" onClick={downloadTemplate} className="rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[13px] font-semibold text-[#44474c] transition-colors hover:bg-[#efedef]">Template</button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportFile} />
        </div>

        {errorMsg && <div className="mb-4 text-sm text-red-700">{errorMsg}</div>}

        <section className="bg-white border border-[#e4e2e3] rounded-2xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-[#e4e2e3] bg-[#f5f3f4] flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{flattenedRows.length} guest record{flattenedRows.length === 1 ? '' : 's'}</span>
            <div className="flex gap-2">
              <button onClick={exportCsv} disabled={flattenedRows.length === 0} className="md:hidden rounded-lg border border-[#c4c6cd] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#0f7a44] transition-colors hover:bg-[#e6f5ec] disabled:opacity-40 disabled:cursor-not-allowed">Export CSV</button>
              <button onClick={() => fileInputRef.current?.click()} disabled={isImporting} className="md:hidden inline-flex items-center gap-1 rounded-lg border border-[#c4c6cd] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#1b1c1d] transition-colors hover:bg-[#efedef]">
                {isImporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                Import
              </button>
            </div>
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
                      <tr key={`${submission.id}-${guest.id}`} onClick={() => setSelectedRow({ submission, guest })} className="border-t border-[#efedef] align-top hover:bg-[#faf9f9] text-[13px] cursor-pointer">
                        <td className="px-3 py-2 font-mono text-[11px] text-[#74777d]">{submission.id}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium leading-snug">{propertyNameMap.get(submission.propertyId) || submission.propertyId}</div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{submission.checkInDate}<br/><span className="text-[#74777d]">{submission.checkOutDate}</span></td>
                        <td className="px-3 py-2 font-medium">{guest.fullName || '-'}</td>
                        <td className="px-3 py-2 text-center">{guest.birthYear ?? '-'}</td>
                        <td className="px-3 py-2 max-w-[200px] truncate text-[#44474c]">{guest.address || '-'}</td>
                        <td className="px-3 py-2 max-w-[140px] truncate text-[#44474c]">{guest.occupation || '-'}</td>
                        <td className="px-3 py-2">
                          <div className="capitalize">{guest.documentType || '-'}</div>
                          <div className="text-[11px] text-[#74777d] font-mono">{guest.documentNumber || '-'}</div>
                        </td>
                        <td className="px-3 py-2 font-medium">{guest.nationality || '-'}</td>
                        <td className="px-3 py-2">
                          {guest.evidenceUrl ? (
                            <a href={guest.evidenceUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-[#003580] underline">View</a>
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

      {/* Guest detail modal */}
      {selectedRow && (() => {
        const { submission, guest } = selectedRow;
        const propName = propertyNameMap.get(submission.propertyId) || submission.propertyId;
        const fields: { label: string; value: string | number | null | undefined }[] = [
          { label: 'Submission ID', value: submission.id },
          { label: 'Property', value: propName },
          { label: 'Check-in Date', value: submission.checkInDate },
          { label: 'Check-out Date', value: submission.checkOutDate },
          { label: 'Full Name', value: guest.fullName },
          { label: 'Birth Year', value: guest.birthYear },
          { label: 'Gender', value: guest.gender },
          { label: 'Nationality', value: guest.nationality },
          { label: 'Address', value: guest.address },
          { label: 'Occupation', value: guest.occupation },
          { label: 'Document Type', value: guest.documentType },
          { label: 'Document Number', value: guest.documentNumber },
        ];
        return (
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4 backdrop-blur-sm" onClick={() => setSelectedRow(null)}>
            <div className="w-full max-w-lg rounded-t-2xl md:rounded-2xl bg-white shadow-xl border border-[#e4e2e3] max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#e4e2e3]">
                <div>
                  <h2 className="font-['Plus_Jakarta_Sans'] font-bold text-[16px] text-[#1b1c1d]">{guest.fullName || 'Guest Detail'}</h2>
                  <p className="text-[12px] text-[#74777d] mt-0.5">{propName} · {submission.checkInDate} → {submission.checkOutDate}</p>
                </div>
                <button onClick={() => setSelectedRow(null)} className="text-[#74777d] hover:text-[#1b1c1d]"><X className="w-5 h-5" /></button>
              </div>
              <div className="overflow-y-auto flex-1 px-5 py-4">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {fields.map(f => f.value != null && String(f.value).trim() !== '' && (
                    <div key={f.label} className={f.label === 'Address' || f.label === 'Submission ID' ? 'col-span-2' : ''}>
                      <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">{f.label}</dt>
                      <dd className={`mt-0.5 text-[13px] font-medium text-[#1b1c1d] break-words${f.label === 'Submission ID' || f.label === 'Document Number' ? ' font-mono text-[11px] text-[#44474c]' : ''}`}>{String(f.value)}</dd>
                    </div>
                  ))}
                </dl>
                {guest.evidenceUrl && (
                  <div className="mt-4">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">Evidence</dt>
                    <a href={guest.evidenceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-[#003580] underline">View document</a>
                  </div>
                )}
              </div>
              <div className="px-5 pb-5 pt-2 border-t border-[#e4e2e3]">
                <button onClick={() => setSelectedRow(null)} className="w-full rounded-full bg-[#041627] text-white font-semibold py-2.5 text-sm hover:bg-[#041627]/90">Close</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Import result modal */}
      {importResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-[#e4e2e3]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#e4e2e3]">
              <h2 className="font-['Plus_Jakarta_Sans'] font-bold text-[16px] text-[#1b1c1d]">Import Result</h2>
              <button onClick={() => setImportResult(null)} className="text-[#74777d] hover:text-[#1b1c1d]"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center gap-3 rounded-xl bg-[#e6f5ec] border border-[#0f7a44]/20 px-4 py-3">
                <span className="text-[28px] font-['Plus_Jakarta_Sans'] font-bold text-[#0f7a44]">{importResult.imported}</span>
                <span className="text-sm font-semibold text-[#0f7a44]">submission{importResult.imported === 1 ? '' : 's'} imported</span>
              </div>
              {importResult.errors.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-red-700 mb-2">{importResult.errors.length} error{importResult.errors.length === 1 ? '' : 's'}</p>
                  <ul className="space-y-1 max-h-40 overflow-y-auto">
                    {importResult.errors.map((e, i) => (
                      <li key={i} className="text-xs text-red-700">
                        {e.row > 0 ? <span className="font-semibold">Row {e.row}: </span> : null}{e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {importResult.errors.length === 0 && importResult.imported === 0 && (
                <p className="text-sm text-[#44474c]">Nothing was imported — check your CSV format.</p>
              )}
            </div>
            <div className="px-5 pb-4 flex gap-2">
              <button onClick={() => setImportResult(null)} className="flex-1 rounded-full bg-[#041627] text-white font-semibold py-2 text-sm hover:bg-[#041627]/90">Done</button>
              <button onClick={downloadTemplate} className="rounded-full border border-[#c4c6cd] bg-white text-[#1b1c1d] font-semibold py-2 px-4 text-sm hover:bg-[#efedef]">Download Template</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CheckInManagementPage;
