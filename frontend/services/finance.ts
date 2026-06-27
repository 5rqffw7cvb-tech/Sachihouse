import { apiRequest } from './api';
import { FinancialTransaction, CsvRow } from '../types/finance';

export interface PendingTransaction {
  id: string;
  propertyId: string;
  gcsPath: string;
  receiptUrl: string;
  ocrProcessed: boolean;
  transactionDate: string;
  debitAccount: string;
  debitAmount: number;
  creditAccount: string;
  creditAmount: number;
  description: string;
  vendor?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ReceiptOcrResult {
  transactionDate?: string;
  amount?: number;
  vendor?: string;
  description?: string;
  suggestedDebitAccount?: string;
}

export interface ReceiptUploadResult {
  receiptUrl: string;
  gcsPath: string;
  sizeBytes: number;
  ocr: ReceiptOcrResult;
}

export interface FinancialProperty {
  id: string;
  name: string;
}

export interface TransactionInput {
  propertyId: string;
  transactionNo: string;
  transactionDate: string;
  debitAccount: string;
  debitAmount: number;
  creditAccount: string;
  creditAmount: number;
  description: string;
  receiptUrl?: string;
}

export const financeApi = {
  async listProperties(): Promise<FinancialProperty[]> {
    return apiRequest<FinancialProperty[]>('/finance/properties');
  },

  async listTransactions(propertyIds: string[], year?: number): Promise<FinancialTransaction[]> {
    const params = new URLSearchParams();
    if (propertyIds.length > 0) params.set('propertyIds', propertyIds.join(','));
    if (year) params.set('year', String(year));
    return apiRequest<FinancialTransaction[]>(`/finance/transactions?${params}`);
  },

  async createTransaction(input: TransactionInput): Promise<FinancialTransaction> {
    return apiRequest<FinancialTransaction>('/finance/transactions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updateTransaction(id: string, input: Partial<TransactionInput>): Promise<FinancialTransaction> {
    return apiRequest<FinancialTransaction>(`/finance/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  async deleteTransaction(id: string): Promise<void> {
    await apiRequest<void>(`/finance/transactions/${id}`, { method: 'DELETE' });
  },

  async bulkImport(propertyId: string, transactions: TransactionInput[]): Promise<{ imported: number }> {
    return apiRequest<{ imported: number }>('/finance/transactions/bulk-import', {
      method: 'POST',
      body: JSON.stringify({ propertyId, transactions }),
    });
  },

  async uploadReceipt(imageBase64: string, propertyId: string): Promise<ReceiptUploadResult> {
    return apiRequest<ReceiptUploadResult>('/finance/receipts/upload', {
      method: 'POST',
      body: JSON.stringify({ imageBase64, propertyId }),
    });
  },

  async listPendingTransactions(propertyIds: string[]): Promise<PendingTransaction[]> {
    const params = new URLSearchParams({ propertyIds: propertyIds.join(',') });
    return apiRequest<PendingTransaction[]>(`/finance/pending?${params}`);
  },

  async uploadSingleReceipt(propertyId: string, imageBase64: string): Promise<PendingTransaction & { receiptUrl: string }> {
    return apiRequest('/finance/pending/upload-single', {
      method: 'POST',
      body: JSON.stringify({ propertyId, imageBase64 }),
    });
  },

  async batchUploadReceipts(propertyId: string, images: string[]): Promise<{ uploaded: number; items: { id: string; gcsPath: string }[] }> {
    return apiRequest('/finance/pending/batch-upload', {
      method: 'POST',
      body: JSON.stringify({ propertyId, images }),
    });
  },

  async processOcr(propertyId: string): Promise<{ processed: number; total: number }> {
    return apiRequest('/finance/pending/process-ocr', {
      method: 'POST',
      body: JSON.stringify({ propertyId }),
    });
  },

  async updatePendingTransaction(id: string, input: Partial<PendingTransaction>): Promise<PendingTransaction> {
    return apiRequest<PendingTransaction>(`/finance/pending/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  async approvePendingTransaction(id: string): Promise<FinancialTransaction> {
    return apiRequest<FinancialTransaction>(`/finance/pending/${id}/approve`, { method: 'POST' });
  },

  async deletePendingTransaction(id: string): Promise<void> {
    await apiRequest<void>(`/finance/pending/${id}`, { method: 'DELETE' });
  },
};

export const FINANCE_HEADERS = ['取引No', '取引日', '借方勘定科目', '借方金額(円)', '貸方勘定科目', '貸方金額(円)', '摘要', '証憑'];

export function transactionsToCsvRows(
  transactions: FinancialTransaction[],
  propertyNameById?: Record<string, string>,
): CsvRow[] {
  return transactions.map(t => ({
    '取引No': t.transactionNo,
    '取引日': t.transactionDate,
    '借方勘定科目': t.debitAccount,
    '借方金額(円)': String(t.debitAmount),
    '貸方勘定科目': t.creditAccount,
    '貸方金額(円)': String(t.creditAmount),
    '摘要': t.description,
    '証憑': t.receiptUrl ?? '',
    '_id': t.id,
    '_propertyId': t.propertyId,
    ...(propertyNameById ? { 'プロパティ名': propertyNameById[t.propertyId] ?? t.propertyId } : {}),
  }));
}
