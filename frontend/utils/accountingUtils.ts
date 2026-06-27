import { AccountType, AccountBalance, FinancialReport, CsvRow, JournalEntry } from '../types/finance';

const parseSheetDate = (val: unknown): Date | null => {
  if (!val) return null;
  const strVal = String(val).trim();
  const serial = parseFloat(strVal);
  if (!isNaN(serial) && /^\d+(\.\d+)?$/.test(strVal) && serial > 30000 && serial < 100000) {
    const baseDate = new Date(1899, 11, 30);
    return new Date(baseDate.getTime() + Math.round(serial * 86400000));
  }
  const date = new Date(strVal);
  if (!isNaN(date.getTime())) return date;
  return null;
};

export const extractUrl = (text: string): string => {
  if (!text) return "";
  const str = String(text).trim();
  const internalMatch = str.match(/\[\[HYPERLINK:(.+?)\|.+?\]\]/);
  if (internalMatch) return internalMatch[1];
  const formulaMatch = str.match(/=HYPERLINK\s*\(\s*["']([^"']+)["']/i);
  if (formulaMatch) return formulaMatch[1];
  const rawUrlMatch = str.match(/((?:https?:\/\/|www\.)[^\s]+)/i);
  if (rawUrlMatch) {
    let url = rawUrlMatch[1];
    url = url.replace(/["'),\]]+$/, '');
    if (url.toLowerCase().startsWith('www.')) {
      url = 'https://' + url;
    }
    return url;
  }
  return "";
};

export const getValue = (row: CsvRow, keys: string[]): string => {
  for (const key of keys) {
    if (row[key] !== undefined) return String(row[key]);
    const found = Object.keys(row).find(k => k.trim().toLowerCase() === key.toLowerCase());
    if (found) return String(row[found]);
  }
  return "";
};

export const parseCurrency = (val: string | number): number => {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  if (val.startsWith('=')) return 0;
  return parseFloat(String(val).replace(/,/g, ''));
};

export const ACCOUNT_TYPE_MAP: Record<string, AccountType> = {
  '現金': AccountType.Asset, '小口現金': AccountType.Asset, '普通預金': AccountType.Asset,
  '当座預金': AccountType.Asset, '定期預金': AccountType.Asset, '売掛金': AccountType.Asset,
  '受取手形': AccountType.Asset, '商品': AccountType.Asset, '貯蔵品': AccountType.Asset,
  '前払金': AccountType.Asset, '貸付金': AccountType.Asset, '建物': AccountType.Asset,
  '車両運搬具': AccountType.Asset, '工具器具備品': AccountType.Asset, '備品': AccountType.Asset,
  '一括償却資産': AccountType.Asset, '土地': AccountType.Asset, '開業費': AccountType.Asset,
  '未収入金': AccountType.Asset, '仮払金': AccountType.Asset, '敷金': AccountType.Asset, '保証金': AccountType.Asset,
  '買掛金': AccountType.Liability, '支払手形': AccountType.Liability, '未払金': AccountType.Liability,
  '預り金': AccountType.Liability, '借入金': AccountType.Liability, '仮受金': AccountType.Liability,
  '前受金': AccountType.Liability,
  '元入金': AccountType.Equity,
  '事業主借': AccountType.Equity,
  '事業主貸': AccountType.Equity,
  '売上高': AccountType.Revenue, '売上': AccountType.Revenue,
  '雑収入': AccountType.Revenue, '受取利息': AccountType.Revenue,
  '期首商品棚卸高': AccountType.CostOfSales, '仕入高': AccountType.CostOfSales, '仕入': AccountType.CostOfSales, '外注工賃': AccountType.CostOfSales,
  '消耗品費': AccountType.Expense, '旅費交通費': AccountType.Expense, '水道光熱費': AccountType.Expense,
  '通信費': AccountType.Expense, '広告宣伝費': AccountType.Expense, '接待交際費': AccountType.Expense,
  '修繕費': AccountType.Expense, '減価償却費': AccountType.Expense, '地代家賃': AccountType.Expense,
  '租税公課': AccountType.Expense, '給料賃金': AccountType.Expense, '利子割引料': AccountType.Expense,
  '雑費': AccountType.Expense, '会議費': AccountType.Expense, '新聞図書費': AccountType.Expense, '支払手数料': AccountType.Expense,
  '車両費': AccountType.Expense, '外注費': AccountType.Expense
};

const getAccountType = (name: string): AccountType => {
  if (ACCOUNT_TYPE_MAP[name]) return ACCOUNT_TYPE_MAP[name];
  if (/売上|収入|益|Sales|Revenue|Income/.test(name)) return AccountType.Revenue;
  if (/費|料|損|Expense|Cost/.test(name)) return AccountType.Expense;
  if (/預金|現金|金|Asset/.test(name)) return AccountType.Asset;
  return AccountType.Expense;
};

const createEmptyReport = (targetYear: number, headers: string[]): FinancialReport => ({
  targetYear, hasOutOfRangeData: false, headers,
  plItems: [], bsAssets: [], bsLiabilities: [], bsEquity: [],
  totalRevenue: 0, totalCostOfSales: 0, totalExpense: 0,
  grossProfit: 0, operatingIncome: 0, netIncome: 0,
  equityBaseTotal: 0, previousRetainedEarnings: 0,
  monthlyRevenue: [], monthlyCostOfSales: [], monthlyExpense: [], monthlyProfit: [],
  journalEntries: [], validationErrors: []
});

export const processFinancials = (rows: CsvRow[], headers: string[], specificYear?: number | 'ALL'): FinancialReport => {
  const targetYear = specificYear === 'ALL' ? new Date().getFullYear() : (specificYear || new Date().getFullYear());

  const bsBalances: Record<string, number> = {};
  const plBalancesCurrent: Record<string, number> = {};
  const plBalancesPast: Record<string, number> = {};
  const monthlyRev: Record<string, number> = {};
  const monthlyExp: Record<string, number> = {};
  const monthlyCoS: Record<string, number> = {};
  const journalEntries: JournalEntry[] = [];
  const validationErrors: string[] = [];

  if (!Array.isArray(rows)) return createEmptyReport(targetYear, headers);

  rows.forEach((row, index) => {
    const dateStr = getValue(row, ['取引日', 'Date', '日付']);
    const dateObj = parseSheetDate(dateStr);
    if (!dateObj) return;
    const rowYear = dateObj.getFullYear();
    if (specificYear !== 'ALL' && rowYear > targetYear) return;

    const debitAccount = getValue(row, ['借方勘定科目', '借方科目', 'Debit Account', '借方'])?.trim();
    const debitAmount = parseCurrency(getValue(row, ['借方金額(円)', '借方金額', 'Debit Amount', '金額']));
    const creditAccount = getValue(row, ['貸方勘定科目', '貸方科目', 'Credit Account', '貸方'])?.trim();
    const creditAmount = parseCurrency(getValue(row, ['貸方金額(円)', '貸方金額', 'Credit Amount']));

    if (debitAmount <= 0 && creditAmount <= 0) return;
    if (debitAmount !== creditAmount && (specificYear === 'ALL' || rowYear === targetYear)) {
      validationErrors.push(`行 ${index + 2}: 貸借不一致 (${debitAccount}: ${debitAmount} / ${creditAccount}: ${creditAmount})`);
    }

    if ((specificYear === 'ALL' || rowYear === targetYear) && (debitAccount || creditAccount)) {
      const summary = getValue(row, ['摘要', 'Description', '内容']).replace(/\[\[HYPERLINK:.+?\|(.+?)\]\]/, '$1');
      journalEntries.push({
        id: getValue(row, ['取引No', 'No', 'ID']) || String(index + 1),
        date: dateObj.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }),
        debitAccount: debitAccount || "", debitAmount,
        creditAccount: creditAccount || "", creditAmount,
        description: summary,
        debitSupplier: getValue(row, ['借方取引先', '取引先']),
        debitInvoiceNumber: getValue(row, ['借方インボイス', 'インボイス']),
        isOutOfRange: false, sheetRowIndex: index + 2, rawData: row,
        isUnbalanced: debitAmount !== creditAmount
      });
    }

    if (debitAccount) {
      const type = getAccountType(debitAccount);
      if (type === AccountType.Asset || type === AccountType.Liability || type === AccountType.Equity) {
        const sign = type === AccountType.Asset ? 1 : -1;
        bsBalances[debitAccount] = (bsBalances[debitAccount] || 0) + (debitAmount * sign);
      } else {
        const sign = (type === AccountType.Expense || type === AccountType.CostOfSales) ? 1 : -1;
        if (rowYear === targetYear) {
          plBalancesCurrent[debitAccount] = (plBalancesCurrent[debitAccount] || 0) + (debitAmount * sign);
          const mKey = `${rowYear}/${dateObj.getMonth() + 1}`;
          if (type === AccountType.Revenue) monthlyRev[mKey] = (monthlyRev[mKey] || 0) - debitAmount;
          else if (type === AccountType.CostOfSales) monthlyCoS[mKey] = (monthlyCoS[mKey] || 0) + debitAmount;
          else monthlyExp[mKey] = (monthlyExp[mKey] || 0) + debitAmount;
        } else {
          plBalancesPast[debitAccount] = (plBalancesPast[debitAccount] || 0) + (debitAmount * sign);
        }
      }
    }

    if (creditAccount) {
      const type = getAccountType(creditAccount);
      if (type === AccountType.Asset || type === AccountType.Liability || type === AccountType.Equity) {
        const sign = type === AccountType.Asset ? -1 : 1;
        bsBalances[creditAccount] = (bsBalances[creditAccount] || 0) + (creditAmount * sign);
      } else {
        const sign = (type === AccountType.Expense || type === AccountType.CostOfSales) ? -1 : 1;
        if (rowYear === targetYear) {
          plBalancesCurrent[creditAccount] = (plBalancesCurrent[creditAccount] || 0) + (creditAmount * sign);
          const mKey = `${rowYear}/${dateObj.getMonth() + 1}`;
          if (type === AccountType.Revenue) monthlyRev[mKey] = (monthlyRev[mKey] || 0) + creditAmount;
          else if (type === AccountType.CostOfSales) monthlyCoS[mKey] = (monthlyCoS[mKey] || 0) - creditAmount;
          else monthlyExp[mKey] = (monthlyExp[mKey] || 0) - creditAmount;
        } else {
          plBalancesPast[creditAccount] = (plBalancesPast[creditAccount] || 0) + (creditAmount * sign);
        }
      }
    }
  });

  let totalPastRev = 0, totalPastExp = 0;
  Object.entries(plBalancesPast).forEach(([name, bal]) => {
    const type = getAccountType(name);
    if (type === AccountType.Revenue) totalPastRev += bal;
    else totalPastExp += bal;
  });
  const previousRetainedEarnings = totalPastRev - totalPastExp;

  const plItems: AccountBalance[] = [];
  let totalRevenue = 0, totalCostOfSales = 0, totalExpense = 0;
  Object.entries(plBalancesCurrent).forEach(([name, bal]) => {
    if (bal === 0) return;
    const type = getAccountType(name);
    plItems.push({ name, type, amount: bal });
    if (type === AccountType.Revenue) totalRevenue += bal;
    else if (type === AccountType.CostOfSales) totalCostOfSales += bal;
    else totalExpense += bal;
  });

  const netIncome = totalRevenue - (totalCostOfSales + totalExpense);
  const bsAssets: AccountBalance[] = [];
  const bsLiabilities: AccountBalance[] = [];
  const bsEquity: AccountBalance[] = [];
  let equityBaseTotal = 0;
  Object.entries(bsBalances).forEach(([name, bal]) => {
    if (Math.abs(bal) < 1 && name !== '現金') return;
    const type = getAccountType(name);
    if (type === AccountType.Asset) bsAssets.push({ name, type, amount: bal });
    else if (type === AccountType.Liability) bsLiabilities.push({ name, type, amount: bal });
    else if (type === AccountType.Equity) { bsEquity.push({ name, type, amount: bal }); equityBaseTotal += bal; }
  });

  const monthsInYear = Array.from({ length: 12 }, (_, i) => `${targetYear}/${i + 1}`);
  return {
    targetYear, hasOutOfRangeData: false, headers,
    plItems: plItems.sort((a, b) => b.amount - a.amount),
    bsAssets: bsAssets.sort((a, b) => b.amount - a.amount),
    bsLiabilities: bsLiabilities.sort((a, b) => b.amount - a.amount),
    bsEquity: bsEquity.sort((a, b) => b.amount - a.amount),
    totalRevenue, totalCostOfSales, totalExpense,
    grossProfit: totalRevenue - totalCostOfSales,
    operatingIncome: totalRevenue - totalCostOfSales - totalExpense,
    netIncome, equityBaseTotal, previousRetainedEarnings,
    monthlyRevenue: monthsInYear.map(m => ({ month: m, amount: monthlyRev[m] || 0 })),
    monthlyCostOfSales: monthsInYear.map(m => ({ month: m, amount: monthlyCoS[m] || 0 })),
    monthlyExpense: monthsInYear.map(m => ({ month: m, amount: monthlyExp[m] || 0 })),
    monthlyProfit: monthsInYear.map(m => ({ month: m, amount: (monthlyRev[m] || 0) - (monthlyCoS[m] || 0) - (monthlyExp[m] || 0) })),
    journalEntries: journalEntries.sort((a, b) => (b.sheetRowIndex || 0) - (a.sheetRowIndex || 0)),
    validationErrors
  };
};
