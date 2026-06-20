import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Download, FileText, Loader2, MoreHorizontal, Pencil, Save, Trash2, Upload, X } from 'lucide-react';
import { TopNavBar } from '../components/TopNavBar';
import { MobileBottomNav } from '../components/MobileBottomNav';
import { checkAuth, getCurrentUser, subscribeToAuth } from '../services/auth';
import { listCheckIns, importCheckInsCsv, CSV_IMPORT_TEMPLATE, CsvImportResult, deleteCheckIn, updateCheckInRecord } from '../services/checkin';
import { DEFAULT_SITE_SETTINGS, getAllProperties, getSiteSettings } from '../services/storage';
import { CheckInGuest, CheckInSubmission, PropertyData, SiteSettings } from '../types';
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

type SortField = 'createdAt' | 'checkInDate' | 'checkOutDate' | 'guestName' | 'nationality';
type SortDirection = 'asc' | 'desc';
type PageSize = 20 | 50 | 100;
type EditRecordForm = {
  checkInDate: string;
  checkOutDate: string;
  fullName: string;
  birthYear: string;
  gender: string;
  nationality: string;
  address: string;
  occupation: string;
  documentType: CheckInGuest['documentType'];
  documentNumber: string;
};

function createEditRecordForm(submission: CheckInSubmission, guest: CheckInGuest): EditRecordForm {
  return {
    checkInDate: submission.checkInDate,
    checkOutDate: submission.checkOutDate,
    fullName: guest.fullName || '',
    birthYear: guest.birthYear == null ? '' : String(guest.birthYear),
    gender: guest.gender || '',
    nationality: guest.nationality || '',
    address: guest.address || '',
    occupation: guest.occupation || '',
    documentType: guest.documentType || 'unknown',
    documentNumber: guest.documentNumber || '',
  };
}

function normalizeDuplicateToken(value: string | number | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function buildGuestDuplicateToken(guest: CheckInSubmission['guests'][number]): string {
  return [
    normalizeDuplicateToken(guest.fullName),
    normalizeDuplicateToken(guest.birthYear),
    normalizeDuplicateToken(guest.nationality),
    normalizeDuplicateToken(guest.documentType),
    normalizeDuplicateToken(guest.documentNumber),
  ].join('|');
}

function buildSubmissionDuplicateToken(submission: CheckInSubmission): string {
  const guestTokens = submission.guests.map((guest) => buildGuestDuplicateToken(guest)).sort();
  return [
    normalizeDuplicateToken(submission.propertyId),
    normalizeDuplicateToken(submission.checkInDate),
    normalizeDuplicateToken(submission.checkOutDate),
    guestTokens.join('||'),
  ].join('###');
}

function getDuplicateSubmissionIds(submissions: CheckInSubmission[]): string[] {
  const groups = new Map<string, CheckInSubmission[]>();
  submissions.forEach((submission) => {
    const token = buildSubmissionDuplicateToken(submission);
    const rows = groups.get(token) ?? [];
    rows.push(submission);
    groups.set(token, rows);
  });

  const duplicates: string[] = [];
  groups.forEach((rows) => {
    if (rows.length < 2) {
      return;
    }
    const sortedByCreatedAt = [...rows].sort((left, right) => left.createdAt - right.createdAt);
    sortedByCreatedAt.slice(1).forEach((submission) => {
      duplicates.push(submission.id);
    });
  });

  return duplicates;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
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
  const [isMobileMoreOpen, setIsMobileMoreOpen] = useState(false);

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<CsvImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Detail modal
  const [selectedRow, setSelectedRow] = useState<{ submission: CheckInSubmission; guest: CheckInSubmission['guests'][number] } | null>(null);
  const [isEditingRow, setIsEditingRow] = useState(false);
  const [isSavingRow, setIsSavingRow] = useState(false);
  const [isDeletingRow, setIsDeletingRow] = useState(false);
  const [editForm, setEditForm] = useState<EditRecordForm | null>(null);

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
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [currentPage, setCurrentPage] = useState(1);
  const [checkedRowIds, setCheckedRowIds] = useState<string[]>([]);
  const [duplicateSubmissionIds, setDuplicateSubmissionIds] = useState<string[]>([]);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const [isDeletingDuplicates, setIsDeletingDuplicates] = useState(false);

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
        rowId: `${submission.id}::${guest.id}`,
      }))
    );
  }, [submissions]);

  const sortedRows = useMemo(() => {
    const rows = [...flattenedRows];
    const direction = sortDirection === 'asc' ? 1 : -1;
    rows.sort((left, right) => {
      if (sortField === 'createdAt') {
        return (left.submission.createdAt - right.submission.createdAt) * direction;
      }
      if (sortField === 'checkInDate') {
        return compareText(left.submission.checkInDate, right.submission.checkInDate) * direction;
      }
      if (sortField === 'checkOutDate') {
        return compareText(left.submission.checkOutDate, right.submission.checkOutDate) * direction;
      }
      if (sortField === 'guestName') {
        return compareText(left.guest.fullName || '', right.guest.fullName || '') * direction;
      }
      return compareText(left.guest.nationality || '', right.guest.nationality || '') * direction;
    });
    return rows;
  }, [flattenedRows, sortDirection, sortField]);

  const checkedRowIdSet = useMemo(() => new Set(checkedRowIds), [checkedRowIds]);
  const duplicateSubmissionIdSet = useMemo(() => new Set(duplicateSubmissionIds), [duplicateSubmissionIds]);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(sortedRows.length / pageSize)), [pageSize, sortedRows.length]);
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [currentPage, pageSize, sortedRows]);
  const visibleRowIds = useMemo(() => paginatedRows.map((row) => row.rowId), [paginatedRows]);
  const duplicateVisibleRowsCount = useMemo(
    () => paginatedRows.filter((row) => duplicateSubmissionIdSet.has(row.submission.id)).length,
    [duplicateSubmissionIdSet, paginatedRows],
  );
  const availableRowIdSet = useMemo(() => new Set(sortedRows.map((row) => row.rowId)), [sortedRows]);

  const activeFilterCount = [
    propertyId,
    fromDate,
    toDate,
    guestName,
    nationality,
  ].filter(Boolean).length;
  const allVisibleRowsChecked = visibleRowIds.length > 0 && visibleRowIds.every((rowId) => checkedRowIdSet.has(rowId));

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

  useEffect(() => {
    setCheckedRowIds((prev) => prev.filter((rowId) => availableRowIdSet.has(rowId)));
  }, [availableRowIdSet]);

  useEffect(() => {
    const visibleSubmissions = new Set(submissions.map((submission) => submission.id));
    setDuplicateSubmissionIds((prev) => prev.filter((id) => visibleSubmissions.has(id)));
  }, [submissions]);

  useEffect(() => {
    setCurrentPage(1);
  }, [propertyId, fromDate, toDate, guestName, nationality, sortField, sortDirection, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const toggleRowChecked = (rowId: string) => {
    setCheckedRowIds((prev) => (prev.includes(rowId) ? prev.filter((id) => id !== rowId) : [...prev, rowId]));
  };

  const toggleAllVisibleRows = () => {
    if (visibleRowIds.length === 0) {
      return;
    }
    const allVisibleChecked = visibleRowIds.every((rowId) => checkedRowIdSet.has(rowId));
    if (allVisibleChecked) {
      setCheckedRowIds((prev) => prev.filter((rowId) => !visibleRowIds.includes(rowId)));
      return;
    }
    setCheckedRowIds((prev) => {
      const next = new Set(prev);
      visibleRowIds.forEach((rowId) => next.add(rowId));
      return Array.from(next);
    });
  };

  const handleCheckDuplicates = () => {
    setIsCheckingDuplicates(true);
    try {
      const duplicates = getDuplicateSubmissionIds(submissions);
      setDuplicateSubmissionIds(duplicates);
      const duplicateSet = new Set(duplicates);
      const duplicateRowIds = paginatedRows
        .filter((row) => duplicateSet.has(row.submission.id))
        .map((row) => row.rowId);
      setCheckedRowIds(duplicateRowIds);
    } finally {
      setIsCheckingDuplicates(false);
    }
  };

  const handleDeleteDuplicates = async () => {
    if (duplicateSubmissionIds.length === 0 || isDeletingDuplicates) {
      return;
    }

    const confirmed = window.confirm(`Delete ${duplicateSubmissionIds.length} duplicate check-in submission(s)?`);
    if (!confirmed) {
      return;
    }

    setIsDeletingDuplicates(true);
    setErrorMsg(null);
    try {
      const failedIds: string[] = [];
      for (const submissionId of duplicateSubmissionIds) {
        try {
          await deleteCheckIn(submissionId);
        } catch {
          failedIds.push(submissionId);
        }
      }

      if (failedIds.length > 0) {
        setErrorMsg(`Deleted ${duplicateSubmissionIds.length - failedIds.length}/${duplicateSubmissionIds.length} duplicates. Failed IDs: ${failedIds.join(', ')}`);
      }

      setDuplicateSubmissionIds(failedIds);
      void loadData({});
    } finally {
      setIsDeletingDuplicates(false);
    }
  };

  useEffect(() => {
    if (!selectedRow) {
      setIsEditingRow(false);
      setEditForm(null);
      return;
    }
    setIsEditingRow(false);
    setEditForm(createEditRecordForm(selectedRow.submission, selectedRow.guest));
  }, [selectedRow]);

  const handleCloseDetail = () => {
    setIsEditingRow(false);
    setEditForm(null);
    setIsSavingRow(false);
    setIsDeletingRow(false);
    setSelectedRow(null);
  };

  const handleEditFieldChange = <K extends keyof EditRecordForm>(field: K, value: EditRecordForm[K]) => {
    setEditForm((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        [field]: value,
      };
    });
  };

  const handleSaveRecord = async () => {
    if (!selectedRow || !editForm || isSavingRow) {
      return;
    }

    const fullName = editForm.fullName.trim();
    if (!fullName) {
      setErrorMsg('Guest full name is required.');
      return;
    }

    setIsSavingRow(true);
    setErrorMsg(null);
    try {
      const birthYear = editForm.birthYear.trim() ? Number(editForm.birthYear.trim()) : null;
      if (birthYear !== null && (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > new Date().getFullYear())) {
        throw new Error('Birth year must be a valid year.');
      }

      const updatedSubmission = await updateCheckInRecord(selectedRow.submission.id, {
        checkInDate: editForm.checkInDate,
        checkOutDate: editForm.checkOutDate,
        guestId: selectedRow.guest.id,
        guest: {
          fullName,
          birthYear,
          gender: editForm.gender.trim(),
          nationality: editForm.nationality.trim(),
          address: editForm.address.trim(),
          occupation: editForm.occupation.trim(),
          documentType: editForm.documentType,
          documentNumber: editForm.documentNumber.trim(),
        },
      });

      setSubmissions((prev) => prev.map((submission) => (
        submission.id === updatedSubmission.id ? updatedSubmission : submission
      )));

      const nextGuest = updatedSubmission.guests.find((guest) => guest.id === selectedRow.guest.id);
      if (nextGuest) {
        setSelectedRow({ submission: updatedSubmission, guest: nextGuest });
      }
      setIsEditingRow(false);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Failed to update check-in record.');
    } finally {
      setIsSavingRow(false);
    }
  };

  const handleDeleteRecord = async () => {
    if (!selectedRow || isDeletingRow) {
      return;
    }

    const confirmed = window.confirm('Delete this check-in record?');
    if (!confirmed) {
      return;
    }

    setIsDeletingRow(true);
    setErrorMsg(null);
    try {
      await deleteCheckIn(selectedRow.submission.id);
      setSubmissions((prev) => prev.filter((submission) => submission.id !== selectedRow.submission.id));
      setDuplicateSubmissionIds((prev) => prev.filter((id) => id !== selectedRow.submission.id));
      setCheckedRowIds((prev) => prev.filter((rowId) => !rowId.startsWith(`${selectedRow.submission.id}::`)));
      handleCloseDetail();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Failed to delete check-in record.');
    } finally {
      setIsDeletingRow(false);
    }
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
      'checkin_time',
      'checkout_time',
      'guest_name',
      'guest_birth_year',
      'guest_gender',
      'guest_address',
      'guest_occupation',
      'guest_nationality',
      'document_type',
      'document_number',
      'contact_info',
      'previous_location',
      'next_location',
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
        submission.checkInTime || '',
        submission.checkOutTime || '',
        guest.fullName || '',
        guest.birthYear ?? '',
        guest.gender || '',
        guest.address || '',
        guest.occupation || '',
        guest.nationality || '',
        guest.documentType || '',
        guest.documentNumber || '',
        guest.contactInfo || '',
        guest.previousLocation || '',
        guest.nextLocation || '',
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

  return (
    <div className="min-h-screen bg-[#e8e5e6] text-[#1b1c1d] flex flex-col">
      <TopNavBar />
      <main className="flex-1 w-full max-w-none mx-auto px-0 md:px-8 xl:px-12 pt-3 md:pt-[110px] pb-24 md:pb-10">
        <div className="flex items-end justify-between gap-4 mb-3 px-4 md:mb-6 md:px-0">
          <div>
            <h1 className="font-['Plus_Jakarta_Sans'] text-[19px] md:text-[28px] font-bold tracking-tight leading-none">Check-in management</h1>
            <p className="hidden md:block mt-1.5 text-[13px] text-[#74777d]">Review, search, and edit guest ID records.</p>
          </div>
          <div className="flex items-baseline gap-1.5 shrink-0">
            <span className="font-['Plus_Jakarta_Sans'] text-[18px] md:text-[26px] font-bold tracking-tight tabular-nums">{sortedRows.length}</span>
            <span className="text-[11px] md:text-[12px] font-semibold uppercase tracking-[0.08em] text-[#74777d] pb-0.5">record{sortedRows.length === 1 ? '' : 's'}</span>
          </div>
        </div>

        {/* Mobile compact action bar */}
        <div className="mb-3 px-4 md:hidden">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsMobileFiltersOpen(true)}
              className="flex min-w-0 flex-1 items-center justify-between rounded-xl border border-[#c4c6cd] bg-white px-4 py-2.5 text-left text-[13px] font-semibold text-[#1b1c1d]"
            >
              <span>Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
              <ChevronDown className="h-4 w-4 text-[#9a9ca1]" />
            </button>
            <button
              type="button"
              onClick={() => setIsMobileMoreOpen(true)}
              aria-label="More actions"
              className="shrink-0 rounded-xl border border-[#c4c6cd] bg-white w-[42px] h-[42px] flex items-center justify-center text-[#1b1c1d]"
            >
              <MoreHorizontal className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>

        {/* Desktop filter bar */}
        <div className="mb-5 hidden md:block rounded-2xl border border-[#e7e5e6] bg-white px-4 py-3.5">
          <div className="flex items-end flex-wrap gap-x-3 gap-y-3">
            <div className="min-w-[180px] flex-1">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ca1]">Property</label>
              <select value={draftPropertyId} onChange={(e) => setDraftPropertyId(e.target.value)} className="w-full rounded-lg border border-[#e2e0e1] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] transition-colors focus:outline-none focus:border-[#041627] focus:ring-2 focus:ring-[#041627]/10">
                <option value="">All properties</option>
                {scopedProperties.map((property) => (
                  <option key={property.id} value={property.id}>{property.name || property.id}</option>
                ))}
              </select>
            </div>
            <div className="w-[150px]">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ca1]">From</label>
              <input type="date" value={draftFromDate} onChange={(e) => setDraftFromDate(e.target.value)} className="w-full rounded-lg border border-[#e2e0e1] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] transition-colors focus:outline-none focus:border-[#041627] focus:ring-2 focus:ring-[#041627]/10" />
            </div>
            <div className="w-[150px]">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ca1]">To</label>
              <input type="date" value={draftToDate} onChange={(e) => setDraftToDate(e.target.value)} className="w-full rounded-lg border border-[#e2e0e1] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] transition-colors focus:outline-none focus:border-[#041627] focus:ring-2 focus:ring-[#041627]/10" />
            </div>
            <div className="min-w-[160px] flex-1">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ca1]">Guest name</label>
              <input value={draftGuestName} onChange={(e) => setDraftGuestName(e.target.value)} placeholder="e.g. NGUYEN" className="w-full rounded-lg border border-[#e2e0e1] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] transition-colors placeholder:text-[#b9bbbf] focus:outline-none focus:border-[#041627] focus:ring-2 focus:ring-[#041627]/10" />
            </div>
            <div className="w-[130px]">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ca1]">Nationality</label>
              <input value={draftNationality} onChange={(e) => setDraftNationality(e.target.value)} placeholder="e.g. VNM" className="w-full rounded-lg border border-[#e2e0e1] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] transition-colors placeholder:text-[#b9bbbf] focus:outline-none focus:border-[#041627] focus:ring-2 focus:ring-[#041627]/10" />
            </div>
            <div className="w-[160px]">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ca1]">Sort by</label>
              <select value={sortField} onChange={(e) => setSortField(e.target.value as SortField)} className="w-full rounded-lg border border-[#e2e0e1] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] transition-colors focus:outline-none focus:border-[#041627] focus:ring-2 focus:ring-[#041627]/10">
                <option value="createdAt">Created time</option>
                <option value="checkInDate">Check-in date</option>
                <option value="checkOutDate">Check-out date</option>
                <option value="guestName">Guest name</option>
                <option value="nationality">Nationality</option>
              </select>
            </div>
            <div className="w-[130px]">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ca1]">Order</label>
              <select value={sortDirection} onChange={(e) => setSortDirection(e.target.value as SortDirection)} className="w-full rounded-lg border border-[#e2e0e1] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] transition-colors focus:outline-none focus:border-[#041627] focus:ring-2 focus:ring-[#041627]/10">
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button type="button" onClick={handleReset} className="rounded-lg px-3 py-2 text-[13px] font-semibold text-[#74777d] transition-colors hover:bg-[#f1eff0] hover:text-[#1b1c1d]">Clear</button>
              <button type="button" onClick={applyFilters} className="rounded-lg bg-[#041627] px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#0a2238]">Apply filters</button>
            </div>
          </div>
        </div>

        {errorMsg && <div className="mb-4 px-4 md:px-0 text-sm text-red-700">{errorMsg}</div>}

        <section className="bg-white md:border md:border-[#e7e5e6] rounded-none md:rounded-2xl overflow-hidden">
          <div className="px-4 md:px-5 py-3 border-b border-[#eeecec] flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-[13px]">
              <span className="font-semibold text-[#1b1c1d]">{paginatedRows.length}</span>
              <span className="text-[#9a9ca1]">of {sortedRows.length} shown</span>
              {checkedRowIds.length > 0 && (
                <span className="rounded-full bg-[#041627]/[0.06] px-2 py-0.5 text-[11px] font-semibold text-[#041627]">{checkedRowIds.length} checked</span>
              )}
              {duplicateVisibleRowsCount > 0 && (
                <span className="rounded-full bg-[#fdecea] px-2 py-0.5 text-[11px] font-semibold text-[#b3261e]">{duplicateVisibleRowsCount} duplicate</span>
              )}
            </div>

            {/* Desktop actions */}
            <div className="hidden md:flex items-center gap-1">
              <button type="button" onClick={handleCheckDuplicates} disabled={isCheckingDuplicates || loading || submissions.length === 0} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-[#44474c] transition-colors hover:bg-[#f1eff0] disabled:opacity-40">
                {isCheckingDuplicates ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Check duplicates
              </button>
              <button type="button" onClick={handleDeleteDuplicates} disabled={isDeletingDuplicates || duplicateSubmissionIds.length === 0} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-[#b3261e] transition-colors hover:bg-[#fdecea] disabled:opacity-40">
                {isDeletingDuplicates ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete duplicates{duplicateSubmissionIds.length > 0 ? ` (${duplicateSubmissionIds.length})` : ''}
              </button>
              <span className="mx-1 h-5 w-px bg-[#e7e5e6]" />
              <button type="button" onClick={exportCsv} disabled={flattenedRows.length === 0} className="rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-[#0f7a44] transition-colors hover:bg-[#e6f5ec] disabled:opacity-40">Export CSV</button>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isImporting} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-[#44474c] transition-colors hover:bg-[#f1eff0] disabled:opacity-40">
                {isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                Import
              </button>
              <button type="button" onClick={downloadTemplate} className="rounded-lg px-2.5 py-1.5 text-[13px] font-semibold text-[#74777d] transition-colors hover:bg-[#f1eff0]">Template</button>
              <span className="mx-1 h-5 w-px bg-[#e7e5e6]" />
              <select value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value) as PageSize)} className="rounded-lg border border-[#e2e0e1] bg-white px-2.5 py-1.5 text-[13px] font-semibold text-[#1b1c1d] transition-colors focus:outline-none focus:border-[#041627] focus:ring-2 focus:ring-[#041627]/10">
                <option value="20">20 / page</option>
                <option value="50">50 / page</option>
                <option value="100">100 / page</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="px-6 py-8 text-[#44474c] inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
          ) : sortedRows.length === 0 ? (
            <div className="px-6 py-8 text-[14px] text-[#44474c]">No check-ins found.</div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm border-separate border-spacing-0 table-fixed">
                  <thead>
                    <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-white [&>th]:border-b [&>th]:border-[#e7e5e6] text-[#9a9ca1]">
                      <th className="text-left pl-5 pr-2 py-3 font-semibold uppercase text-[11px] tracking-[0.06em] w-8">
                        <input
                          type="checkbox"
                          checked={allVisibleRowsChecked}
                          onChange={toggleAllVisibleRows}
                          aria-label="Check all visible rows"
                          className="accent-[#041627]"
                        />
                      </th>
                      <th className="text-left px-2 py-3 font-semibold uppercase text-[11px] tracking-[0.06em] w-[14%]">Guest</th>
                      <th className="text-left px-2 py-3 font-semibold uppercase text-[11px] tracking-[0.06em] w-[12%]">Property</th>
                      <th className="text-left px-2 py-3 font-semibold uppercase text-[11px] tracking-[0.06em] w-[11%]">Stay</th>
                      <th className="text-left px-2 py-3 font-semibold uppercase text-[11px] tracking-[0.06em] w-[9%]">Nationality</th>
                      <th className="text-left px-2 py-3 font-semibold uppercase text-[11px] tracking-[0.06em] w-[11%]">Document</th>
                      <th className="text-left px-2 py-3 font-semibold uppercase text-[11px] tracking-[0.06em] w-[16%]">Address / Occupation</th>
                      <th className="text-left px-2 py-3 font-semibold uppercase text-[11px] tracking-[0.06em] w-[19%]">Contact &amp; Travel</th>
                      <th className="text-left px-2 pr-5 py-3 font-semibold uppercase text-[11px] tracking-[0.06em] w-[8%]">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.map(({ submission, guest, rowId }) => {
                      const isChecked = checkedRowIdSet.has(rowId);
                      const isDuplicate = duplicateSubmissionIdSet.has(submission.id);
                      const travelLine = `${guest.previousLocation || '-'} → ${guest.nextLocation || '-'}`;
                      return (
                      <tr key={rowId} onClick={() => setSelectedRow({ submission, guest })} className={`group align-top text-[13px] cursor-pointer transition-colors [&>td]:border-b [&>td]:border-[#f1eff0] hover:[&>td]:bg-[#faf9fa] ${isChecked ? '[&>td]:bg-[#041627]/[0.025]' : ''} ${isDuplicate ? '[&>td]:bg-[#fef6f5]' : ''}`}>
                        <td className="pl-5 pr-2 py-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleRowChecked(rowId)}
                            aria-label="Check row"
                            className="accent-[#041627]"
                          />
                        </td>
                        <td className="px-2 py-3">
                          <div className="font-semibold text-[#1b1c1d] truncate" title={guest.fullName || ''}>{guest.fullName || '-'}</div>
                          <div className="mt-0.5 text-[11px] text-[#9a9ca1]">{guest.birthYear ?? '-'}{guest.gender ? ` · ${guest.gender}` : ''}</div>
                        </td>
                        <td className="px-2 py-3">
                          <div className="font-medium leading-snug text-[#1b1c1d] truncate" title={propertyNameMap.get(submission.propertyId) || submission.propertyId}>{propertyNameMap.get(submission.propertyId) || submission.propertyId}</div>
                        </td>
                        <td className="px-2 py-3 text-[#1b1c1d]">
                          <div>{submission.checkInDate}{submission.checkInTime ? ` ${submission.checkInTime}` : ''}</div>
                          <div className="text-[#9a9ca1]">{submission.checkOutDate}{submission.checkOutTime ? ` ${submission.checkOutTime}` : ''}</div>
                        </td>
                        <td className="px-2 py-3 font-medium text-[#1b1c1d] truncate">{guest.nationality || '-'}</td>
                        <td className="px-2 py-3">
                          <div className="capitalize text-[#1b1c1d] truncate">{(guest.documentType || '-').replace('_', ' ')}</div>
                          <div className="text-[11px] text-[#9a9ca1] font-mono truncate">{guest.documentNumber || '-'}</div>
                        </td>
                        <td className="px-2 py-3">
                          <div className="truncate text-[#44474c]" title={guest.address || ''}>{guest.address || '-'}</div>
                          <div className="text-[11px] text-[#9a9ca1] truncate" title={guest.occupation || ''}>{guest.occupation || '-'}</div>
                        </td>
                        <td className="px-2 py-3">
                          <div className="truncate text-[#44474c]" title={guest.contactInfo || ''}>{guest.contactInfo || '-'}</div>
                          <div className="text-[11px] text-[#9a9ca1] truncate" title={travelLine}>{travelLine}</div>
                        </td>
                        <td className="px-2 pr-5 py-3">
                          {guest.evidenceUrl ? (
                            <a href={guest.evidenceUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center rounded-md px-2 py-1 text-[12px] font-semibold text-[#041627] transition-colors hover:bg-[#041627]/[0.06]">View</a>
                          ) : (
                            <span className="text-[#c4c6cd]">—</span>
                          )}
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden divide-y divide-[#edeaeb]">
                {paginatedRows.map(({ submission, guest, rowId }) => {
                  const isDuplicate = duplicateSubmissionIdSet.has(submission.id);
                  return (
                  <button
                    key={rowId}
                    type="button"
                    onClick={() => setSelectedRow({ submission, guest })}
                    className={`w-full px-4 py-3 text-left active:bg-[#faf9fa] ${isDuplicate ? 'bg-[#fef6f5]' : 'bg-white'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate font-semibold text-[14px] text-[#1b1c1d]">{guest.fullName || '-'}</p>
                      {isDuplicate ? (
                        <span className="shrink-0 rounded-full bg-[#fdecea] px-2 py-0.5 text-[10px] font-bold text-[#b3261e]">DUPLICATE</span>
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-[#c4c6cd]" />
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-[#74777d]">
                      {propertyNameMap.get(submission.propertyId) || submission.propertyId} · {submission.checkInDate} → {submission.checkOutDate}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-[#9a9ca1]">
                      {guest.nationality || '-'} · {(guest.documentType || '-').replace('_', ' ')}
                    </p>
                  </button>
                )})}
              </div>

              <div className="px-4 md:px-5 py-3 border-t border-[#eeecec] flex items-center justify-between gap-3">
                <div className="text-[12px] text-[#9a9ca1]">Page <span className="font-semibold text-[#1b1c1d] tabular-nums">{currentPage}</span> of <span className="tabular-nums">{totalPages}</span></div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage <= 1}
                    className="rounded-lg border border-[#e2e0e1] bg-white px-3.5 py-1.5 text-[12px] font-semibold text-[#44474c] transition-colors hover:bg-[#f1eff0] disabled:opacity-40 disabled:hover:bg-white"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage >= totalPages}
                    className="rounded-lg border border-[#e2e0e1] bg-white px-3.5 py-1.5 text-[12px] font-semibold text-[#44474c] transition-colors hover:bg-[#f1eff0] disabled:opacity-40 disabled:hover:bg-white"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

      </main>
      <MobileBottomNav />
      <footer className="bg-[#f5f3f4] text-[#1b1c1d] text-[12px] md:text-[14px] font-['Plus_Jakarta_Sans'] border-t border-[#e4e2e3] w-full py-6 md:py-8 px-4 md:px-6 flex flex-col md:flex-row justify-between items-center gap-4 md:gap-6 pb-20 md:pb-8 mt-auto">
        <div className="text-[16px] md:text-[18px] font-bold text-[#1b1c1d]">{siteSettings.footerTitle}</div>
        <div className="text-[#44474c]">{siteSettings.footerCopyright}</div>
      </footer>

      {/* Mobile filters bottom sheet */}
      {isMobileFiltersOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setIsMobileFiltersOpen(false)} />
          <div className="absolute bottom-0 inset-x-0 flex max-h-[85vh] flex-col rounded-t-2xl bg-white">
            <div className="flex items-center justify-between border-b border-[#e4e2e3] px-4 py-3.5">
              <h2 className="font-['Plus_Jakarta_Sans'] text-[15px] font-bold">Filters</h2>
              <button type="button" onClick={() => setIsMobileFiltersOpen(false)} className="text-[#74777d]"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ca1]">Property</label>
                <select value={draftPropertyId} onChange={(e) => setDraftPropertyId(e.target.value)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2.5 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]">
                  <option value="">All properties</option>
                  {scopedProperties.map((property) => (
                    <option key={property.id} value={property.id}>{property.name || property.id}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ca1]">From</label>
                  <input type="date" value={draftFromDate} onChange={(e) => setDraftFromDate(e.target.value)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2.5 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ca1]">To</label>
                  <input type="date" value={draftToDate} onChange={(e) => setDraftToDate(e.target.value)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2.5 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ca1]">Guest Name</label>
                <input value={draftGuestName} onChange={(e) => setDraftGuestName(e.target.value)} placeholder="e.g. NGUYEN VAN A" className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2.5 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ca1]">Nationality</label>
                <input value={draftNationality} onChange={(e) => setDraftNationality(e.target.value)} placeholder="e.g. VNM" className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2.5 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ca1]">Sort By</label>
                  <select value={sortField} onChange={(e) => setSortField(e.target.value as SortField)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2.5 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]">
                    <option value="createdAt">Created Time</option>
                    <option value="checkInDate">Check-in Date</option>
                    <option value="checkOutDate">Check-out Date</option>
                    <option value="guestName">Guest Name</option>
                    <option value="nationality">Nationality</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ca1]">Order</label>
                  <select value={sortDirection} onChange={(e) => setSortDirection(e.target.value as SortDirection)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2.5 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]">
                    <option value="desc">Descending</option>
                    <option value="asc">Ascending</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9a9ca1]">Page size</label>
                <select value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value) as PageSize)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2.5 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]">
                  <option value="20">20 / page</option>
                  <option value="50">50 / page</option>
                  <option value="100">100 / page</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 border-t border-[#e4e2e3] px-4 py-3">
              <button type="button" onClick={handleReset} className="rounded-full border border-[#c4c6cd] bg-white px-5 py-2.5 text-sm font-semibold text-[#1b1c1d]">Clear</button>
              <button type="button" onClick={applyFilters} className="flex-1 rounded-full bg-[#041627] py-2.5 text-sm font-semibold text-white">Apply filters</button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile more-actions bottom sheet */}
      {isMobileMoreOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setIsMobileMoreOpen(false)} />
          <div className="absolute bottom-0 inset-x-0 rounded-t-2xl bg-white">
            <div className="flex items-center justify-between border-b border-[#e4e2e3] px-4 py-3.5">
              <h2 className="font-['Plus_Jakarta_Sans'] text-[15px] font-bold">More actions</h2>
              <button type="button" onClick={() => setIsMobileMoreOpen(false)} className="text-[#74777d]"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
              <button
                type="button"
                onClick={() => { setIsMobileMoreOpen(false); handleCheckDuplicates(); }}
                disabled={isCheckingDuplicates || loading || submissions.length === 0}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[14px] font-semibold text-[#1b1c1d] active:bg-[#f1eff0] disabled:opacity-40"
              >
                {isCheckingDuplicates ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Check duplicates
              </button>
              <button
                type="button"
                onClick={() => { setIsMobileMoreOpen(false); void handleDeleteDuplicates(); }}
                disabled={isDeletingDuplicates || duplicateSubmissionIds.length === 0}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[14px] font-semibold text-[#b3261e] active:bg-[#fdecea] disabled:opacity-40"
              >
                {isDeletingDuplicates ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete duplicates{duplicateSubmissionIds.length > 0 ? ` (${duplicateSubmissionIds.length})` : ''}
              </button>
              <button
                type="button"
                onClick={() => { setIsMobileMoreOpen(false); exportCsv(); }}
                disabled={flattenedRows.length === 0}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[14px] font-semibold text-[#0f7a44] active:bg-[#e6f5ec] disabled:opacity-40"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => { setIsMobileMoreOpen(false); fileInputRef.current?.click(); }}
                disabled={isImporting}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[14px] font-semibold text-[#1b1c1d] active:bg-[#f1eff0] disabled:opacity-40"
              >
                {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Import CSV
              </button>
              <button
                type="button"
                onClick={() => { setIsMobileMoreOpen(false); downloadTemplate(); }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[14px] font-semibold text-[#74777d] active:bg-[#f1eff0]"
              >
                <FileText className="h-4 w-4" />
                Download template
              </button>
            </div>
          </div>
        </div>
      )}
      <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportFile} />

      {/* Guest detail modal */}
      {selectedRow && (() => {
        const { submission, guest } = selectedRow;
        const propName = propertyNameMap.get(submission.propertyId) || submission.propertyId;
        const fields: { label: string; value: string | number | null | undefined }[] = [
          { label: 'Submission ID', value: submission.id },
          { label: 'Property', value: propName },
          { label: 'Check-in Date', value: submission.checkInDate },
          { label: 'Check-in Time', value: submission.checkInTime },
          { label: 'Check-out Date', value: submission.checkOutDate },
          { label: 'Check-out Time', value: submission.checkOutTime },
          { label: 'Full Name', value: guest.fullName },
          { label: 'Birth Year', value: guest.birthYear },
          { label: 'Gender', value: guest.gender },
          { label: 'Nationality', value: guest.nationality },
          { label: 'Address', value: guest.address },
          { label: 'Occupation', value: guest.occupation },
          { label: 'Document Type', value: guest.documentType },
          { label: 'Document Number', value: guest.documentNumber },
          { label: 'Contact (Phone/Email)', value: guest.contactInfo },
          { label: 'Previous Location', value: guest.previousLocation },
          { label: 'Next Location', value: guest.nextLocation },
        ];
        return (
          <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-0 md:p-4 backdrop-blur-sm" onClick={handleCloseDetail}>
            <div className="w-full max-w-lg rounded-t-2xl md:rounded-2xl bg-white shadow-xl border border-[#e4e2e3] max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#e4e2e3]">
                <div>
                  <h2 className="font-['Plus_Jakarta_Sans'] font-bold text-[16px] text-[#1b1c1d]">{guest.fullName || 'Guest Detail'}</h2>
                  <p className="text-[12px] text-[#74777d] mt-0.5">{propName} · {submission.checkInDate} → {submission.checkOutDate}</p>
                </div>
                <button onClick={handleCloseDetail} className="text-[#74777d] hover:text-[#1b1c1d]"><X className="w-5 h-5" /></button>
              </div>
              <div className="overflow-y-auto flex-1 px-5 py-4">
                {isEditingRow && editForm ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">Check-in Date</label>
                        <input type="date" value={editForm.checkInDate} onChange={(e) => handleEditFieldChange('checkInDate', e.target.value)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[13px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">Check-out Date</label>
                        <input type="date" value={editForm.checkOutDate} onChange={(e) => handleEditFieldChange('checkOutDate', e.target.value)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[13px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">Full Name</label>
                      <input value={editForm.fullName} onChange={(e) => handleEditFieldChange('fullName', e.target.value)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[13px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">Birth Year</label>
                        <input value={editForm.birthYear} onChange={(e) => handleEditFieldChange('birthYear', e.target.value)} placeholder="e.g. 1988" className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[13px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">Gender</label>
                        <input value={editForm.gender} onChange={(e) => handleEditFieldChange('gender', e.target.value)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[13px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">Nationality</label>
                        <input value={editForm.nationality} onChange={(e) => handleEditFieldChange('nationality', e.target.value)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[13px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">Occupation</label>
                        <input value={editForm.occupation} onChange={(e) => handleEditFieldChange('occupation', e.target.value)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[13px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">Address</label>
                      <input value={editForm.address} onChange={(e) => handleEditFieldChange('address', e.target.value)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[13px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">Document Type</label>
                        <select value={editForm.documentType} onChange={(e) => handleEditFieldChange('documentType', e.target.value as CheckInGuest['documentType'])} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[13px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]">
                          <option value="passport">Passport</option>
                          <option value="driver_license">Driver License</option>
                          <option value="residence_card">Residence Card</option>
                          <option value="national_id">National ID</option>
                          <option value="unknown">Unknown</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#74777d]">Document Number</label>
                        <input value={editForm.documentNumber} onChange={(e) => handleEditFieldChange('documentNumber', e.target.value)} className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[13px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                      {fields.map(f => f.value != null && String(f.value).trim() !== '' && (
                        <div key={f.label} className={['Address', 'Submission ID', 'Contact (Phone/Email)', 'Previous Location', 'Next Location'].includes(f.label) ? 'col-span-2' : ''}>
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
                  </>
                )}
              </div>
              <div className="px-5 pb-5 pt-3 border-t border-[#e4e2e3] flex flex-col gap-2">
                {isEditingRow ? (
                  <div className="flex gap-2">
                    <button onClick={() => setIsEditingRow(false)} disabled={isSavingRow} className="flex-1 rounded-full border border-[#c4c6cd] bg-white text-[#1b1c1d] font-semibold py-2.5 text-sm hover:bg-[#efedef] disabled:opacity-60">Cancel</button>
                    <button onClick={handleSaveRecord} disabled={isSavingRow} className="flex-1 inline-flex items-center justify-center gap-1 rounded-full bg-[#041627] text-white font-semibold py-2.5 text-sm hover:bg-[#041627]/90 disabled:opacity-60">
                      {isSavingRow ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save changes
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <button onClick={() => setIsEditingRow(true)} className="flex-1 inline-flex items-center justify-center gap-1 rounded-full border border-[#c4c6cd] bg-white text-[#1b1c1d] font-semibold py-2.5 text-sm hover:bg-[#efedef]"><Pencil className="w-4 h-4" />Edit record</button>
                      <button onClick={handleDeleteRecord} disabled={isDeletingRow} className="flex-1 inline-flex items-center justify-center gap-1 rounded-full border border-[#f0b4b4] bg-[#fff8f8] text-[#a23535] font-semibold py-2.5 text-sm hover:bg-[#ffecec] disabled:opacity-60">
                        {isDeletingRow ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        Delete record
                      </button>
                    </div>
                    <button onClick={handleCloseDetail} className="w-full rounded-full bg-[#041627] text-white font-semibold py-2.5 text-sm hover:bg-[#041627]/90">Close</button>
                  </>
                )}
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
