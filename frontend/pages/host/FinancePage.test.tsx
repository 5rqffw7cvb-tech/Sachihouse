import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ApiUser } from '../../services/api';
import { FinancialTransaction } from '../../types/finance';
import { processFinancials } from '../../utils/accountingUtils';

const listProperties = vi.fn();
const listTransactions = vi.fn();
// Only the network half is mocked: transactionsToCsvRows and FINANCE_HEADERS
// stay real so the page runs through the same pipeline as the desktop.
vi.mock('../../services/finance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/finance')>()),
  financeApi: {
    listProperties: () => listProperties(),
    listTransactions: (ids: string[], year?: number) => listTransactions(ids, year),
  },
}));

const baseUser: ApiUser = {
  id: 1,
  name: 'Admin',
  email: 'admin@example.com',
  role: 'ADMIN',
  canEditBlog: false,
  assignedPropertyIds: [],
  hostLevel: null,
};
let currentUser: ApiUser | null = baseUser;

vi.mock('../../components/host/HostShell', () => ({
  useHostContext: () => ({
    user: currentUser,
    properties: [],
    propertiesError: null,
    reloadProperties: () => {},
  }),
}));

const { default: FinancePage } = await import('./FinancePage');
const { transactionsToCsvRows, FINANCE_HEADERS } = await import('../../services/finance');

const year = new Date().getFullYear();

const PROPERTIES = [
  { id: 's01', name: 'Sachi House 01' },
  { id: 's02', name: 'Sachi House 02' },
];

const tx = (over: Partial<FinancialTransaction>): FinancialTransaction => ({
  id: 't',
  propertyId: 's01',
  transactionNo: 'T-1',
  transactionDate: `${year}-01-15`,
  debitAccount: '普通預金',
  debitAmount: 0,
  creditAccount: '売上高',
  creditAmount: 0,
  description: '',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

/**
 * s01, January: revenue 100,000, expense 20,000           → profit 80,000
 * s02, March:   revenue  30,000, cost of sales 50,000     → profit -20,000
 * All:          revenue 130,000, expense+CoS 70,000       → profit 60,000
 */
const FIXTURE: FinancialTransaction[] = [
  tx({ id: 't1', transactionNo: 'T-1', propertyId: 's01', transactionDate: `${year}-01-15`,
    debitAccount: '普通預金', debitAmount: 100000, creditAccount: '売上高', creditAmount: 100000 }),
  tx({ id: 't2', transactionNo: 'T-2', propertyId: 's01', transactionDate: `${year}-01-15`,
    debitAccount: '消耗品費', debitAmount: 20000, creditAccount: '現金', creditAmount: 20000 }),
  tx({ id: 't3', transactionNo: 'T-3', propertyId: 's02', transactionDate: `${year}-03-15`,
    debitAccount: '外注工賃', debitAmount: 50000, creditAccount: '現金', creditAmount: 50000 }),
  tx({ id: 't4', transactionNo: 'T-4', propertyId: 's02', transactionDate: `${year}-03-15`,
    debitAccount: '普通預金', debitAmount: 30000, creditAccount: '売上高', creditAmount: 30000 }),
];

const yenText = (n: number) => (n < 0 ? `-¥${(-n).toLocaleString()}` : `¥${n.toLocaleString()}`);
const cellText = (n: number) => (n === 0 ? '—' : yenText(n));

/** Rows of the table as [label, revenue, expense, profit] text, body + footer. */
async function readTable() {
  const table = await screen.findByRole('table', { name: '月次損益表' });
  const rows = within(table).getAllByRole('row').slice(1); // drop header row
  return {
    table,
    rows,
    text: rows.map((row) => Array.from(row.children).map((c) => c.textContent)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = baseUser;
  listProperties.mockResolvedValue(PROPERTIES);
  listTransactions.mockResolvedValue(FIXTURE);
});

describe('who may see the finance screen', () => {
  it('refuses a level-3 host without calling the API or showing any figure', async () => {
    currentUser = { ...baseUser, role: 'HOST', hostLevel: 3, assignedPropertyIds: ['s01'] };
    const { container } = render(<FinancePage />);

    expect(await screen.findByText('権限がありません')).toBeInTheDocument();
    // Give any stray effect a chance to fire before asserting it did not.
    await new Promise((r) => setTimeout(r, 20));
    expect(listProperties).not.toHaveBeenCalled();
    expect(listTransactions).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('¥');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('refuses a user with no session at all', async () => {
    currentUser = null;
    render(<FinancePage />);
    expect(await screen.findByText('権限がありません')).toBeInTheDocument();
    expect(listProperties).not.toHaveBeenCalled();
  });

  it('loads for an admin: properties once, then every property for this year once', async () => {
    render(<FinancePage />);
    await readTable();
    expect(listProperties).toHaveBeenCalledTimes(1);
    expect(listTransactions).toHaveBeenCalledTimes(1);
    expect(listTransactions).toHaveBeenCalledWith(['s01', 's02'], year);
  });

  it('loads for a level-4 host the same way', async () => {
    currentUser = { ...baseUser, role: 'HOST', hostLevel: 4, assignedPropertyIds: ['s01', 's02'] };
    render(<FinancePage />);
    await readTable();
    expect(listProperties).toHaveBeenCalledTimes(1);
    expect(listTransactions).toHaveBeenCalledTimes(1);
    expect(listTransactions).toHaveBeenCalledWith(['s01', 's02'], year);
  });
});

describe('the monthly table', () => {
  it('has twelve months and a total, with figures worked out by hand', async () => {
    render(<FinancePage />);
    const { text } = await readTable();

    expect(text).toHaveLength(13);
    expect(text.slice(0, 12).map((r) => r[0])).toEqual(
      Array.from({ length: 12 }, (_, i) => `${i + 1}月`),
    );
    expect(text[12][0]).toBe('合計');

    expect(text[0]).toEqual(['1月', '¥100,000', '¥20,000', '¥80,000']);
    expect(text[1]).toEqual(['2月', '—', '—', '—']);
    expect(text[2]).toEqual(['3月', '¥30,000', '¥50,000', '-¥20,000']);
    for (let i = 3; i < 12; i += 1) expect(text[i]).toEqual([`${i + 1}月`, '—', '—', '—']);
    expect(text[12]).toEqual(['合計', '¥130,000', '¥70,000', '¥60,000']);
  });

  it('matches what the desktop processFinancials makes of the same journal', async () => {
    render(<FinancePage />);
    const { text } = await readTable();

    const nameById = Object.fromEntries(PROPERTIES.map((p) => [p.id, p.name]));
    const report = processFinancials(transactionsToCsvRows(FIXTURE, nameById), FINANCE_HEADERS, year);

    for (let i = 0; i < 12; i += 1) {
      const revenue = report.monthlyRevenue[i].amount;
      const expense = report.monthlyCostOfSales[i].amount + report.monthlyExpense[i].amount;
      const profit = report.monthlyProfit[i].amount;
      expect(text[i]).toEqual([`${i + 1}月`, cellText(revenue), cellText(expense), cellText(profit)]);
      // 売上 − 経費 is always the 利益 beside it.
      expect(revenue - expense).toBe(profit);
    }
    expect(text[12]).toEqual([
      '合計',
      yenText(report.totalRevenue),
      yenText(report.totalCostOfSales + report.totalExpense),
      yenText(report.netIncome),
    ]);
  });

  it('shows a loss with a leading minus in the danger colour', async () => {
    render(<FinancePage />);
    const { rows } = await readTable();
    const marchProfit = rows[2].children[3];
    expect(marchProfit.textContent).toBe('-¥20,000');
    expect(marchProfit).toHaveClass('text-danger');
    // A profit is not painted as a loss.
    expect(rows[0].children[3]).not.toHaveClass('text-danger');
    expect(rows[12].children[3]).not.toHaveClass('text-danger');
  });

  it('paints a negative yearly total in the danger colour too', async () => {
    listTransactions.mockResolvedValue(FIXTURE.filter((t) => t.propertyId === 's02'));
    render(<FinancePage />);
    const { rows, text } = await readTable();
    expect(text[12]).toEqual(['合計', '¥30,000', '¥50,000', '-¥20,000']);
    expect(rows[12].children[3]).toHaveClass('text-danger');
  });
});

describe('picking a property', () => {
  it('defaults to every property and narrows to one without fetching again', async () => {
    render(<FinancePage />);
    await readTable();

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(select.options[select.selectedIndex].textContent).toContain('すべての物件');

    fireEvent.change(select, { target: { value: 's01' } });
    let { text } = await readTable();
    expect(text[0]).toEqual(['1月', '¥100,000', '¥20,000', '¥80,000']);
    expect(text[2]).toEqual(['3月', '—', '—', '—']);
    expect(text[12]).toEqual(['合計', '¥100,000', '¥20,000', '¥80,000']);

    fireEvent.change(select, { target: { value: 's02' } });
    ({ text } = await readTable());
    expect(text[0]).toEqual(['1月', '—', '—', '—']);
    expect(text[2]).toEqual(['3月', '¥30,000', '¥50,000', '-¥20,000']);
    expect(text[12]).toEqual(['合計', '¥30,000', '¥50,000', '-¥20,000']);

    fireEvent.change(select, { target: { value: '' } });
    ({ text } = await readTable());
    expect(text[12]).toEqual(['合計', '¥130,000', '¥70,000', '¥60,000']);

    expect(listTransactions).toHaveBeenCalledTimes(1);
    expect(listProperties).toHaveBeenCalledTimes(1);
  });

  it('shows the one property by name, with no picker, when there is only one', async () => {
    listProperties.mockResolvedValue([PROPERTIES[0]]);
    listTransactions.mockResolvedValue(FIXTURE.filter((t) => t.propertyId === 's01'));
    render(<FinancePage />);
    await readTable();

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('Sachi House 01')).toBeInTheDocument();
    expect(listTransactions).toHaveBeenCalledWith(['s01'], year);
  });
});

describe('empty, loading and error states', () => {
  it('says there are no properties and does not ask for transactions', async () => {
    listProperties.mockResolvedValue([]);
    render(<FinancePage />);
    expect(await screen.findByText('利用できる物件がありません。')).toBeInTheDocument();
    expect(listTransactions).not.toHaveBeenCalled();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says the year has no entries yet, with no table', async () => {
    listTransactions.mockResolvedValue([]);
    render(<FinancePage />);
    expect(await screen.findByText(`${year}年の仕訳はまだありません。`)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('explains a 403 in words and shows no table', async () => {
    listTransactions.mockRejectedValue(new ApiError('Forbidden', 403));
    render(<FinancePage />);
    expect(await screen.findByText('財務データを表示する権限がありません。')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Forbidden')).not.toBeInTheDocument();
  });

  it('shows a network failure as it came', async () => {
    listTransactions.mockRejectedValue(new Error('Failed to fetch'));
    render(<FinancePage />);
    expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a failed property load once, without also claiming there are no properties', async () => {
    listProperties.mockRejectedValue(new Error('Failed to fetch'));
    render(<FinancePage />);
    expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
    expect(screen.queryByText('利用できる物件がありません。')).not.toBeInTheDocument();
    expect(listTransactions).not.toHaveBeenCalled();
  });

  it('warns about an entry whose two sides do not match', async () => {
    listTransactions.mockResolvedValue([
      ...FIXTURE,
      tx({ id: 't5', transactionNo: 'T-5', propertyId: 's01', transactionDate: `${year}-01-15`,
        debitAccount: '消耗品費', debitAmount: 1000, creditAccount: '現金', creditAmount: 900 }),
    ]);
    render(<FinancePage />);
    expect(await screen.findByText('貸借不一致の仕訳が 1 件あります。')).toBeInTheDocument();
  });

  it('does not warn when every entry balances', async () => {
    render(<FinancePage />);
    await readTable();
    expect(screen.queryByText(/貸借不一致/)).not.toBeInTheDocument();
  });

  it('shows no table while properties are still loading', async () => {
    listProperties.mockReturnValue(new Promise(() => {}));
    render(<FinancePage />);
    await waitFor(() => expect(listProperties).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('利用できる物件がありません。')).not.toBeInTheDocument();
  });

  it('shows no table while transactions are still loading', async () => {
    listTransactions.mockReturnValue(new Promise(() => {}));
    render(<FinancePage />);
    await waitFor(() => expect(listTransactions).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText(`${year}年の仕訳はまだありません。`)).not.toBeInTheDocument();
  });
});
