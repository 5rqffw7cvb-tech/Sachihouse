import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Building, Check, Clock, Loader2, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
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

        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-extrabold text-white flex items-center gap-2">
              <Building className="w-5 h-5 text-indigo-400" />
              <span>Your Hosted Properties ({managedProperties.length})</span>
            </h2>
          </div>

          {isLoading ? (
            <div className="p-16 flex flex-col items-center justify-center text-slate-400 bg-slate-900/60 border border-slate-800 rounded-3xl">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-3" />
              <p className="text-xs font-semibold">Loading your property portfolio...</p>
            </div>
          ) : managedProperties.length === 0 ? (
            <div className="p-16 text-center text-slate-400 bg-slate-900/60 border border-slate-800 rounded-3xl">
              No hosted properties found for your account.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {managedProperties.map((property) => {
                const isArchiving = pendingArchiveId === property.id;
                const isDeleting = pendingDeleteId === property.id;
                const isUpdatingReview = pendingReviewStatusId === property.id;
                const isConfirming = confirmArchiveId === property.id;
                const isConfirmingDelete = confirmDeleteId === property.id;
                const reviewStatus = property.reviewStatus ?? 'approved';
                const isPendingReview = reviewStatus === 'pending_review';
                const coverImage = property.galleryImages?.[0]?.url || property.hostImageUrl || '';

                return (
                  <div
                    key={property.id}
                    className="bg-slate-900/90 border border-slate-800 hover:border-indigo-500/40 rounded-3xl p-5 shadow-xl hover:shadow-indigo-500/10 transition-all duration-300 flex flex-col justify-between group"
                  >
                    <div>
                      {/* Property Image & Status Badges */}
                      <div className="relative aspect-[16/9] rounded-2xl overflow-hidden bg-slate-950 mb-4 border border-slate-800/60">
                        {coverImage ? (
                          <img
                            src={coverImage}
                            alt={property.name || property.id}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-600 bg-slate-950">
                            <Building className="w-10 h-10 opacity-30" />
                          </div>
                        )}
                        <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider backdrop-blur-md border ${
                            isPendingReview
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          }`}>
                            {isPendingReview ? 'Pending Review' : 'Approved'}
                          </span>
                          {property.archivedAt && (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/40 backdrop-blur-md">
                              Archived
                            </span>
                          )}
                        </div>
                        <div className="absolute bottom-3 left-3 bg-slate-950/80 backdrop-blur-md px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold text-slate-300 border border-slate-800">
                          ID: {property.id}
                        </div>
                      </div>

                      {/* Title & Subtitle */}
                      <h3 className="font-['Plus_Jakarta_Sans'] text-lg font-bold text-white group-hover:text-indigo-400 transition-colors line-clamp-1">
                        {property.name || property.id}
                      </h3>
                      <p className="text-xs text-slate-400 mt-1 line-clamp-1">
                        {property.subtitle || 'Sachi House Hospitality Property'}
                      </p>

                      {/* Quick Property Stats Pill Row */}
                      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-slate-800/80 text-[11px] font-semibold text-slate-400">
                        <span>Max Guests: <b className="text-slate-200">{property.maxGuests || 1}</b></span>
                        <span>•</span>
                        <span>Bedrooms: <b className="text-slate-200">{property.bedrooms || 1}</b></span>
                        <span>•</span>
                        <span>Baths: <b className="text-slate-200">{property.baths || 1}</b></span>
                      </div>
                    </div>

                    {/* Card Actions Footer */}
                    <div className="mt-5 pt-4 border-t border-slate-800 space-y-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEdit(property)}
                          disabled={isArchiving || isDeleting || isUpdatingReview}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-xs font-bold hover:shadow-lg hover:shadow-indigo-500/25 active:scale-95 transition-all disabled:opacity-50"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Edit Listing</span>
                        </button>
                        <button
                          onClick={() => handleReviewStatusToggle(property, isPendingReview ? 'approved' : 'pending_review')}
                          disabled={isArchiving || isDeleting || isUpdatingReview}
                          className={`p-2 rounded-xl border text-xs font-bold transition-all disabled:opacity-50 ${
                            isPendingReview
                              ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                              : 'border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                          }`}
                          title={isPendingReview ? 'Approve Listing' : 'Mark Pending'}
                        >
                          {isUpdatingReview ? <Loader2 className="w-4 h-4 animate-spin" /> : isPendingReview ? <Check className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setConfirmArchiveId(property.id)}
                          disabled={isArchiving || isDeleting || isUpdatingReview}
                          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all disabled:opacity-50 ${
                            property.archivedAt
                              ? 'border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10'
                              : 'border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                          }`}
                        >
                          {property.archivedAt ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                          <span>{property.archivedAt ? 'Restore' : 'Archive'}</span>
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(property.id)}
                          disabled={isArchiving || isDeleting || isUpdatingReview}
                          className="px-3 py-1.5 rounded-xl border border-rose-500/30 text-rose-400 text-xs font-semibold hover:bg-rose-500/10 transition-all disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Confirmation Confirm Dialog Overlay */}
                      {isConfirming && (
                        <div className="p-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-300 space-y-2">
                          <p>{property.archivedAt ? 'Restore this property listing?' : 'Archive this property listing?'}</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleArchiveToggle(property, !property.archivedAt)}
                              disabled={isArchiving}
                              className={`flex-1 py-1.5 rounded-xl text-white font-bold text-xs shadow-sm ${
                                property.archivedAt ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'
                              }`}
                            >
                              {isArchiving ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : 'Confirm'}
                            </button>
                            <button
                              onClick={() => setConfirmArchiveId(null)}
                              className="px-3 py-1.5 rounded-xl border border-slate-700 text-slate-300 font-semibold"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {isConfirmingDelete && (
                        <div className="p-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300 space-y-2">
                          <p>Delete this property permanently?</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleDeleteProperty(property)}
                              disabled={isDeleting}
                              className="flex-1 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-sm"
                            >
                              {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : 'Confirm Delete'}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-3 py-1.5 rounded-xl border border-slate-700 text-slate-300 font-semibold"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
    </AdminShell>
  );
};

export default PropertyAdminListPage;
