import cors from 'cors';
import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { addDays, format, isValid, parseISO } from 'date-fns';
import { canPerformAction } from './domain/authorization.js';
import { calculateQuote } from './domain/pricing.js';
import { signCheckInToken, verifyCheckInToken, verifyToken, signToken } from './auth/jwt.js';
import {
  AuthUser,
  BlogPost,
  CheckInGuest,
  CheckInListFilters,
  CheckInSubmission,
  DataStore,
  PropertyData,
  SiteSettings,
} from './store/types.js';
import { getParam } from './types/params.js';
import { Role } from './types/domain.js';
import { IcalSyncService } from './services/icalSync.js';
import { IdProcessingService } from './services/idProcessing.js';
import { ObjectStorageService } from './services/objectStorage.js';
import { ReceiptProcessingService } from './services/receiptProcessing.js';
import { TranslationService } from './services/translationService.js';

const ALLOWED_ROLES: Role[] = ['ADMIN', 'HOST', 'GUEST'];
const CHECKIN_OCR_MAX_IMAGE_BYTES = Number(process.env.CHECKIN_OCR_MAX_IMAGE_MB ?? 20) * 1024 * 1024;

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ALLOWED_ROLES.includes(value as Role);
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

export function createApp(store: DataStore) {
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
  const ocrRateMap = new Map<string, { count: number; resetAt: number }>();
  const retentionDaysRaw = Number(process.env.CHECKIN_RETENTION_DAYS ?? 7);
  const checkInRetentionDays = Number.isFinite(retentionDaysRaw) && retentionDaysRaw > 0 ? Math.trunc(retentionDaysRaw) : 7;
  const checkInRetentionNoticeVersion = (process.env.CHECKIN_RETENTION_NOTICE_VERSION ?? 'v1').trim() || 'v1';
  const loginAttemptMap = new Map<string, { fails: number; lockUntil: number }>();
  const loginMaxFails = Math.max(3, Number(process.env.LOGIN_MAX_FAILS ?? 5));
  const loginLockMs = Math.max(30_000, Number(process.env.LOGIN_LOCK_SECONDS ?? 120) * 1000);
  // Cloudflare's published always-pass test secret, used only as a local-dev fallback
  // when TURNSTILE_SECRET_KEY isn't configured. https://developers.cloudflare.com/turnstile/troubleshooting/testing/
  const turnstileSecretKey = process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA';

  async function getEffectiveBlockedDates(
    property: PropertyData & { id: string },
    mode: 'stale-ok' | 'fresh-if-stale',
  ): Promise<string[]> {
    const baseDates = await store.listBlockedDates(property.id);
    return icalSync.getBlockedDates(property, baseDates, mode);
  }

  function getRequestedDates(checkIn: string, checkOut: string): string[] {
    const start = parseISO(checkIn);
    const end = parseISO(checkOut);
    if (!isValid(start) || !isValid(end) || !(start < end)) {
      throw new Error('Invalid check-in/check-out dates.');
    }

    const dates: string[] = [];
    for (let cursor = start; cursor < end; cursor = addDays(cursor, 1)) {
      dates.push(format(cursor, 'yyyy-MM-dd'));
    }
    return dates;
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
  app.use((req, res, next) => {
    const isImageRoute = req.path.endsWith('/checkins/ocr')
      || req.path.endsWith('/checkins/submit')
      || req.path.endsWith('/finance/pending/upload-single')
      || req.path.endsWith('/finance/pending/batch-upload')
      || req.path.endsWith('/finance/receipts/upload')
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
    // level = 1 | 2 | 3 | null (null = revoke)
    if (level !== null && level !== undefined && ![1, 2, 3].includes(Number(level))) {
      return res.status(400).json({ error: 'level must be 1, 2, 3, or null.' });
    }
    const resolvedLevel = level != null ? (Number(level) as 1 | 2 | 3) : null;
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

    res.json({ properties: filtered.map((property) => applyPropertyLocalization(property, lang)) });
  });

  app.get('/api/properties/:id', async (req, res) => {
    const lang = toLanguageCode(req.query.lang);
    const property = await store.getProperty(req.params.id);
    const canReadArchived = property && property.archivedAt && req.authUser && canPerformAction(req.authUser, 'property.read', property.id);
    const canReadPending = property && property.reviewStatus === 'pending_review' && canViewPendingProperty(req.authUser, property.id);
    if (!property || (property.archivedAt && !canReadArchived) || (property.reviewStatus === 'pending_review' && !canReadPending)) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    res.json({ property: applyPropertyLocalization(property, lang) });
  });

  app.get('/api/properties/:id/blocked-dates', async (req, res) => {
    const property = await store.getProperty(req.params.id);
    if (!property) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    const blockedDates = await getEffectiveBlockedDates(property, 'stale-ok');
    res.json({ blockedDates });
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
      requestedDates = getRequestedDates(quoteInput.checkIn, quoteInput.checkOut);
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
    if (guests.some((guest) => !guest.evidenceUrl)) {
      return res.status(400).json({ error: 'Every guest must include an ID evidence image.' });
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
    });

    return res.status(201).json({ submission });
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

  // ── Finance API ─────────────────────────────────────────────────────────────

  // GET /api/finance/properties — list properties accessible to current user
  app.get('/api/finance/properties', requireHostOrAdmin, async (req, res) => {
    const actor = req.authUser!;
    const allProperties = await store.listProperties(false);
    const accessible = actor.role === 'ADMIN'
      ? allProperties
      : allProperties.filter((p) => actor.assignedPropertyIds.includes(p.id));
    return res.json(accessible.map((p) => ({ id: p.id, name: p.name })));
  });

  // GET /api/finance/transactions?propertyIds=a,b&year=2025
  app.get('/api/finance/transactions', requireHostOrAdmin, async (req, res) => {
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
  app.get('/api/finance/pending', requireHostOrAdmin, async (req, res) => {
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
  app.post('/api/finance/pending/upload-single', requireHostOrAdmin, async (req, res) => {
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
  app.post('/api/finance/pending/batch-upload', requireHostOrAdmin, async (req, res) => {
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
  app.post('/api/finance/pending/process-ocr', requireHostOrAdmin, async (req, res) => {
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
  app.put('/api/finance/pending/:id', requireHostOrAdmin, async (req, res) => {
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
  app.post('/api/finance/pending/:id/approve', requireHostOrAdmin, async (req, res) => {
    const actor = req.authUser!;
    const { id } = req.params as { id: string };
    const txn = await store.approvePendingTransaction(id, actor);
    return res.status(201).json(txn);
  });

  // DELETE /api/finance/pending/:id
  app.delete('/api/finance/pending/:id', requireHostOrAdmin, async (req, res) => {
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
  app.post('/api/finance/receipts/upload', requireHostOrAdmin, async (req, res) => {
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
  app.post('/api/finance/transactions', requireHostOrAdmin, async (req, res) => {
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
  app.put('/api/finance/transactions/:id', requireHostOrAdmin, async (req, res) => {
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
  app.delete('/api/finance/transactions/:id', requireHostOrAdmin, async (req, res) => {
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
  app.post('/api/finance/transactions/bulk-import', requireHostOrAdmin, async (req, res) => {
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
