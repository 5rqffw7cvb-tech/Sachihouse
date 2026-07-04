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
  FinancialTransaction,
  FinancialTransactionInput,
  PendingTransaction,
  PendingTransactionInput,
  IngestRule,
  PropertyData,
  SiteSettings,
  StoredUser,
  SubscriptionRequest,
  SubscriptionRequestStatus,
  HostPlanCode,
  BillingCycle,
} from './types.js';
import { Role } from '../types/domain.js';

export class PostgresStore implements DataStore {
  constructor(private readonly pool: Pool) {}

  private hydrateCheckInSubmission(row: {
    data: CheckInSubmission;
    property_id: string;
    check_in_date: string;
    check_out_date: string;
  }): CheckInSubmission {
    return {
      ...row.data,
      propertyId: row.property_id,
      checkInDate: row.check_in_date,
      checkOutDate: row.check_out_date,
    };
  }

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

      CREATE TABLE IF NOT EXISTS financial_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        transaction_no TEXT NOT NULL DEFAULT '',
        transaction_date DATE NOT NULL,
        debit_account TEXT NOT NULL DEFAULT '',
        debit_amount INTEGER NOT NULL DEFAULT 0,
        credit_account TEXT NOT NULL DEFAULT '',
        credit_amount INTEGER NOT NULL DEFAULT 0,
        description TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_financial_transactions_property_date
      ON financial_transactions(property_id, transaction_date);
    `);

    await this.pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT');
    await this.pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS can_edit_blog BOOLEAN NOT NULL DEFAULT FALSE');
    await this.pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at BIGINT');
    await this.pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS checkin_permission_from DATE');
    await this.pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS host_level INT');
    await this.pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at BIGINT');
    await this.pool.query("UPDATE users SET name = split_part(email, '@', 1) WHERE name IS NULL OR trim(name) = ''");
    await this.pool.query(`
      UPDATE checkin_submissions
      SET data = jsonb_set(data, '{propertyId}', to_jsonb(property_id::text), true)
      WHERE data->>'propertyId' IS DISTINCT FROM property_id
    `);

    // Add translations column to properties table if it doesn't exist
    await this.pool.query('ALTER TABLE properties ADD COLUMN IF NOT EXISTS translations JSONB DEFAULT NULL');

    // Finance: receipt image reference on transactions + pending (未承認) journal table
    await this.pool.query('ALTER TABLE financial_transactions ADD COLUMN IF NOT EXISTS receipt_url TEXT');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS pending_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        gcs_path TEXT NOT NULL DEFAULT '',
        ocr_processed BOOLEAN NOT NULL DEFAULT FALSE,
        transaction_date TEXT NOT NULL DEFAULT '',
        debit_account TEXT NOT NULL DEFAULT '',
        debit_amount INTEGER NOT NULL DEFAULT 0,
        credit_account TEXT NOT NULL DEFAULT '普通預金',
        credit_amount INTEGER NOT NULL DEFAULT 0,
        description TEXT NOT NULL DEFAULT '',
        vendor TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pending_transactions_property
      ON pending_transactions(property_id, created_at DESC);
    `);

    // Email-receipt ingest: external idempotency key so the same Gmail message
    // can never create two expenses (survives approval: pending → journal).
    await this.pool.query(`
      ALTER TABLE pending_transactions ADD COLUMN IF NOT EXISTS source_ref TEXT;
      ALTER TABLE financial_transactions ADD COLUMN IF NOT EXISTS source_ref TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_transactions_source_ref
      ON pending_transactions(source_ref) WHERE source_ref IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_transactions_source_ref
      ON financial_transactions(source_ref) WHERE source_ref IS NOT NULL;
    `);

    // Email → property routing rules for the ingest webhook (managed in the
    // Finance admin UI; overrides the FINANCE_INGEST_RULES env fallback).
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS finance_ingest_rules (
        email TEXT PRIMARY KEY,
        property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `);

    // Host subscription upgrade requests (admin-approved, no payment gateway yet).
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS subscription_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_code TEXT NOT NULL,
        billing_cycle TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        decided_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_subscription_requests_status
      ON subscription_requests(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_subscription_requests_user
      ON subscription_requests(user_id, created_at DESC);
    `);

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

  private async mapUser(row: { id: number; name: string; email: string; role: AuthUser['role']; can_edit_blog: boolean; archived_at: number | null; host_level?: number | null; last_seen_at?: number | null }): Promise<AuthUser> {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      canEditBlog: row.can_edit_blog,
      archivedAt: row.archived_at,
      assignedPropertyIds: row.role === 'HOST' ? await this.getAssignedPropertyIds(row.id) : [],
      hostLevel: (row.host_level as 1 | 2 | 3 | 4 | null) ?? null,
      lastSeenAt: row.last_seen_at ?? null,
    };
  }

  async touchUserLastSeen(userId: number, timestamp: number): Promise<void> {
    await this.pool.query('UPDATE users SET last_seen_at = $2 WHERE id = $1', [userId, timestamp]);
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
    const result = await this.pool.query<{ id: number; name: string; email: string; role: AuthUser['role']; can_edit_blog: boolean; archived_at: number | null; host_level?: number | null; last_seen_at?: number | null }>('SELECT id, name, email, role, can_edit_blog, archived_at, host_level, last_seen_at FROM users ORDER BY id');
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

  async registerHost(name: string, email: string, password: string): Promise<AuthUser> {
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
      'INSERT INTO users (id, name, email, role, password_hash, can_edit_blog, host_level, archived_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL) RETURNING id, name, email, role, can_edit_blog, archived_at, host_level',
      [nextId, normalizedName, normalizedEmail, 'HOST', passwordHash, false, 1],
    );
    const created = await this.mapUser(insertResult.rows[0]);
    // Self-registration has no acting admin; the new user is the actor of record.
    await this.writeAudit(created.id, 'CREATE', 'user', String(created.id));
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

  async updateUserHostLevel(userId: number, level: 1 | 2 | 3 | 4 | null, actor: AuthUser): Promise<AuthUser> {
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
      await client.query(
        `
          UPDATE checkin_submissions
          SET property_id = $2,
              data = jsonb_set(data, '{propertyId}', to_jsonb($2::text), true)
          WHERE property_id = $1
        `,
        [current.id, targetId],
      );

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

  private mapSubscriptionRequest(row: {
    id: string;
    user_id: number;
    user_name: string | null;
    user_email: string | null;
    plan_code: string;
    billing_cycle: string;
    status: string;
    decided_by_user_id: number | null;
    created_at: string | number;
    updated_at: string | number;
  }): SubscriptionRequest {
    return {
      id: row.id,
      userId: row.user_id,
      userName: row.user_name ?? '',
      userEmail: row.user_email ?? '',
      planCode: row.plan_code as HostPlanCode,
      billingCycle: row.billing_cycle as BillingCycle,
      status: row.status as SubscriptionRequestStatus,
      decidedByUserId: row.decided_by_user_id,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private readonly subscriptionRequestSelect = `
    SELECT sr.id, sr.user_id, u.name AS user_name, u.email AS user_email,
           sr.plan_code, sr.billing_cycle, sr.status, sr.decided_by_user_id,
           sr.created_at, sr.updated_at
    FROM subscription_requests sr
    LEFT JOIN users u ON u.id = sr.user_id`;

  async createSubscriptionRequest(userId: number, planCode: HostPlanCode, billingCycle: BillingCycle): Promise<SubscriptionRequest> {
    const now = Date.now();
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO subscription_requests (user_id, plan_code, billing_cycle, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'pending', $4, $4) RETURNING id`,
      [userId, planCode, billingCycle, now],
    );
    const id = inserted.rows[0].id;
    const result = await this.pool.query(`${this.subscriptionRequestSelect} WHERE sr.id = $1`, [id]);
    return this.mapSubscriptionRequest(result.rows[0]);
  }

  async listSubscriptionRequests(filters?: { status?: SubscriptionRequestStatus; userId?: number }): Promise<SubscriptionRequest[]> {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (filters?.status) {
      params.push(filters.status);
      conditions.push(`sr.status = $${params.length}`);
    }
    if (filters?.userId) {
      params.push(filters.userId);
      conditions.push(`sr.user_id = $${params.length}`);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const result = await this.pool.query(`${this.subscriptionRequestSelect}${where} ORDER BY sr.created_at DESC`, params);
    return result.rows.map((row) => this.mapSubscriptionRequest(row));
  }

  async getSubscriptionRequest(id: string): Promise<SubscriptionRequest | null> {
    const result = await this.pool.query(`${this.subscriptionRequestSelect} WHERE sr.id = $1`, [id]);
    return result.rows[0] ? this.mapSubscriptionRequest(result.rows[0]) : null;
  }

  async updateSubscriptionRequestStatus(id: string, status: SubscriptionRequestStatus, actor: AuthUser): Promise<SubscriptionRequest> {
    const updated = await this.pool.query<{ id: string }>(
      'UPDATE subscription_requests SET status = $2, decided_by_user_id = $3, updated_at = $4 WHERE id = $1 RETURNING id',
      [id, status, actor.id, Date.now()],
    );
    if (!updated.rows[0]) {
      throw new Error('Subscription request not found.');
    }
    await this.writeAudit(actor.id, 'UPDATE', 'subscription_request', id);
    const result = await this.pool.query(`${this.subscriptionRequestSelect} WHERE sr.id = $1`, [id]);
    return this.mapSubscriptionRequest(result.rows[0]);
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
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
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
      SELECT data, property_id, check_in_date::text, check_out_date::text
      FROM checkin_submissions
      ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY created_at DESC
    `;

    const result = await this.pool.query<{
      data: CheckInSubmission;
      property_id: string;
      check_in_date: string;
      check_out_date: string;
    }>(query, values);
    const guestNameNeedle = filters?.guestName?.trim().toLowerCase() ?? '';
    const nationalityNeedle = filters?.nationality?.trim().toLowerCase() ?? '';

    return result.rows
      .map((row) => this.hydrateCheckInSubmission(row))
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
    const result = await this.pool.query<{
      data: CheckInSubmission;
      property_id: string;
      check_in_date: string;
      check_out_date: string;
    }>(
      'SELECT data, property_id, check_in_date::text, check_out_date::text FROM checkin_submissions WHERE id = $1 LIMIT 1',
      [id],
    );
    return result.rows[0] ? this.hydrateCheckInSubmission(result.rows[0]) : null;
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

  private mapFinancialTransaction(row: {
    id: string;
    property_id: string;
    transaction_no: string;
    transaction_date: string;
    debit_account: string;
    debit_amount: number;
    credit_account: string;
    credit_amount: number;
    description: string;
    receipt_url?: string | null;
    source_ref?: string | null;
    created_at: number;
    updated_at: number;
  }): FinancialTransaction {
    return {
      id: row.id,
      propertyId: row.property_id,
      transactionNo: row.transaction_no,
      transactionDate: typeof row.transaction_date === 'string'
        ? row.transaction_date.slice(0, 10)
        : new Date(row.transaction_date).toISOString().slice(0, 10),
      debitAccount: row.debit_account,
      debitAmount: Number(row.debit_amount),
      creditAccount: row.credit_account,
      creditAmount: Number(row.credit_amount),
      description: row.description,
      receiptUrl: row.receipt_url ?? undefined,
      sourceRef: row.source_ref ?? undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  async listFinancialTransactions(propertyIds: string[], year?: number): Promise<FinancialTransaction[]> {
    if (propertyIds.length === 0) return [];
    const queryParams: (string[] | number)[] = [propertyIds];
    let sql = `SELECT * FROM financial_transactions WHERE property_id = ANY($1::text[])`;
    if (year) {
      queryParams.push(year);
      sql += ` AND EXTRACT(YEAR FROM transaction_date) = $${queryParams.length}`;
    }
    sql += ' ORDER BY transaction_date ASC, transaction_no ASC';
    const result = await this.pool.query(sql, queryParams);
    return result.rows.map((row: Parameters<typeof this.mapFinancialTransaction>[0]) => this.mapFinancialTransaction(row));
  }

  async createFinancialTransaction(input: FinancialTransactionInput, actor: AuthUser): Promise<FinancialTransaction> {
    const now = Date.now();
    const result = await this.pool.query(
      `INSERT INTO financial_transactions
        (property_id, transaction_no, transaction_date, debit_account, debit_amount, credit_account, credit_amount, description, receipt_url, source_ref, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [input.propertyId, input.transactionNo, input.transactionDate, input.debitAccount, input.debitAmount,
       input.creditAccount, input.creditAmount, input.description, input.receiptUrl ?? null, input.sourceRef ?? null, now, now],
    );
    await this.writeAudit(actor.id, 'CREATE_FINANCE_TXN', 'financial_transaction', result.rows[0].id);
    return this.mapFinancialTransaction(result.rows[0]);
  }

  async updateFinancialTransaction(id: string, input: Partial<FinancialTransactionInput>, actor: AuthUser): Promise<FinancialTransaction> {
    const now = Date.now();
    const sets: string[] = ['updated_at = $2'];
    const params: (string | number)[] = [id, now];
    const fields: [keyof FinancialTransactionInput, string][] = [
      ['propertyId', 'property_id'],
      ['transactionNo', 'transaction_no'],
      ['transactionDate', 'transaction_date'],
      ['debitAccount', 'debit_account'],
      ['debitAmount', 'debit_amount'],
      ['creditAccount', 'credit_account'],
      ['creditAmount', 'credit_amount'],
      ['description', 'description'],
      ['receiptUrl', 'receipt_url'],
    ];
    for (const [key, col] of fields) {
      if (input[key] !== undefined) {
        params.push(input[key] as string | number);
        sets.push(`${col} = $${params.length}`);
      }
    }
    const result = await this.pool.query(
      `UPDATE financial_transactions SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    if (result.rows.length === 0) throw new Error('Transaction not found');
    await this.writeAudit(actor.id, 'UPDATE_FINANCE_TXN', 'financial_transaction', id);
    return this.mapFinancialTransaction(result.rows[0]);
  }

  async deleteFinancialTransaction(id: string, actor: AuthUser): Promise<FinancialTransaction | null> {
    const result = await this.pool.query('DELETE FROM financial_transactions WHERE id = $1 RETURNING *', [id]);
    await this.writeAudit(actor.id, 'DELETE_FINANCE_TXN', 'financial_transaction', id);
    return result.rows[0] ? this.mapFinancialTransaction(result.rows[0]) : null;
  }

  async bulkImportFinancialTransactions(propertyId: string, transactions: FinancialTransactionInput[], actor: AuthUser): Promise<FinancialTransaction[]> {
    if (transactions.length === 0) return [];
    const now = Date.now();
    const results: FinancialTransaction[] = [];
    for (const input of transactions) {
      const result = await this.pool.query(
        `INSERT INTO financial_transactions
          (property_id, transaction_no, transaction_date, debit_account, debit_amount, credit_account, credit_amount, description, receipt_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [propertyId, input.transactionNo, input.transactionDate, input.debitAccount, input.debitAmount,
         input.creditAccount, input.creditAmount, input.description, input.receiptUrl ?? null, now, now],
      );
      results.push(this.mapFinancialTransaction(result.rows[0]));
    }
    await this.writeAudit(actor.id, 'BULK_IMPORT_FINANCE', 'financial_transaction', propertyId);
    return results;
  }

  private mapPendingTransaction(row: {
    id: string;
    property_id: string;
    gcs_path: string;
    ocr_processed: boolean;
    transaction_date: string;
    debit_account: string;
    debit_amount: number;
    credit_account: string;
    credit_amount: number;
    description: string;
    vendor?: string | null;
    source_ref?: string | null;
    created_at: number;
    updated_at: number;
  }): PendingTransaction {
    return {
      id: row.id,
      propertyId: row.property_id,
      gcsPath: row.gcs_path,
      receiptUrl: row.gcs_path,
      ocrProcessed: row.ocr_processed,
      transactionDate: row.transaction_date,
      debitAccount: row.debit_account,
      debitAmount: Number(row.debit_amount),
      creditAccount: row.credit_account,
      creditAmount: Number(row.credit_amount),
      description: row.description,
      vendor: row.vendor ?? undefined,
      sourceRef: row.source_ref ?? undefined,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  async listPendingTransactions(propertyIds: string[]): Promise<PendingTransaction[]> {
    if (propertyIds.length === 0) return [];
    const result = await this.pool.query(
      'SELECT * FROM pending_transactions WHERE property_id = ANY($1::text[]) ORDER BY created_at DESC',
      [propertyIds],
    );
    return result.rows.map((row: Parameters<typeof this.mapPendingTransaction>[0]) => this.mapPendingTransaction(row));
  }

  async createPendingTransaction(input: PendingTransactionInput, _actor: AuthUser): Promise<PendingTransaction> {
    const now = Date.now();
    const result = await this.pool.query(
      `INSERT INTO pending_transactions
        (property_id, gcs_path, ocr_processed, transaction_date, debit_account, debit_amount, credit_account, credit_amount, description, vendor, source_ref, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        input.propertyId, input.gcsPath, input.ocrProcessed ?? false,
        input.transactionDate ?? '', input.debitAccount ?? '', input.debitAmount ?? 0,
        input.creditAccount ?? '普通預金', input.creditAmount ?? 0, input.description ?? '',
        input.vendor ?? null, input.sourceRef ?? null, now, now,
      ],
    );
    return this.mapPendingTransaction(result.rows[0]);
  }

  async updatePendingTransaction(id: string, input: Partial<PendingTransactionInput>, _actor: AuthUser): Promise<PendingTransaction> {
    const now = Date.now();
    const sets: string[] = ['updated_at = $2'];
    const params: (string | number | boolean | null)[] = [id, now];
    const fields: [keyof PendingTransactionInput, string][] = [
      ['propertyId', 'property_id'],
      ['gcsPath', 'gcs_path'],
      ['ocrProcessed', 'ocr_processed'],
      ['transactionDate', 'transaction_date'],
      ['debitAccount', 'debit_account'],
      ['debitAmount', 'debit_amount'],
      ['creditAccount', 'credit_account'],
      ['creditAmount', 'credit_amount'],
      ['description', 'description'],
      ['vendor', 'vendor'],
    ];
    for (const [key, col] of fields) {
      if (input[key] !== undefined) {
        params.push(input[key] as string | number | boolean | null);
        sets.push(`${col} = $${params.length}`);
      }
    }
    const result = await this.pool.query(
      `UPDATE pending_transactions SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    if (result.rows.length === 0) throw new Error('Pending transaction not found');
    return this.mapPendingTransaction(result.rows[0]);
  }

  async approvePendingTransaction(id: string, actor: AuthUser): Promise<FinancialTransaction> {
    const pendingRes = await this.pool.query('SELECT * FROM pending_transactions WHERE id = $1', [id]);
    if (pendingRes.rows.length === 0) throw new Error('Pending transaction not found');
    const pending = this.mapPendingTransaction(pendingRes.rows[0]);
    const txn = await this.createFinancialTransaction({
      propertyId: pending.propertyId,
      transactionNo: '',
      transactionDate: pending.transactionDate,
      debitAccount: pending.debitAccount,
      debitAmount: pending.debitAmount,
      creditAccount: pending.creditAccount,
      creditAmount: pending.creditAmount,
      description: pending.description,
      receiptUrl: pending.gcsPath,
      sourceRef: pending.sourceRef,
    }, actor);
    await this.pool.query('DELETE FROM pending_transactions WHERE id = $1', [id]);
    return txn;
  }

  async deletePendingTransaction(id: string, _actor: AuthUser): Promise<PendingTransaction | null> {
    const result = await this.pool.query('DELETE FROM pending_transactions WHERE id = $1 RETURNING *', [id]);
    return result.rows[0] ? this.mapPendingTransaction(result.rows[0]) : null;
  }

  async hasFinanceSourceRef(sourceRef: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM pending_transactions WHERE source_ref = $1
       UNION ALL
       SELECT 1 FROM financial_transactions WHERE source_ref = $1
       LIMIT 1`,
      [sourceRef],
    );
    return result.rows.length > 0;
  }

  private mapIngestRule(row: { email: string; property_id: string; created_at: number; updated_at: number }): IngestRule {
    return {
      email: row.email,
      propertyId: row.property_id,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  async listIngestRules(): Promise<IngestRule[]> {
    const result = await this.pool.query('SELECT * FROM finance_ingest_rules ORDER BY email');
    return result.rows.map((row: Parameters<typeof this.mapIngestRule>[0]) => this.mapIngestRule(row));
  }

  async upsertIngestRule(email: string, propertyId: string, actor: AuthUser): Promise<IngestRule> {
    const now = Date.now();
    const result = await this.pool.query(
      `INSERT INTO finance_ingest_rules (email, property_id, created_at, updated_at)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (email) DO UPDATE SET property_id = $2, updated_at = $3
       RETURNING *`,
      [email.trim().toLowerCase(), propertyId, now],
    );
    await this.writeAudit(actor.id, 'UPSERT_INGEST_RULE', 'finance_ingest_rule', email);
    return this.mapIngestRule(result.rows[0]);
  }

  async deleteIngestRule(email: string, actor: AuthUser): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM finance_ingest_rules WHERE email = $1 RETURNING email',
      [email.trim().toLowerCase()],
    );
    await this.writeAudit(actor.id, 'DELETE_INGEST_RULE', 'finance_ingest_rule', email);
    return result.rows.length > 0;
  }
}
