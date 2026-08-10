import React, { useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, Loader2, RefreshCw, Save, Tag, X } from 'lucide-react';
import { ApiUser } from '../services/api';
import { getCurrentUser, subscribeToAuth } from '../services/auth';
import { AdminShell } from '../components/AdminShell';
import { DEFAULT_SITE_SETTINGS, getSiteSettings, saveSiteSettings } from '../services/storage';
import { approveSubscriptionRequest, listSubscriptionRequests, rejectSubscriptionRequest } from '../services/subscriptions';
import { HostPlanCode, HostPlansConfig, PLAN_TO_HOST_LEVEL, SiteSettings, SubscriptionRequest } from '../types';

const PLAN_LABELS: Record<HostPlanCode, string> = {
  basic: 'Basic',
  plus: 'Plus',
  pro: 'Pro',
};

const STATUS_BADGE: Record<SubscriptionRequest['status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

const ServicesAdminPage: React.FC = () => {
  const [authUser, setAuthUser] = useState<ApiUser | null>(getCurrentUser());

  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [plansDraft, setPlansDraft] = useState<HostPlansConfig>(DEFAULT_SITE_SETTINGS.hostPlans!);
  const [requests, setRequests] = useState<SubscriptionRequest[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const isAdmin = authUser?.role === 'ADMIN';

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => setAuthUser(user)).then((unsub) => { unsubscribe = unsub; });
    return () => unsubscribe();
  }, []);

  const loadData = async () => {
    if (!isAdmin) {
      setIsLoading(false);
      return;
    }
    setErrorMsg(null);
    try {
      const [fetchedSettings, fetchedRequests] = await Promise.all([getSiteSettings(), listSubscriptionRequests()]);
      setSettings(fetchedSettings);
      setPlansDraft(fetchedSettings.hostPlans ?? DEFAULT_SITE_SETTINGS.hostPlans!);
      setRequests(fetchedRequests);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Failed to load services data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const updatePlanPrice = (code: HostPlanCode, value: string) => {
    const price = Math.max(0, Math.round(Number(value) || 0));
    setPlansDraft((prev) => ({
      ...prev,
      plans: { ...prev.plans, [code]: { monthlyPrice: price } },
    }));
  };

  const handleSavePrices = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setIsSaving(true);
    try {
      const next: SiteSettings = { ...settings, hostPlans: plansDraft };
      await saveSiteSettings(next);
      setSettings(next);
      setInfoMsg('Pricing saved.');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Failed to save pricing.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDecision = async (request: SubscriptionRequest, approve: boolean) => {
    setErrorMsg(null);
    setInfoMsg(null);
    setPendingRequestId(request.id);
    try {
      const updated = approve
        ? await approveSubscriptionRequest(request.id)
        : await rejectSubscriptionRequest(request.id);
      setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setInfoMsg(approve
        ? `Approved — ${request.userEmail} is now host level ${PLAN_TO_HOST_LEVEL[request.planCode]}.`
        : `Rejected request from ${request.userEmail}.`);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Failed to update request.');
    } finally {
      setPendingRequestId(null);
    }
  };

  const pendingCount = useMemo(() => requests.filter((r) => r.status === 'pending').length, [requests]);

  const inputCls = 'w-full px-3.5 py-2.5 bg-[#f5f3f4] border border-[#e4e2e3] rounded-xl text-sm text-[#1b1c1d] focus:outline-none focus:ring-2 focus:ring-[#041627]/20 focus:border-[#041627] transition-colors disabled:opacity-60';

  return (
    <AdminShell
      title="Services"
      subtitle="Manage host plan pricing and review upgrade requests."
      access="admin"
      activeKey="services"
      badges={{ services: pendingCount }}
      maxWidthClass="max-w-[1100px]"
      deniedTitle="Admin role required"
      deniedMessage="Your current account does not have permission to manage services."
      signInTitle="Services Admin Access"
      signInMessage="Sign in with an admin account to manage plan pricing and host upgrade requests."
      actions={(
        <button
          onClick={() => { setIsLoading(true); void loadData(); }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#c4c6cd] bg-white text-[#1b1c1d] font-semibold hover:bg-[#efedef] transition-colors self-start"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      )}
    >
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
          <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-[#041627]" /></div>
        ) : (
          <div className="space-y-6">
            {/* Pricing editor */}
            <section className="bg-white rounded-2xl border border-[#e4e2e3] p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-5">
                <Tag className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-bold">Plan pricing ({plansDraft.currency})</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                {(['basic', 'plus', 'pro'] as const).map((code) => (
                  <div key={code}>
                    <label className="block text-xs font-semibold text-[#44474c] uppercase tracking-wide mb-1.5">
                      {PLAN_LABELS[code]} <span className="text-[#74777d] normal-case">(level {PLAN_TO_HOST_LEVEL[code]})</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#74777d] text-sm">¥</span>
                      <input
                        type="number"
                        min={0}
                        value={plansDraft.plans[code]?.monthlyPrice ?? 0}
                        onChange={(e) => updatePlanPrice(code, e.target.value)}
                        className={inputCls + ' pl-7'}
                      />
                    </div>
                    <span className="text-xs text-[#74777d] mt-1 block">per month / unit</span>
                  </div>
                ))}
              </div>

              <div className="max-w-xs">
                <label className="block text-xs font-semibold text-[#44474c] uppercase tracking-wide mb-1.5">Yearly discount (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={plansDraft.yearlyDiscountPercent}
                  onChange={(e) => setPlansDraft((prev) => ({ ...prev, yearlyDiscountPercent: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) }))}
                  className={inputCls}
                />
                <span className="text-xs text-[#74777d] mt-1 block">Applied to yearly billing on the Become Host page.</span>
              </div>

              <div className="mt-6">
                <button
                  onClick={handleSavePrices}
                  disabled={isSaving}
                  className="inline-flex items-center gap-2 bg-[#041627] hover:bg-[#041627]/90 text-white px-5 py-2.5 rounded-full font-semibold disabled:opacity-50 transition-colors"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save pricing
                </button>
              </div>
            </section>

            {/* Upgrade requests */}
            <section className="bg-white rounded-2xl border border-[#e4e2e3] p-6 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold">Upgrade requests</h2>
                {pendingCount > 0 && (
                  <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full">{pendingCount} pending</span>
                )}
              </div>

              {requests.length === 0 ? (
                <p className="text-sm text-[#74777d] py-6 text-center">No upgrade requests yet.</p>
              ) : (
                <div className="space-y-3">
                  {requests.map((request) => (
                    <div key={request.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-[#e4e2e3] rounded-xl px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-[#1b1c1d] truncate">{request.userName || request.userEmail}</span>
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[request.status]}`}>{request.status}</span>
                        </div>
                        <p className="text-xs text-[#74777d] mt-0.5 truncate">{request.userEmail}</p>
                        <p className="text-sm text-[#44474c] mt-1">
                          {PLAN_LABELS[request.planCode]} · {request.billingCycle} · grants host level {PLAN_TO_HOST_LEVEL[request.planCode]}
                        </p>
                      </div>
                      {request.status === 'pending' && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleDecision(request, true)}
                            disabled={pendingRequestId === request.id}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                          >
                            {pendingRequestId === request.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Approve
                          </button>
                          <button
                            onClick={() => handleDecision(request, false)}
                            disabled={pendingRequestId === request.id}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-[#c4c6cd] bg-white text-[#1b1c1d] font-semibold text-xs hover:bg-[#efedef] disabled:opacity-50 transition-colors"
                          >
                            <X className="w-3.5 h-3.5" /> Reject
                          </button>
                        </div>
                      )}
                      {request.status === 'approved' && (
                        <span className="inline-flex items-center gap-1.5 text-emerald-600 text-xs font-semibold shrink-0">
                          <CheckCircle2 className="w-4 h-4" /> Activated
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
    </AdminShell>
  );
};

export default ServicesAdminPage;
