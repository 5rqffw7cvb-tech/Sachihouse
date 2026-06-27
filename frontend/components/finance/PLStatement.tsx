import React from 'react';
import { FinancialReport, AccountType } from '../../types/finance';

interface PLStatementProps {
  report: FinancialReport;
}

const formatCurrency = (val: number) => {
  const absVal = Math.abs(val);
  const str = new Intl.NumberFormat('ja-JP').format(absVal);
  return val < 0 ? `△ ${str}` : str;
};

const Td = ({
  children,
  className = "",
  align = "left",
  bold = false,
  colSpan = 1
}: {
  children?: React.ReactNode,
  className?: string,
  align?: "left" | "right" | "center",
  bold?: boolean,
  colSpan?: number
}) => (
  <td
    colSpan={colSpan}
    className={`border border-[#ccc9ca] px-3.5 py-1.5 text-[13px] ${bold ? 'font-bold text-[#1b1c1d]' : 'text-[#44474c]'} ${
      align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
    } ${className}`}
  >
    {children}
  </td>
);

interface MobileRowProps {
  label: string;
  amount: number;
  isTotal?: boolean;
  isSubTotal?: boolean;
}

const MobileRow: React.FC<MobileRowProps> = ({ label, amount, isTotal = false, isSubTotal = false }) => (
  <div className={`flex justify-between items-center py-2 ${isTotal ? 'border-t-2 border-[#1b1c1d] mt-1 text-[#1b1c1d] font-bold' : (isSubTotal ? 'border-t border-[#ccc9ca] text-[#44474c] bg-[#f5f3f4]/50 px-2 -mx-2' : 'text-[#44474c] border-b border-[#f5f3f4] last:border-0')}`}>
    <span className={isTotal ? 'text-[13px]' : 'text-xs'}>{label}</span>
    <span className={`font-mono ${isTotal ? 'text-sm font-bold' : 'text-[12px]'}`}>{formatCurrency(amount)}</span>
  </div>
);

const PLStatement: React.FC<PLStatementProps> = ({ report }) => {
  const revenues = report.plItems.filter(i => i.type === AccountType.Revenue);
  const costOfSales = report.plItems.filter(i => i.type === AccountType.CostOfSales);
  const expenses = report.plItems.filter(i => i.type === AccountType.Expense);
  const displayYear = report.targetYear;

  return (
    <div className="w-full max-w-none">
      {/* Mobile-only Pl statement */}
      <div className="md:hidden print:hidden space-y-3 pb-8">
        <div className="bg-white p-3 rounded-2xl border border-[#ccc9ca] shadow-sm">
          <h3 className="text-center text-[#1b1c1d] border-b border-[#ccc9ca] pb-2 mb-3 text-[14px] font-bold">
            損益計算書 (P/L) <br/>
            <span className="text-[11px] font-normal text-[#74777d]">{displayYear}年1月1日 〜 12月31日</span>
          </h3>
          <div className="mb-4">
            <h4 className="text-[11px] text-blue-900 bg-blue-50/70 p-1.5 rounded-xl font-bold flex items-center gap-1.5 border border-blue-100/50">売上</h4>
            <div className="space-y-0.5">
              {revenues.length > 0 ? revenues.map((item) => (
                <MobileRow key={item.name} label={item.name} amount={item.amount} />
              )) : <MobileRow label="売上（収入）金額" amount={0} />}
              <MobileRow label="売上高 合計" amount={report.totalRevenue} isTotal />
            </div>
          </div>
          <div className="mb-4">
            <h4 className="text-[11px] text-gray-800 bg-[#f5f3f4] p-1.5 rounded-xl font-bold border border-[#ccc9ca]">売上原価</h4>
            <div className="space-y-0.5">
              {costOfSales.map((item) => (
                <MobileRow key={item.name} label={item.name} amount={item.amount} />
              ))}
              <MobileRow label="売上原価 合計" amount={report.totalCostOfSales} isTotal />
            </div>
          </div>
          <div className="bg-[#eff6ff] border border-[#bfdbfe] text-blue-900 p-2.5 rounded-xl shadow-sm mb-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-blue-800">売上総利益</span>
              <span className="text-base font-mono font-extrabold">{formatCurrency(report.grossProfit)}</span>
            </div>
          </div>
          <div className="mb-4">
            <h4 className="text-[11px] text-rose-900 bg-rose-50/70 p-1.5 rounded-xl font-bold border border-rose-100/50">経費</h4>
            <div className="space-y-0.5">
              {expenses.map((item) => (
                <MobileRow key={item.name} label={item.name} amount={item.amount} />
              ))}
              <MobileRow label="経費 合計" amount={report.totalExpense} isTotal />
            </div>
          </div>
          <div className="border-t border-dashed border-[#ccc9ca] pt-3 mb-2">
            <MobileRow label="営業利益" amount={report.operatingIncome} isTotal />
          </div>
          <div className={`p-2.5 rounded-xl shadow-sm border mt-3 ${report.netIncome >= 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-950' : 'bg-rose-50 border-rose-200 text-rose-950'}`}>
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold">青色申告特別控除前所得</span>
              <span className="text-base font-mono font-extrabold">{formatCurrency(report.netIncome)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop & Print Layout */}
      <div className="hidden md:block print:block bg-white p-6 print-area font-mincho text-[#1b1c1d] leading-normal border border-[#ccc9ca] shadow-sm rounded-2xl">
        <div className="text-center mb-4">
          <h2 className="text-xl border-b-2 border-[#1b1c1d] inline-block pb-0.5 px-10 mb-1.5 font-bold tracking-widest">損益計算書</h2>
          <p className="text-xs">（自 {displayYear}年1月1日 至 {displayYear}年12月31日）</p>
        </div>
        <div className="flex justify-end mb-0.5 text-[9px] text-[#74777d]">(単位：円)</div>
        <table className="w-full border-collapse border border-[#ccc9ca]">
          <thead>
            <tr className="bg-[#f5f3f4] h-8">
              <th className="border border-[#ccc9ca] py-1 font-bold text-center w-1/2 text-[13px]">科目</th>
              <th colSpan={2} className="border border-[#ccc9ca] py-1 font-bold text-center w-1/2 text-[13px]">金額</th>
            </tr>
          </thead>
          <tbody>
            <tr className="h-7.5 bg-[#f5f3f4]/40">
              <Td bold>【売上高】</Td>
              <Td className="w-1/4"></Td>
              <Td className="w-1/4"></Td>
            </tr>
            {revenues.length > 0 ? revenues.map((item, idx) => (
              <tr key={item.name} className="h-7.5 hover:bg-[#f5f3f4]/20 transition-colors">
                <Td className="pl-6">{item.name}</Td>
                <Td align="right" className="font-mono text-[#44474c]">{formatCurrency(item.amount)}</Td>
                <Td align="right" bold className="font-mono">{idx === 0 ? formatCurrency(report.totalRevenue) : ""}</Td>
              </tr>
            )) : (
              <tr className="h-7.5 hover:bg-[#f5f3f4]/20 transition-colors">
                <Td className="pl-6">売上（収入）金額</Td>
                <Td align="right" className="font-mono">0</Td>
                <Td align="right" bold className="font-mono">0</Td>
              </tr>
            )}
            <tr className="h-7.5 bg-[#f5f3f4]/40"><Td bold>【売上原価】</Td><Td></Td><Td></Td></tr>
            {costOfSales.map(item => (
              <tr key={item.name} className="h-7.5 hover:bg-[#f5f3f4]/20 transition-colors">
                <Td className="pl-6">{item.name}</Td>
                <Td align="right" className="font-mono text-[#44474c]">{formatCurrency(item.amount)}</Td>
                <Td></Td>
              </tr>
            ))}
            <tr className="h-7.5 hover:bg-[#f5f3f4]/20 transition-colors">
              <Td bold className="pl-6 text-[#1b1c1d]">売上原価 計</Td>
              <Td></Td>
              <Td align="right" bold className="font-mono">{formatCurrency(report.totalCostOfSales)}</Td>
            </tr>
            <tr className="h-9 bg-brand-50/30 font-bold text-brand-950">
              <Td className="pl-6 text-brand-950" bold>差引金額 (売上総利益)</Td>
              <Td></Td>
              <Td align="right" className="font-mono text-sm text-brand-950" bold>{formatCurrency(report.grossProfit)}</Td>
            </tr>
            <tr className="h-7.5 bg-[#f5f3f4]/40"><Td bold>【経費】</Td><Td></Td><Td></Td></tr>
            {expenses.map((item) => (
              <tr key={item.name} className="h-7.5 hover:bg-[#f5f3f4]/20 transition-colors">
                <Td className="pl-6">{item.name}</Td>
                <Td align="right" className="font-mono text-[#44474c]">{formatCurrency(item.amount)}</Td>
                <Td></Td>
              </tr>
            ))}
            <tr className="h-7.5 hover:bg-[#f5f3f4]/20 transition-colors">
              <Td bold className="pl-6">経費 計</Td>
              <Td></Td>
              <Td align="right" bold className="font-mono">{formatCurrency(report.totalExpense)}</Td>
            </tr>
            <tr className="h-9 bg-[#f5f3f4]/60 font-bold">
              <Td bold className="text-[#1b1c1d]">差引金額 (営業利益)</Td>
              <Td></Td>
              <Td align="right" className="font-mono text-sm text-[#1b1c1d]" bold>{formatCurrency(report.operatingIncome)}</Td>
            </tr>
            <tr className="h-7.5"><Td>【専従者給与等】</Td><Td></Td><Td></Td></tr>
            <tr className="h-9 font-bold bg-[#003580] text-white">
              <td className="border border-[#ccc9ca] px-3.5 py-1.5 text-[13px] font-bold text-white text-left">【青色申告特別控除前所得】</td>
              <td className="border border-[#ccc9ca]"></td>
              <td className="border border-[#ccc9ca] px-3.5 py-1.5 font-mono text-sm font-bold text-white text-right">{formatCurrency(report.netIncome)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PLStatement;
