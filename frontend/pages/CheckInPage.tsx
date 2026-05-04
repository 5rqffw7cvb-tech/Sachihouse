import React, { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { Check, FileBadge2, Loader2, PencilLine, Plus, Trash2, Upload, X } from 'lucide-react';
import { PropertyData, CheckInGuest, CheckInGuestEstimatedFlags } from '../types';
import { CheckInConsentPolicy, ocrGuestDocument, startCheckInSession, submitCheckIn } from '../services/checkin';
import { ApiError } from '../services/api';
import { HoldToSubmitButton } from '../components/HoldToSubmitButton';
import { TopNavBar } from '../components/TopNavBar';
import { MobileBottomNav } from '../components/MobileBottomNav';

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

const estimatedFieldLabels: Partial<Record<keyof CheckInGuestEstimatedFlags, string>> = {
  fullName: 'Name',
  birthYear: 'Birth year',
  nationality: 'Nationality',
  address: 'Address',
  gender: 'Gender',
  occupation: 'Occupation',
  documentType: 'Document type',
  documentNumber: 'Document number',
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
      <TopNavBar />
      <main className="mx-auto max-w-md px-4 pb-28 pt-[88px]">
        {/* Header */}
        <div className="mb-6">
          <p className="text-xs font-medium uppercase tracking-widest text-gray-400">{data.name}</p>
          <h1 className="mt-1 text-2xl font-bold">Guest check-in</h1>
        </div>

        {isInitializing && (
          <div className="mb-4 flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Starting session…
          </div>
        )}
        {sessionError && (
          <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{sessionError}</p>
        )}

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-400">Check-in</p>
            <input
              type="date"
              value={checkInDate}
              onChange={(event) => setCheckInDate(event.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-900"
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-400">Check-out</p>
            <input
              type="date"
              value={checkOutDate}
              onChange={(event) => setCheckOutDate(event.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-900"
            />
          </div>
        </div>

        {/* Guest list */}
        <div className="mt-6 space-y-2">
          {guests.map((guest, index) => {
            const isEmpty = isGuestEmpty(guest);
            const isProcessing = Boolean(processingByGuest[guest.id]);
            const hasPreview = Boolean(photoPreviewByGuest[guest.id]);
            const isConfirmed = reviewedGuestIds.includes(guest.id) && Boolean(guest.evidenceUrl) && Boolean(guest.fullName.trim());
            const needsReview = !isEmpty && !isConfirmed && !isProcessing;
            const guestError = errorByGuest[guest.id];

            return (
              <React.Fragment key={guest.id}>
                <div
                  className={`flex items-center gap-3 rounded-2xl border p-3 transition-colors ${
                    isConfirmed
                      ? 'border-green-200 bg-green-50'
                      : needsReview
                        ? 'border-amber-200 bg-amber-50'
                        : isProcessing
                          ? 'border-gray-200 bg-gray-50'
                          : 'border-dashed border-blue-200 bg-blue-50'
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
                        ? 'Scanning…'
                        : isConfirmed
                          ? 'Confirmed ✓'
                          : needsReview
                            ? 'Review required'
                            : 'Upload ID to continue'}
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
                      Review →
                    </button>
                  ) : isConfirmed ? (
                    <button
                      type="button"
                      onClick={() => openEditor(guest.id)}
                      className="shrink-0 rounded-xl border border-gray-200 p-2 text-gray-400 hover:text-gray-700"
                      aria-label="Edit"
                    >
                      <PencilLine className="h-4 w-4" />
                    </button>
                  ) : (
                    <label
                      className={`shrink-0 cursor-pointer rounded-xl px-3 py-1.5 text-xs font-bold ${
                        !checkinToken ? 'cursor-not-allowed bg-gray-100 text-gray-400' : 'bg-gray-900 text-white hover:bg-gray-700'
                      }`}
                    >
                      <Upload className="mr-1 inline-block h-3.5 w-3.5" />
                      Upload ID
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

                {guestError && (
                  <p className="px-2 text-xs text-red-600">{guestError}</p>
                )}
              </React.Fragment>
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
          <Plus className="h-4 w-4" /> Add another guest
        </button>

        {/* Submit */}
        <div className="mt-8">
          {submitError && (
            <p className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</p>
          )}
          <HoldToSubmitButton
            disabled={!canSubmit || isSubmitting}
            holdMs={1000}
            label={isSubmitting ? 'Submitting…' : 'Hold to send check-in'}
            onComplete={handleSubmit}
          />
        </div>
      </main>

      {/* Success popup */}
      {submitSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">Check-in submitted!</h2>
            <p className="mt-2 text-sm text-gray-400">Reference: {submitSuccess}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 w-full rounded-2xl bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-gray-700"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* OCR review popup */}
      {editorDraft && editorGuestId && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm md:items-center">
          <div className="max-h-[92vh] w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                  Guest {Number(guestIndexById[editorGuestId] ?? 0) + 1}
                </p>
                <h2 className="mt-0.5 text-lg font-bold text-gray-900">Review ID details</h2>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-full border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              {photoPreviewByGuest[editorGuestId] && (
                <img
                  src={photoPreviewByGuest[editorGuestId]}
                  alt="ID preview"
                  className="mb-4 h-36 w-full rounded-2xl object-cover"
                />
              )}

              {editorError && (
                <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{editorError}</p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
                  Full name *
                  <input
                    value={editorDraft.fullName}
                    onChange={(event) => {
                      setEditorDraft((prev) => (prev ? { ...prev, fullName: event.target.value } : prev));
                      setEditorError(null);
                    }}
                    className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal text-gray-900"
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                  Birth year
                  <input
                    type="number"
                    value={editorDraft.birthYear ?? ''}
                    onChange={(event) => {
                      setEditorDraft((prev) => (prev ? { ...prev, birthYear: event.target.value ? Number(event.target.value) : null } : prev));
                      setEditorError(null);
                    }}
                    className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal text-gray-900"
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                  Gender
                  <input
                    value={editorDraft.gender}
                    onChange={(event) => {
                      setEditorDraft((prev) => (prev ? { ...prev, gender: event.target.value } : prev));
                      setEditorError(null);
                    }}
                    className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal text-gray-900"
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                  Nationality
                  <input
                    value={editorDraft.nationality}
                    onChange={(event) => {
                      setEditorDraft((prev) => (prev ? { ...prev, nationality: event.target.value } : prev));
                      setEditorError(null);
                    }}
                    className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal text-gray-900"
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                  Occupation
                  <input
                    value={editorDraft.occupation}
                    onChange={(event) => {
                      setEditorDraft((prev) => (prev ? { ...prev, occupation: event.target.value } : prev));
                      setEditorError(null);
                    }}
                    className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal text-gray-900"
                  />
                </label>

                <label className="col-span-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
                  Address
                  <input
                    value={editorDraft.address}
                    onChange={(event) => {
                      setEditorDraft((prev) => (prev ? { ...prev, address: event.target.value } : prev));
                      setEditorError(null);
                    }}
                    className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal text-gray-900"
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                  Document #
                  <input
                    value={editorDraft.documentNumber}
                    onChange={(event) => {
                      setEditorDraft((prev) => (prev ? { ...prev, documentNumber: event.target.value } : prev));
                      setEditorError(null);
                    }}
                    className="mt-1 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal text-gray-900"
                  />
                </label>

                <label className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                  Document type
                  <select
                    value={editorDraft.documentType}
                    onChange={(event) => {
                      setEditorDraft((prev) => (prev ? { ...prev, documentType: event.target.value as CheckInGuest['documentType'] } : prev));
                      setEditorError(null);
                    }}
                    className="mt-1 block w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-normal text-gray-900"
                  >
                    {Object.entries(documentTypeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t bg-gray-50 px-5 py-4">
              <button
                type="button"
                onClick={() => resetGuestCapture(editorGuestId)}
                className="text-sm font-medium text-gray-400 hover:text-gray-700"
              >
                Use another photo
              </button>
              <button
                type="button"
                onClick={confirmGuestDetails}
                className="flex items-center gap-2 rounded-2xl bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-700"
              >
                <Check className="h-4 w-4" /> Confirm guest
              </button>
            </div>
          </div>
        </div>
      )}

      <MobileBottomNav />
    </div>
  );
};

export default CheckInPage;
