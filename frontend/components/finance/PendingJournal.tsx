import React, { useState, useCallback, useRef } from 'react';
import {
  Upload, CheckCircle, Trash2, FileImage, X, Loader2,
  CheckCheck, AlertCircle, Eye, Edit2, Save, RefreshCw, Building,
} from 'lucide-react';
import { financeApi, PendingTransaction } from '../../services/finance';
import { FinancialProperty } from '../../services/finance';
import { ACCOUNT_TYPE_MAP } from '../../utils/accountingUtils';
import { AccountType } from '../../types/finance';

// Group accounts by type for the dropdown, preserving the order in ACCOUNT_TYPE_MAP.
const ACCOUNT_GROUPS: { label: string; accounts: string[] }[] = (() => {
  const TYPE_LABEL: Record<AccountType, string> = {
    [AccountType.Asset]: '資産',
    [AccountType.Liability]: '負債',
    [AccountType.Equity]: '資本',
    [AccountType.Revenue]: '収益',
    [AccountType.CostOfSales]: '売上原価',
    [AccountType.Expense]: '費用',
  };
  const order: AccountType[] = [
    AccountType.Revenue,
    AccountType.CostOfSales,
    AccountType.Expense,
    AccountType.Asset,
    AccountType.Liability,
    AccountType.Equity,
  ];
  const buckets: Partial<Record<AccountType, string[]>> = {};
  Object.entries(ACCOUNT_TYPE_MAP).forEach(([name, type]) => {
    if (!type) return;
    (buckets[type] ??= []).push(name);
  });
  return order
    .filter(t => (buckets[t] || []).length > 0)
    .map(t => ({ label: TYPE_LABEL[t], accounts: buckets[t] || [] }));
})();

const AccountSelect: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => (
  <select
    value={value || ''}
    onChange={e => onChange(e.target.value)}
    className="w-full px-1.5 py-1 border border-blue-300 rounded text-[11px] outline-none bg-white"
  >
    {value && !(value in ACCOUNT_TYPE_MAP) && <option value={value}>{value}</option>}
    <option value="">—</option>
    {ACCOUNT_GROUPS.map(g => (
      <optgroup key={g.label} label={g.label}>
        {g.accounts.map(a => <option key={a} value={a}>{a}</option>)}
      </optgroup>
    ))}
  </select>
);

interface PendingJournalProps {
  propertyId: string;
  propertyName?: string;
  selectedPropertyIds?: string[];
  allProperties: FinancialProperty[];
  onApproved?: () => void;
}

const PendingJournal: React.FC<PendingJournalProps> = ({
  propertyId, propertyName, selectedPropertyIds, allProperties, onApproved,
}) => {
  const [items, setItems] = useState<(PendingTransaction & { receiptUrl?: string })[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<{ done: number; total: number } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<PendingTransaction>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // Bulk selection (delete / change property)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTargetProp, setBulkTargetProp] = useState('');
  const [isBulkBusy, setIsBulkBusy] = useState(false);

  // Pending list aggregates ALL selected properties; uploads target ONE chosen property.
  const loadIds = (selectedPropertyIds?.length ? selectedPropertyIds : [propertyId]).filter(Boolean);
  const loadIdsKey = loadIds.join(',');
  const isMultiProperty = loadIds.length > 1;

  const propertyNameById = React.useMemo(() => {
    const map: Record<string, string> = {};
    allProperties.forEach(p => { map[p.id] = p.name; });
    return map;
  }, [allProperties]);

  const [writeTargetId, setWriteTargetId] = useState(propertyId);
  React.useEffect(() => { setWriteTargetId(propertyId); }, [propertyId, loadIdsKey]);
  const writeTargetOptions = loadIds.map(id => ({ id, name: propertyNameById[id] || id }));

  const resolvedPropertyName =
    propertyName || allProperties.find(p => p.id === propertyId)?.name || '';

  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (loadIds.length === 0) return;
    setIsLoading(true);
    try {
      const data = await financeApi.listPendingTransactions(loadIds);
      setItems(data);
    } catch { /* ignore */ }
    finally { setIsLoading(false); }
  }, [loadIdsKey]);

  // Reload whenever the selected properties change.
  React.useEffect(() => { setItems([]); load(); }, [loadIdsKey]);

  // An item whose receipt is still a data URI hasn't finished its background GCS upload yet.
  const isInlineImage = (item: { receiptUrl?: string; gcsPath?: string }) =>
    (item.receiptUrl || item.gcsPath || '').startsWith('data:');

  // After polling this long without GCS resolving, stop waiting and let the user
  // approve anyway (the inline image is still a valid receipt). Avoids a record
  // stuck on 「保存中」forever when the GCS upload permanently fails.
  const [uploadGaveUp, setUploadGaveUp] = useState(false);
  const pollStartRef = useRef<number | null>(null);
  const POLL_TIMEOUT_MS = 45000;

  const stillUploading = (item: { receiptUrl?: string; gcsPath?: string }) =>
    !uploadGaveUp && isInlineImage(item);

  // While any item is still uploading to GCS (and we're not mid-OCR), poll until all resolve.
  React.useEffect(() => {
    if (processingProgress !== null) { pollStartRef.current = null; return; }
    if (!items.some(isInlineImage)) { pollStartRef.current = null; setUploadGaveUp(false); return; }
    if (pollStartRef.current === null) pollStartRef.current = Date.now();
    if (Date.now() - pollStartRef.current > POLL_TIMEOUT_MS) { setUploadGaveUp(true); return; }
    const timer = setInterval(() => { load(); }, 2000);
    return () => clearInterval(timer);
  }, [items, processingProgress, load]);

  const handleFileSelect = async (files: FileList) => {
    if (!writeTargetId || files.length === 0) return;

    const fileArray = Array.from(files);
    // Fresh upload batch → give GCS a new polling window.
    setUploadGaveUp(false);
    pollStartRef.current = null;
    setProcessingProgress({ done: 0, total: fileArray.length });

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      try {
        // Read file as base64
        const imageBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // Send to backend: OCR → compress → GCS → create record
        const result = await financeApi.uploadSingleReceipt(writeTargetId, imageBase64);

        // Add to table immediately
        setItems(prev => [...prev, result]);
      } catch (err) {
        console.error(`Failed to process image ${file.name}:`, err);
      }

      setProcessingProgress({ done: i + 1, total: fileArray.length });
    }

    setProcessingProgress(null);
  };

  const handleApprove = async (id: string) => {
    setApprovingId(id);
    try {
      await financeApi.approvePendingTransaction(id);
      setItems(prev => prev.filter(i => i.id !== id));
      onApproved?.();
    } catch { alert('承認に失敗しました。'); }
    finally { setApprovingId(null); }
  };

  const handleApproveAll = async () => {
    const ready = items.filter(i => i.ocrProcessed && i.debitAmount > 0 && !stillUploading(i));
    if (ready.length === 0) return;
    if (!window.confirm(`${ready.length} 件を一括承認しますか？`)) return;
    for (const item of ready) await handleApprove(item.id);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('削除しますか？')) return;
    try {
      await financeApi.deletePendingTransaction(id);
      setItems(prev => prev.filter(i => i.id !== id));
    } catch { alert('削除に失敗しました。'); }
  };

  const startEdit = (item: PendingTransaction) => {
    setEditingId(item.id);
    setEditDraft({
      propertyId: item.propertyId,
      gcsPath: item.gcsPath,
      receiptUrl: item.receiptUrl,
      transactionDate: item.transactionDate,
      debitAccount: item.debitAccount,
      debitAmount: item.debitAmount,
      creditAccount: item.creditAccount,
      creditAmount: item.creditAmount,
      description: item.description,
      vendor: item.vendor,
    });
  };

  const closeEditModal = () => {
    setEditingId(null);
    setEditDraft({});
  };

  const saveEdit = async (id: string) => {
    var current = items.find(i => i.id === id);
    if (!current) return;

    // Keep receipt link fields so editing journal metadata never drops evidence.
    var payload: Partial<PendingTransaction> = {
      ...editDraft,
      propertyId: current.propertyId,
      gcsPath: current.gcsPath,
      receiptUrl: current.receiptUrl,
    };

    try {
      const updated = await financeApi.updatePendingTransaction(id, payload);
      setItems(prev => prev.map(i => {
        if (i.id !== id) return i;
        return {
          ...i,
          ...updated,
          // Defensive fallback in case backend omits evidence fields in response.
          gcsPath: updated.gcsPath || i.gcsPath,
          receiptUrl: updated.receiptUrl || i.receiptUrl,
        };
      }));
      closeEditModal();
    } catch { alert('保存に失敗しました。'); }
  };

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(v);

  // ── Bulk selection helpers ────────────────────────────────────────────
  const allSelected = items.length > 0 && items.every(i => selectedIds.has(i.id));
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => setSelectedIds(allSelected ? new Set() : new Set(items.map(i => i.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!window.confirm(`${ids.length} 件を削除しますか？`)) return;
    setIsBulkBusy(true);
    try {
      for (const id of ids) await financeApi.deletePendingTransaction(id);
      setItems(prev => prev.filter(i => !selectedIds.has(i.id)));
      clearSelection();
    } catch { alert('一括削除に失敗しました。'); }
    finally { setIsBulkBusy(false); }
  };

  const handleBulkChangeProperty = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0 || !bulkTargetProp) return;
    const propName = propertyNameById[bulkTargetProp] || bulkTargetProp;
    if (!window.confirm(`${ids.length} 件を「${propName}」に変更しますか？`)) return;
    setIsBulkBusy(true);
    try {
      for (const id of ids) await financeApi.updatePendingTransaction(id, { propertyId: bulkTargetProp });
      clearSelection();
      setBulkTargetProp('');
      await load();
    } catch { alert('プロパティ変更に失敗しました。'); }
    finally { setIsBulkBusy(false); }
  };

  const isProcessing = processingProgress !== null;
  const readyToApprove = items.filter(i => i.ocrProcessed && i.debitAmount > 0 && !stillUploading(i)).length;

  return (
    <div className="bg-white rounded-2xl border border-[#ccc9ca] shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#ccc9ca] flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <h2 className="text-lg font-bold text-[#1b1c1d] whitespace-nowrap">仕訳帳（未承認）</h2>
          {items.length > 0 && (
            <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-0.5 rounded-full text-[11px] font-bold">
              {items.length} 件
            </span>
          )}
          {isProcessing && (
            <span className="bg-blue-50 text-blue-700 border border-blue-100 px-2.5 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              AI読み取り中 {processingProgress!.done}/{processingProgress!.total}
            </span>
          )}
        </div>

        {/* Single property → read-only label. Multiple → choose the upload target. */}
        {isMultiProperty ? (
          <span className="flex items-center gap-1.5 px-2 py-1 bg-rose-50 border border-rose-200 rounded-lg text-xs font-bold text-rose-700 whitespace-nowrap">
            <Building className="w-3.5 h-3.5" />
            <span className="text-[10px]">アップロード先:</span>
            <select
              value={writeTargetId}
              onChange={e => setWriteTargetId(e.target.value)}
              className="bg-white border border-rose-300 rounded px-1.5 py-0.5 text-[11px] font-bold text-[#1b1c1d] outline-none"
            >
              {writeTargetOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </span>
        ) : resolvedPropertyName && (
          <span className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#f5f3f4] border border-[#e4e2e3] rounded-lg text-xs font-bold text-[#44474c] whitespace-nowrap">
            <Building className="w-3.5 h-3.5 text-blue-700" />
            {resolvedPropertyName}
          </span>
        )}

        <div className="flex items-center gap-2 no-print">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={e => { if (e.target.files) handleFileSelect(e.target.files); e.target.value = ''; }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#ccc9ca] rounded-xl text-xs font-semibold text-[#44474c] hover:bg-[#f5f3f4] disabled:opacity-50"
          >
            {isProcessing
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />処理中...</>
              : <><Upload className="w-3.5 h-3.5" />領収書アップロード</>
            }
          </button>

          {readyToApprove > 0 && (
            <button
              onClick={handleApproveAll}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700"
            >
              <CheckCheck className="w-3.5 h-3.5" />全承認 ({readyToApprove}件)
            </button>
          )}

          <button onClick={() => load()} className="p-1.5 text-[#74777d] hover:text-[#1b1c1d] hover:bg-[#f5f3f4] rounded-md">
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="hidden lg:flex items-center gap-3 mb-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl no-print">
          <span className="text-xs font-bold text-blue-900 whitespace-nowrap">{selectedIds.size} 件選択中</span>
          <div className="flex items-center gap-1.5">
            <select
              value={bulkTargetProp}
              onChange={e => setBulkTargetProp(e.target.value)}
              disabled={isBulkBusy}
              className="px-2 py-1.5 bg-white border border-[#ccc9ca] rounded-lg text-xs text-[#44474c] outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="">プロパティを選択...</option>
              {allProperties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button
              onClick={handleBulkChangeProperty}
              disabled={isBulkBusy || !bulkTargetProp}
              className="flex items-center gap-1 px-3 py-1.5 bg-white border border-[#ccc9ca] text-[#44474c] rounded-lg text-xs font-bold hover:bg-[#f5f3f4] disabled:opacity-40"
            >
              {isBulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Building className="w-3.5 h-3.5" />}
              プロパティ変更
            </button>
          </div>
          <button
            onClick={handleBulkDelete}
            disabled={isBulkBusy}
            className="flex items-center gap-1 px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-bold hover:bg-rose-700 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />削除
          </button>
          <button onClick={clearSelection} disabled={isBulkBusy} className="ml-auto text-xs font-bold text-[#74777d] hover:text-[#1b1c1d] px-2 py-1.5">
            選択解除
          </button>
        </div>
      )}

      {/* Desktop table — table-fixed + overflow-hidden so it always fits without horizontal scroll */}
      <div className="hidden lg:block w-full overflow-hidden rounded-xl border border-[#8f8d8e]">
        <table className="w-full text-[11px] border-collapse font-sans table-fixed">
          <thead>
            <tr className="bg-[#f5f3f4] text-center text-[#44474c]">
              <th className="py-2 px-1 text-center w-[36px] border border-[#8f8d8e] no-print">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                  className="w-3.5 h-3.5 accent-blue-600 cursor-pointer align-middle" title="全選択" />
              </th>
              <th className="py-2 px-2 font-bold border border-[#8f8d8e] text-center w-[72px]">状態</th>
              <th className="py-2 px-2 font-bold border border-[#8f8d8e] text-center w-[110px]">プロパティ名</th>
              <th className="py-2 px-2 font-bold border border-[#8f8d8e] text-center w-[84px]">取引日</th>
              <th className="py-2 px-2 font-bold border border-[#8f8d8e] text-center w-[16%]">借方勘定科目</th>
              <th className="py-2 px-2 font-bold border border-[#8f8d8e] text-center w-[11%]">借方金額(円)</th>
              <th className="py-2 px-2 font-bold border border-[#8f8d8e] text-center w-[16%]">貸方勘定科目</th>
              <th className="py-2 px-2 font-bold border border-[#8f8d8e] text-center w-[11%]">貸方金額(円)</th>
              <th className="py-2 px-2 font-bold border border-[#8f8d8e] text-center">摘要</th>
              <th className="py-2 px-2 font-bold text-center w-[52px] border border-[#8f8d8e] no-print">証憑</th>
              <th className="py-2 px-2 text-center w-[92px] sticky right-0 bg-[#f5f3f4] border border-[#8f8d8e] z-10 no-print">操作</th>
            </tr>
          </thead>
          <tbody>
              {/* Empty state — drop zone inside the table */}
              {items.length === 0 && !isLoading && !isProcessing && (
                <tr>
                  <td colSpan={11} className="p-0">
                    <div
                      className="py-12 flex flex-col items-center gap-4 text-center cursor-pointer hover:bg-blue-50/30 transition-colors"
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => { e.preventDefault(); if (e.dataTransfer.files) handleFileSelect(e.dataTransfer.files); }}
                    >
                      <div className="w-16 h-16 rounded-2xl bg-[#f5f3f4] border-2 border-dashed border-[#ccc9ca] flex items-center justify-center">
                        <Upload className="w-7 h-7 text-[#74777d]" />
                      </div>
                      <div>
                        <p className="font-bold text-[#1b1c1d] text-sm mb-1">領収書をアップロード</p>
                        <p className="text-xs text-[#74777d]">クリックまたはドラッグ＆ドロップで複数画像を選択<br/>JPEG / PNG · 最大30枚 · AIが自動で読み取ります</p>
                      </div>
                    </div>
                  </td>
                </tr>
              )}

              {/* Loading state */}
              {items.length === 0 && isLoading && (
                <tr>
                  <td colSpan={11} className="py-16 text-center text-[#74777d]">
                    <Loader2 className="w-6 h-6 animate-spin inline-block" />
                  </td>
                </tr>
              )}

              {items.map((item, idx) => {
                const rowClass = idx % 2 === 0 ? 'bg-white' : 'bg-[#f5f3f4]/20';
                return (
                  <tr key={item.id} className={`group transition-colors ${selectedIds.has(item.id) ? 'bg-blue-50/60' : `${rowClass} hover:bg-amber-50/30`}`}>
                    {/* select */}
                    <td className="py-1.5 px-1 text-center border border-[#8f8d8e] no-print">
                      <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)}
                        className="w-3.5 h-3.5 accent-blue-600 cursor-pointer align-middle" />
                    </td>
                    {/* 状態 */}
                    <td className="py-1.5 px-2 border border-[#8f8d8e]">
                      {stillUploading(item) ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-50 text-blue-600 border border-blue-100 rounded-full text-[10px] font-bold whitespace-nowrap">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />保存中
                        </span>
                      ) : item.ocrProcessed ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-[10px] font-bold whitespace-nowrap">
                          <AlertCircle className="w-2.5 h-2.5" />未承認
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-50 text-gray-500 border border-gray-200 rounded-full text-[10px] font-bold whitespace-nowrap">
                          <Eye className="w-2.5 h-2.5" />未読取
                        </span>
                      )}
                    </td>

                    {/* プロパティ名 */}
                    <td className="py-1.5 px-2 border border-[#8f8d8e] break-words">
                      <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 text-[10px] font-bold">
                        {propertyNameById[item.propertyId] || item.propertyId}
                      </span>
                    </td>

                    {/* 取引日 */}
                    <td className="py-1.5 px-2 border border-[#8f8d8e] font-mono whitespace-nowrap">
                      {item.transactionDate || <span className="text-gray-300">—</span>}
                    </td>

                    {/* 借方勘定科目 */}
                    <td className="py-1.5 px-2 border border-[#8f8d8e] break-words">
                      {item.debitAccount || <span className="text-gray-300">—</span>}
                    </td>

                    {/* 借方金額(円) */}
                    <td className="py-1.5 px-2 border border-[#8f8d8e] text-right font-mono font-semibold">
                      {item.debitAmount > 0
                        ? formatCurrency(item.debitAmount)
                        : <span className="text-gray-300">—</span>}
                    </td>

                    {/* 貸方勘定科目 */}
                    <td className="py-1.5 px-2 border border-[#8f8d8e] break-words">
                      {item.creditAccount || <span className="text-gray-300">—</span>}
                    </td>

                    {/* 貸方金額(円) */}
                    <td className="py-1.5 px-2 border border-[#8f8d8e] text-right font-mono font-semibold">
                      {item.creditAmount > 0
                        ? formatCurrency(item.creditAmount)
                        : <span className="text-gray-300">—</span>}
                    </td>

                    {/* 摘要 */}
                    <td className="py-1.5 px-2 border border-[#8f8d8e] break-words leading-tight">
                      <div>
                        {item.vendor && <p className="font-semibold text-[#1b1c1d] truncate">{item.vendor}</p>}
                        {item.description && <p className="text-[#74777d] truncate">{item.description}</p>}
                        {!item.vendor && !item.description && <span className="text-gray-300">—</span>}
                      </div>
                    </td>

                    {/* 証憑 */}
                    <td className="py-1.5 px-2 text-center border border-[#8f8d8e] no-print">
                      <button onClick={() => setPreviewUrl(item.receiptUrl || item.gcsPath)}
                        className="p-1.5 text-[#74777d] hover:text-emerald-600 hover:bg-emerald-50 rounded-md" title="証憑確認">
                        <FileImage className="w-3.5 h-3.5" />
                      </button>
                    </td>

                    {/* 操作 */}
                    <td className="py-1.5 px-2 text-center sticky right-0 bg-inherit border border-[#8f8d8e] z-10 no-print">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => startEdit(item)}
                          className="p-1.5 text-[#74777d] hover:text-blue-600 hover:bg-blue-50 rounded-md opacity-70 group-hover:opacity-100" title="編集">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleApprove(item.id)}
                          disabled={approvingId === item.id || stillUploading(item)}
                          title={stillUploading(item) ? '画像を保存中です...' : '承認'}
                          className="p-1.5 text-[#74777d] hover:text-emerald-600 hover:bg-emerald-50 rounded-md opacity-70 group-hover:opacity-100 disabled:opacity-30"
                        >
                          {approvingId === item.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <CheckCircle className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => handleDelete(item.id)}
                          className="p-1.5 text-[#74777d] hover:text-rose-600 hover:bg-rose-50 rounded-md opacity-70 group-hover:opacity-100" title="削除">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* Inline processing row */}
              {isProcessing && (
                <tr className="bg-blue-50/30">
                  <td colSpan={11} className="py-3 px-4">
                    <div className="flex items-center gap-2 text-blue-600 text-xs">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      AIが読み取り中... ({processingProgress!.done + 1}/{processingProgress!.total})
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      {/* Mobile card list — no horizontal scroll on small screens */}
      <div className="lg:hidden">
        {/* Empty state */}
        {items.length === 0 && !isLoading && !isProcessing && (
          <div
            className="py-12 px-4 flex flex-col items-center gap-4 text-center cursor-pointer border border-dashed border-[#ccc9ca] rounded-2xl"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="w-14 h-14 rounded-2xl bg-[#f5f3f4] border-2 border-dashed border-[#ccc9ca] flex items-center justify-center">
              <Upload className="w-6 h-6 text-[#74777d]" />
            </div>
            <div>
              <p className="font-bold text-[#1b1c1d] text-sm mb-1">領収書をアップロード</p>
              <p className="text-xs text-[#74777d]">タップで複数画像を選択 · AIが自動で読み取ります</p>
            </div>
          </div>
        )}

        {items.length === 0 && isLoading && (
          <div className="py-12 flex justify-center text-[#74777d]"><Loader2 className="w-6 h-6 animate-spin" /></div>
        )}

        <div className="divide-y divide-[#f5f3f4]">
          {items.map((item) => {
            const uploading = stillUploading(item);
            return (
              <div key={item.id} className="flex items-center gap-3 p-3 bg-white">
                <div className="flex-1 min-w-0 grid gap-1">
                  <div className="flex items-center gap-2">
                    {uploading ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-50 text-blue-600 border border-blue-100 rounded-full text-[10px] font-bold"><Loader2 className="w-2.5 h-2.5 animate-spin" />保存中</span>
                    ) : item.ocrProcessed ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-[10px] font-bold"><AlertCircle className="w-2.5 h-2.5" />未承認</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-50 text-gray-500 border border-gray-200 rounded-full text-[10px] font-bold"><Eye className="w-2.5 h-2.5" />未読取</span>
                    )}
                    <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 text-[9px] font-bold truncate max-w-[80px]">{propertyNameById[item.propertyId] || item.propertyId}</span>
                    <span className="text-[10px] font-mono text-[#74777d]">{item.transactionDate || '—'}</span>
                  </div>
                  <p className="text-xs font-bold text-[#1b1c1d] truncate">{item.vendor || item.description || '(摘要なし)'}</p>
                  <div className="flex items-center text-[10px] text-[#74777d] gap-1 truncate">
                    <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold border border-blue-100 truncate max-w-[90px]">{item.debitAccount || '—'}</span>
                    <span className="text-gray-300">&rarr;</span>
                    <span className="px-1.5 py-0.5 rounded bg-[#f5f3f4] truncate max-w-[90px]">{item.creditAccount || '—'}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <div className="text-xs font-bold font-mono text-[#1b1c1d] whitespace-nowrap">{item.debitAmount > 0 ? formatCurrency(item.debitAmount) : '—'}</div>
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => setPreviewUrl(item.receiptUrl || item.gcsPath)} className="p-1.5 text-[#74777d] hover:text-emerald-600 hover:bg-emerald-50 rounded-md" title="証憑確認"><FileImage className="w-4 h-4" /></button>
                    <button onClick={() => startEdit(item)} className="p-1.5 text-[#74777d] hover:text-blue-600 hover:bg-blue-50 rounded-md" title="編集"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => handleApprove(item.id)} disabled={approvingId === item.id || uploading} title={uploading ? '画像を保存中です...' : '承認'} className="p-1.5 text-[#74777d] hover:text-emerald-600 hover:bg-emerald-50 rounded-md disabled:opacity-30">
                      {approvingId === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    </button>
                    <button onClick={() => handleDelete(item.id)} className="p-1.5 text-[#74777d] hover:text-rose-600 hover:bg-rose-50 rounded-md" title="削除"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {isProcessing && (
          <div className="flex items-center gap-2 text-blue-600 text-xs p-3 bg-blue-50/30">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            AIが読み取り中... ({processingProgress!.done + 1}/{processingProgress!.total})
          </div>
        )}
      </div>

      {/* Receipt preview modal */}
      {previewUrl && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm no-print">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#e4e2e3] bg-[#f5f3f4]">
              <h3 className="font-bold text-sm text-[#1b1c1d]">証憑プレビュー</h3>
              <button onClick={() => setPreviewUrl(null)} className="p-1.5 text-[#74777d] hover:bg-slate-200 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 bg-[#f5f3f4]/50 flex items-center justify-center p-6 min-h-[300px]">
              {previewUrl.startsWith('data:') ? (
                <img src={previewUrl} alt="Receipt" className="max-w-full max-h-[60vh] object-contain rounded-xl shadow-lg" />
              ) : (() => {
                const isImage = /\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(previewUrl);
                return isImage
                  ? <img src={previewUrl} alt="Receipt" className="max-w-full max-h-[60vh] object-contain rounded-xl shadow-lg" />
                  : <iframe src={previewUrl} className="w-full h-[60vh] border-none rounded-xl bg-white shadow-lg" title="Receipt Preview" />;
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Edit popup (same behavior style as 仕訳帳) */}
      {editingId && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm no-print">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-5 py-3 border-b border-[#e4e2e3] bg-[#f5f3f4] flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-[#1b1c1d]">未承認仕訳を編集</h3>
                <p className="text-[10px] text-[#74777d] mt-0.5">保存後に承認できます</p>
              </div>
              <button onClick={closeEditModal} className="p-1.5 text-[#74777d] hover:bg-slate-200 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="block">
                  <span className="block text-[11px] font-bold text-[#44474c] mb-1">取引日</span>
                  <input
                    type="date"
                    value={(editDraft.transactionDate || '').replace(/\//g, '-')}
                    onChange={e => setEditDraft(d => ({ ...d, transactionDate: e.target.value }))}
                    className="w-full px-3 py-2 bg-[#f5f3f4] border border-[#e4e2e3] rounded-lg text-xs outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </label>
                <label className="block md:col-span-2">
                  <span className="block text-[11px] font-bold text-[#44474c] mb-1">Vendor</span>
                  <input
                    value={editDraft.vendor || ''}
                    onChange={e => setEditDraft(d => ({ ...d, vendor: e.target.value }))}
                    className="w-full px-3 py-2 bg-[#f5f3f4] border border-[#e4e2e3] rounded-lg text-xs outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Vendor name"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <span className="block text-[11px] font-bold text-[#44474c] mb-1">借方勘定科目</span>
                  <AccountSelect value={editDraft.debitAccount || ''} onChange={v => setEditDraft(d => ({ ...d, debitAccount: v }))} />
                </div>
                <div>
                  <span className="block text-[11px] font-bold text-[#44474c] mb-1">貸方勘定科目</span>
                  <AccountSelect value={editDraft.creditAccount || ''} onChange={v => setEditDraft(d => ({ ...d, creditAccount: v }))} />
                </div>
                <label className="block">
                  <span className="block text-[11px] font-bold text-[#44474c] mb-1">借方金額(円)</span>
                  <input
                    type="number"
                    value={editDraft.debitAmount || ''}
                    onChange={e => {
                      const v = parseInt(e.target.value) || 0;
                      setEditDraft(d => ({ ...d, debitAmount: v, creditAmount: v }));
                    }}
                    className="w-full px-3 py-2 bg-[#f5f3f4] border border-[#e4e2e3] rounded-lg text-xs text-right font-mono outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-bold text-[#44474c] mb-1">貸方金額(円)</span>
                  <input
                    type="number"
                    value={editDraft.creditAmount || ''}
                    onChange={e => setEditDraft(d => ({ ...d, creditAmount: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 bg-[#f5f3f4] border border-[#e4e2e3] rounded-lg text-xs text-right font-mono outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </label>
              </div>

              <label className="block">
                <span className="block text-[11px] font-bold text-[#44474c] mb-1">摘要</span>
                <input
                  value={editDraft.description || ''}
                  onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))}
                  className="w-full px-3 py-2 bg-[#f5f3f4] border border-[#e4e2e3] rounded-lg text-xs outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="摘要を入力"
                />
              </label>
            </div>

            <div className="px-5 py-4 border-t border-[#e4e2e3] bg-[#f5f3f4] flex items-center gap-2">
              <button
                onClick={closeEditModal}
                className="flex-1 px-4 py-2.5 bg-white border border-[#ccc9ca] text-[#44474c] rounded-xl text-xs font-bold hover:bg-[#f5f3f4]"
              >
                キャンセル
              </button>
              <button
                onClick={() => saveEdit(editingId)}
                className="flex-1 px-4 py-2.5 bg-[#003580] text-white rounded-xl text-xs font-bold hover:bg-brand-700 flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" />保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PendingJournal;
