import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Check, Loader2, Lock, Pencil, Plus, RefreshCw, Ticket, Trash2, X } from 'lucide-react';
import { ApiUser } from '../services/api';
import { checkAuth, getCurrentUser, subscribeToAuth } from '../services/auth';
import { TopNavBar } from '../components/TopNavBar';
import { MobileBottomNav } from '../components/MobileBottomNav';
import { Footer } from '../components/Footer';
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
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(checkAuth());
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
    subscribeToAuth((user) => {
      setAuthUser(user);
      setIsAuthenticated(!!user);
    }).then((unsub) => {
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

  const handleLogin = () => {
    navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);
  };

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

  const inputCls = 'w-full px-3.5 py-2.5 bg-[#f5f3f4] border border-[#e4e2e3] rounded-xl text-sm text-[#1b1c1d] focus:outline-none focus:ring-2 focus:ring-[#041627]/20 focus:border-[#041627] transition-colors disabled:opacity-60';
  const selectCls = inputCls + ' appearance-none';
  const primaryBtnCls = 'inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#041627] text-white font-semibold text-xs hover:bg-[#041627]/90 disabled:opacity-50 transition-colors';

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#e8e5e6] flex flex-col">
        <TopNavBar />
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-[#e4e2e3] w-full max-w-md text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-[#efedef] text-[#44474c] flex items-center justify-center">
              <Lock className="w-6 h-6" />
            </div>
            <h2 className="text-[22px] font-bold text-[#1b1c1d] mb-2">Coupon Admin Access</h2>
            <p className="text-sm text-[#44474c] mb-6">Sign in with an admin account to manage coupons.</p>
            <button onClick={handleLogin} className="w-full bg-[#041627] hover:bg-[#041627]/90 text-white font-bold py-3 px-4 rounded-full">Login</button>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#e8e5e6] flex flex-col">
        <TopNavBar />
        <div className="max-w-3xl mx-auto px-4 pt-[110px] pb-12">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 shadow-sm text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-[#1b1c1d] mb-2">Admin role required</h1>
            <p className="text-[#44474c] mb-6">Your current account does not have permission to manage coupons.</p>
            <Link to="/" className="inline-flex items-center px-5 py-2.5 rounded-full border border-[#041627] text-[#041627] font-semibold hover:bg-[#efedef] transition-colors">Back to listings</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#e8e5e6] text-[#1b1c1d] flex flex-col">
      <TopNavBar />
      <main className="flex-1 w-full max-w-[1280px] mx-auto px-3 md:px-6 pt-[110px] pb-28 md:pb-10">

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="font-['Plus_Jakarta_Sans'] text-[28px] font-bold leading-tight flex items-center gap-2">
              <Ticket className="w-6 h-6" /> Coupon Administration
            </h1>
            <p className="text-[#44474c] mt-1">Global discount codes, assigned to whichever properties should accept them.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => loadData(true)}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#c4c6cd] bg-white text-[#1b1c1d] font-semibold hover:bg-[#efedef] disabled:opacity-60 transition-colors"
            >
              {isRefreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Refresh
            </button>
            <button
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 bg-[#041627] hover:bg-[#041627]/90 text-white px-4 py-2 rounded-full font-semibold transition-colors"
            >
              <Plus className="w-4 h-4" /> New Coupon
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-5 border border-red-200 bg-red-50 text-red-700 rounded-2xl px-4 py-3 text-sm flex items-center justify-between gap-3">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="flex-shrink-0 text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
          </div>
        )}
        {infoMsg && (
          <div className="mb-5 border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-2xl px-4 py-3 text-sm flex items-center justify-between gap-3">
            <span>{infoMsg}</span>
            <button onClick={() => setInfoMsg(null)} className="flex-shrink-0 text-emerald-400 hover:text-emerald-600"><X className="w-4 h-4" /></button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-[#74777d]">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : coupons.length === 0 ? (
          <div className="bg-white border border-dashed border-[#c4c6cd] rounded-2xl p-10 text-center text-[#74777d]">
            No coupons yet. Create one to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {coupons.map((coupon) => (
              <div key={coupon.id} className="bg-white border border-[#e4e2e3] rounded-2xl p-5 shadow-sm flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono font-bold text-lg text-[#1b1c1d] tracking-wide">{coupon.code}</span>
                  <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${coupon.active ? 'bg-[#e6f5ec] text-[#0f7a44]' : 'bg-[#efedef] text-[#74777d]'}`}>
                    {coupon.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="text-sm text-[#44474c]">
                  {coupon.type === 'percentage' ? `${coupon.value}% off` : `¥${coupon.value.toLocaleString()} / night flat`}
                </div>
                <div className="text-xs text-[#74777d]">{coupon.startDate} → {coupon.endDate}</div>
                <div className="text-xs text-[#74777d]">
                  {coupon.propertyIds.length === 0 ? (
                    'Not assigned to any property yet'
                  ) : (
                    <>Assigned to {coupon.propertyIds.length} {coupon.propertyIds.length === 1 ? 'property' : 'properties'}: {coupon.propertyIds.map((id) => propertyNameById.get(id) ?? id).join(', ')}</>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    onClick={() => openEditModal(coupon)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#c4c6cd] bg-white text-[#1b1c1d] font-semibold text-xs hover:bg-[#efedef] transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button
                    onClick={() => handleDelete(coupon)}
                    disabled={pendingDeleteId === coupon.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-red-200 bg-white text-red-600 font-semibold text-xs hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    {pendingDeleteId === coupon.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <Footer />
      <MobileBottomNav />

      {modalOpen && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#1b1c1d]">{editingId ? 'Edit Coupon' : 'New Coupon'}</h2>
              <button onClick={closeModal} disabled={saving} className="text-[#74777d] hover:text-[#1b1c1d] disabled:opacity-50">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#74777d] uppercase tracking-wide mb-1.5">Code</label>
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
                <label className="block text-xs font-semibold text-[#74777d] uppercase tracking-wide mb-1.5">Type</label>
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
                <label className="block text-xs font-semibold text-[#74777d] uppercase tracking-wide mb-1.5">
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
                <label className="block text-xs font-semibold text-[#74777d] uppercase tracking-wide mb-1.5">Valid from</label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#74777d] uppercase tracking-wide mb-1.5">Valid until</label>
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
              <span className="text-sm font-medium text-[#1b1c1d]">Active</span>
            </label>

            <div>
              <label className="block text-xs font-semibold text-[#74777d] uppercase tracking-wide mb-2">Assigned properties</label>
              {properties.length === 0 ? (
                <p className="text-sm text-[#74777d]">No properties available.</p>
              ) : (
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {properties.map((property) => {
                    const isAssigned = form.propertyIds.includes(property.id);
                    return (
                      <label key={property.id} className="flex items-center gap-3 p-3 rounded-xl border border-[#e4e2e3] cursor-pointer hover:bg-[#f5f3f4] transition-colors">
                        <input
                          type="checkbox"
                          checked={isAssigned}
                          onChange={() => togglePropertyId(property.id)}
                          className="w-4 h-4 accent-[#041627]"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[#1b1c1d]">{property.name || property.id}</div>
                          <div className="text-xs text-[#74777d]">{property.id}</div>
                        </div>
                        {isAssigned && <Check className="w-4 h-4 text-[#0f7a44]" />}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {formError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{formError}</p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={closeModal}
                disabled={saving}
                className="flex-1 border border-[#c4c6cd] text-[#1b1c1d] font-bold py-3 rounded-xl hover:bg-[#efedef] disabled:opacity-50 transition-colors"
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
    </div>
  );
};

export default AdminCouponsPage;
