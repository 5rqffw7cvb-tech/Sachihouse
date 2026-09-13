import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Building2, Camera, CheckCircle, ChevronRight, Eye, Images, Loader2, Lock,
  RefreshCw, Upload, X,
} from 'lucide-react';
import { HostCard, HostEmpty, HostScreen } from '../../components/host/HostScreen';
import { useHostContext } from '../../components/host/HostShell';
import { financeApi, FinancialProperty, PendingTransaction } from '../../services/finance';
import { formatMoney } from '../../services/hostApp';
import { hasAccess } from '../../services/permissions';

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
 * It is read-only on purpose — approval writes to the books, and that stays on
 * desktop where the whole journal is visible.
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
                アップロードした領収書は「仕訳帳（未承認）」に入ります。確認と承認はパソコン版で行ってください。
              </span>
              <span className="text-[11px] text-warn/85 leading-snug">
                Review and approve on the desktop version.
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
                  onClick={() => setOpenReceipt(item)}
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
                    <PendingStatus item={item} gaveUp={uploadGaveUp} />
                  </span>
                  <ChevronRight className="h-[18px] w-[18px] shrink-0 text-line-strong" />
                </button>
              ))
            )}
          </HostCard>
        </>
      )}

      {openReceipt && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-brand/60 backdrop-blur-sm"
          onClick={() => setOpenReceipt(null)}
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
                  onClick={() => setOpenReceipt(null)}
                  aria-label="閉じる"
                  className="rounded-control p-1 text-ink-muted active:bg-subtle"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-5 py-4 text-[13px]">
              <dt className="text-ink-muted">物件</dt>
              <dd className="text-ink">{propertyNames.get(openReceipt.propertyId) ?? openReceipt.propertyId}</dd>
              <dt className="text-ink-muted">借方</dt>
              <dd className="text-ink">{openReceipt.debitAccount || '—'}</dd>
              <dt className="text-ink-muted">金額</dt>
              <dd className="font-['Plus_Jakarta_Sans'] font-bold text-ink">
                {openReceipt.debitAmount > 0 ? formatMoney(openReceipt.debitAmount, 'JPY') : '未読取'}
              </dd>
            </dl>

            {/* The photo is the reason to open this at all — a host checking
                that what they shot at the till is legible before someone sits
                down at a desktop to approve it. */}
            {openReceipt.receiptUrl ? (
              <img
                src={openReceipt.receiptUrl}
                alt=""
                className="mx-5 mb-4 max-h-[52dvh] w-[calc(100%-2.5rem)] rounded-control border border-line object-contain"
              />
            ) : (
              <p className="px-5 pb-4 text-[13px] text-ink-muted">画像がまだ保存されていません。</p>
            )}

            <p className="px-5 text-[12px] text-ink-muted leading-relaxed">
              承認はパソコン版の「仕訳帳（未承認）」で行ってください。
            </p>
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
                    内容の確認と承認は、<span className="font-bold">パソコン版の「仕訳帳（未承認）」</span>で行ってください。
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
