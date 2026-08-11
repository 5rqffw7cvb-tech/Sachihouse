import React, { useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, Inbox, RefreshCw, Save, X } from 'lucide-react';
import { ApiUser } from '../services/api';
import { getCurrentUser, subscribeToAuth } from '../services/auth';
import { AdminShell } from '../components/AdminShell';
import { Alert, Badge, Button, Card, EmptyState, Field, Input } from '../components/ui';
import type { Tone } from '../components/ui';
import { DEFAULT_SITE_SETTINGS, getSiteSettings, saveSiteSettings } from '../services/storage';
import { approveSubscriptionRequest, listSubscriptionRequests, rejectSubscriptionRequest } from '../services/subscriptions';
import { HostPlanCode, HostPlansConfig, PLAN_TO_HOST_LEVEL, SiteSettings, SubscriptionRequest } from '../types';

const PLAN_LABELS: Record<HostPlanCode, string> = {
  basic: 'Basic',
  plus: 'Plus',
  pro: 'Pro',
};

const STATUS_TONE: Record<SubscriptionRequest['status'], Tone> = {
  pending: 'warn',
  approved: 'ok',
  rejected: 'danger',
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
  return (
    <AdminShell
      title="Services"
      subtitle="Manage host plan pricing and review upgrade requests."
      access="admin"
      activeKey="services"
      badges={{ services: pendingCount }}
      deniedTitle="Admin role required"
      deniedMessage="Your current account does not have permission to manage services."
      signInTitle="Services Admin Access"
      signInMessage="Sign in with an admin account to manage plan pricing and host upgrade requests."
      isLoading={isLoading}
      actions={<Button icon={RefreshCw} onClick={() => { setIsLoading(true); void loadData(); }}>Refresh</Button>}
    >
      {errorMsg && <Alert tone="danger" onDismiss={() => setErrorMsg(null)}>{errorMsg}</Alert>}
      {infoMsg && <Alert tone="ok" onDismiss={() => setInfoMsg(null)}>{infoMsg}</Alert>}

      <div className="space-y-5">
        <Card
          title={`Plan pricing (${plansDraft.currency})`}
          actions={<Button variant="primary" icon={Save} loading={isSaving} onClick={handleSavePrices}>Save pricing</Button>}
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(['basic', 'plus', 'pro'] as const).map((code) => (
              <Field
                key={code}
                label={`${PLAN_LABELS[code]} — level ${PLAN_TO_HOST_LEVEL[code]}`}
                hint="Per month, per unit"
              >
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted text-[14px]">¥</span>
                  <Input
                    type="number"
                    min={0}
                    value={plansDraft.plans[code]?.monthlyPrice ?? 0}
                    onChange={(e) => updatePlanPrice(code, e.target.value)}
                    className="pl-7"
                  />
                </div>
              </Field>
            ))}
          </div>

          <div className="mt-5 max-w-xs">
            <Field label="Yearly discount (%)" hint="Applied to yearly billing on the Become Host page.">
              <Input
                type="number"
                min={0}
                max={100}
                value={plansDraft.yearlyDiscountPercent}
                onChange={(e) => setPlansDraft((prev) => ({
                  ...prev,
                  yearlyDiscountPercent: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))),
                }))}
              />
            </Field>
          </div>
        </Card>

        <Card
          title="Upgrade requests"
          padded={false}
          actions={pendingCount > 0 ? <Badge tone="warn">{pendingCount} pending</Badge> : undefined}
        >
          {requests.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No upgrade requests"
              description="Requests appear here when a host asks to move to a paid plan."
            />
          ) : (
            <ul className="divide-y divide-line">
              {requests.map((request) => (
                <li key={request.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-ink truncate">{request.userName || request.userEmail}</span>
                      <Badge tone={STATUS_TONE[request.status]}>{request.status}</Badge>
                    </div>
                    <p className="text-[13px] text-ink-muted mt-0.5 truncate">{request.userEmail}</p>
                    <p className="text-[13px] text-ink-soft mt-1">
                      {PLAN_LABELS[request.planCode]} · {request.billingCycle} · grants host level {PLAN_TO_HOST_LEVEL[request.planCode]}
                    </p>
                  </div>

                  {request.status === 'pending' ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="primary"
                        icon={Check}
                        loading={pendingRequestId === request.id}
                        onClick={() => handleDecision(request, true)}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        icon={X}
                        disabled={pendingRequestId === request.id}
                        onClick={() => handleDecision(request, false)}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : request.status === 'approved' ? (
                    <span className="inline-flex items-center gap-1.5 text-ok text-[13px] font-semibold shrink-0">
                      <CheckCircle2 className="w-4 h-4" /> Activated
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AdminShell>
  );
};

export default ServicesAdminPage;
