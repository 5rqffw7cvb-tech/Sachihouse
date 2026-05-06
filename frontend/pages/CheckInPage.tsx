import React, { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronUp, EyeOff, FileBadge2, Lock, Loader2, Menu, PencilLine, Plus, ShieldCheck, Upload, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PropertyData, CheckInGuest } from '../types';
import { CheckInConsentPolicy, ocrGuestDocument, startCheckInSession, submitCheckIn } from '../services/checkin';
import { ApiError, ApiUser } from '../services/api';
import { getCurrentUser, subscribeToAuth } from '../services/auth';
import { HoldToSubmitButton } from '../components/HoldToSubmitButton';
import { TopNavBar } from '../components/TopNavBar';
import { useLanguage } from '../contexts/LanguageContext';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

interface CheckInPageProps {
  data: PropertyData;
  propertyId: string;
}

const documentTypeLabels: Record<CheckInGuest['documentType'], string> = {
  passport: 'Passport',
  driver_license: 'Driver license',
  residence_card: 'Residence card',
  national_id: 'National ID',
  unknown: 'Unknown document',
};

const createGuestId = (): string => `guest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

const createEmptyGuest = (id: string): CheckInGuest => ({
  id,
  fullName: '',
  birthYear: null,
  nationality: '',
  address: '',
  gender: '',
  occupation: '',
  documentType: 'unknown',
  documentNumber: '',
  evidenceUrl: '',
  evidenceMimeType: 'image/jpeg',
  ocrText: '',
  estimated: {},
  confidence: {},
});

const toDateInput = (offsetDays = 0): string => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

const isGuestEmpty = (guest: CheckInGuest): boolean => {
  return !guest.evidenceUrl
    && !guest.fullName.trim()
    && guest.birthYear === null
    && !guest.nationality.trim()
    && !guest.address.trim()
    && !guest.gender.trim()
    && !guest.occupation.trim()
    && guest.documentType === 'unknown'
    && !guest.documentNumber.trim();
};

const CheckInPage: React.FC<CheckInPageProps> = ({ data, propertyId }) => {
  const { t } = useLanguage();
  const [checkInDate, setCheckInDate] = useState<string>(toDateInput(0));
  const [checkOutDate, setCheckOutDate] = useState<string>(toDateInput(1));
  const [guests, setGuests] = useState<CheckInGuest[]>([createEmptyGuest('guest_1')]);
  const [photoPreviewByGuest, setPhotoPreviewByGuest] = useState<Record<string, string>>({});
  const [processingByGuest, setProcessingByGuest] = useState<Record<string, boolean>>({});
  const [errorByGuest, setErrorByGuest] = useState<Record<string, string>>({});
  const [reviewedGuestIds, setReviewedGuestIds] = useState<string[]>([]);
  const [editorGuestId, setEditorGuestId] = useState<string | null>(null);
  const [editorDraft, setEditorDraft] = useState<CheckInGuest | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [checkinToken, setCheckinToken] = useState<string>('');
  const [consentPolicy, setConsentPolicy] = useState<CheckInConsentPolicy | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [authUser, setAuthUser] = useState<ApiUser | null>(() => getCurrentUser());

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setIsInitializing(true);
      setSessionError(null);
      try {
        const response = await startCheckInSession(propertyId);
        if (!cancelled) {
          setCheckinToken(response.checkinToken);
          setConsentPolicy(response.consentPolicy);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to initialize check-in session.';
          setSessionError(message);
        }
      } finally {
        if (!cancelled) {
          setIsInitializing(false);
        }
      }
    };

    void init();

    return () => {
      cancelled = true;
    };
  }, [propertyId]);

  useEffect(() => {
    let unsub = () => {};
    subscribeToAuth((user) => setAuthUser(user)).then((fn) => { unsub = fn; });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const guestIndexById = useMemo(() => Object.fromEntries(guests.map((guest, index) => [guest.id, index])), [guests]);
  const guestsForSubmission = useMemo(() => guests.filter((guest) => !isGuestEmpty(guest)), [guests]);
  const processingGuestCount = useMemo(() => Object.values(processingByGuest).filter(Boolean).length, [processingByGuest]);
  const confirmedGuestCount = useMemo(() => {
    return guestsForSubmission.filter((guest) => reviewedGuestIds.includes(guest.id) && guest.evidenceUrl && guest.fullName.trim()).length;
  }, [guestsForSubmission, reviewedGuestIds]);

  const canSubmit = useMemo(() => {
    if (!checkInDate || !checkOutDate || checkInDate >= checkOutDate) {
      return false;
    }
    if (!checkinToken || !consentPolicy) {
      return false;
    }
    if (guestsForSubmission.length === 0 || processingGuestCount > 0 || editorDraft) {
      return false;
    }
    return guestsForSubmission.every((guest) => guest.evidenceUrl && guest.fullName.trim() && reviewedGuestIds.includes(guest.id));
  }, [checkInDate, checkOutDate, checkinToken, consentPolicy, guestsForSubmission, processingGuestCount, editorDraft, reviewedGuestIds]);

  const pendingReviewCount = Math.max(0, guestsForSubmission.length - confirmedGuestCount);
  const datesReady = Boolean(checkInDate && checkOutDate && checkInDate < checkOutDate);
  const progressPercent = canSubmit
    ? 100
    : guestsForSubmission.length > 0
      ? Math.max(24, Math.round((confirmedGuestCount / guestsForSubmission.length) * 100))
      : datesReady
        ? 12
        : 0;
  const currentStepTitle = processingGuestCount > 0
    ? 'AI is reading the current document'
    : pendingReviewCount > 0
      ? 'Review and confirm the pending guest'
      : confirmedGuestCount > 0
        ? 'Everything is ready for final send'
        : 'Upload the first guest ID';
  const currentStepDescription = processingGuestCount > 0
    ? 'Keep this page open for a moment. The review popup will appear as soon as the scan finishes.'
    : pendingReviewCount > 0
      ? 'Open the review popup, fix anything that looks off, then confirm and continue to the next guest.'
      : confirmedGuestCount > 0
        ? 'All confirmed guests are ready. Hold the button once to send the full check-in.'
        : 'Start with the lead guest. The flow will create the next slot automatically after each confirmation.';

  const replaceGuest = (guestId: string, nextGuest: CheckInGuest) => {
    setGuests((prev) => prev.map((guest) => (guest.id === guestId ? nextGuest : guest)));
  };

  const updateGuest = (guestId: string, patch: Partial<CheckInGuest>) => {
    setGuests((prev) => prev.map((guest) => (guest.id === guestId ? { ...guest, ...patch } : guest)));
  };

  const ensureDraftGuest = () => {
    setGuests((prev) => (prev.some((guest) => isGuestEmpty(guest)) ? prev : [...prev, createEmptyGuest(createGuestId())]));
  };

  const addGuest = () => {
    if (guests.some((guest) => isGuestEmpty(guest))) {
      return;
    }
    setGuests((prev) => [...prev, createEmptyGuest(createGuestId())]);
  };

  const closeEditor = () => {
    setEditorGuestId(null);
    setEditorDraft(null);
    setEditorError(null);
  };

  const clearGuestFeedback = (guestId: string) => {
    setErrorByGuest((prev) => {
      const next = { ...prev };
      delete next[guestId];
      return next;
    });
    setProcessingByGuest((prev) => {
      const next = { ...prev };
      delete next[guestId];
      return next;
    });
  };

  const resetGuestCapture = (guestId: string) => {
    replaceGuest(guestId, createEmptyGuest(guestId));
    setReviewedGuestIds((prev) => prev.filter((id) => id !== guestId));
    setPhotoPreviewByGuest((prev) => {
      const next = { ...prev };
      delete next[guestId];
      return next;
    });
    clearGuestFeedback(guestId);
    if (editorGuestId === guestId) {
      closeEditor();
    }
  };

  const removeGuest = (guestId: string) => {
    setGuests((prev) => {
      if (prev.length <= 1) {
        return [createEmptyGuest('guest_1')];
      }
      const next = prev.filter((guest) => guest.id !== guestId);
      return next.length === 0 ? [createEmptyGuest('guest_1')] : next;
    });
    setReviewedGuestIds((prev) => prev.filter((id) => id !== guestId));
    setPhotoPreviewByGuest((prev) => {
      const next = { ...prev };
      delete next[guestId];
      return next;
    });
    clearGuestFeedback(guestId);
    if (editorGuestId === guestId) {
      closeEditor();
    }
  };

  const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read image.'));
    reader.readAsDataURL(file);
  });

  const openEditor = (guestId: string) => {
    if (editorGuestId === guestId) {
      closeEditor();
      return;
    }
    const guest = guests.find((candidate) => candidate.id === guestId);
    if (!guest || isGuestEmpty(guest)) {
      return;
    }
    setEditorGuestId(guestId);
    setEditorDraft({ ...guest });
    setEditorError(null);
  };

  const handleImageChange = async (guestId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    setSubmitError(null);
    setSubmitSuccess(null);
    setErrorByGuest((prev) => ({ ...prev, [guestId]: '' }));
    setProcessingByGuest((prev) => ({ ...prev, [guestId]: true }));
    setReviewedGuestIds((prev) => prev.filter((id) => id !== guestId));

    try {
      const base64 = await fileToBase64(file);
      setPhotoPreviewByGuest((prev) => ({ ...prev, [guestId]: base64 }));

      const extracted = await ocrGuestDocument(propertyId, {
        imageBase64: base64,
        guestId,
        checkinToken,
      });

      updateGuest(guestId, extracted);
      setEditorGuestId(guestId);
      setEditorDraft({ ...extracted });
      setEditorError(null);
    } catch (error) {
      const message = error instanceof ApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unable to process this image. Please upload a clear government-issued ID.';
      setErrorByGuest((prev) => ({ ...prev, [guestId]: message }));
    } finally {
      setProcessingByGuest((prev) => ({ ...prev, [guestId]: false }));
    }
  };

  const confirmGuestDetails = () => {
    if (!editorGuestId || !editorDraft) {
      return;
    }

    const normalizedGuest: CheckInGuest = {
      ...editorDraft,
      fullName: editorDraft.fullName.trim(),
      nationality: editorDraft.nationality.trim(),
      address: editorDraft.address.trim(),
      gender: editorDraft.gender.trim(),
      occupation: editorDraft.occupation.trim(),
      documentNumber: editorDraft.documentNumber.trim(),
    };

    if (!normalizedGuest.fullName || !normalizedGuest.evidenceUrl) {
      setEditorError('Full name and an uploaded ID image are required before confirming this guest.');
      return;
    }

    replaceGuest(editorGuestId, normalizedGuest);
    setReviewedGuestIds((prev) => Array.from(new Set([...prev, editorGuestId])));
    closeEditor();
    ensureDraftGuest();
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      return;
    }

    setSubmitError(null);
    setSubmitSuccess(null);
    setIsSubmitting(true);

    try {
      const submission = await submitCheckIn(propertyId, {
        checkinToken,
        checkInDate,
        checkOutDate,
        guests: guestsForSubmission,
        consent: {
          accepted: true,
          acceptedAt: Date.now(),
          noticeVersion: consentPolicy?.noticeVersion ?? 'v1',
        },
      });
      setSubmitSuccess(submission.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit check-in.';
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Mobile header with hamburger */}
      <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/95 backdrop-blur-sm md:hidden" ref={menuRef}>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-base font-bold text-gray-900">{data.name}</span>
          <div className="flex items-center gap-1">
            <LanguageSwitcher compact />
            {/* Hamburger */}
            <button
              type="button"
              onClick={() => { setMenuOpen((v) => !v); }}
              className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 active:bg-gray-200"
              aria-label="Menu"
              aria-expanded={menuOpen}
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="border-t border-gray-100 bg-white px-2 py-1">
            <Link to="/" onClick={() => setMenuOpen(false)} className="block rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Home</Link>
            <Link to="/blog" onClick={() => setMenuOpen(false)} className="block rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Blog</Link>
            {authUser ? (
              <>
                {(authUser.role === 'ADMIN' || authUser.role === 'HOST') && (
                  <Link to="/admin/checkin-management" onClick={() => setMenuOpen(false)} className="block rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Check-in Management</Link>
                )}
                {(authUser.role === 'ADMIN' || authUser.role === 'HOST') && (
                  <Link to="/admin/properties" onClick={() => setMenuOpen(false)} className="block rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Property Admin</Link>
                )}
              </>
            ) : (
              <Link to="/login" onClick={() => setMenuOpen(false)} className="block rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Login</Link>
            )}
          </div>
        )}
      </header>

      {/* Desktop navbar */}
      <div className="hidden md:block">
        <TopNavBar />
      </div>

      <main className="mx-auto max-w-md px-4 pb-36 pt-4 md:pb-28 md:pt-[88px]">
        {/* Header */}
        <div className="mb-5">
          <h1 className="text-2xl font-bold">{t('checkin_title')}</h1>
          <p className="mt-1 text-sm text-gray-400">{currentStepDescription}</p>
        </div>

        {isInitializing && (
          <div className="mb-4 flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('checkin_session_starting')}
          </div>
        )}
        {sessionError && (
          <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{sessionError}</p>
        )}

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-400">{t('checkin_date_in')}</p>
            <input
              type="date"
              value={checkInDate}
              onChange={(event) => setCheckInDate(event.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-900"
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-400">{t('checkin_date_out')}</p>
            <input
              type="date"
              value={checkOutDate}
              onChange={(event) => setCheckOutDate(event.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-900"
            />
          </div>
        </div>

        {/* Guest list */}
        <div className="mt-5 space-y-2">
          {guests.map((guest, index) => {
            const isExpanded = editorGuestId === guest.id;
            const isEmpty = isGuestEmpty(guest);
            const isProcessing = Boolean(processingByGuest[guest.id]);
            const hasPreview = Boolean(photoPreviewByGuest[guest.id]);
            const isConfirmed = reviewedGuestIds.includes(guest.id) && Boolean(guest.evidenceUrl) && Boolean(guest.fullName.trim());
            const needsReview = !isEmpty && !isConfirmed && !isProcessing;
            const guestError = errorByGuest[guest.id];

            return (
              <div key={guest.id}>
                {/* Guest row */}
                <div
                  className={`flex items-center gap-3 border p-3 transition-colors ${
                    isExpanded
                      ? 'rounded-t-2xl rounded-b-none border-b-transparent border-gray-200 bg-white'
                      : isConfirmed
                        ? 'rounded-2xl border-green-200 bg-green-50'
                        : needsReview
                          ? 'rounded-2xl border-amber-200 bg-amber-50'
                          : isProcessing
                            ? 'rounded-2xl border-gray-200 bg-gray-50'
                            : 'rounded-2xl border-dashed border-blue-200 bg-blue-50'
                  }`}
                >
                  {/* Thumbnail */}
                  {hasPreview ? (
                    <img
                      src={photoPreviewByGuest[guest.id]}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-300">
                      <FileBadge2 className="h-6 w-6" />
                    </div>
                  )}

                  {/* Name + status */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {isEmpty ? `Guest ${index + 1}` : guest.fullName || `Guest ${index + 1}`}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {isProcessing
                        ? t('checkin_scanning')
                        : isConfirmed
                          ? t('checkin_confirmed')
                          : needsReview
                            ? t('checkin_needs_review')
                            : t('checkin_upload_prompt')}
                    </p>
                  </div>

                  {/* Action */}
                  {isProcessing ? (
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin text-gray-400" />
                  ) : needsReview ? (
                    <button
                      type="button"
                      onClick={() => openEditor(guest.id)}
                      className="shrink-0 rounded-xl bg-amber-400 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500"
                    >
                      {t('checkin_review_btn')}
                    </button>
                  ) : isConfirmed ? (
                    <button
                      type="button"
                      onClick={() => openEditor(guest.id)}
                      className="shrink-0 rounded-xl border border-gray-200 p-2 text-gray-400 hover:text-gray-700"
                      aria-label="Edit"
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <PencilLine className="h-4 w-4" />}
                    </button>
                  ) : (
                    <label
                      className={`shrink-0 cursor-pointer rounded-xl px-3 py-1.5 text-xs font-bold ${
                        !checkinToken ? 'cursor-not-allowed bg-gray-100 text-gray-400' : 'bg-gray-900 text-white hover:bg-gray-700'
                      }`}
                    >
                      <Upload className="mr-1 inline-block h-3.5 w-3.5" />
                      {t('checkin_upload_btn')}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => void handleImageChange(guest.id, event)}
                        className="hidden"
                        disabled={!checkinToken || isProcessing}
                      />
                    </label>
                  )}

                  {/* Remove */}
                  {!isProcessing && guests.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeGuest(guest.id)}
                      className="shrink-0 rounded-xl border border-transparent p-2 text-gray-300 hover:border-gray-200 hover:text-red-400"
                      aria-label="Remove guest"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Inline accordion */}
                {isExpanded && editorDraft && (
                  <div className="rounded-b-2xl border border-t-0 border-gray-200 bg-white px-4 pb-4 pt-2">
                    {photoPreviewByGuest[guest.id] && (
                      <img
                        src={photoPreviewByGuest[guest.id]}
                        alt="ID"
                        className="mb-3 h-16 w-full rounded-xl object-cover"
                      />
                    )}
                    {editorError && (
                      <p className="mb-2 text-xs text-red-600">{editorError}</p>
                    )}

                    <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                      <div className="col-span-2">
                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">{t('checkin_popup_fullname')}</p>
                        <input
                          value={editorDraft.fullName}
                          onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, fullName: event.target.value } : prev)); setEditorError(null); }}
                          className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900"
                        />
                      </div>
                      <div>
                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">{t('checkin_popup_birthyear')}</p>
                        <input
                          type="number"
                          value={editorDraft.birthYear ?? ''}
                          onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, birthYear: event.target.value ? Number(event.target.value) : null } : prev)); setEditorError(null); }}
                          className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900"
                        />
                      </div>
                      <div>
                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">{t('checkin_popup_gender')}</p>
                        <input
                          value={editorDraft.gender}
                          onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, gender: event.target.value } : prev)); setEditorError(null); }}
                          className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900"
                        />
                      </div>
                      <div>
                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">{t('checkin_popup_nationality')}</p>
                        <input
                          value={editorDraft.nationality}
                          onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, nationality: event.target.value } : prev)); setEditorError(null); }}
                          className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900"
                        />
                      </div>
                      <div>
                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">{t('checkin_popup_occupation')}</p>
                        <input
                          value={editorDraft.occupation}
                          onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, occupation: event.target.value } : prev)); setEditorError(null); }}
                          className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900"
                        />
                      </div>
                      <div className="col-span-2">
                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">{t('checkin_popup_address')}</p>
                        <input
                          value={editorDraft.address}
                          onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, address: event.target.value } : prev)); setEditorError(null); }}
                          className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900"
                        />
                      </div>
                      <div>
                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">{t('checkin_popup_docnum')}</p>
                        <input
                          value={editorDraft.documentNumber}
                          onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, documentNumber: event.target.value } : prev)); setEditorError(null); }}
                          className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900"
                        />
                      </div>
                      <div>
                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">{t('checkin_popup_doctype')}</p>
                        <select
                          value={editorDraft.documentType}
                          onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, documentType: event.target.value as CheckInGuest['documentType'] } : prev)); setEditorError(null); }}
                          className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900"
                        >
                          {Object.entries(documentTypeLabels).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
                      <button
                        type="button"
                        onClick={() => resetGuestCapture(guest.id)}
                        className="text-xs text-gray-400 hover:text-gray-700"
                      >
                        {t('checkin_popup_another')}
                      </button>
                      <button
                        type="button"
                        onClick={confirmGuestDetails}
                        className="flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-gray-700"
                      >
                        <Check className="h-3.5 w-3.5" /> {t('checkin_popup_confirm')}
                      </button>
                    </div>
                  </div>
                )}

                {guestError && (
                  <p className="px-2 pt-1 text-xs text-red-600">{guestError}</p>
                )}
              </div>
            );
          })}
        </div>

        {/* Add guest */}
        <button
          type="button"
          onClick={addGuest}
          disabled={guests.some((g) => isGuestEmpty(g))}
          className="mt-3 flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 disabled:opacity-30"
        >
          <Plus className="h-4 w-4" /> {t('checkin_add_guest')}
        </button>

        {/* Security trust strip */}
        <div className="mt-5 flex items-center justify-center gap-5 rounded-xl border border-[#e4e2e3] bg-[#f5f3f4] px-4 py-3">
          <span className="flex items-center gap-1.5 text-[#44474c]">
            <Lock className="h-4 w-4 text-[#0f7a44]" strokeWidth={2.5} />
            <span className="text-[11px] font-semibold uppercase tracking-wide">SSL</span>
          </span>
          <span className="h-4 w-px bg-[#e4e2e3]" />
          <ShieldCheck className="h-5 w-5 text-[#0f7a44]" strokeWidth={2} />
          <span className="h-4 w-px bg-[#e4e2e3]" />
          <span className="flex items-center gap-1.5 text-[#44474c]">
            <EyeOff className="h-4 w-4 text-[#44474c]" strokeWidth={2} />
            <span className="text-[11px] font-semibold uppercase tracking-wide">Private</span>
          </span>
        </div>

        {/* Submit — desktop in-flow */}
        <div className="mt-6 hidden md:block">
          {submitError && (
            <p className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</p>
          )}
          <HoldToSubmitButton
            disabled={!canSubmit || isSubmitting}
            holdMs={1000}
            label={isSubmitting ? t('checkin_submitting') : t('checkin_hold_send')}
            onComplete={handleSubmit}
          />
        </div>
      </main>

      {/* Fixed bottom bar — mobile */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-100 bg-white px-4 pb-4 pt-3 md:hidden">
        {submitError && (
          <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{submitError}</p>
        )}
        <HoldToSubmitButton
          disabled={!canSubmit || isSubmitting}
          holdMs={1000}
          label={isSubmitting ? t('checkin_submitting') : t('checkin_hold_send')}
          onComplete={handleSubmit}
        />
      </div>

      {/* Success popup */}
      {submitSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">{t('checkin_success_title')}</h2>
            <p className="mt-2 text-sm text-gray-400">{t('checkin_success_ref')}: {submitSuccess}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 w-full rounded-2xl bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-gray-700"
            >
              {t('checkin_success_done')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CheckInPage;
