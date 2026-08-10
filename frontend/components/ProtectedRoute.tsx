import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getCurrentUser, subscribeToAuth } from '../services/auth';
import { ApiUser } from '../services/api';
import { Spinner } from './ui';

/**
 * Authentication only: is anyone signed in? If not, bounce to login before the
 * lazy page chunk is even fetched.
 *
 * Authorisation deliberately lives elsewhere. AdminShell's `access` prop decides
 * whether *this* user may see *this* page, using services/permissions, and it
 * renders a refusal in the page's own wording with a way back. Duplicating that
 * decision here is what let /admin/services ship guarded as "any signed-in user"
 * while the page demanded an administrator — two answers to one question, and
 * the weaker one ran first.
 */
export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<ApiUser | null>(getCurrentUser());
  const [resolved, setResolved] = useState(false);
  const location = useLocation();

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((u) => {
      setUser(u);
      setResolved(true);
    }).then((unsub) => { unsubscribe = unsub; });
    return () => unsubscribe();
  }, []);

  if (!resolved) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!user) {
    // HashRouter keeps the real path after the '#', so prefer it when present.
    const target = window.location.hash ? window.location.hash.slice(1) : location.pathname;
    return <Navigate to={`/login?redirect=${encodeURIComponent(target)}`} replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
