import React, { useState } from 'react';
import { FinancialReport } from '../../types/finance';
import { ChevronDown, ChevronRight, AlertTriangle, Info } from 'lucide-react';

interface BSStatementProps {
  report: FinancialReport;
}

const formatCurrency = (val: number) => {
  const absVal = Math.abs(val);
  const str = new Intl.NumberFormat('ja-JP').format(absVal);
  return val < 0 ? `△ ${str}` : str;
};

const Td = ({ children, className = "", align = "left", bold = false }: { children?: React.ReactNode, className?: string, align?: "left" | "right" | "center", bold?: boolean }) => (
  <td className={`border border-[#ccc9ca] px-3.5 py-1.5 text-[13px] ${bold ? 'font-bold text-[#1b1c1d]' : 'text-[#44474c]'} ${
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  } ${className}`}>
    {children}
  </td>
);

const MobileItem: React.FC<{ label: string; amount: number; isHighlight?: boolean }> = ({ label, amount, isHighlight }) => (
  <div className={`flex justify-between items-center py-2 border-b border-[#f5f3f4] last:border-0 ${isHighlight ? 'bg-blue-50/50 px-2 -mx-2' : ''}`}>
    <span className={`text-xs ${isHighlight ? 'text-blue-800 font-bold' : 'text-[#44474c]'}`}>{label}</span>
    <span className={`text-[12px] font-mono ${isHighlight ? 'text-blue-900 font-bold' : (amount < 0 ? 'text-rose-600' : 'text-[#1b1c1d]')}`}>{formatCurrency(amount)}</span>
  </div>
);

const MobileSection = ({ title, items, total, colorClass, borderClass }: { title: string, items: { name: string; amount: number }[], total: number, colorClass: string, borderClass: string }) => {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div className={`bg-white rounded-2xl border ${borderClass} overflow-hidden mb-3 shadow-sm`}>
      <button onClick={() => setIsOpen(!isOpen)} className={`w-full flex items-center justify-between p-3 ${colorClass}`}>
        <span className="text-[13px] font-bold">{title}</span>
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-xs">{formatCurrency(total)}</span>
          {isOpen ? <ChevronDown className="w-3.5 h-3.5 opacity-75" /> : <ChevronRight className="w-3.5 h-3.5 opacity-75" />}
        </div>
      </button>
      {isOpen && (
        <div className="p-3 pt-0">
          <div className="pt-1.5 space-y-0.5">
            {items.length > 0 ? items.map(item => <MobileItem key={item.name} label={item.name} amount={item.amount} />) : <p className="text-xs text-[#74777d] py-1.5 text-center">該当なし</p>}
          </div>
        </div>
      )}
    </div>
  );
};

const BSStatement: React.FC<BSStatementProps> = ({ report }) => {
  const FIXED_ASSET_KEYWORDS = ['建物', '車両', '備品', '土地', '構築物', 'ソフトウェア', '敷金', '保証金', '開業費'];
  const FIXED_LIAB_KEYWORDS = ['長期'];

  const currentAssets = report.bsAssets.filter(i => !FIXED_ASSET_KEYWORDS.some(k => i.name.includes(k)));
  const fixedAssets = report.bsAssets.filter(i => FIXED_ASSET_KEYWORDS.some(k => i.name.includes(k)));
  const currentLiabilities = report.bsLiabilities.filter(i => !FIXED_LIAB_KEYWORDS.some(k => i.name.includes(k)));
  const fixedLiabilities = report.bsLiabilities.filter(i => FIXED_LIAB_KEYWORDS.some(k => i.name.includes(k)));

  const totalAssets = report.bsAssets.reduce((acc, item) => acc + item.amount, 0);
  const totalLiabilities = report.bsLiabilities.reduce((acc, item) => acc + item.amount, 0);
  const equityBase = report.equityBaseTotal;
  const retainedEarnings = report.previousRetainedEarnings;
  const currentIncome = report.netIncome;
  const totalEquity = equityBase + retainedEarnings + currentIncome;
  const totalLiabAndEquity = totalLiabilities + totalEquity;
  const imbalance = totalAssets - totalLiabAndEquity;
  const isImbalanced = Math.abs(imbalance) > 1;

  const leftRows: { label: string; amount?: number; isHeader?: boolean; isBold?: boolean }[] = [];
  leftRows.push({ label: "【流動資産】", isHeader: true });
  currentAssets.forEach(item => leftRows.push({ label: item.name, amount: item.amount }));
  leftRows.push({ label: "【固定資産】", isHeader: true });
  fixedAssets.forEach(item => leftRows.push({ label: item.name, amount: item.amount }));

  const rightRows: { label: string; amount?: number; isHeader?: boolean; isBold?: boolean; isHighlight?: boolean }[] = [];
  rightRows.push({ label: "【負債】", isHeader: true });
  [...currentLiabilities, ...fixedLiabilities].forEach(item => rightRows.push({ label: item.name, amount: item.amount }));
  rightRows.push({ label: "負債合計", amount: totalLiabilities, isBold: true });
  rightRows.push({ label: "", isHeader: true });
  rightRows.push({ label: "【資本】", isHeader: true });
  report.bsEquity.forEach(item => { rightRows.push({ label: item.name, amount: item.amount }); });
  rightRows.push({ label: "繰越利益剰余金 (前年度繰越)", amount: retainedEarnings, isHighlight: true });
  rightRows.push({ label: "本年分控除前所得金額", amount: currentIncome, isHighlight: true });
  rightRows.push({ label: "資本合計", amount: totalEquity, isBold: true });

  const maxRows = Math.max(leftRows.length, rightRows.length);
  const displayYear = report.targetYear;

  return (
    <div className="w-full max-w-none">
      {isImbalanced && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 shadow-sm animate-fade-in">
          <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="text-[13px] font-bold text-rose-800">貸借対照表が一致していません</h4>
            <p className="text-xs text-rose-700 mt-0.5">差額: <b className="font-mono">{formatCurrency(imbalance)}</b></p>
          </div>
        </div>
      )}
      {report.validationErrors.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <h4 className="text-[13px] font-bold text-amber-800 flex items-center gap-2 mb-1.5">
            <Info className="w-4 h-4" /> データ整合性エラー ({report.validationErrors.length}件)
          </h4>
          <ul className="list-disc list-inside text-xs text-amber-700 max-h-32 overflow-y-auto space-y-0.5 font-mono">
            {report.validationErrors.map((err, i) => <li key={i}>{err}</li>)}
          </ul>
        </div>
      )}

      {/* Mobile Accordion Drawer layout */}
      <div className="md:hidden print:hidden pb-8">
        <h3 className="text-center text-[#1b1c1d] mb-3 text-[14px] font-bold">
          貸借対照表 <br/>
          <span className="text-[11px] font-normal text-[#74777d]">令和{displayYear - 2018}年12月31日 現在</span>
        </h3>
        
        <MobileSection
          title="資産の部"
          items={[...currentAssets, ...fixedAssets]}
          total={totalAssets}
          colorClass="bg-emerald-50 text-emerald-800"
          borderClass="border-emerald-200"
        />
        
        <MobileSection
          title="負債の部"
          items={[...currentLiabilities, ...fixedLiabilities]}
          total={totalLiabilities}
          colorClass="bg-rose-50 text-rose-800"
          borderClass="border-rose-200"
        />
        
        <div className="bg-white rounded-2xl border border-blue-200 overflow-hidden mb-3 shadow-sm">
          <div className="w-full flex items-center justify-between p-3 bg-[#eff6ff] text-blue-800 font-bold">
            <span className="text-[13px]">資本の部</span>
            <span className="font-mono font-bold text-xs">{formatCurrency(totalEquity)}</span>
          </div>
          <div className="p-3 pt-1.5 space-y-0.5">
            {report.bsEquity.map(item => <MobileItem key={item.name} label={item.name} amount={item.amount} />)}
            <MobileItem label="繰越利益剰余金" amount={retainedEarnings} isHighlight />
            <MobileItem label="本年分控除前所得" amount={currentIncome} isHighlight />
          </div>
        </div>
        <div className={`mt-3 p-3 rounded-xl flex justify-between items-center text-xs font-bold border ${isImbalanced ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-slate-100 border-[#ccc9ca] text-[#1b1c1d]'}`}>
          <span>負債・資本 合計</span>
          <span className="font-mono text-base font-extrabold">{formatCurrency(totalLiabAndEquity)}</span>
        </div>
      </div>

      {/* Desktop & Print Layout */}
      <div className="hidden md:block print:block bg-white p-6 print-area font-mincho text-[#1b1c1d] leading-normal border border-[#ccc9ca] shadow-sm rounded-2xl">
        <div className="text-center mb-4">
          <h2 className="text-xl border-b-2 border-[#1b1c1d] inline-block pb-0.5 px-10 mb-1.5 font-bold tracking-widest">貸借対照表</h2>
          <p className="text-xs">令和{displayYear - 2018}年12月31日 現在</p>
        </div>
        <div className="flex justify-end mb-0.5 text-[9px] text-[#74777d]">(単位：円)</div>
        <table className="w-full border-collapse border border-[#ccc9ca]">
          <thead>
            <tr className="bg-[#f5f3f4] text-slate-800">
              <th colSpan={2} className="border border-[#ccc9ca] py-1.5 text-center font-bold text-[13px] w-1/2">資産の部</th>
              <th colSpan={2} className="border border-[#ccc9ca] py-1.5 text-center font-bold text-[13px] w-1/2">負債・資本の部</th>
            </tr>
            <tr className="bg-white">
              <th className="border border-[#ccc9ca] py-1 px-3.5 font-bold text-xs w-[35%] text-left">科目</th>
              <th className="border border-[#ccc9ca] py-1 px-3.5 font-bold text-xs w-[15%] text-right">金額</th>
              <th className="border border-[#ccc9ca] py-1 px-3.5 font-bold text-xs w-[35%] text-left">科目</th>
              <th className="border border-[#ccc9ca] py-1 px-3.5 font-bold text-xs w-[15%] text-right">金額</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxRows }).map((_, i) => {
              const left = leftRows[i];
              const right = rightRows[i];
              return (
                <tr key={i} className="h-7.5 hover:bg-[#f5f3f4]/20 transition-colors">
                  <Td bold={left?.isBold || left?.isHeader} className={left?.isHeader ? "bg-[#f5f3f4]/10" : "pl-6"}>{left?.label || ""}</Td>
                  <Td align="right" className="font-mono text-[#44474c]">{left?.amount !== undefined ? formatCurrency(left.amount) : ""}</Td>
                  <Td bold={right?.isBold || right?.isHeader} className={`${right?.isHeader ? "bg-[#f5f3f4]/10" : "pl-6"} ${right?.isHighlight ? 'bg-blue-50/20 text-blue-900 font-semibold' : ''}`}>{right?.label || ""}</Td>
                  <Td align="right" className={`font-mono ${right?.isHighlight ? 'bg-blue-50/20 text-blue-900 font-bold' : ''}`}>{right?.amount !== undefined ? formatCurrency(right.amount) : ""}</Td>
                </tr>
              );
            })}
            <tr className={`h-9 ${isImbalanced ? 'bg-rose-50 text-rose-900 font-bold' : 'bg-[#f5f3f4] font-bold'}`}>
              <Td bold align="left" className="text-[13px] text-[#1b1c1d]">資産の部合計</Td>
              <Td bold align="right" className="font-mono text-[13px] text-[#1b1c1d]">{formatCurrency(totalAssets)}</Td>
              <Td bold align="left" className="text-[13px] text-[#1b1c1d]">負債・資本合計{isImbalanced && <span className="text-rose-600 text-xs ml-2 font-semibold">(差額: {formatCurrency(imbalance)})</span>}</Td>
              <Td bold align="right" className={`font-mono text-[13px] ${isImbalanced ? 'text-rose-600' : 'text-[#1b1c1d]'}`}>{formatCurrency(totalLiabAndEquity)}</Td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default BSStatement;
