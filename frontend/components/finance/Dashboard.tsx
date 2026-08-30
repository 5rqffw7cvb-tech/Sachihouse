import React, { useMemo } from 'react';
import { FinancialReport, AccountType } from '../../types/finance';
import { ACCOUNT_TYPE_MAP } from '../../utils/accountingUtils';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import {
  RefreshCw, ChevronLeft, ChevronRight, ChevronsUpDown, Info,
  ArrowUpRight, ArrowDownLeft, Wallet, Percent, Receipt,
} from 'lucide-react';

interface DashboardProps {
  report: FinancialReport;
  lastUpdated?: Date | null;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  onYearChange?: (year: number) => void;
}

const YEAR_LABELS: Record<number, string> = {
  2026: '令和8年', 2025: '令和7年', 2024: '令和6年', 2023: '令和5年',
  2022: '令和4年', 2021: '令和3年', 2020: '令和2年', 2019: '令和元年',
  2018: '平成30年', 2017: '平成29年',
};

const Dashboard: React.FC<DashboardProps> = ({ report, onRefresh, isRefreshing = false, onYearChange }) => {
  const currentYear = new Date().getFullYear();
  const fmt = (val: number) =>
    new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(val);
  const yearLabel = (year: number) => YEAR_LABELS[year] || `${year}年`;

  const totalExpense = report.totalExpense + report.totalCostOfSales;
  const isNetPositive = report.netIncome >= 0;
  const profitMargin = report.totalRevenue > 0 ? (report.netIncome / report.totalRevenue) * 100 : 0;

  // Real expense breakdown from P/L items (経費 + 売上原価), top categories.
  const expenseBreakdown = useMemo(() => {
    const items = report.plItems
      .filter(i => i.type === AccountType.Expense || i.type === AccountType.CostOfSales)
      .map(i => ({ name: i.name, amount: Math.abs(i.amount) }))
      .filter(i => i.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    const top = items.slice(0, 6);
    const max = top.length ? top[0].amount : 1;
    return { top, max, total: items.reduce((s, i) => s + i.amount, 0) };
  }, [report.plItems]);

  // Real entry counts by account type.
  const counts = useMemo(() => {
    let revenue = 0, expense = 0;
    report.journalEntries.forEach(e => {
      const t = ACCOUNT_TYPE_MAP[e.creditAccount];
      if (t === AccountType.Revenue) revenue++;
      else expense++;
    });
    return { revenue, expense };
  }, [report.journalEntries]);

  const monthlyBars = report.monthlyRevenue.map((r, i) => ({
    name: r.month.split('/')[1] + '月',
    売上: r.amount,
    経費: (report.monthlyExpense[i]?.amount || 0) + (report.monthlyCostOfSales[i]?.amount || 0),
  }));
  
  // Build cumulative profit array
  const cumulativeProfitArray = report.monthlyProfit.reduce<number[]>((acc, p) => {
    const prevTotal = acc.length ? acc[acc.length - 1] : 0;
    acc.push(prevTotal + p.amount);
    return acc;
  }, []);
  
  // Build profit line data with revenue, expenses, and cumulative profit
  const profitLine = report.monthlyRevenue.map((r, i) => {
    const expense = (report.monthlyExpense[i]?.amount || 0) + (report.monthlyCostOfSales[i]?.amount || 0);
    return {
      name: r.month.split('/')[1] + '月',
      売上: r.amount,
      経費: expense,
      累計純利益: cumulativeProfitArray[i] || 0,
    };
  });

  const kpis = [
    {
      label: '売上高', sub: `${counts.revenue} 件の収入`, value: report.totalRevenue,
      icon: ArrowUpRight, accent: 'emerald', valueClass: 'text-[#1b1c1d]',
    },
    {
      label: '経費合計', sub: `経費 ${fmt(report.totalExpense)}`, value: totalExpense,
      icon: ArrowDownLeft, accent: 'rose', valueClass: 'text-[#1b1c1d]',
    },
    {
      label: '営業利益', sub: `売上総利益 ${fmt(report.grossProfit)}`, value: report.operatingIncome,
      icon: Wallet, accent: 'blue', valueClass: report.operatingIncome >= 0 ? 'text-[#1b1c1d]' : 'text-rose-600',
    },
    {
      label: '純利益', sub: '青色控除前', value: report.netIncome,
      icon: Percent, accent: isNetPositive ? 'emerald' : 'rose',
      valueClass: isNetPositive ? 'text-emerald-600' : 'text-rose-600',
      badge: `利益率 ${profitMargin.toFixed(1)}%`,
    },
  ] as const;

  const accentMap: Record<string, { bar: string; chip: string; text: string }> = {
    emerald: { bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-600', text: 'text-emerald-600' },
    rose: { bar: 'bg-rose-500', chip: 'bg-rose-50 text-rose-600', text: 'text-rose-600' },
    blue: { bar: 'bg-blue-500', chip: 'bg-blue-50 text-blue-600', text: 'text-blue-600' },
    violet: { bar: 'bg-violet-500', chip: 'bg-violet-50 text-violet-600', text: 'text-violet-600' },
  };

  return (
    <div className="space-y-4 animate-fade-in w-full max-w-none pb-safe">

      {/* Header: year stepper + refresh */}
      <div className="bg-white rounded-2xl border border-[#e4e2e3] shadow-sm p-3 md:p-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 md:gap-2">
          <button
            onClick={() => onYearChange?.(report.targetYear - 1)}
            className="p-1.5 md:p-2 rounded-xl text-[#74777d] hover:text-blue-600 hover:bg-[#f5f3f4] active:scale-95 transition-all"
            aria-label="前年"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="relative group text-center cursor-pointer min-w-[120px]">
            <select
              value={report.targetYear}
              onChange={e => onYearChange?.(parseInt(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            >
              {Array.from({ length: 10 }, (_, i) => currentYear + 1 - i).map(y => (
                <option key={y} value={y}>{y}年 ({yearLabel(y)})</option>
              ))}
            </select>
            <div className="flex items-baseline justify-center gap-1.5 group-hover:text-blue-700 transition-colors">
              <span className="text-2xl md:text-3xl font-extrabold text-[#1b1c1d] font-mono tracking-tight">
                {report.targetYear}<span className="text-base ml-0.5">年</span>
              </span>
              <ChevronsUpDown className="w-4 h-4 text-gray-400" />
            </div>
            <span className="text-[10px] text-[#74777d] font-semibold">{yearLabel(report.targetYear)} 会計年度</span>
          </div>
          <button
            onClick={() => onYearChange?.(report.targetYear + 1)}
            className="p-1.5 md:p-2 rounded-xl text-[#74777d] hover:text-blue-600 hover:bg-[#f5f3f4] active:scale-95 transition-all"
            aria-label="翌年"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 text-xs font-bold text-[#44474c] bg-white border border-[#ccc9ca] hover:bg-[#f5f3f4] px-3 py-2 rounded-xl transition-all disabled:opacity-50 active:scale-95 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isRefreshing ? '更新中' : '更新'}</span>
          </button>
        )}
      </div>

      {report.journalEntries.length === 0 && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 flex items-center gap-3 shadow-sm">
          <Info className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="font-bold text-sm">データが見つかりません</p>
            <p className="text-xs mt-0.5">{report.targetYear}年度の仕訳データが存在しません。</p>
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const a = accentMap[k.accent];
          return (
            <div key={k.label} className="bg-white p-3.5 md:p-4 rounded-2xl border border-[#e4e2e3] shadow-sm relative overflow-hidden hover:shadow-md transition-all">
              <div className={`absolute top-0 left-0 right-0 h-1 ${a.bar}`} />
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[11px] font-bold text-[#74777d] uppercase tracking-wider">{k.label}</span>
                <div className={`p-1.5 rounded-xl ${a.chip}`}><k.icon className="w-4 h-4" /></div>
              </div>
              <p className={`text-xl md:text-[26px] font-extrabold tracking-tight font-mono leading-none ${k.valueClass}`}>
                {fmt(k.value)}
              </p>
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                {'badge' in k && k.badge && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${a.chip}`}>{k.badge}</span>
                )}
                <span className="text-[10px] text-[#74777d] font-medium truncate">{k.sub}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-white p-4 md:p-5 rounded-2xl border border-[#e4e2e3] shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-[#1b1c1d] flex items-center gap-2">
              <span className="w-1 h-4 bg-blue-500 rounded-full" />月次推移
            </h3>
            <div className="flex items-center gap-3 text-[10px] font-bold">
              <span className="flex items-center gap-1 text-[#44474c]"><span className="w-2 h-2 rounded-full bg-[#2563EB]" />売上</span>
              <span className="flex items-center gap-1 text-[#44474c]"><span className="w-2 h-2 rounded-full bg-[#f43f5e]" />経費</span>
            </div>
          </div>
          <div className="h-56 md:h-60 w-full font-sans -ml-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyBars} margin={{ left: 5, right: 5, top: 6, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e2e3" />
                <XAxis dataKey="name" fontSize={9} tickLine={false} axisLine={false} stroke="#74777d" />
                <YAxis fontSize={9} tickFormatter={(v) => `¥${v / 1000}k`} tickLine={false} axisLine={false} width={38} stroke="#74777d" />
                <Tooltip
                  cursor={{ fill: '#f5f3f4', opacity: 0.5 }}
                  formatter={(value: number, name) => [fmt(value), name]}
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e4e2e3', fontSize: '11px' }}
                />
                <Bar dataKey="売上" fill="#2563EB" radius={[4, 4, 0, 0]} maxBarSize={16} />
                <Bar dataKey="経費" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-4 md:p-5 rounded-2xl border border-[#e4e2e3] shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-[#1b1c1d] flex items-center gap-2">
              <span className="w-1 h-4 bg-emerald-500 rounded-full" />純利益の推移（累計）
            </h3>
            <div className="flex items-center gap-3 text-[10px] font-bold flex-wrap justify-end">
              <span className="flex items-center gap-1 text-[#44474c]"><span className="w-2 h-2 rounded-full bg-[#2563EB]" />売上</span>
              <span className="flex items-center gap-1 text-[#44474c]"><span className="w-2 h-2 rounded-full bg-[#f43f5e]" />経費</span>
              <span className="flex items-center gap-1 text-[#44474c]"><span className="w-2 h-2 rounded-full bg-[#10b981]" />累計純利益</span>
            </div>
          </div>
          <div className="h-56 md:h-60 w-full font-sans -ml-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={profitLine} margin={{ left: 5, right: 5, top: 6, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e2e3" />
                <XAxis dataKey="name" fontSize={9} tickLine={false} axisLine={false} stroke="#74777d" />
                <YAxis fontSize={9} tickFormatter={(v) => `¥${v / 1000}k`} tickLine={false} axisLine={false} width={38} stroke="#74777d" />
                <Tooltip
                  formatter={(value: number, name) => {
                    const labels: Record<string, string> = { '売上': '売上', '経費': '経費', '累計純利益': '累計純利益' };
                    return [fmt(value), labels[name as string] || name];
                  }}
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e4e2e3', fontSize: '11px' }}
                />
                <Area type="monotone" dataKey="売上" stroke="#2563EB" strokeWidth={2} fill="url(#revenueFill)"
                  dot={false} activeDot={{ r: 4 }} />
                <Area type="monotone" dataKey="経費" stroke="#f43f5e" strokeWidth={2} fill="url(#expenseFill)"
                  dot={false} activeDot={{ r: 4 }} />
                <Area type="monotone" dataKey="累計純利益" stroke="#10b981" strokeWidth={2.5} fill="url(#profitFill)"
                  dot={{ r: 2.5, fill: '#10b981', strokeWidth: 0 }} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Expense breakdown (real data) */}
      <div className="bg-white p-4 md:p-5 rounded-2xl border border-[#e4e2e3] shadow-sm">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#f0eeef]">
          <h3 className="text-xs font-bold text-[#1b1c1d] flex items-center gap-2">
            <Receipt className="w-4 h-4 text-rose-500" />費用内訳 (上位)
          </h3>
          <span className="text-[10px] font-bold text-[#74777d]">合計 {fmt(expenseBreakdown.total)}</span>
        </div>
        {expenseBreakdown.top.length === 0 ? (
          <p className="text-xs text-[#74777d] py-6 text-center">費用データがありません。</p>
        ) : (
          <div className="space-y-2.5">
            {expenseBreakdown.top.map((item) => {
              const pct = expenseBreakdown.total > 0 ? (item.amount / expenseBreakdown.total) * 100 : 0;
              const barW = (item.amount / expenseBreakdown.max) * 100;
              return (
                <div key={item.name} className="flex items-center gap-3">
                  <div className="w-24 md:w-32 shrink-0 text-[11px] font-bold text-[#44474c] truncate">{item.name}</div>
                  <div className="flex-1 h-5 bg-[#f5f3f4] rounded-lg overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-rose-400 to-rose-500 rounded-lg flex items-center justify-end px-2 transition-all"
                      style={{ width: `${Math.max(barW, 6)}%` }}
                    >
                      <span className="text-[9px] font-bold text-white/90">{pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="w-20 md:w-28 shrink-0 text-right text-[11px] font-mono font-bold text-[#1b1c1d]">{fmt(item.amount)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
