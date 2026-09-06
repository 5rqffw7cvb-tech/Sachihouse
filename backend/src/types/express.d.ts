import { AuthUser } from '../store/types.js';
import { TokenPayload } from '../auth/jwt.js';

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser | null;
      /** The verified bearer payload behind `authUser`, so a route can tell a
       *  remembered session from a console one and re-issue it. */
      authTokenPayload?: TokenPayload | null;
    }
  }
}

export {};
