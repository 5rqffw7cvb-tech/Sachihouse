import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { Loader2, Lock } from 'lucide-react';
import { ApiUser } from '../../services/api';
import { getCurrentUser, logout, subscribeToAuth } from '../../services/auth';
import { HostProperty, listHostProperties } from '../../services/hostApp';
import { HostAppMeta } from './HostAppMeta';
import { HostTabBar } from './HostTabBar';

/**
 * Chrome and gate for /app.
 *
 * The console's ProtectedRoute bounces to the marketing site's login page,
 * which arrives wrapped in a top nav, a footer and a language switcher — the
 * whole point of the app is that none of that is there. So the host app guards
 * itself and sends people to its own sign-in screen.
 *
 * It also owns the property list. Stays, Calendar and Check-in all need it,
 * and fetching it three times on every tab switch is three requests for an
 * answer that changes about once a year.
 */
export interface HostContext {
  user: ApiUser;
  properties: HostProperty[];
  propertiesError: string | null;
  reloadProperties: () => void;
}

export const useHostContext = (): HostContext => useOutletContext<HostContext>();

export const HostShell: React.FC = () => {
  const location = useLocation();
  const [user, setUser] = useState<ApiUser | null>(getCurrentUser());
  const [resolved, setResolved] = useState(false);
  const [properties, setProperties] = useState<HostProperty[]>([]);
  const [propertiesError, setPropertiesError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((next) => {
      setUser(next);
      setResolved(true);
    }).then((unsub) => { unsubscribe = unsub; });
    return () => unsubscribe();
  }, []);

  const canUseApp = user?.role === 'ADMIN' || user?.role === 'HOST';

  useEffect(() => {
    if (!canUseApp) return;
    let cancelled = false;

    listHostProperties(user)
      .then((list) => {
        if (cancelled) return;
        setProperties(list);
        setPropertiesError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPropertiesError(error instanceof Error ? error.message : 'Could not load your properties.');
      });

    return () => { cancelled = true; };
  }, [canUseApp, user, reloadKey]);

  const reloadProperties = useCallback(() => setReloadKey((key) => key + 1), []);

  if (!resolved) {
    return (
      <div className="min-h-[100dvh] bg-page flex items-center justify-center text-ink-muted">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (!user) {
    const target = window.location.hash ? window.location.hash.slice(1) : location.pathname;
    return <Navigate to={`/app/login?redirect=${encodeURIComponent(target)}`} replace />;
  }

  if (!canUseApp) {
    return (
      <div className="min-h-[100dvh] bg-page flex flex-col items-center justify-center text-center px-8 gap-4">
        <div className="w-12 h-12 rounded-full bg-subtle flex items-center justify-center">
          <Lock className="w-5 h-5 text-ink-muted" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-[16px] font-semibold text-ink">This app is for hosts</p>
          <p className="text-[13px] text-ink-muted">
            {user.email} is signed in without a host account.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void logout(); }}
          className="h-11 px-5 rounded-control bg-surface border border-line-strong text-[14px] font-semibold text-ink"
        >
          Sign out
        </button>
      </div>
    );
  }

  const context: HostContext = { user, properties, propertiesError, reloadProperties };

  return (
    <div className="bg-page text-ink font-['Inter']">
      <HostAppMeta />
      <Outlet context={context} />
      <HostTabBar user={user} />
    </div>
  );
};

export default HostShell;
