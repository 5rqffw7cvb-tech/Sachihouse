import React, { useEffect, useRef, useState } from 'react';
import { Upload, Loader2, CheckCircle, Building, AlertCircle, X } from 'lucide-react';
import { AdminShell } from '../components/AdminShell';
import { getCurrentUser, subscribeToAuth } from '../services/auth';
import { financeApi, FinancialProperty } from '../services/finance';

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });

const UploadReceiptPage: React.FC = () => {
  const [authUser, setAuthUser] = useState(getCurrentUser());
  const [properties, setProperties] = useState<FinancialProperty[]>([]);
  const [isLoadingProps, setIsLoadingProps] = useState(true);
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ success: number; failed: number; errorMsg?: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Receipt upload feeds the finance module — admins and host level 4 only.
  const canAccess = authUser?.role === 'ADMIN' || (authUser?.role === 'HOST' && (authUser?.hostLevel ?? 0) >= 4);

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => setAuthUser(user)).then((unsub) => { unsubscribe = unsub; });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!canAccess) {
      setIsLoadingProps(false);
      return;
    }
    let cancelled = false;
    setIsLoadingProps(true);
    financeApi.listProperties()
      .then((props) => {
        if (cancelled) return;
        setProperties(props);
        // Auto-select when the host manages exactly one property.
        if (props.length === 1) setSelectedPropertyId(props[0].id);
      })
      .catch(() => { /* ignore */ })
      .finally(() => { if (!cancelled) setIsLoadingProps(false); });
    return () => { cancelled = true; };
  }, [canAccess]);

  const selectedProperty = properties.find((p) => p.id === selectedPropertyId);

  const handleFiles = async (files: FileList) => {
    if (!selectedPropertyId || files.length === 0) return;
    const fileArray = Array.from(files);
    setResult(null);
    setProgress({ done: 0, total: fileArray.length });

    let success = 0;
    let failed = 0;
    let errorMsg: string | undefined;
    for (let i = 0; i < fileArray.length; i++) {
      try {
        const base64 = await fileToBase64(fileArray[i]);
        // Same processing as desktop: OCR → compress → GCS → create pending record.
        await financeApi.uploadSingleReceipt(selectedPropertyId, base64);
        success++;
      } catch (err) {
        console.error('Receipt upload failed:', err);
        failed++;
        if (!errorMsg) errorMsg = err instanceof Error ? err.message : String(err);
      }
      setProgress({ done: i + 1, total: fileArray.length });
    }

    setProgress(null);
    setResult({ success, failed, errorMsg });
  };

  const isProcessing = progress !== null;

  return (
    <AdminShell
      title="領収書アップロード"
      access="finance"
      activeKey="receipts"
      maxWidthClass="max-w-xl"
      navTitleOverride="Upload Receipt"
      signInTitle="ログインが必要です"
      signInMessage="領収書をアップロードするにはログインしてください。"
      deniedTitle="権限がありません"
      deniedMessage="この機能はホストまたは管理者のみ利用できます。"
    >
        {isLoadingProps ? (
          <div className="bg-surface border border-line rounded-card p-10 flex justify-center text-ink-muted shadow-sm">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : properties.length === 0 ? (
          <div className="bg-surface border border-line rounded-card p-8 text-center text-ink-soft shadow-sm">
            利用できる物件がありません。
          </div>
        ) : (
          <div className="space-y-4">
            {/* Property selection */}
            <div className="bg-surface border border-line rounded-card p-4 shadow-sm">
              <label className="flex items-center gap-1.5 text-xs font-bold text-ink-soft uppercase tracking-wider mb-2">
                <Building className="w-3.5 h-3.5 text-blue-700" />
                物件を選択 (Property)
              </label>
              {properties.length === 1 ? (
                <div className="w-full px-4 py-3 rounded-control bg-subtle border border-line text-sm font-bold text-ink">
                  {properties[0].name}
                </div>
              ) : (
                <select
                  value={selectedPropertyId}
                  onChange={(e) => setSelectedPropertyId(e.target.value)}
                  disabled={isProcessing}
                  className="w-full px-4 py-3 rounded-control bg-surface border border-line-strong text-sm font-bold text-ink outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                >
                  <option value="">-- 物件を選択してください --</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Upload zone */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!selectedPropertyId || isProcessing}
              className={`w-full rounded-card border-2 border-dashed p-10 flex flex-col items-center gap-4 text-center transition-colors ${
                !selectedPropertyId || isProcessing
                  ? 'border-line-strong bg-surface/60 cursor-not-allowed opacity-70'
                  : 'border-blue-300 bg-surface hover:bg-blue-50/40'
              }`}
            >
              <div className="w-16 h-16 rounded-card bg-blue-50 border border-blue-100 flex items-center justify-center">
                {isProcessing ? <Loader2 className="w-8 h-8 text-blue-600 animate-spin" /> : <Upload className="w-8 h-8 text-blue-600" />}
              </div>
              <div>
                <p className="font-bold text-ink text-base mb-1">
                  {isProcessing ? 'AIが読み取り中...' : '領収書を選択'}
                </p>
                <p className="text-xs text-ink-muted">
                  {isProcessing
                    ? `${progress!.done}/${progress!.total} 件 処理中`
                    : selectedPropertyId
                      ? 'タップして複数の画像を選択できます · AIが自動で読み取ります'
                      : 'まず物件を選択してください'}
                </p>
              </div>
              {isProcessing && (
                <div className="w-full max-w-xs h-2 bg-page rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{ width: `${(progress!.done / progress!.total) * 100}%` }}
                  />
                </div>
              )}
            </button>

            <p className="text-xs text-ink-muted text-center px-2">
              アップロードした領収書は財務ページの「未承認」一覧に追加され、後で確認・承認できます。
            </p>
          </div>
        )}

      {/* Completion notification — closing returns to this Upload Receipt page */}
      {result && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-brand/60 backdrop-blur-sm">
          <div className="bg-surface rounded-card shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-7 text-center">
              <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CheckCircle className="w-9 h-9" />
              </div>
              <h2 className="text-xl font-bold text-ink mb-1">処理が完了しました</h2>
              <p className="text-sm text-ink-soft">
                {result.success} 件の領収書を処理しました。
                {result.failed > 0 && (
                  <span className="block text-red-600 font-bold mt-1">{result.failed} 件は失敗しました。</span>
                )}
                {result.errorMsg && (
                  <span className="block text-xs text-red-500 mt-2 break-words">{result.errorMsg}</span>
                )}
              </p>
              {result.success > 0 && (
                <div className="mt-4 text-left bg-amber-50 border border-amber-200 rounded-control p-3 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 leading-relaxed">
                    内容の確認と承認は、<span className="font-bold">パソコン版の「仕訳帳（未承認）」</span>で行ってください。<br />
                    Please review and approve the content in the <span className="font-bold">仕訳帳（未承認）</span> list on the desktop version.
                  </p>
                </div>
              )}
            </div>
            <button
              onClick={() => setResult(null)}
              className="w-full py-4 border-t border-line text-sm font-bold text-blue-700 hover:bg-blue-50 flex items-center justify-center gap-2"
            >
              <X className="w-4 h-4" /> 閉じる (Close)
            </button>
          </div>
        </div>
      )}
    </AdminShell>
  );
};

export default UploadReceiptPage;
