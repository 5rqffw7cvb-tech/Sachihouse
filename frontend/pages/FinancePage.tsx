import React, { useState, useEffect, useCallback, Suspense, lazy, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, LayoutDashboard, FileSpreadsheet, Scale, CalendarDays, BookOpen,
  Check, RefreshCw, Printer, Menu, X, ChevronsUpDown, Building, Search, ChevronRight,
  Clock,
} from 'lucide-react';
import { getCurrentUser } from '../services/auth';
import { financeApi, transactionsToCsvRows, FINANCE_HEADERS, FinancialProperty } from '../services/finance';
import { processFinancials, ACCOUNT_TYPE_MAP } from '../utils/accountingUtils';
import { FinancialReport, CsvRow, AccountType, FinancialTransaction } from '../types/finance';
import { TopNavBar } from '../components/TopNavBar';

const Dashboard    = lazy(() => import('../components/finance/Dashboard'));
const PLStatement  = lazy(() => import('../components/finance/PLStatement'));
const BSStatement  = lazy(() => import('../components/finance/BSStatement'));
const MonthlyReport = lazy(() => import('../components/finance/MonthlyReport'));
const Journal      = lazy(() => import('../components/finance/Journal'));
const PendingJournal = lazy(() => import('../components/finance/PendingJournal'));

type Tab = 'dashboard' | 'pl' | 'bs' | 'monthly' | 'journal' | 'pending';

const NAV_ITEMS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Dash Board',       icon: LayoutDashboard },
  { id: 'pl',        label: '損益計算書',       icon: FileSpreadsheet  },
  { id: 'bs',        label: '貸借対照表',       icon: Scale            },
  { id: 'monthly',   label: '月次推移',         icon: CalendarDays     },
  { id: 'journal',   label: '仕訳帳',           icon: BookOpen         },
  { id: 'pending',   label: '仕訳帳（未承認）', icon: Clock            },
];

const SuspenseFallback = () => (
  <div className="flex items-center justify-center py-20 text-gray-400">
    <Loader2 className="w-8 h-8 animate-spin" />
  </div>
);

const EMPTY_REPORT = (year: number): FinancialReport => ({
  targetYear: year, hasOutOfRangeData: false, headers: FINANCE_HEADERS,
  plItems: [], bsAssets: [], bsLiabilities: [], bsEquity: [],
  totalRevenue: 0, totalCostOfSales: 0, totalExpense: 0,
  grossProfit: 0, operatingIncome: 0, netIncome: 0,
  equityBaseTotal: 0, previousRetainedEarnings: 0,
  monthlyRevenue: [], monthlyCostOfSales: [], monthlyExpense: [], monthlyProfit: [],
  journalEntries: [], validationErrors: [],
});

const SIDEBAR_W = 272; // px
const ACTIVE_TAB_KEY = 'finance.activeTab';

const TAB_IDS: Tab[] = ['dashboard', 'pl', 'bs', 'monthly', 'journal', 'pending'];
const getInitialTab = (): Tab => {
  try {
    const saved = localStorage.getItem(ACTIVE_TAB_KEY) as Tab | null;
    if (saved && TAB_IDS.includes(saved)) return saved;
  } catch { /* ignore */ }
  return 'dashboard';
};

const getRegYear = (id: string): number => {
  const hash = id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return 2018 + (hash % 7); // Generates stable registration years between 2018 and 2024
};

const FinancePage: React.FC = () => {
  const navigate    = useNavigate();
  const authUser    = getCurrentUser();
  const currentYear = new Date().getFullYear();

  const [allProperties,       setAllProperties]       = useState<FinancialProperty[]>([]);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [selectedYear,        setSelectedYear]        = useState<number>(currentYear);
  const [activeTab,           setActiveTab]           = useState<Tab>(getInitialTab);
  const [rawData,             setRawData]             = useState<CsvRow[] | null>(null);
  const [report,              setReport]              = useState<FinancialReport | null>(null);
  const [isLoading,           setIsLoading]           = useState(true);
  const [isRefreshing,        setIsRefreshing]        = useState(false);
  const [lastUpdated,         setLastUpdated]         = useState<Date | null>(null);
  const [sidebarOpen,         setSidebarOpen]         = useState(true);

  // Store all transactions for accessible properties of the selected year
  const [allTransactions,     setAllTransactions]     = useState<FinancialTransaction[]>([]);

  // Sliding Property Drawer states (Emerges from behind sidebar, overlays right content)
  const [isPropDrawerOpen,         setIsPropDrawerOpen]         = useState(false);
  const [modalSearchTerm,          setModalSearchTerm]          = useState('');
  const [tempSelectedPropertyIds,  setTempSelectedPropertyIds]  = useState<string[]>([]);

  // Remember the active tab across refreshes.
  useEffect(() => {
    try { localStorage.setItem(ACTIVE_TAB_KEY, activeTab); } catch { /* ignore */ }
  }, [activeTab]);

  useEffect(() => {
    if (!authUser) navigate('/login?redirect=%23%2Fadmin%2Ffinance');
  }, [authUser, navigate]);

  useEffect(() => {
    if (!authUser) return;
    const canUseFinance = authUser.role === 'ADMIN' || (authUser.role === 'HOST' && (authUser.hostLevel ?? 0) >= 4);
    if (!canUseFinance) return;
    financeApi.listProperties().then(props => {
      setAllProperties(props);
      if (props.length > 0) setSelectedPropertyIds([props[0].id]);
    }).catch(console.error);
  }, []);

  const loadTransactions = useCallback(async (year: number) => {
    if (allProperties.length === 0) { setRawData([]); setReport(null); return; }
    setIsRefreshing(true);
    try {
      // Fetch all transactions for all accessible properties to compute stats locally
      const allAccessibleIds = allProperties.map(p => p.id);
      const transactions = await financeApi.listTransactions(allAccessibleIds, year);
      setAllTransactions(transactions);
      setLastUpdated(new Date());
    } catch (e) {
      console.error(e);
    } finally {
      setIsRefreshing(false);
      setIsLoading(false);
    }
  }, [allProperties]);

  useEffect(() => {
    if (allProperties.length > 0) {
      setIsLoading(true);
      loadTransactions(selectedYear);
    }
  }, [allProperties, selectedYear, loadTransactions]);

  const handleRefresh = () => loadTransactions(selectedYear);
  const handleYearChange = (year: number) => setSelectedYear(year);

  const toggleProperty = (id: string) =>
    setSelectedPropertyIds(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);

  const selectAll = () => setSelectedPropertyIds(allProperties.map(p => p.id));
  const selectOne = (id: string) => setSelectedPropertyIds([id]);

  // Compute total revenue for each property locally for the list and modal
  const propertyRevenues = useMemo(() => {
    const revs: Record<string, number> = {};
    allProperties.forEach(p => {
      const propTx = allTransactions.filter(t => t.propertyId === p.id);
      const sum = propTx
        .filter(t => ACCOUNT_TYPE_MAP[t.creditAccount] === AccountType.Revenue)
        .reduce((acc, t) => acc + t.debitAmount, 0);
      revs[p.id] = sum;
    });
    return revs;
  }, [allProperties, allTransactions]);

  // Map of propertyId → name for labelling rows by 物件
  const propertyNameById = useMemo(() => {
    const map: Record<string, string> = {};
    allProperties.forEach(p => { map[p.id] = p.name; });
    return map;
  }, [allProperties]);

  const isMultiProperty = selectedPropertyIds.length > 1;

  // Always surface a プロパティ名 column so rows can be told apart.
  const journalHeaders = useMemo(() => ['プロパティ名', ...FINANCE_HEADERS], []);

  // Dynamically calculate the active report when selected properties change or allTransactions are re-fetched
  useEffect(() => {
    if (allProperties.length > 0) {
      const selectedTx = allTransactions.filter(t => selectedPropertyIds.includes(t.propertyId));
      const rows = transactionsToCsvRows(selectedTx, propertyNameById);
      setRawData(rows);
      setReport(processFinancials(rows, FINANCE_HEADERS, selectedYear));
    }
  }, [selectedPropertyIds, allTransactions, selectedYear, allProperties, propertyNameById]);

  // Sort properties by revenue descending for the advanced selection list
  const sortedProperties = useMemo(() => {
    return allProperties
      .filter(p => p.name.toLowerCase().includes(modalSearchTerm.toLowerCase()) || p.id.toLowerCase().includes(modalSearchTerm.toLowerCase()))
      .sort((a, b) => {
        const revA = propertyRevenues[a.id] || 0;
        const revB = propertyRevenues[b.id] || 0;
        return revB - revA; // Descending
      });
  }, [allProperties, modalSearchTerm, propertyRevenues]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(val);
  };

  const toggleSidebar = () => {
    setSidebarOpen(v => {
      const next = !v;
      if (!next) setIsPropDrawerOpen(false); // Close property drawer if menu is closed
      return next;
    });
  };

  if (!authUser) return null;
  // Finance is reserved for admins and host level 4 only.
  const hasFinanceAccess = authUser.role === 'ADMIN' || (authUser.role === 'HOST' && (authUser.hostLevel ?? 0) >= 4);
  if (!hasFinanceAccess) {
    return (
      <>
        <TopNavBar />
        <div className="min-h-screen bg-[#e8e5e6] flex items-center justify-center">
          <p className="text-red-600 font-semibold">アクセス権限がありません。</p>
        </div>
      </>
    );
  }

  const selectedLabel = selectedPropertyIds.length === 0
    ? 'プロパティを選択'
    : selectedPropertyIds.length === 1
      ? (allProperties.find(p => p.id === selectedPropertyIds[0])?.name || selectedPropertyIds[0])
      : `${selectedPropertyIds.length} プロパティ選択中`;

  // ── Header: only the sidebar toggle button ─────────────────────────────
  const financeToolbar = (
    <div className="hidden md:flex items-center no-print">
      <button
        onClick={toggleSidebar}
        className="flex items-center gap-2 px-3 py-1.5 bg-white text-[#1b1c1d] rounded-lg text-sm font-semibold border border-[#ccc9ca] hover:bg-[#f5f3f4] active:scale-[.97] transition-all shadow-sm"
      >
        <Menu className="w-4 h-4 text-[#1b1c1d]" />
        <span className="text-[#1b1c1d] font-bold">Menu</span>
      </button>
    </div>
  );

  const mobileToolbar = (
    <div className="flex items-center no-print">
      <button
        onClick={toggleSidebar}
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white text-[#1b1c1d] rounded-lg text-sm font-semibold border border-[#ccc9ca] hover:bg-[#f5f3f4]"
      >
        <Menu className="w-4 h-4 text-[#1b1c1d]" />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#e8e5e6] print:bg-white relative">
      <TopNavBar
        navTitleOverride="財務管理"
        actionButton={financeToolbar}
        mobileActionButton={mobileToolbar}
      />

      {/* ── Sidebar (fixed, slides from left, High-Contrast Styles) ──────────────────────────── */}
      <aside
        className={`no-print fixed top-[72px] left-0 z-40 h-[calc(100vh-72px)] bg-white border-r border-[#ccc9ca] shadow-md flex flex-col transition-transform duration-300 ease-in-out overflow-hidden`}
        style={{ width: SIDEBAR_W, transform: sidebarOpen ? 'translateX(0)' : `translateX(-${SIDEBAR_W}px)` }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#ccc9ca] bg-[#f5f3f4]/30 shrink-0">
          <span className="font-extrabold text-[#1b1c1d] text-sm uppercase tracking-wide">メニュー</span>
          <button onClick={() => setSidebarOpen(false)} className="p-1 text-gray-500 hover:text-black rounded-md hover:bg-slate-100 transition-colors">
            <X className="w-4 h-4 text-[#1b1c1d]" />
          </button>
        </div>

        {/* Direct Action Property Selector (Triggers Drawer Instantly) */}
        {allProperties.length > 0 && (
          <div className="px-4 py-3.5 border-b border-[#ccc9ca] shrink-0">
            <p className="text-[11px] font-bold text-gray-800 uppercase tracking-widest mb-2 flex items-center gap-1.5">
              <Building className="w-3.5 h-3.5 text-blue-700" />
              <span>プロパティ</span>
            </p>
            <button
              onClick={() => {
                setTempSelectedPropertyIds([...selectedPropertyIds]);
                setModalSearchTerm('');
                setIsPropDrawerOpen(!isPropDrawerOpen);
              }}
              className={`w-full flex items-center justify-between border rounded-xl px-3 py-2.5 text-xs font-bold transition-all text-left shadow-sm ${
                isPropDrawerOpen
                  ? 'bg-blue-50 border-blue-600 text-blue-950 ring-1 ring-blue-600'
                  : 'bg-white border-[#ccc9ca] text-gray-900 hover:bg-slate-50'
              }`}
            >
              <span className="truncate pr-3">{selectedLabel}</span>
              <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${isPropDrawerOpen ? 'rotate-90 text-blue-700' : 'text-gray-600'}`} />
            </button>
          </div>
        )}

        {/* Year Selector styled and optimized (High-Contrast) */}
        <div className="px-4 py-3.5 border-b border-[#ccc9ca] shrink-0">
          <p className="text-[11px] font-bold text-gray-800 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-blue-700" />
            <span>会計年度 (10年)</span>
          </p>
          <div className="relative">
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(parseInt(e.target.value))}
              className="w-full bg-white border border-[#ccc9ca] rounded-xl px-3 py-2 text-xs font-bold text-gray-900 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all appearance-none cursor-pointer shadow-sm"
            >
              {Array.from({ length: 10 }, (_, i) => currentYear + 1 - i).map(y => (
                <option key={y} value={y}>{y}年</option>
              ))}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-600">
              <ChevronsUpDown className="w-3.5 h-3.5" />
            </div>
          </div>
        </div>

        {/* Nav items (High-Contrast) */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto bg-white">
          <p className="text-[11px] font-bold text-gray-800 uppercase tracking-widest px-3 pt-1.5 pb-2">レポート</p>
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                activeTab === item.id
                  ? 'bg-[#1b1c1d] text-white shadow-sm'
                  : 'text-gray-900 hover:bg-[#f5f3f4] hover:text-black'
              }`}
            >
              <item.icon className={`w-4 h-4 shrink-0 ${activeTab === item.id ? 'text-white' : 'text-gray-700'}`} />
              {item.label}
            </button>
          ))}
        </nav>

        {/* Footer (High-Contrast) */}
        <div className="p-3 border-t border-[#ccc9ca] flex gap-2 shrink-0 bg-[#f5f3f4]/10">
          <button
            onClick={() => { handleRefresh(); }}
            disabled={isRefreshing}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-[#ccc9ca] rounded-lg text-xs font-bold text-gray-900 hover:bg-slate-100 disabled:opacity-40 transition-colors shadow-sm bg-white"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-gray-700 ${isRefreshing ? 'animate-spin' : ''}`} />
            更新
          </button>
          {report && (
            <button
              onClick={() => window.print()}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 border border-[#ccc9ca] rounded-lg text-xs font-bold text-gray-900 hover:bg-slate-100 transition-colors shadow-sm bg-white"
            >
              <Printer className="w-3.5 h-3.5 text-gray-700" />
              印刷
            </button>
          )}
        </div>
      </aside>

      {/* Mobile backdrop (overlay on small screens only) */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-30 no-print"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Main content — shifts right on desktop when sidebar open ─────── */}
      <div
        className="pt-[72px] print:pt-0 print:ml-0 transition-[margin] duration-300 ease-in-out"
        style={{ marginLeft: sidebarOpen ? SIDEBAR_W : 0 }}
      >
        {/* Print-only header */}
        <div className="hidden print:block text-center py-4 mb-2 font-mincho border-b border-gray-300">
          <p className="text-sm font-medium text-gray-700">{selectedLabel} — {selectedYear}年</p>
        </div>

        <div className="w-full px-4 py-3 print:px-0 print:py-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : (
            <Suspense fallback={<SuspenseFallback />}>
              {activeTab === 'dashboard' && report && (
                <Dashboard
                  report={report}
                  lastUpdated={lastUpdated}
                  onRefresh={handleRefresh}
                  isRefreshing={isRefreshing}
                  onYearChange={handleYearChange}
                />
              )}
              {activeTab === 'pl'      && report && <PLStatement  report={report} />}
              {activeTab === 'bs'      && report && <BSStatement  report={report} />}
              {activeTab === 'monthly' && report && <MonthlyReport report={report} />}
              {activeTab === 'journal' && (
                <Journal
                  report={report ?? EMPTY_REPORT(selectedYear)}
                  propertyId={selectedPropertyIds[0] || ''}
                  propertyName={allProperties.find(p => p.id === selectedPropertyIds[0])?.name}
                  selectedPropertyIds={selectedPropertyIds}
                  allProperties={allProperties}
                  onRefresh={handleRefresh}
                  rawData={rawData ?? undefined}
                  headers={journalHeaders}
                />
              )}
              {activeTab === 'pending' && (
                <PendingJournal
                  propertyId={selectedPropertyIds[0] || ''}
                  propertyName={allProperties.find(p => p.id === selectedPropertyIds[0])?.name}
                  selectedPropertyIds={selectedPropertyIds}
                  allProperties={allProperties}
                  onApproved={handleRefresh}
                />
              )}
              {!report && activeTab !== 'journal' && activeTab !== 'pending' && (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
                  <BookOpen className="w-10 h-10 opacity-30" />
                  <p className="text-sm">データがありません。プロパティを選択してください。</p>
                </div>
              )}
            </Suspense>
          )}
        </div>
      </div>

      {/* ── Sliding Property Selector Sidebar Drawer (Side-by-Side overlay) ── */}
      <div
        className={`no-print fixed top-[72px] h-[calc(100vh-72px)] bg-white shadow-2xl transition-transform duration-300 ease-in-out flex flex-col border-r border-[#ccc9ca] font-sans w-full left-0 z-[60] md:z-30 md:max-w-[520px] ${
          sidebarOpen ? 'md:left-[272px]' : 'md:left-0'
        }`}
        style={{
          transform: isPropDrawerOpen ? 'translateX(0)' : 'translateX(-100%)',
        }}
      >
        {/* Drawer Header */}
        <div className="px-5 py-4 bg-[#f5f3f4] border-b border-[#ccc9ca] flex justify-between items-center sticky top-0 z-10 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Building className="w-5 h-5 text-[#003580]" />
            <h3 className="font-extrabold text-[#1b1c1d] text-sm">プロパティ詳細・売上順選択</h3>
          </div>
          <button
            onClick={() => setIsPropDrawerOpen(false)}
            className="text-gray-700 hover:text-black p-1.5 hover:bg-slate-200 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-[#1b1c1d]" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="p-4 flex-1 overflow-y-auto space-y-4">
          {/* Search and stats bar */}
          <div className="flex flex-col gap-3 bg-[#f5f3f4] p-4 rounded-xl border border-[#ccc9ca]">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
              <input
                type="text"
                placeholder="物件名・IDで検索..."
                value={modalSearchTerm}
                onChange={e => setModalSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white border border-[#ccc9ca] rounded-lg text-xs outline-none focus:ring-1 focus:ring-blue-500 text-gray-900 font-semibold"
              />
            </div>
            <div className="flex items-center justify-between text-xs font-bold text-gray-800">
              <span>選択中: <b className="text-blue-700 text-sm font-mono">{tempSelectedPropertyIds.length}</b> / {allProperties.length} 棟</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTempSelectedPropertyIds(allProperties.map(p => p.id))}
                  className="px-3 py-1.5 bg-white border border-[#ccc9ca] hover:bg-slate-100 rounded-lg text-[10px] font-bold shadow-sm transition-colors"
                >
                  全て選択
                </button>
                <button
                  type="button"
                  onClick={() => setTempSelectedPropertyIds([])}
                  className="px-3 py-1.5 bg-white border border-[#ccc9ca] hover:bg-slate-100 rounded-lg text-[10px] font-bold shadow-sm transition-colors"
                >
                  全解除
                </button>
              </div>
            </div>
          </div>

          {/* High-Contrast List Table of properties sorted by revenue descending */}
          <div className="overflow-x-auto rounded-xl border border-[#ccc9ca] shadow-sm bg-white">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[#f5f3f4] border-b border-[#ccc9ca] text-left text-gray-800 h-10">
                  <th className="py-2.5 px-2.5 font-extrabold text-center w-12 border-r border-[#ccc9ca]">選択</th>
                  <th className="py-2.5 px-2.5 font-extrabold border-r border-[#ccc9ca]">物件ID</th>
                  <th className="py-2.5 px-2.5 font-extrabold border-r border-[#ccc9ca]">物件名</th>
                  <th className="py-2.5 px-2.5 font-extrabold text-center border-r border-[#ccc9ca] w-20">登録年</th>
                  <th className="py-2.5 px-2.5 font-extrabold text-right pr-4 w-32">総売上高</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ccc9ca] text-gray-900 font-medium">
                {sortedProperties.map((prop, idx) => {
                  const isChecked = tempSelectedPropertyIds.includes(prop.id);
                  const regYear = getRegYear(prop.id);
                  const revenue = propertyRevenues[prop.id] || 0;

                  const toggleTempProp = () => {
                    setTempSelectedPropertyIds(prev =>
                      prev.includes(prop.id) ? prev.filter(id => id !== prop.id) : [...prev, prop.id]
                    );
                  };

                  return (
                    <tr
                      key={prop.id}
                      onClick={toggleTempProp}
                      className={`h-11 cursor-pointer hover:bg-slate-100 transition-colors ${isChecked ? 'bg-blue-50/20' : (idx % 2 === 0 ? 'bg-white' : 'bg-[#f5f3f4]/15')}`}
                    >
                      <td className="text-center py-2 px-2.5 border-r border-[#ccc9ca]">
                        <div className="flex justify-center">
                          <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isChecked ? 'bg-[#003580] border-[#003580]' : 'border-gray-400'}`}>
                            {isChecked && <Check className="w-2.5 h-2.5 text-white" />}
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-2.5 font-mono text-[11px] text-gray-600 border-r border-[#ccc9ca]">{prop.id}</td>
                      <td className="py-2 px-2.5 font-bold text-gray-900 border-r border-[#ccc9ca] break-words">{prop.name}</td>
                      <td className="py-2 px-2.5 text-center font-mono text-gray-800 border-r border-[#ccc9ca]">{regYear}年</td>
                      <td className="py-2 px-2.5 text-right pr-4 font-mono font-bold text-blue-900">{formatCurrency(revenue)}</td>
                    </tr>
                  );
                })}
                {sortedProperties.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-10 text-gray-500">該当物件なし</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Drawer Footer */}
        <div className="px-5 py-4 border-t border-[#ccc9ca] flex gap-3 bg-[#f5f3f4] flex-shrink-0">
          <button
            type="button"
            onClick={() => setIsPropDrawerOpen(false)}
            className="flex-1 px-4 py-3 bg-white border border-[#ccc9ca] text-gray-900 rounded-xl font-bold hover:bg-slate-100 text-xs shadow-sm transition-all"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedPropertyIds(tempSelectedPropertyIds);
              setIsPropDrawerOpen(false);
            }}
            className="flex-[2] px-4 py-3 bg-[#003580] hover:bg-brand-700 text-white rounded-xl font-bold text-xs shadow-md transition-all text-center"
          >
            適用する ({tempSelectedPropertyIds.length}棟)
          </button>
        </div>
      </div>

      {/* Backdrop for sliding drawer (dims right content container selectively on desktop, covers menu on mobile) */}
      {isPropDrawerOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-50 md:z-20 no-print"
          onClick={() => setIsPropDrawerOpen(false)}
        />
      )}
    </div>
  );
};

export default FinancePage;
