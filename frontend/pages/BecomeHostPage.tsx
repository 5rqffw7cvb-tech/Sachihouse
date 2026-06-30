import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  CalendarSync,
  Check,
  CheckCircle2,
  ChevronDown,
  FileText,
  Globe,
  Loader2,
  Minus,
  Receipt,
  ScanLine,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import { TopNavBar } from '../components/TopNavBar';
import { Footer } from '../components/Footer';
import { getSiteSettings, DEFAULT_SITE_SETTINGS } from '../services/storage';
import { createSubscriptionRequest, listMySubscriptionRequests } from '../services/subscriptions';
import { checkAuth, getCurrentUser, subscribeToAuth } from '../services/auth';
import { BillingCycle, HostPlanCode, HostPlansConfig, SubscriptionRequest } from '../types';

interface PlanMeta {
  code: HostPlanCode;
  name: string;
  tagline: string;
  level: number;
  recommended?: boolean;
  features: Array<{ text: string; included: boolean }>;
}

// Every feature listed here maps to a capability that already exists in the
// product. Marketing-only items (AI chatbot, smart locks, photo services) were
// intentionally removed.
const PLAN_META: PlanMeta[] = [
  {
    code: 'basic',
    name: 'Basic',
    tagline: 'Publish a professional landing page for each of your properties.',
    level: 2,
    features: [
      { text: 'Dedicated landing page per property', included: true },
      { text: 'Photo gallery & photo tour', included: true },
      { text: 'House manual & guidebook', included: true },
      { text: 'Access & directions page', included: true },
      { text: 'Google SEO optimization', included: true },
      { text: 'Multi-platform calendar sync (iCal)', included: true },
      { text: 'Automated Minpaku check-in', included: false },
      { text: 'Finance dashboard & tax export', included: false },
    ],
  },
  {
    code: 'plus',
    name: 'Plus',
    tagline: 'Automate guest reception and keep legally-compliant lodging records.',
    level: 3,
    recommended: true,
    features: [
      { text: 'Everything in Basic', included: true },
      { text: 'Automated Minpaku check-in (passport OCR + guest ledger)', included: true },
      { text: 'Finance dashboard', included: false },
      { text: 'AI receipt scanning', included: false },
      { text: 'Ao-iro blue tax export', included: false },
    ],
  },
  {
    code: 'pro',
    name: 'Pro',
    tagline: 'A complete cash-flow and year-end Minpaku tax workflow.',
    level: 4,
    features: [
      { text: 'Everything in Plus', included: true },
      { text: 'Finance dashboard: revenue & profit', included: true },
      { text: 'AI receipt OCR & auto-categorization', included: true },
      { text: 'Ao-iro Tax Manager export (Japan blue tax)', included: true },
    ],
  },
];

interface ComparisonRow {
  icon: React.ComponentType<{ className?: string }>;
  feature: string;
  desc: string;
  basic: boolean;
  plus: boolean;
  pro: boolean;
}

const COMPARISON_ROWS: ComparisonRow[] = [
  { icon: Globe, feature: 'Landing page & website per property', desc: 'Your own site showing rooms, amenities and photos.', basic: true, plus: true, pro: true },
  { icon: BookOpen, feature: 'House manual & guidebook', desc: 'Device instructions, house rules and key pickup for guests.', basic: true, plus: true, pro: true },
  { icon: Globe, feature: 'Google SEO support', desc: 'Search optimization so your property surfaces better.', basic: true, plus: true, pro: true },
  { icon: CalendarSync, feature: 'Multi-platform calendar sync', desc: 'iCal sync to avoid double bookings (Airbnb, Booking.com…).', basic: true, plus: true, pro: true },
  { icon: ScanLine, feature: 'Automated Minpaku check-in', desc: 'Passport OCR capture & digital guest ledger per Japan lodging law.', basic: false, plus: true, pro: true },
  { icon: Wallet, feature: 'Finance dashboard', desc: 'Track real revenue, operating costs and profit.', basic: false, plus: false, pro: true },
  { icon: Receipt, feature: 'AI receipt scanning (OCR)', desc: 'Photograph receipts; the system reads amount & category.', basic: false, plus: false, pro: true },
  { icon: FileText, feature: 'Ao-iro blue tax export', desc: 'Auto-export books in the Japanese blue tax filing format.', basic: false, plus: false, pro: true },
];

const FAQS = [
  {
    q: 'How does self check-in stay compliant with Japan’s Minpaku law?',
    a: 'Under Japan’s lodging regulations, hosts must capture foreign guests’ passport pages and keep a guest ledger with signatures. The Plus and Pro plans store this digitally and securely, ready for government inspection.',
  },
  {
    q: 'What does the Ao-iro (blue tax) export do?',
    a: 'It aggregates your revenue and the expenses you scan via receipt OCR, then exports books in the blue-tax filing format so you can submit them to the tax office. Note: this is a bookkeeping support tool, not tax filing or advisory (reserved for licensed zeirishi).',
  },
  {
    q: 'How do I upgrade, and when does my plan activate?',
    a: 'Pick a plan and submit a request — an admin reviews it and activates your host level. New hosts start at level 1 (free) and can request an upgrade at any time.',
  },
];

const formatPrice = (amount: number): string => amount.toLocaleString('en-US');

// Host level -> plan label. Level 1 is the free, self-registered tier.
const LEVEL_LABEL: Record<number, string> = { 1: 'Free', 2: 'Basic', 3: 'Plus', 4: 'Pro' };

const BecomeHostPage: React.FC = () => {
  const navigate = useNavigate();
  const [billing, setBilling] = useState<BillingCycle>('monthly');
  const [hostPlans, setHostPlans] = useState<HostPlansConfig>(DEFAULT_SITE_SETTINGS.hostPlans!);
  const [authUser, setAuthUser] = useState(getCurrentUser());
  const [myRequests, setMyRequests] = useState<SubscriptionRequest[]>([]);
  const [pendingPlan, setPendingPlan] = useState<HostPlanCode | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    getSiteSettings()
      .then((s) => { if (s.hostPlans) setHostPlans(s.hostPlans); })
      .catch(() => { /* keep defaults */ });
  }, []);

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => setAuthUser(user)).then((unsub) => { unsubscribe = unsub; });
    return () => unsubscribe();
  }, []);

  const refreshMyRequests = () => {
    if (!checkAuth()) {
      setMyRequests([]);
      return;
    }
    listMySubscriptionRequests().then(setMyRequests).catch(() => {});
  };

  useEffect(() => {
    refreshMyRequests();
  }, [authUser]);

  const discount = Math.max(0, Math.min(100, hostPlans.yearlyDiscountPercent ?? 0));

  const priceFor = (code: HostPlanCode) => {
    const monthly = hostPlans.plans[code]?.monthlyPrice ?? 0;
    if (billing === 'monthly') {
      return { perMonth: monthly, yearlyTotal: null as number | null };
    }
    const discounted = Math.round(monthly * (1 - discount / 100));
    return { perMonth: discounted, yearlyTotal: discounted * 12 };
  };

  const pendingByPlan = useMemo(() => {
    const map = new Map<HostPlanCode, SubscriptionRequest>();
    myRequests
      .filter((r) => r.status === 'pending')
      .forEach((r) => { if (!map.has(r.planCode)) map.set(r.planCode, r); });
    return map;
  }, [myRequests]);

  const isHost = authUser?.role === 'HOST';
  const currentLevel = isHost ? (authUser?.hostLevel ?? 1) : 0;

  const handleSubscribe = async (code: HostPlanCode) => {
    setFeedback(null);
    if (!checkAuth()) {
      navigate(`/login?redirect=${encodeURIComponent('/become-host')}`);
      return;
    }
    setPendingPlan(code);
    try {
      await createSubscriptionRequest(code, billing);
      setFeedback({
        type: 'success',
        text: 'Request submitted! An admin will review your upgrade and activate your plan shortly.',
      });
      refreshMyRequests();
    } catch (error) {
      setFeedback({ type: 'error', text: error instanceof Error ? error.message : 'Could not submit request.' });
    } finally {
      setPendingPlan(null);
    }
  };

  const currencySymbol = hostPlans.currency === 'JPY' ? '¥' : '';

  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#334155] flex flex-col font-['Plus_Jakarta_Sans']">
      <TopNavBar />

      <main className="flex-1 w-full pt-[90px] md:pt-[96px] pb-16">
        {/* Billing toggle */}
        <section>
          <div className="text-center px-4 max-w-3xl mx-auto pt-4 pb-8">
            <div className="inline-flex items-center bg-white p-1.5 rounded-full border border-slate-200 shadow-sm">
              <button
                onClick={() => setBilling('monthly')}
                className={`px-5 py-2 text-sm font-semibold rounded-full transition-colors ${billing === 'monthly' ? 'bg-blue-600 text-white' : 'text-[#64748b] hover:text-[#0f172a]'}`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBilling('yearly')}
                className={`px-5 py-2 text-sm font-semibold rounded-full transition-colors flex items-center gap-2 ${billing === 'yearly' ? 'bg-blue-600 text-white' : 'text-[#64748b] hover:text-[#0f172a]'}`}
              >
                Yearly
                {discount > 0 && (
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${billing === 'yearly' ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-600'}`}>
                    Save {discount}%
                  </span>
                )}
              </button>
            </div>
          </div>
        </section>

        {/* Feedback banner */}
        {feedback && (
          <div className="max-w-5xl mx-auto px-4 mb-6">
            <div className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm border ${feedback.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
              {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <X className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{feedback.text}</span>
            </div>
          </div>
        )}

        {/* Current plan status (logged-in hosts) */}
        {isHost && (
          <div className="max-w-6xl mx-auto px-4 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-blue-50 text-blue-600 font-extrabold">
                  {currentLevel}
                </span>
                <div>
                  <p className="text-sm text-[#64748b]">Your current plan</p>
                  <p className="font-bold text-[#0f172a]">
                    {LEVEL_LABEL[currentLevel] ?? `Level ${currentLevel}`}
                    <span className="text-[#94a3b8] font-medium"> · Host level {currentLevel}</span>
                  </p>
                </div>
              </div>
              <p className="sm:ml-auto text-sm text-[#64748b]">
                {currentLevel >= 4
                  ? 'You’re on the top plan — nothing more to upgrade.'
                  : 'Pick a higher plan below to upgrade.'}
              </p>
            </div>
          </div>
        )}

        {/* Pricing cards */}
        <section className="max-w-6xl mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
            {PLAN_META.map((plan) => {
              const price = priceFor(plan.code);
              const isPending = pendingByPlan.has(plan.code);
              const isExactCurrent = isHost && currentLevel === plan.level;
              const isBelowCurrent = isHost && currentLevel > plan.level;
              const isDisabledCta = pendingPlan === plan.code || isPending || isExactCurrent || isBelowCurrent;
              const ctaLabel = isExactCurrent
                ? 'Current plan'
                : isBelowCurrent
                  ? 'Included'
                  : isPending
                    ? 'Pending approval'
                    : isHost
                      ? `Upgrade to ${plan.name}`
                      : 'Get started';
              return (
                <div
                  key={plan.code}
                  className={`relative bg-white rounded-2xl border p-7 flex flex-col transition-all hover:-translate-y-1 hover:shadow-lg ${isExactCurrent ? 'border-emerald-500 shadow-md ring-1 ring-emerald-500/20' : plan.recommended ? 'border-blue-600 shadow-md ring-1 ring-blue-600/10' : 'border-slate-200 shadow-sm'}`}
                >
                  {isExactCurrent ? (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-[11px] font-bold uppercase tracking-wide px-3 py-1 rounded-full">
                      Your plan
                    </div>
                  ) : plan.recommended && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-wide px-3 py-1 rounded-full">
                      Recommended
                    </div>
                  )}
                  <div className="mb-5">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-bold text-[#0f172a]">{plan.name}</h3>
                      <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Host level {plan.level}</span>
                    </div>
                    <p className="text-sm text-[#64748b] mt-2 min-h-[40px]">{plan.tagline}</p>
                  </div>

                  <div className="mb-1 flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-[#0f172a]">{currencySymbol}</span>
                    <span className="text-[44px] font-extrabold text-[#0f172a] leading-none tracking-tight">{formatPrice(price.perMonth)}</span>
                    <span className="text-sm text-[#64748b] ml-1">/month/unit</span>
                  </div>
                  <div className="h-5 mb-5">
                    {price.yearlyTotal !== null && (
                      <span className="text-xs text-emerald-600 font-medium">
                        {currencySymbol}{formatPrice(price.yearlyTotal)} billed yearly
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => handleSubscribe(plan.code)}
                    disabled={isDisabledCta}
                    className={`w-full text-center py-3 rounded-xl font-bold transition-colors mb-6 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${plan.recommended ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-white text-blue-600 border-2 border-blue-600 hover:bg-blue-600 hover:text-white'}`}
                  >
                    {pendingPlan === plan.code && <Loader2 className="w-4 h-4 animate-spin" />}
                    {ctaLabel}
                  </button>

                  <ul className="flex flex-col gap-3 mt-auto">
                    {plan.features.map((feature, i) => (
                      <li key={i} className={`flex items-start gap-3 text-sm ${feature.included ? 'text-[#334155]' : 'text-[#94a3b8] line-through'}`}>
                        {feature.included
                          ? <Check className="w-[18px] h-[18px] text-emerald-500 shrink-0 mt-0.5" />
                          : <X className="w-[18px] h-[18px] text-slate-300 shrink-0 mt-0.5" />}
                        <span>{feature.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        {/* Comparison table */}
        <section className="max-w-6xl mx-auto px-4 mt-16">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 md:p-10">
            <h2 className="text-2xl md:text-3xl font-extrabold text-[#0f172a] text-center mb-2">What’s included</h2>
            <p className="text-center text-[#64748b] mb-8">Every feature below is live in the platform today.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    <th className="p-4 bg-slate-50 font-bold text-[#0f172a] rounded-tl-xl">Feature</th>
                    <th className="p-4 bg-slate-50 font-bold text-[#0f172a] text-center w-[14%]">Basic</th>
                    <th className="p-4 bg-blue-50 font-bold text-blue-700 text-center w-[14%]">Plus</th>
                    <th className="p-4 bg-slate-50 font-bold text-[#0f172a] text-center w-[14%] rounded-tr-xl">Pro</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row, i) => {
                    const Icon = row.icon;
                    return (
                      <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/60">
                        <td className="p-4 align-top">
                          <div className="flex items-start gap-3">
                            <Icon className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                            <div>
                              <span className="font-semibold text-[#0f172a]">{row.feature}</span>
                              <span className="block text-xs text-[#64748b] mt-1">{row.desc}</span>
                            </div>
                          </div>
                        </td>
                        {(['basic', 'plus', 'pro'] as const).map((key) => (
                          <td key={key} className={`p-4 text-center align-middle ${key === 'plus' ? 'bg-blue-50/40' : ''}`}>
                            {row[key]
                              ? <Check className="w-5 h-5 text-emerald-500 inline" />
                              : <Minus className="w-5 h-5 text-slate-300 inline" />}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Compliance / trust strip */}
        <section className="max-w-6xl mx-auto px-4 mt-12">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-start gap-3">
              <ShieldCheck className="w-6 h-6 text-blue-600 shrink-0" />
              <div>
                <h4 className="font-bold text-[#0f172a] text-sm">Minpaku-compliant records</h4>
                <p className="text-xs text-[#64748b] mt-1">Passport capture & guest ledger kept per Japan lodging law.</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-start gap-3">
              <ScanLine className="w-6 h-6 text-blue-600 shrink-0" />
              <div>
                <h4 className="font-bold text-[#0f172a] text-sm">AI-assisted operations</h4>
                <p className="text-xs text-[#64748b] mt-1">Passport & receipt OCR cut manual data entry.</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-start gap-3">
              <FileText className="w-6 h-6 text-blue-600 shrink-0" />
              <div>
                <h4 className="font-bold text-[#0f172a] text-sm">Blue-tax ready</h4>
                <p className="text-xs text-[#64748b] mt-1">Export books in the Ao-iro filing format at year end.</p>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="max-w-3xl mx-auto px-4 mt-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-[#0f172a] text-center mb-8">Frequently asked questions</h2>
          <div className="flex flex-col gap-3">
            {FAQS.map((faq, i) => {
              const open = openFaq === i;
              return (
                <div key={i} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setOpenFaq(open ? null : i)}
                    className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left font-bold text-[#0f172a] hover:bg-slate-50"
                  >
                    <span>{faq.q}</span>
                    <ChevronDown className={`w-5 h-5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && (
                    <div className="px-5 pb-5 text-[15px] text-[#334155] border-t border-slate-100 pt-3">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default BecomeHostPage;
