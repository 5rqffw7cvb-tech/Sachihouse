import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Upload, Loader2, CheckCircle, Building, AlertCircle, X, Receipt } from 'lucide-react';
import { TopNavBar } from '../components/TopNavBar';
import { MobileBottomNav } from '../components/MobileBottomNav';
import { checkAuth, getCurrentUser, subscribeToAuth } from '../services/auth';
import { financeApi, FinancialProperty } from '../services/finance';

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });

const UploadReceiptPage: React.FC = () => {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(checkAuth());
  const [authUser, setAuthUser] = useState(getCurrentUser());
  const [properties, setProperties] = useState<FinancialProperty[]>([]);
  const [isLoadingProps, setIsLoadingProps] = useState(true);
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ success: number; failed: number; errorMsg?: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const canAccess = authUser?.role === 'ADMIN' || authUser?.role === 'HOST';

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => {
      setAuthUser(user);
      setIsAuthenticated(!!user);
    }).then((unsub) => { unsubscribe = unsub; });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !canAccess) {
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
  }, [isAuthenticated, canAccess]);

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

  const handleLogin = () => navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);

  const isProcessing = progress !== null;

  // ── Gates ──────────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#e8e5e6]">
        <TopNavBar navTitleOverride="Upload Receipt" />
        <div className="max-w-md mx-auto px-4 pt-[110px] pb-24">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 shadow-sm text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-[#1b1c1d] mb-2">ログインが必要です</h1>
            <p className="text-sm text-[#44474c] mb-6">領収書をアップロードするにはログインしてください。</p>
            <button onClick={handleLogin} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl">
              ログイン (Login)
            </button>
          </div>
        </div>
        <MobileBottomNav />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-[#e8e5e6]">
        <TopNavBar navTitleOverride="Upload Receipt" />
        <div className="max-w-md mx-auto px-4 pt-[110px] pb-24">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 shadow-sm text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-[#1b1c1d] mb-2">権限がありません</h1>
            <p className="text-sm text-[#44474c]">この機能はホストまたは管理者のみ利用できます。</p>
          </div>
        </div>
        <MobileBottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#e8e5e6]">
      <TopNavBar navTitleOverride="Upload Receipt" />
      <main className="max-w-xl mx-auto px-4 pt-[110px] pb-28">
        <div className="flex items-center gap-2 mb-5">
          <Receipt className="w-6 h-6 text-blue-700" />
          <h1 className="text-2xl font-bold text-[#1b1c1d]">領収書アップロード</h1>
        </div>

        {isLoadingProps ? (
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-10 flex justify-center text-[#74777d] shadow-sm">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : properties.length === 0 ? (
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 text-center text-[#44474c] shadow-sm">
            利用できる物件がありません。
          </div>
        ) : (
          <div className="space-y-4">
            {/* Property selection */}
            <div className="bg-white border border-[#e4e2e3] rounded-2xl p-4 shadow-sm">
              <label className="flex items-center gap-1.5 text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                <Building className="w-3.5 h-3.5 text-blue-700" />
                物件を選択 (Property)
              </label>
              {properties.length === 1 ? (
                <div className="w-full px-4 py-3 rounded-xl bg-[#f5f3f4] border border-[#e4e2e3] text-sm font-bold text-[#1b1c1d]">
                  {properties[0].name}
                </div>
              ) : (
                <select
                  value={selectedPropertyId}
                  onChange={(e) => setSelectedPropertyId(e.target.value)}
                  disabled={isProcessing}
                  className="w-full px-4 py-3 rounded-xl bg-white border border-gray-300 text-sm font-bold text-[#1b1c1d] outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
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
              className={`w-full rounded-2xl border-2 border-dashed p-10 flex flex-col items-center gap-4 text-center transition-colors ${
                !selectedPropertyId || isProcessing
                  ? 'border-[#ccc9ca] bg-white/60 cursor-not-allowed opacity-70'
                  : 'border-blue-300 bg-white hover:bg-blue-50/40'
              }`}
            >
              <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center">
                {isProcessing ? <Loader2 className="w-8 h-8 text-blue-600 animate-spin" /> : <Upload className="w-8 h-8 text-blue-600" />}
              </div>
              <div>
                <p className="font-bold text-[#1b1c1d] text-base mb-1">
                  {isProcessing ? 'AIが読み取り中...' : '領収書を選択'}
                </p>
                <p className="text-xs text-[#74777d]">
                  {isProcessing
                    ? `${progress!.done}/${progress!.total} 件 処理中`
                    : selectedPropertyId
                      ? 'タップして複数の画像を選択できます · AIが自動で読み取ります'
                      : 'まず物件を選択してください'}
                </p>
              </div>
              {isProcessing && (
                <div className="w-full max-w-xs h-2 bg-[#e4e2e3] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{ width: `${(progress!.done / progress!.total) * 100}%` }}
                  />
                </div>
              )}
            </button>

            <p className="text-xs text-[#74777d] text-center px-2">
              アップロードした領収書は財務ページの「未承認」一覧に追加され、後で確認・承認できます。
            </p>
          </div>
        )}
      </main>

      {/* Completion notification — closing returns to this Upload Receipt page */}
      {result && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-7 text-center">
              <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <CheckCircle className="w-9 h-9" />
              </div>
              <h2 className="text-xl font-bold text-[#1b1c1d] mb-1">処理が完了しました</h2>
              <p className="text-sm text-[#44474c]">
                {result.success} 件の領収書を処理しました。
                {result.failed > 0 && (
                  <span className="block text-red-600 font-bold mt-1">{result.failed} 件は失敗しました。</span>
                )}
                {result.errorMsg && (
                  <span className="block text-xs text-red-500 mt-2 break-words">{result.errorMsg}</span>
                )}
              </p>
              {result.success > 0 && (
                <div className="mt-4 text-left bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
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
              className="w-full py-4 border-t border-[#e4e2e3] text-sm font-bold text-blue-700 hover:bg-blue-50 flex items-center justify-center gap-2"
            >
              <X className="w-4 h-4" /> 閉じる (Close)
            </button>
          </div>
        </div>
      )}

      <MobileBottomNav />
    </div>
  );
};

export default UploadReceiptPage;
