import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { ApiUser } from '../services/api';
import { getCurrentUser, subscribeToAuth } from '../services/auth';
import { AdminShell } from '../components/AdminShell';
import { Alert, Button } from '../components/ui';
import { createCoupon, deleteCoupon, listCoupons, updateCoupon } from '../services/coupons';
import { getAllProperties } from '../services/storage';
import { Coupon, PropertyData } from '../types';

type CouponType = Coupon['type'];

interface CouponFormState {
  code: string;
  type: CouponType;
  value: number;
  startDate: string;
  endDate: string;
  active: boolean;
  propertyIds: string[];
}

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

const emptyForm = (): CouponFormState => {
  const today = new Date();
  const inOneWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    code: '',
    type: 'percentage',
    value: 10,
    startDate: toIsoDate(today),
    endDate: toIsoDate(inOneWeek),
    active: true,
    propertyIds: [],
  };
};

// Mirrors the backend's validation in POST/PUT /api/coupons so the admin
// sees the problem immediately instead of round-tripping to find out.
function validateForm(form: CouponFormState): string | null {
  if (!form.code.trim()) return 'Coupon code is required.';
  if (!Number.isInteger(form.value)) return 'Coupon value must be a whole number.';
  if (form.type === 'percentage' && (form.value < 1 || form.value > 100)) {
    return 'A percentage coupon value must be between 1 and 100.';
  }
  if (form.type === 'fixed_night' && form.value < 0) {
    return 'A fixed-night coupon value cannot be negative.';
  }
  if (form.startDate > form.endDate) return 'Start date must be on or before the end date.';
  return null;
}

const AdminCouponsPage: React.FC = () => {
  const [authUser, setAuthUser] = useState<ApiUser | null>(getCurrentUser());

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [properties, setProperties] = useState<(PropertyData & { id: string })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CouponFormState>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isAdmin = authUser?.role === 'ADMIN';

  const propertyNameById = useMemo(() => {
    const map = new Map<string, string>();
    properties.forEach((property) => map.set(property.id, property.name || property.id));
    return map;
  }, [properties]);

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => setAuthUser(user)).then((unsub) => {
      unsubscribe = unsub;
    });
    return () => unsubscribe();
  }, []);

  const loadData = async (refresh = false) => {
    if (!isAdmin) {
      setIsLoading(false);
      return;
    }
    if (refresh) setIsRefreshing(true); else setIsLoading(true);
    setErrorMsg(null);
    try {
      const [fetchedCoupons, fetchedProperties] = await Promise.all([listCoupons(), getAllProperties()]);
      setCoupons(fetchedCoupons);
      setProperties(fetchedProperties);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Failed to load coupons.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const openCreateModal = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (coupon: Coupon) => {
    setEditingId(coupon.id);
    setForm({
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      startDate: coupon.startDate,
      endDate: coupon.endDate,
      active: coupon.active,
      propertyIds: [...coupon.propertyIds],
    });
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
  };

  const togglePropertyId = (propertyId: string) => {
    setForm((prev) => ({
      ...prev,
      propertyIds: prev.propertyIds.includes(propertyId)
        ? prev.propertyIds.filter((id) => id !== propertyId)
        : [...prev.propertyIds, propertyId],
    }));
  };

  const handleSave = async () => {
    const validationError = validateForm(form);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setSaving(true);
    setFormError(null);
    const payload = {
      code: form.code.trim().toUpperCase(),
      type: form.type,
      value: form.value,
      startDate: form.startDate,
      endDate: form.endDate,
      active: form.active,
      propertyIds: form.propertyIds,
    };
    try {
      if (editingId) {
        const updated = await updateCoupon(editingId, payload);
        setCoupons((prev) => prev.map((c) => (c.id === editingId ? updated : c)));
        setInfoMsg(`Coupon ${updated.code} updated.`);
      } else {
        const created = await createCoupon(payload);
        setCoupons((prev) => [created, ...prev]);
        setInfoMsg(`Coupon ${created.code} created.`);
      }
      setModalOpen(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not save coupon.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (coupon: Coupon) => {
    if (!window.confirm(`Delete coupon ${coupon.code}? This cannot be undone.`)) {
      return;
    }
    setPendingDeleteId(coupon.id);
    setErrorMsg(null);
    try {
      await deleteCoupon(coupon.id);
      setCoupons((prev) => prev.filter((c) => c.id !== coupon.id));
      setInfoMsg(`Coupon ${coupon.code} deleted.`);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Could not delete coupon.');
    } finally {
      setPendingDeleteId(null);
    }
  };

  const inputCls = 'w-full px-3.5 py-2.5 bg-subtle border border-line rounded-control text-sm text-ink focus:outline-none focus:ring-2 focus:ring-[#041627]/20 focus:border-brand transition-colors disabled:opacity-60';
  const selectCls = inputCls + ' appearance-none';
  const primaryBtnCls = 'inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand text-white font-semibold text-xs hover:bg-brand/90 disabled:opacity-50 transition-colors';

  return (
    <AdminShell
      title="Coupon Administration"
      subtitle="Global discount codes, assigned to whichever properties should accept them."
      access="admin"
      activeKey="coupons"
      maxWidthClass="max-w-[1280px]"
      signInTitle="Coupon Admin Access"
      signInMessage="Sign in with an admin account to manage coupons."
      deniedTitle="Admin role required"
      deniedMessage="Your current account does not have permission to manage coupons."
      actions={(
        <>
          <Button icon={RefreshCw} loading={isRefreshing} onClick={() => loadData(true)}>Refresh</Button>
          <Button variant="primary" icon={Plus} onClick={openCreateModal}>New coupon</Button>
        </>
      )}
    >
        {errorMsg && <Alert tone="danger" onDismiss={() => setErrorMsg(null)}>{errorMsg}</Alert>}
        {infoMsg && <Alert tone="ok" onDismiss={() => setInfoMsg(null)}>{infoMsg}</Alert>}

        <section className="bg-surface border border-line rounded-card shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="p-10 flex items-center justify-center text-ink-soft">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading coupons...
            </div>
          ) : coupons.length === 0 ? (
            <div className="p-10 text-center text-ink-muted">No coupons yet. Create one to get started.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-subtle text-ink-soft">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Code</th>
                    <th className="text-left px-4 py-3 font-semibold">Discount</th>
                    <th className="text-left px-4 py-3 font-semibold">Valid</th>
                    <th className="text-left px-4 py-3 font-semibold">Properties</th>
                    <th className="text-left px-4 py-3 font-semibold">Status</th>
                    <th className="text-left px-4 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {coupons.map((coupon) => (
                    <tr key={coupon.id} className="border-t border-line align-top">
                      <td className="px-4 py-4">
                        <span className="font-mono font-bold text-ink tracking-wide">{coupon.code}</span>
                      </td>
                      <td className="px-4 py-4 text-ink-soft whitespace-nowrap">
                        {coupon.type === 'percentage' ? `${coupon.value}% off` : `¥${coupon.value.toLocaleString()} / night flat`}
                      </td>
                      <td className="px-4 py-4 text-ink-soft whitespace-nowrap">{coupon.startDate} → {coupon.endDate}</td>
                      <td className="px-4 py-4 text-ink-soft max-w-[280px]">
                        {coupon.propertyIds.length === 0 ? (
                          <span className="text-ink-muted">Not assigned yet</span>
                        ) : (
                          <>
                            <span className="font-semibold text-ink">{coupon.propertyIds.length}</span>{' '}
                            {coupon.propertyIds.length === 1 ? 'property' : 'properties'}: {coupon.propertyIds.map((id) => propertyNameById.get(id) ?? id).join(', ')}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${coupon.active ? 'bg-ok-tint text-ok' : 'bg-brand-tint text-ink-muted'}`}>
                          {coupon.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEditModal(coupon)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-line-strong bg-surface text-ink font-semibold text-xs hover:bg-brand-tint transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" /> Edit
                          </button>
                          <button
                            onClick={() => handleDelete(coupon)}
                            disabled={pendingDeleteId === coupon.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-red-200 bg-surface text-red-600 font-semibold text-xs hover:bg-red-50 disabled:opacity-50 transition-colors"
                          >
                            {pendingDeleteId === coupon.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      {modalOpen && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-surface w-full sm:max-w-lg sm:rounded-card rounded-t-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-ink">{editingId ? 'Edit Coupon' : 'New Coupon'}</h2>
              <button onClick={closeModal} disabled={saving} className="text-ink-muted hover:text-ink disabled:opacity-50">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Code</label>
              <input
                type="text"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="SH-SUMMER25"
                className={inputCls + ' font-mono uppercase'}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as CouponType }))}
                  className={selectCls}
                >
                  <option value="percentage">Percentage off</option>
                  <option value="fixed_night">Fixed price / night</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">
                  Value {form.type === 'percentage' ? '(%)' : '(¥/night)'}
                </label>
                <input
                  type="number"
                  value={form.value}
                  min={form.type === 'percentage' ? 1 : 0}
                  max={form.type === 'percentage' ? 100 : undefined}
                  onChange={(e) => setForm((f) => ({ ...f, value: Number(e.target.value) }))}
                  className={inputCls}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Valid from</label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-1.5">Valid until</label>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  className={inputCls}
                />
              </div>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                className="w-4 h-4 accent-[#041627]"
              />
              <span className="text-sm font-medium text-ink">Active</span>
            </label>

            <div>
              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Assigned properties</label>
              {properties.length === 0 ? (
                <p className="text-sm text-ink-muted">No properties available.</p>
              ) : (
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {properties.map((property) => {
                    const isAssigned = form.propertyIds.includes(property.id);
                    return (
                      <label key={property.id} className="flex items-center gap-3 p-3 rounded-control border border-line cursor-pointer hover:bg-subtle transition-colors">
                        <input
                          type="checkbox"
                          checked={isAssigned}
                          onChange={() => togglePropertyId(property.id)}
                          className="w-4 h-4 accent-[#041627]"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-ink">{property.name || property.id}</div>
                          <div className="text-xs text-ink-muted">{property.id}</div>
                        </div>
                        {isAssigned && <Check className="w-4 h-4 text-ok" />}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {formError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-control p-3">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{formError}</p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={closeModal}
                disabled={saving}
                className="flex-1 border border-line-strong text-ink font-bold py-3 rounded-control hover:bg-brand-tint disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className={primaryBtnCls + ' flex-1 justify-center py-3 text-sm'}
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingId ? 'Save changes' : 'Create coupon'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
};

export default AdminCouponsPage;
