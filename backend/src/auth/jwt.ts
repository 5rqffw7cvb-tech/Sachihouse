import jwt from 'jsonwebtoken';
import { AuthUser } from '../store/types.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

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

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: remember ? REMEMBERED_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS,
  });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as unknown as TokenPayload;
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

  return jwt.sign(payload, JWT_SECRET, { expiresIn: expiresInSeconds });
}

export function verifyCheckInToken(token: string): CheckInTokenPayload {
  return jwt.verify(token, JWT_SECRET) as unknown as CheckInTokenPayload;
}
