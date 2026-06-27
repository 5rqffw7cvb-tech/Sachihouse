export interface CsvRow {
  "取引No": string;
  "取引日": string;
  "借方勘定科目": string;
  "借方金額(円)": string;
  "貸方勘定科目": string;
  "貸方金額(円)": string;
  [key: string]: string;
}

export enum AccountType {
  Asset = '資産',
  Liability = '負債',
  Equity = '資本',
  Revenue = '売上・収益',
  CostOfSales = '売上原価',
  Expense = '経費'
}

export interface AccountBalance {
  name: string;
  type: AccountType;
  amount: number;
}

export interface JournalEntry {
  id: string;
  date: string;
  debitAccount: string;
  debitAmount: number;
  creditAccount: string;
  creditAmount: number;
  description: string;
  debitSupplier?: string;
  debitInvoiceNumber?: string;
  isOutOfRange?: boolean;
  sheetRowIndex?: number;
  rawData: CsvRow;
  isUnbalanced?: boolean;
}

export interface FinancialReport {
  targetYear: number;
  hasOutOfRangeData: boolean;
  headers: string[];
  plItems: AccountBalance[];
  bsAssets: AccountBalance[];
  bsLiabilities: AccountBalance[];
  bsEquity: AccountBalance[];
  totalRevenue: number;
  totalCostOfSales: number;
  totalExpense: number;
  grossProfit: number;
  operatingIncome: number;
  netIncome: number;
  equityBaseTotal: number;
  previousRetainedEarnings: number;
  monthlyRevenue: { month: string; amount: number }[];
  monthlyCostOfSales: { month: string; amount: number }[];
  monthlyExpense: { month: string; amount: number }[];
  monthlyProfit: { month: string; amount: number }[];
  journalEntries: JournalEntry[];
  validationErrors: string[];
}

export interface FinancialTransaction {
  id: string;
  propertyId: string;
  transactionNo: string;
  transactionDate: string;
  debitAccount: string;
  debitAmount: number;
  creditAccount: string;
  creditAmount: number;
  description: string;
  receiptUrl?: string;
  createdAt: number;
  updatedAt: number;
}
