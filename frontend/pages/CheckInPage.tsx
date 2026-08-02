import React, { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronUp, EyeOff, FileBadge2, Globe, Lock, Loader2, Menu, PencilLine, Plus, ShieldCheck, Upload, X } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PropertyData, CheckInGuest } from '../types';
import { CheckInConsentPolicy, matchCheckInBooking, ocrGuestDocument, startCheckInSession, submitCheckIn } from '../services/checkin';
import { ApiError, ApiUser } from '../services/api';
import { getCurrentUser, subscribeToAuth } from '../services/auth';
import { TopNavBar } from '../components/TopNavBar';
import { useLanguage } from '../contexts/LanguageContext';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { getSiteSettings } from '../services/storage';
import { getCapitalWithCountry } from '../utils/countryCapitals';
import { TranslationKey } from '../utils/translations';
import { clearCheckInPhotos, deleteCheckInPhoto, getCheckInPhoto, saveCheckInPhoto } from '../utils/checkinPhotoStore';

interface CheckInPageProps {
  data: PropertyData;
  propertyId: string;
}

const DOCUMENT_TYPE_LABEL_KEYS: Record<CheckInGuest['documentType'], TranslationKey> = {
  passport: 'checkin_doc_passport',
  driver_license: 'checkin_doc_driver_license',
  residence_card: 'checkin_doc_residence_card',
  national_id: 'checkin_doc_national_id',
  unknown: 'checkin_doc_unknown',
};

const CHECKIN_IMG_ERR = {
  DECODE_IMAGE: 'decode_image',
  INVALID_FILE: 'invalid_file',
  READ_IMAGE: 'read_image',
  DECODE_PHOTO: 'decode_photo',
  PROCESS_IMAGE: 'process_image',
  TOO_LARGE_COMPRESSED: 'too_large_compressed',
} as const;

const CHECKIN_IMG_ERR_KEYS: Record<string, TranslationKey> = {
  [CHECKIN_IMG_ERR.DECODE_IMAGE]: 'checkin_err_decode_image',
  [CHECKIN_IMG_ERR.INVALID_FILE]: 'checkin_err_invalid_image',
  [CHECKIN_IMG_ERR.READ_IMAGE]: 'checkin_err_read_image',
  [CHECKIN_IMG_ERR.DECODE_PHOTO]: 'checkin_err_decode_photo',
  [CHECKIN_IMG_ERR.PROCESS_IMAGE]: 'checkin_err_process_image',
  [CHECKIN_IMG_ERR.TOO_LARGE_COMPRESSED]: 'checkin_err_too_large_compressed',
};

const createGuestId = (): string => `guest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const MAX_CHECKIN_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_CHECKIN_UPLOAD_DIMENSION = 2200;
const SUPPORTED_CHECKIN_IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

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
  contactInfo: '',
  previousLocation: '',
  nextLocation: '',
});

const RequiredLabel: React.FC<{ text: string; required?: boolean }> = ({ text, required = false }) => (
  <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">
    {text}
    {required ? <span className="ml-1 text-red-500">*</span> : null}
  </p>
);

const isFilledString = (value?: string | null): boolean => Boolean(value && value.trim());
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type GuestValidationField =
  | 'fullName'
  | 'birthYear'
  | 'gender'
  | 'nationality'
  | 'address'
  | 'contactInfo'
  | 'previousLocation'
  | 'nextLocation'
  | 'documentNumber'
  | 'documentType'
  | 'evidenceUrl';

const REQUIRED_GUEST_FIELDS: Array<{ key: GuestValidationField; labelKey: TranslationKey }> = [
  { key: 'fullName', labelKey: 'checkin_popup_fullname' },
  { key: 'birthYear', labelKey: 'checkin_popup_birthyear' },
  { key: 'gender', labelKey: 'checkin_popup_gender' },
  { key: 'nationality', labelKey: 'checkin_popup_nationality' },
  { key: 'address', labelKey: 'checkin_popup_address' },
  { key: 'contactInfo', labelKey: 'checkin_popup_contact' },
  { key: 'previousLocation', labelKey: 'checkin_popup_prev_location' },
  { key: 'nextLocation', labelKey: 'checkin_popup_next_location' },
  { key: 'documentNumber', labelKey: 'checkin_popup_docnum' },
  { key: 'documentType', labelKey: 'checkin_popup_doctype' },
  { key: 'evidenceUrl', labelKey: 'checkin_field_id_image' },
];

// requireEmail is true only for the lead guest: that field is always where
// the check-in welcome email gets sent (on top of the booking's own email,
// when there is one), so it has to actually be an email — a phone number
// alone can't receive that mail.
//
// isResident (a guest living in Japan, as opposed to a foreign visitor) drops
// every field the Hotel Business Act (旅館業法) does not require for them —
// only full name, address, and (for the lead guest) email stay mandatory.
const validateGuestFields = (
  guest: CheckInGuest,
  requireEmail = false,
  isResident = false,
): Record<GuestValidationField, boolean> => ({
  fullName: !isFilledString(guest.fullName),
  birthYear: isResident ? false : guest.birthYear == null,
  gender: isResident ? false : !isFilledString(guest.gender),
  nationality: isResident ? false : !isFilledString(guest.nationality),
  address: !isFilledString(guest.address),
  contactInfo: requireEmail ? !EMAIL_REGEX.test((guest.contactInfo ?? '').trim()) : isResident ? false : !isFilledString(guest.contactInfo),
  previousLocation: isResident ? false : !isFilledString(guest.previousLocation),
  nextLocation: isResident ? false : !isFilledString(guest.nextLocation),
  documentNumber: isResident ? false : !isFilledString(guest.documentNumber),
  documentType: isResident ? false : !guest.documentType || guest.documentType === 'unknown',
  evidenceUrl: isResident ? false : !isFilledString(guest.evidenceUrl),
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

type ResidencyStatus = 'unset' | 'resident' | 'foreign';

interface CheckInDraft {
  savedAt: number;
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string;
  checkOutTime: string;
  guests: CheckInGuest[];
  reviewedGuestIds: string[];
  sameAsLeadByGuest: Record<string, boolean>;
  residency?: ResidencyStatus;
}

const CHECKIN_DRAFT_TTL_MS = 6 * 60 * 60 * 1000;
const getCheckInDraftStorageKey = (propertyId: string): string => `checkin_draft_${propertyId}`;
const draftHasContent = (draft: Pick<CheckInDraft, 'guests'>): boolean => draft.guests.some((guest) => !isGuestEmpty(guest));

const readCheckInDraft = (propertyId: string): CheckInDraft | null => {
  try {
    const raw = localStorage.getItem(getCheckInDraftStorageKey(propertyId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CheckInDraft;
    if (!parsed || typeof parsed.savedAt !== 'number' || !Array.isArray(parsed.guests)) {
      return null;
    }
    if (Date.now() - parsed.savedAt > CHECKIN_DRAFT_TTL_MS || !draftHasContent(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const writeCheckInDraft = (propertyId: string, draft: CheckInDraft): void => {
  try {
    localStorage.setItem(getCheckInDraftStorageKey(propertyId), JSON.stringify(draft));
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
};

const clearCheckInDraft = (propertyId: string): void => {
  try {
    localStorage.removeItem(getCheckInDraftStorageKey(propertyId));
  } catch {
    // Ignore storage failures.
  }
};

const estimateDataUrlBytes = (dataUrl: string): number => {
  const base64 = dataUrl.split(',')[1] ?? '';
  if (!base64) {
    return 0;
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
};

const loadImageElement = (file: File): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error(CHECKIN_IMG_ERR.DECODE_IMAGE));
  };
  image.src = url;
});

const prepareCheckInImage = async (file: File): Promise<string> => {
  if (!file.type.startsWith('image/')) {
    throw new Error(CHECKIN_IMG_ERR.INVALID_FILE);
  }

  const toDataUrl = (): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(CHECKIN_IMG_ERR.READ_IMAGE));
    reader.readAsDataURL(file);
  });

  const originalDataUrl = await toDataUrl();

  let image: HTMLImageElement;
  try {
    image = await loadImageElement(file);
  } catch {
    if (SUPPORTED_CHECKIN_IMAGE_TYPES.has(file.type.toLowerCase()) && estimateDataUrlBytes(originalDataUrl) <= MAX_CHECKIN_UPLOAD_BYTES) {
      return originalDataUrl;
    }
    throw new Error(CHECKIN_IMG_ERR.DECODE_PHOTO);
  }

  const baseScale = Math.min(1, MAX_CHECKIN_UPLOAD_DIMENSION / Math.max(image.width, image.height));
  const qualityCandidates = [0.88, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4];

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const scale = baseScale * Math.pow(0.85, attempt);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error(CHECKIN_IMG_ERR.PROCESS_IMAGE);
    }
    context.drawImage(image, 0, 0, width, height);

    for (const quality of qualityCandidates) {
      const compressed = canvas.toDataURL('image/jpeg', quality);
      if (estimateDataUrlBytes(compressed) <= MAX_CHECKIN_UPLOAD_BYTES) {
        return compressed;
      }
    }
  }

  throw new Error(CHECKIN_IMG_ERR.TOO_LARGE_COMPRESSED);
};

type BookingGateState = 'none' | 'checking' | 'matched' | 'mismatch';

const CheckInPage: React.FC<CheckInPageProps> = ({ data, propertyId }) => {
  const { t, language } = useLanguage();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // A link with no `bk` at all (the generic per-property link a host copies
  // from the Check-in link picker) skips this gate entirely — 'none' renders
  // the form exactly as before. A link carrying `bk` (from a booking
  // confirmation email) must match a real booking_confirmations row first.
  const urlBk = searchParams.get('bk') ?? '';
  const [gateState, setGateState] = useState<BookingGateState>(urlBk ? 'checking' : 'none');
  const [matchedBk, setMatchedBk] = useState(urlBk);
  const [manualBk, setManualBk] = useState('');
  const [gateError, setGateError] = useState<string | null>(null);
  const [gateSubmitting, setGateSubmitting] = useState(false);
  const [checkInDate, setCheckInDate] = useState<string>(toDateInput(0));
  const [checkOutDate, setCheckOutDate] = useState<string>(toDateInput(1));
  const [checkInTime, setCheckInTime] = useState<string>('15:00');
  const [checkOutTime, setCheckOutTime] = useState<string>('10:00');
  const [guests, setGuests] = useState<CheckInGuest[]>([createEmptyGuest('guest_1')]);
  const [photoPreviewByGuest, setPhotoPreviewByGuest] = useState<Record<string, string>>({});
  const [processingByGuest, setProcessingByGuest] = useState<Record<string, boolean>>({});
  const [errorByGuest, setErrorByGuest] = useState<Record<string, string>>({});
  const [reviewedGuestIds, setReviewedGuestIds] = useState<string[]>([]);
  const [editorGuestId, setEditorGuestId] = useState<string | null>(null);
  const [editorDraft, setEditorDraft] = useState<CheckInGuest | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorFieldErrors, setEditorFieldErrors] = useState<Partial<Record<GuestValidationField, boolean>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [submitEmailsSent, setSubmitEmailsSent] = useState<string[]>([]);
  const [checkinToken, setCheckinToken] = useState<string>('');
  const [consentPolicy, setConsentPolicy] = useState<CheckInConsentPolicy | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [authUser, setAuthUser] = useState<ApiUser | null>(() => getCurrentUser());
  const [siteNavTitle, setSiteNavTitle] = useState<string>('');
  const [isSettingsLoading, setIsSettingsLoading] = useState(true);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [sameAsLeadByGuest, setSameAsLeadByGuest] = useState<Record<string, boolean>>({});
  const [pendingDraft, setPendingDraft] = useState<CheckInDraft | null>(null);
  const [draftCheckDone, setDraftCheckDone] = useState(false);
  // Asked once per session, before the guest list: living in Japan drops the
  // ID-photo step and most fields (see validateGuestFields) since the Hotel
  // Business Act only requires those for guests without a Japan address.
  const [residency, setResidency] = useState<ResidencyStatus>('unset');
  const isResident = residency === 'resident';

  useEffect(() => {
    if (!urlBk) {
      return;
    }
    let cancelled = false;
    setGateState('checking');
    matchCheckInBooking(propertyId, urlBk)
      .then((ok) => {
        if (cancelled) return;
        if (ok) {
          setMatchedBk(urlBk);
          setGateState('matched');
        } else {
          setGateState('mismatch');
        }
      })
      .catch(() => {
        if (!cancelled) setGateState('mismatch');
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId, urlBk]);

  const handleGateConfirm = async () => {
    const candidate = manualBk.trim();
    if (!candidate) {
      setGateError(t('checkin_gate_enter_id'));
      return;
    }
    setGateSubmitting(true);
    setGateError(null);
    try {
      const ok = await matchCheckInBooking(propertyId, candidate);
      if (ok) {
        setMatchedBk(candidate);
        setGateState('matched');
      } else {
        setGateError(t('checkin_gate_mismatch'));
      }
    } catch {
      setGateError(t('checkin_gate_mismatch'));
    } finally {
      setGateSubmitting(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      setIsSettingsLoading(true);
      setSettingsLoadError(null);
      try {
        const settings = await getSiteSettings();
        if (!cancelled) {
          setSiteNavTitle(settings.navTitle || '');
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load site settings for check-in page', error);
          setSettingsLoadError(t('common_err_settings_load'));
        }
      } finally {
        if (!cancelled) {
          setIsSettingsLoading(false);
        }
      }
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

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
          const message = error instanceof Error ? error.message : t('checkin_err_session_init');
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

  // Check once for an unfinished draft saved earlier for this property.
  useEffect(() => {
    setPendingDraft(readCheckInDraft(propertyId));
    setDraftCheckDone(true);
  }, [propertyId]);

  // Autosave the in-progress form (excluding photo previews) so a reload doesn't lose guest data.
  useEffect(() => {
    if (!draftCheckDone || pendingDraft) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      // Strip inline image data URIs before persisting — they are large and would blow
      // the localStorage quota. Text fields persist; images must be re-scanned on reload.
      // Residents never have an image to begin with, so nothing needs re-review for them.
      const guestsWithoutImages = guests.map((guest) =>
        guest.evidenceUrl.startsWith('data:') ? { ...guest, evidenceUrl: '' } : guest,
      );
      // The photo itself is persisted separately in IndexedDB (see
      // handleImageChange) and reattached on restore, so reviewedGuestIds is
      // saved as-is here — restoreDraft is what decides whether a guest is
      // still complete, based on whether that reattach actually succeeds.
      const draft: CheckInDraft = {
        savedAt: Date.now(),
        checkInDate,
        checkOutDate,
        checkInTime,
        checkOutTime,
        guests: guestsWithoutImages,
        reviewedGuestIds,
        sameAsLeadByGuest,
        residency,
      };
      if (draftHasContent(draft)) {
        writeCheckInDraft(propertyId, draft);
      } else {
        clearCheckInDraft(propertyId);
      }
    }, 400);
    return () => window.clearTimeout(timeoutId);
  }, [draftCheckDone, pendingDraft, propertyId, checkInDate, checkOutDate, checkInTime, checkOutTime, guests, reviewedGuestIds, sameAsLeadByGuest, residency]);

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
    return guestsForSubmission.filter((guest) => reviewedGuestIds.includes(guest.id) && (isResident || guest.evidenceUrl) && guest.fullName.trim()).length;
  }, [guestsForSubmission, reviewedGuestIds, isResident]);

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
    return guestsForSubmission.every((guest) => (isResident || guest.evidenceUrl) && guest.fullName.trim() && reviewedGuestIds.includes(guest.id));
  }, [checkInDate, checkOutDate, checkinToken, consentPolicy, guestsForSubmission, processingGuestCount, editorDraft, reviewedGuestIds, isResident]);

  const pendingReviewCount = Math.max(0, guestsForSubmission.length - confirmedGuestCount);
  const datesReady = Boolean(checkInDate && checkOutDate && checkInDate < checkOutDate);
  const progressPercent = canSubmit
    ? 100
    : guestsForSubmission.length > 0
      ? Math.max(24, Math.round((confirmedGuestCount / guestsForSubmission.length) * 100))
      : datesReady
        ? 12
        : 0;
  const currentStepDescription = processingGuestCount > 0
    ? t('checkin_step_scan_desc')
    : pendingReviewCount > 0
      ? t('checkin_step_review_desc')
      : confirmedGuestCount > 0
        ? t('checkin_step_ready_desc')
        : t('checkin_step_start_desc');

  const restoreDraft = async () => {
    if (!pendingDraft) return;
    const draft = pendingDraft;
    setCheckInDate(draft.checkInDate);
    setCheckOutDate(draft.checkOutDate);
    setCheckInTime(draft.checkInTime);
    setCheckOutTime(draft.checkOutTime);
    setSameAsLeadByGuest(draft.sameAsLeadByGuest ?? {});
    setResidency(draft.residency ?? 'unset');

    // Photos are stripped before the rest of the draft is written to
    // localStorage (too large for its quota) but kept separately in
    // IndexedDB — reattach them here so a guest who was already reviewed
    // stays reviewed, instead of being stuck with no way to re-attach one.
    const restoredGuests = await Promise.all(
      draft.guests.map(async (guest) => {
        if (guest.evidenceUrl) {
          return guest;
        }
        const photo = await getCheckInPhoto(propertyId, guest.id);
        if (!photo) {
          return guest;
        }
        setPhotoPreviewByGuest((prev) => ({ ...prev, [guest.id]: photo }));
        return { ...guest, evidenceUrl: photo, evidenceMimeType: guest.evidenceMimeType || 'image/jpeg' };
      }),
    );
    const finalGuests = restoredGuests.length > 0 ? restoredGuests : [createEmptyGuest('guest_1')];
    setGuests(finalGuests);
    setReviewedGuestIds(
      draft.reviewedGuestIds.filter((id) => {
        const guest = finalGuests.find((candidate) => candidate.id === id);
        if (!guest || !guest.fullName.trim()) return false;
        return draft.residency === 'resident' || Boolean(guest.evidenceUrl);
      }),
    );
    setPendingDraft(null);
  };

  const discardDraft = () => {
    void clearCheckInPhotos(propertyId, (pendingDraft?.guests ?? []).map((guest) => guest.id));
    clearCheckInDraft(propertyId);
    setPendingDraft(null);
  };

  const replaceGuest = (guestId: string, nextGuest: CheckInGuest) => {
    setGuests((prev) => prev.map((guest) => (guest.id === guestId ? nextGuest : guest)));
  };

  const updateGuest = (guestId: string, patch: Partial<CheckInGuest>) => {
    setGuests((prev) => prev.map((guest) => (guest.id === guestId ? { ...guest, ...patch } : guest)));
  };

  const ensureDraftGuest = () => {
    const newId = createGuestId();
    setSameAsLeadByGuest((flags) => ({ ...flags, [newId]: true }));
    setGuests((prev) => (prev.some((guest) => isGuestEmpty(guest)) ? prev : [...prev, createEmptyGuest(newId)]));
  };

  const addGuest = () => {
    if (guests.some((guest) => isGuestEmpty(guest))) {
      return;
    }
    const newId = createGuestId();
    setSameAsLeadByGuest((flags) => ({ ...flags, [newId]: true }));
    setGuests((prev) => [...prev, createEmptyGuest(newId)]);
  };

  const closeEditor = () => {
    setEditorGuestId(null);
    setEditorDraft(null);
    setEditorError(null);
    setEditorFieldErrors({});
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
    void deleteCheckInPhoto(propertyId, guestId);
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
    void deleteCheckInPhoto(propertyId, guestId);
    clearGuestFeedback(guestId);
    if (editorGuestId === guestId) {
      closeEditor();
    }
  };

  const openEditor = (guestId: string) => {
    if (editorGuestId === guestId) {
      closeEditor();
      return;
    }
    const guest = guests.find((candidate) => candidate.id === guestId);
    if (!guest) {
      return;
    }
    const index = guestIndexById[guestId] ?? -1;
    const lead = guests[0];
    const sameAsLead = sameAsLeadByGuest[guestId] ?? index > 0;
    const draft: CheckInGuest = (index > 0 && sameAsLead && lead)
      ? {
          ...guest,
          contactInfo: lead.contactInfo ?? guest.contactInfo,
          previousLocation: lead.previousLocation ?? guest.previousLocation,
          nextLocation: lead.nextLocation ?? guest.nextLocation,
        }
      : { ...guest };
    setEditorGuestId(guestId);
    setEditorDraft(draft);
    if (index > 0 && sameAsLeadByGuest[guestId] === undefined) {
      setSameAsLeadByGuest((flags) => ({ ...flags, [guestId]: true }));
    }
    setEditorError(null);
    setEditorFieldErrors({});
  };

  const toggleSameAsLead = (guestId: string) => {
    setSameAsLeadByGuest((prev) => {
      const next = !prev[guestId];
      if (next) {
        const lead = guests[0];
        if (lead) {
          setEditorDraft((draft) => (draft && draft.id === guestId
            ? { ...draft, contactInfo: lead.contactInfo ?? '', previousLocation: lead.previousLocation ?? '', nextLocation: lead.nextLocation ?? '' }
            : draft));
        }
      }
      return { ...prev, [guestId]: next };
    });
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
      const base64 = await prepareCheckInImage(file);
      setPhotoPreviewByGuest((prev) => ({ ...prev, [guestId]: base64 }));
      // Best-effort: also keep a copy in IndexedDB so a reload can restore it
      // (the localStorage draft itself only ever holds the text fields).
      void saveCheckInPhoto(propertyId, guestId, base64);

      const extracted = await ocrGuestDocument(propertyId, {
        imageBase64: base64,
        guestId,
        checkinToken,
      });

      // Address must NEVER be empty. Prefer the AI value; if it is blank/NA/UNKNOWN,
      // fall back to "Capital, Country" from nationality; as a last resort use UNKNOWN.
      const capitalWithCountry = getCapitalWithCountry(extracted.nationality);
      const rawAddress = (extracted.address || '').trim();
      const isBlankAddress = !rawAddress || rawAddress === 'NA' || rawAddress.toUpperCase() === 'UNKNOWN';
      const addressValue = (isBlankAddress ? capitalWithCountry : rawAddress) || capitalWithCountry || rawAddress || 'UNKNOWN';
      // Deferred upload: keep the captured image locally as a data URI. It is sent on
      // submit, where the backend compresses (<100KB) and uploads it to the bucket.
      // Previous-stay / next-destination default to the guest's address.
      const enrichedGuest: CheckInGuest = {
        ...extracted,
        evidenceUrl: base64,
        evidenceMimeType: 'image/jpeg',
        address: addressValue,
        previousLocation: addressValue,
        nextLocation: addressValue,
      };

      const index = guestIndexById[guestId] ?? -1;
      const lead = guests[0];
      const sameAsLead = sameAsLeadByGuest[guestId] ?? index > 0;
      const finalGuest: CheckInGuest = (index > 0 && sameAsLead && lead)
        ? {
            ...enrichedGuest,
            contactInfo: lead.contactInfo ?? enrichedGuest.contactInfo,
            previousLocation: lead.previousLocation ?? enrichedGuest.previousLocation,
            nextLocation: lead.nextLocation ?? enrichedGuest.nextLocation,
          }
        : enrichedGuest;

      updateGuest(guestId, finalGuest);
      setEditorGuestId(guestId);
      setEditorDraft({ ...finalGuest });
      if (index > 0 && sameAsLeadByGuest[guestId] === undefined) {
        setSameAsLeadByGuest((flags) => ({ ...flags, [guestId]: true }));
      }
      setEditorError(null);
    } catch (error) {
      const backendMessage = error instanceof ApiError ? error.message : '';
      const message = backendMessage.toLowerCase().includes('too large')
        ? t('checkin_err_photo_too_large')
        : error instanceof ApiError
        ? error.message
        : error instanceof Error && CHECKIN_IMG_ERR_KEYS[error.message]
          ? t(CHECKIN_IMG_ERR_KEYS[error.message])
          : t('checkin_err_process_generic');
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
      contactInfo: (editorDraft.contactInfo ?? '').trim(),
      previousLocation: (editorDraft.previousLocation ?? '').trim(),
      nextLocation: (editorDraft.nextLocation ?? '').trim(),
    };

    const isLeadGuest = guests[0]?.id === editorGuestId;
    const requireEmailForContact = isLeadGuest;
    const fieldErrors = validateGuestFields(normalizedGuest, requireEmailForContact, isResident);
    setEditorFieldErrors(fieldErrors);

    if (requireEmailForContact && fieldErrors.contactInfo && normalizedGuest.contactInfo) {
      // Distinguish "typed something, but it's not an email" from "left it
      // blank" — the generic missing-fields message below covers the latter.
      setEditorError(t('checkin_contact_email_invalid'));
      return;
    }

    const missingFields = REQUIRED_GUEST_FIELDS
      .filter(({ key }) => fieldErrors[key])
      .map(({ labelKey }) => t(labelKey));

    if (missingFields.length > 0) {
      setEditorError(`${t('checkin_missing_fields_prefix')} ${missingFields.join(', ')}.`);
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
      const { submission, emailsSent } = await submitCheckIn(propertyId, {
        checkinToken,
        checkInDate,
        checkOutDate,
        checkInTime,
        checkOutTime,
        guests: guestsForSubmission,
        consent: {
          accepted: true,
          acceptedAt: Date.now(),
          noticeVersion: consentPolicy?.noticeVersion ?? 'v1',
        },
        locale: language,
        residency,
        ...(gateState === 'matched' ? { bk: matchedBk } : {}),
      });
      setSubmitSuccess(submission.id);
      setSubmitEmailsSent(emailsSent);
      setShowSubmitConfirm(false);
      clearCheckInDraft(propertyId);
      void clearCheckInPhotos(propertyId, guests.map((guest) => guest.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit check-in.';
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSettingsLoading) {
    return (
      <div className="min-h-screen bg-[#e8e5e6] flex flex-col items-center justify-center gap-3 text-[#041627]">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm font-medium tracking-[0.04em] uppercase">Loading...</p>
      </div>
    );
  }

  if (settingsLoadError) {
    return (
      <div className="min-h-screen bg-[#e8e5e6] flex items-center justify-center px-6 text-center text-[#ba1a1a]">
        {settingsLoadError}
      </div>
    );
  }

  // Only a link carrying `bk` reaches these two states; the generic
  // per-property link (no `bk`) goes straight to the form below, unchanged.
  if (gateState === 'checking') {
    return (
      <div className="min-h-screen bg-[#e8e5e6] flex flex-col items-center justify-center gap-3 text-[#041627]">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm font-medium tracking-[0.04em] uppercase">{t('checkin_gate_checking')}</p>
      </div>
    );
  }

  if (gateState === 'mismatch') {
    return (
      <div className="min-h-screen bg-[#e8e5e6] flex items-center justify-center px-6">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
          </div>
          <h1 className="text-center text-lg font-bold text-gray-900">{t('checkin_gate_mismatch_title')}</h1>
          <p className="mt-2 text-center text-sm text-gray-500">{t('checkin_gate_mismatch_body')}</p>
          <div className="mt-5">
            <input
              type="text"
              value={manualBk}
              onChange={(e) => { setManualBk(e.target.value); setGateError(null); }}
              placeholder={t('checkin_gate_id_placeholder')}
              disabled={gateSubmitting}
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-center text-sm font-semibold tracking-wide text-gray-900 focus:outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
            />
            {gateError && <p className="mt-2 text-center text-xs text-red-600">{gateError}</p>}
            <button
              type="button"
              onClick={() => void handleGateConfirm()}
              disabled={gateSubmitting}
              className="mt-3 w-full rounded-xl bg-gray-900 py-3 text-sm font-bold text-white hover:bg-gray-800 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {gateSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('checkin_gate_confirm')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Asked once, before the guest list itself — the answer decides how much of
  // that list residents even see (see validateGuestFields/isResident above).
  if (residency === 'unset') {
    return (
      <div className="min-h-screen bg-[#e8e5e6] flex items-center justify-center px-6">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
            <Globe className="h-6 w-6 text-blue-600" />
          </div>
          <h1 className="text-lg font-bold text-gray-900">{t('checkin_residency_title')}</h1>
          <p className="mt-2 text-sm text-gray-500">{t('checkin_residency_body')}</p>
          <div className="mt-5 space-y-2.5">
            <button
              type="button"
              onClick={() => setResidency('resident')}
              className="w-full rounded-xl bg-gray-900 py-3 text-sm font-bold text-white hover:bg-gray-800"
            >
              {t('checkin_residency_resident')}
            </button>
            <button
              type="button"
              onClick={() => setResidency('foreign')}
              className="w-full rounded-xl border border-gray-300 py-3 text-sm font-bold text-gray-900 hover:bg-gray-50"
            >
              {t('checkin_residency_foreign')}
            </button>
          </div>
        </div>
      </div>
    );
  }

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
              aria-label={t('checkin_menu_aria')}
              aria-expanded={menuOpen}
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="border-t border-gray-100 bg-white px-2 py-1">
            <Link to="/" onClick={() => setMenuOpen(false)} className="block rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">{t('nav_home')}</Link>
            <Link to="/blog" onClick={() => setMenuOpen(false)} className="block rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">{t('common_blog')}</Link>
            {authUser ? (
              <>
                {(authUser.role === 'ADMIN' || authUser.role === 'HOST') && (
                  <Link to="/admin/checkin-management" onClick={() => setMenuOpen(false)} className="block rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">{t('common_admin_checkin_mgmt')}</Link>
                )}
                {(authUser.role === 'ADMIN' || authUser.role === 'HOST') && (
                  <Link to="/admin/properties" onClick={() => setMenuOpen(false)} className="block rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">{t('common_admin_property')}</Link>
                )}
              </>
            ) : (
              <Link to="/login" onClick={() => setMenuOpen(false)} className="block rounded-xl px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">{t('common_login')}</Link>
            )}
          </div>
        )}
      </header>

      {/* Desktop navbar */}
      <div className="hidden md:block">
        <TopNavBar navTitleOverride={siteNavTitle} />
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

        {pendingDraft && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
            <p className="text-xs text-blue-800">{t('checkin_draft_found')}</p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={discardDraft}
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
              >
                {t('checkin_draft_discard')}
              </button>
              <button
                type="button"
                onClick={() => void restoreDraft()}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                {t('checkin_draft_restore')}
              </button>
            </div>
          </div>
        )}

        {/* Dates + Times */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <RequiredLabel text={t('checkin_date_in')} required />
            <input
              type="date"
              value={checkInDate}
              onChange={(event) => setCheckInDate(event.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-900"
            />
          </div>
          <div>
            <RequiredLabel text={t('checkin_date_out')} required />
            <input
              type="date"
              value={checkOutDate}
              onChange={(event) => setCheckOutDate(event.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-900"
            />
          </div>
          <div>
            <RequiredLabel text={t('checkin_time_in')} required />
            <input
              type="time"
              value={checkInTime}
              onChange={(event) => setCheckInTime(event.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-900"
            />
          </div>
          <div>
            <RequiredLabel text={t('checkin_time_out')} required />
            <input
              type="time"
              value={checkOutTime}
              onChange={(event) => setCheckOutTime(event.target.value)}
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
            const isConfirmed = reviewedGuestIds.includes(guest.id) && (isResident || Boolean(guest.evidenceUrl)) && Boolean(guest.fullName.trim());
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
                      {isEmpty ? `${t('checkin_guest_label')} ${index + 1}` : guest.fullName || `${t('checkin_guest_label')} ${index + 1}`}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {isProcessing
                        ? t('checkin_scanning')
                        : isConfirmed
                          ? t('checkin_confirmed')
                          : needsReview
                            ? t('checkin_needs_review')
                            : isResident
                              ? t('checkin_enter_info_prompt')
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
                      aria-label={t('checkin_edit_aria')}
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <PencilLine className="h-4 w-4" />}
                    </button>
                  ) : isResident ? (
                    <button
                      type="button"
                      onClick={() => openEditor(guest.id)}
                      className="shrink-0 rounded-xl bg-gray-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-gray-700"
                    >
                      {t('checkin_enter_info_btn')}
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
                      aria-label={t('checkin_remove_guest_aria')}
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
                        <RequiredLabel text={t('checkin_popup_fullname')} required />
                        <input
                          value={editorDraft.fullName}
                          onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, fullName: event.target.value } : prev)); setEditorError(null); }}
                          className={`w-full rounded-lg border px-2.5 py-1.5 text-sm text-gray-900 ${editorFieldErrors.fullName ? 'border-red-500 bg-red-50' : 'border-gray-200'}`}
                        />
                      </div>
                      {!isResident && (
                        <div>
                          <RequiredLabel text={t('checkin_popup_birthyear')} required />
                          <input
                            type="number"
                            value={editorDraft.birthYear ?? ''}
                            onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, birthYear: event.target.value ? Number(event.target.value) : null } : prev)); setEditorError(null); }}
                            className={`w-full rounded-lg border px-2.5 py-1.5 text-sm text-gray-900 ${editorFieldErrors.birthYear ? 'border-red-500 bg-red-50' : 'border-gray-200'}`}
                          />
                        </div>
                      )}
                      {!isResident && (
                        <div>
                          <RequiredLabel text={t('checkin_popup_gender')} required />
                          <input
                            value={editorDraft.gender}
                            onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, gender: event.target.value } : prev)); setEditorError(null); }}
                            className={`w-full rounded-lg border px-2.5 py-1.5 text-sm text-gray-900 ${editorFieldErrors.gender ? 'border-red-500 bg-red-50' : 'border-gray-200'}`}
                          />
                        </div>
                      )}
                      {!isResident && (
                        <div>
                          <RequiredLabel text={t('checkin_popup_nationality')} required />
                          <input
                            value={editorDraft.nationality}
                            onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, nationality: event.target.value } : prev)); setEditorError(null); }}
                            className={`w-full rounded-lg border px-2.5 py-1.5 text-sm text-gray-900 ${editorFieldErrors.nationality ? 'border-red-500 bg-red-50' : 'border-gray-200'}`}
                          />
                        </div>
                      )}
                      {!isResident && (
                        <div>
                          <RequiredLabel text={t('checkin_popup_occupation')} />
                          <input
                            value={editorDraft.occupation}
                            onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, occupation: event.target.value } : prev)); setEditorError(null); }}
                            className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900"
                          />
                        </div>
                      )}
                      <div className="col-span-2">
                        <RequiredLabel text={t('checkin_popup_address')} required />
                        <input
                          value={editorDraft.address}
                          onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, address: event.target.value } : prev)); setEditorError(null); }}
                          className={`w-full rounded-lg border px-2.5 py-1.5 text-sm text-gray-900 ${editorFieldErrors.address ? 'border-red-500 bg-red-50' : 'border-gray-200'}`}
                        />
                      </div>
                      {index > 0 && (
                        <div className="col-span-2 -mb-1 flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`same-as-lead-${guest.id}`}
                            checked={Boolean(sameAsLeadByGuest[guest.id])}
                            onChange={() => toggleSameAsLead(guest.id)}
                            className="h-3.5 w-3.5 rounded border-gray-300"
                          />
                          <label htmlFor={`same-as-lead-${guest.id}`} className="text-xs text-gray-500">
                            {t('checkin_popup_same_as_lead')}
                          </label>
                        </div>
                      )}
                      <div className={index === 0 ? 'col-span-2 rounded-xl border border-blue-200 bg-blue-50 p-2.5' : 'col-span-2'}>
                        <RequiredLabel
                          text={index === 0 ? t('checkin_popup_contact_email') : t('checkin_popup_contact')}
                          required
                        />
                        <input
                          type={index === 0 ? 'email' : 'text'}
                          value={editorDraft.contactInfo ?? ''}
                          onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, contactInfo: event.target.value } : prev)); setEditorError(null); }}
                          disabled={index > 0 && Boolean(sameAsLeadByGuest[guest.id])}
                          className={`w-full rounded-lg border px-2.5 py-1.5 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-400 ${editorFieldErrors.contactInfo ? 'border-red-500 bg-red-50' : index === 0 ? 'border-blue-300' : 'border-gray-200'}`}
                          placeholder={index === 0 ? t('checkin_contact_email_placeholder') : t('checkin_contact_placeholder')}
                        />
                        {index === 0 && (
                          <p className="mt-1 text-[11px] font-medium text-blue-600">{t('checkin_contact_email_note')}</p>
                        )}
                      </div>
                      {!isResident && (
                        <div className="col-span-2">
                          <RequiredLabel text={t('checkin_popup_prev_location')} required />
                          <input
                            value={editorDraft.previousLocation ?? ''}
                            onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, previousLocation: event.target.value } : prev)); setEditorError(null); }}
                            disabled={index > 0 && Boolean(sameAsLeadByGuest[guest.id])}
                            className={`w-full rounded-lg border px-2.5 py-1.5 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-400 ${editorFieldErrors.previousLocation ? 'border-red-500 bg-red-50' : 'border-gray-200'}`}
                          />
                        </div>
                      )}
                      {!isResident && (
                        <div className="col-span-2">
                          <RequiredLabel text={t('checkin_popup_next_location')} required />
                          <input
                            value={editorDraft.nextLocation ?? ''}
                            onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, nextLocation: event.target.value } : prev)); setEditorError(null); }}
                            disabled={index > 0 && Boolean(sameAsLeadByGuest[guest.id])}
                            className={`w-full rounded-lg border px-2.5 py-1.5 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-400 ${editorFieldErrors.nextLocation ? 'border-red-500 bg-red-50' : 'border-gray-200'}`}
                          />
                        </div>
                      )}
                      {!isResident && (
                        <div>
                          <RequiredLabel text={t('checkin_popup_docnum')} required />
                          <input
                            value={editorDraft.documentNumber}
                            onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, documentNumber: event.target.value } : prev)); setEditorError(null); }}
                            className={`w-full rounded-lg border px-2.5 py-1.5 text-sm text-gray-900 ${editorFieldErrors.documentNumber ? 'border-red-500 bg-red-50' : 'border-gray-200'}`}
                          />
                        </div>
                      )}
                      {!isResident && (
                        <div>
                          <RequiredLabel text={t('checkin_popup_doctype')} required />
                          <select
                            value={editorDraft.documentType}
                            onChange={(event) => { setEditorDraft((prev) => (prev ? { ...prev, documentType: event.target.value as CheckInGuest['documentType'] } : prev)); setEditorError(null); }}
                            className={`w-full rounded-lg border bg-white px-2.5 py-1.5 text-sm text-gray-900 ${editorFieldErrors.documentType ? 'border-red-500 bg-red-50' : 'border-gray-200'}`}
                          >
                            {Object.entries(DOCUMENT_TYPE_LABEL_KEYS).map(([value, labelKey]) => (
                              <option key={value} value={value}>{t(labelKey)}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
                      <button
                        type="button"
                        onClick={() => resetGuestCapture(guest.id)}
                        className="text-xs text-gray-400 hover:text-gray-700"
                      >
                        {isResident ? t('checkin_popup_clear') : t('checkin_popup_another')}
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
          className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900 hover:text-gray-700 disabled:opacity-30"
        >
          <Plus className="h-4 w-4" /> {t('checkin_add_guest')}
        </button>

        {/* Security trust strip */}
        <div className="mt-5 flex items-center justify-center gap-5 rounded-xl border border-[#e4e2e3] bg-[#f5f3f4] px-4 py-3">
          <span className="flex items-center gap-1.5 text-[#44474c]">
            <Lock className="h-4 w-4 text-[#0f7a44]" strokeWidth={2.5} />
            <span className="text-[11px] font-semibold uppercase tracking-wide">{t('checkin_ssl')}</span>
          </span>
          <span className="h-4 w-px bg-[#e4e2e3]" />
          <ShieldCheck className="h-5 w-5 text-[#0f7a44]" strokeWidth={2} />
          <span className="h-4 w-px bg-[#e4e2e3]" />
          <span className="flex items-center gap-1.5 text-[#44474c]">
            <EyeOff className="h-4 w-4 text-[#44474c]" strokeWidth={2} />
            <span className="text-[11px] font-semibold uppercase tracking-wide">{t('checkin_private')}</span>
          </span>
        </div>

        {/* Submit — desktop in-flow */}
        <div className="mt-6 hidden md:block">
          <button
            type="button"
            disabled={!canSubmit || isSubmitting}
            onClick={() => setShowSubmitConfirm(true)}
            className="w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {t('checkin_submit_btn')}
          </button>
        </div>
      </main>

      {/* Fixed bottom bar — mobile */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-100 bg-white px-4 pb-4 pt-3 md:hidden">
        <button
          type="button"
          disabled={!canSubmit || isSubmitting}
          onClick={() => setShowSubmitConfirm(true)}
          className="w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {t('checkin_submit_btn')}
        </button>
      </div>

      {/* Submit confirmation */}
      {showSubmitConfirm && !submitSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl">
            <h2 className="text-lg font-bold text-gray-900">{t('checkin_confirm_submit_title')}</h2>
            <p className="mt-2 text-sm text-gray-500">{t('checkin_confirm_submit_body')}</p>
            {submitError && (
              <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-left text-xs text-red-700">{submitError}</p>
            )}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setShowSubmitConfirm(false)}
                className="flex-1 rounded-xl border border-gray-300 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {t('checkin_confirm_cancel')}
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleSubmit()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-60"
              >
                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isSubmitting ? t('checkin_submitting') : t('checkin_confirm_submit_btn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success popup */}
      {submitSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">{t('checkin_success_title')}</h2>
            <p className="mt-2 text-sm text-gray-400">{t('checkin_success_ref')}: {submitSuccess}</p>
            {submitEmailsSent.length > 0 && (
              <div className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-left">
                <p className="text-xs text-blue-700">
                  {t('checkin_success_email_sent').replace('{email}', submitEmailsSent.join(', '))}
                </p>
                <p className="mt-1 text-[11px] text-blue-500">{t('checkin_success_email_hint')}</p>
              </div>
            )}
            <button
              type="button"
              onClick={() => navigate('/')}
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
