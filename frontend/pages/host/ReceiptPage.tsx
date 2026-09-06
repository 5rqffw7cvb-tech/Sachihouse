import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Building2, Camera, CheckCircle, Images, Loader2, Lock, Upload } from 'lucide-react';
import { HostCard, HostScreen } from '../../components/host/HostScreen';
import { useHostContext } from '../../components/host/HostShell';
import { financeApi, FinancialProperty } from '../../services/finance';
import { hasAccess } from '../../services/permissions';

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
 * picker. Approval stays on desktop; nothing here writes to the books.
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

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

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
  };

  if (!canUpload) {
    return (
      <HostScreen title="Upload receipt" subtitle="領収書アップロード">
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
      title="Upload receipt"
      subtitle="領収書アップロード"
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
            className={`flex-1 min-h-[220px] rounded-card border-2 border-dashed bg-surface
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
        </>
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
