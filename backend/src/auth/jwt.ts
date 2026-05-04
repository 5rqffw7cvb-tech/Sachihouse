import jwt from 'jsonwebtoken';
import { AuthUser } from '../store/types.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

interface TokenPayload {
  sub: number;
  email: string;
  role: AuthUser['role'];
}

interface CheckInTokenPayload {
  propertyId: string;
  purpose: 'checkin';
}

export function signToken(user: AuthUser): string {
  const payload: TokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as unknown as TokenPayload;
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
