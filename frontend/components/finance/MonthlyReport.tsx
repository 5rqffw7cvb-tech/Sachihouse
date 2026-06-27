import React from 'react';
import { FinancialReport } from '../../types/finance';

interface MonthlyReportProps {
  report: FinancialReport;
}

const formatCurrency = (val: number) => {
  if (val === 0) return '0';
  return new Intl.NumberFormat('ja-JP').format(val);
};

const Td = ({
  children,
  className = "",
  align = "left",
  bold = false
}: {
  children?: React.ReactNode,
  className?: string,
  align?: "left" | "right" | "center",
  bold?: boolean
}) => (
  <td className={`border border-[#ccc9ca] px-3.5 py-1.5 text-[13px] ${bold ? 'font-bold text-[#1b1c1d]' : 'text-[#44474c]'} ${
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  } ${className}`}>
    {children}
  </td>
);

const MonthlyReport: React.FC<MonthlyReportProps> = ({ report }) => {
  const months = report.monthlyRevenue.map(r => r.month);
  const totalRev = report.monthlyRevenue.reduce((acc, curr) => acc + curr.amount, 0);
  const totalCost = report.monthlyCostOfSales.reduce((acc, curr) => acc + curr.amount, 0);
  const totalExp = report.monthlyExpense.reduce((acc, curr) => acc + curr.amount, 0);
  const grandTotalExp = totalCost + totalExp;

  return (
    <div className="w-full max-w-none">
      {/* Mobile-only view */}
      <div className="md:hidden print:hidden pb-8">
        <h3 className="text-center text-[#1b1c1d] mb-3 text-[14px] font-bold">月別収支推移 (売上・経費)</h3>
        <div className="bg-white rounded-2xl border border-[#ccc9ca] overflow-hidden text-xs shadow-sm">
          <div className="flex items-center bg-[#f5f3f4] border-b border-[#ccc9ca] py-2 text-xs text-[#74777d] font-bold">
            <div className="w-14 text-center">月</div>
            <div className="flex-1 text-right pr-2">売上 (収入)</div>
            <div className="flex-1 text-right pr-4">経費 (支出)</div>
          </div>
          <div className="divide-y divide-[#f5f3f4]">
            {months.map((month, idx) => {
              const rev = report.monthlyRevenue[idx]?.amount || 0;
              const exp = (report.monthlyExpense[idx]?.amount || 0) + (report.monthlyCostOfSales[idx]?.amount || 0);
              const monthDisplay = month.split('/')[1];
              return (
                <div key={month} className="flex items-center py-2 hover:bg-[#f5f3f4]/35 transition-colors">
                  <div className="w-14 text-center text-[#44474c] border-r border-[#f5f3f4] font-mono text-[12px]">{monthDisplay}月</div>
                  <div className="flex-1 text-right pr-2 font-mono text-[12px] text-blue-700 font-semibold">{formatCurrency(rev)}</div>
                  <div className="flex-1 text-right pr-4 font-mono text-[12px] text-rose-700 font-semibold">{formatCurrency(exp)}</div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center bg-[#f5f3f4] border-t-2 border-[#ccc9ca] py-2.5 font-bold text-slate-800">
            <div className="w-14 text-center text-xs text-[#44474c] uppercase font-bold">合計</div>
            <div className="flex-1 text-right pr-2 font-mono text-blue-900 text-sm">{formatCurrency(totalRev)}</div>
            <div className="flex-1 text-right pr-4 font-mono text-rose-900 text-sm">{formatCurrency(grandTotalExp)}</div>
          </div>
        </div>
        <p className="mt-1.5 text-[9px] text-[#74777d] text-right">※ 単位: 円</p>
      </div>

      {/* Desktop & Print view */}
      <div className="hidden md:block print:block bg-white p-6 print-area font-mincho text-[#1b1c1d] leading-normal border border-[#ccc9ca] shadow-sm rounded-2xl">
        <div className="text-center mb-4">
          <h2 className="text-xl border-b-2 border-[#1b1c1d] inline-block pb-0.5 px-10 mb-1.5 font-bold tracking-widest">月別収支推移 (売上・経費)</h2>
        </div>
        <div className="flex justify-end mb-0.5 text-[9px] text-[#74777d]">(単位：円)</div>
        <table className="w-full border-collapse border border-[#ccc9ca]">
          <thead>
            <tr className="bg-[#f5f3f4] h-8">
              <th className="border border-[#ccc9ca] py-1 font-bold text-center w-[15%] text-[13px]">月</th>
              <th className="border border-[#ccc9ca] py-1 font-bold text-center w-[42.5%] text-[13px]">売上（収入）金額</th>
              <th className="border border-[#ccc9ca] py-1 font-bold text-center w-[42.5%] text-[13px]">経費（売上原価含む）</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month, idx) => {
              const rev = report.monthlyRevenue[idx]?.amount || 0;
              const exp = (report.monthlyExpense[idx]?.amount || 0) + (report.monthlyCostOfSales[idx]?.amount || 0);
              const monthDisplay = month.split('/')[1] ? `${month.split('/')[1]}月` : month;
              return (
                <tr key={month} className="h-7.5 hover:bg-[#f5f3f4]/20 transition-colors">
                  <Td align="center" bold className="bg-[#f5f3f4]/10">{monthDisplay}</Td>
                  <Td align="right" className="font-mono pr-8 text-blue-900">{formatCurrency(rev)}</Td>
                  <Td align="right" className="font-mono pr-8 text-rose-900">{formatCurrency(exp)}</Td>
                </tr>
              );
            })}
            <tr className="h-9 bg-[#f5f3f4] font-bold text-slate-900">
              <Td align="center" className="text-sm text-[#1b1c1d]" bold>計</Td>
              <Td align="right" className="font-mono pr-8 text-blue-900 text-sm">{formatCurrency(totalRev)}</Td>
              <Td align="right" className="font-mono pr-8 text-rose-900 text-sm">{formatCurrency(grandTotalExp)}</Td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MonthlyReport;
