import React, { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { PropertyData, CheckInGuest } from '../types';
import { CheckInConsentPolicy, ocrGuestDocument, startCheckInSession, submitCheckIn } from '../services/checkin';
import { ApiError } from '../services/api';
import { HoldToSubmitButton } from '../components/HoldToSubmitButton';
import { TopNavBar } from '../components/TopNavBar';
import { MobileBottomNav } from '../components/MobileBottomNav';

interface CheckInPageProps {
  data: PropertyData;
  propertyId: string;
}

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

const CheckInPage: React.FC<CheckInPageProps> = ({ data, propertyId }) => {
  const [checkInDate, setCheckInDate] = useState<string>(toDateInput(0));
  const [checkOutDate, setCheckOutDate] = useState<string>(toDateInput(1));
  const [guests, setGuests] = useState<CheckInGuest[]>([createEmptyGuest('guest_1')]);
  const [photoPreviewByGuest, setPhotoPreviewByGuest] = useState<Record<string, string>>({});
  const [processingByGuest, setProcessingByGuest] = useState<Record<string, boolean>>({});
  const [errorByGuest, setErrorByGuest] = useState<Record<string, string>>({});
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

  const canSubmit = useMemo(() => {
    if (!checkInDate || !checkOutDate || checkInDate >= checkOutDate) {
      return false;
    }
    if (guests.length === 0) {
      return false;
    }
    if (!checkinToken) {
      return false;
    }
    if (!hasAcceptedConsent || !consentPolicy) {
      return false;
    }
    return guests.every((guest) => guest.evidenceUrl && guest.fullName);
  }, [checkInDate, checkOutDate, guests, checkinToken, hasAcceptedConsent, consentPolicy]);

  const updateGuest = (guestId: string, patch: Partial<CheckInGuest>) => {
    setGuests((prev) => prev.map((guest) => (guest.id === guestId ? { ...guest, ...patch } : guest)));
  };

  const addGuest = () => {
    const nextId = `guest_${Date.now()}`;
    setGuests((prev) => [...prev, createEmptyGuest(nextId)]);
  };

  const removeGuest = (guestId: string) => {
    if (guests.length <= 1) {
      return;
    }
    setGuests((prev) => prev.filter((guest) => guest.id !== guestId));
    setPhotoPreviewByGuest((prev) => {
      const next = { ...prev };
      delete next[guestId];
      return next;
    });
  };

  const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read image.'));
    reader.readAsDataURL(file);
  });

  const handleImageChange = async (guestId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setErrorByGuest((prev) => ({ ...prev, [guestId]: '' }));
    setProcessingByGuest((prev) => ({ ...prev, [guestId]: true }));

    try {
      const base64 = await fileToBase64(file);
      setPhotoPreviewByGuest((prev) => ({ ...prev, [guestId]: base64 }));

      const extracted = await ocrGuestDocument(propertyId, {
        imageBase64: base64,
        guestId,
        checkinToken,
      });

      updateGuest(guestId, extracted);
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
        guests,
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
      <main className="max-w-4xl mx-auto px-4 pt-[110px] pb-24 md:pb-10">
        <section className="bg-white border border-[#e4e2e3] rounded-2xl p-6 md:p-8 shadow-sm">
          <h1 className="font-['Plus_Jakarta_Sans'] text-2xl md:text-3xl font-bold mb-2">Property Check-in</h1>
          <p className="text-[#44474c] mb-6">{data.name}: complete guest identity verification before arrival.</p>

          {isInitializing && (
            <div className="mb-4 inline-flex items-center gap-2 text-sm text-[#44474c]">
              <Loader2 className="w-4 h-4 animate-spin" /> Initializing secure check-in session...
            </div>
          )}

          {sessionError && (
            <p className="mb-4 text-sm text-red-700">{sessionError}</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <label className="text-sm font-semibold text-[#1b1c1d]">
              Check-in Date
              <input
                type="date"
                value={checkInDate}
                onChange={(event) => setCheckInDate(event.target.value)}
                className="mt-1 w-full border border-[#c4c6cd] rounded-lg px-3 py-2"
              />
            </label>
            <label className="text-sm font-semibold text-[#1b1c1d]">
              Check-out Date
              <input
                type="date"
                value={checkOutDate}
                onChange={(event) => setCheckOutDate(event.target.value)}
                className="mt-1 w-full border border-[#c4c6cd] rounded-lg px-3 py-2"
              />
            </label>
          </div>

          <div className="space-y-6">
            {guests.map((guest, index) => (
              <article key={guest.id} className="border border-[#e4e2e3] rounded-xl p-4 md:p-5 bg-[#fdfcfc]">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-semibold text-lg">Guest {index + 1}</h2>
                  <button
                    type="button"
                    onClick={() => removeGuest(guest.id)}
                    className="text-[#ba1a1a] disabled:opacity-40"
                    disabled={guests.length <= 1}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#c4c6cd] bg-white cursor-pointer">
                  <Upload className="w-4 h-4" />
                  <span className="text-sm font-medium">Upload or capture ID</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(event) => void handleImageChange(guest.id, event)}
                    className="hidden"
                  />
                </label>

                {photoPreviewByGuest[guest.id] && (
                  <img src={photoPreviewByGuest[guest.id]} alt={`Guest ${index + 1} ID preview`} className="mt-3 w-36 h-24 object-cover rounded-lg border border-[#e4e2e3]" />
                )}

                {processingByGuest[guest.id] && (
                  <div className="mt-3 text-sm text-[#44474c] inline-flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> AI is validating and extracting data...
                  </div>
                )}

                {errorByGuest[guest.id] && (
                  <p className="mt-3 text-sm text-red-700">{errorByGuest[guest.id]}</p>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                  <input value={guest.fullName} onChange={(event) => updateGuest(guest.id, { fullName: event.target.value })} placeholder="Full name" className="border border-[#c4c6cd] rounded-lg px-3 py-2" />
                  <input value={guest.birthYear ?? ''} onChange={(event) => updateGuest(guest.id, { birthYear: event.target.value ? Number(event.target.value) : null })} placeholder="Birth year" className="border border-[#c4c6cd] rounded-lg px-3 py-2" />
                  <input value={guest.nationality} onChange={(event) => updateGuest(guest.id, { nationality: event.target.value })} placeholder="Nationality" className="border border-[#c4c6cd] rounded-lg px-3 py-2" />
                  <input value={guest.address} onChange={(event) => updateGuest(guest.id, { address: event.target.value })} placeholder="Address" className="border border-[#c4c6cd] rounded-lg px-3 py-2" />
                  <input value={guest.gender} onChange={(event) => updateGuest(guest.id, { gender: event.target.value })} placeholder="Gender" className="border border-[#c4c6cd] rounded-lg px-3 py-2" />
                  <input value={guest.occupation} onChange={(event) => updateGuest(guest.id, { occupation: event.target.value })} placeholder="Occupation" className="border border-[#c4c6cd] rounded-lg px-3 py-2" />
                  <input value={guest.documentType} onChange={(event) => updateGuest(guest.id, { documentType: event.target.value as CheckInGuest['documentType'] })} placeholder="Document type" className="border border-[#c4c6cd] rounded-lg px-3 py-2" />
                  <input value={guest.documentNumber} onChange={(event) => updateGuest(guest.id, { documentNumber: event.target.value })} placeholder="Document number" className="border border-[#c4c6cd] rounded-lg px-3 py-2" />
                </div>
              </article>
            ))}
          </div>

          <button type="button" onClick={addGuest} className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#041627] text-[#041627] font-semibold">
            <Plus className="w-4 h-4" /> Add another guest
          </button>

          {submitError && <p className="mt-4 text-sm text-red-700">{submitError}</p>}
          {submitSuccess && <p className="mt-4 text-sm text-emerald-700">{submitSuccess}</p>}

          <label className="mt-5 flex items-start gap-3 rounded-xl border border-[#e4e2e3] bg-[#f7f5f6] p-4 text-sm text-[#44474c]">
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

          <div className="mt-6">
            <HoldToSubmitButton
              disabled={!canSubmit || isSubmitting}
              label={isSubmitting ? 'Submitting...' : 'Hold 5 seconds to send check-in'}
              onComplete={handleSubmit}
            />
          </div>
        </section>
      </main>
      <MobileBottomNav />
    </div>
  );
};

export default CheckInPage;
