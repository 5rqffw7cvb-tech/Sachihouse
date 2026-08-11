import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Building2, Check, Clock, Pencil, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { AdminShell } from '../components/AdminShell';
import { Alert, Badge, Button, Card, EmptyState, Spinner } from '../components/ui';
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
      signInTitle="Property Admin Access"
      signInMessage="Sign in with an admin or host account to manage your properties."
      deniedTitle="Host or admin role required"
      deniedMessage="Your current account does not have permission to access property admin."
      actions={(
        <>
          {authUser?.role === 'ADMIN' && (
            <Button variant="primary" icon={Plus} onClick={handleCreateNew}>New property</Button>
          )}
          <Button icon={RefreshCw} loading={isRefreshing} onClick={() => loadProperties(true)}>Refresh</Button>
        </>
      )}
    >
      {errorMsg && <Alert tone="danger" onDismiss={() => setErrorMsg(null)}>{errorMsg}</Alert>}
      {infoMsg && <Alert tone="ok" onDismiss={() => setInfoMsg(null)}>{infoMsg}</Alert>}

      {isLoading ? (
        <Card padded={false}><Spinner label="Loading properties…" /></Card>
      ) : managedProperties.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={Building2}
            title="No properties yet"
            description="Properties you host will appear here once an administrator assigns them to your account."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
          {managedProperties.map((property) => {
            const isArchiving = pendingArchiveId === property.id;
            const isDeleting = pendingDeleteId === property.id;
            const isUpdatingReview = pendingReviewStatusId === property.id;
            const busy = isArchiving || isDeleting || isUpdatingReview;
            const isPendingReview = (property.reviewStatus ?? 'approved') === 'pending_review';
            const coverImage = property.galleryImages?.[0]?.url || property.hostImageUrl || '';

            return (
              <Card key={property.id} padded={false} className="flex flex-col">
                <div className="relative aspect-[16/9] bg-subtle">
                  {coverImage ? (
                    <img src={coverImage} alt={property.name || property.id} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-ink-muted">
                      <Building2 className="w-8 h-8" />
                    </div>
                  )}
                  <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5">
                    <Badge tone={isPendingReview ? 'warn' : 'ok'}>
                      {isPendingReview ? 'Pending review' : 'Approved'}
                    </Badge>
                    {property.archivedAt && <Badge tone="danger">Archived</Badge>}
                  </div>
                </div>

                <div className="flex-1 flex flex-col p-4">
                  <h3 className="text-[16px] font-bold text-ink truncate">{property.name || property.id}</h3>
                  <p className="text-[13px] text-ink-muted truncate mt-0.5">{property.subtitle || 'No subtitle'}</p>

                  <dl className="flex items-center gap-4 mt-3 text-[13px] text-ink-soft">
                    <div><dt className="inline text-ink-muted">Guests </dt><dd className="inline font-semibold">{property.maxGuests || 1}</dd></div>
                    <div><dt className="inline text-ink-muted">Bedrooms </dt><dd className="inline font-semibold">{property.bedrooms || 1}</dd></div>
                    <div><dt className="inline text-ink-muted">Baths </dt><dd className="inline font-semibold">{property.baths || 1}</dd></div>
                  </dl>

                  <p className="mt-2 text-[12px] text-ink-muted font-mono truncate">{property.id}</p>

                  <div className="mt-4 pt-4 border-t border-line flex items-center gap-1.5">
                    <Button size="sm" variant="primary" icon={Pencil} disabled={busy} onClick={() => handleEdit(property)}>Edit</Button>
                    <Button
                      size="sm"
                      icon={isPendingReview ? Check : Clock}
                      loading={isUpdatingReview}
                      disabled={busy}
                      onClick={() => handleReviewStatusToggle(property, isPendingReview ? 'approved' : 'pending_review')}
                    >
                      {isPendingReview ? 'Approve' : 'Mark pending'}
                    </Button>
                    <Button
                      size="sm"
                      icon={property.archivedAt ? RotateCcw : Archive}
                      disabled={busy}
                      onClick={() => setConfirmArchiveId(property.id)}
                    >
                      {property.archivedAt ? 'Restore' : 'Archive'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Trash2}
                      disabled={busy}
                      onClick={() => setConfirmDeleteId(property.id)}
                      className="text-danger hover:bg-danger-tint hover:text-danger ml-auto px-2"
                      aria-label={`Delete ${property.name || property.id}`}
                    />
                  </div>

                  {confirmArchiveId === property.id && (
                    <div className="mt-3 rounded-control border border-line bg-subtle p-3">
                      <p className="text-[13px] text-ink-soft mb-2">
                        {property.archivedAt ? 'Restore this property?' : 'Archive this property?'}
                      </p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" loading={isArchiving} onClick={() => handleArchiveToggle(property, !property.archivedAt)}>Confirm</Button>
                        <Button size="sm" variant="ghost" disabled={isArchiving} onClick={() => setConfirmArchiveId(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}

                  {confirmDeleteId === property.id && (
                    <div className="mt-3 rounded-control border border-danger/25 bg-danger-tint p-3">
                      <p className="text-[13px] text-danger mb-2">Delete this property permanently? This cannot be undone.</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="danger" loading={isDeleting} onClick={() => handleDeleteProperty(property)}>Delete</Button>
                        <Button size="sm" variant="ghost" disabled={isDeleting} onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
};

export default PropertyAdminListPage;
