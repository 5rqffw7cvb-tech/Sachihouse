import { Pool } from 'pg';
import { blogPostsSeed, blockedDatesSeed, createUserSeed, propertiesSeed, siteSettingsSeed } from './seed.js';
import {
  AuthUser,
  BlogPost,
  CheckInGuest,
  CheckInListFilters,
  CheckInSubmission,
  CheckInSubmissionInput,
  DataStore,
  PropertyData,
  SiteSettings,
  StoredUser,
} from './types.js';
import { Role } from '../types/domain.js';

export class PostgresStore implements DataStore {
  constructor(private readonly pool: Pool) {}

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        name TEXT,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        can_edit_blog BOOLEAN NOT NULL DEFAULT FALSE,
        archived_at BIGINT
      );

      CREATE TABLE IF NOT EXISTS properties (
        id TEXT PRIMARY KEY,
        metalink TEXT NOT NULL UNIQUE,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS site_settings (
        id INTEGER PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS property_assignments (
        host_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        PRIMARY KEY (host_user_id, property_id)
      );

      CREATE TABLE IF NOT EXISTS blocked_dates (
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        blocked_date DATE NOT NULL,
        PRIMARY KEY (property_id, blocked_date)
      );

      CREATE TABLE IF NOT EXISTS blog_posts (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGSERIAL PRIMARY KEY,
        actor_user_id INTEGER,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS checkin_submissions (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        check_in_date DATE NOT NULL,
        check_out_date DATE NOT NULL,
        data JSONB NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_checkin_submissions_property_date
      ON checkin_submissions(property_id, check_in_date, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_checkin_submissions_created_at
      ON checkin_submissions(created_at DESC);
    `);

    await this.pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT');
    await this.pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS can_edit_blog BOOLEAN NOT NULL DEFAULT FALSE');
    await this.pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at BIGINT');
    await this.pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS checkin_permission_from DATE');
    await this.pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS host_level INT');
    await this.pool.query("UPDATE users SET name = split_part(email, '@', 1) WHERE name IS NULL OR trim(name) = ''");

    // Add translations column to properties table if it doesn't exist
    await this.pool.query('ALTER TABLE properties ADD COLUMN IF NOT EXISTS translations JSONB DEFAULT NULL');

    const existing = await this.pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');
    if (existing.rows[0]?.count !== '0') {
      return;
    }

    const users = await createUserSeed();
    for (const user of users) {
      await this.pool.query(
        'INSERT INTO users (id, name, email, role, password_hash) VALUES ($1, $2, $3, $4, $5)',
        [user.id, user.name, user.email, user.role, user.passwordHash],
      );
    }

    for (const user of users) {
      await this.pool.query(
        'UPDATE users SET can_edit_blog = $2, archived_at = $3 WHERE id = $1',
        [user.id, user.canEditBlog, user.archivedAt ?? null],
      );
    }

    for (const property of propertiesSeed) {
      await this.pool.query(
        'INSERT INTO properties (id, metalink, data) VALUES ($1, $2, $3::jsonb)',
        [property.id, property.metalink, JSON.stringify(property)],
      );
    }

    await this.pool.query(
      'INSERT INTO site_settings (id, data) VALUES (1, $1::jsonb)',
      [JSON.stringify(siteSettingsSeed)],
    );

    for (const [propertyId, dates] of Object.entries(blockedDatesSeed)) {
      for (const blockedDate of dates) {
        await this.pool.query(
          'INSERT INTO blocked_dates (property_id, blocked_date) VALUES ($1, $2)',
          [propertyId, blockedDate],
        );
      }
    }

    for (const post of blogPostsSeed) {
      await this.pool.query(
        'INSERT INTO blog_posts (id, data, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4)',
        [post.id, JSON.stringify(post), post.createdAt, post.updatedAt],
      );
    }

    const host = users.find((user) => user.role === 'HOST');
    if (host) {
      for (const propertyId of host.assignedPropertyIds) {
        await this.pool.query(
          'INSERT INTO property_assignments (host_user_id, property_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [host.id, propertyId],
        );
      }
    }
  }

  private async getAssignedPropertyIds(userId: number): Promise<string[]> {
    const result = await this.pool.query<{ property_id: string }>(
      'SELECT property_id FROM property_assignments WHERE host_user_id = $1 ORDER BY property_id',
      [userId],
    );
    return result.rows.map((row: { property_id: string }) => row.property_id);
  }

  private async mapUser(row: { id: number; name: string; email: string; role: AuthUser['role']; can_edit_blog: boolean; archived_at: number | null; host_level?: number | null }): Promise<AuthUser> {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      canEditBlog: row.can_edit_blog,
      archivedAt: row.archived_at,
      assignedPropertyIds: row.role === 'HOST' ? await this.getAssignedPropertyIds(row.id) : [],
      hostLevel: (row.host_level as 1 | 2 | 3 | null) ?? null,
    };
  }

  async authenticate(email: string, password: string): Promise<AuthUser | null> {
    const result = await this.pool.query<{ id: number; name: string; email: string; role: AuthUser['role']; password_hash: string; can_edit_blog: boolean; archived_at: number | null; host_level?: number | null }>(
      'SELECT id, name, email, role, password_hash, can_edit_blog, archived_at, host_level FROM users WHERE lower(email) = lower($1) AND archived_at IS NULL',
      [email],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const bcrypt = await import('bcryptjs');
    const matches = await bcrypt.default.compare(password, row.password_hash);
    return matches ? this.mapUser(row) : null;
  }

  async getUserById(id: number): Promise<AuthUser | null> {
    const result = await this.pool.query<{ id: number; name: string; email: string; role: AuthUser['role']; can_edit_blog: boolean; archived_at: number | null; host_level?: number | null }>(
      'SELECT id, name, email, role, can_edit_blog, archived_at, host_level FROM users WHERE id = $1 AND archived_at IS NULL',
      [id],
    );
    const row = result.rows[0];
    return row ? this.mapUser(row) : null;
  }

  async listUsers(): Promise<AuthUser[]> {
    const result = await this.pool.query<{ id: number; name: string; email: string; role: AuthUser['role']; can_edit_blog: boolean; archived_at: number | null; host_level?: number | null }>('SELECT id, name, email, role, can_edit_blog, archived_at, host_level FROM users ORDER BY id');
    return Promise.all(result.rows.map((row) => this.mapUser(row)));
  }

  async createUser(name: string, email: string, password: string, role: Role, canEditBlog: boolean, actor: AuthUser): Promise<AuthUser> {
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedName) {
      throw new Error('Name is required.');
    }
    const existing = await this.pool.query<{ id: number }>('SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1', [normalizedEmail]);
    if (existing.rowCount) {
      throw new Error('Email is already in use.');
    }

    const idResult = await this.pool.query<{ next_id: number }>('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM users');
    const nextId = idResult.rows[0]?.next_id ?? 1;

    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.default.hash(password, 10);
    const insertResult = await this.pool.query<{ id: number; name: string; email: string; role: AuthUser['role']; can_edit_blog: boolean; archived_at: number | null; host_level?: number | null }>(
      'INSERT INTO users (id, name, email, role, password_hash, can_edit_blog, archived_at) VALUES ($1, $2, $3, $4, $5, $6, NULL) RETURNING id, name, email, role, can_edit_blog, archived_at, host_level',
      [nextId, normalizedName, normalizedEmail, role, passwordHash, canEditBlog],
    );
    const created = await this.mapUser(insertResult.rows[0]);
    await this.writeAudit(actor.id, 'CREATE', 'user', String(created.id));
    return created;
  }

  async updateUserName(userId: number, name: string, actor: AuthUser): Promise<AuthUser> {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new Error('Name is required.');
    }

    const updateResult = await this.pool.query<{ id: number; name: string; email: string; role: AuthUser['role']; can_edit_blog: boolean; archived_at: number | null; host_level?: number | null }>(
      'UPDATE users SET name = $2 WHERE id = $1 RETURNING id, name, email, role, can_edit_blog, archived_at, host_level',
      [userId, normalizedName],
    );
    const row = updateResult.rows[0];
    if (!row) {
      throw new Error('User not found.');
    }

    await this.writeAudit(actor.id, 'UPDATE_NAME', 'user', String(userId));
    return this.mapUser(row);
  }

  async updateUserEmail(userId: number, email: string, actor: AuthUser): Promise<AuthUser> {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.pool.query<{ id: number }>('SELECT id FROM users WHERE lower(email) = lower($1) AND id <> $2 LIMIT 1', [normalizedEmail, userId]);
    if (existing.rowCount) {
      throw new Error('Email is already in use.');
    }

    const updateResult = await this.pool.query<{ id: number; name: string; email: string; role: AuthUser['role']; can_edit_blog: boolean; archived_at: number | null; host_level?: number | null }>(
      'UPDATE users SET email = $2 WHERE id = $1 RETURNING id, name, email, role, can_edit_blog, archived_at, host_level',
      [userId, normalizedEmail],
    );
    const row = updateResult.rows[0];
    if (!row) {
      throw new Error('User not found.');
    }

    await this.writeAudit(actor.id, 'UPDATE_EMAIL', 'user', String(userId));
    return this.mapUser(row);
  }

  async updateUserRole(userId: number, role: Role, actor: AuthUser): Promise<AuthUser> {
    const updateResult = await this.pool.query<{ id: number; name: string; email: string; role: AuthUser['role']; can_edit_blog: boolean; archived_at: number | null; host_level?: number | null }>(
      'UPDATE users SET role = $2 WHERE id = $1 RETURNING id, name, email, role, can_edit_blog, archived_at, host_level',
      [userId, role],
    );
    const row = updateResult.rows[0];
    if (!row) {
      throw new Error('User not found.');
    }

    if (role !== 'HOST') {
      await this.pool.query('DELETE FROM property_assignments WHERE host_user_id = $1', [userId]);
    }

    await this.writeAudit(actor.id, 'UPDATE_ROLE', 'user', String(userId));
    return this.mapUser(row);
  }

  async updateUserCanEditBlog(userId: number, canEditBlog: boolean, actor: AuthUser): Promise<AuthUser> {
    const updateResult = await this.pool.query<{ id: number; name: string; email: string; role: AuthUser['role']; can_edit_blog: boolean; archived_at: number | null; host_level?: number | null }>(
      'UPDATE users SET can_edit_blog = $2 WHERE id = $1 RETURNING id, name, email, role, can_edit_blog, archived_at, host_level',
      [userId, canEditBlog],
    );
    const row = updateResult.rows[0];
    if (!row) {
      throw new Error('User not found.');
    }

    await this.writeAudit(actor.id, canEditBlog ? 'ENABLE_BLOG_EDITOR' : 'DISABLE_BLOG_EDITOR', 'user', String(userId));
    return this.mapUser(row);
  }

  async updateUserHostLevel(userId: number, level: 1 | 2 | 3 | null, actor: AuthUser): Promise<AuthUser> {
    const updateResult = await this.pool.query<{ id: number; name: string; email: string; role: AuthUser['role']; can_edit_blog: boolean; archived_at: number | null; host_level?: number | null }>(
      'UPDATE users SET host_level = $2 WHERE id = $1 RETURNING id, name, email, role, can_edit_blog, archived_at, host_level',
      [userId, level],
    );
    const row = updateResult.rows[0];
    if (!row) {
      throw new Error('User not found.');
    }
    await this.writeAudit(actor.id, level !== null ? 'SET_HOST_LEVEL' : 'REVOKE_HOST_LEVEL', 'user', String(userId));
    return this.mapUser(row);
  }

  async setUserArchived(userId: number, archived: boolean, actor: AuthUser): Promise<AuthUser> {
    const updateResult = await this.pool.query<{ id: number; name: string; email: string; role: AuthUser['role']; can_edit_blog: boolean; archived_at: number | null; host_level?: number | null }>(
      'UPDATE users SET archived_at = $2 WHERE id = $1 RETURNING id, name, email, role, can_edit_blog, archived_at, host_level',
      [userId, archived ? Date.now() : null],
    );
    const row = updateResult.rows[0];
    if (!row) {
      throw new Error('User not found.');
    }

    await this.writeAudit(actor.id, archived ? 'ARCHIVE' : 'UNARCHIVE', 'user', String(userId));
    return this.mapUser(row);
  }

  async updateUserPassword(userId: number, password: string, actor: AuthUser): Promise<void> {
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.default.hash(password, 10);
    const result = await this.pool.query<{ id: number }>('UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING id', [userId, passwordHash]);
    if (!result.rowCount) {
      throw new Error('User not found.');
    }
    await this.writeAudit(actor.id, 'RESET_PASSWORD', 'user', String(userId));
  }

  async deleteUser(userId: number, actor: AuthUser): Promise<void> {
    const result = await this.pool.query<{ id: number }>('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
    if (!result.rowCount) {
      throw new Error('User not found.');
    }
    await this.writeAudit(actor.id, 'DELETE', 'user', String(userId));
  }

  async listProperties(includeArchived = false): Promise<Array<PropertyData & { id: string }>> {
    const result = await this.pool.query<{ id: string; data: PropertyData }>('SELECT id, data FROM properties ORDER BY id');
    return result.rows
      .map((row: { id: string; data: PropertyData }) => ({ ...row.data, id: row.id }))
      .filter((property) => includeArchived || !property.archivedAt);
  }

  async getProperty(idOrMetalink: string): Promise<(PropertyData & { id: string }) | null> {
    const result = await this.pool.query<{ id: string; data: PropertyData }>(
      'SELECT id, data FROM properties WHERE id = $1 OR metalink = $1 LIMIT 1',
      [idOrMetalink],
    );
    const row = result.rows[0];
    return row ? { ...row.data, id: row.id } : null;
  }

  async createProperty(property: PropertyData, actor: AuthUser): Promise<PropertyData & { id: string }> {
    const id = property.id ?? `list_${Math.random().toString(36).slice(2, 7)}`;
    const record = { ...property, id };
    await this.pool.query(
      'INSERT INTO properties (id, metalink, data) VALUES ($1, $2, $3::jsonb)',
      [id, record.metalink ?? id, JSON.stringify(record)],
    );
    await this.writeAudit(actor.id, 'CREATE', 'property', id);
    return record;
  }

  async renameProperty(propertyId: string, newPropertyId: string, property: PropertyData, actor: AuthUser): Promise<PropertyData & { id: string }> {
    const current = await this.getProperty(propertyId);
    if (!current) {
      throw new Error('Property not found.');
    }

    const targetId = newPropertyId.trim();
    if (!targetId) {
      throw new Error('New property id is required.');
    }
    if (targetId === current.id) {
      return this.saveProperty(current.id, property, actor);
    }

    const existingTarget = await this.getProperty(targetId);
    if (existingTarget) {
      throw new Error('Property id is already in use.');
    }

    const next = { ...current, ...property, id: targetId };
    const desiredMetalink = next.metalink ?? targetId;
    const needsTempMetalink = current.metalink === desiredMetalink;
    const tempMetalink = `${desiredMetalink}__move_${Date.now()}`;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        'INSERT INTO properties (id, metalink, data, updated_at) VALUES ($1, $2, $3::jsonb, NOW())',
        [targetId, needsTempMetalink ? tempMetalink : desiredMetalink, JSON.stringify(next)],
      );

      await client.query('UPDATE property_assignments SET property_id = $2 WHERE property_id = $1', [current.id, targetId]);
      await client.query('UPDATE blocked_dates SET property_id = $2 WHERE property_id = $1', [current.id, targetId]);
      await client.query('UPDATE checkin_submissions SET property_id = $2 WHERE property_id = $1', [current.id, targetId]);

      await client.query('DELETE FROM properties WHERE id = $1', [current.id]);

      if (needsTempMetalink) {
        await client.query('UPDATE properties SET metalink = $2, updated_at = NOW() WHERE id = $1', [targetId, desiredMetalink]);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    await this.writeAudit(actor.id, 'REKEY', 'property', `${current.id}->${targetId}`);
    return next;
  }

  async saveProperty(propertyId: string, property: PropertyData, actor: AuthUser): Promise<PropertyData & { id: string }> {
    const current = await this.getProperty(propertyId);
    if (!current) {
      throw new Error('Property not found.');
    }
    const next = { ...current, ...property, id: current.id };
    await this.pool.query(
      'UPDATE properties SET metalink = $2, data = $3::jsonb, updated_at = NOW() WHERE id = $1',
      [current.id, next.metalink ?? current.id, JSON.stringify(next)],
    );
    await this.writeAudit(actor.id, 'UPDATE', 'property', current.id);
    return next;
  }

  async setPropertyArchived(propertyId: string, archived: boolean, actor: AuthUser): Promise<PropertyData & { id: string }> {
    const current = await this.getProperty(propertyId);
    if (!current) {
      throw new Error('Property not found.');
    }

    const next = { ...current, archivedAt: archived ? Date.now() : null };
    await this.pool.query(
      'UPDATE properties SET data = $2::jsonb, updated_at = NOW() WHERE id = $1',
      [current.id, JSON.stringify(next)],
    );
    await this.writeAudit(actor.id, archived ? 'ARCHIVE' : 'UNARCHIVE', 'property', current.id);
    return next;
  }

  async deleteProperty(propertyId: string, actor: AuthUser): Promise<void> {
    await this.pool.query('DELETE FROM properties WHERE id = $1', [propertyId]);
    await this.writeAudit(actor.id, 'DELETE', 'property', propertyId);
  }

  async getSiteSettings(): Promise<SiteSettings> {
    const result = await this.pool.query<{ data: SiteSettings }>('SELECT data FROM site_settings WHERE id = 1');
    const stored = result.rows[0]?.data;
    return { ...siteSettingsSeed, ...(stored ?? {}) };
  }

  async saveSiteSettings(settings: SiteSettings, actor: AuthUser): Promise<SiteSettings> {
    const next = { ...siteSettingsSeed, ...settings };
    await this.pool.query(
      'INSERT INTO site_settings (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()',
      [JSON.stringify(next)],
    );
    await this.writeAudit(actor.id, 'UPDATE', 'site_settings', '1');
    return next;
  }

  async listBlockedDates(propertyId: string): Promise<string[]> {
    const property = await this.getProperty(propertyId);
    if (!property) {
      return [];
    }
    const result = await this.pool.query<{ blocked_date: string }>(
      'SELECT blocked_date::text FROM blocked_dates WHERE property_id = $1 ORDER BY blocked_date',
      [property.id],
    );
    return result.rows.map((row: { blocked_date: string }) => row.blocked_date);
  }

  async listBlogPosts(includeArchived = false): Promise<BlogPost[]> {
    const result = await this.pool.query<{ data: BlogPost }>('SELECT data FROM blog_posts ORDER BY created_at DESC');
    return result.rows
      .map((row: { data: BlogPost }) => row.data)
      .filter((post) => includeArchived || !post.archivedAt);
  }

  async getBlogPost(id: string): Promise<BlogPost | null> {
    const result = await this.pool.query<{ data: BlogPost }>('SELECT data FROM blog_posts WHERE id = $1', [id]);
    return result.rows[0]?.data ?? null;
  }

  async createBlogPost(post: Omit<BlogPost, 'createdAt' | 'updatedAt'>, actor: AuthUser): Promise<BlogPost> {
    const next: BlogPost = { ...post, createdAt: Date.now(), updatedAt: Date.now() };
    await this.pool.query(
      'INSERT INTO blog_posts (id, data, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4)',
      [next.id, JSON.stringify(next), next.createdAt, next.updatedAt],
    );
    await this.writeAudit(actor.id, 'CREATE', 'blog_post', next.id);
    return next;
  }

  async updateBlogPost(id: string, post: Partial<Omit<BlogPost, 'id' | 'createdAt' | 'authorId'>>, actor: AuthUser): Promise<BlogPost> {
    const current = await this.getBlogPost(id);
    if (!current) {
      throw new Error('Blog post not found.');
    }
    const next = { ...current, ...post, updatedAt: Date.now() };
    await this.pool.query(
      'UPDATE blog_posts SET data = $2::jsonb, updated_at = $3 WHERE id = $1',
      [id, JSON.stringify(next), next.updatedAt],
    );
    await this.writeAudit(actor.id, 'UPDATE', 'blog_post', id);
    return next;
  }

  async setBlogPostArchived(id: string, archived: boolean, actor: AuthUser): Promise<BlogPost> {
    const current = await this.getBlogPost(id);
    if (!current) {
      throw new Error('Blog post not found.');
    }

    const next = { ...current, archivedAt: archived ? Date.now() : null, updatedAt: Date.now() };
    await this.pool.query(
      'UPDATE blog_posts SET data = $2::jsonb, updated_at = $3 WHERE id = $1',
      [id, JSON.stringify(next), next.updatedAt],
    );
    await this.writeAudit(actor.id, archived ? 'ARCHIVE' : 'UNARCHIVE', 'blog_post', id);
    return next;
  }

  async deleteBlogPost(id: string, actor: AuthUser): Promise<void> {
    await this.pool.query('DELETE FROM blog_posts WHERE id = $1', [id]);
    await this.writeAudit(actor.id, 'DELETE', 'blog_post', id);
  }

  async assignHost(propertyId: string, hostUserId: number, actor: AuthUser): Promise<void> {
    const hostCheck = await this.pool.query<{ id: number }>('SELECT id FROM users WHERE id = $1 AND role = $2', [hostUserId, 'HOST']);
    if (!hostCheck.rowCount) {
      throw new Error('Only HOST users can be assigned to properties.');
    }
    await this.pool.query(
      'INSERT INTO property_assignments (host_user_id, property_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [hostUserId, propertyId],
    );
    await this.writeAudit(actor.id, 'ASSIGN_HOST', 'property', propertyId);
  }

  async unassignHost(propertyId: string, hostUserId: number, actor: AuthUser): Promise<void> {
    await this.pool.query('DELETE FROM property_assignments WHERE host_user_id = $1 AND property_id = $2', [hostUserId, propertyId]);
    await this.writeAudit(actor.id, 'UNASSIGN_HOST', 'property', propertyId);
  }

  async createCheckInSubmission(input: CheckInSubmissionInput): Promise<CheckInSubmission> {
    const now = Date.now();
    const row: CheckInSubmission = {
      id: `ci_${Math.random().toString(36).slice(2, 10)}`,
      propertyId: input.propertyId,
      checkInDate: input.checkInDate,
      checkOutDate: input.checkOutDate,
      guests: input.guests,
      consent: structuredClone(input.consent),
      audit: structuredClone(input.audit),
      createdAt: now,
      updatedAt: now,
    };

    await this.pool.query(
      'INSERT INTO checkin_submissions (id, property_id, check_in_date, check_out_date, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)',
      [row.id, row.propertyId, row.checkInDate, row.checkOutDate, JSON.stringify(row), row.createdAt, row.updatedAt],
    );

    return structuredClone(row);
  }

  async listCheckInSubmissions(filters?: CheckInListFilters): Promise<CheckInSubmission[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];

    if (filters?.propertyId) {
      values.push(filters.propertyId);
      clauses.push(`property_id = $${values.length}`);
    }
    if (filters?.fromDate) {
      values.push(filters.fromDate);
      clauses.push(`check_in_date >= $${values.length}`);
    }
    if (filters?.toDate) {
      values.push(filters.toDate);
      clauses.push(`check_in_date <= $${values.length}`);
    }

    const query = `
      SELECT data
      FROM checkin_submissions
      ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY created_at DESC
    `;

    const result = await this.pool.query<{ data: CheckInSubmission }>(query, values);
    const guestNameNeedle = filters?.guestName?.trim().toLowerCase() ?? '';
    const nationalityNeedle = filters?.nationality?.trim().toLowerCase() ?? '';

    return result.rows
      .map((row) => row.data)
      .filter((submission) => {
        if (guestNameNeedle && !submission.guests.some((guest) => guest.fullName.toLowerCase().includes(guestNameNeedle))) {
          return false;
        }
        if (nationalityNeedle && !submission.guests.some((guest) => guest.nationality.toLowerCase().includes(nationalityNeedle))) {
          return false;
        }
        return true;
      });
  }

  async getCheckInSubmission(id: string): Promise<CheckInSubmission | null> {
    const result = await this.pool.query<{ data: CheckInSubmission }>('SELECT data FROM checkin_submissions WHERE id = $1 LIMIT 1', [id]);
    return result.rows[0]?.data ?? null;
  }

  async updateCheckInSubmission(
    id: string,
    patch: {
      checkInDate?: string;
      checkOutDate?: string;
      guests?: CheckInGuest[];
    },
  ): Promise<CheckInSubmission | null> {
    const current = await this.getCheckInSubmission(id);
    if (!current) {
      return null;
    }

    const next: CheckInSubmission = {
      ...current,
      checkInDate: patch.checkInDate ?? current.checkInDate,
      checkOutDate: patch.checkOutDate ?? current.checkOutDate,
      guests: patch.guests ? structuredClone(patch.guests) : structuredClone(current.guests),
      updatedAt: Date.now(),
    };

    await this.pool.query(
      'UPDATE checkin_submissions SET check_in_date = $2, check_out_date = $3, data = $4::jsonb, updated_at = $5 WHERE id = $1',
      [id, next.checkInDate, next.checkOutDate, JSON.stringify(next), next.updatedAt],
    );

    return structuredClone(next);
  }

  async deleteCheckInSubmission(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM checkin_submissions WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async deleteExpiredCheckInSubmissions(olderThanTimestamp: number): Promise<CheckInSubmission[]> {
    const result = await this.pool.query<{ data: CheckInSubmission }>(
      'DELETE FROM checkin_submissions WHERE created_at < $1 RETURNING data',
      [olderThanTimestamp],
    );

    return result.rows.map((row) => row.data);
  }

  private async writeAudit(actorUserId: number, action: string, targetType: string, targetId: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO audit_logs (actor_user_id, action, target_type, target_id) VALUES ($1, $2, $3, $4)',
      [actorUserId, action, targetType, targetId],
    );
  }
}
