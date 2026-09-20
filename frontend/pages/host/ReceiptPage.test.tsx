import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ApiUser } from '../../services/api';
import { PendingTransaction } from '../../services/finance';

const listProperties = vi.fn();
const listPendingTransactions = vi.fn();
const updatePendingTransaction = vi.fn();
const approvePendingTransaction = vi.fn();
const deletePendingTransaction = vi.fn();
vi.mock('../../services/finance', () => ({
  financeApi: {
    listProperties: () => listProperties(),
    listPendingTransactions: (ids: string[]) => listPendingTransactions(ids),
    updatePendingTransaction: (id: string, input: unknown) => updatePendingTransaction(id, input),
    approvePendingTransaction: (id: string, options?: unknown) => approvePendingTransaction(id, options),
    deletePendingTransaction: (id: string) => deletePendingTransaction(id),
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
  updatePendingTransaction.mockImplementation(async (id, input) => ({ ...pending({ id }), ...input }));
  approvePendingTransaction.mockResolvedValue({ id: 'txn-1' });
  deletePendingTransaction.mockResolvedValue(undefined);
});

/** Opens the sheet for the one row on screen. */
async function openOnlyRow() {
  const row = await screen.findByText('ローソン');
  fireEvent.click(row.closest('button')!);
}

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

describe('correcting and approving a receipt on the phone', () => {
  it('saves an edited account without approving anything', async () => {
    listPendingTransactions.mockResolvedValue([pending({ debitAccount: '雑費' })]);
    render(<ReceiptPage />);
    await openOnlyRow();

    fireEvent.change(screen.getByDisplayValue('雑費'), { target: { value: '消耗品費' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(updatePendingTransaction).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ debitAccount: '消耗品費' }),
    ));
    // Saving is its own step: nothing reaches the journal until the host says so.
    expect(approvePendingTransaction).not.toHaveBeenCalled();
  });

  it('keeps the two sides of the entry equal when the amount is typed once', async () => {
    listPendingTransactions.mockResolvedValue([pending({})]);
    render(<ReceiptPage />);
    await openOnlyRow();

    fireEvent.change(screen.getByDisplayValue('1280'), { target: { value: '990' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(updatePendingTransaction).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ debitAmount: 990, creditAmount: 990 }),
    ));
  });

  it('will not offer to approve an entry that does not balance or has no date', async () => {
    listPendingTransactions.mockResolvedValue([pending({ transactionDate: '', ocrProcessed: false })]);
    render(<ReceiptPage />);
    await openOnlyRow();

    // A disabled button with no explanation is what the desktop was criticised
    // for; the reason has to be on screen.
    expect(screen.getByRole('button', { name: '承認' })).toBeDisabled();
    expect(screen.getByText('取引日を入力してください。')).toBeInTheDocument();
  });

  it('saves a date typed in the sheet before approving, without being asked to save', async () => {
    listPendingTransactions.mockResolvedValue([pending({ transactionDate: '' })]);
    render(<ReceiptPage />);
    await openOnlyRow();

    fireEvent.change(screen.getByLabelText('取引日'), { target: { value: '2026-09-18' } });
    // No 保存 tap: the host filled the field in and went straight for 承認,
    // which is what the sheet's own validation told them they could now do.
    fireEvent.click(screen.getByRole('button', { name: '承認' }));

    await waitFor(() => expect(approvePendingTransaction).toHaveBeenCalledWith('p1', { force: false }));
    // The server approves the row it has stored, so the date has to reach it
    // first; otherwise the entry is approved with no date at all.
    expect(updatePendingTransaction).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ transactionDate: '2026-09-18' }),
    );
    expect(updatePendingTransaction.mock.invocationCallOrder[0])
      .toBeLessThan(approvePendingTransaction.mock.invocationCallOrder[0]);
  });

  it('does not approve when the unsaved edit could not be saved, and says why', async () => {
    listPendingTransactions.mockResolvedValue([pending({ transactionDate: '' })]);
    updatePendingTransaction.mockRejectedValueOnce(new Error('保存できませんでした。'));
    render(<ReceiptPage />);
    await openOnlyRow();

    fireEvent.change(screen.getByLabelText('取引日'), { target: { value: '2026-09-18' } });
    fireEvent.click(screen.getByRole('button', { name: '承認' }));

    // Approving on a failed save is the bug in reverse: the journal would get
    // the empty date the host thought they had fixed.
    expect(await screen.findByText('保存できませんでした。')).toBeInTheDocument();
    expect(approvePendingTransaction).not.toHaveBeenCalled();
  });

  it('approves an untouched entry without writing it back first', async () => {
    listPendingTransactions.mockResolvedValue([pending({})]);
    render(<ReceiptPage />);
    await openOnlyRow();

    fireEvent.click(screen.getByRole('button', { name: '承認' }));

    await waitFor(() => expect(approvePendingTransaction).toHaveBeenCalledWith('p1', { force: false }));
    // Nothing on the sheet changed, so there is nothing to save: a blind save
    // would churn updatedAt and re-run the duplicate check for no reason.
    expect(updatePendingTransaction).not.toHaveBeenCalled();
  });

  it('asks the server first, never approving with force on its own', async () => {
    listPendingTransactions.mockResolvedValue([pending({})]);
    render(<ReceiptPage />);
    await openOnlyRow();

    fireEvent.click(screen.getByRole('button', { name: '承認' }));

    await waitFor(() => expect(approvePendingTransaction).toHaveBeenCalledWith('p1', { force: false }));
  });

  it('shows the approved entry it collided with, and only approves once the host agrees', async () => {
    listPendingTransactions.mockResolvedValue([pending({})]);
    approvePendingTransaction.mockRejectedValueOnce(new ApiError('duplicate', 409, {
      error: 'duplicate',
      duplicates: [{
        id: 'txn-9',
        transactionNo: 'T-0042',
        transactionDate: '2026-09-10',
        debitAccount: '消耗品費',
        debitAmount: 1280,
        description: 'ローソン',
      }],
    }));

    render(<ReceiptPage />);
    await openOnlyRow();
    fireEvent.click(screen.getByRole('button', { name: '承認' }));

    // The host has to be able to recognise the entry, so it is named, not counted.
    expect(await screen.findByText('承認済みの仕訳と重複しています')).toBeInTheDocument();
    expect(screen.getByText(/T-0042/)).toBeInTheDocument();

    approvePendingTransaction.mockResolvedValueOnce({ id: 'txn-10' });
    fireEvent.click(screen.getByRole('button', { name: '別の領収書として承認' }));

    await waitFor(() => expect(approvePendingTransaction).toHaveBeenLastCalledWith('p1', { force: true }));
  });

  it('will not force-approve an entry the host has just emptied the date out of', async () => {
    listPendingTransactions.mockResolvedValue([pending({})]);
    approvePendingTransaction.mockRejectedValueOnce(new ApiError('duplicate', 409, {
      duplicates: [{
        id: 'txn-9',
        transactionNo: 'T-0042',
        transactionDate: '2026-09-10',
        debitAccount: '消耗品費',
        debitAmount: 1280,
        description: 'ローソン',
      }],
    }));

    render(<ReceiptPage />);
    await openOnlyRow();
    fireEvent.click(screen.getByRole('button', { name: '承認' }));
    await screen.findByText('承認済みの仕訳と重複しています');

    // Clearing the field while the prompt is up is how the OCR's date got
    // wiped: forcing saves the sheet first, so an empty box would be written
    // over a date the server had already read correctly.
    fireEvent.change(screen.getByLabelText('取引日'), { target: { value: '' } });
    const force = screen.getByRole('button', { name: '別の領収書として承認' });
    expect(force).toBeDisabled();

    fireEvent.click(force);
    expect(updatePendingTransaction).not.toHaveBeenCalled();
    expect(approvePendingTransaction).toHaveBeenCalledTimes(1);
  });

  it('still forces through a corrected date, saving it on the way', async () => {
    listPendingTransactions.mockResolvedValue([pending({})]);
    approvePendingTransaction.mockRejectedValueOnce(new ApiError('duplicate', 409, {
      duplicates: [{
        id: 'txn-9',
        transactionNo: 'T-0042',
        transactionDate: '2026-09-10',
        debitAccount: '消耗品費',
        debitAmount: 1280,
        description: 'ローソン',
      }],
    }));

    render(<ReceiptPage />);
    await openOnlyRow();
    fireEvent.click(screen.getByRole('button', { name: '承認' }));
    await screen.findByText('承認済みの仕訳と重複しています');

    // Guarding the button must not cost the host the way out of the prompt:
    // a filled-in date is still theirs to force through.
    fireEvent.change(screen.getByLabelText('取引日'), { target: { value: '2026-09-11' } });
    const force = screen.getByRole('button', { name: '別の領収書として承認' });
    expect(force).not.toBeDisabled();

    approvePendingTransaction.mockResolvedValueOnce({ id: 'txn-10' });
    fireEvent.click(force);

    await waitFor(() => expect(approvePendingTransaction).toHaveBeenLastCalledWith('p1', { force: true }));
    expect(updatePendingTransaction).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ transactionDate: '2026-09-11' }),
    );
  });

  it('backs out of the duplicate prompt without writing anything', async () => {
    listPendingTransactions.mockResolvedValue([pending({})]);
    approvePendingTransaction.mockRejectedValueOnce(new ApiError('duplicate', 409, {
      duplicates: [{
        id: 'txn-9',
        transactionNo: 'T-0042',
        transactionDate: '2026-09-10',
        debitAccount: '消耗品費',
        debitAmount: 1280,
        description: 'ローソン',
      }],
    }));

    render(<ReceiptPage />);
    await openOnlyRow();
    fireEvent.click(screen.getByRole('button', { name: '承認' }));
    fireEvent.click(await screen.findByRole('button', { name: 'やめる' }));

    expect(screen.queryByText('承認済みの仕訳と重複しています')).not.toBeInTheDocument();
    expect(approvePendingTransaction).toHaveBeenCalledTimes(1);
  });

  it('throws a receipt away only after asking, and says the image goes too', async () => {
    listPendingTransactions.mockResolvedValue([pending({})]);
    render(<ReceiptPage />);
    await openOnlyRow();

    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    // Deleting drops the photo from storage with the row and cannot be undone,
    // so the confirmation has to say that rather than let the host find out.
    expect(screen.getByText(/画像も一緒に削除され、元に戻せません/)).toBeInTheDocument();
    expect(deletePendingTransaction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '削除する' }));
    await waitFor(() => expect(deletePendingTransaction).toHaveBeenCalledWith('p1'));
  });

  it('backs out of the delete prompt without deleting', async () => {
    listPendingTransactions.mockResolvedValue([pending({})]);
    render(<ReceiptPage />);
    await openOnlyRow();

    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));

    expect(deletePendingTransaction).not.toHaveBeenCalled();
    // And the sheet comes back the way it was, not closed out from under them.
    expect(screen.getByRole('button', { name: '承認' })).toBeInTheDocument();
  });

  it('warns on the row itself when the list already knows about a duplicate', async () => {
    listPendingTransactions.mockResolvedValue([pending({
      approvedDuplicates: [{
        id: 'txn-9',
        transactionNo: 'T-0042',
        transactionDate: '2026-09-10',
        debitAccount: '消耗品費',
        debitAmount: 1280,
        description: 'ローソン',
      }],
    })]);

    render(<ReceiptPage />);
    // Known before anything is tapped: the host is standing there with the
    // paper, which is the moment the warning is worth something.
    expect(await screen.findByText('重複?')).toBeInTheDocument();
  });
});
