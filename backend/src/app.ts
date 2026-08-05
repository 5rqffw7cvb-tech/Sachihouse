import { timingSafeEqual } from 'node:crypto';
import cors from 'cors';
import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { addDays, format, isValid, parseISO } from 'date-fns';
import { canAccessProperty, canPerformAction } from './domain/authorization.js';
import { calculateQuote } from './domain/pricing.js';
import {
  calculateRefund,
  canTransition,
  daysBetweenDates,
  FREE_CANCELLATION_DAYS,
  getStayDates,
  isDirectBookingEnabled,
  resolveFreeCancellationDays,
  toJstDateString,
  validateBookingWindow,
} from './domain/booking.js';
import { signCheckInToken, verifyCheckInToken, verifyToken, signToken } from './auth/jwt.js';
import {
  ACTIVE_BOOKING_STATUSES,
  AuthUser,
  BlogPost,
  Booking,
  BOOKING_STATUSES,
  BookingConfirmationPatch,
  BookingListFilters,
  BookingStatus,
  CheckInGuest,
  CheckInListFilters,
  CheckInSubmission,
  DataStore,
  generateConfirmationNo,
  PropertyData,
  SiteSettings,
  HostPlanCode,
  BillingCycle,
  PLAN_TO_HOST_LEVEL,
} from './store/types.js';
import { getParam } from './types/params.js';
import { Role } from './types/domain.js';
import { IcalSyncService } from './services/icalSync.js';
import { buildPropertyIcs } from './services/icsExport.js';
import { IdProcessingService } from './services/idProcessing.js';
import { ObjectStorageService } from './services/objectStorage.js';
import { ReceiptProcessingService } from './services/receiptProcessing.js';
import { TranslationService } from './services/translationService.js';
import { PaymentGateway, StripeService } from './services/stripe.js';
import { Mailer, MailAttachment, ResendMailer } from './services/mailer.js';
import {
  BookingEmailContext,
  buildGuestCancellationEmail,
  buildGuestConfirmationEmail,
  buildHostCancellationEmail,
  buildHostConfirmationEmail,
  buildManualBookingConfirmationEmail,
} from './domain/bookingEmails.js';
import { buildCheckInWelcomeEmail } from './domain/checkinWelcomeEmail.js';

const ALLOWED_ROLES: Role[] = ['ADMIN', 'HOST', 'GUEST'];
// Declared once because the body-parser middleware and the route must agree
// exactly — a mismatch silently JSON-parses the webhook and breaks signatures.
const STRIPE_WEBHOOK_PATH = '/api/stripe/webhook';
const CHECKIN_OCR_MAX_IMAGE_BYTES = Number(process.env.CHECKIN_OCR_MAX_IMAGE_MB ?? 20) * 1024 * 1024;

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ALLOWED_ROLES.includes(value as Role);
}

const HOST_PLAN_CODES: HostPlanCode[] = ['basic', 'plus', 'pro'];
const BILLING_CYCLES: BillingCycle[] = ['monthly', 'yearly'];

function isHostPlanCode(value: unknown): value is HostPlanCode {
  return typeof value === 'string' && HOST_PLAN_CODES.includes(value as HostPlanCode);
}

function isBillingCycle(value: unknown): value is BillingCycle {
  return typeof value === 'string' && BILLING_CYCLES.includes(value as BillingCycle);
}

function getBearerToken(header?: string): string | null {
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  return header.slice('Bearer '.length);
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function toNormalizedCode(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return normalized ? normalized : null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return null;
}

function toNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const parsed = Math.trunc(value);
  return parsed >= 0 ? parsed : null;
}

// Finds the booking an event belongs to. Checkout Sessions carry it in both
// metadata and client_reference_id; charges inherit the PaymentIntent metadata
// we set at session creation. Disputes carry neither, hence the undefined case.
function extractBookingId(event: { data?: { object?: unknown } }): string | undefined {
  const object = event.data?.object as
    | { metadata?: Record<string, string> | null; client_reference_id?: string | null }
    | undefined;
  const fromMetadata = object?.metadata?.bookingId;
  if (typeof fromMetadata === 'string' && fromMetadata) {
    return fromMetadata;
  }
  const reference = object?.client_reference_id;
  return typeof reference === 'string' && reference ? reference : undefined;
}

// Stripe rejects a success_url without an explicit scheme, which turns one
// mistyped environment variable into a 502 on every booking attempt. A bare
// host is assumed to be https rather than being passed through to fail.
export function normalizeSiteUrl(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    return 'http://localhost:5173';
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// The public site is a single-page app on HashRouter — every real route lives
// after a `#` (e.g. `/#/sachi-ojima/checkin`). A link built without it loads
// the bundle but renders the default route instead of the intended page, so
// every outbound link (email, Stripe redirect) must go through this.
export function buildSiteUrl(siteUrl: string, pathAndQuery: string): string {
  return `${siteUrl}/#${pathAndQuery}`;
}

function getClientIp(req: Request): string {
  // Relies on `app.set('trust proxy', ...)` so Express resolves req.ip from the
  // trusted hop count rather than blindly trusting a client-suppliable header
  // (otherwise X-Forwarded-For spoofing trivially bypasses IP-based rate limiting).
  return (req.ip || req.socket.remoteAddress || 'unknown').slice(0, 100);
}

function toLanguageCode(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : null;
}

function deepMergeRecord(base: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object') {
    return patch;
  }
  if (Array.isArray(patch)) {
    if (!Array.isArray(base)) {
      return structuredClone(patch).filter((item: unknown) => item !== undefined);
    }
    // Keep base array shape; ignore out-of-range translated indices from stale snapshots.
    // Treat null patch items the same as undefined — null can appear when JSON-serialising
    // sparse arrays (e.g. gallery images that only have captions at certain indices).
    const mergedArray = new Array(base.length);
    for (let i = 0; i < base.length; i += 1) {
      const baseItem = base[i];
      const patchItem = patch[i];
      mergedArray[i] = (patchItem === undefined || patchItem === null)
        ? structuredClone(baseItem)
        : deepMergeRecord(baseItem, patchItem);
    }
    return mergedArray;
  }
  if (!base || typeof base !== 'object' || Array.isArray(base)) {
    return structuredClone(patch);
  }

  const merged = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = merged[key];
    if (value && typeof value === 'object') {
      merged[key] = deepMergeRecord(current, value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function applyPropertyLocalization(property: PropertyData & { id: string }, lang: string | null): PropertyData & { id: string } {
  if (!lang || !property.translations || typeof property.translations !== 'object') {
    return property;
  }

  const localizedPatch = property.translations[lang];
  if (!localizedPatch || typeof localizedPatch !== 'object') {
    return property;
  }

  const merged = deepMergeRecord(property, localizedPatch) as PropertyData & { id: string };
  return {
    ...merged,
    id: property.id,
    translations: property.translations,
  };
}

// Strips internal/admin-only fields (iCal sync URLs, EmailJS credentials) from a
// property before sending it to anyone who is not its owner (admin or assigned
// host). Public pages never use these fields, so this prevents one host's
// configuration from leaking to other hosts or anonymous visitors via the API.
function redactPropertyForViewer(
  property: PropertyData & { id: string },
  actor: AuthUser | null | undefined,
): PropertyData & { id: string } {
  if (actor && canAccessProperty(actor, property.id)) {
    return property;
  }
  // icalFeeds is typed; emailJs is stored in the JSON payload but not modelled
  // on the backend type, so remove it via a runtime delete.
  const clone = { ...property, icalFeeds: [] } as PropertyData & { id: string };
  delete (clone as unknown as Record<string, unknown>).emailJs;
  // The export token guards the public iCal URL; never expose it to non-owners.
  delete (clone as unknown as Record<string, unknown>).icalExportToken;
  return clone;
}

function setPathValue(target: Record<string, unknown>, path: string, value: string): void {
  const segments = path.split('.');
  if (segments.length === 0) {
    return;
  }

  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    const nextSegment = segments[i + 1];
    const nextIsIndex = /^\d+$/.test(nextSegment);
    const existing = cursor[segment];

    if (existing && typeof existing === 'object') {
      cursor = existing as Record<string, unknown>;
      continue;
    }

    cursor[segment] = nextIsIndex ? [] : {};
    cursor = cursor[segment] as Record<string, unknown>;
  }

  const last = segments[segments.length - 1];
  cursor[last] = value;
}

function buildTranslatableFields(property: PropertyData): Array<{ path: string; value: string }> {
  const fields: Array<{ path: string; value: string }> = [];
  const push = (path: string, value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      fields.push({ path, value: value.trim() });
    }
  };

  push('name', property.name);
  push('subtitle', property.subtitle);
  push('description', property.description);
  push('address', property.address);
  push('hostName', property.hostName);
  push('additionalRules', property.additionalRules);
  push('accessInfo.train', property.accessInfo?.train);
  push('accessInfo.airport', property.accessInfo?.airport);
  push('accessInfo.checkIn', property.accessInfo?.checkIn);

  if (property.titles) {
    for (const [key, value] of Object.entries(property.titles)) {
      push(`titles.${key}`, value);
    }
  }

  property.highlights?.forEach((item, index) => {
    push(`highlights.${index}.title`, item.title);
    push(`highlights.${index}.description`, item.description);
  });

  property.rules?.forEach((rule, index) => {
    push(`rules.${index}.text`, rule.text);
  });

  property.manual?.forEach((item, index) => {
    push(`manual.${index}.title`, item.title);
    push(`manual.${index}.content`, item.content);
  });

  property.amenities?.forEach((item, index) => {
    push(`amenities.${index}`, item);
  });

  property.galleryCategories?.forEach((item, index) => {
    push(`galleryCategories.${index}.label`, item.label);
  });

  property.galleryImages?.forEach((item, index) => {
    push(`galleryImages.${index}.caption`, item.caption);
  });

  property.sleepingArrangements?.forEach((item, index) => {
    push(`sleepingArrangements.${index}.title`, item.title);
    push(`sleepingArrangements.${index}.description`, item.description);
  });

  return fields;
}

export interface AppDependencies {
  // Injected by tests so the booking and webhook flows run without network calls.
  payments?: PaymentGateway;
  mailer?: Mailer;
}

export function createApp(store: DataStore, deps: AppDependencies = {}) {
  const app = express();
  // Railway terminates TLS and proxies requests through a single hop, so trust
  // exactly one X-Forwarded-For entry. Without this, getClientIp() would trust
  // a header any client can set, letting IP-based rate limiting be spoofed.
  app.set('trust proxy', 1);
  const icalSync = new IcalSyncService({
    enabled: process.env.ICAL_SYNC_ENABLED !== 'false' && process.env.NODE_ENV !== 'test',
    ttlMs: Number(process.env.ICAL_SYNC_TTL_MS ?? 60000),
    timeoutMs: Number(process.env.ICAL_SYNC_TIMEOUT_MS ?? 5000),
  });
  const idProcessing = new IdProcessingService();
  const objectStorage = new ObjectStorageService();
  const receiptProcessing = new ReceiptProcessingService();
  const translationService = new TranslationService();
  const payments: PaymentGateway = deps.payments ?? new StripeService();
  const mailer: Mailer = deps.mailer ?? new ResendMailer();
  const publicSiteUrl = normalizeSiteUrl(process.env.PUBLIC_SITE_URL);
  // Guests read their own language; the host reads one, set once.
  const hostMailLocale = (process.env.MAIL_HOST_LOCALE ?? 'ja').trim().toLowerCase();
  const hostMailFallback = (process.env.MAIL_HOST_FALLBACK ?? '').trim();
  const ocrRateMap = new Map<string, { count: number; resetAt: number }>();
  const bookingRateMap = new Map<string, { count: number; resetAt: number }>();
  const checkinMatchRateMap = new Map<string, { count: number; resetAt: number }>();
  const bookingRateLimitPerHour = Math.max(1, Number(process.env.BOOKING_RATE_LIMIT_PER_HOUR ?? 10));
  // Stripe Checkout sessions cannot expire sooner than 30 minutes, so the
  // internal hold outlives the payment page and is released by the sweeper.
  const bookingHoldMs = Math.max(5, Number(process.env.BOOKING_HOLD_MINUTES ?? 35)) * 60_000;
  const retentionDaysRaw = Number(process.env.CHECKIN_RETENTION_DAYS ?? 7);
  const checkInRetentionDays = Number.isFinite(retentionDaysRaw) && retentionDaysRaw > 0 ? Math.trunc(retentionDaysRaw) : 7;
  const checkInRetentionNoticeVersion = (process.env.CHECKIN_RETENTION_NOTICE_VERSION ?? 'v1').trim() || 'v1';
  // How long a booking-specific check-in link (?bk=...) keeps matching after
  // the stay is over. It gates only whether the house-access welcome email
  // (wifi, entry code) gets sent — and always to whatever email is currently
  // on the booking, which a guest can self-update — so an old confirmation
  // number must not stay usable indefinitely once the stay has clearly ended.
  const checkinLinkGraceDaysRaw = Number(process.env.CHECKIN_LINK_GRACE_DAYS ?? 2);
  const checkinLinkGraceDays = Number.isFinite(checkinLinkGraceDaysRaw) && checkinLinkGraceDaysRaw >= 0
    ? checkinLinkGraceDaysRaw
    : 2;

  function isCheckInLinkExpired(checkOutDate: string, now: number): boolean {
    return daysBetweenDates(checkOutDate, toJstDateString(now)) > checkinLinkGraceDays;
  }
  const loginAttemptMap = new Map<string, { fails: number; lockUntil: number }>();
  const loginMaxFails = Math.max(3, Number(process.env.LOGIN_MAX_FAILS ?? 5));
  const loginLockMs = Math.max(30_000, Number(process.env.LOGIN_LOCK_SECONDS ?? 120) * 1000);
  // Cloudflare's published always-pass test secret, used only as a local-dev fallback
  // when TURNSTILE_SECRET_KEY isn't configured. https://developers.cloudflare.com/turnstile/troubleshooting/testing/
  const turnstileSecretKey = process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA';

  // The single definition of "this night is not for sale": host blocks, dates
  // imported from other platforms, and nights held by a direct booking. Every
  // availability answer in the API funnels through here, so a direct booking
  // disappears from search, the public calendar and quotes at the same instant.
  async function getEffectiveBlockedDates(
    property: PropertyData & { id: string },
    mode: 'stale-ok' | 'fresh-if-stale',
  ): Promise<string[]> {
    const [baseDates, heldDates] = await Promise.all([
      store.listBlockedDates(property.id),
      store.listHeldDates(property.id),
    ]);
    const withIcal = await icalSync.getBlockedDates(property, baseDates, mode);
    return Array.from(new Set([...withIcal, ...heldDates]));
  }


  function isIsoDate(value: unknown): value is string {
    if (typeof value !== 'string') {
      return false;
    }
    const parsed = parseISO(value);
    return isValid(parsed) && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  function parseImageData(input: string): { mimeType: string; base64: string } {
    const trimmed = input.trim();
    const dataUrlMatch = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (dataUrlMatch) {
      return {
        mimeType: dataUrlMatch[1].toLowerCase(),
        base64: dataUrlMatch[2],
      };
    }

    return {
      mimeType: 'image/jpeg',
      base64: trimmed,
    };
  }

  function enforceOcrRateLimit(ipAddress: string): boolean {
    const now = Date.now();
    const current = ocrRateMap.get(ipAddress);
    if (!current || now > current.resetAt) {
      ocrRateMap.set(ipAddress, { count: 1, resetAt: now + 60_000 });
      return true;
    }

    if (current.count >= 20) {
      return false;
    }

    current.count += 1;
    return true;
  }

  // A booking-ID guess is cheap for an attacker to script, so this must be
  // tighter than the OCR limit even though each request is far lighter.
  function enforceCheckinMatchRateLimit(ipAddress: string): boolean {
    const now = Date.now();
    const current = checkinMatchRateMap.get(ipAddress);
    if (!current || now > current.resetAt) {
      checkinMatchRateMap.set(ipAddress, { count: 1, resetAt: now + 60_000 });
      return true;
    }

    if (current.count >= 10) {
      return false;
    }

    current.count += 1;
    return true;
  }

  // Each attempt parks real inventory for the length of the hold, so an
  // unthrottled endpoint would let one client drain a property's calendar.
  function enforceBookingRateLimit(ipAddress: string): boolean {
    const now = Date.now();
    const current = bookingRateMap.get(ipAddress);
    if (!current || now > current.resetAt) {
      bookingRateMap.set(ipAddress, { count: 1, resetAt: now + 60 * 60_000 });
      return true;
    }

    if (current.count >= bookingRateLimitPerHour) {
      return false;
    }

    current.count += 1;
    return true;
  }

  function getCountryCapitalBackend(nationality: string): string {
    const capitals: Record<string, string> = {
      JPN: 'Tokyo, Japan', VNM: 'Hanoi, Viet Nam', CHN: 'Beijing, China',
      KOR: 'Seoul, South Korea', TWN: 'Taipei, Taiwan', THA: 'Bangkok, Thailand',
      SGP: 'Singapore, Singapore', MYS: 'Kuala Lumpur, Malaysia', PHL: 'Manila, Philippines',
      IDN: 'Jakarta, Indonesia', IND: 'New Delhi, India', AUS: 'Canberra, Australia',
      NZL: 'Wellington, New Zealand', HKG: 'Hong Kong', MMR: 'Naypyidaw, Myanmar',
      KHM: 'Phnom Penh, Cambodia', LAO: 'Vientiane, Laos', NPL: 'Kathmandu, Nepal',
      BGD: 'Dhaka, Bangladesh', LKA: 'Colombo, Sri Lanka', PAK: 'Islamabad, Pakistan',
      USA: 'Washington D.C., United States', CAN: 'Ottawa, Canada', MEX: 'Mexico City, Mexico',
      BRA: 'Brasilia, Brazil', GBR: 'London, United Kingdom', FRA: 'Paris, France',
      DEU: 'Berlin, Germany', ITA: 'Rome, Italy', ESP: 'Madrid, Spain',
      PRT: 'Lisbon, Portugal', NLD: 'Amsterdam, Netherlands', CHE: 'Bern, Switzerland',
      AUT: 'Vienna, Austria', SWE: 'Stockholm, Sweden', NOR: 'Oslo, Norway',
      DNK: 'Copenhagen, Denmark', FIN: 'Helsinki, Finland', POL: 'Warsaw, Poland',
      RUS: 'Moscow, Russia', TUR: 'Ankara, Turkey', SAU: 'Riyadh, Saudi Arabia',
      ARE: 'Abu Dhabi, UAE', EGY: 'Cairo, Egypt', ZAF: 'Pretoria, South Africa',
      ARG: 'Buenos Aires, Argentina', CHL: 'Santiago, Chile', COL: 'Bogota, Colombia',
      PER: 'Lima, Peru', IRN: 'Tehran, Iran',
    };
    const nameToCode: Record<string, string> = {
      JAPAN: 'JPN', VIETNAM: 'VNM', 'VIET NAM': 'VNM', CHINA: 'CHN',
      'SOUTH KOREA': 'KOR', KOREA: 'KOR', TAIWAN: 'TWN', THAILAND: 'THA',
      SINGAPORE: 'SGP', MALAYSIA: 'MYS', PHILIPPINES: 'PHL', INDONESIA: 'IDN',
      INDIA: 'IND', AUSTRALIA: 'AUS', 'NEW ZEALAND': 'NZL', 'HONG KONG': 'HKG',
      MYANMAR: 'MMR', CAMBODIA: 'KHM', LAOS: 'LAO', NEPAL: 'NPL',
      BANGLADESH: 'BGD', 'SRI LANKA': 'LKA', PAKISTAN: 'PAK',
      USA: 'USA', 'UNITED STATES': 'USA', 'UNITED STATES OF AMERICA': 'USA',
      CANADA: 'CAN', MEXICO: 'MEX', BRAZIL: 'BRA', ARGENTINA: 'ARG',
      'UNITED KINGDOM': 'GBR', UK: 'GBR', ENGLAND: 'GBR', FRANCE: 'FRA',
      GERMANY: 'DEU', ITALY: 'ITA', SPAIN: 'ESP', PORTUGAL: 'PRT',
      NETHERLANDS: 'NLD', SWITZERLAND: 'CHE', AUSTRIA: 'AUT', SWEDEN: 'SWE',
      NORWAY: 'NOR', DENMARK: 'DNK', FINLAND: 'FIN', POLAND: 'POL',
      RUSSIA: 'RUS', TURKEY: 'TUR', 'SAUDI ARABIA': 'SAU',
      UAE: 'ARE', 'UNITED ARAB EMIRATES': 'ARE', EGYPT: 'EGY', 'SOUTH AFRICA': 'ZAF',
    };
    const upper = nationality.toUpperCase().trim();
    const directResult = capitals[upper];
    if (directResult) return directResult;
    const code = nameToCode[upper];
    return code ? (capitals[code] ?? '') : '';
  }

  function toNormalizedGuest(guest: unknown, index: number): CheckInGuest {
    const row = (guest as Partial<CheckInGuest>) ?? {};
    const nowYear = new Date().getFullYear();
    const normalizedBirthYear = typeof row.birthYear === 'number' && Number.isInteger(row.birthYear) && row.birthYear >= 1900 && row.birthYear <= nowYear
      ? row.birthYear
      : null;

    const estimated = { ...(row.estimated ?? {}) };
    const confidence = { ...(row.confidence ?? {}) };
    const fullName = normalizeText(row.fullName) || `Guest ${index + 1}`;
    if (!normalizeText(row.fullName)) {
      estimated.fullName = true;
      confidence.fullName = confidence.fullName ?? 0.2;
    }

    const nationality = normalizeText(row.nationality) || 'UNKNOWN';
    if (!normalizeText(row.nationality)) {
      estimated.nationality = true;
      confidence.nationality = confidence.nationality ?? 0.2;
    }

    const address = normalizeText(row.address) || getCountryCapitalBackend(normalizeText(row.nationality) || nationality) || 'UNKNOWN';
    if (!normalizeText(row.address)) {
      estimated.address = true;
      confidence.address = confidence.address ?? 0.2;
    }

    const gender = normalizeText(row.gender) || 'UNSPECIFIED';
    if (!normalizeText(row.gender)) {
      estimated.gender = true;
      confidence.gender = confidence.gender ?? 0.2;
    }

    const occupation = normalizeText(row.occupation) || 'TRAVELER';
    if (!normalizeText(row.occupation)) {
      estimated.occupation = true;
      confidence.occupation = confidence.occupation ?? 0.2;
    }

    const documentType = row.documentType ?? 'unknown';
    if (documentType === 'unknown') {
      estimated.documentType = true;
      confidence.documentType = confidence.documentType ?? 0.2;
    }

    const documentNumber = normalizeText(row.documentNumber) || 'UNKNOWN';
    if (!normalizeText(row.documentNumber)) {
      estimated.documentNumber = true;
      confidence.documentNumber = confidence.documentNumber ?? 0.2;
    }

    return {
      id: normalizeText(row.id) || `guest_${index + 1}`,
      fullName,
      birthYear: normalizedBirthYear,
      nationality,
      address,
      gender,
      occupation,
      documentType,
      documentNumber,
      evidenceUrl: normalizeText(row.evidenceUrl),
      evidenceMimeType: normalizeText(row.evidenceMimeType) || 'image/jpeg',
      ocrText: normalizeText(row.ocrText),
      estimated,
      confidence,
      contactInfo: normalizeText(row.contactInfo),
      // Previous-stay / next-destination default to the resolved address (never empty).
      previousLocation: normalizeText(row.previousLocation) || address,
      nextLocation: normalizeText(row.nextLocation) || address,
    };
  }

  function validateCheckInToken(token: unknown, propertyId: string): boolean {
    if (typeof token !== 'string' || !token.trim()) {
      return false;
    }

    try {
      const payload = verifyCheckInToken(token);
      return payload.purpose === 'checkin' && payload.propertyId === propertyId;
    } catch {
      return false;
    }
  }

  async function resolveSubmissionEvidence(submission: CheckInSubmission): Promise<CheckInSubmission> {
    const guests = await Promise.all(submission.guests.map(async (guest) => ({
      ...guest,
      evidenceUrl: await objectStorage.getEvidenceAccessUrl(guest.evidenceUrl),
    })));

    return {
      ...submission,
      guests,
      consent: submission.consent ?? {
        accepted: false,
        acceptedAt: 0,
        retentionDays: checkInRetentionDays,
        noticeVersion: checkInRetentionNoticeVersion,
      },
      audit: submission.audit ?? {
        submittedAt: submission.createdAt,
        ipAddress: 'unknown',
        userAgent: 'unknown',
      },
    };
  }

  function pruneLoginAttemptState(now: number): void {
    loginAttemptMap.forEach((value, key) => {
      if (value.lockUntil <= now && value.fails === 0) {
        loginAttemptMap.delete(key);
      }
    });
  }

  async function verifyTurnstileToken(token: unknown, remoteIp: string): Promise<boolean> {
    if (typeof token !== 'string' || !token.trim()) {
      return false;
    }
    try {
      const params = new URLSearchParams();
      params.set('secret', turnstileSecretKey);
      params.set('response', token);
      if (remoteIp && remoteIp !== 'unknown') {
        params.set('remoteip', remoteIp);
      }
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });
      const data = (await response.json()) as { success?: boolean };
      return data.success === true;
    } catch {
      return false;
    }
  }

  function getLoginAttemptKey(req: Request, email: string): string {
    return `${getClientIp(req)}::${email.trim().toLowerCase()}`;
  }

  function getLoginLockRemainingMs(key: string): number {
    const row = loginAttemptMap.get(key);
    if (!row) {
      return 0;
    }
    const now = Date.now();
    if (row.lockUntil <= now) {
      row.fails = 0;
      row.lockUntil = 0;
      return 0;
    }
    return row.lockUntil - now;
  }

  function recordLoginFailure(key: string): void {
    const now = Date.now();
    const current = loginAttemptMap.get(key) ?? { fails: 0, lockUntil: 0 };
    current.fails += 1;
    if (current.fails >= loginMaxFails) {
      current.lockUntil = now + loginLockMs;
      current.fails = 0;
    }
    loginAttemptMap.set(key, current);
  }

  function clearLoginFailure(key: string): void {
    loginAttemptMap.set(key, { fails: 0, lockUntil: 0 });
  }

  app.use(cors());
  app.use(helmet());
  // Most endpoints take small JSON. Check-in OCR and submit carry ID images
  // (submit may bundle several guests' images, since upload is deferred to confirm),
  // so those two paths get a larger body limit.
  const standardJson = express.json({ limit: '2mb' });
  const imageJson = express.json({ limit: '30mb' });
  // Stripe signs the exact bytes it sent. Parsing the webhook body as JSON first
  // would re-serialise it and break every signature check, so this path gets the
  // raw buffer and must stay ahead of the JSON parsers below.
  const stripeWebhookRaw = express.raw({ type: '*/*', limit: '1mb' });
  app.use((req, res, next) => {
    if (req.path === STRIPE_WEBHOOK_PATH) {
      return stripeWebhookRaw(req, res, next);
    }
    const isImageRoute = req.path.endsWith('/checkins/ocr')
      || req.path.endsWith('/checkins/submit')
      || req.path.endsWith('/finance/pending/upload-single')
      || req.path.endsWith('/finance/pending/batch-upload')
      || req.path.endsWith('/finance/receipts/upload')
      || req.path.endsWith('/finance/ingest/email-receipt')
      || /\/booking-confirmations\/[^/]+\/email$/.test(req.path)
      || /\/properties\/[^/]+\/images$/.test(req.path);
    return (isImageRoute ? imageJson : standardJson)(req, res, next);
  });
  app.use(morgan('dev'));

  // Throttle "last seen" writes: at most one DB update per user per interval.
  const LAST_SEEN_WRITE_INTERVAL_MS = 30_000;
  const lastSeenWriteAt = new Map<number, number>();

  app.use(async (req: Request, _res: Response, next: NextFunction) => {
    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      req.authUser = null;
      return next();
    }

    try {
      const payload = verifyToken(token);
      req.authUser = await store.getUserById(payload.sub);

      if (req.authUser) {
        const now = Date.now();
        const lastWrite = lastSeenWriteAt.get(req.authUser.id) ?? 0;
        if (now - lastWrite >= LAST_SEEN_WRITE_INTERVAL_MS) {
          lastSeenWriteAt.set(req.authUser.id, now);
          // Fire-and-forget so presence tracking never delays the request.
          void store.touchUserLastSeen(req.authUser.id, now).catch(() => {
            lastSeenWriteAt.delete(req.authUser!.id);
          });
        }
        req.authUser.lastSeenAt = now;
      }

      next();
    } catch {
      req.authUser = null;
      next();
    }
  });

  const requireAuth: RequestHandler = (req, res, next) => {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    return next();
  };

  const requireAdmin: RequestHandler = (req, res, next) => {
    if (!req.authUser || req.authUser.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Admin role required.' });
    }
    return next();
  };

  const requireHostOrAdmin: RequestHandler = (req, res, next) => {
    if (!req.authUser || (req.authUser.role !== 'ADMIN' && req.authUser.role !== 'HOST')) {
      return res.status(403).json({ error: 'Host or admin role required.' });
    }
    return next();
  };

  // Finance is reserved for admins and host level 4 only. Lower host levels
  // (1–3) are blocked even though they may host properties.
  const requireFinanceAccess: RequestHandler = (req, res, next) => {
    const actor = req.authUser;
    if (!actor || (actor.role !== 'ADMIN' && actor.role !== 'HOST')) {
      return res.status(403).json({ error: 'Host or admin role required.' });
    }
    if (actor.role === 'HOST' && (actor.hostLevel ?? 0) < 4) {
      return res.status(403).json({ error: 'Finance access requires host level 4.' });
    }
    return next();
  };

  const canViewPendingProperty = (actor: AuthUser | null | undefined, propertyId: string): boolean => {
    if (!actor) {
      return false;
    }
    if (actor.role === 'ADMIN') {
      return true;
    }
    if (actor.role === 'HOST') {
      return canPerformAction(actor, 'property.read', propertyId);
    }
    return false;
  };

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { email, password, turnstileToken } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const attemptKey = getLoginAttemptKey(req, email);
    if (process.env.NODE_ENV !== 'test') {
      pruneLoginAttemptState(Date.now());

      const lockRemainingMs = getLoginLockRemainingMs(attemptKey);
      if (lockRemainingMs > 0) {
        return res.status(429).json({
          error: `Too many login attempts. Try again in ${Math.ceil(lockRemainingMs / 1000)} seconds.`,
        });
      }

      const turnstileOk = await verifyTurnstileToken(turnstileToken, getClientIp(req));
      if (!turnstileOk) {
        return res.status(400).json({ error: 'Anti-bot verification failed. Please try again.' });
      }
    }

    const user = await store.authenticate(email, password);
    if (!user) {
      if (process.env.NODE_ENV !== 'test') {
        recordLoginFailure(attemptKey);
      }
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    clearLoginFailure(attemptKey);
    return res.json({ token: signToken(user), user });
  });

  // Public self-registration: anyone can create their own HOST account at
  // host level 1. Higher levels and finance access stay admin-granted only.
  app.post('/api/auth/register', async (req, res) => {
    const { name, email, password, turnstileToken } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }
    if (typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    if (process.env.NODE_ENV !== 'test') {
      const turnstileOk = await verifyTurnstileToken(turnstileToken, getClientIp(req));
      if (!turnstileOk) {
        return res.status(400).json({ error: 'Anti-bot verification failed. Please try again.' });
      }
    }

    let user: AuthUser;
    try {
      user = await store.registerHost(name, email, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create account.';
      if (message === 'Email is already in use.') {
        return res.status(409).json({ error: message });
      }
      throw err;
    }

    return res.status(201).json({ token: signToken(user), user });
  });

  app.get('/api/auth/me', requireAuth, async (req, res) => {
    res.json({ user: req.authUser });
  });

  app.get('/api/users', requireAdmin, async (_req, res) => {
    const users = await store.listUsers();
    res.json({ users });
  });

  app.post('/api/users', requireAdmin, async (req, res) => {
    const { name, email, password, role, canEditBlog } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }
    if (typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    if (!isRole(role)) {
      return res.status(400).json({ error: 'Valid role is required.' });
    }

    const user = await store.createUser(name, email, password, role, Boolean(canEditBlog), req.authUser!);
    return res.status(201).json({ user });
  });

  app.patch('/api/users/:id/name', requireAdmin, async (req, res) => {
    const userId = Number(getParam(req.params.id));
    const { name } = req.body ?? {};

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Valid user id is required.' });
    }
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }

    const user = await store.updateUserName(userId, name, req.authUser!);
    return res.json({ user });
  });

  app.patch('/api/users/:id/role', requireAdmin, async (req, res) => {
    const userId = Number(getParam(req.params.id));
    const { role } = req.body ?? {};

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Valid user id is required.' });
    }
    if (!isRole(role)) {
      return res.status(400).json({ error: 'Valid role is required.' });
    }
    if (req.authUser!.id === userId && role !== 'ADMIN') {
      return res.status(400).json({ error: 'Cannot remove your own admin role.' });
    }

    const user = await store.updateUserRole(userId, role, req.authUser!);
    return res.json({ user });
  });

  app.patch('/api/users/:id/can-edit-blog', requireAdmin, async (req, res) => {
    const userId = Number(getParam(req.params.id));
    const canEditBlog = toBoolean(req.body?.canEditBlog);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Valid user id is required.' });
    }
    if (canEditBlog === null) {
      return res.status(400).json({ error: 'Valid canEditBlog flag is required.' });
    }

    const user = await store.updateUserCanEditBlog(userId, canEditBlog, req.authUser!);
    return res.json({ user });
  });

  app.put('/api/users/:id/host-level', requireAdmin, async (req, res) => {
    const userId = Number(getParam(req.params.id));
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Valid user id is required.' });
    }
    const { level } = req.body ?? {};
    // level = 1 | 2 | 3 | 4 | null (null = revoke)
    if (level !== null && level !== undefined && ![1, 2, 3, 4].includes(Number(level))) {
      return res.status(400).json({ error: 'level must be 1, 2, 3, 4, or null.' });
    }
    const resolvedLevel = level != null ? (Number(level) as 1 | 2 | 3 | 4) : null;
    const user = await store.updateUserHostLevel(userId, resolvedLevel, req.authUser!);
    return res.json({ user });
  });

  app.patch('/api/users/:id/archive', requireAdmin, async (req, res) => {
    const userId = Number(getParam(req.params.id));
    const archived = toBoolean(req.body?.archived);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Valid user id is required.' });
    }
    if (archived === null) {
      return res.status(400).json({ error: 'Valid archived flag is required.' });
    }
    if (req.authUser!.id === userId && archived) {
      return res.status(400).json({ error: 'Cannot archive your own account.' });
    }

    const user = await store.setUserArchived(userId, archived, req.authUser!);
    return res.json({ user });
  });

  app.patch('/api/users/:id/email', requireAdmin, async (req, res) => {
    const userId = Number(getParam(req.params.id));
    const { email } = req.body ?? {};

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Valid user id is required.' });
    }
    if (typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required.' });
    }

    const user = await store.updateUserEmail(userId, email, req.authUser!);
    return res.json({ user });
  });

  app.patch('/api/users/:id/password', requireAdmin, async (req, res) => {
    const userId = Number(getParam(req.params.id));
    const { password } = req.body ?? {};

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Valid user id is required.' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    await store.updateUserPassword(userId, password, req.authUser!);
    return res.status(204).send();
  });

  app.delete('/api/users/:id', requireAdmin, async (req, res) => {
    const userId = Number(getParam(req.params.id));

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Valid user id is required.' });
    }
    if (req.authUser!.id === userId) {
      return res.status(400).json({ error: 'Cannot delete your own account.' });
    }

    await store.deleteUser(userId, req.authUser!);
    return res.status(204).send();
  });

  app.get('/api/properties', async (req, res) => {
    const minBedroomsRaw = req.query.minBedrooms;
    const minGuestsRaw = req.query.minGuests;
    const countryCodeRaw = req.query.countryCode;
    const provinceCodeRaw = req.query.provinceCode;

    if (Array.isArray(minBedroomsRaw) || Array.isArray(minGuestsRaw) || Array.isArray(countryCodeRaw) || Array.isArray(provinceCodeRaw)) {
      return res.status(400).json({ error: 'Filter query parameters must be singular values.' });
    }

    const minBedrooms = toPositiveInt(minBedroomsRaw);
    const minGuests = toPositiveInt(minGuestsRaw);
    const countryCode = toNormalizedCode(countryCodeRaw);
    const provinceCode = toNormalizedCode(provinceCodeRaw);
    const includeArchived = req.query.includeArchived === 'true' && !!req.authUser;
    const lang = toLanguageCode(req.query.lang);

    if (typeof minBedroomsRaw === 'string' && minBedrooms === null) {
      return res.status(400).json({ error: 'minBedrooms must be a positive integer.' });
    }
    if (typeof minGuestsRaw === 'string' && minGuests === null) {
      return res.status(400).json({ error: 'minGuests must be a positive integer.' });
    }

    const properties = await store.listProperties(includeArchived);
    const filtered = properties.filter((property) => {
      if (property.archivedAt && !includeArchived) {
        return false;
      }
      if (property.reviewStatus === 'pending_review' && !canViewPendingProperty(req.authUser, property.id)) {
        return false;
      }
      if (minBedrooms !== null && property.bedrooms < minBedrooms) {
        return false;
      }
      if (minGuests !== null && property.maxGuests < minGuests) {
        return false;
      }

      const propertyCountry = property.location?.countryCode?.trim().toUpperCase() ?? null;
      const propertyProvince = property.location?.provinceCode?.trim().toUpperCase() ?? null;

      if (countryCode && propertyCountry !== countryCode) {
        return false;
      }
      if (provinceCode && propertyProvince !== provinceCode) {
        return false;
      }

      return true;
    });

    res.json({ properties: filtered.map((property) => redactPropertyForViewer(applyPropertyLocalization(property, lang), req.authUser)) });
  });

  // Returns the properties that are fully free for the requested date range,
  // together with the cheapest nightly rate ("from" price) for each. Registered
  // before the `/:id` route so "availability" is not captured as a property id.
  app.get('/api/properties/availability', async (req, res) => {
    const checkInRaw = req.query.checkIn;
    const checkOutRaw = req.query.checkOut;

    if (typeof checkInRaw !== 'string' || typeof checkOutRaw !== 'string') {
      return res.status(400).json({ error: 'checkIn and checkOut are required.' });
    }
    if (!isIsoDate(checkInRaw) || !isIsoDate(checkOutRaw)) {
      return res.status(400).json({ error: 'checkIn and checkOut must be YYYY-MM-DD dates.' });
    }

    let requestedDates: string[];
    try {
      requestedDates = getStayDates(checkInRaw, checkOutRaw);
    } catch {
      return res.status(400).json({ error: 'Check-out must be after check-in.' });
    }

    const properties = await store.listProperties(false);
    const visible = properties.filter((property) => {
      if (property.archivedAt) {
        return false;
      }
      if (property.reviewStatus === 'pending_review' && !canViewPendingProperty(req.authUser, property.id)) {
        return false;
      }
      return true;
    });

    const results = await Promise.all(
      visible.map(async (property) => {
        const blocked = new Set(await getEffectiveBlockedDates(property, 'stale-ok'));
        const isFree = requestedDates.every((date) => !blocked.has(date));
        if (!isFree) {
          return null;
        }
        const rates = property.pricing?.rates ?? [];
        const minNightlyPrice = rates.length ? Math.min(...rates.map((rate) => rate.price)) : null;
        return { id: property.id, minNightlyPrice };
      }),
    );

    const available = results.filter((item): item is { id: string; minNightlyPrice: number | null } => item !== null);

    res.json({
      checkIn: checkInRaw,
      checkOut: checkOutRaw,
      nights: requestedDates.length,
      available,
    });
  });

  app.get('/api/properties/:id', async (req, res) => {
    const lang = toLanguageCode(req.query.lang);
    const property = await store.getProperty(req.params.id);
    const canReadArchived = property && property.archivedAt && req.authUser && canPerformAction(req.authUser, 'property.read', property.id);
    const canReadPending = property && property.reviewStatus === 'pending_review' && canViewPendingProperty(req.authUser, property.id);
    if (!property || (property.archivedAt && !canReadArchived) || (property.reviewStatus === 'pending_review' && !canReadPending)) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    res.json({ property: redactPropertyForViewer(applyPropertyLocalization(property, lang), req.authUser) });
  });

  app.get('/api/properties/:id/blocked-dates', async (req, res) => {
    const property = await store.getProperty(req.params.id);
    if (!property) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    const blockedDates = await getEffectiveBlockedDates(property, 'stale-ok');
    res.json({ blockedDates });
  });

  // Builds the absolute, token-guarded iCal export URL other platforms subscribe
  // to. Honors X-Forwarded-Proto (trust proxy is set) so it stays https behind
  // Railway's TLS termination.
  function buildIcalExportUrl(req: Request, propertyId: string, token: string): string {
    const host = req.get('host') ?? 'localhost';
    return `${req.protocol}://${host}/api/ical/${encodeURIComponent(propertyId)}/${token}.ics`;
  }

  // Host-scoped calendar view: manual blocks (editable), dates imported from
  // other platforms via iCal (read-only), direct bookings, the import feeds, and
  // this property's export URL.
  app.get('/api/properties/:id/calendar', requireAuth, requireHostOrAdmin, async (req, res) => {
    const property = await store.getProperty(getParam(req.params.id));
    if (!property) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    if (!canAccessProperty(req.authUser!, property.id)) {
      return res.status(403).json({ error: 'Not allowed for this property.' });
    }

    const manualBlockedDates = await store.listBlockedDates(property.id);
    const effective = await getEffectiveBlockedDates(property, 'fresh-if-stale');
    const heldDates = await store.listHeldDates(property.id);
    // "Imported" is what is left after removing the sources we can name.
    // Without subtracting held nights too, a night sold on our own site would
    // be mislabelled on the host calendar as coming from another platform.
    const accountedFor = new Set([...manualBlockedDates, ...heldDates]);
    const importedBlockedDates = effective.filter((date) => !accountedFor.has(date));

    // Online bookings are mirrored into booking_confirmations for the PDF and
    // accounting flows, but that mirror would double up with the same stay's
    // entry in directBookings below (different id, same dates) — only manual
    // (off-platform) confirmations belong in this list.
    const bookings = (await store.listBookingConfirmations({ propertyId: property.id }))
      .filter((b) => b.source === 'manual')
      .map((b) => ({
        id: b.id,
        guestName: b.guestName,
        checkInDate: b.checkInDate,
        checkOutDate: b.checkOutDate,
      }));

    const directBookings = (await store.listBookings({
      propertyId: property.id,
      statuses: ACTIVE_BOOKING_STATUSES,
    })).map((booking) => ({
      id: booking.id,
      status: booking.status,
      guestName: booking.guestName,
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      amountTotal: booking.amountTotal,
      currency: booking.currency,
    }));

    const importedEvents = await icalSync.getImportedEvents(property, 'fresh-if-stale');

    const token = await store.ensureIcalExportToken(property.id);

    res.json({
      propertyId: property.id,
      propertyName: property.name,
      manualBlockedDates,
      importedBlockedDates,
      importedEvents,
      bookings,
      directBookings,
      icalFeeds: property.icalFeeds ?? [],
      exportUrl: buildIcalExportUrl(req, property.id, token),
    });
  });

  // Adds manual calendar blocks. Body: { dates: string[] } (YYYY-MM-DD).
  app.post('/api/properties/:id/blocked-dates', requireAuth, requireHostOrAdmin, async (req, res) => {
    const property = await store.getProperty(getParam(req.params.id));
    if (!property) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    if (!canAccessProperty(req.authUser!, property.id)) {
      return res.status(403).json({ error: 'Not allowed for this property.' });
    }
    const rawDates = Array.isArray(req.body?.dates) ? req.body.dates : [];
    const dates = Array.from(new Set(rawDates.filter((d: unknown) => isIsoDate(d)))) as string[];
    if (!dates.length) {
      return res.status(400).json({ error: 'dates must be a non-empty array of YYYY-MM-DD values.' });
    }
    await store.addBlockedDates(property.id, dates);
    const manualBlockedDates = await store.listBlockedDates(property.id);
    res.json({ manualBlockedDates });
  });

  // Removes manual calendar blocks. Body: { dates: string[] } (YYYY-MM-DD).
  // Only affects manual blocks; dates imported from other platforms are ignored.
  app.delete('/api/properties/:id/blocked-dates', requireAuth, requireHostOrAdmin, async (req, res) => {
    const property = await store.getProperty(getParam(req.params.id));
    if (!property) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    if (!canAccessProperty(req.authUser!, property.id)) {
      return res.status(403).json({ error: 'Not allowed for this property.' });
    }
    const rawDates = Array.isArray(req.body?.dates) ? req.body.dates : [];
    const dates = Array.from(new Set(rawDates.filter((d: unknown) => isIsoDate(d)))) as string[];
    if (!dates.length) {
      return res.status(400).json({ error: 'dates must be a non-empty array of YYYY-MM-DD values.' });
    }
    await store.removeBlockedDates(property.id, dates);
    const manualBlockedDates = await store.listBlockedDates(property.id);
    res.json({ manualBlockedDates });
  });

  // Replaces the property's iCal import feeds. Body: { feeds: [{ id, name, url, lastSynced }] }.
  app.put('/api/properties/:id/ical-feeds', requireAuth, requireHostOrAdmin, async (req, res) => {
    const property = await store.getProperty(getParam(req.params.id));
    if (!property) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    if (!canAccessProperty(req.authUser!, property.id)) {
      return res.status(403).json({ error: 'Not allowed for this property.' });
    }
    const rawFeeds = Array.isArray(req.body?.feeds) ? req.body.feeds : [];
    const feeds = rawFeeds
      .map((feed: Record<string, unknown>) => ({
        id: typeof feed?.id === 'string' && feed.id.trim() ? feed.id : `feed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: normalizeText(feed?.name),
        url: normalizeText(feed?.url),
        lastSynced: typeof feed?.lastSynced === 'string' ? feed.lastSynced : '',
      }))
      .filter((feed: { url: string }) => feed.url.length > 0);
    const updated = await store.updateIcalFeeds(property.id, feeds, req.authUser!);
    res.json({ icalFeeds: updated.icalFeeds ?? [] });
  });

  // Rotates the export token, invalidating any previously shared export URL.
  app.post('/api/properties/:id/ical-export-token/regenerate', requireAuth, requireHostOrAdmin, async (req, res) => {
    const property = await store.getProperty(getParam(req.params.id));
    if (!property) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    if (!canAccessProperty(req.authUser!, property.id)) {
      return res.status(403).json({ error: 'Not allowed for this property.' });
    }
    const token = await store.regenerateIcalExportToken(property.id);
    res.json({ exportUrl: buildIcalExportUrl(req, property.id, token) });
  });

  // Unlike the per-property iCal export link (an API URL other software
  // fetches), this points at our own SPA page so a cleaning-staff phone can
  // open and read it — one token, every property.
  function buildCleaningCalendarUrl(token: string): string {
    return buildSiteUrl(publicSiteUrl, `/cleaning/${token}`);
  }

  app.get('/api/cleaning-calendar-link', requireAuth, requireHostOrAdmin, async (_req, res) => {
    const token = await store.ensureCleaningCalendarToken();
    res.json({ url: buildCleaningCalendarUrl(token) });
  });

  // Invalidates the previously shared link — anyone still using the old one
  // gets a 404 on the data endpoint below.
  app.post('/api/cleaning-calendar-link/regenerate', requireAuth, requireHostOrAdmin, async (_req, res) => {
    const token = await store.regenerateCleaningCalendarToken();
    res.json({ url: buildCleaningCalendarUrl(token) });
  });

  // Public, token-guarded schedule for cleaning staff: every property's
  // checkouts/check-ins in one place, from all three sources a stay can come
  // from (manual confirmations, our own paid direct bookings, and OTA
  // bookings synced in via iCal). No auth — the token in the path is the
  // credential, same model as the per-property iCal export. Deliberately
  // excludes guest names/contact details; only what cleaning staff need.
  app.get('/api/cleaning-calendar/:token', async (req, res) => {
    const providedToken = getParam(req.params.token);
    const expectedToken = await store.ensureCleaningCalendarToken();
    const expected = Buffer.from(expectedToken);
    const provided = Buffer.from(providedToken);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const defaultTo = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const from = isIsoDate(req.query.from) ? req.query.from : defaultFrom;
    const to = isIsoDate(req.query.to) ? req.query.to : defaultTo;

    const overlapsWindow = (checkInDate: string, checkOutDate: string) => checkOutDate >= from && checkInDate <= to;

    const stays: Array<{
      propertyId: string;
      propertyName: string;
      checkInDate: string;
      checkOutDate: string;
      checkInTime: string;
      checkOutTime: string;
      source: string;
      guestCount: number | null;
    }> = [];

    const properties = (await store.listProperties(false));
    for (const property of properties) {
      const manual = (await store.listBookingConfirmations({ propertyId: property.id }))
        .filter((b) => b.source === 'manual' && overlapsWindow(b.checkInDate, b.checkOutDate));
      for (const b of manual) {
        stays.push({
          propertyId: property.id,
          propertyName: property.name,
          checkInDate: b.checkInDate,
          checkOutDate: b.checkOutDate,
          checkInTime: b.checkInTime || '15:00',
          checkOutTime: b.checkOutTime || '10:00',
          source: 'Manual',
          guestCount: b.numGuests ?? null,
        });
      }

      const direct = (await store.listBookings({ propertyId: property.id, statuses: ['confirmed'] }))
        .filter((bk) => overlapsWindow(bk.checkInDate, bk.checkOutDate));
      for (const bk of direct) {
        stays.push({
          propertyId: property.id,
          propertyName: property.name,
          checkInDate: bk.checkInDate,
          checkOutDate: bk.checkOutDate,
          checkInTime: '15:00',
          checkOutTime: '10:00',
          source: 'Direct booking',
          guestCount: bk.adults + bk.children + bk.infants,
        });
      }

      const imported = (await icalSync.getImportedEvents(property, 'stale-ok'))
        .filter((ev) => overlapsWindow(ev.checkInDate, ev.checkOutDate));
      for (const ev of imported) {
        stays.push({
          propertyId: property.id,
          propertyName: property.name,
          checkInDate: ev.checkInDate,
          checkOutDate: ev.checkOutDate,
          checkInTime: '15:00',
          checkOutTime: '10:00',
          source: ev.channelName || ev.feedName,
          guestCount: ev.guestCount,
        });
      }
    }

    res.json({ stays });
  });

  // Public token-guarded iCal export consumed by other booking platforms. No
  // auth: the secret token in the path is the credential. Publishes manual
  // blocks + direct bookings only (imported dates are excluded to avoid loops).
  app.get('/api/ical/:propertyId/:token.ics', async (req, res) => {
    const property = await store.getProperty(getParam(req.params.propertyId));
    const providedToken = getParam(req.params.token);
    if (!property || !property.icalExportToken) {
      return res.status(404).type('text/plain').send('Not found');
    }
    const expected = Buffer.from(property.icalExportToken);
    const provided = Buffer.from(providedToken);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return res.status(404).type('text/plain').send('Not found');
    }

    const manualBlockedDates = await store.listBlockedDates(property.id);
    // Online bookings are mirrored into booking_confirmations too, but that
    // mirror would publish a second, duplicate VEVENT for the same stay
    // alongside the one built from directBookings below — only manual
    // (off-platform) confirmations belong in this list.
    const bookings = (await store.listBookingConfirmations({ propertyId: property.id }))
      .filter((b) => b.source === 'manual')
      .map((b) => ({
        id: b.id,
        guestName: b.guestName,
        checkInDate: b.checkInDate,
        checkOutDate: b.checkOutDate,
        numGuests: b.numGuests,
      }));

    // Confirmed direct bookings belong on the feed so other platforms stop
    // selling those nights. Unpaid holds are deliberately left off — a 35-minute
    // hold is not worth propagating to channels that cache the feed for hours.
    const directBookings = (await store.listBookings({
      propertyId: property.id,
      statuses: ['confirmed'],
    })).map((booking) => ({
      id: `direct-${booking.id}`,
      guestName: booking.guestName,
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      numGuests: booking.adults + booking.children + booking.infants,
    }));

    const ics = buildPropertyIcs({
      propertyId: property.id,
      propertyName: property.name,
      manualBlockedDates,
      bookings: [...bookings, ...directBookings],
    });

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${property.id}.ics"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.send(ics);
  });

  app.post('/api/properties', requireAdmin, async (req, res) => {
    const payload = req.body as PropertyData;
    if (typeof payload.address !== 'string' || !payload.address.trim()) {
      return res.status(400).json({ error: 'Address is required.' });
    }

    payload.address = payload.address.trim();
    const property = await store.createProperty(payload, req.authUser!);
    res.status(201).json({ property });
  });

  app.put('/api/properties/:id', requireAuth, async (req, res) => {
    const propertyId = getParam(req.params.id);
    const current = await store.getProperty(propertyId);
    if (!current) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    if (!canPerformAction(req.authUser!, 'property.write', current.id)) {
      return res.status(403).json({ error: 'Property write not allowed.' });
    }

    const payload = req.body as PropertyData;
    if (typeof payload.address !== 'string' || !payload.address.trim()) {
      return res.status(400).json({ error: 'Address is required.' });
    }
    payload.address = payload.address.trim();

    const requestedId = typeof payload.id === 'string' ? payload.id.trim() : '';
    const shouldRename = requestedId && requestedId !== current.id;
    if (shouldRename) {
      if (req.authUser!.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Only admin can change property id.' });
      }
      if (!/^[a-z0-9][a-z0-9-_]*$/.test(requestedId)) {
        return res.status(400).json({ error: 'Property id must use lowercase letters, numbers, dash, or underscore.' });
      }
      const property = await store.renameProperty(current.id, requestedId, payload, req.authUser!);
      return res.json({ property });
    }

    const property = await store.saveProperty(current.id, payload, req.authUser!);
    res.json({ property });
  });

  // Upload a property media image (gallery/room/host/manual). Compresses + converts
  // to AVIF and stores it in the public bucket, returning a stable public URL.
  app.post('/api/properties/:id/images', requireAuth, async (req, res) => {
    const propertyId = getParam(req.params.id);
    const current = await store.getProperty(propertyId);
    if (!current) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    if (!canPerformAction(req.authUser!, 'property.write', current.id)) {
      return res.status(403).json({ error: 'Property write not allowed.' });
    }

    const { imageBase64 } = req.body as { imageBase64?: string };
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required.' });
    }

    let base64Data = imageBase64;
    let mimeType = 'image/jpeg';
    const m = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (m) { mimeType = m[1]; base64Data = m[2]; }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      return res.status(400).json({ error: 'Only JPEG/PNG/WebP images are supported.' });
    }

    try {
      const rawBuffer = Buffer.from(base64Data, 'base64');
      const upload = await objectStorage.uploadPropertyImage({
        imageBuffer: rawBuffer,
        mimeType,
        propertyId: current.id,
      });
      return res.status(201).json({ url: upload.url });
    } catch (err) {
      console.error('[properties/images] upload failed:', err);
      const detail = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: `Failed to process image: ${detail}` });
    }
  });

  app.delete('/api/properties/:id', requireAuth, async (req, res) => {
    const propertyId = getParam(req.params.id);
    const current = await store.getProperty(propertyId);
    if (!current) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    if (!canPerformAction(req.authUser!, 'property.delete', current.id)) {
      return res.status(403).json({ error: 'Property delete not allowed.' });
    }

    await store.deleteProperty(current.id, req.authUser!);
    res.status(204).send();
  });

  app.patch('/api/properties/:id/archive', requireAuth, async (req, res) => {
    const propertyId = getParam(req.params.id);
    const archived = toBoolean(req.body?.archived);
    const current = await store.getProperty(propertyId);
    if (!current) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    if (archived === null) {
      return res.status(400).json({ error: 'Valid archived flag is required.' });
    }
    if (!canPerformAction(req.authUser!, 'property.delete', current.id)) {
      return res.status(403).json({ error: 'Property archive not allowed.' });
    }

    const property = await store.setPropertyArchived(current.id, archived, req.authUser!);
    res.json({ property });
  });

  app.patch('/api/properties/:id/review-status', requireAuth, requireHostOrAdmin, async (req, res) => {
    const propertyId = getParam(req.params.id);
    const current = await store.getProperty(propertyId);
    if (!current) {
      return res.status(404).json({ error: 'Property not found.' });
    }

    if (!canPerformAction(req.authUser!, 'property.read', current.id)) {
      return res.status(403).json({ error: 'Property review status update not allowed.' });
    }

    const reviewStatusRaw = req.body?.reviewStatus;
    if (reviewStatusRaw !== 'approved' && reviewStatusRaw !== 'pending_review') {
      return res.status(400).json({ error: 'reviewStatus must be "approved" or "pending_review".' });
    }

    const property = await store.saveProperty(current.id, {
      ...current,
      reviewStatus: reviewStatusRaw,
    }, req.authUser!);
    res.json({ property });
  });

  app.post('/api/properties/:id/translate-content', requireAuth, async (req, res) => {
    const propertyId = getParam(req.params.id);
    const current = await store.getProperty(propertyId);
    if (!current) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    if (!canPerformAction(req.authUser!, 'property.write', current.id)) {
      return res.status(403).json({ error: 'Property write not allowed.' });
    }
    if (req.authUser?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Only admins can auto-translate property content.' });
    }

    const { fieldName, fieldValue, targetLanguages, persist = true } = req.body ?? {};
    const langs = Array.isArray(targetLanguages)
      ? targetLanguages.filter((l): l is string => typeof l === 'string' && !!l.trim()).map((l) => l.trim().toLowerCase())
      : ['vi', 'ja', 'zh', 'ko'];

    if (langs.length === 0) {
      return res.status(400).json({ error: 'At least one target language is required.' });
    }

    // Backward-compatible mode: translate one free-text field without persisting.
    if (typeof fieldName === 'string' && fieldName.trim() && typeof fieldValue === 'string' && fieldValue.trim()) {
      const translations = await translationService.translateText(fieldValue, langs);
      return res.json({ translations, fieldName: fieldName.trim() });
    }

    const fields = buildTranslatableFields(current);
    if (fields.length === 0) {
      return res.status(400).json({ error: 'No translatable text fields found on this property.' });
    }

    const translatedByLanguage: Record<string, Record<string, string>> = {};
    for (const field of fields) {
      const translated = await translationService.translateText(field.value, langs);
      for (const lang of langs) {
        const text = translated[lang];
        if (!text) {
          continue;
        }
        translatedByLanguage[lang] = translatedByLanguage[lang] ?? {};
        translatedByLanguage[lang][field.path] = text;
      }
    }

    const nextTranslations = { ...(current.translations ?? {}) };
    for (const [lang, pathMap] of Object.entries(translatedByLanguage)) {
      const langPatch = (nextTranslations[lang] && typeof nextTranslations[lang] === 'object')
        ? { ...(nextTranslations[lang] as Record<string, unknown>) }
        : {};
      for (const [path, text] of Object.entries(pathMap)) {
        setPathValue(langPatch, path, text);
      }
      nextTranslations[lang] = langPatch as Partial<PropertyData>;
    }

    if (persist === false) {
      return res.json({ translations: translatedByLanguage });
    }

    const saved = await store.saveProperty(current.id, {
      ...current,
      translations: nextTranslations,
    }, req.authUser!);

    return res.json({
      property: saved,
      translatedLanguages: Object.keys(translatedByLanguage),
      translatedFieldCount: fields.length,
    });
  });

  app.get('/api/site-settings', async (_req, res) => {
    const settings = await store.getSiteSettings();
    res.json({ settings });
  });

  app.put('/api/site-settings', requireAdmin, async (req, res) => {
    const settings = await store.saveSiteSettings(req.body as SiteSettings, req.authUser!);
    res.json({ settings });
  });

  // --- Host subscription (Become Host) -------------------------------------
  // A signed-in user requests an upgrade plan; an admin approves it from the
  // Services page, which sets the user's host level. No payment gateway yet.

  app.post('/api/subscription-requests', requireAuth, async (req, res) => {
    const { planCode, billingCycle } = req.body ?? {};
    if (!isHostPlanCode(planCode)) {
      return res.status(400).json({ error: 'Valid plan code is required (basic, plus, pro).' });
    }
    if (!isBillingCycle(billingCycle)) {
      return res.status(400).json({ error: 'Valid billing cycle is required (monthly, yearly).' });
    }
    const request = await store.createSubscriptionRequest(req.authUser!.id, planCode, billingCycle);
    return res.status(201).json({ request });
  });

  app.get('/api/subscription-requests/mine', requireAuth, async (req, res) => {
    const requests = await store.listSubscriptionRequests({ userId: req.authUser!.id });
    return res.json({ requests });
  });

  app.get('/api/subscription-requests', requireAdmin, async (req, res) => {
    const statusRaw = req.query.status;
    const status = statusRaw === 'pending' || statusRaw === 'approved' || statusRaw === 'rejected' ? statusRaw : undefined;
    const requests = await store.listSubscriptionRequests(status ? { status } : undefined);
    return res.json({ requests });
  });

  app.post('/api/subscription-requests/:id/approve', requireAdmin, async (req, res) => {
    const id = getParam(req.params.id);
    const request = await store.getSubscriptionRequest(id);
    if (!request) {
      return res.status(404).json({ error: 'Subscription request not found.' });
    }
    // Approval grants the mapped host level. Promote a non-HOST user to HOST so
    // the level actually takes effect.
    const targetUser = await store.getUserById(request.userId);
    if (!targetUser) {
      return res.status(404).json({ error: 'Requesting user no longer exists.' });
    }
    if (targetUser.role !== 'HOST' && targetUser.role !== 'ADMIN') {
      await store.updateUserRole(request.userId, 'HOST', req.authUser!);
    }
    if (targetUser.role !== 'ADMIN') {
      await store.updateUserHostLevel(request.userId, PLAN_TO_HOST_LEVEL[request.planCode], req.authUser!);
    }
    const updated = await store.updateSubscriptionRequestStatus(id, 'approved', req.authUser!);
    return res.json({ request: updated });
  });

  app.post('/api/subscription-requests/:id/reject', requireAdmin, async (req, res) => {
    const id = getParam(req.params.id);
    const request = await store.getSubscriptionRequest(id);
    if (!request) {
      return res.status(404).json({ error: 'Subscription request not found.' });
    }
    const updated = await store.updateSubscriptionRequestStatus(id, 'rejected', req.authUser!);
    return res.json({ request: updated });
  });

  app.get('/api/blog-posts', async (req, res) => {
    const includeArchived = req.query.includeArchived === 'true' && !!req.authUser && canPerformAction(req.authUser, 'blog.write');
    const posts = await store.listBlogPosts(includeArchived);
    res.json({ posts });
  });

  app.get('/api/blog-posts/:id', async (req, res) => {
    const post = await store.getBlogPost(req.params.id);
    const canReadArchived = post && post.archivedAt && req.authUser && canPerformAction(req.authUser, 'blog.write');
    if (!post || (post.archivedAt && !canReadArchived)) {
      return res.status(404).json({ error: 'Blog post not found.' });
    }
    res.json({ post });
  });

  app.post('/api/blog-posts', requireAuth, async (req, res) => {
    if (!canPerformAction(req.authUser!, 'blog.write')) {
      return res.status(403).json({ error: 'Blog write not allowed.' });
    }
    const payload = req.body as Omit<BlogPost, 'createdAt' | 'updatedAt'>;
    const post = await store.createBlogPost({ ...payload, authorId: req.authUser!.id }, req.authUser!);
    res.status(201).json({ post });
  });

  app.put('/api/blog-posts/:id', requireAuth, async (req, res) => {
    const postId = getParam(req.params.id);
    const current = await store.getBlogPost(postId);
    if (!current) {
      return res.status(404).json({ error: 'Blog post not found.' });
    }
    if (!canPerformAction(req.authUser!, 'blog.write')) {
      return res.status(403).json({ error: 'Blog update not allowed.' });
    }
    const post = await store.updateBlogPost(postId, req.body, req.authUser!);
    res.json({ post });
  });

  app.delete('/api/blog-posts/:id', requireAuth, async (req, res) => {
    const postId = getParam(req.params.id);
    const current = await store.getBlogPost(postId);
    if (!current) {
      return res.status(404).json({ error: 'Blog post not found.' });
    }
    if (!canPerformAction(req.authUser!, 'blog.write')) {
      return res.status(403).json({ error: 'Blog delete not allowed.' });
    }
    await store.deleteBlogPost(postId, req.authUser!);
    res.status(204).send();
  });

  app.patch('/api/blog-posts/:id/archive', requireAuth, async (req, res) => {
    const postId = getParam(req.params.id);
    const archived = toBoolean(req.body?.archived);
    const current = await store.getBlogPost(postId);
    if (!current) {
      return res.status(404).json({ error: 'Blog post not found.' });
    }
    if (archived === null) {
      return res.status(400).json({ error: 'Valid archived flag is required.' });
    }
    if (!canPerformAction(req.authUser!, 'blog.write')) {
      return res.status(403).json({ error: 'Blog archive not allowed.' });
    }

    const post = await store.setBlogPostArchived(postId, archived, req.authUser!);
    res.json({ post });
  });

  app.post('/api/properties/:propertyId/hosts/:hostUserId', requireAdmin, async (req, res) => {
    await store.assignHost(getParam(req.params.propertyId), Number(getParam(req.params.hostUserId)), req.authUser!);
    res.status(204).send();
  });

  app.delete('/api/properties/:propertyId/hosts/:hostUserId', requireAdmin, async (req, res) => {
    await store.unassignHost(getParam(req.params.propertyId), Number(getParam(req.params.hostUserId)), req.authUser!);
    res.status(204).send();
  });

  app.post('/api/quotes', async (req, res) => {
    const { propertyId, ...quoteInput } = req.body ?? {};
    const property = propertyId ? await store.getProperty(propertyId) : null;
    if (!property) {
      return res.status(404).json({ error: 'Property not found.' });
    }

    const blockedDates = await getEffectiveBlockedDates(property, 'fresh-if-stale');
    const blockedSet = new Set(blockedDates);
    let requestedDates: string[] = [];
    try {
      requestedDates = getStayDates(quoteInput.checkIn, quoteInput.checkOut);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid quote date range.';
      return res.status(400).json({ error: message });
    }
    const conflicts = requestedDates.filter((date) => blockedSet.has(date));
    if (conflicts.length > 0) {
      return res.status(409).json({
        error: 'Selected dates are not available.',
        blockedDates: conflicts,
      });
    }

    const quote = calculateQuote(property.pricing, quoteInput);
    res.json({ quote });
  });

  // ---------------------------------------------------------------------------
  // Direct bookings
  // ---------------------------------------------------------------------------

  // What the guest is allowed to see about their own booking. `guestToken` is
  // deliberately absent: it is the credential, not part of the record.
  async function toGuestBookingView(booking: Booking) {
    const property = await store.getProperty(booking.propertyId);
    const freeCancellationDays = property ? resolveFreeCancellationDays(property) : FREE_CANCELLATION_DAYS;
    return {
      id: booking.id,
      confirmationNo: booking.confirmationNo,
      propertyId: booking.propertyId,
      status: booking.status,
      guestName: booking.guestName,
      guestEmail: booking.guestEmail,
      adults: booking.adults,
      children: booking.children,
      infants: booking.infants,
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      nights: booking.nights,
      currency: booking.currency,
      amountTotal: booking.amountTotal,
      quote: booking.quote,
      holdExpiresAt: booking.holdExpiresAt,
      refundAmount: booking.refundAmount,
      cancelledAt: booking.cancelledAt,
      // So the cancellation screen can state the amount before the guest
      // commits, rather than surprising them after the fact.
      refundIfCancelledNow: calculateRefund(booking, Date.now(), { freeCancellationDays }).refundAmount,
      freeCancellationDays,
      emailUpdateCount: booking.emailUpdateCount,
      createdAt: booking.createdAt,
    };
  }

  // Reads the booking named in the URL and checks the guest's token against it.
  // Any failure is reported as 404 so the endpoint cannot be used to discover
  // which booking ids exist.
  async function loadBookingForGuest(idParam: string, tokenParam: unknown): Promise<Booking | null> {
    const token = typeof tokenParam === 'string' ? tokenParam : '';
    const booking = await store.getBooking(idParam);
    if (!booking || !token) {
      return null;
    }
    const expected = Buffer.from(booking.guestToken);
    const provided = Buffer.from(token);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return null;
    }
    return booking;
  }

  async function buildBookingEmailContext(booking: Booking): Promise<BookingEmailContext | null> {
    const property = await store.getProperty(booking.propertyId);
    if (!property) {
      return null;
    }
    // The public site routes properties by metalink, so links must use it
    // rather than the internal id.
    const slug = property.metalink || property.id;
    return {
      booking,
      propertyName: property.name,
      propertyAddress: property.address,
      manageUrl: buildSiteUrl(publicSiteUrl, `/booking/result?id=${encodeURIComponent(booking.id)}`
        + `&token=${encodeURIComponent(booking.guestToken)}`),
      pdfUrl: buildSiteUrl(publicSiteUrl, `/booking/result?id=${encodeURIComponent(booking.id)}`
        + `&token=${encodeURIComponent(booking.guestToken)}&downloadPdf=1`),
      // Carries the confirmation number so the check-in form can pre-fill and
      // auto-match it. The generic per-property link a host copies from the
      // Check-in link picker has no such param and skips this gate entirely.
      checkInUrl: buildSiteUrl(publicSiteUrl, `/${encodeURIComponent(slug)}/checkin`
        + (booking.confirmationNo ? `?bk=${encodeURIComponent(booking.confirmationNo)}` : '')),
      freeCancellationDays: resolveFreeCancellationDays(property),
      };
  }

  // Mirrors a confirmed online booking into the same table the host uses for
  // off-platform confirmations, so revenue/accounting/PDF export work from one
  // place no matter how the booking was taken. Guarded by sourceBookingId so a
  // Stripe webhook redelivery — already a no-op earlier in confirmPaidBooking —
  // can never create a second row.
  async function syncBookingConfirmationForBooking(booking: Booking): Promise<void> {
    try {
      const existing = await store.getBookingConfirmationBySourceBookingId(booking.id);
      if (existing) {
        return;
      }
      const property = await store.getProperty(booking.propertyId);
      if (!property) {
        return;
      }
      const slug = property.metalink || property.id;
      const quote = booking.quote;
      await store.createBookingConfirmation({
        // Reuse the number already emailed to the guest and embedded in
        // their check-in link — generating a new one here would silently
        // break that link's booking-ID match.
        confirmationNo: booking.confirmationNo,
        propertyId: property.id,
        propertyName: property.name,
        propertyAddress: property.address,
        propertyUrl: buildSiteUrl(publicSiteUrl, `/${encodeURIComponent(slug)}`),
        guestName: booking.guestName,
        guestEmail: booking.guestEmail,
        guestPhone: booking.guestPhone,
        numGuests: booking.adults + booking.children + booking.infants,
        checkInDate: booking.checkInDate,
        checkOutDate: booking.checkOutDate,
        checkInTime: '15:00',
        checkOutTime: '10:00',
        currency: booking.currency,
        roomFee: quote.adultTotal + quote.childTotal,
        cleaningFee: quote.cleaningFee,
        extraFee: 0,
        discountLabel: quote.longStayDiscount > 0 ? 'Long-stay discount' : undefined,
        discountAmount: quote.longStayDiscount,
        totalAmount: booking.amountTotal,
        depositAmount: booking.amountTotal,
        balanceDue: 0,
        freeCancellationDays: resolveFreeCancellationDays(property),
        includeInAccounting: true,
        source: 'online',
        sourceBookingId: booking.id,
        createdByUserId: 0,
        createdByName: 'Online booking (Stripe)',
      });
    } catch (error) {
      // The Booking row is the source of truth; a failure here can be
      // reconciled later and must not affect the booking itself.
      console.error(`Booking ${booking.id}: could not create its accounting confirmation.`, error);
    }
  }

  // Refunded means no real revenue was kept, so the mirrored confirmation is
  // removed; a late cancellation that keeps the money (D4) leaves it in place,
  // just annotated, since it is still earned revenue.
  async function syncBookingConfirmationOnCancel(booking: Booking, refundedAmount: number): Promise<void> {
    try {
      const existing = await store.getBookingConfirmationBySourceBookingId(booking.id);
      if (!existing) {
        return;
      }
      if (refundedAmount > 0) {
        await store.deleteBookingConfirmation(existing.id);
        return;
      }
      const note = 'Guest cancelled — no refund (past the free-cancellation window).';
      const notes = existing.notes ? `${existing.notes}\n${note}` : note;
      await store.updateBookingConfirmation(existing.id, { notes });
    } catch (error) {
      console.error(`Booking ${booking.id}: could not update its accounting confirmation after cancellation.`, error);
    }
  }

  async function hostRecipientFor(propertyId: string): Promise<string> {
    const property = await store.getProperty(propertyId);
    return (property?.adminEmail || hostMailFallback).trim();
  }

  // Mail is best-effort on purpose. A booking that is paid for and confirmed
  // must not be reported as failed because an SMTP server was unreachable, so
  // every failure here is logged and swallowed.
  async function sendBookingEmails(
    booking: Booking,
    kind: 'confirmed' | 'cancelled',
    refundAmount = 0,
  ): Promise<void> {
    try {
      const context = await buildBookingEmailContext(booking);
      if (!context) {
        console.error(`Cannot send ${kind} mail for booking ${booking.id}: property is missing.`);
        return;
      }

      const guestMail = kind === 'confirmed'
        ? buildGuestConfirmationEmail(context)
        : buildGuestCancellationEmail(context, refundAmount);
      const hostTo = await hostRecipientFor(booking.propertyId);

      const deliveries: Array<Promise<void>> = [
        mailer.send({ ...guestMail, to: booking.guestEmail }),
      ];
      if (hostTo) {
        const hostMail = kind === 'confirmed'
          ? buildHostConfirmationEmail(context, hostMailLocale)
          : buildHostCancellationEmail(context, refundAmount, hostMailLocale);
        // Replying to the host notification should reach the guest directly.
        deliveries.push(mailer.send({ ...hostMail, to: hostTo, replyTo: booking.guestEmail }));
      }

      // One failed recipient must not stop the other from being told.
      const results = await Promise.allSettled(deliveries);
      for (const result of results) {
        if (result.status === 'rejected') {
          console.error(`Booking ${booking.id}: ${kind} mail failed.`, result.reason);
        }
      }
    } catch (error) {
      console.error(`Booking ${booking.id}: could not prepare ${kind} mail.`, error);
    }
  }

  // Re-sends the confirmation to the guest only — used after the guest fixes
  // a mistyped email themselves. The host already got their one notification
  // when the booking was first confirmed and does not need another for a
  // guest-side typo fix.
  async function sendGuestConfirmationEmailOnly(booking: Booking): Promise<void> {
    try {
      const context = await buildBookingEmailContext(booking);
      if (!context) {
        console.error(`Cannot send corrected-email mail for booking ${booking.id}: property is missing.`);
        return;
      }
      await mailer.send({ ...buildGuestConfirmationEmail(context), to: booking.guestEmail });
    } catch (error) {
      console.error(`Booking ${booking.id}: could not send mail to the corrected email.`, error);
    }
  }

  // The message itself never depends on how the recipient's email was
  // resolved, so both the booking-matched and generic check-in paths share it.
  async function sendCheckInWelcomeEmailTo(property: PropertyData & { id: string }, email: string, locale: string): Promise<void> {
    const slug = property.metalink || property.id;
    const mail = buildCheckInWelcomeEmail({
      propertyName: property.name,
      propertyAddress: property.address,
      checkInInfo: property.checkInInfo ?? {},
      manualUrl: buildSiteUrl(publicSiteUrl, `/${encodeURIComponent(slug)}/manual`),
      rulesUrl: buildSiteUrl(publicSiteUrl, `/${encodeURIComponent(slug)}/rules`),
      locale,
    });
    await mailer.send({ ...mail, to: email });
  }

  // Wraps sendCheckInWelcomeEmailTo so a mail-server failure on one recipient
  // never blocks the other, and the caller can report back exactly which
  // addresses actually received the mail.
  async function trySendCheckInWelcomeEmailTo(property: PropertyData & { id: string }, email: string, locale: string): Promise<string | null> {
    try {
      await sendCheckInWelcomeEmailTo(property, email, locale);
      return email;
    } catch (error) {
      console.error(`Check-in at ${property.id}: could not send the welcome email to ${email}.`, error);
      return null;
    }
  }

  // Sent once, right after a guest submits the check-in form reached via a
  // booking-specific link. Always goes to the email on file for the booking
  // (the one used at payment/manual-entry time); if the guest also typed a
  // different address into the check-in form itself, that address gets its
  // own copy too, since either inbox might be the one they actually check.
  // Returns the address(es) that actually received the mail.
  async function sendCheckInWelcomeEmail(property: PropertyData & { id: string }, bk: string, locale: string, extraEmail?: string): Promise<string[]> {
    try {
      const confirmation = await store.getBookingConfirmationByNo(property.id, bk);
      if (!confirmation?.guestEmail) {
        return [];
      }
      if (isCheckInLinkExpired(confirmation.checkOutDate, Date.now())) {
        console.warn(`Check-in link for booking ${bk} has expired (checked out ${confirmation.checkOutDate}); skipping the welcome email.`);
        return [];
      }
      const targets = [confirmation.guestEmail];
      const normalizedExtra = extraEmail?.trim();
      if (normalizedExtra && normalizedExtra.toLowerCase() !== confirmation.guestEmail.trim().toLowerCase()) {
        targets.push(normalizedExtra);
      }
      const sent = await Promise.all(targets.map((email) => trySendCheckInWelcomeEmailTo(property, email, locale)));
      return sent.filter((email): email is string => email !== null);
    } catch (error) {
      console.error(`Check-in for booking ${bk}: could not send the welcome email.`, error);
      return [];
    }
  }

  type CancelOutcome =
    | { ok: true; booking: Booking; refundAmount: number }
    | { ok: false; status: number; error: string };

  // Cancels a booking and refunds whatever the policy allows. Guests get the
  // amount minus Stripe's processing fee when they cancel at least a week out
  // and nothing after that; a host cancelling always refunds in full.
  async function cancelBooking(
    booking: Booking,
    // skipRefund: bypasses the Stripe refund call entirely instead of failing
    // the cancellation when it errors. For bookings whose payment intent can
    // never be refunded through Stripe any more — e.g. one created under a
    // test-mode key that no longer resolves after switching to a live key —
    // there is no automatic refund path, so an admin explicitly vouches that
    // either nothing is owed or it was already handled outside Stripe.
    options: { byHost: boolean; reason: string; skipRefund?: boolean },
  ): Promise<CancelOutcome> {
    const nextStatus: BookingStatus = options.byHost ? 'cancelled_by_host' : 'cancelled_by_guest';
    if (!canTransition(booking.status, nextStatus)) {
      return { ok: false, status: 409, error: `A booking in status "${booking.status}" cannot be cancelled.` };
    }

    let stripeFeeAmount = booking.stripeFeeAmount;
    let refunded = 0;

    if (!options.skipRefund) {
      // The fee is normally captured at confirm time, but Stripe occasionally
      // hasn't finished computing the charge's balance_transaction the instant
      // the checkout.session.completed webhook fires, so getChargeFee silently
      // returns 0 with no error to log. A real ¥0 fee is not realistic for a
      // card charge, so treat a stored 0 as "unknown" and re-check here. This
      // matters for a guest cancellation (it is deducted from their refund) and
      // for a host cancellation too, since the host-cancellation email reports
      // this fee as the amount the host is absorbing.
      if (stripeFeeAmount === 0 && booking.stripePaymentIntentId) {
        try {
          stripeFeeAmount = await payments.getChargeFee(booking.stripePaymentIntentId);
        } catch (error) {
          console.error(`Could not re-check the Stripe fee for booking ${booking.id} at cancellation time.`, error);
        }
      }

      const property = await store.getProperty(booking.propertyId);
      const freeCancellationDays = property ? resolveFreeCancellationDays(property) : FREE_CANCELLATION_DAYS;
      const outcome = calculateRefund({ ...booking, stripeFeeAmount }, Date.now(), {
        byHost: options.byHost,
        freeCancellationDays,
      });

      // Money moves before the room is released. The reverse order risks leaving
      // the guest with neither their stay nor their refund if Stripe fails.
      if (outcome.refundAmount > 0 && booking.stripePaymentIntentId) {
        try {
          const refund = await payments.createRefund(booking.stripePaymentIntentId, outcome.refundAmount);
          refunded = refund.amount;
        } catch (error) {
          console.error(`Refund failed for booking ${booking.id}; it stays confirmed.`, error);
          return { ok: false, status: 502, error: 'Refund could not be processed. The booking was not cancelled.' };
        }
      }
    }

    const updated = await store.updateBooking(booking.id, {
      status: nextStatus,
      cancelledAt: Date.now(),
      cancelReason: options.reason,
      refundAmount: booking.refundAmount + refunded,
      holdExpiresAt: null,
      stripeFeeAmount,
    });

    if (!updated) {
      // The refund already went through, so this must not look like a success.
      console.error(`Booking ${booking.id} was refunded ${refunded} but could not be marked cancelled.`);
      return { ok: false, status: 500, error: 'Booking was refunded but could not be updated. Contact support.' };
    }

    // Only a booking that was actually paid for warrants a cancellation notice;
    // an abandoned hold quietly lapsing is not news to anyone.
    if (booking.status === 'confirmed') {
      await sendBookingEmails(updated, 'cancelled', refunded);
      await syncBookingConfirmationOnCancel(updated, refunded);
    }

    return { ok: true, booking: updated, refundAmount: refunded };
  }

  // Creates a booking and claims the nights. Payment is wired up separately;
  // until then the booking stays `pending_payment` and the sweeper releases it.
  app.post('/api/bookings', async (req, res) => {
    if (!enforceBookingRateLimit(getClientIp(req))) {
      return res.status(429).json({ error: 'Too many booking attempts. Please try again later.' });
    }

    const body = req.body ?? {};
    const property = body.propertyId ? await store.getProperty(String(body.propertyId)) : null;
    if (!property || property.archivedAt || property.reviewStatus === 'pending_review') {
      return res.status(404).json({ error: 'Property not found.' });
    }
    if (!isDirectBookingEnabled(property)) {
      return res.status(403).json({ error: 'This property does not accept online bookings.' });
    }

    const guestName = normalizeText(body.guestName);
    const guestEmail = normalizeText(body.guestEmail).toLowerCase();
    if (!guestName) {
      return res.status(400).json({ error: 'guestName is required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) {
      return res.status(400).json({ error: 'A valid guestEmail is required.' });
    }

    const checkInDate = normalizeText(body.checkInDate);
    const checkOutDate = normalizeText(body.checkOutDate);
    if (!isIsoDate(checkInDate) || !isIsoDate(checkOutDate)) {
      return res.status(400).json({ error: 'checkInDate/checkOutDate must be YYYY-MM-DD.' });
    }

    const adults = toNonNegativeInt(body.adults);
    const children = toNonNegativeInt(body.children ?? 0);
    const infants = toNonNegativeInt(body.infants ?? 0);
    if (adults === null || children === null || infants === null || adults < 1) {
      return res.status(400).json({ error: 'adults must be at least 1 and guest counts must be whole numbers.' });
    }

    const window = validateBookingWindow(property, checkInDate, checkOutDate, Date.now());
    if (!window.ok) {
      return res.status(400).json({ error: window.error });
    }

    // The price is always recomputed here — a client-supplied total is never
    // trusted, and the result is snapshotted onto the booking.
    let quote;
    try {
      quote = calculateQuote(property.pricing, {
        checkIn: checkInDate,
        checkOut: checkOutDate,
        adults,
        children,
        infants,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to price this stay.';
      return res.status(400).json({ error: message });
    }

    // Cheap pre-check so an obviously unavailable range fails before we write.
    // It is not the safety net — createBookingWithHold is.
    const blockedSet = new Set(await getEffectiveBlockedDates(property, 'fresh-if-stale'));
    const conflicts = getStayDates(checkInDate, checkOutDate).filter((date) => blockedSet.has(date));
    if (conflicts.length > 0) {
      return res.status(409).json({ error: 'Selected dates are not available.', conflictDates: conflicts });
    }

    const result = await store.createBookingWithHold({
      propertyId: property.id,
      guestName,
      guestEmail,
      guestPhone: normalizeText(body.guestPhone) || undefined,
      adults,
      children,
      infants,
      checkInDate,
      checkOutDate,
      nights: window.nights,
      currency: 'JPY',
      amountTotal: quote.total,
      quote,
      holdExpiresAt: Date.now() + bookingHoldMs,
      locale: toLanguageCode(body.locale) ?? 'ja',
    });

    if (!result.ok) {
      return res.status(409).json({ error: 'Selected dates are not available.', conflictDates: result.conflictDates });
    }

    const booking = result.booking;

    // From here the nights are already claimed, so any failure must release them
    // rather than leave a hold nobody can pay for.
    let checkout;
    try {
      checkout = await payments.createCheckoutSession({
        booking,
        propertyName: property.name,
        successUrl: buildSiteUrl(publicSiteUrl, `/booking/result?id=${booking.id}&token=${booking.guestToken}`),
        cancelUrl: buildSiteUrl(publicSiteUrl, `/booking/cancelled?id=${booking.id}`),
        // Stripe rejects an expiry under 30 minutes; the internal hold is longer
        // so the session always dies first.
        expiresAt: Math.floor(Date.now() / 1000) + 30 * 60,
      });
    } catch (error) {
      await store.updateBooking(booking.id, {
        status: 'payment_failed',
        cancelReason: 'checkout_session_failed',
        holdExpiresAt: null,
      });
      console.error('Failed to create Stripe Checkout session.', error);
      return res.status(502).json({ error: 'Unable to start payment. Please try again.' });
    }

    const withSession = await store.updateBooking(booking.id, { stripeSessionId: checkout.id });

    return res.status(201).json({
      booking: await toGuestBookingView(withSession ?? booking),
      guestToken: booking.guestToken,
      checkoutUrl: checkout.url,
    });
  });

  // Guest-facing lookup. The token in the query string is the only credential,
  // so it is compared in constant time like the iCal export token.
  app.get('/api/bookings/:id', async (req, res) => {
    const booking = await loadBookingForGuest(getParam(req.params.id), req.query.token);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    return res.json({ booking: await toGuestBookingView(booking) });
  });

  // Backs the "Download PDF" button on the confirmation email and result page.
  // The PDF itself is rendered client-side (same code the host uses for manual
  // confirmations), so this just hands the guest the same BookingConfirmation
  // row the online-booking flow already mirrors on payment (see
  // syncBookingConfirmationForBooking) — same auth as the booking lookup above.
  app.get('/api/bookings/:id/confirmation', async (req, res) => {
    const booking = await loadBookingForGuest(getParam(req.params.id), req.query.token);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    const confirmation = await store.getBookingConfirmationBySourceBookingId(booking.id);
    if (!confirmation) {
      return res.status(404).json({ error: 'No confirmation record for this booking yet.' });
    }
    return res.json({ confirmation });
  });

  // Guest self-service cancellation, authorised by the same token as the lookup.
  app.post('/api/bookings/:id/cancel', async (req, res) => {
    const booking = await loadBookingForGuest(getParam(req.params.id), req.query.token ?? req.body?.token);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const result = await cancelBooking(booking, { byHost: false, reason: 'guest_requested' });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.json({
      booking: await toGuestBookingView(result.booking),
      refundAmount: result.refundAmount,
    });
  });

  // Releases the hold the moment a guest backs out of Stripe Checkout, instead
  // of making the nights wait out the full hold window. Stripe redirects the
  // browser to cancelUrl in that case, which is the only signal we ever get —
  // a guest who just closes the tab produces no request at all, and that case
  // still falls back to the hold's own expiry. A no-op (not an error) if the
  // booking already moved on, since the guest's browser can call this more
  // than once (e.g. a retry) or after the sweeper already released it.
  app.post('/api/bookings/:id/abandon', async (req, res) => {
    const booking = await loadBookingForGuest(getParam(req.params.id), req.query.token ?? req.body?.token);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    if (booking.status === 'pending_payment') {
      await store.updateBooking(booking.id, { status: 'expired', holdExpiresAt: null });
    }
    return res.json({ ok: true });
  });

  // Lets a guest fix a mistyped email on the booking result page and get the
  // confirmation resent there. Capped per booking (not per IP) so this can't
  // be used as an open relay to spam an arbitrary address — a guest with a
  // valid token already has one legitimate booking to send to.
  const MAX_GUEST_EMAIL_UPDATES = 3;
  app.post('/api/bookings/:id/email', async (req, res) => {
    const booking = await loadBookingForGuest(getParam(req.params.id), req.query.token ?? req.body?.token);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    if (booking.status !== 'confirmed') {
      return res.status(409).json({ error: `Only a confirmed booking's email can be corrected (this one is ${booking.status}).` });
    }
    if (booking.emailUpdateCount >= MAX_GUEST_EMAIL_UPDATES) {
      return res.status(429).json({ error: 'This booking has reached the limit for changing its email. Contact the host for help.' });
    }

    const email = normalizeText(req.body?.email).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    const updated = await store.updateBooking(booking.id, {
      guestEmail: email,
      emailUpdateCount: booking.emailUpdateCount + 1,
    });
    if (!updated) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    // Keeps the Direct booking revenue mirror showing the same address.
    const mirrored = await store.getBookingConfirmationBySourceBookingId(updated.id);
    if (mirrored) {
      await store.updateBookingConfirmation(mirrored.id, { guestEmail: email });
    }

    await sendGuestConfirmationEmailOnly(updated);

    return res.json({ booking: await toGuestBookingView(updated), sentTo: email });
  });

  // Mail delivery is best-effort, so a confirmed booking can exist with no
  // confirmation ever reaching the guest. This is how that gets put right
  // without touching the payment.
  app.post('/api/bookings/:id/resend-confirmation', requireAuth, requireHostOrAdmin, async (req, res) => {
    const booking = await store.getBooking(getParam(req.params.id));
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    if (!canAccessProperty(req.authUser!, booking.propertyId)) {
      return res.status(403).json({ error: 'Not allowed for this property.' });
    }
    if (booking.status !== 'confirmed') {
      return res.status(409).json({ error: `Only a confirmed booking has a confirmation to resend (this one is ${booking.status}).` });
    }

    await sendBookingEmails(booking, 'confirmed');
    return res.json({ sent: true, to: booking.guestEmail });
  });

  // Host/admin cancellation. Always refunds in full: the guest is losing a stay
  // they did nothing wrong to lose, so we absorb the processing fee.
  app.post('/api/bookings/:id/cancel-by-host', requireAuth, requireHostOrAdmin, async (req, res) => {
    const booking = await store.getBooking(getParam(req.params.id));
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }
    if (!canAccessProperty(req.authUser!, booking.propertyId)) {
      return res.status(403).json({ error: 'Not allowed for this property.' });
    }

    const reason = normalizeText(req.body?.reason) || 'host_cancelled';
    const result = await cancelBooking(booking, { byHost: true, reason });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    const { guestToken, ...safe } = result.booking;
    return res.json({ booking: safe, refundAmount: result.refundAmount });
  });

  // Admin-only escape hatch for a booking whose refund can never go through
  // Stripe automatically — most commonly a booking created under a test-mode
  // secret key whose payment intent no longer resolves once the account
  // switches to a live key, but also useful if a guest was already refunded
  // by other means. Skips the Stripe call entirely rather than erroring like
  // cancel-by-host does; the admin is vouching that no further refund is owed
  // through this system.
  app.post('/api/bookings/:id/force-cancel', requireAuth, requireAdmin, async (req, res) => {
    const booking = await store.getBooking(getParam(req.params.id));
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const reason = normalizeText(req.body?.reason) || 'admin_force_cancelled_no_refund';
    const result = await cancelBooking(booking, { byHost: true, reason, skipRefund: true });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    const { guestToken, ...safe } = result.booking;
    return res.json({ booking: safe, refundAmount: result.refundAmount });
  });

  // Host/admin listing, scoped to the properties the actor may see.
  app.get('/api/bookings', requireAuth, requireHostOrAdmin, async (req, res) => {
    const actor = req.authUser!;
    const propertyIdRaw = req.query.propertyId;
    const propertyId = typeof propertyIdRaw === 'string' && propertyIdRaw ? propertyIdRaw : undefined;

    if (propertyId && !canAccessProperty(actor, propertyId)) {
      return res.status(403).json({ error: 'Not allowed for this property.' });
    }

    const filters: BookingListFilters = {};
    if (propertyId) {
      filters.propertyId = propertyId;
    } else if (actor.role !== 'ADMIN') {
      filters.propertyIds = actor.assignedPropertyIds;
    }
    if (typeof req.query.fromDate === 'string' && isIsoDate(req.query.fromDate)) {
      filters.fromDate = req.query.fromDate;
    }
    if (typeof req.query.toDate === 'string' && isIsoDate(req.query.toDate)) {
      filters.toDate = req.query.toDate;
    }
    const statusRaw = req.query.status;
    if (typeof statusRaw === 'string' && statusRaw) {
      filters.statuses = statusRaw.split(',').filter((value): value is BookingStatus => (
        BOOKING_STATUSES.includes(value as BookingStatus)
      ));
    }

    const bookings = (await store.listBookings(filters)).map(({ guestToken, ...rest }) => rest);
    return res.json({ bookings });
  });

  // Confirms a paid booking. Everything here is guarded by canTransition, so a
  // webhook that arrives after the sweeper released the hold is a no-op instead
  // of re-selling nights that are already back on the market.
  async function confirmPaidBooking(bookingId: string, paymentIntentId: string | undefined): Promise<void> {
    const booking = await store.getBooking(bookingId);
    if (!booking) {
      console.warn(`Stripe webhook referenced unknown booking ${bookingId}.`);
      return;
    }
    if (booking.status === 'confirmed') {
      return;
    }
    if (!canTransition(booking.status, 'confirmed')) {
      // The guest paid for nights we no longer hold. Refunding is a judgement
      // call, so this is surfaced loudly rather than handled silently.
      console.error(
        `Payment received for booking ${bookingId} in status ${booking.status}; manual review required.`,
      );
      return;
    }

    // The real fee is read back from Stripe rather than assumed, because it is
    // what gets deducted from a later refund.
    let stripeFeeAmount = 0;
    if (paymentIntentId) {
      try {
        stripeFeeAmount = await payments.getChargeFee(paymentIntentId);
      } catch (error) {
        console.error(`Could not read the Stripe fee for booking ${bookingId}.`, error);
      }
    }

    const confirmed = await store.updateBooking(bookingId, {
      status: 'confirmed',
      confirmationNo: generateConfirmationNo(Date.now()),
      stripePaymentIntentId: paymentIntentId,
      stripeFeeAmount,
      holdExpiresAt: null,
      confirmedAt: Date.now(),
    });

    if (confirmed) {
      // The event id is recorded before this runs, so a Stripe redelivery is
      // dropped earlier and the guest is never emailed twice.
      await sendBookingEmails(confirmed, 'confirmed');
      await syncBookingConfirmationForBooking(confirmed);
    }
  }

  async function releaseUnpaidBooking(bookingId: string, status: BookingStatus, reason: string): Promise<void> {
    const booking = await store.getBooking(bookingId);
    if (!booking || !canTransition(booking.status, status)) {
      return;
    }
    await store.updateBooking(bookingId, { status, cancelReason: reason, holdExpiresAt: null });
  }

  // Stripe is the only thing allowed to mark a booking paid — the guest's
  // browser returning to success_url proves nothing, since anyone can visit it.
  app.post(STRIPE_WEBHOOK_PATH, async (req, res) => {
    const signature = req.get('stripe-signature');
    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature header.' });
    }

    let event;
    try {
      event = payments.constructEvent(req.body as Buffer, signature);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid signature.';
      console.warn(`Rejected Stripe webhook: ${message}`);
      return res.status(400).json({ error: 'Invalid signature.' });
    }

    const bookingId = extractBookingId(event);

    // Claim the event id first. Stripe retries aggressively, and a duplicate
    // must not run the handler a second time.
    const isNew = await store.recordStripeEvent({
      id: event.id,
      type: event.type,
      bookingId,
      payload: event.data?.object,
    });
    if (!isNew) {
      return res.json({ received: true, duplicate: true });
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as { payment_intent?: string | { id: string } };
          if (bookingId) {
            const intent = typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id;
            await confirmPaidBooking(bookingId, intent);
          }
          break;
        }
        case 'checkout.session.expired': {
          if (bookingId) {
            await releaseUnpaidBooking(bookingId, 'expired', 'checkout_session_expired');
          }
          break;
        }
        case 'payment_intent.payment_failed': {
          // A declined card is not the end of the session: Stripe Checkout lets
          // the guest try another card on the same page. Releasing the nights
          // here would leave a successful retry unable to confirm — money taken
          // and no reservation. The hold lapses on its own if they give up, and
          // checkout.session.expired covers the abandoned case.
          console.warn(`Payment attempt failed for booking ${bookingId ?? 'unknown'}; hold kept so a retry can still succeed.`);
          break;
        }
        case 'charge.refunded': {
          // Keeps our record in step with refunds issued straight from the
          // Stripe Dashboard, not just the ones our own API triggered.
          const charge = event.data.object as { amount_refunded?: number };
          if (bookingId && typeof charge.amount_refunded === 'number') {
            await store.updateBooking(bookingId, { refundAmount: charge.amount_refunded });
          }
          break;
        }
        case 'charge.dispute.created': {
          // Deliberately does not cancel the booking: the guest may well still
          // arrive, and cancelling on a dispute would be self-inflicted damage.
          console.error(`Chargeback opened for booking ${bookingId ?? 'unknown'}. Review in the Stripe Dashboard.`);
          break;
        }
        default:
          break;
      }
    } catch (error) {
      // Returning 500 asks Stripe to retry; the event id row is what stops the
      // retry from double-applying whatever already succeeded.
      console.error(`Stripe webhook ${event.type} (${event.id}) failed.`, error);
      return res.status(500).json({ error: 'Webhook handler failed.' });
    }

    return res.json({ received: true });
  });

  // Gate for a booking-specific check-in link (see checkInUrl in bookingEmails.ts).
  // A link with no `bk` at all — e.g. the generic per-property link a host copies
  // from the Check-in link picker for OTA guests — never calls this; only a link
  // carrying a confirmation number does.
  app.get('/api/properties/:id/checkins/match', async (req, res) => {
    const property = await store.getProperty(getParam(req.params.id));
    if (!property) {
      return res.status(404).json({ error: 'Property not found.' });
    }

    const ipAddress = getClientIp(req);
    if (!enforceCheckinMatchRateLimit(ipAddress)) {
      return res.status(429).json({ error: 'Too many attempts. Please try again in a minute.' });
    }

    const bk = normalizeText(req.query.bk);
    if (!bk) {
      return res.status(400).json({ error: 'bk is required.' });
    }

    const confirmation = await store.getBookingConfirmationByNo(property.id, bk);
    const matched = confirmation !== null && !isCheckInLinkExpired(confirmation.checkOutDate, Date.now());
    return res.json({ ok: matched });
  });

  app.post('/api/properties/:id/checkins/start', async (req, res) => {
    const property = await store.getProperty(getParam(req.params.id));
    if (!property) {
      return res.status(404).json({ error: 'Property not found.' });
    }

    const ttlSeconds = Number(process.env.CHECKIN_TOKEN_TTL_SECONDS ?? 1800);
    const safeTtl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 1800;
    const token = signCheckInToken(property.id, safeTtl);

    return res.status(201).json({
      checkinToken: token,
      expiresInSeconds: safeTtl,
      consentPolicy: {
        retentionDays: checkInRetentionDays,
        noticeVersion: checkInRetentionNoticeVersion,
      },
    });
  });

  app.post('/api/properties/:id/checkins/ocr', async (req, res) => {
    const property = await store.getProperty(getParam(req.params.id));
    if (!property) {
      return res.status(404).json({ error: 'Property not found.' });
    }

    if (!validateCheckInToken(req.body?.checkinToken, property.id)) {
      return res.status(401).json({ error: 'Valid check-in token is required.' });
    }

    const ipAddress = getClientIp(req);
    if (!enforceOcrRateLimit(ipAddress)) {
      return res.status(429).json({ error: 'Too many OCR requests. Please try again later.' });
    }

    const imageInput = normalizeText(req.body?.imageBase64);
    if (!imageInput) {
      return res.status(400).json({ error: 'imageBase64 is required.' });
    }

    const parsed = parseImageData(imageInput);
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(parsed.mimeType)) {
      return res.status(400).json({ error: 'Unsupported image format.' });
    }
    if (!/^[a-zA-Z0-9+/=\s]+$/.test(parsed.base64)) {
      return res.status(400).json({ error: 'Invalid base64 image.' });
    }

    let rawBuffer: Buffer;
    try {
      rawBuffer = Buffer.from(parsed.base64, 'base64');
    } catch {
      return res.status(400).json({ error: 'Invalid base64 image.' });
    }

    if (!rawBuffer.length) {
      return res.status(400).json({ error: 'Image payload is empty.' });
    }

    if (rawBuffer.length > CHECKIN_OCR_MAX_IMAGE_BYTES) {
      return res.status(400).json({ error: `Image is too large. Max ${Math.round(CHECKIN_OCR_MAX_IMAGE_BYTES / (1024 * 1024))}MB.` });
    }

    const guestId = normalizeText(req.body?.guestId) || `guest_${Math.random().toString(36).slice(2, 8)}`;

    let compressed: { buffer: Buffer; mimeType: string };
    try {
      compressed = await objectStorage.compressImage(rawBuffer, parsed.mimeType);
    } catch {
      return res.status(400).json({ error: 'Uploaded payload is not a valid readable image.' });
    }

    // Deferred upload: do NOT push to GCS here. The image stays on the client as a
    // local data URI and is compressed + uploaded only when the guest confirms (submit).
    // This keeps each scan fast (OCR only, no storage round-trip).
    const ai = await idProcessing.processIdDocument(compressed.buffer.toString('base64'), compressed.mimeType);
    if (!ai.isIdDocument) {
      return res.status(422).json({
        error: ai.rejectionReason || 'Uploaded image is not a supported ID document.',
      });
    }

    const extractedGuest = toNormalizedGuest({
      id: guestId,
      fullName: ai.fullName,
      birthYear: ai.birthYear,
      nationality: ai.nationality,
      address: ai.address,
      gender: ai.gender,
      occupation: ai.occupation,
      documentType: ai.documentType,
      documentNumber: ai.documentNumber,
      evidenceUrl: '',
      evidenceMimeType: compressed.mimeType,
      ocrText: ai.ocrText,
      estimated: {
        fullName: !ai.fullName,
        birthYear: !ai.birthYear,
        nationality: !ai.nationality || Boolean(ai.inferredNationality),
        address: !ai.address,
        gender: !ai.gender,
        occupation: !ai.occupation,
        documentType: ai.documentType === 'unknown',
        documentNumber: !ai.documentNumber,
      },
      confidence: {
        fullName: ai.confidence.fullName,
        birthYear: ai.confidence.birthYear,
        nationality: ai.confidence.nationality,
        address: ai.confidence.address,
        gender: ai.confidence.gender,
        occupation: ai.confidence.occupation,
        documentType: ai.confidence.documentType,
        documentNumber: ai.confidence.documentNumber,
      },
    }, 0);

    return res.status(201).json({ guest: extractedGuest });
  });

  app.post('/api/properties/:id/checkins/submit', async (req, res) => {
    const property = await store.getProperty(getParam(req.params.id));
    if (!property) {
      return res.status(404).json({ error: 'Property not found.' });
    }

    if (!validateCheckInToken(req.body?.checkinToken, property.id)) {
      return res.status(401).json({ error: 'Valid check-in token is required.' });
    }

    const checkInDate = req.body?.checkInDate;
    const checkOutDate = req.body?.checkOutDate;
    if (!isIsoDate(checkInDate) || !isIsoDate(checkOutDate)) {
      return res.status(400).json({ error: 'Valid checkInDate and checkOutDate are required in YYYY-MM-DD format.' });
    }

    if (checkInDate >= checkOutDate) {
      return res.status(400).json({ error: 'checkOutDate must be after checkInDate.' });
    }

    const guestsRaw = req.body?.guests;
    if (!Array.isArray(guestsRaw) || guestsRaw.length === 0) {
      return res.status(400).json({ error: 'At least one guest is required.' });
    }

    const guests = guestsRaw.map((guest: unknown, index: number) => toNormalizedGuest(guest, index));
    // Guests living in Japan are exempt from the ID-evidence requirement (the
    // Hotel Business Act only mandates it for guests without a Japan address);
    // anything else (including a missing/unrecognised value) keeps the
    // stricter default.
    const residency = normalizeText(req.body?.residency);
    const isResident = residency === 'resident';
    if (!isResident && guests.some((guest) => !guest.evidenceUrl)) {
      return res.status(400).json({ error: 'Every guest must include an ID evidence image.' });
    }

    const bk = normalizeText(req.body?.bk);
    // The lead guest's contact field is always required to be a real email:
    // on the generic per-property link it's the only place a house-access
    // email could ever come from, and on a booking-specific link it may
    // differ from the email on file for the booking, in which case both
    // addresses get the welcome email below.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guests[0]?.contactInfo ?? '')) {
      return res.status(400).json({ error: 'The first guest must provide a valid email address to receive check-in info.' });
    }

    // Deferred upload: ID images arrive inline as data URIs. Compress each to <100KB
    // and store in the bucket now, swapping evidenceUrl to a gcs:// reference.
    for (const guest of guests) {
      if (!guest.evidenceUrl.startsWith('data:')) {
        continue; // already a stored reference (e.g. re-submission)
      }
      const parsed = parseImageData(guest.evidenceUrl);
      if (!/^image\/(jpeg|jpg|png|webp)$/i.test(parsed.mimeType) || !/^[a-zA-Z0-9+/=\s]+$/.test(parsed.base64)) {
        return res.status(400).json({ error: 'Unsupported ID image format.' });
      }
      let rawBuffer: Buffer;
      try {
        rawBuffer = Buffer.from(parsed.base64, 'base64');
      } catch {
        return res.status(400).json({ error: 'Invalid ID image.' });
      }
      if (!rawBuffer.length || rawBuffer.length > CHECKIN_OCR_MAX_IMAGE_BYTES) {
        return res.status(400).json({ error: 'ID image payload is invalid or too large.' });
      }
      try {
        const compressed = await objectStorage.compressReceiptImage(rawBuffer, parsed.mimeType);
        const upload = await objectStorage.uploadEvidenceImage({
          imageBuffer: compressed.buffer,
          mimeType: compressed.mimeType,
          propertyId: property.id,
          guestId: guest.id,
        });
        guest.evidenceUrl = upload.evidenceUrl;
        guest.evidenceMimeType = upload.mimeType;
      } catch (uploadErr) {
        console.error('[checkin/submit] evidence upload failed for guest', guest.id, ':', uploadErr);
        return res.status(502).json({ error: 'Failed to store ID image. Please try again.' });
      }
    }

    const consentRaw = req.body?.consent as Record<string, unknown> | undefined;
    const consentAccepted = toBoolean(consentRaw?.accepted);
    const consentAcceptedAt = toNonNegativeInt(consentRaw?.acceptedAt);
    const consentNoticeVersion = normalizeText(consentRaw?.noticeVersion);
    if (consentAccepted !== true || consentAcceptedAt === null || consentNoticeVersion !== checkInRetentionNoticeVersion) {
      return res.status(400).json({ error: 'Consent confirmation is required before submitting check-in.' });
    }

    const submittedAt = Date.now();

    const checkInTimeRaw = req.body?.checkInTime;
    const checkOutTimeRaw = req.body?.checkOutTime;
    const checkInTime = typeof checkInTimeRaw === 'string' ? checkInTimeRaw.slice(0, 5) : '15:00';
    const checkOutTime = typeof checkOutTimeRaw === 'string' ? checkOutTimeRaw.slice(0, 5) : '10:00';

    const submission = await store.createCheckInSubmission({
      propertyId: property.id,
      checkInDate,
      checkOutDate,
      checkInTime,
      checkOutTime,
      guests,
      consent: {
        accepted: true,
        acceptedAt: consentAcceptedAt,
        retentionDays: checkInRetentionDays,
        noticeVersion: checkInRetentionNoticeVersion,
      },
      audit: {
        submittedAt,
        ipAddress: getClientIp(req),
        userAgent: normalizeText(req.get('user-agent')).slice(0, 300) || 'unknown',
      },
      residency: isResident ? 'resident' : 'foreign',
    });

    const locale = normalizeText(req.body?.locale) || 'en';
    const leadEmail = guests[0]?.contactInfo ?? '';
    let emailsSent: string[];
    if (bk) {
      // Re-validated here rather than trusted from the earlier /checkins/match
      // call — that call only proves the link wasn't stale at click time.
      // Also carries the lead guest's own contact email so it gets a copy
      // too whenever it differs from the one on file for the booking.
      emailsSent = await sendCheckInWelcomeEmail(property, bk, locale, leadEmail);
    } else {
      // The generic per-property link carries no confirmation to look an
      // email up against, so the lead guest's own contact field — already
      // required above to be a real email for exactly this reason — is the
      // only address there is.
      const sent = await trySendCheckInWelcomeEmailTo(property, leadEmail, locale);
      emailsSent = sent ? [sent] : [];
    }

    return res.status(201).json({ submission, emailsSent });
  });

  app.get('/api/checkins', requireAuth, requireHostOrAdmin, async (req, res) => {
    const actor = req.authUser!;
    if (actor.role === 'HOST' && (actor.hostLevel ?? 0) < 3) {
      return res.status(403).json({ error: 'Check-in access requires host level 3. Contact admin.' });
    }
    const propertyIdRaw = req.query.propertyId;
    const fromDateRaw = req.query.fromDate;
    const toDateRaw = req.query.toDate;
    const guestNameRaw = req.query.guestName;
    const nationalityRaw = req.query.nationality;

    if ([propertyIdRaw, fromDateRaw, toDateRaw, guestNameRaw, nationalityRaw].some(Array.isArray)) {
      return res.status(400).json({ error: 'Filter query parameters must be singular values.' });
    }

    const filters: CheckInListFilters = {
      propertyId: typeof propertyIdRaw === 'string' ? propertyIdRaw : undefined,
      fromDate: typeof fromDateRaw === 'string' ? fromDateRaw : undefined,
      toDate: typeof toDateRaw === 'string' ? toDateRaw : undefined,
      guestName: typeof guestNameRaw === 'string' ? guestNameRaw : undefined,
      nationality: typeof nationalityRaw === 'string' ? nationalityRaw : undefined,
    };

    if (filters.fromDate && !isIsoDate(filters.fromDate)) {
      return res.status(400).json({ error: 'fromDate must be YYYY-MM-DD.' });
    }
    if (filters.toDate && !isIsoDate(filters.toDate)) {
      return res.status(400).json({ error: 'toDate must be YYYY-MM-DD.' });
    }

    const rows = await store.listCheckInSubmissions(filters);
    const visibleRows = rows.filter((row) => canPerformAction(req.authUser!, 'property.read', row.propertyId));
    const resolvedRows = await Promise.all(visibleRows.map((row) => resolveSubmissionEvidence(row)));

    return res.json({ submissions: resolvedRows });
  });

  app.get('/api/checkins/:id', requireAuth, requireHostOrAdmin, async (req, res) => {
    const actor = req.authUser!;
    if (actor.role === 'HOST' && (actor.hostLevel ?? 0) < 3) {
      return res.status(403).json({ error: 'Check-in access requires host level 3. Contact admin.' });
    }

    const submission = await store.getCheckInSubmission(getParam(req.params.id));
    if (!submission) {
      return res.status(404).json({ error: 'Check-in submission not found.' });
    }

    if (!canPerformAction(actor, 'property.read', submission.propertyId)) {
      return res.status(403).json({ error: 'Check-in read not allowed.' });
    }

    const resolvedSubmission = await resolveSubmissionEvidence(submission);

    return res.json({ submission: resolvedSubmission });
  });

  app.patch('/api/checkins/:id', requireAuth, requireHostOrAdmin, async (req, res) => {
    const actor = req.authUser!;
    if (actor.role === 'HOST' && (actor.hostLevel ?? 0) < 3) {
      return res.status(403).json({ error: 'Check-in access requires host level 3. Contact admin.' });
    }

    const submission = await store.getCheckInSubmission(getParam(req.params.id));
    if (!submission) {
      return res.status(404).json({ error: 'Check-in submission not found.' });
    }

    if (!canPerformAction(actor, 'property.write', submission.propertyId)) {
      return res.status(403).json({ error: 'Check-in update not allowed.' });
    }

    const checkInDateRaw = req.body?.checkInDate;
    const checkOutDateRaw = req.body?.checkOutDate;
    const guestIdRaw = req.body?.guestId;
    const guestRaw = req.body?.guest as Record<string, unknown> | undefined;

    const nextCheckInDate = typeof checkInDateRaw === 'string' ? checkInDateRaw : submission.checkInDate;
    const nextCheckOutDate = typeof checkOutDateRaw === 'string' ? checkOutDateRaw : submission.checkOutDate;
    if (!isIsoDate(nextCheckInDate) || !isIsoDate(nextCheckOutDate)) {
      return res.status(400).json({ error: 'checkInDate/checkOutDate must be YYYY-MM-DD.' });
    }
    if (nextCheckInDate >= nextCheckOutDate) {
      return res.status(400).json({ error: 'checkOutDate must be after checkInDate.' });
    }

    if (typeof guestIdRaw !== 'string' || !guestIdRaw.trim() || !guestRaw || typeof guestRaw !== 'object') {
      return res.status(400).json({ error: 'guestId and guest patch are required.' });
    }

    const guestId = guestIdRaw.trim();
    const guestIndex = submission.guests.findIndex((guest) => guest.id === guestId);
    if (guestIndex < 0) {
      return res.status(404).json({ error: 'Guest not found in this check-in submission.' });
    }

    const birthYearRaw = guestRaw.birthYear;
    let birthYear: number | null = null;
    if (typeof birthYearRaw === 'number') {
      if (!Number.isInteger(birthYearRaw)) {
        return res.status(400).json({ error: 'birthYear must be an integer or null.' });
      }
      birthYear = birthYearRaw;
    } else if (typeof birthYearRaw === 'string' && birthYearRaw.trim()) {
      const parsed = Number(birthYearRaw);
      if (!Number.isInteger(parsed)) {
        return res.status(400).json({ error: 'birthYear must be an integer or null.' });
      }
      birthYear = parsed;
    } else if (birthYearRaw !== null && birthYearRaw !== undefined && birthYearRaw !== '') {
      return res.status(400).json({ error: 'birthYear must be an integer or null.' });
    }

    const currentYear = new Date().getFullYear();
    if (birthYear !== null && (birthYear < 1900 || birthYear > currentYear)) {
      return res.status(400).json({ error: `birthYear must be between 1900 and ${currentYear}.` });
    }

    const documentType = normalizeText(guestRaw.documentType || 'unknown').toLowerCase();
    const allowedDocumentTypes = new Set(['passport', 'driver_license', 'residence_card', 'national_id', 'unknown']);
    if (!allowedDocumentTypes.has(documentType)) {
      return res.status(400).json({ error: 'Invalid documentType.' });
    }

    const fullName = normalizeText(guestRaw.fullName);
    if (!fullName) {
      return res.status(400).json({ error: 'fullName is required.' });
    }

    const nextGuests = structuredClone(submission.guests);
    nextGuests[guestIndex] = {
      ...nextGuests[guestIndex],
      fullName,
      birthYear,
      gender: normalizeText(guestRaw.gender).toUpperCase(),
      nationality: normalizeText(guestRaw.nationality).toUpperCase(),
      address: normalizeText(guestRaw.address),
      occupation: normalizeText(guestRaw.occupation),
      documentType: documentType as CheckInGuest['documentType'],
      documentNumber: normalizeText(guestRaw.documentNumber).toUpperCase(),
    };

    const updated = await store.updateCheckInSubmission(submission.id, {
      checkInDate: nextCheckInDate,
      checkOutDate: nextCheckOutDate,
      guests: nextGuests,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Check-in submission not found.' });
    }

    const resolvedSubmission = await resolveSubmissionEvidence(updated);
    return res.json({ submission: resolvedSubmission });
  });

  app.delete('/api/checkins/:id', requireAuth, requireHostOrAdmin, async (req, res) => {
    const actor = req.authUser!;
    if (actor.role === 'HOST' && (actor.hostLevel ?? 0) < 3) {
      return res.status(403).json({ error: 'Check-in access requires host level 3. Contact admin.' });
    }

    const submission = await store.getCheckInSubmission(getParam(req.params.id));
    if (!submission) {
      return res.status(404).json({ error: 'Check-in submission not found.' });
    }

    if (!canPerformAction(actor, 'property.delete', submission.propertyId)) {
      return res.status(403).json({ error: 'Check-in delete not allowed.' });
    }

    await Promise.all(
      submission.guests.map((guest) =>
        objectStorage.deleteEvidenceObject(guest.evidenceUrl).catch((error) => {
          console.error(`Failed to delete check-in evidence for guest ${guest.id}`, error);
        }),
      ),
    );

    await store.deleteCheckInSubmission(submission.id);
    return res.status(204).send();
  });

  // ─── CSV Import ──────────────────────────────────────────────────────────────
  app.post('/api/checkins/import', requireAuth, requireAdmin, async (req, res) => {
    const { csvContent } = req.body as { csvContent?: unknown };
    if (typeof csvContent !== 'string' || !csvContent.trim()) {
      return res.status(400).json({ error: 'csvContent is required.' });
    }

    // Simple CSV parser: handles quoted fields with commas/newlines inside
    function parseCsv(text: string): string[][] {
      const results: string[][] = [];
      let row: string[] = [];
      let field = '';
      let inQuotes = false;
      const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      for (let i = 0; i < normalized.length; i++) {
        const ch = normalized[i];
        if (inQuotes) {
          if (ch === '"') {
            if (normalized[i + 1] === '"') { field += '"'; i++; }
            else { inQuotes = false; }
          } else {
            field += ch;
          }
        } else {
          if (ch === '"') { inQuotes = true; }
          else if (ch === ',') { row.push(field.trim()); field = ''; }
          else if (ch === '\n') { row.push(field.trim()); field = ''; results.push(row); row = []; }
          else { field += ch; }
        }
      }
      row.push(field.trim());
      if (row.some(c => c !== '')) results.push(row);
      return results;
    }

    const rows = parseCsv(csvContent.trim());
    if (rows.length < 2) {
      return res.status(400).json({ error: 'CSV must have a header row and at least one data row.' });
    }

    const REQUIRED_COLS = ['property_id', 'check_in_date', 'check_out_date', 'full_name'] as const;
    const OPTIONAL_COLS = ['birth_year', 'nationality', 'gender', 'address', 'occupation', 'document_type', 'document_number', 'session_ref', 'evidence_url'] as const;
    const ALL_COLS = [...REQUIRED_COLS, ...OPTIONAL_COLS];

    const header = rows[0].map(h => h.toLowerCase().trim());
    const missing = REQUIRED_COLS.filter(col => !header.includes(col));
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required columns: ${missing.join(', ')}` });
    }

    const idx = (col: string) => header.indexOf(col);

    type GuestRow = {
      propertyId: string;
      checkInDate: string;
      checkOutDate: string;
      groupingKey: string;
      guest: CheckInGuest;
    };

    const importErrors: Array<{ row: number; message: string }> = [];
    const guestRows: GuestRow[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const get = (col: string) => (idx(col) >= 0 ? (row[idx(col)] ?? '').trim() : '');

      const propertyId = get('property_id');
      const checkInDate = get('check_in_date');
      const checkOutDate = get('check_out_date');
      const fullName = get('full_name');

      if (!propertyId) { importErrors.push({ row: i + 1, message: 'property_id is empty' }); continue; }
      if (!isIsoDate(checkInDate)) { importErrors.push({ row: i + 1, message: `check_in_date "${checkInDate}" is not YYYY-MM-DD` }); continue; }
      if (!isIsoDate(checkOutDate)) { importErrors.push({ row: i + 1, message: `check_out_date "${checkOutDate}" is not YYYY-MM-DD` }); continue; }
      if (!fullName) { importErrors.push({ row: i + 1, message: 'full_name is empty' }); continue; }

      const property = await store.getProperty(propertyId);
      if (!property) {
        importErrors.push({ row: i + 1, message: `property_id "${propertyId}" not found` });
        continue;
      }

      const birthYearRaw = get('birth_year');
      const birthYear = birthYearRaw ? parseInt(birthYearRaw, 10) : null;

      const docTypeRaw = get('document_type').toLowerCase();
      const VALID_DOC_TYPES = ['passport', 'driver_license', 'residence_card', 'national_id', 'unknown'];
      const documentType = VALID_DOC_TYPES.includes(docTypeRaw) ? docTypeRaw : 'unknown';

      const evidenceUrl = get('evidence_url') || get('session_ref');
      const canonicalPropertyId = property.id;
      const groupingKey = `${canonicalPropertyId}__${checkInDate}__${checkOutDate}`;

      guestRows.push({
        propertyId: canonicalPropertyId,
        checkInDate,
        checkOutDate,
        groupingKey,
        guest: {
          id: `g_${Math.random().toString(36).slice(2, 10)}`,
          fullName: fullName.toUpperCase(),
          birthYear: Number.isFinite(birthYear) ? birthYear : null,
          nationality: get('nationality').toUpperCase(),
          gender: get('gender').toUpperCase(),
          address: get('address').toUpperCase(),
          occupation: get('occupation').toUpperCase(),
          documentType: documentType as CheckInGuest['documentType'],
          documentNumber: get('document_number').toUpperCase(),
          evidenceUrl,
          evidenceMimeType: '',
          ocrText: '',
          estimated: {},
          confidence: {},
        },
      });
    }

    // Group guests into submissions by property and stay dates.
    const groups = new Map<string, GuestRow[]>();
    for (const gr of guestRows) {
      const existing = groups.get(gr.groupingKey) ?? [];
      existing.push(gr);
      groups.set(gr.groupingKey, existing);
    }

    const now = Date.now();
    let imported = 0;

    for (const [groupingKey, groupRows] of groups) {
      const first = groupRows[0];
      try {
        await store.createCheckInSubmission({
          propertyId: first.propertyId,
          checkInDate: first.checkInDate,
          checkOutDate: first.checkOutDate,
          guests: groupRows.map(gr => gr.guest),
          consent: {
            accepted: true,
            acceptedAt: now,
            retentionDays: checkInRetentionDays,
            noticeVersion: 'csv-import',
          },
          audit: {
            submittedAt: now,
            ipAddress: 'csv-import',
            userAgent: `CSV Import by user ${req.authUser!.id}`,
          },
        });
        imported++;
      } catch (err) {
        importErrors.push({
          row: 0,
          message: `Failed to save submission for group "${groupingKey}": ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    return res.status(201).json({ imported, errors: importErrors });
  });

  // ── Booking confirmation API ────────────────────────────────────────────────
  // Hosts generate a PDF booking confirmation for direct (off-platform) bookings
  // and the record is stored for the direct-booking revenue report. Access is any
  // HOST (assigned to the property) or ADMIN — no host-level gate.

  function toWholeAmount(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }
    return Math.round(parsed);
  }

  function isHmTime(value: unknown): value is string {
    return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  // Decodes and sanity-checks a base64 PDF the host's browser rendered
  // (the confirmation-PDF export), so it can ride along as an email
  // attachment. Same checks as the email-ingest receipt upload: valid
  // base64, a sane size ceiling, and an actual PDF magic number.
  function parsePdfAttachment(value: unknown): { buffer: Buffer } | { error: string } {
    if (typeof value !== 'string' || !value) {
      return { error: 'pdfBase64 is required.' };
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(value, 'base64');
    } catch {
      return { error: 'pdfBase64 is not valid base64.' };
    }
    if (!buffer.length || buffer.length > 10 * 1024 * 1024) {
      return { error: 'PDF must be non-empty and under 10MB.' };
    }
    if (!buffer.subarray(0, 5).toString('latin1').startsWith('%PDF')) {
      return { error: 'Attachment is not a PDF.' };
    }
    return { buffer };
  }

  app.post('/api/properties/:id/booking-confirmations', requireAuth, requireHostOrAdmin, async (req, res) => {
    const actor = req.authUser!;
    const propertyId = getParam(req.params.id);
    const property = await store.getProperty(propertyId);
    if (!property) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    if (!canPerformAction(actor, 'property.read', property.id)) {
      return res.status(403).json({ error: 'Not allowed for this property.' });
    }

    const body = req.body ?? {};
    const guestName = normalizeText(body.guestName);
    if (!guestName) {
      return res.status(400).json({ error: 'guestName is required.' });
    }

    const checkInDate = normalizeText(body.checkInDate);
    const checkOutDate = normalizeText(body.checkOutDate);
    if (!isIsoDate(checkInDate) || !isIsoDate(checkOutDate)) {
      return res.status(400).json({ error: 'checkInDate/checkOutDate must be YYYY-MM-DD.' });
    }
    if (checkInDate >= checkOutDate) {
      return res.status(400).json({ error: 'checkOutDate must be after checkInDate.' });
    }

    // A manual entry must not silently double-book a night another platform
    // already holds — sync against the same effective calendar (manual
    // blocks + iCal imports + direct-booking holds) that guest availability
    // checks use, not just what is already in this table.
    const blockedSet = new Set(await getEffectiveBlockedDates(property, 'fresh-if-stale'));
    const conflictDates = getStayDates(checkInDate, checkOutDate).filter((date) => blockedSet.has(date));
    if (conflictDates.length > 0) {
      return res.status(409).json({ error: 'Selected dates are not available.', conflictDates });
    }

    const checkInTime = isHmTime(body.checkInTime) ? body.checkInTime : '15:00';
    const checkOutTime = isHmTime(body.checkOutTime) ? body.checkOutTime : '10:00';

    const numGuests = toNonNegativeInt(typeof body.numGuests === 'string' ? Number(body.numGuests) : body.numGuests);
    if (numGuests === null || numGuests < 1) {
      return res.status(400).json({ error: 'numGuests must be a positive integer.' });
    }

    const roomFee = toWholeAmount(body.roomFee);
    const cleaningFee = toWholeAmount(body.cleaningFee);
    const extraFee = toWholeAmount(body.extraFee ?? 0);
    const discountAmount = toWholeAmount(body.discountAmount ?? 0);
    const totalAmount = toWholeAmount(body.totalAmount);
    const depositAmount = toWholeAmount(body.depositAmount ?? 0);
    const balanceDue = toWholeAmount(body.balanceDue);
    if ([roomFee, cleaningFee, extraFee, discountAmount, totalAmount, depositAmount, balanceDue].some((value) => value === null)) {
      return res.status(400).json({ error: 'Amount fields must be non-negative numbers.' });
    }

    const confirmation = await store.createBookingConfirmation({
      propertyId: property.id,
      propertyName: normalizeText(body.propertyName) || property.name,
      propertyAddress: normalizeText(body.propertyAddress) || property.address,
      propertyUrl: normalizeText(body.propertyUrl),
      guestName,
      guestEmail: normalizeText(body.guestEmail) || undefined,
      guestPhone: normalizeText(body.guestPhone) || undefined,
      numGuests,
      checkInDate,
      checkOutDate,
      checkInTime,
      checkOutTime,
      currency: normalizeText(body.currency) || 'JPY',
      roomFee: roomFee!,
      cleaningFee: cleaningFee!,
      extraFeeLabel: normalizeText(body.extraFeeLabel) || undefined,
      extraFee: extraFee!,
      discountLabel: normalizeText(body.discountLabel) || undefined,
      discountAmount: discountAmount!,
      totalAmount: totalAmount!,
      depositAmount: depositAmount!,
      balanceDue: balanceDue!,
      notes: normalizeText(body.notes) || undefined,
      freeCancellationDays: resolveFreeCancellationDays(property),
      includeInAccounting: body.includeInAccounting === true,
      source: 'manual',
      createdByUserId: actor.id,
      createdByName: actor.name,
    });

    // attachPdf: true means the caller (the confirmation form) is about to
    // render the PDF client-side using this confirmation's real number and
    // will send the guest email itself via POST /booking-confirmations/:id/email
    // — skip sending a second, attachment-less email here.
    const attachPdf = body.attachPdf === true;

    // Best-effort, like every other booking mail: a guest not being emailed
    // must never undo a confirmation the host already recorded and may have
    // already handed a PDF for.
    if (confirmation.guestEmail && !attachPdf) {
      try {
        const slug = property.metalink || property.id;
        const checkInUrl = buildSiteUrl(publicSiteUrl, `/${encodeURIComponent(slug)}/checkin`
          + `?bk=${encodeURIComponent(confirmation.confirmationNo)}`);
        const locale = toLanguageCode(body.locale) ?? 'en';
        const mail = buildManualBookingConfirmationEmail({ confirmation, checkInUrl }, locale);
        await mailer.send({ ...mail, to: confirmation.guestEmail });
      } catch (error) {
        console.error(`Could not send manual booking confirmation mail for ${confirmation.id}.`, error);
      }
    }

    return res.status(201).json({ confirmation });
  });

  // Sends (or re-sends) the manual-booking guest confirmation email, optionally
  // with a PDF attachment. Split out from the create endpoint above because the
  // PDF is rendered client-side and needs the real confirmationNo, which only
  // exists once the confirmation row above has already been created.
  app.post('/api/booking-confirmations/:id/email', requireAuth, requireHostOrAdmin, async (req, res) => {
    const actor = req.authUser!;
    const confirmation = await store.getBookingConfirmation(getParam(req.params.id));
    if (!confirmation) {
      return res.status(404).json({ error: 'Booking confirmation not found.' });
    }
    if (!canPerformAction(actor, 'property.read', confirmation.propertyId)) {
      return res.status(403).json({ error: 'Not allowed for this property.' });
    }
    if (!confirmation.guestEmail) {
      return res.status(400).json({ error: 'This confirmation has no guest email on file.' });
    }
    const property = await store.getProperty(confirmation.propertyId);
    if (!property) {
      return res.status(404).json({ error: 'Property not found.' });
    }

    let attachments: MailAttachment[] | undefined;
    if (req.body?.pdfBase64 !== undefined) {
      const parsed = parsePdfAttachment(req.body.pdfBase64);
      if ('error' in parsed) {
        return res.status(400).json({ error: parsed.error });
      }
      const fileNameRaw = normalizeText(req.body?.pdfFileName) || `BookingConfirmation_${confirmation.confirmationNo}.pdf`;
      const fileName = /\.pdf$/i.test(fileNameRaw) ? fileNameRaw : `${fileNameRaw}.pdf`;
      attachments = [{ filename: fileName, content: parsed.buffer.toString('base64'), contentType: 'application/pdf' }];
    }

    const slug = property.metalink || property.id;
    const checkInUrl = buildSiteUrl(publicSiteUrl, `/${encodeURIComponent(slug)}/checkin`
      + `?bk=${encodeURIComponent(confirmation.confirmationNo)}`);
    const locale = toLanguageCode(req.body?.locale) ?? 'en';
    const mail = buildManualBookingConfirmationEmail({ confirmation, checkInUrl }, locale);

    try {
      await mailer.send({ ...mail, to: confirmation.guestEmail, attachments });
    } catch (error) {
      console.error(`Could not send manual booking confirmation mail for ${confirmation.id}.`, error);
      return res.status(502).json({ error: 'Failed to send the confirmation email.' });
    }

    return res.json({ ok: true });
  });

  app.get('/api/booking-confirmations', requireAuth, requireHostOrAdmin, async (req, res) => {
    const actor = req.authUser!;
    const propertyIdRaw = req.query.propertyId;
    const fromDateRaw = req.query.fromDate;
    const toDateRaw = req.query.toDate;
    const guestNameRaw = req.query.guestName;

    if ([propertyIdRaw, fromDateRaw, toDateRaw, guestNameRaw].some(Array.isArray)) {
      return res.status(400).json({ error: 'Filter query parameters must be singular values.' });
    }

    const fromDate = typeof fromDateRaw === 'string' ? fromDateRaw : undefined;
    const toDate = typeof toDateRaw === 'string' ? toDateRaw : undefined;
    if (fromDate && !isIsoDate(fromDate)) {
      return res.status(400).json({ error: 'fromDate must be YYYY-MM-DD.' });
    }
    if (toDate && !isIsoDate(toDate)) {
      return res.status(400).json({ error: 'toDate must be YYYY-MM-DD.' });
    }

    const rows = await store.listBookingConfirmations({
      propertyId: typeof propertyIdRaw === 'string' ? propertyIdRaw : undefined,
      fromDate,
      toDate,
      guestName: typeof guestNameRaw === 'string' ? guestNameRaw : undefined,
    });
    const visible = rows.filter((row) => canPerformAction(actor, 'property.read', row.propertyId));
    return res.json({ confirmations: visible });
  });

  app.get('/api/booking-confirmations/:id', requireAuth, requireHostOrAdmin, async (req, res) => {
    const actor = req.authUser!;
    const confirmation = await store.getBookingConfirmation(getParam(req.params.id));
    if (!confirmation) {
      return res.status(404).json({ error: 'Booking confirmation not found.' });
    }
    if (!canPerformAction(actor, 'property.read', confirmation.propertyId)) {
      return res.status(403).json({ error: 'Not allowed for this property.' });
    }
    return res.json({ confirmation });
  });

  app.patch('/api/booking-confirmations/:id', requireAuth, requireHostOrAdmin, async (req, res) => {
    const actor = req.authUser!;
    const confirmation = await store.getBookingConfirmation(getParam(req.params.id));
    if (!confirmation) {
      return res.status(404).json({ error: 'Booking confirmation not found.' });
    }
    if (!canPerformAction(actor, 'property.read', confirmation.propertyId)) {
      return res.status(403).json({ error: 'Not allowed for this property.' });
    }

    const body = req.body ?? {};
    const patch: BookingConfirmationPatch = {};

    if (body.includeInAccounting !== undefined) {
      if (typeof body.includeInAccounting !== 'boolean') {
        return res.status(400).json({ error: 'includeInAccounting must be a boolean.' });
      }
      patch.includeInAccounting = body.includeInAccounting;
    }
    if (body.notes !== undefined) {
      patch.notes = normalizeText(body.notes) || undefined;
    }

    const updated = await store.updateBookingConfirmation(confirmation.id, patch);
    if (!updated) {
      return res.status(404).json({ error: 'Booking confirmation not found.' });
    }
    return res.json({ confirmation: updated });
  });

  app.delete('/api/booking-confirmations/:id', requireAuth, requireHostOrAdmin, async (req, res) => {
    const actor = req.authUser!;
    const confirmation = await store.getBookingConfirmation(getParam(req.params.id));
    if (!confirmation) {
      return res.status(404).json({ error: 'Booking confirmation not found.' });
    }
    if (!canPerformAction(actor, 'property.delete', confirmation.propertyId)) {
      return res.status(403).json({ error: 'Not allowed for this property.' });
    }

    const deleted = await store.deleteBookingConfirmation(confirmation.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Booking confirmation not found.' });
    }
    return res.status(204).send();
  });

  // ── Finance API ─────────────────────────────────────────────────────────────

  // ── Email receipt ingest (Google Apps Script bridge) ───────────────────────
  // Machine-to-machine endpoint: the Gmail Apps Script forwards vendor receipts
  // (e.g. Anthropic invoices) here. Auth is a shared API key, not a user session.
  const requireIngestKey: RequestHandler = (req, res, next) => {
    const configured = process.env.FINANCE_INGEST_API_KEY ?? '';
    if (!configured) {
      return res.status(503).json({ error: 'Email receipt ingest is not configured (FINANCE_INGEST_API_KEY).' });
    }
    const provided = Buffer.from(String(req.headers['x-api-key'] ?? ''));
    const expected = Buffer.from(configured);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return res.status(401).json({ error: 'Invalid API key.' });
    }
    return next();
  };

  // Routing rules map an email address to the property that should absorb the
  // expense. Primary source is the finance_ingest_rules table (managed in the
  // Finance admin UI); the FINANCE_INGEST_RULES env JSON remains as a fallback,
  // e.g. {"host-a@gmail.com":"property_a"}. Matched against the receipt's To
  // addresses first (each host's billing address), then the Gmail account the
  // Apps Script runs under.
  const parseIngestRules = (): Record<string, string> => {
    try {
      const parsed = JSON.parse(process.env.FINANCE_INGEST_RULES ?? '{}') as Record<string, unknown>;
      const rules: Record<string, string> = {};
      for (const [email, propertyId] of Object.entries(parsed)) {
        if (typeof propertyId === 'string' && propertyId.trim()) {
          rules[email.trim().toLowerCase()] = propertyId.trim();
        }
      }
      return rules;
    } catch {
      console.error('[email-ingest] FINANCE_INGEST_RULES is not valid JSON — routing rules disabled.');
      return {};
    }
  };

  // Pull bare addresses out of header-style strings like "Name <a@b.com>, c@d.com".
  const extractEmails = (value: unknown): string[] =>
    String(value ?? '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];

  // POST /api/finance/ingest/email-receipt — create a PENDING expense from an
  // emailed receipt. Idempotent via sourceRef (gmail:<messageId>): replays and
  // concurrent retries return { duplicate: true } instead of a second record.
  // The original PDF is kept as evidence in the receipt bucket. Amounts arrive
  // already converted to JPY (the Apps Script converts at the Google Finance
  // rate at processing time) with the original amount/rate kept in description.
  app.post('/api/finance/ingest/email-receipt', requireIngestKey, async (req, res) => {
    const {
      sourceRef, vendor, transactionDate, description,
      amountJpy, originalAmount, originalCurrency, exchangeRate,
      debitAccount, creditAccount, propertyId: bodyPropertyId,
      accountEmail, toEmail,
      pdfBase64, fileName,
    } = req.body ?? {};

    if (typeof sourceRef !== 'string' || !sourceRef.trim()) {
      return res.status(400).json({ error: 'sourceRef is required.' });
    }
    const ref = sourceRef.trim();

    const amount = Math.round(Number(amountJpy));
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amountJpy must be a positive number.' });
    }
    if (typeof transactionDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) {
      return res.status(400).json({ error: 'transactionDate must be YYYY-MM-DD.' });
    }

    // Resolve the target property: DB rule → env rule → explicit propertyId
    // from the bridge → global default.
    const dbRules: Record<string, string> = {};
    for (const rule of await store.listIngestRules()) {
      dbRules[rule.email] = rule.propertyId;
    }
    const envRules = parseIngestRules();
    const emailCandidates = [...extractEmails(toEmail), ...extractEmails(accountEmail)];
    const ruledPropertyId = emailCandidates.map((e) => dbRules[e] ?? envRules[e]).find(Boolean) ?? '';

    const propertyId = ruledPropertyId
      || (typeof bodyPropertyId === 'string' && bodyPropertyId.trim())
      || process.env.FINANCE_INGEST_PROPERTY_ID
      || '';
    if (!propertyId) {
      return res.status(400).json({
        error: 'No property matched: set FINANCE_INGEST_RULES for this email, pass propertyId, or set FINANCE_INGEST_PROPERTY_ID.',
        emails: emailCandidates,
      });
    }
    const property = await store.getProperty(propertyId);
    if (!property) {
      return res.status(400).json({ error: `Unknown property: ${propertyId}` });
    }

    if (await store.hasFinanceSourceRef(ref)) {
      return res.status(200).json({ duplicate: true });
    }

    // Keep the original PDF as evidence (stored uncompressed).
    let gcsPath = '';
    if (typeof pdfBase64 === 'string' && pdfBase64.length > 0) {
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = Buffer.from(pdfBase64, 'base64');
      } catch {
        return res.status(400).json({ error: 'pdfBase64 is not valid base64.' });
      }
      if (pdfBuffer.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'PDF exceeds 10MB limit.' });
      }
      if (!pdfBuffer.subarray(0, 5).toString('latin1').startsWith('%PDF')) {
        return res.status(400).json({ error: 'Attachment is not a PDF.' });
      }
      try {
        const upload = await objectStorage.uploadReceiptPdf({
          pdfBuffer,
          propertyId: property.id,
          fileNameHint: typeof fileName === 'string' ? fileName : undefined,
        });
        gcsPath = upload.evidenceUrl;
      } catch (err) {
        console.error('[email-ingest] PDF upload failed:', err);
        return res.status(502).json({ error: 'Failed to store receipt PDF.' });
      }
    }

    // Fallback description when the bridge did not compose one.
    const composedDescription = (typeof description === 'string' && description.trim())
      || [
        typeof vendor === 'string' && vendor.trim() ? vendor.trim() : 'Email receipt',
        originalAmount != null && typeof originalCurrency === 'string'
          ? `${originalAmount} ${originalCurrency}` : '',
        exchangeRate != null ? `@${exchangeRate}` : '',
        `= ¥${amount.toLocaleString('ja-JP')}`,
      ].filter(Boolean).join(' ');

    const systemActor: AuthUser = {
      id: 0,
      name: 'email-ingest',
      email: 'email-ingest@system.local',
      role: 'ADMIN',
      canEditBlog: false,
      assignedPropertyIds: [],
      hostLevel: null,
    };

    try {
      const pending = await store.createPendingTransaction({
        propertyId: property.id,
        gcsPath,
        // OCR is skipped: the amount/date were already extracted from the email.
        ocrProcessed: true,
        transactionDate,
        debitAccount: typeof debitAccount === 'string' && debitAccount.trim() ? debitAccount.trim() : '通信費',
        debitAmount: amount,
        creditAccount: typeof creditAccount === 'string' && creditAccount.trim() ? creditAccount.trim() : '普通預金',
        creditAmount: amount,
        description: composedDescription,
        vendor: typeof vendor === 'string' && vendor.trim() ? vendor.trim() : undefined,
        sourceRef: ref,
      }, systemActor);
      return res.status(201).json({ id: pending.id, duplicate: false });
    } catch (err) {
      // Unique-index race: another delivery of the same message won the insert.
      if ((err as { code?: string }).code === '23505') {
        return res.status(200).json({ duplicate: true });
      }
      console.error('[email-ingest] failed to create pending transaction:', err);
      return res.status(500).json({ error: 'Failed to create pending transaction.' });
    }
  });

  // ── Ingest routing rules (admin UI) ─────────────────────────────────────────
  // Admin-only: rules decide which property absorbs expenses from any mailbox,
  // so property-scoped host access is not enough.

  // GET /api/finance/ingest-rules
  app.get('/api/finance/ingest-rules', requireAdmin, async (_req, res) => {
    return res.json(await store.listIngestRules());
  });

  // PUT /api/finance/ingest-rules — upsert one rule { email, propertyId }
  app.put('/api/finance/ingest-rules', requireAdmin, async (req, res) => {
    const { email, propertyId } = req.body ?? {};
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: 'A valid email is required.' });
    }
    if (typeof propertyId !== 'string' || !propertyId.trim()) {
      return res.status(400).json({ error: 'propertyId is required.' });
    }
    const property = await store.getProperty(propertyId.trim());
    if (!property) {
      return res.status(400).json({ error: `Unknown property: ${propertyId}` });
    }
    const rule = await store.upsertIngestRule(email, property.id, req.authUser!);
    return res.json(rule);
  });

  // DELETE /api/finance/ingest-rules?email=...
  app.delete('/api/finance/ingest-rules', requireAdmin, async (req, res) => {
    const email = typeof req.query.email === 'string' ? req.query.email : '';
    if (!email.trim()) {
      return res.status(400).json({ error: 'email query parameter is required.' });
    }
    const deleted = await store.deleteIngestRule(email, req.authUser!);
    return deleted ? res.status(204).end() : res.status(404).json({ error: 'Rule not found.' });
  });

  // GET /api/finance/properties — list properties accessible to current user
  app.get('/api/finance/properties', requireFinanceAccess, async (req, res) => {
    const actor = req.authUser!;
    const allProperties = await store.listProperties(false);
    const accessible = actor.role === 'ADMIN'
      ? allProperties
      : allProperties.filter((p) => actor.assignedPropertyIds.includes(p.id));
    return res.json(accessible.map((p) => ({ id: p.id, name: p.name })));
  });

  // GET /api/finance/transactions?propertyIds=a,b&year=2025
  app.get('/api/finance/transactions', requireFinanceAccess, async (req, res) => {
    const actor = req.authUser!;
    const raw = typeof req.query.propertyIds === 'string' ? req.query.propertyIds : '';
    const requested = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;

    let propertyIds: string[];
    if (actor.role === 'ADMIN') {
      if (requested.length > 0) {
        propertyIds = requested;
      } else {
        const all = await store.listProperties(false);
        propertyIds = all.map((p) => p.id);
      }
    } else {
      const allowed = actor.assignedPropertyIds;
      propertyIds = requested.length > 0
        ? requested.filter((id) => allowed.includes(id))
        : allowed;
    }

    const transactions = await store.listFinancialTransactions(propertyIds, Number.isFinite(year) ? year : undefined);

    const resolved = await Promise.all(
      transactions.map(async (t) => {
        if (t.receiptUrl?.startsWith('gcs://')) {
          return { ...t, receiptUrl: await objectStorage.getEvidenceAccessUrl(t.receiptUrl) };
        }
        return t;
      }),
    );
    return res.json(resolved);
  });

  // ── Pending transactions (未承認) ──────────────────────────────────────────

  // GET /api/finance/pending
  app.get('/api/finance/pending', requireFinanceAccess, async (req, res) => {
    const actor = req.authUser!;
    const requested = String(req.query.propertyIds ?? '').split(',').filter(Boolean);
    let propertyIds: string[];
    if (actor.role === 'ADMIN') {
      const all = await store.listProperties();
      propertyIds = requested.length > 0 ? requested : all.map((p) => p.id);
    } else {
      const allowed = actor.assignedPropertyIds;
      propertyIds = requested.length > 0 ? requested.filter((id) => allowed.includes(id)) : allowed;
    }
    const pendings = await store.listPendingTransactions(propertyIds);
    const resolved = await Promise.all(
      pendings.map(async (p) => ({
        ...p,
        receiptUrl: p.gcsPath.startsWith('gcs://')
          ? await objectStorage.getEvidenceAccessUrl(p.gcsPath)
          : p.gcsPath,
      })),
    );
    return res.json(resolved);
  });

  // POST /api/finance/pending/upload-single — OCR + compress + GCS + create record for one image
  app.post('/api/finance/pending/upload-single', requireFinanceAccess, async (req, res) => {
    const actor = req.authUser!;
    const { propertyId, imageBase64 } = req.body as { propertyId?: string; imageBase64?: string };

    if (!propertyId || !imageBase64) {
      return res.status(400).json({ error: 'propertyId and imageBase64 are required.' });
    }
    if (actor.role !== 'ADMIN' && !actor.assignedPropertyIds.includes(propertyId)) {
      return res.status(403).json({ error: 'Access denied to this property.' });
    }

    let base64Data = imageBase64;
    let mimeType = 'image/jpeg';
    const m = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (m) { mimeType = m[1]; base64Data = m[2]; }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      return res.status(400).json({ error: 'Only JPEG/PNG/WebP images are supported.' });
    }

    try {
      // 1. OCR first with raw image (better quality before compression).
      //    This is the slow step that must run sequentially per image.
      console.log('[upload-single] running OCR for property:', propertyId);
      const ocr = await receiptProcessing.processReceipt(base64Data, mimeType);
      console.log('[upload-single] OCR result:', JSON.stringify(ocr));

      // 2. Create pending record immediately. Use the raw image as a temporary
      //    data-URI receipt so it previews right away while GCS upload runs in background.
      const tempDataUri = `data:${mimeType};base64,${base64Data}`;
      const ocrHasData = !!(ocr.transactionDate || ocr.amount || ocr.vendor || ocr.description);
      const pending = await store.createPendingTransaction({
        propertyId,
        gcsPath: tempDataUri,
        ocrProcessed: ocrHasData,
        transactionDate: ocr.transactionDate ?? '',
        debitAccount: ocr.suggestedDebitAccount ?? '消耗品費',
        debitAmount: ocr.amount ?? 0,
        creditAccount: '普通預金',
        creditAmount: ocr.amount ?? 0,
        description: ocr.vendor
          ? `${ocr.vendor}${ocr.description ? ` - ${ocr.description}` : ''}`
          : (ocr.description ?? ''),
        vendor: ocr.vendor,
      }, actor);

      // 3. Respond now — the frontend can move on to the next image's OCR.
      res.status(201).json({ ...pending, receiptUrl: tempDataUri });

      // 4. Background: compress + upload to GCS, then swap the record's path to the GCS reference.
      void (async () => {
        const rawBuffer = Buffer.from(base64Data, 'base64');
        let compressed: { buffer: Buffer; mimeType: string };
        try {
          compressed = await objectStorage.compressReceiptToAvif(rawBuffer, mimeType);
        } catch (cErr) {
          console.error('[upload-single] compress failed for', pending.id, ':', cErr);
          return;
        }

        // Retry GCS upload a few times to absorb transient errors.
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const upload = await objectStorage.uploadReceiptImage({
              imageBuffer: compressed.buffer, mimeType: compressed.mimeType, propertyId,
            });
            await store.updatePendingTransaction(pending.id, { gcsPath: upload.evidenceUrl }, actor);
            console.log('[upload-single] background GCS upload done:', pending.id, upload.evidenceUrl);
            return;
          } catch (bgErr) {
            console.error(`[upload-single] GCS upload attempt ${attempt}/3 failed for ${pending.id}:`, bgErr);
            if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
          }
        }

        // Permanent failure: replace the heavy raw data-URI with the small compressed
        // one so the record stays approvable (image inlined) instead of stuck "uploading".
        try {
          const fallbackDataUri = `data:${compressed.mimeType};base64,${compressed.buffer.toString('base64')}`;
          await store.updatePendingTransaction(pending.id, { gcsPath: fallbackDataUri }, actor);
          console.warn('[upload-single] GCS upload gave up; kept inline image for', pending.id);
        } catch (fErr) {
          console.error('[upload-single] fallback update failed for', pending.id, ':', fErr);
        }
      })();
    } catch (err) {
      console.error('[upload-single] error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to process image.' });
    }
  });

  // POST /api/finance/pending/batch-upload — upload multiple images, create pending records (no OCR yet)
  app.post('/api/finance/pending/batch-upload', requireFinanceAccess, async (req, res) => {
    const actor = req.authUser!;
    const { propertyId, images } = req.body as { propertyId?: string; images?: string[] };

    if (!propertyId || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'propertyId and images[] are required.' });
    }
    if (actor.role !== 'ADMIN' && !actor.assignedPropertyIds.includes(propertyId)) {
      return res.status(403).json({ error: 'Access denied to this property.' });
    }
    if (images.length > 30) {
      return res.status(400).json({ error: 'Maximum 30 images per batch.' });
    }

    const results: { id: string; gcsPath: string }[] = [];
    for (const imageBase64 of images) {
      let base64Data = imageBase64;
      let mimeType = 'image/jpeg';
      const m = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (m) { mimeType = m[1]; base64Data = m[2]; }

      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) continue;

      try {
        const rawBuffer = Buffer.from(base64Data, 'base64');
        const compressed = await objectStorage.compressReceiptToAvif(rawBuffer, mimeType);
        const upload = await objectStorage.uploadReceiptImage({
          imageBuffer: compressed.buffer, mimeType: compressed.mimeType, propertyId,
        });
        const pending = await store.createPendingTransaction({ propertyId, gcsPath: upload.evidenceUrl }, actor);
        results.push({ id: pending.id, gcsPath: upload.evidenceUrl });
      } catch (err) {
        console.error('[batch-upload] image error:', err);
      }
    }

    return res.status(201).json({ uploaded: results.length, items: results });
  });

  // POST /api/finance/pending/process-ocr — run OCR on all unprocessed pending for a property
  app.post('/api/finance/pending/process-ocr', requireFinanceAccess, async (req, res) => {
    const actor = req.authUser!;
    const { propertyId } = req.body as { propertyId?: string };

    if (!propertyId) return res.status(400).json({ error: 'propertyId is required.' });
    if (actor.role !== 'ADMIN' && !actor.assignedPropertyIds.includes(propertyId)) {
      return res.status(403).json({ error: 'Access denied to this property.' });
    }

    const allPending = await store.listPendingTransactions([propertyId]);
    const unprocessed = allPending.filter((p) => !p.ocrProcessed);
    const processed: string[] = [];

    for (const pending of unprocessed) {
      try {
        console.log('[process-ocr] processing pending:', pending.id, 'gcsPath:', pending.gcsPath);
        const signedUrl = await objectStorage.getEvidenceAccessUrl(pending.gcsPath);
        console.log('[process-ocr] signedUrl prefix:', signedUrl.slice(0, 60));
        // Fetch image from GCS signed URL for OCR
        const imgRes = await fetch(signedUrl);
        console.log('[process-ocr] fetch status:', imgRes.status);
        if (!imgRes.ok) { console.error('[process-ocr] fetch failed:', imgRes.status, imgRes.statusText); continue; }
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
        console.log('[process-ocr] image bytes:', imgBuffer.length);
        // Stored receipts are AVIF, which Gemini cannot read — decode to JPEG first.
        const jpegBuffer = await objectStorage.decodeToJpeg(imgBuffer);
        const ocr = await receiptProcessing.processReceipt(jpegBuffer.toString('base64'), 'image/jpeg');
        console.log('[process-ocr] OCR result:', JSON.stringify(ocr));

        // Only mark as processed if OCR returned at least one meaningful field
        const ocrHasData = ocr.transactionDate || ocr.amount || ocr.vendor || ocr.description;
        if (!ocrHasData) { console.warn('[process-ocr] OCR returned no data, skipping'); continue; }

        await store.updatePendingTransaction(pending.id, {
          ocrProcessed: true,
          transactionDate: ocr.transactionDate ?? '',
          debitAccount: ocr.suggestedDebitAccount ?? '消耗品費',
          debitAmount: ocr.amount ?? 0,
          creditAccount: '普通預金',
          creditAmount: ocr.amount ?? 0,
          description: ocr.vendor
            ? `${ocr.vendor}${ocr.description ? ` - ${ocr.description}` : ''}`
            : (ocr.description ?? ''),
          vendor: ocr.vendor,
        }, actor);
        processed.push(pending.id);
      } catch (err) {
        console.error('[process-ocr] error for pending', pending.id, ':', err);
      }
    }

    return res.json({ processed: processed.length, total: unprocessed.length });
  });

  // PUT /api/finance/pending/:id — update pending transaction
  app.put('/api/finance/pending/:id', requireFinanceAccess, async (req, res) => {
    const actor = req.authUser!;
    const { id } = req.params as { id: string };
    const { propertyId, transactionDate, debitAccount, debitAmount, creditAccount, creditAmount, description, vendor } = req.body;
    if (propertyId !== undefined && actor.role !== 'ADMIN' && !actor.assignedPropertyIds.includes(propertyId)) {
      return res.status(403).json({ error: 'Access denied to the target property.' });
    }
    const txn = await store.updatePendingTransaction(id, {
      ...(propertyId !== undefined && { propertyId }),
      ...(transactionDate !== undefined && { transactionDate }),
      ...(debitAccount !== undefined && { debitAccount }),
      ...(debitAmount !== undefined && { debitAmount: Number(debitAmount) }),
      ...(creditAccount !== undefined && { creditAccount }),
      ...(creditAmount !== undefined && { creditAmount: Number(creditAmount) }),
      ...(description !== undefined && { description }),
      ...(vendor !== undefined && { vendor }),
    }, actor);
    return res.json(txn);
  });

  // POST /api/finance/pending/:id/approve — approve single pending → moves to journal
  app.post('/api/finance/pending/:id/approve', requireFinanceAccess, async (req, res) => {
    const actor = req.authUser!;
    const { id } = req.params as { id: string };
    const txn = await store.approvePendingTransaction(id, actor);
    return res.status(201).json(txn);
  });

  // DELETE /api/finance/pending/:id
  app.delete('/api/finance/pending/:id', requireFinanceAccess, async (req, res) => {
    const actor = req.authUser!;
    const { id } = req.params as { id: string };
    const deleted = await store.deletePendingTransaction(id, actor);
    // Also remove the receipt image from object storage (best-effort).
    if (deleted?.gcsPath) {
      objectStorage.deleteEvidenceObject(deleted.gcsPath).catch((err) => {
        console.error('[delete-pending] failed to delete receipt object:', err);
      });
    }
    return res.status(204).end();
  });

  // POST /api/finance/receipts/upload — compress, OCR, and store receipt image
  app.post('/api/finance/receipts/upload', requireFinanceAccess, async (req, res) => {
    const actor = req.authUser!;
    const { imageBase64, propertyId } = req.body as { imageBase64?: string; propertyId?: string };

    if (!imageBase64 || !propertyId) {
      return res.status(400).json({ error: 'imageBase64 and propertyId are required.' });
    }
    if (actor.role !== 'ADMIN' && !actor.assignedPropertyIds.includes(propertyId)) {
      return res.status(403).json({ error: 'Access denied to this property.' });
    }

    // Parse data URI or raw base64
    let base64Data = imageBase64;
    let mimeType = 'image/jpeg';
    const dataUriMatch = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (dataUriMatch) {
      mimeType = dataUriMatch[1];
      base64Data = dataUriMatch[2];
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      return res.status(400).json({ error: 'Only JPEG/PNG/WebP images are supported.' });
    }

    let rawBuffer: Buffer;
    try {
      rawBuffer = Buffer.from(base64Data, 'base64');
    } catch {
      return res.status(400).json({ error: 'Invalid base64 image.' });
    }

    // Compress to a small AVIF for storage.
    let compressed: { buffer: Buffer; mimeType: string };
    try {
      compressed = await objectStorage.compressReceiptToAvif(rawBuffer, mimeType);
    } catch {
      return res.status(400).json({ error: 'Could not process image.' });
    }

    // Run OCR (on the raw image, since Gemini cannot read AVIF) and upload in parallel.
    const [ocr, upload] = await Promise.all([
      receiptProcessing.processReceipt(base64Data, mimeType),
      objectStorage.uploadReceiptImage({ imageBuffer: compressed.buffer, mimeType: compressed.mimeType, propertyId }),
    ]);

    // Resolve GCS path to a signed URL for immediate use
    const receiptUrl = await objectStorage.getEvidenceAccessUrl(upload.evidenceUrl);

    return res.status(201).json({
      receiptUrl,
      gcsPath: upload.evidenceUrl,
      sizeBytes: upload.sizeBytes,
      ocr,
    });
  });

  // POST /api/finance/transactions — create single transaction
  app.post('/api/finance/transactions', requireFinanceAccess, async (req, res) => {
    const actor = req.authUser!;
    const { propertyId, transactionNo, transactionDate, debitAccount, debitAmount, creditAccount, creditAmount, description, receiptUrl } = req.body;

    if (!propertyId || !transactionDate) {
      return res.status(400).json({ error: 'propertyId and transactionDate are required.' });
    }
    if (actor.role !== 'ADMIN' && !actor.assignedPropertyIds.includes(propertyId)) {
      return res.status(403).json({ error: 'Access denied to this property.' });
    }

    const txn = await store.createFinancialTransaction({
      propertyId,
      transactionNo: transactionNo ?? '',
      transactionDate,
      debitAccount: debitAccount ?? '',
      debitAmount: Number(debitAmount ?? 0),
      creditAccount: creditAccount ?? '',
      creditAmount: Number(creditAmount ?? 0),
      description: description ?? '',
      receiptUrl: objectStorage.toStorageReference(receiptUrl ?? undefined),
    }, actor);
    return res.status(201).json(txn);
  });

  // PUT /api/finance/transactions/:id — update transaction
  app.put('/api/finance/transactions/:id', requireFinanceAccess, async (req, res) => {
    const actor = req.authUser!;
    const id = req.params.id as string;
    const { propertyId, transactionNo, transactionDate, debitAccount, debitAmount, creditAccount, creditAmount, description, receiptUrl } = req.body;
    if (propertyId !== undefined && actor.role !== 'ADMIN' && !actor.assignedPropertyIds.includes(propertyId)) {
      return res.status(403).json({ error: 'Access denied to the target property.' });
    }

    const txn = await store.updateFinancialTransaction(id, {
      ...(propertyId !== undefined && { propertyId }),
      ...(transactionNo !== undefined && { transactionNo }),
      ...(transactionDate !== undefined && { transactionDate }),
      ...(debitAccount !== undefined && { debitAccount }),
      ...(debitAmount !== undefined && { debitAmount: Number(debitAmount) }),
      ...(creditAccount !== undefined && { creditAccount }),
      ...(creditAmount !== undefined && { creditAmount: Number(creditAmount) }),
      ...(description !== undefined && { description }),
      ...(receiptUrl !== undefined && { receiptUrl: objectStorage.toStorageReference(receiptUrl) }),
    }, actor);
    return res.json(txn);
  });

  // DELETE /api/finance/transactions/:id
  app.delete('/api/finance/transactions/:id', requireFinanceAccess, async (req, res) => {
    const actor = req.authUser!;
    const deleted = await store.deleteFinancialTransaction(req.params.id as string, actor);
    // Also remove the receipt image from object storage (best-effort).
    if (deleted?.receiptUrl) {
      objectStorage.deleteEvidenceObject(deleted.receiptUrl).catch((err) => {
        console.error('[delete-transaction] failed to delete receipt object:', err);
      });
    }
    return res.status(204).end();
  });

  // POST /api/finance/transactions/bulk-import — import CSV rows
  app.post('/api/finance/transactions/bulk-import', requireFinanceAccess, async (req, res) => {
    const actor = req.authUser!;
    const { propertyId, transactions } = req.body;

    if (!propertyId || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'propertyId and transactions[] are required.' });
    }
    if (actor.role !== 'ADMIN' && !actor.assignedPropertyIds.includes(propertyId)) {
      return res.status(403).json({ error: 'Access denied to this property.' });
    }

    const results = await store.bulkImportFinancialTransactions(propertyId, transactions, actor);
    return res.status(201).json({ imported: results.length, transactions: results });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (typeof error === 'object' && error && 'code' in error && (error as { code?: string }).code === '23505') {
      return res.status(409).json({ error: 'Custom URL is already taken.' });
    }
    console.error(error);
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    res.status(500).json({ error: message });
  });

  return app;
}
