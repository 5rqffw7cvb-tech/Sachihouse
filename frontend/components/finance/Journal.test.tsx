import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CsvRow, FinancialReport, JournalEntry } from '../../types/finance';

const updateTransaction = vi.fn();
const createTransaction = vi.fn();
const uploadReceipt = vi.fn();
vi.mock('../../services/finance', () => ({
  financeApi: {
    updateTransaction: (id: string, input: unknown) => updateTransaction(id, input),
    createTransaction: (input: unknown) => createTransaction(input),
    uploadReceipt: (base64: string, propertyId: string) => uploadReceipt(base64, propertyId),
    deleteTransaction: vi.fn(),
    bulkImport: vi.fn(),
  },
}));

const { default: Journal } = await import('./Journal');

const HEADERS = ['プロパティ名', '取引日', '借方勘定科目', '借方金額(円)', '貸方勘定科目', '貸方金額(円)', '摘要'];

const properties = [
  { id: 's01', name: 'Sachi House 01' },
  { id: 's02', name: 'Sachi House 02' },
  { id: 's03', name: 'Sachi House 03' },
];

const makeEntry = (over: Partial<CsvRow> = {}): JournalEntry => {
  const rawData = {
    '取引No': 'T-1',
    '取引日': '2026/03/10',
    '借方勘定科目': '消耗品費',
    '借方金額(円)': '1200',
    '貸方勘定科目': '現金',
    '貸方金額(円)': '1200',
    '摘要': 'Towels',
    '証憑': '',
    'プロパティ名': 'Sachi House 01',
    '_id': 'db-1',
    '_propertyId': 's01',
    ...over,
  } as unknown as CsvRow;
  return {
    id: 'T-1',
    date: '2026/03/10',
    debitAccount: '消耗品費',
    debitAmount: 1200,
    creditAccount: '現金',
    creditAmount: 1200,
    description: 'Towels',
    rawData,
  };
};

const makeReport = (entries: JournalEntry[]): FinancialReport => ({
  targetYear: 2026,
  hasOutOfRangeData: false,
  headers: HEADERS,
  plItems: [], bsAssets: [], bsLiabilities: [], bsEquity: [],
  totalRevenue: 0, totalCostOfSales: 0, totalExpense: 0,
  grossProfit: 0, operatingIncome: 0, netIncome: 0,
  equityBaseTotal: 0, previousRetainedEarnings: 0,
  monthlyRevenue: [], monthlyCostOfSales: [], monthlyExpense: [], monthlyProfit: [],
  journalEntries: entries,
  validationErrors: [],
} as FinancialReport);

const openEditModal = () => {
  // The desktop table has an explicit 編集 button per row.
  fireEvent.click(screen.getAllByTitle('編集')[0]);
  return screen.getByText('仕訳取引を編集').closest('div.bg-white') as HTMLElement;
};

const propertySelectIn = (modal: HTMLElement) =>
  within(modal).getByText('プロパティ:').parentElement!.querySelector('select') as HTMLSelectElement;

describe('Journal edit modal: change property of existing transaction', () => {
  beforeEach(() => {
    updateTransaction.mockReset().mockResolvedValue({});
    createTransaction.mockReset().mockResolvedValue({});
    uploadReceipt.mockReset();
  });

  it('shows a property select preselected with the entry property', () => {
    render(<Journal report={makeReport([makeEntry()])} propertyId="s02" allProperties={properties} />);
    const modal = openEditModal();
    const select = propertySelectIn(modal);
    expect(select).toBeInTheDocument();
    expect(select.value).toBe('s01');
    expect(Array.from(select.options).map(o => o.value)).toEqual(['s01', 's02', 's03']);
  });

  it('saving after changing the property calls updateTransaction with the new propertyId', async () => {
    const onRefresh = vi.fn();
    render(<Journal report={makeReport([makeEntry()])} propertyId="s01" allProperties={properties} onRefresh={onRefresh} />);
    const modal = openEditModal();
    fireEvent.change(propertySelectIn(modal), { target: { value: 's03' } });
    fireEvent.click(within(modal).getByRole('button', { name: '保存' }));

    await waitFor(() => expect(updateTransaction).toHaveBeenCalledTimes(1));
    const [id, payload] = updateTransaction.mock.calls[0];
    expect(id).toBe('db-1');
    expect(payload).toMatchObject({
      propertyId: 's03',
      transactionDate: '2026-03-10',
      debitAccount: '消耗品費',
      debitAmount: 1200,
      creditAmount: 1200,
      description: 'Towels',
    });
    expect(createTransaction).not.toHaveBeenCalled();
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it('saving without changing the property keeps the entry own property (not the page propertyId)', async () => {
    render(<Journal report={makeReport([makeEntry({ '_propertyId': 's02' } as Partial<CsvRow>)])} propertyId="s01" allProperties={properties} />);
    const modal = openEditModal();
    expect(propertySelectIn(modal).value).toBe('s02');
    fireEvent.click(within(modal).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(updateTransaction).toHaveBeenCalledTimes(1));
    expect(updateTransaction.mock.calls[0][1]).toMatchObject({ propertyId: 's02' });
  });

  it('falls back to the page propertyId when the entry has no _propertyId', async () => {
    render(<Journal report={makeReport([makeEntry({ '_propertyId': '' } as Partial<CsvRow>)])} propertyId="s02" allProperties={properties} />);
    const modal = openEditModal();
    expect(propertySelectIn(modal).value).toBe('s02');
    fireEvent.click(within(modal).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(updateTransaction).toHaveBeenCalledTimes(1));
    expect(updateTransaction.mock.calls[0][1]).toMatchObject({ propertyId: 's02' });
  });

  it('works while multiple properties are selected (edit shows property select, not 記帳先)', async () => {
    render(
      <Journal report={makeReport([makeEntry()])} propertyId="s01" selectedPropertyIds={['s01', 's02']} allProperties={properties} />,
    );
    const modal = openEditModal();
    expect(within(modal).queryByText('記帳先:')).not.toBeInTheDocument();
    fireEvent.change(propertySelectIn(modal), { target: { value: 's02' } });
    fireEvent.click(within(modal).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(updateTransaction).toHaveBeenCalledTimes(1));
    expect(updateTransaction.mock.calls[0][1]).toMatchObject({ propertyId: 's02' });
  });

  it('does not show the property select when allProperties is empty', () => {
    render(<Journal report={makeReport([makeEntry()])} propertyId="s01" allProperties={[]} />);
    const modal = openEditModal();
    expect(within(modal).queryByText('プロパティ:')).not.toBeInTheDocument();
    expect(within(modal).getByText('Sachi House 01')).toBeInTheDocument();
  });

  it('does not show the property select for a new entry', async () => {
    render(<Journal report={makeReport([makeEntry()])} propertyId="s01" allProperties={properties} />);
    const addButtons = screen.getAllByRole('button').filter(b => /新規|追加/.test(b.textContent || '') || /新規|追加/.test(b.getAttribute('title') || ''));
    expect(addButtons.length).toBeGreaterThan(0);
    fireEvent.click(addButtons[0]);
    const heading = await screen.findByText('新規仕訳取引を登録');
    const modal = heading.closest('div.bg-white') as HTMLElement;
    expect(within(modal).queryByText('プロパティ:')).not.toBeInTheDocument();
  });
});
