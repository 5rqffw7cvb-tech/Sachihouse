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
  const [hasAcceptedConsent, setHasAcceptedConsent] = useState(false);
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
    if (!checkinToken || !consentPolicy || !hasAcceptedConsent) {
      return false;
    }
    if (guestsForSubmission.length === 0 || processingGuestCount > 0 || editorDraft) {
      return false;
    }
    return guestsForSubmission.every((guest) => guest.evidenceUrl && guest.fullName.trim() && reviewedGuestIds.includes(guest.id));
  }, [checkInDate, checkOutDate, checkinToken, consentPolicy, hasAcceptedConsent, guestsForSubmission, processingGuestCount, editorDraft, reviewedGuestIds]);

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
      setSubmitSuccess(`Check-in submitted successfully. Reference: ${submission.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit check-in.';
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fbf9fa] text-[#1b1c1d]">
      <TopNavBar />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-[110px] md:pb-10">
        <section className="overflow-hidden rounded-[28px] border border-[#e4e2e3] bg-white shadow-sm">
          <div className="border-b border-[#ece9ea] bg-[linear-gradient(135deg,#fffaf3_0%,#f7f4ff_100%)] px-5 py-6 md:px-8">
            <h1 className="font-['Plus_Jakarta_Sans'] text-2xl font-bold md:text-3xl">Property Check-in</h1>
            <p className="mt-2 max-w-2xl text-sm text-[#4b4f56] md:text-base">
              {data.name}: upload one guest ID at a time, let AI read it, confirm the popup details, then move on to the next guest.
            </p>
          </div>

          <div className="space-y-6 px-5 py-6 md:px-8 md:py-8">
            {isInitializing && (
              <div className="inline-flex items-center gap-2 rounded-full bg-[#f4f2f3] px-3 py-2 text-sm text-[#44474c]">
                <Loader2 className="h-4 w-4 animate-spin" /> Initializing secure check-in session...
              </div>
            )}

            {sessionError && <p className="text-sm text-red-700">{sessionError}</p>}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_290px]">
              <div className="rounded-2xl border border-[#ece9ea] bg-[#fcfbfb] p-4 md:p-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="text-sm font-semibold text-[#1b1c1d]">
                    Check-in Date
                    <input
                      type="date"
                      value={checkInDate}
                      onChange={(event) => setCheckInDate(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-[#cfd2d8] px-3 py-2"
                    />
                  </label>
                  <label className="text-sm font-semibold text-[#1b1c1d]">
                    Check-out Date
                    <input
                      type="date"
                      value={checkOutDate}
                      onChange={(event) => setCheckOutDate(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-[#cfd2d8] px-3 py-2"
                    />
                  </label>
                </div>
              </div>

              <aside className="rounded-2xl border border-[#ece9ea] bg-[#041627] p-4 text-white md:p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-white/65">Guest Progress</p>
                <p className="mt-3 text-3xl font-bold">{confirmedGuestCount}</p>
                <p className="text-sm text-white/72">confirmed guest{confirmedGuestCount === 1 ? '' : 's'}</p>
                <div className="mt-4 space-y-2 text-sm text-white/72">
                  <p>{processingGuestCount > 0 ? `${processingGuestCount} scan running` : 'No scan running'}</p>
                  <p>{guestsForSubmission.length - confirmedGuestCount > 0 ? `${guestsForSubmission.length - confirmedGuestCount} guest needs review` : 'Ready to submit once consent is checked'}</p>
                </div>
              </aside>
            </div>

            <div className="space-y-3">
              {guests.map((guest, index) => {
                const isEmpty = isGuestEmpty(guest);
                const isProcessing = Boolean(processingByGuest[guest.id]);
                const hasPreview = Boolean(photoPreviewByGuest[guest.id]);
                const isConfirmed = reviewedGuestIds.includes(guest.id) && guest.evidenceUrl && guest.fullName.trim();
                const needsReview = !isEmpty && !isConfirmed;

                return (
                  <article
                    key={guest.id}
                    className={`rounded-2xl border p-4 transition-colors md:p-5 ${isEmpty ? 'border-dashed border-[#cfd2d8] bg-[#fbfbfb]' : 'border-[#e6e3e4] bg-white'}`}
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="flex min-w-0 flex-1 gap-4">
                        {hasPreview ? (
                          <img
                            src={photoPreviewByGuest[guest.id]}
                            alt={`Guest ${index + 1} ID preview`}
                            className="h-20 w-28 shrink-0 rounded-2xl border border-[#e4e2e3] object-cover"
                          />
                        ) : (
                          <div className="flex h-20 w-28 shrink-0 items-center justify-center rounded-2xl border border-dashed border-[#cfd2d8] bg-[#f7f5f6] text-[#66707a]">
                            <FileBadge2 className="h-6 w-6" />
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-[#1b1c1d]">Guest {index + 1}</p>
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${isConfirmed ? 'bg-[#dff6ea] text-[#0f6b45]' : needsReview ? 'bg-[#fff2cc] text-[#7a5200]' : 'bg-[#eef2f6] text-[#51606d]'}`}
                            >
                              {isConfirmed ? 'Confirmed' : needsReview ? 'Needs review' : 'Waiting for ID'}
                            </span>
                          </div>

                          {isEmpty ? (
                            <p className="mt-2 text-sm text-[#59616b]">
                              Upload an ID. AI will scan it and open a compact confirmation popup before you continue to the next guest.
                            </p>
                          ) : (
                            <>
                              <p className="mt-2 truncate text-sm font-semibold text-[#1b1c1d]">{guest.fullName || 'Awaiting OCR details'}</p>
                              <div className="mt-2 flex flex-wrap gap-2 text-xs text-[#59616b]">
                                <span className="rounded-full bg-[#f4f2f3] px-2.5 py-1">{documentTypeLabels[guest.documentType]}</span>
                                {guest.documentNumber && <span className="rounded-full bg-[#f4f2f3] px-2.5 py-1">{guest.documentNumber}</span>}
                                {guest.nationality && <span className="rounded-full bg-[#f4f2f3] px-2.5 py-1">{guest.nationality}</span>}
                                {guest.birthYear && <span className="rounded-full bg-[#f4f2f3] px-2.5 py-1">Born {guest.birthYear}</span>}
                              </div>
                            </>
                          )}

                          {isProcessing && (
                            <div className="mt-3 inline-flex items-center gap-2 text-sm text-[#44474c]">
                              <Loader2 className="h-4 w-4 animate-spin" /> AI is validating and extracting data...
                            </div>
                          )}

                          {errorByGuest[guest.id] && <p className="mt-3 text-sm text-red-700">{errorByGuest[guest.id]}</p>}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 md:max-w-[240px] md:justify-end">
                        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold ${isProcessing || !checkinToken ? 'cursor-not-allowed border-[#d4d7db] text-[#94a0ad]' : 'border-[#041627] text-[#041627]'}`}>
                          <Upload className="h-4 w-4" />
                          <span>{isEmpty ? 'Upload ID' : 'Replace image'}</span>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(event) => void handleImageChange(guest.id, event)}
                            className="hidden"
                            disabled={isProcessing || !checkinToken}
                          />
                        </label>

                        {!isEmpty && (
                          <button
                            type="button"
                            onClick={() => openEditor(guest.id)}
                            className="inline-flex items-center gap-2 rounded-full border border-[#d4d7db] px-4 py-2 text-sm font-semibold text-[#24303b]"
                          >
                            <PencilLine className="h-4 w-4" /> Review
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => removeGuest(guest.id)}
                          className="inline-flex items-center gap-2 rounded-full border border-[#f0d4d4] px-4 py-2 text-sm font-semibold text-[#a33c3c]"
                          disabled={guests.length <= 1}
                        >
                          <Trash2 className="h-4 w-4" /> Remove
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <button
              type="button"
              onClick={addGuest}
              className="inline-flex items-center gap-2 rounded-full border border-[#041627] px-4 py-2 font-semibold text-[#041627] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={guests.some((guest) => isGuestEmpty(guest))}
            >
              <Plus className="h-4 w-4" /> Add another guest slot
            </button>

            {submitError && <p className="text-sm text-red-700">{submitError}</p>}
            {submitSuccess && <p className="text-sm text-emerald-700">{submitSuccess}</p>}

            <label className="flex items-start gap-3 rounded-2xl border border-[#e4e2e3] bg-[#f7f5f6] p-4 text-sm text-[#44474c]">
              <input
                type="checkbox"
                checked={hasAcceptedConsent}
                onChange={(event) => setHasAcceptedConsent(event.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <span>
                I consent to my identity information being stored for {consentPolicy?.retentionDays ?? 7} days for identity verification and check-in verification purposes. This submission records a timestamp and technical audit data.
              </span>
            </label>

            <div className="rounded-2xl border border-[#e4e2e3] bg-[#fcfbfb] p-4 md:p-5">
              <p className="mb-3 text-sm text-[#59616b]">
                Guests must be confirmed in the popup before final submission. A single blank guest slot can stay visible so the page stays compact while you continue scanning.
              </p>
              <HoldToSubmitButton
                disabled={!canSubmit || isSubmitting}
                holdMs={2000}
                label={isSubmitting ? 'Submitting...' : 'Hold 2 seconds to send check-in'}
                onComplete={handleSubmit}
              />
            </div>
          </div>
        </section>
      </main>

      {editorDraft && editorGuestId && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#041627]/45 p-3 backdrop-blur-sm md:items-center md:p-6">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-[28px] border border-white/60 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#ece9ea] px-5 py-4 md:px-6">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-[#7f6a33]">Guest {Number(guestIndexById[editorGuestId] ?? 0) + 1}</p>
                <h2 className="mt-1 font-['Plus_Jakarta_Sans'] text-xl font-bold text-[#1b1c1d]">Confirm OCR details</h2>
                <p className="mt-1 text-sm text-[#59616b]">Review the extracted fields, fix anything needed, then confirm this guest and continue.</p>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#d7dade] text-[#32404d]"
                aria-label="Close review dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-5 overflow-y-auto p-5 md:grid-cols-[220px_minmax(0,1fr)] md:p-6">
              <div className="space-y-4">
                {photoPreviewByGuest[editorGuestId] ? (
                  <img
                    src={photoPreviewByGuest[editorGuestId]}
                    alt="Uploaded ID preview"
                    className="h-52 w-full rounded-3xl border border-[#ece9ea] object-cover"
                  />
                ) : (
                  <div className="flex h-52 items-center justify-center rounded-3xl border border-dashed border-[#cfd2d8] bg-[#f7f5f6] text-[#66707a]">
                    <FileBadge2 className="h-8 w-8" />
                  </div>
                )}

                <div className="rounded-2xl bg-[#f6f2e8] p-4 text-sm text-[#5f4a17]">
                  <p className="font-semibold">Quick review</p>
                  <p className="mt-1">Fields marked below were estimated by AI and should be checked manually.</p>
                </div>

                {Object.entries(editorDraft.estimated).some(([, value]) => value) && (
                  <div className="flex flex-wrap gap-2 text-xs text-[#6b7280]">
                    {Object.entries(editorDraft.estimated)
                      .filter(([, value]) => value)
                      .map(([key]) => (
                        <span key={key} className="rounded-full bg-[#f4f2f3] px-2.5 py-1">
                          {estimatedFieldLabels[key as keyof CheckInGuestEstimatedFlags] ?? key}
                        </span>
                      ))}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                {editorError && <p className="text-sm text-red-700">{editorError}</p>}

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="text-sm font-semibold text-[#1b1c1d]">
                    Full name
                    <input
                      value={editorDraft.fullName}
                      onChange={(event) => {
                        setEditorDraft((prev) => (prev ? { ...prev, fullName: event.target.value } : prev));
                        setEditorError(null);
                      }}
                      className="mt-1 w-full rounded-xl border border-[#cfd2d8] px-3 py-2"
                    />
                  </label>

                  <label className="text-sm font-semibold text-[#1b1c1d]">
                    Birth year
                    <input
                      value={editorDraft.birthYear ?? ''}
                      onChange={(event) => {
                        setEditorDraft((prev) => (prev ? { ...prev, birthYear: event.target.value ? Number(event.target.value) : null } : prev));
                        setEditorError(null);
                      }}
                      className="mt-1 w-full rounded-xl border border-[#cfd2d8] px-3 py-2"
                    />
                  </label>

                  <label className="text-sm font-semibold text-[#1b1c1d]">
                    Nationality
                    <input
                      value={editorDraft.nationality}
                      onChange={(event) => {
                        setEditorDraft((prev) => (prev ? { ...prev, nationality: event.target.value } : prev));
                        setEditorError(null);
                      }}
                      className="mt-1 w-full rounded-xl border border-[#cfd2d8] px-3 py-2"
                    />
                  </label>

                  <label className="text-sm font-semibold text-[#1b1c1d]">
                    Gender
                    <input
                      value={editorDraft.gender}
                      onChange={(event) => {
                        setEditorDraft((prev) => (prev ? { ...prev, gender: event.target.value } : prev));
                        setEditorError(null);
                      }}
                      className="mt-1 w-full rounded-xl border border-[#cfd2d8] px-3 py-2"
                    />
                  </label>

                  <label className="text-sm font-semibold text-[#1b1c1d] md:col-span-2">
                    Address
                    <input
                      value={editorDraft.address}
                      onChange={(event) => {
                        setEditorDraft((prev) => (prev ? { ...prev, address: event.target.value } : prev));
                        setEditorError(null);
                      }}
                      className="mt-1 w-full rounded-xl border border-[#cfd2d8] px-3 py-2"
                    />
                  </label>

                  <label className="text-sm font-semibold text-[#1b1c1d]">
                    Occupation
                    <input
                      value={editorDraft.occupation}
                      onChange={(event) => {
                        setEditorDraft((prev) => (prev ? { ...prev, occupation: event.target.value } : prev));
                        setEditorError(null);
                      }}
                      className="mt-1 w-full rounded-xl border border-[#cfd2d8] px-3 py-2"
                    />
                  </label>

                  <label className="text-sm font-semibold text-[#1b1c1d]">
                    Document number
                    <input
                      value={editorDraft.documentNumber}
                      onChange={(event) => {
                        setEditorDraft((prev) => (prev ? { ...prev, documentNumber: event.target.value } : prev));
                        setEditorError(null);
                      }}
                      className="mt-1 w-full rounded-xl border border-[#cfd2d8] px-3 py-2"
                    />
                  </label>

                  <label className="text-sm font-semibold text-[#1b1c1d] md:col-span-2">
                    Document type
                    <select
                      value={editorDraft.documentType}
                      onChange={(event) => {
                        setEditorDraft((prev) => (prev ? { ...prev, documentType: event.target.value as CheckInGuest['documentType'] } : prev));
                        setEditorError(null);
                      }}
                      className="mt-1 w-full rounded-xl border border-[#cfd2d8] px-3 py-2"
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
            </div>

            <div className="flex flex-col gap-3 border-t border-[#ece9ea] px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6">
              <button
                type="button"
                onClick={() => resetGuestCapture(editorGuestId)}
                className="inline-flex items-center justify-center rounded-full border border-[#f0d4d4] px-4 py-2 font-semibold text-[#a33c3c]"
              >
                Use another photo
              </button>

              <button
                type="button"
                onClick={confirmGuestDetails}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#041627] px-5 py-2.5 font-semibold text-white"
              >
                <Check className="h-4 w-4" /> Confirm this guest
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
