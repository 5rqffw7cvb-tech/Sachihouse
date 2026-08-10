import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getCurrentUser, subscribeToAuth } from '../services/auth';
import { ApiUser } from '../services/api';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: 'ADMIN' | 'HOST';
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requiredRole }) => {
  const [user, setUser] = useState<ApiUser | null>(getCurrentUser());
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    subscribeToAuth((u) => {
      setUser(u);
      setLoading(false);
    }).then((unsub) => {
      unsubscribe = unsub;
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#005fb8]" />
      </div>
    );
  }

  if (!user) {
    const redirectUrl = encodeURIComponent(window.location.hash ? window.location.hash.substring(1) : location.pathname);
    return <Navigate to={`/login?redirect=${redirectUrl}`} replace />;
  }

  if (requiredRole === 'ADMIN' && user.role !== 'ADMIN') {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-xl shadow-md border border-slate-200 text-center max-w-md">
          <h2 className="text-xl font-bold text-slate-800 mb-2">Access Denied</h2>
          <p className="text-slate-600 text-sm mb-4">You do not have administrative privileges to view this page.</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedRoute;
