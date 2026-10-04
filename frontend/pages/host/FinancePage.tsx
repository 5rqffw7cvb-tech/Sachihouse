import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, Lock } from 'lucide-react';
import { HostCard, HostEmpty, HostScreen } from '../../components/host/HostScreen';
import { useHostContext } from '../../components/host/HostShell';
import { ApiError } from '../../services/api';
import {
  financeApi, FINANCE_HEADERS, FinancialProperty, transactionsToCsvRows,
} from '../../services/finance';
import { formatMoney } from '../../services/hostApp';
import { hasAccess } from '../../services/permissions';
import { FinancialTransaction } from '../../types/finance';
import { processFinancials } from '../../utils/accountingUtils';

/** Yen with the minus in front of the sign — formatMoney would put it after. */
const yen = (amount: number): string =>
  amount < 0 ? `-${formatMoney(-amount, 'JPY')}` : formatMoney(amount, 'JPY');

const CELL = 'px-2 py-2 text-right whitespace-nowrap';

/**
 * The phone half of 月次推移: revenue, costs and profit for each month of this
 * year, and the year so far underneath.
 *
 * Built from the approved journal and nothing else, through the same
 * processFinancials the desktop finance pages use — a host comparing this
 * screen with the console must be reading the same numbers. 経費 is cost of
 * sales plus expenses, as on the desktop dashboard, so 売上 − 経費 is always
 * the 利益 next to it.
 *
 * Every transaction the host can see is fetched once; picking a property only
 * filters what is already here.
 */
const FinancePage: React.FC = () => {
  const { user } = useHostContext();
  const canView = hasAccess(user, 'finance');
  const year = new Date().getFullYear();

  const [properties, setProperties] = useState<FinancialProperty[]>([]);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  // '' is every property — the default, and what a host with one property sees.
  const [propertyId, setPropertyId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const rows = await financeApi.listProperties();
        if (cancelled) return;
        setProperties(rows);
        if (rows.length === 0) return;
        const loaded = await financeApi.listTransactions(rows.map((p) => p.id), year);
        if (cancelled) return;
        setTransactions(loaded);
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.status === 403) {
          setError('財務データを表示する権限がありません。');
        } else {
          setError(cause instanceof Error && cause.message ? cause.message : '財務データを取得できませんでした。');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [canView, year]);

  const propertyNameById = useMemo(() => {
    const map: Record<string, string> = {};
    properties.forEach((p) => { map[p.id] = p.name; });
    return map;
  }, [properties]);

  const report = useMemo(() => {
    const selectedTx = propertyId
      ? transactions.filter((t) => t.propertyId === propertyId)
      : transactions;
    const rows = transactionsToCsvRows(selectedTx, propertyNameById);
    return processFinancials(rows, FINANCE_HEADERS, year);
  }, [transactions, propertyId, propertyNameById, year]);

  const months = useMemo(
    () => Array.from({ length: 12 }, (_, i) => ({
      label: `${i + 1}月`,
      revenue: report.monthlyRevenue[i]?.amount ?? 0,
      expense: (report.monthlyCostOfSales[i]?.amount ?? 0) + (report.monthlyExpense[i]?.amount ?? 0),
      profit: report.monthlyProfit[i]?.amount ?? 0,
    })),
    [report],
  );

  if (!canView) {
    return (
      <HostScreen title="Finance" subtitle="月次損益">
        <HostCard>
          <div className="flex flex-col items-center text-center gap-3 px-6 py-12">
            <div className="w-11 h-11 rounded-full bg-subtle flex items-center justify-center">
              <Lock className="w-5 h-5 text-ink-muted" />
            </div>
            <p className="text-[15px] font-semibold text-ink">権限がありません</p>
            <p className="text-[13px] text-ink-muted">
              財務レポートは管理者とホストレベル4のみ利用できます。
            </p>
          </div>
        </HostCard>
      </HostScreen>
    );
  }

  /** A month with nothing in it reads as a dash, not as ¥0 the host has to
   *  check. The totals row always shows a figure. */
  const monthCell = (amount: number, negativeIsDanger = false) => {
    if (amount === 0) return <td className={`${CELL} text-ink-muted`}>—</td>;
    return (
      <td className={`${CELL} ${negativeIsDanger && amount < 0 ? 'text-danger' : 'text-ink'}`}>
        {yen(amount)}
      </td>
    );
  };

  const totalExpense = report.totalCostOfSales + report.totalExpense;

  return (
    <HostScreen
      title="Finance"
      subtitle="月次損益"
      isLoading={isLoading}
      error={error}
    >
      {properties.length === 0 ? (
        // A failed property load already says so above; "no properties" would
        // be a second, wrong explanation.
        error ? null : (
          <HostCard padded>
            <p className="text-center text-[14px] text-ink-soft py-6">利用できる物件がありません。</p>
          </HostCard>
        )
      ) : (
        <>
          <HostCard padded>
            <span className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-ink-soft">
              <Building2 className="w-3.5 h-3.5 text-link" />
              物件 (Property)
            </span>
            {properties.length === 1 ? (
              <div className="mt-2 h-[50px] px-3.5 rounded-control bg-subtle border border-line flex items-center
                text-[15px] font-bold text-ink">
                {properties[0].name}
              </div>
            ) : (
              <select
                value={propertyId}
                onChange={(event) => setPropertyId(event.target.value)}
                className="mt-2 w-full h-[50px] px-3 rounded-control bg-subtle border border-line
                  text-[16px] font-bold text-ink focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15
                  disabled:opacity-60"
              >
                <option value="">すべての物件 ({properties.length})</option>
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>{property.name}</option>
                ))}
              </select>
            )}
          </HostCard>

          {!error && report.validationErrors.length > 0 && (
            <div className="flex items-start gap-2.5 bg-warn-tint text-warn border border-warn/20 rounded-card px-4 py-3 text-[13px]">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="flex-1 min-w-0">
                貸借不一致の仕訳が {report.validationErrors.length} 件あります。
              </span>
            </div>
          )}

          {!error && (
            <HostCard title={`${year}年`}>
              {report.journalEntries.length === 0 ? (
                <HostEmpty>{year}年の仕訳はまだありません。</HostEmpty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px] tabular-nums" aria-label="月次損益表">
                    <thead>
                      <tr className="border-b border-line text-ink-muted font-semibold">
                        <th scope="col" className="px-2 py-2 text-left whitespace-nowrap font-semibold">月</th>
                        <th scope="col" className={`${CELL} font-semibold`}>売上</th>
                        <th scope="col" className={`${CELL} font-semibold`}>経費</th>
                        <th scope="col" className={`${CELL} font-semibold`}>利益</th>
                      </tr>
                    </thead>
                    <tbody>
                      {months.map((month, index) => (
                        <tr key={month.label} className={index === 0 ? '' : 'border-t border-line'}>
                          <th scope="row" className="px-2 py-2 text-left whitespace-nowrap font-medium text-ink-soft">
                            {month.label}
                          </th>
                          {monthCell(month.revenue)}
                          {monthCell(month.expense)}
                          {monthCell(month.profit, true)}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-line bg-subtle font-bold text-ink">
                        <th scope="row" className="px-2 py-2 text-left whitespace-nowrap font-bold">合計</th>
                        <td className={CELL}>{yen(report.totalRevenue)}</td>
                        <td className={CELL}>{yen(totalExpense)}</td>
                        <td className={`${CELL} ${report.netIncome < 0 ? 'text-danger' : ''}`}>
                          {yen(report.netIncome)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </HostCard>
          )}
        </>
      )}
    </HostScreen>
  );
};

export default FinancePage;
