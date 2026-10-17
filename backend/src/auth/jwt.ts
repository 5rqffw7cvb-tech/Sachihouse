import jwt from 'jsonwebtoken';
import { AuthUser } from '../store/types.js';

// Only development and test runs may fall back to a known secret. Anywhere
// else a missing JWT_SECRET would mean signing sessions with a string that is
// published in this repository, so the server refuses instead.
const DEV_FALLBACK_SECRET = 'dev-secret-change-me';
const FALLBACK_ALLOWED_ENVS = new Set(['development', 'test']);

let cachedSecret: string | null = null;

// Read on first use rather than at import: index.ts loads .env after its
// imports are evaluated, so a module-level read would miss a local .env.
function jwtSecret(): string {
  if (cachedSecret) return cachedSecret;
  const configured = process.env.JWT_SECRET?.trim();
  if (configured) {
    if (configured.length < 32) {
      console.warn('JWT_SECRET is shorter than 32 characters; use a long random value.');
    }
    cachedSecret = configured;
  } else if (FALLBACK_ALLOWED_ENVS.has(process.env.NODE_ENV ?? '')) {
    cachedSecret = DEV_FALLBACK_SECRET;
  } else {
    throw new Error(
      'JWT_SECRET is not set. Set it in the environment (or backend/.env for local runs, '
      + 'or NODE_ENV=development to use the insecure dev secret).',
    );
  }
  return cachedSecret;
}

/** Fails fast at startup instead of on the first sign-in. */
export function assertJwtSecretConfigured(): void {
  jwtSecret();
}

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

/**
 * Two session lengths, chosen by the caller at sign-in.
 *
 * The browser console keeps the original 8 hours: it gets opened on shared
 * desktops, and a tab left behind overnight should not still be signed in.
 *
 * The host phone app asks for a remembered session instead. It lives on one
 * person's home screen, and being thrown out every single working day is the
 * thing that stops a host from opening it at all.
 *
 * "Remembered" is not "forever". It is 90 days, re-issued whenever the app
 * checks in with less than REMEMBERED_RENEW_BELOW_SECONDS left, so a host who
 * opens the app at least once a month never signs in again — while a phone
 * that goes quiet still expires on its own.
 */
export const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS ?? 8 * HOUR);
export const REMEMBERED_SESSION_TTL_SECONDS = Number(
  process.env.REMEMBERED_SESSION_TTL_SECONDS ?? 90 * DAY,
);
/** Re-issue a remembered token once it has less than this much life left. */
export const REMEMBERED_RENEW_BELOW_SECONDS = Number(
  process.env.REMEMBERED_RENEW_BELOW_SECONDS ?? 60 * DAY,
);

export interface TokenPayload {
  sub: number;
  email: string;
  role: AuthUser['role'];
  /** Marks a remembered (long-lived, self-renewing) session. Absent otherwise. */
  rem?: 1;
  /** Written by jsonwebtoken at sign time; present on every verified token. */
  iat?: number;
  exp?: number;
}

interface CheckInTokenPayload {
  propertyId: string;
  purpose: 'checkin';
}

export function signToken(user: AuthUser, remember = false): string {
  const payload: TokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    ...(remember ? { rem: 1 as const } : {}),
  };

  return jwt.sign(payload, jwtSecret(), {
    expiresIn: remember ? REMEMBERED_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS,
  });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, jwtSecret()) as unknown as TokenPayload;
}

/**
 * True when this remembered token is old enough to be worth replacing.
 *
 * Only remembered sessions slide. An 8-hour console token that renewed itself
 * on every request would never expire, which is precisely what the short TTL
 * is there to prevent.
 */
export function shouldRenewToken(
  payload: TokenPayload | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!payload || payload.rem !== 1 || typeof payload.exp !== 'number') {
    return false;
  }
  const remainingSeconds = payload.exp - Math.floor(nowMs / 1000);
  return remainingSeconds > 0 && remainingSeconds < REMEMBERED_RENEW_BELOW_SECONDS;
}

export function signCheckInToken(propertyId: string, expiresInSeconds: number): string {
  const payload: CheckInTokenPayload = {
    propertyId,
    purpose: 'checkin',
  };

  return jwt.sign(payload, jwtSecret(), { expiresIn: expiresInSeconds });
}

export function verifyCheckInToken(token: string): CheckInTokenPayload {
  return jwt.verify(token, jwtSecret()) as unknown as CheckInTokenPayload;
}
