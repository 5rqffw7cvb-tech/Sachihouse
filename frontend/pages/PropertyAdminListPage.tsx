import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Loader2, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { AdminShell } from '../components/AdminShell';
import { getCurrentUser, subscribeToAuth } from '../services/auth';
import { deletePropertyData, getAllProperties, setPropertyArchived, setPropertyReviewStatus } from '../services/storage';
import { ApiUser } from '../services/api';
import { PropertyData } from '../types';

const PropertyAdminListPage: React.FC = () => {
  const navigate = useNavigate();

  const [authUser, setAuthUser] = useState<ApiUser | null>(getCurrentUser());
  const [allProperties, setAllProperties] = useState<(PropertyData & { id: string })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingReviewStatusId, setPendingReviewStatusId] = useState<string | null>(null);

  const canAccess = authUser?.role === 'ADMIN' || authUser?.role === 'HOST';

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => setAuthUser(user)).then((unsub) => {
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

    if (authUser.role === 'ADMIN') {
      return allProperties;
    }

    const assignedIds = new Set(authUser.assignedPropertyIds ?? []);
    const assignedProperties = allProperties.filter((property) => assignedIds.has(property.id));
    return assignedProperties;
  }, [allProperties, authUser]);

  const handleEdit = (property: PropertyData & { id: string }) => {
    navigate(`/${property.metalink || property.id}/admin`);
  };

  const handleCreateNew = () => {
    const newId = `list_${Math.random().toString(36).substring(2, 5)}`;
    navigate(`/${newId}/admin`);
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

  const handleReviewStatusToggle = async (
    property: PropertyData & { id: string },
    reviewStatus: 'approved' | 'pending_review',
  ) => {
    setErrorMsg(null);
    setInfoMsg(null);
    setPendingReviewStatusId(property.id);

    try {
      await setPropertyReviewStatus(property.id, reviewStatus);
      setAllProperties((prev) => prev.map((item) => item.id === property.id ? { ...item, reviewStatus } : item));
      setInfoMsg(reviewStatus === 'pending_review'
        ? `Property marked as pending for review: ${property.name || property.id}`
        : `Property approved: ${property.name || property.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update property review status.';
      setErrorMsg(message);
    } finally {
      setPendingReviewStatusId(null);
    }
  };

  const handleDeleteProperty = async (property: PropertyData & { id: string }) => {
    setErrorMsg(null);
    setInfoMsg(null);
    setPendingDeleteId(property.id);

    try {
      await deletePropertyData(property.id);
      setAllProperties((prev) => prev.filter((item) => item.id !== property.id));
      setConfirmDeleteId(null);
      setInfoMsg(`Property deleted: ${property.name || property.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete property.';
      setErrorMsg(message);
    } finally {
      setPendingDeleteId(null);
    }
  };

  return (
    <AdminShell
      title="Property Administration"
      subtitle="Manage properties you currently host."
      access="host"
      activeKey="properties"
      maxWidthClass="max-w-[1280px]"
      signInTitle="Property Admin Access"
      signInMessage="Sign in with an admin or host account to manage your properties."
      deniedTitle="Host or admin role required"
      deniedMessage="Your current account does not have permission to access property admin."
      actions={(
        <>
          {authUser?.role === 'ADMIN' && (
            <button
              onClick={handleCreateNew}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#041627] text-white font-semibold hover:bg-[#041627]/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Property
            </button>
          )}
          <button
            onClick={() => loadProperties(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#c4c6cd] bg-white text-[#1b1c1d] font-semibold hover:bg-[#efedef] disabled:opacity-60 transition-colors"
          >
            {isRefreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Refresh
          </button>
        </>
      )}
    >
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
                    <th className="text-left px-4 py-3 font-semibold">Status</th>
                    <th className="text-left px-4 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {managedProperties.map((property) => {
                    const isArchiving = pendingArchiveId === property.id;
                    const isDeleting = pendingDeleteId === property.id;
                    const isUpdatingReview = pendingReviewStatusId === property.id;
                    const isConfirming = confirmArchiveId === property.id;
                    const isConfirmingDelete = confirmDeleteId === property.id;
                    const reviewStatus = property.reviewStatus ?? 'approved';
                    const isPendingReview = reviewStatus === 'pending_review';

                    return (
                      <tr key={property.id} className="border-t border-[#efedef] align-top">
                        <td className="px-4 py-4">
                          <div className="font-semibold text-[#1b1c1d]">{property.name || property.id}</div>
                          <div className="text-xs text-[#74777d]">{property.subtitle || 'No subtitle'}</div>
                          {property.archivedAt && <div className="mt-1 text-xs font-semibold text-amber-700">Archived</div>}
                        </td>
                        <td className="px-4 py-4 text-[#44474c]">{property.id}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${isPendingReview ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                            {isPendingReview ? 'Pending for review' : 'Approved'}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => handleEdit(property)}
                              disabled={isArchiving || isDeleting || isUpdatingReview}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-[#041627] text-[#041627] text-xs font-semibold hover:bg-[#efedef] disabled:opacity-50"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Edit
                            </button>
                            <button
                              onClick={() => handleReviewStatusToggle(property, isPendingReview ? 'approved' : 'pending_review')}
                              disabled={isArchiving || isDeleting || isUpdatingReview}
                              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold disabled:opacity-50 ${isPendingReview ? 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50' : 'border border-amber-300 text-amber-700 hover:bg-amber-50'}`}
                            >
                              {isUpdatingReview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                              {isPendingReview ? 'Approve' : 'Mark pending'}
                            </button>
                            <button
                              onClick={() => setConfirmArchiveId(property.id)}
                              disabled={isArchiving || isDeleting || isUpdatingReview}
                              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold disabled:opacity-50 ${property.archivedAt ? 'border border-emerald-300 text-emerald-700 hover:bg-emerald-50' : 'border border-amber-300 text-amber-700 hover:bg-amber-50'}`}
                            >
                              {property.archivedAt ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                              {property.archivedAt ? 'Restore' : 'Archive'}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(property.id)}
                              disabled={isArchiving || isDeleting || isUpdatingReview}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-50 disabled:opacity-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
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

                          {isConfirmingDelete && (
                            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 flex flex-wrap items-center gap-2">
                              <span>Delete this property permanently?</span>
                              <button
                                onClick={() => handleDeleteProperty(property)}
                                disabled={isDeleting}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-60"
                              >
                                {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                Confirm
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                disabled={isDeleting}
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
    </AdminShell>
  );
};

export default PropertyAdminListPage;
