import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  REMEMBERED_SESSION_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  shouldRenewToken,
  signToken,
  verifyToken,
} from '../../src/auth/jwt.js';
import { AuthUser } from '../../src/store/types.js';

const HOST: AuthUser = {
  id: 7,
  name: 'Host',
  email: 'host@sachi-house.net',
  role: 'HOST',
} as AuthUser;

const decode = (token: string) => jwt.decode(token) as { exp: number; iat: number; rem?: 1 };

describe('session tokens', () => {
  it('gives the browser console the short session by default', () => {
    const payload = decode(signToken(HOST));
    expect(payload.rem).toBeUndefined();
    expect(payload.exp - payload.iat).toBe(SESSION_TTL_SECONDS);
  });

  it('gives a remembered sign-in the long session and marks it', () => {
    const payload = decode(signToken(HOST, true));
    expect(payload.rem).toBe(1);
    expect(payload.exp - payload.iat).toBe(REMEMBERED_SESSION_TTL_SECONDS);
  });

  it('still verifies both kinds of token', () => {
    expect(verifyToken(signToken(HOST)).sub).toBe(HOST.id);
    expect(verifyToken(signToken(HOST, true)).sub).toBe(HOST.id);
  });

  it('does not renew a freshly issued remembered token', () => {
    expect(shouldRenewToken(verifyToken(signToken(HOST, true)))).toBe(false);
  });

  it('renews a remembered token once it is inside the renewal window', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    // A token with a week left: well past the renewal threshold.
    const nearlyExpired = { sub: 7, email: HOST.email, role: 'HOST' as const, rem: 1 as const, iat: nowSeconds, exp: nowSeconds + 7 * 24 * 60 * 60 };
    expect(shouldRenewToken(nearlyExpired)).toBe(true);
  });

  it('never renews a short console session, however old', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const almostGone = { sub: 7, email: HOST.email, role: 'HOST' as const, iat: nowSeconds, exp: nowSeconds + 60 };
    expect(shouldRenewToken(almostGone)).toBe(false);
  });

  it('does not renew a token that has already expired', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expired = { sub: 7, email: HOST.email, role: 'HOST' as const, rem: 1 as const, iat: nowSeconds - 100, exp: nowSeconds - 1 };
    expect(shouldRenewToken(expired)).toBe(false);
  });

  it('treats a missing payload as nothing to renew', () => {
    expect(shouldRenewToken(null)).toBe(false);
    expect(shouldRenewToken(undefined)).toBe(false);
  });
});
