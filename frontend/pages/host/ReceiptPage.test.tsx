import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiUser } from '../../services/api';
import { PendingTransaction } from '../../services/finance';

const listProperties = vi.fn();
const listPendingTransactions = vi.fn();
vi.mock('../../services/finance', () => ({
  financeApi: {
    listProperties: () => listProperties(),
    listPendingTransactions: (ids: string[]) => listPendingTransactions(ids),
  },
}));

// The page reads its properties and user from the host shell's outlet context,
// which a router would otherwise have to provide.
const user: ApiUser = {
  id: 1,
  name: 'Host',
  email: 'host@example.com',
  role: 'ADMIN',
  canEditBlog: false,
  assignedPropertyIds: [],
  hostLevel: 4,
};
vi.mock('../../components/host/HostShell', () => ({
  useHostContext: () => ({
    user,
    properties: [
      { id: 's01', name: 'Sachi House 01' },
      { id: 's02', name: 'Sachi House 02' },
    ],
    propertiesError: null,
    reloadProperties: () => {},
  }),
}));

const { default: ReceiptPage } = await import('./ReceiptPage');

const pending = (over: Partial<PendingTransaction>): PendingTransaction => ({
  id: 'p1',
  propertyId: 's01',
  gcsPath: 'gcs://bucket/receipt.jpg',
  receiptUrl: 'https://example.com/receipt.jpg',
  ocrProcessed: true,
  transactionDate: '2026-09-10',
  debitAccount: '消耗品費',
  debitAmount: 1280,
  creditAccount: '現金',
  creditAmount: 1280,
  description: '',
  vendor: 'ローソン',
  createdAt: 1_000,
  updatedAt: 1_000,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  listProperties.mockResolvedValue([
    { id: 's01', name: 'Sachi House 01' },
    { id: 's02', name: 'Sachi House 02' },
  ]);
  listPendingTransactions.mockResolvedValue([]);
});

describe('the receipts screen', () => {
  it('asks for every property the host can see, not just the one picked to upload to', async () => {
    render(<ReceiptPage />);
    // Scoping the list to the upload target would hide the rest of what is
    // waiting, which is the question the list exists to answer.
    await waitFor(() => expect(listPendingTransactions).toHaveBeenCalledWith(['s01', 's02']));
  });

  it('lists what is unapproved, newest first, with its amount and property', async () => {
    listPendingTransactions.mockResolvedValue([
      pending({ id: 'older', vendor: 'セブンイレブン', debitAmount: 430, createdAt: 1_000 }),
      pending({ id: 'newer', vendor: 'ローソン', debitAmount: 1_280, createdAt: 2_000, propertyId: 's02' }),
    ]);

    render(<ReceiptPage />);

    await screen.findByText('ローソン');
    const rows = screen.getAllByRole('button').filter((el) => el.textContent?.includes('¥'));
    expect(rows[0]).toHaveTextContent('ローソン');
    expect(rows[0]).toHaveTextContent('¥1,280');
    // Two properties are in play, so each row has to say which one it is for.
    expect(rows[0]).toHaveTextContent('Sachi House 02');
    expect(rows[1]).toHaveTextContent('セブンイレブン');
  });

  it('separates a receipt still uploading from one read but unapproved, and one not read at all', async () => {
    listPendingTransactions.mockResolvedValue([
      pending({ id: 'a', vendor: 'read', ocrProcessed: true, createdAt: 3_000 }),
      pending({ id: 'b', vendor: 'unread', ocrProcessed: false, debitAmount: 0, createdAt: 2_000 }),
      pending({
        id: 'c',
        vendor: 'uploading',
        ocrProcessed: false,
        debitAmount: 0,
        gcsPath: 'data:image/jpeg;base64,AAAA',
        receiptUrl: 'data:image/jpeg;base64,AAAA',
        createdAt: 1_000,
      }),
    ]);

    render(<ReceiptPage />);

    await screen.findByText('read');
    const rowFor = (vendor: string) => screen.getByText(vendor).closest('button')!;

    // All three are unapproved, but only one of them is waiting on the host:
    // conflating them is what would send someone to a desktop for nothing.
    expect(rowFor('read')).toHaveTextContent('未承認');
    expect(rowFor('unread')).toHaveTextContent('未読取');
    expect(rowFor('uploading')).toHaveTextContent('保存中');
  });

  it('says so plainly when nothing is waiting', async () => {
    render(<ReceiptPage />);
    expect(await screen.findByText('未承認の領収書はありません。')).toBeInTheDocument();
  });
});
