import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, AlertTriangle, Building2, Camera, Check, CheckCircle, ChevronRight, Copy, Eye,
  Images, Loader2, Lock, RefreshCw, Save, Upload, X,
} from 'lucide-react';
import { HostCard, HostEmpty, HostScreen } from '../../components/host/HostScreen';
import { useHostContext } from '../../components/host/HostShell';
import { ApiError } from '../../services/api';
import {
  ApprovedDuplicate, financeApi, FinancialProperty, PendingTransaction,
} from '../../services/finance';
import { formatMoney } from '../../services/hostApp';
import { hasAccess } from '../../services/permissions';
import { ACCOUNT_GROUPS } from '../../utils/accountingUtils';

/** An item whose receipt is still a data URI has not finished its background
 *  upload to storage yet — the same test the desktop journal makes. */
const isInlineImage = (item: PendingTransaction): boolean =>
  (item.receiptUrl || item.gcsPath || '').startsWith('data:');

/** How long to keep polling for a receipt to reach storage before letting it
 *  show as unapproved anyway. The inline image is a valid receipt either way,
 *  so a permanently failed upload must not leave a row reading 保存中 forever. */
const UPLOAD_POLL_TIMEOUT_MS = 45_000;

/**
 * The three states a receipt passes through before it can be approved.
 *
 * Deliberately the same words and the same order as the desktop journal's
 * 状態 column: a host reading 保存中 here and 保存中 there must be reading
 * about the same thing.
 */
const PendingStatus: React.FC<{ item: PendingTransaction; gaveUp: boolean }> = ({ item, gaveUp }) => {
  if (!gaveUp && isInlineImage(item)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-info-tint px-1.5 py-0.5 text-[10px] font-bold text-info">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />保存中
      </span>
    );
  }
  if (!item.ocrProcessed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-subtle px-1.5 py-0.5 text-[10px] font-bold text-ink-muted">
        <Eye className="h-2.5 w-2.5" />未読取
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warn-tint px-1.5 py-0.5 text-[10px] font-bold text-warn">
      <AlertCircle className="h-2.5 w-2.5" />未承認
    </span>
  );
};

/** What the OCR made of a receipt, or a plain dash — never a guess, and never
 *  a blank cell the host has to interpret. */
const summaryOf = (item: PendingTransaction): string =>
  item.vendor?.trim() || item.description?.trim() || '(摘要なし)';

/** The same chart of accounts the desktop journal offers, from the one list
 *  both screens are built from. An account the OCR guessed that is not in it
 *  is kept as an option of its own rather than silently dropped. */
const AccountSelect: React.FC<{
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const known = ACCOUNT_GROUPS.some((group) => group.accounts.includes(value));
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="h-[46px] w-full rounded-control border border-line bg-subtle px-2.5 text-[15px] text-ink
        focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:opacity-60"
    >
      <option value="">—</option>
      {value && !known && <option value={value}>{value}</option>}
      {ACCOUNT_GROUPS.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.accounts.map((account) => <option key={account} value={account}>{account}</option>)}
        </optgroup>
      ))}
    </select>
  );
};

/**
 * The approved entries this receipt looks like a second copy of.
 *
 * It shows them rather than asserting anything. Two ¥500 coffees on one
 * afternoon are a real pair of receipts, and the only person who can tell that
 * from the same receipt twice is the one holding the paper — so the job here is
 * to put the journal entry in front of them, not to decide.
 *
 * `notice` is the list volunteering it on open; `blocking` is the server having
 * refused an approval over it, which is a question that needs an answer.
 */
const DuplicatePanel: React.FC<{ duplicates: ApprovedDuplicate[]; tone: 'notice' | 'blocking' }> = ({
  duplicates, tone,
}) => (
  <div
    className={`mx-5 mt-4 rounded-control border px-3.5 py-3 ${
      tone === 'blocking' ? 'border-danger/25 bg-danger-tint' : 'border-warn/25 bg-warn-tint'
    }`}
  >
    <div className={`flex items-center gap-1.5 ${tone === 'blocking' ? 'text-danger' : 'text-warn'}`}>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="text-[12px] font-bold">
        {tone === 'blocking' ? '承認済みの仕訳と重複しています' : '承認済みに同じ内容があります'}
      </span>
    </div>
    <ul className="mt-2 flex flex-col gap-1.5">
      {duplicates.map((row) => (
        <li key={row.id} className="flex items-baseline justify-between gap-2 text-[12px] text-ink-soft">
          <span className="min-w-0 truncate">
            {[row.transactionNo || '—', row.transactionDate, row.debitAccount, row.description]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span className="shrink-0 font-['Plus_Jakarta_Sans'] font-bold text-ink">
            {formatMoney(row.debitAmount, 'JPY')}
          </span>
        </li>
      ))}
    </ul>
    <p className="mt-2 text-[11px] leading-snug text-ink-muted">
      同じ物件・日付・金額です。別の領収書であれば、そのまま承認できます。
    </p>
  </div>
);

/** What the host is editing before they approve. Held apart from the row it
 *  came from so abandoning the sheet changes nothing. */
type Draft = Pick<
  PendingTransaction,
  'transactionDate' | 'vendor' | 'debitAccount' | 'debitAmount' | 'creditAccount' | 'creditAmount' | 'description'
>;

const draftOf = (item: PendingTransaction): Draft => ({
  transactionDate: item.transactionDate || '',
  vendor: item.vendor || '',
  debitAccount: item.debitAccount || '',
  debitAmount: item.debitAmount || 0,
  creditAccount: item.creditAccount || '',
  creditAmount: item.creditAmount || 0,
  description: item.description || '',
});

/** A journal entry can only be approved once it balances and says what it is
 *  for. The desktop refuses the same three things; saying which one is missing
 *  beats a disabled button with no explanation. */
function whyNotApprovable(draft: Draft): string | null {
  if (!draft.transactionDate) return '取引日を入力してください。';
  if (!draft.debitAccount || !draft.creditAccount) return '勘定科目を選択してください。';
  if (!draft.debitAmount || draft.debitAmount <= 0) return '金額を入力してください。';
  if (draft.debitAmount !== draft.creditAmount) return '借方と貸方の金額が一致していません。';
  return null;
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });

/**
 * The phone half of 領収書アップロード.
 *
 * Same pipeline as the desktop page — one /finance/pending/upload-single per
 * image, OCR and compression server-side, landing in the unapproved journal.
 * What changes is the way in: a phone has a camera, so shooting a receipt at
 * the till is a first-class action rather than something hidden inside a file
 * picker.
 *
 * Below the upload controls is everything still unapproved. A success dialog
 * only says the request was accepted; the list is where a host standing at the
 * till can see the receipt actually arrived, and what else is still waiting.
 *
 * A row opens for correction and approval. OCR gets the shop right and the
 * account wrong often enough that sending someone to a desktop to fix one field
 * is what left receipts unapproved for weeks. Before anything reaches the
 * journal the server checks it against what is already approved — same
 * property, same date, same amount — because the way a receipt gets paid for
 * twice is not two uploads in one sitting but one approved copy and a second
 * photograph a month later, by which time no pending row remembers the first.
 */
const ReceiptPage: React.FC = () => {
  const { user } = useHostContext();
  const canUpload = hasAccess(user, 'finance');

  const [properties, setProperties] = useState<FinancialProperty[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ success: number; failed: number; errorMsg?: string } | null>(null);

  const [pending, setPending] = useState<PendingTransaction[]>([]);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [openReceipt, setOpenReceipt] = useState<PendingTransaction | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sheetBusy, setSheetBusy] = useState<'saving' | 'approving' | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  // Duplicates the server refused an approval over, as opposed to the ones it
  // volunteered on the list. Set means the host has been asked and has not
  // answered yet.
  const [blockingDuplicates, setBlockingDuplicates] = useState<ApprovedDuplicate[] | null>(null);
  const [uploadGaveUp, setUploadGaveUp] = useState(false);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const pollStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!canUpload) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;

    financeApi.listProperties()
      .then((rows) => {
        if (cancelled) return;
        setProperties(rows);
        // Auto-select when the host manages exactly one — same as the desktop page.
        if (rows.length === 1) setPropertyId(rows[0].id);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Could not load your properties.');
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, [canUpload]);

  const propertyNames = useMemo(
    () => new Map(properties.map((property) => [property.id, property.name])),
    [properties],
  );

  /**
   * Everything still waiting, across every property the host can see.
   *
   * Not scoped to the property picked above: the question this list answers is
   * "what have I sent that is still unapproved", and a host who has just shot
   * a receipt for one building should not have to re-pick it to see the rest.
   */
  const loadPending = useCallback(async () => {
    if (properties.length === 0) return;
    try {
      const rows = await financeApi.listPendingTransactions(properties.map((p) => p.id));
      // Newest first: what was just uploaded is what the host is looking for.
      setPending([...rows].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)));
      setPendingError(null);
    } catch (cause) {
      setPendingError(cause instanceof Error ? cause.message : '未承認の一覧を取得できませんでした。');
    } finally {
      setPendingLoading(false);
    }
  }, [properties]);

  useEffect(() => {
    if (!canUpload) { setPendingLoading(false); return; }
    if (properties.length === 0) return;
    void loadPending();
  }, [canUpload, properties.length, loadPending]);

  // A freshly uploaded receipt reaches storage a moment after the request
  // returns, so poll while any row is still inline — otherwise the row the
  // host just created would sit at 保存中 until they reopened the screen.
  useEffect(() => {
    if (progress !== null) { pollStartRef.current = null; return; }
    if (!pending.some(isInlineImage)) {
      pollStartRef.current = null;
      setUploadGaveUp(false);
      return;
    }
    if (pollStartRef.current === null) pollStartRef.current = Date.now();
    if (Date.now() - pollStartRef.current > UPLOAD_POLL_TIMEOUT_MS) {
      setUploadGaveUp(true);
      return;
    }
    const timer = window.setInterval(() => { void loadPending(); }, 2000);
    return () => window.clearInterval(timer);
  }, [pending, progress, loadPending]);

  const openSheet = (item: PendingTransaction) => {
    setOpenReceipt(item);
    setDraft(draftOf(item));
    setSheetError(null);
    setBlockingDuplicates(null);
  };

  const closeSheet = () => {
    setOpenReceipt(null);
    setDraft(null);
    setSheetError(null);
    setBlockingDuplicates(null);
  };

  /** Saving is its own step, exactly as on desktop: the host corrects what the
   *  OCR misread, sees it stick, and only then decides to approve. */
  const saveDraft = async () => {
    if (!openReceipt || !draft) return;
    setSheetBusy('saving');
    setSheetError(null);
    try {
      const saved = await financeApi.updatePendingTransaction(openReceipt.id, draft);
      // Keep the duplicate verdict from the list: the update response is the
      // bare row, and dropping it would silently retract a warning the host
      // can still see a second ago.
      setOpenReceipt({ ...saved, approvedDuplicates: openReceipt.approvedDuplicates });
      setDraft(draftOf(saved));
      // Editing the date or the amount changes the answer, so ask again.
      setBlockingDuplicates(null);
      void loadPending();
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : '保存できませんでした。');
    } finally {
      setSheetBusy(null);
    }
  };

  /**
   * Approve, or come back with what it collided with.
   *
   * `force` is only ever set by the host answering the duplicate prompt — the
   * first attempt always asks the server, so an approval can never slip
   * through by this screen forgetting to check.
   */
  const approve = async (force: boolean) => {
    if (!openReceipt) return;
    setSheetBusy('approving');
    setSheetError(null);
    try {
      await financeApi.approvePendingTransaction(openReceipt.id, { force });
      closeSheet();
      void loadPending();
    } catch (cause) {
      const duplicates = cause instanceof ApiError && cause.status === 409
        ? (cause.body as { duplicates?: ApprovedDuplicate[] } | undefined)?.duplicates
        : undefined;
      if (duplicates?.length) {
        setBlockingDuplicates(duplicates);
      } else {
        setSheetError(cause instanceof Error ? cause.message : '承認できませんでした。');
      }
    } finally {
      setSheetBusy(null);
    }
  };

  const isProcessing = progress !== null;

  const handleFiles = async (files: FileList | null) => {
    if (!propertyId || !files || files.length === 0) return;

    const fileArray = Array.from(files);
    setResult(null);
    setProgress({ done: 0, total: fileArray.length });

    let success = 0;
    let failed = 0;
    let errorMsg: string | undefined;

    for (let index = 0; index < fileArray.length; index += 1) {
      try {
        const base64 = await fileToBase64(fileArray[index]);
        await financeApi.uploadSingleReceipt(propertyId, base64);
        success += 1;
      } catch (cause) {
        console.error('Receipt upload failed:', cause);
        failed += 1;
        if (!errorMsg) errorMsg = cause instanceof Error ? cause.message : String(cause);
      }
      setProgress({ done: index + 1, total: fileArray.length });
    }

    setProgress(null);
    setResult({ success, failed, errorMsg });
    // The point of the list below is to show that the upload landed.
    if (success > 0) void loadPending();
  };

  if (!canUpload) {
    return (
      <HostScreen title="Receipts" subtitle="領収書">
        <HostCard>
          <div className="flex flex-col items-center text-center gap-3 px-6 py-12">
            <div className="w-11 h-11 rounded-full bg-subtle flex items-center justify-center">
              <Lock className="w-5 h-5 text-ink-muted" />
            </div>
            <p className="text-[15px] font-semibold text-ink">権限がありません</p>
            <p className="text-[13px] text-ink-muted">
              領収書のアップロードは管理者とホストレベル4のみ利用できます。
            </p>
          </div>
        </HostCard>
      </HostScreen>
    );
  }

  return (
    <HostScreen
      title="Receipts"
      subtitle="領収書"
      isLoading={isLoading}
      error={error}
    >
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(event) => { void handleFiles(event.target.files); event.target.value = ''; }}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(event) => { void handleFiles(event.target.files); event.target.value = ''; }}
      />

      {properties.length === 0 ? (
        <HostCard padded>
          <p className="text-center text-[14px] text-ink-soft py-6">利用できる物件がありません。</p>
        </HostCard>
      ) : (
        <>
          <HostCard padded>
            <span className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-ink-soft">
              <Building2 className="w-3.5 h-3.5 text-link" />
              物件を選択 (Property)
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
                disabled={isProcessing}
                className="mt-2 w-full h-[50px] px-3 rounded-control bg-subtle border border-line
                  text-[16px] font-bold text-ink focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15
                  disabled:opacity-60"
              >
                <option value="">-- 物件を選択してください --</option>
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>{property.name}</option>
                ))}
              </select>
            )}
          </HostCard>

          <button
            type="button"
            onClick={() => libraryInputRef.current?.click()}
            disabled={!propertyId || isProcessing}
            className={`shrink-0 min-h-[200px] rounded-card border-2 border-dashed bg-surface
              flex flex-col items-center justify-center gap-4 px-6 text-center transition-colors ${
                !propertyId || isProcessing ? 'border-line-strong opacity-70' : 'border-blue-300'
              }`}
          >
            <span className="w-16 h-16 rounded-card bg-blue-50 border border-blue-100 flex items-center justify-center">
              {isProcessing
                ? <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                : <Upload className="w-8 h-8 text-blue-600" />}
            </span>
            <span className="flex flex-col gap-1.5">
              <span className="font-['Plus_Jakarta_Sans'] text-[17px] font-bold text-ink">
                {isProcessing ? 'AIが読み取り中...' : '領収書を選択'}
              </span>
              <span className="text-[13px] text-ink-muted leading-snug">
                {isProcessing
                  ? `${progress.done}/${progress.total} 件 処理中`
                  : propertyId
                    ? 'タップして複数の画像を選択できます\nAIが自動で読み取ります'
                        .split('\n')
                        .map((line, index) => <span key={index} className="block">{line}</span>)
                    : 'まず物件を選択してください'}
              </span>
            </span>
            {isProcessing && (
              <span className="w-full max-w-[240px] h-2 bg-page rounded-full overflow-hidden">
                <span
                  className="block h-full bg-blue-600 transition-all"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </span>
            )}
          </button>

          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              disabled={!propertyId || isProcessing}
              className="flex-1 h-13 min-h-[52px] rounded-control bg-brand text-white flex items-center justify-center gap-2
                disabled:opacity-50"
            >
              <Camera className="w-[19px] h-[19px]" />
              <span className="font-['Plus_Jakarta_Sans'] text-[15px] font-bold">撮影</span>
            </button>
            <button
              type="button"
              onClick={() => libraryInputRef.current?.click()}
              disabled={!propertyId || isProcessing}
              className="flex-1 h-13 min-h-[52px] rounded-control bg-surface border border-line-strong text-ink
                flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Images className="w-[19px] h-[19px]" />
              <span className="font-['Plus_Jakarta_Sans'] text-[15px] font-bold">写真から</span>
            </button>
          </div>

          <div className="flex items-start gap-2.5 bg-warn-tint border border-warn/20 rounded-card px-4 py-3.5">
            <AlertCircle className="w-4 h-4 text-warn shrink-0 mt-1" />
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <span className="text-[12px] text-warn leading-relaxed">
                アップロードした領収書は「仕訳帳（未承認）」に入ります。下の一覧で内容を直して承認できます。
              </span>
              <span className="text-[11px] text-warn/85 leading-snug">
                Correct and approve below, or leave it for the desktop journal.
              </span>
            </div>
          </div>

          {/* What is still waiting. The screen above only says an upload was
              accepted; this is where the host can see it actually arrived,
              and what else has not been approved yet. */}
          <HostCard
            title={(
              <h2 className="flex items-center gap-2 text-[16px] truncate">
                未承認
                <span className="rounded-full bg-warn-tint px-2 py-0.5 text-[12px] font-bold text-warn">
                  {pending.length}
                </span>
              </h2>
            )}
            action={(
              <button
                type="button"
                onClick={() => { void loadPending(); }}
                disabled={pendingLoading}
                aria-label="再読み込み"
                className="rounded-control p-1.5 text-ink-soft active:bg-subtle disabled:opacity-50"
              >
                <RefreshCw className={`h-[17px] w-[17px] ${pendingLoading ? 'animate-spin' : ''}`} />
              </button>
            )}
          >
            {pendingError ? (
              <p className="px-4 py-5 text-[13px] text-danger">{pendingError}</p>
            ) : pendingLoading && pending.length === 0 ? (
              <div className="flex justify-center py-8 text-ink-muted">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : pending.length === 0 ? (
              <HostEmpty>未承認の領収書はありません。</HostEmpty>
            ) : (
              pending.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => openSheet(item)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left active:bg-subtle ${
                    index === pending.length - 1 ? '' : 'border-b border-line'
                  }`}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[15px] font-semibold text-ink">{summaryOf(item)}</span>
                    <span className="truncate text-[12px] text-ink-muted">
                      {[
                        item.transactionDate || '日付なし',
                        properties.length > 1 ? propertyNames.get(item.propertyId) ?? item.propertyId : null,
                        item.debitAccount || null,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-['Plus_Jakarta_Sans'] text-[15px] font-bold text-ink">
                      {item.debitAmount > 0 ? formatMoney(item.debitAmount, 'JPY') : '—'}
                    </span>
                    <span className="flex items-center gap-1">
                      {(item.approvedDuplicates?.length ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-danger-tint px-1.5 py-0.5 text-[10px] font-bold text-danger">
                          <Copy className="h-2.5 w-2.5" />重複?
                        </span>
                      )}
                      <PendingStatus item={item} gaveUp={uploadGaveUp} />
                    </span>
                  </span>
                  <ChevronRight className="h-[18px] w-[18px] shrink-0 text-line-strong" />
                </button>
              ))
            )}
          </HostCard>
        </>
      )}

      {openReceipt && draft && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-brand/60 backdrop-blur-sm"
          onClick={closeSheet}
          role="presentation"
        >
          <div
            className="max-h-[88dvh] w-full overflow-y-auto rounded-t-[24px] bg-surface"
            style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="未承認の領収書"
          >
            <div className="sticky top-0 bg-surface pt-2.5">
              <div className="mx-auto h-1 w-10 rounded-full bg-line-strong" />
              <div className="flex items-start justify-between gap-3 border-b border-line px-5 pb-3.5 pt-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[17px]">{summaryOf(openReceipt)}</h2>
                  <div className="mt-1 flex items-center gap-2">
                    <PendingStatus item={openReceipt} gaveUp={uploadGaveUp} />
                    <span className="text-[12px] text-ink-muted">
                      {openReceipt.transactionDate || '日付なし'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeSheet}
                  aria-label="閉じる"
                  className="rounded-control p-1 text-ink-muted active:bg-subtle"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Volunteered on opening: the host has not asked to approve yet,
                but this is the moment to know, while the paper is in hand. */}
            {(openReceipt.approvedDuplicates?.length ?? 0) > 0 && !blockingDuplicates && (
              <DuplicatePanel duplicates={openReceipt.approvedDuplicates!} tone="notice" />
            )}

            <div className="grid grid-cols-2 gap-3 px-5 py-4">
              <label className="col-span-2 flex flex-col gap-1">
                <span className="text-[11px] font-bold text-ink-soft">物件</span>
                <span className="flex h-[46px] items-center rounded-control border border-line bg-subtle px-2.5 text-[15px] text-ink-soft">
                  {propertyNames.get(openReceipt.propertyId) ?? openReceipt.propertyId}
                </span>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold text-ink-soft">取引日</span>
                <input
                  type="date"
                  value={draft.transactionDate}
                  disabled={sheetBusy !== null}
                  onChange={(event) => setDraft({ ...draft, transactionDate: event.target.value })}
                  className="h-[46px] w-full rounded-control border border-line bg-subtle px-2.5 text-[15px] text-ink
                    focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:opacity-60"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold text-ink-soft">金額 (円)</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={draft.debitAmount || ''}
                  disabled={sheetBusy !== null}
                  onChange={(event) => {
                    // A receipt is one entry with two equal sides, so the amount
                    // is typed once — the desktop form mirrors it the same way.
                    const amount = Number.parseInt(event.target.value, 10) || 0;
                    setDraft({ ...draft, debitAmount: amount, creditAmount: amount });
                  }}
                  className="h-[46px] w-full rounded-control border border-line bg-subtle px-2.5 text-right
                    font-['Plus_Jakarta_Sans'] text-[15px] font-bold text-ink
                    focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:opacity-60"
                />
              </label>

              <label className="col-span-2 flex flex-col gap-1">
                <span className="text-[11px] font-bold text-ink-soft">Vendor</span>
                <input
                  value={draft.vendor ?? ''}
                  disabled={sheetBusy !== null}
                  placeholder="店名"
                  onChange={(event) => setDraft({ ...draft, vendor: event.target.value })}
                  className="h-[46px] w-full rounded-control border border-line bg-subtle px-2.5 text-[15px] text-ink
                    focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:opacity-60"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold text-ink-soft">借方勘定科目</span>
                <AccountSelect
                  value={draft.debitAccount}
                  disabled={sheetBusy !== null}
                  onChange={(value) => setDraft({ ...draft, debitAccount: value })}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold text-ink-soft">貸方勘定科目</span>
                <AccountSelect
                  value={draft.creditAccount}
                  disabled={sheetBusy !== null}
                  onChange={(value) => setDraft({ ...draft, creditAccount: value })}
                />
              </label>

              <label className="col-span-2 flex flex-col gap-1">
                <span className="text-[11px] font-bold text-ink-soft">摘要</span>
                <input
                  value={draft.description}
                  disabled={sheetBusy !== null}
                  placeholder="摘要を入力"
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  className="h-[46px] w-full rounded-control border border-line bg-subtle px-2.5 text-[15px] text-ink
                    focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15 disabled:opacity-60"
                />
              </label>
            </div>

            {/* The photo is why this sheet exists at all — the host is reading
                the paper to correct what the OCR made of it. */}
            {openReceipt.receiptUrl ? (
              <img
                src={openReceipt.receiptUrl}
                alt=""
                className="mx-5 mb-4 max-h-[46dvh] w-[calc(100%-2.5rem)] rounded-control border border-line object-contain"
              />
            ) : (
              <p className="px-5 pb-4 text-[13px] text-ink-muted">画像がまだ保存されていません。</p>
            )}

            {/* The server refused. This is the host being asked a question, so
                it takes the place of the buttons rather than sitting above them. */}
            {blockingDuplicates && (
              <>
                <DuplicatePanel duplicates={blockingDuplicates} tone="blocking" />
                <div className="flex gap-2.5 px-5 pt-1">
                  <button
                    type="button"
                    onClick={() => setBlockingDuplicates(null)}
                    className="h-[52px] flex-1 rounded-control border border-line-strong bg-surface text-[15px] font-bold text-ink active:bg-subtle"
                  >
                    やめる
                  </button>
                  <button
                    type="button"
                    onClick={() => { void approve(true); }}
                    disabled={sheetBusy !== null}
                    className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-control bg-danger text-[15px] font-bold text-white disabled:opacity-50"
                  >
                    {sheetBusy === 'approving' ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : null}
                    別の領収書として承認
                  </button>
                </div>
              </>
            )}

            {sheetError && (
              <p className="mx-5 mb-1 rounded-control bg-danger-tint px-3 py-2 text-[12px] text-danger">{sheetError}</p>
            )}
            {!blockingDuplicates && whyNotApprovable(draft) && (
              <p className="px-5 pb-1 text-[12px] text-ink-muted">{whyNotApprovable(draft)}</p>
            )}

            {!blockingDuplicates && (
              <div className="flex gap-2.5 px-5 pt-1">
                <button
                  type="button"
                  onClick={() => { void saveDraft(); }}
                  disabled={sheetBusy !== null}
                  className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-control border border-line-strong bg-surface text-[15px] font-bold text-ink active:bg-subtle disabled:opacity-50"
                >
                  {sheetBusy === 'saving'
                    ? <Loader2 className="h-[18px] w-[18px] animate-spin" />
                    : <Save className="h-[18px] w-[18px]" />}
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => { void approve(false); }}
                  disabled={sheetBusy !== null || whyNotApprovable(draft) !== null}
                  className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-control bg-ok text-[15px] font-bold text-white disabled:opacity-50"
                >
                  {sheetBusy === 'approving'
                    ? <Loader2 className="h-[18px] w-[18px] animate-spin" />
                    : <Check className="h-[18px] w-[18px]" />}
                  承認
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-brand/60 backdrop-blur-sm">
          <div className="bg-surface rounded-card shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-7 text-center">
              <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-ok-tint text-ok flex items-center justify-center">
                <CheckCircle className="w-9 h-9" />
              </div>
              <h2 className="text-[20px] mb-1">処理が完了しました</h2>
              <p className="text-[14px] text-ink-soft">
                {result.success} 件の領収書を処理しました。
                {result.failed > 0 && (
                  <span className="block text-danger font-bold mt-1">{result.failed} 件は失敗しました。</span>
                )}
                {result.errorMsg && (
                  <span className="block text-[12px] text-danger mt-2 break-words">{result.errorMsg}</span>
                )}
              </p>
              {result.success > 0 && (
                <div className="mt-4 text-left bg-warn-tint border border-warn/20 rounded-control p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
                  <p className="text-[12px] text-warn leading-relaxed">
                    下の<span className="font-bold">「未承認」</span>から内容を確認し、そのまま承認できます。
                  </p>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="w-full py-4 border-t border-line text-[14px] font-bold text-link active:bg-subtle"
            >
              閉じる (Close)
            </button>
          </div>
        </div>
      )}
    </HostScreen>
  );
};

export default ReceiptPage;
