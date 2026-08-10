import React, { useState, useEffect, useCallback, Suspense, lazy, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, LayoutDashboard, FileSpreadsheet, Scale, CalendarDays, BookOpen,
  Check, RefreshCw, Printer, Menu, X, ChevronsUpDown, Building, Search, ChevronRight,
  Clock, Mail,
} from 'lucide-react';
import { getCurrentUser } from '../services/auth';
import { financeApi, transactionsToCsvRows, FINANCE_HEADERS, FinancialProperty } from '../services/finance';
import { processFinancials, ACCOUNT_TYPE_MAP } from '../utils/accountingUtils';
import { FinancialReport, CsvRow, AccountType, FinancialTransaction } from '../types/finance';
import { AdminShell } from '../components/AdminShell';
import { Tabs } from '../components/ui';

const Dashboard    = lazy(() => import('../components/finance/Dashboard'));
const PLStatement  = lazy(() => import('../components/finance/PLStatement'));
const BSStatement  = lazy(() => import('../components/finance/BSStatement'));
const MonthlyReport = lazy(() => import('../components/finance/MonthlyReport'));
const Journal      = lazy(() => import('../components/finance/Journal'));
const PendingJournal = lazy(() => import('../components/finance/PendingJournal'));
const IngestRules  = lazy(() => import('../components/finance/IngestRules'));

type Tab = 'dashboard' | 'pl' | 'bs' | 'monthly' | 'journal' | 'pending' | 'ingest';

const NAV_ITEMS: { id: Tab; label: string; icon: React.ElementType; adminOnly?: boolean }[] = [
  { id: 'dashboard', label: 'Dash Board',       icon: LayoutDashboard },
  { id: 'pl',        label: '損益計算書',       icon: FileSpreadsheet  },
  { id: 'bs',        label: '貸借対照表',       icon: Scale            },
  { id: 'monthly',   label: '月次推移',         icon: CalendarDays     },
  { id: 'journal',   label: '仕訳帳',           icon: BookOpen         },
  { id: 'pending',   label: '仕訳帳（未承認）', icon: Clock            },
  { id: 'ingest',    label: 'メール連携ルール', icon: Mail, adminOnly: true },
];

const SuspenseFallback = () => (
  <div className="flex items-center justify-center py-20 text-ink-muted">
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

const TAB_IDS: Tab[] = ['dashboard', 'pl', 'bs', 'monthly', 'journal', 'pending', 'ingest'];
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
      if (props.length > 0) setSelectedPropertyIds(props.map(p => p.id));
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
  // Access is enforced by AdminShell's access="finance" below, which applies the
  // same rule (admins, or hosts at level 4) and renders the refusal screen.

  const selectedLabel = selectedPropertyIds.length === 0
    ? 'プロパティを選択'
    : selectedPropertyIds.length === 1
      ? (allProperties.find(p => p.id === selectedPropertyIds[0])?.name || selectedPropertyIds[0])
      : `${selectedPropertyIds.length} プロパティ選択中`;

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2 no-print">
      {/* Property Selector Trigger */}
      {allProperties.length > 0 && (
        <button
          onClick={() => {
            setTempSelectedPropertyIds([...selectedPropertyIds]);
            setModalSearchTerm('');
            setIsPropDrawerOpen(true);
          }}
          className="flex items-center gap-2 px-3 py-1.5 bg-surface border border-line-strong rounded-control text-xs font-semibold text-ink-soft hover:bg-subtle transition-all shadow-sm"
        >
          <Building className="w-3.5 h-3.5 text-blue-600" />
          <span className="max-w-[140px] truncate">{selectedLabel}</span>
          <ChevronRight className="w-3.5 h-3.5 text-ink-muted" />
        </button>
      )}

      {/* Year Selector */}
      <div className="relative">
        <select
          value={selectedYear}
          onChange={e => setSelectedYear(parseInt(e.target.value))}
          className="bg-surface border border-line-strong rounded-control px-2.5 py-1.5 text-xs font-semibold text-ink-soft appearance-none pr-7 cursor-pointer shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {Array.from({ length: 10 }, (_, i) => currentYear + 1 - i).map(y => (
            <option key={y} value={y}>{y}年</option>
          ))}
        </select>
        <ChevronsUpDown className="w-3 h-3 text-ink-muted absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>

      {/* Refresh */}
      <button
        onClick={handleRefresh}
        disabled={isRefreshing}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-line-strong rounded-control text-xs font-semibold text-ink-soft hover:bg-subtle disabled:opacity-50 transition-all shadow-sm"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
        <span>更新</span>
      </button>

      {/* Print */}
      {report && (
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-line-strong rounded-control text-xs font-semibold text-ink-soft hover:bg-subtle transition-all shadow-sm"
        >
          <Printer className="w-3.5 h-3.5 text-ink-soft" />
          <span>印刷</span>
        </button>
      )}
    </div>
  );

  return (
    <AdminShell
      access="finance"
      activeKey="finance"
      title="財務管理 (Finance)"
      subtitle="青色申告・損益計算書 (P&L)・貸借対照表 (B/S)"
      actions={headerActions}
    >
      <Tabs<Tab>
        className="no-print"
        active={activeTab}
        onChange={setActiveTab}
        items={NAV_ITEMS
          .filter(item => !item.adminOnly || authUser.role === 'ADMIN')
          .map(item => ({ id: item.id, label: item.label, icon: item.icon }))}
      />

      {/* Print Header */}
      <div className="hidden print:block text-center py-4 mb-4 font-mincho border-b border-line-strong">
        <p className="text-sm font-medium text-ink-soft">{selectedLabel} — {selectedYear}年</p>
      </div>

      {/* Tab Content */}
      <div className="w-full">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-ink-muted">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
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
            {activeTab === 'ingest' && authUser.role === 'ADMIN' && (
              <IngestRules allProperties={allProperties} />
            )}
            {!report && activeTab !== 'journal' && activeTab !== 'pending' && activeTab !== 'ingest' && (
              <div className="flex flex-col items-center justify-center py-20 text-ink-muted gap-3 bg-surface rounded-control border border-line p-8">
                <BookOpen className="w-10 h-10 opacity-30 text-ink-muted" />
                <p className="text-sm font-medium text-ink-soft">データがありません。プロパティを選択してください。</p>
              </div>
            )}
          </Suspense>
        )}
      </div>

      {/* Property Selector Drawer Modal */}
      {isPropDrawerOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 no-print">
          <div className="bg-surface rounded-card shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden border border-line">
            {/* Header */}
            <div className="px-6 py-4 bg-subtle border-b border-line flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Building className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-ink text-sm">プロパティ詳細・売上順選択</h3>
              </div>
              <button
                onClick={() => setIsPropDrawerOpen(false)}
                className="text-ink-muted hover:text-ink-soft p-1.5 hover:bg-subtle rounded-control transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 flex-1 overflow-y-auto space-y-4">
              <div className="flex flex-col gap-3 bg-subtle p-4 rounded-control border border-line">
                <div className="relative w-full">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted w-4 h-4" />
                  <input
                    type="text"
                    placeholder="物件名・IDで検索..."
                    value={modalSearchTerm}
                    onChange={e => setModalSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-surface border border-line-strong rounded-control text-xs outline-none focus:ring-1 focus:ring-blue-500 text-ink font-semibold"
                  />
                </div>
                <div className="flex items-center justify-between text-xs font-bold text-ink-soft">
                  <span>選択中: <b className="text-blue-600 text-sm font-mono">{tempSelectedPropertyIds.length}</b> / {allProperties.length} 棟</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setTempSelectedPropertyIds(allProperties.map(p => p.id))}
                      className="px-3 py-1.5 bg-surface border border-line-strong hover:bg-subtle rounded-control text-[10px] font-bold shadow-sm transition-colors text-ink-soft"
                    >
                      全て選択
                    </button>
                    <button
                      type="button"
                      onClick={() => setTempSelectedPropertyIds([])}
                      className="px-3 py-1.5 bg-surface border border-line-strong hover:bg-subtle rounded-control text-[10px] font-bold shadow-sm transition-colors text-ink-soft"
                    >
                      全解除
                    </button>
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-control border border-line shadow-sm bg-surface">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-subtle border-b border-line text-left text-ink-soft h-10">
                      <th className="py-2.5 px-2.5 font-extrabold text-center w-12 border-r border-line">選択</th>
                      <th className="py-2.5 px-2.5 font-extrabold border-r border-line">物件ID</th>
                      <th className="py-2.5 px-2.5 font-extrabold border-r border-line">物件名</th>
                      <th className="py-2.5 px-2.5 font-extrabold text-center border-r border-line w-20">登録年</th>
                      <th className="py-2.5 px-2.5 font-extrabold text-right pr-4 w-32">総売上高</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-ink font-medium">
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
                          className={`h-11 cursor-pointer hover:bg-blue-50/50 transition-colors ${isChecked ? 'bg-blue-50/30' : (idx % 2 === 0 ? 'bg-surface' : 'bg-subtle/30')}`}
                        >
                          <td className="text-center py-2 px-2.5 border-r border-line">
                            <div className="flex justify-center">
                              <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isChecked ? 'bg-blue-600 border-blue-600' : 'border-line-strong'}`}>
                                {isChecked && <Check className="w-2.5 h-2.5 text-white" />}
                              </div>
                            </div>
                          </td>
                          <td className="py-2 px-2.5 font-mono text-[11px] text-ink-muted border-r border-line">{prop.id}</td>
                          <td className="py-2 px-2.5 font-bold text-ink border-r border-line break-words">{prop.name}</td>
                          <td className="py-2 px-2.5 text-center font-mono text-ink-soft border-r border-line">{regYear}年</td>
                          <td className="py-2 px-2.5 text-right pr-4 font-mono font-bold text-blue-700">{formatCurrency(revenue)}</td>
                        </tr>
                      );
                    })}
                    {sortedProperties.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-10 text-ink-muted">該当物件なし</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-line flex justify-end gap-3 bg-subtle">
              <button
                type="button"
                onClick={() => setIsPropDrawerOpen(false)}
                className="px-4 py-2 bg-surface border border-line-strong text-ink-soft rounded-control font-bold hover:bg-subtle text-xs shadow-sm transition-all"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedPropertyIds(tempSelectedPropertyIds);
                  setIsPropDrawerOpen(false);
                }}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-control font-bold text-xs shadow-sm transition-all text-center"
              >
                適用する ({tempSelectedPropertyIds.length}棟)
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
};

export default FinancePage;
