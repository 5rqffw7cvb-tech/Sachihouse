import cors from 'cors';
import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { addDays, format, isValid, parseISO } from 'date-fns';
import { canPerformAction } from './domain/authorization.js';
import { calculateQuote } from './domain/pricing.js';
import { verifyToken, signToken } from './auth/jwt.js';
import { AuthUser, BlogPost, DataStore, PropertyData, SiteSettings } from './store/types.js';
import { getParam } from './types/params.js';
import { Role } from './types/domain.js';
import { IcalSyncService } from './services/icalSync.js';

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

export function createApp(store: DataStore) {
  const app = express();
  const icalSync = new IcalSyncService({
    enabled: process.env.ICAL_SYNC_ENABLED !== 'false' && process.env.NODE_ENV !== 'test',
    ttlMs: Number(process.env.ICAL_SYNC_TTL_MS ?? 60000),
    timeoutMs: Number(process.env.ICAL_SYNC_TIMEOUT_MS ?? 5000),
  });

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
    const { name, email, password, role } = req.body ?? {};
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

    const user = await store.createUser(name, email, password, role, req.authUser!);
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

  app.get('/api/properties', async (_req, res) => {
    const properties = await store.listProperties();
    res.json({ properties });
  });

  app.get('/api/properties/:id', async (req, res) => {
    const property = await store.getProperty(req.params.id);
    if (!property) {
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
    const property = await store.createProperty(req.body as PropertyData, req.authUser!);
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
    const property = await store.saveProperty(current.id, req.body as PropertyData, req.authUser!);
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

  app.get('/api/site-settings', async (_req, res) => {
    const settings = await store.getSiteSettings();
    res.json({ settings });
  });

  app.put('/api/site-settings', requireAdmin, async (req, res) => {
    const settings = await store.saveSiteSettings(req.body as SiteSettings, req.authUser!);
    res.json({ settings });
  });

  app.get('/api/blog-posts', async (_req, res) => {
    const posts = await store.listBlogPosts();
    res.json({ posts });
  });

  app.get('/api/blog-posts/:id', async (req, res) => {
    const post = await store.getBlogPost(req.params.id);
    if (!post) {
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
    const isOwner = current.authorId === req.authUser!.id;
    if (!(req.authUser!.role === 'ADMIN' || isOwner)) {
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
    const isOwner = current.authorId === req.authUser!.id;
    if (!(req.authUser!.role === 'ADMIN' || isOwner)) {
      return res.status(403).json({ error: 'Blog delete not allowed.' });
    }
    await store.deleteBlogPost(postId, req.authUser!);
    res.status(204).send();
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

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (typeof error === 'object' && error && 'code' in error && (error as { code?: string }).code === '23505') {
      return res.status(409).json({ error: 'Custom URL is already taken.' });
    }
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    res.status(500).json({ error: message });
  });

  return app;
}
