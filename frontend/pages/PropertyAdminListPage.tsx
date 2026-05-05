import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Archive, Loader2, Pencil, RotateCcw, X } from 'lucide-react';
import { TopNavBar } from '../components/TopNavBar';
import { MobileBottomNav } from '../components/MobileBottomNav';
import { getCurrentUser, checkAuth, subscribeToAuth } from '../services/auth';
import { getAllProperties, setPropertyArchived } from '../services/storage';
import { ApiUser } from '../services/api';
import { PropertyData } from '../types';

const PropertyAdminListPage: React.FC = () => {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(checkAuth());
  const [authUser, setAuthUser] = useState<ApiUser | null>(getCurrentUser());
  const [allProperties, setAllProperties] = useState<(PropertyData & { id: string })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);

  const canAccess = authUser?.role === 'ADMIN' || authUser?.role === 'HOST';

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => {
      setAuthUser(user);
      setIsAuthenticated(!!user);
    }).then((unsub) => {
      unsubscribe = unsub;
    });

    return () => unsubscribe();
  }, []);

  const loadProperties = async (refresh = false) => {
    if (!canAccess) {
      setIsLoading(false);
      return;
    }

    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    setErrorMsg(null);
    try {
      const properties = await getAllProperties({ includeArchived: true });
      setAllProperties(properties);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load properties.';
      setErrorMsg(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void loadProperties();
  }, [canAccess]);

  const managedProperties = useMemo(() => {
    if (!authUser) {
      return [] as (PropertyData & { id: string })[];
    }

    const assignedIds = new Set(authUser.assignedPropertyIds ?? []);
    const assignedProperties = allProperties.filter((property) => assignedIds.has(property.id));

    if (authUser.role === 'ADMIN' && assignedProperties.length === 0) {
      return allProperties;
    }

    return assignedProperties;
  }, [allProperties, authUser]);

  const handleLogin = () => {
    navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);
  };

  const handleEdit = (property: PropertyData & { id: string }) => {
    navigate(`/${property.metalink || property.id}/admin`);
  };

  const handleArchiveToggle = async (property: PropertyData & { id: string }, archived: boolean) => {
    setErrorMsg(null);
    setInfoMsg(null);
    setPendingArchiveId(property.id);

    try {
      await setPropertyArchived(property.id, archived);
      setAllProperties((prev) => prev.map((item) => item.id === property.id ? { ...item, archivedAt: archived ? Date.now() : null } : item));
      setConfirmArchiveId(null);
      setInfoMsg(archived ? `Property archived: ${property.name || property.id}` : `Property restored: ${property.name || property.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update property archive state.';
      setErrorMsg(message);
    } finally {
      setPendingArchiveId(null);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4 pt-20">
        <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-200 w-full max-w-md">
          <div className="flex justify-center mb-6">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-700">
              <AlertCircle className="w-6 h-6" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-2">Property Admin Access</h2>
          <p className="text-sm text-gray-500 text-center mb-6">Sign in with an admin or host account to manage your properties.</p>
          <button
            onClick={handleLogin}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg"
          >
            Login
          </button>
        </div>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-[#e8e5e6]">
        <TopNavBar />
        <div className="max-w-3xl mx-auto px-4 pt-[110px] pb-12">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 shadow-sm text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-[#1b1c1d] mb-2">Host or admin role required</h1>
            <p className="text-[#44474c] mb-6">Your current account does not have permission to access property admin.</p>
            <Link to="/" className="inline-flex items-center px-5 py-2.5 rounded-full border border-[#041627] text-[#041627] font-semibold hover:bg-[#efedef] transition-colors">
              Back to listings
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#e8e5e6] text-[#1b1c1d]">
      <TopNavBar />
      <main className="max-w-[1280px] mx-auto px-3 md:px-6 pt-[110px] pb-24 md:pb-10">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="font-['Plus_Jakarta_Sans'] text-[28px] font-bold leading-tight">Property Administration</h1>
            <p className="text-[#44474c]">Manage properties you currently host.</p>
          </div>
          <button
            onClick={() => loadProperties(true)}
            disabled={isRefreshing}
            className="self-start md:self-auto inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#c4c6cd] bg-white text-[#1b1c1d] font-semibold hover:bg-[#efedef] disabled:opacity-60 transition-colors"
          >
            {isRefreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Refresh
          </button>
        </div>

        {errorMsg && (
          <div className="mb-6 border border-red-200 bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">
            {errorMsg}
          </div>
        )}

        {infoMsg && (
          <div className="mb-6 border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-xl px-4 py-3 text-sm">
            {infoMsg}
          </div>
        )}

        <section className="bg-white border border-[#e4e2e3] rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 md:px-6 py-4 border-b border-[#e4e2e3]">
            <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-bold">Your Hosted Properties</h2>
          </div>

          {isLoading ? (
            <div className="p-10 flex items-center justify-center text-[#44474c]">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading properties...
            </div>
          ) : managedProperties.length === 0 ? (
            <div className="p-10 text-center text-[#44474c]">No hosted properties found for your account.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[#f5f3f4] text-[#44474c]">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Property</th>
                    <th className="text-left px-4 py-3 font-semibold">ID</th>
                    <th className="text-left px-4 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {managedProperties.map((property) => {
                    const isArchiving = pendingArchiveId === property.id;
                    const isConfirming = confirmArchiveId === property.id;

                    return (
                      <tr key={property.id} className="border-t border-[#efedef] align-top">
                        <td className="px-4 py-4">
                          <div className="font-semibold text-[#1b1c1d]">{property.name || property.id}</div>
                          <div className="text-xs text-[#74777d]">{property.subtitle || 'No subtitle'}</div>
                          {property.archivedAt && <div className="mt-1 text-xs font-semibold text-amber-700">Archived</div>}
                        </td>
                        <td className="px-4 py-4 text-[#44474c]">{property.id}</td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => handleEdit(property)}
                              disabled={isArchiving}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-[#041627] text-[#041627] text-xs font-semibold hover:bg-[#efedef] disabled:opacity-50"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit
                            </button>
                            <button
                              onClick={() => setConfirmArchiveId(property.id)}
                              disabled={isArchiving}
                              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold disabled:opacity-50 ${property.archivedAt ? 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50' : 'border border-amber-300 text-amber-700 hover:bg-amber-50'}`}
                            >
                              {property.archivedAt ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                              {property.archivedAt ? 'Restore' : 'Archive'}
                            </button>
                          </div>

                          {isConfirming && (
                            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex flex-wrap items-center gap-2">
                              <span>{property.archivedAt ? 'Restore this property?' : 'Archive this property?'}</span>
                              <button
                                onClick={() => handleArchiveToggle(property, !property.archivedAt)}
                                disabled={isArchiving}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-white font-semibold disabled:opacity-60 ${property.archivedAt ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}`}
                              >
                                {isArchiving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : property.archivedAt ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                                Confirm
                              </button>
                              <button
                                onClick={() => setConfirmArchiveId(null)}
                                disabled={isArchiving}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-[#c4c6cd] text-[#44474c] font-semibold hover:bg-white disabled:opacity-60"
                              >
                                <X className="w-3.5 h-3.5" />
                                Cancel
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
      <MobileBottomNav />
    </div>
  );
};

export default PropertyAdminListPage;
