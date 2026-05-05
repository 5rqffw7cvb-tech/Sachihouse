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

const ALLOWED_ROLES: Role[] = ['ADMIN', 'HOST', 'GUEST'];

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
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 100);
  }
  return (req.ip || req.socket.remoteAddress || 'unknown').slice(0, 100);
}

export function createApp(store: DataStore) {
  const app = express();
  const icalSync = new IcalSyncService({
    enabled: process.env.ICAL_SYNC_ENABLED !== 'false' && process.env.NODE_ENV !== 'test',
    ttlMs: Number(process.env.ICAL_SYNC_TTL_MS ?? 60000),
    timeoutMs: Number(process.env.ICAL_SYNC_TIMEOUT_MS ?? 5000),
  });
  const idProcessing = new IdProcessingService();
  const objectStorage = new ObjectStorageService();
  const ocrRateMap = new Map<string, { count: number; resetAt: number }>();
  const retentionDaysRaw = Number(process.env.CHECKIN_RETENTION_DAYS ?? 7);
  const checkInRetentionDays = Number.isFinite(retentionDaysRaw) && retentionDaysRaw > 0 ? Math.trunc(retentionDaysRaw) : 7;
  const checkInRetentionNoticeVersion = (process.env.CHECKIN_RETENTION_NOTICE_VERSION ?? 'v1').trim() || 'v1';

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

    const address = normalizeText(row.address) || 'NA';
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

  app.use(cors());
  app.use(helmet());
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan('dev'));

  app.use(async (req: Request, _res: Response, next: NextFunction) => {
    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      req.authUser = null;
      return next();
    }

    try {
      const payload = verifyToken(token);
      req.authUser = await store.getUserById(payload.sub);
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

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const user = await store.authenticate(email, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
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

    res.json({ properties: filtered });
  });

  app.get('/api/properties/:id', async (req, res) => {
    const property = await store.getProperty(req.params.id);
    const canReadArchived = property && property.archivedAt && req.authUser && canPerformAction(req.authUser, 'property.read', property.id);
    if (!property || (property.archivedAt && !canReadArchived)) {
      return res.status(404).json({ error: 'Property not found.' });
    }
    res.json({ property });
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

    if (rawBuffer.length > 12 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image is too large. Max 12MB.' });
    }

    const guestId = normalizeText(req.body?.guestId) || `guest_${Math.random().toString(36).slice(2, 8)}`;

    let compressed: { buffer: Buffer; mimeType: string };
    try {
      compressed = await objectStorage.compressImage(rawBuffer, parsed.mimeType);
    } catch {
      return res.status(400).json({ error: 'Uploaded payload is not a valid readable image.' });
    }

    const upload = await objectStorage.uploadEvidenceImage({
      imageBuffer: compressed.buffer,
      mimeType: compressed.mimeType,
      propertyId: property.id,
      guestId,
    });

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
      evidenceUrl: upload.evidenceUrl,
      evidenceMimeType: upload.mimeType,
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

    const consentRaw = req.body?.consent as Record<string, unknown> | undefined;
    const consentAccepted = toBoolean(consentRaw?.accepted);
    const consentAcceptedAt = toNonNegativeInt(consentRaw?.acceptedAt);
    const consentNoticeVersion = normalizeText(consentRaw?.noticeVersion);
    if (consentAccepted !== true || consentAcceptedAt === null || consentNoticeVersion !== checkInRetentionNoticeVersion) {
      return res.status(400).json({ error: 'Consent confirmation is required before submitting check-in.' });
    }

    const submittedAt = Date.now();

    const submission = await store.createCheckInSubmission({
      propertyId: property.id,
      checkInDate,
      checkOutDate,
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
    if (actor.role === 'HOST') {
      if ((actor.hostLevel ?? 0) < 3) {
        return res.status(403).json({ error: 'Check-in access requires host level 3. Contact admin.' });
      }
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
    const submission = await store.getCheckInSubmission(getParam(req.params.id));
    if (!submission) {
      return res.status(404).json({ error: 'Check-in submission not found.' });
    }

    if (!canPerformAction(req.authUser!, 'property.read', submission.propertyId)) {
      return res.status(403).json({ error: 'Check-in read not allowed.' });
    }

    const resolvedSubmission = await resolveSubmissionEvidence(submission);

    return res.json({ submission: resolvedSubmission });
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
