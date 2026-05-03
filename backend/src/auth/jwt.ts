import jwt from 'jsonwebtoken';
import { AuthUser } from '../store/types.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

interface TokenPayload {
  sub: number;
  email: string;
  role: AuthUser['role'];
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
