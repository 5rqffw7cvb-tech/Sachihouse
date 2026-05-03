import { AuthUser } from '../store/types.js';

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser | null;
    }
  }
}

export {};
