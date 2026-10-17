import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

// jwt.ts caches the secret, so each case loads a fresh copy of the module.
const loadJwt = () => import('../../src/auth/jwt.js');

describe('JWT secret', () => {
  it('refuses to run in production without JWT_SECRET', async () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';
    const { assertJwtSecretConfigured } = await loadJwt();
    expect(() => assertJwtSecretConfigured()).toThrow(/JWT_SECRET is not set/);
  });

  it('refuses when NODE_ENV is unset too', async () => {
    delete process.env.JWT_SECRET;
    delete process.env.NODE_ENV;
    const { assertJwtSecretConfigured } = await loadJwt();
    expect(() => assertJwtSecretConfigured()).toThrow(/JWT_SECRET is not set/);
  });

  it('uses the configured secret in production', async () => {
    process.env.JWT_SECRET = 'x'.repeat(48);
    process.env.NODE_ENV = 'production';
    const { assertJwtSecretConfigured } = await loadJwt();
    expect(() => assertJwtSecretConfigured()).not.toThrow();
  });

  it('allows the dev fallback only in development and test', async () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'development';
    const { assertJwtSecretConfigured } = await loadJwt();
    expect(() => assertJwtSecretConfigured()).not.toThrow();
  });
});

describe('initial admin from env', () => {
  const loadSeed = () => import('../../src/store/seed.js');

  it('creates no account when the variables are unset', async () => {
    delete process.env.SEED_ADMIN_EMAIL;
    delete process.env.SEED_ADMIN_PASSWORD;
    const { createInitialAdminFromEnv } = await loadSeed();
    expect(await createInitialAdminFromEnv()).toEqual([]);
  });

  it('creates one admin with the given email and a hashed password', async () => {
    process.env.SEED_ADMIN_EMAIL = ' Owner@Example.com ';
    process.env.SEED_ADMIN_PASSWORD = 'a-long-unique-passphrase';
    const { createInitialAdminFromEnv } = await loadSeed();
    const [admin] = await createInitialAdminFromEnv();
    expect(admin.email).toBe('owner@example.com');
    expect(admin.role).toBe('ADMIN');
    expect(admin.passwordHash).not.toContain('a-long-unique-passphrase');
  });

  it('rejects a short password', async () => {
    process.env.SEED_ADMIN_EMAIL = 'owner@example.com';
    process.env.SEED_ADMIN_PASSWORD = 'short';
    const { createInitialAdminFromEnv } = await loadSeed();
    await expect(createInitialAdminFromEnv()).rejects.toThrow(/at least 12/);
  });
});

describe('memory store', () => {
  it('will not start in production, where its demo passwords would be live', async () => {
    process.env.NODE_ENV = 'production';
    const { MemoryStore } = await import('../../src/store/memoryStore.js');
    await expect(new MemoryStore().init()).rejects.toThrow(/NODE_ENV=production/);
  });
});
