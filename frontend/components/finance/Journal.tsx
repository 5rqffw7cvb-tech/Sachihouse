import React, { useState, useMemo, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import { FinancialReport, JournalEntry, AccountType, CsvRow } from '../../types/finance';
import {
  Search, ChevronLeft, ChevronRight, FileImage, X, ExternalLink, Plus, Edit2, Trash2, Save,
  Loader2, Image as ImageIcon, Eye, AlertCircle, Filter, TrendingUp, TrendingDown,
  ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, CalendarRange, Upload, CheckCircle2,
  FileText, Building
} from 'lucide-react';
import { extractUrl, ACCOUNT_TYPE_MAP, processFinancials } from '../../utils/accountingUtils';
import { financeApi, TransactionInput, ReceiptOcrResult } from '../../services/finance';

interface JournalProps {
  report: FinancialReport;
  propertyId: string;
  propertyName?: string;
  selectedPropertyIds?: string[];
  allProperties?: { id: string; name: string }[];
  onRefresh?: () => void;
  rawData?: CsvRow[];
  headers?: string[];
}

type SortDirection = 'asc' | 'desc';
interface SortConfig { key: string; direction: SortDirection; }

type EditingEntry = Partial<JournalEntry> & { _dbId?: string; receiptUrl?: string };

// Per-column width hints so the fixed-layout table distributes space sensibly
// (摘要 takes the remaining space). Keeps the table within the container — never scrolls.
const COLUMN_WIDTHS: Record<string, string> = {
  'プロパティ名': 'w-[120px]',
  '取引日': 'w-[84px]',
  '借方勘定科目': 'w-[15%]',
  '借方金額(円)': 'w-[11%]',
  '貸方勘定科目': 'w-[15%]',
  '貸方金額(円)': 'w-[11%]',
};

const Journal: React.FC<JournalProps> = ({ report: initialReport, propertyId, propertyName, selectedPropertyIds, allProperties, onRefresh, rawData, headers }) => {
  const isMultiProperty = (selectedPropertyIds?.length ?? 0) > 1;
  // When multiple properties are selected, new entries/uploads/imports must target ONE property.
  const [writeTargetId, setWriteTargetId] = useState(propertyId);
  useEffect(() => { setWriteTargetId(propertyId); }, [propertyId, selectedPropertyIds]);
  const writeTargetOptions = (selectedPropertyIds ?? []).map(id => ({
    id, name: allProperties?.find(p => p.id === id)?.name || id,
  }));
  const currentYear = new Date().getFullYear();
  const [localYear, setLocalYear] = useState<number | 'ALL'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showAllForPrint, setShowAllForPrint] = useState(false);
  
  // Custom Receipt Preview State
  const [previewEntry, setPreviewEntry] = useState<JournalEntry | null>(null);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<EditingEntry | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transactionType, setTransactionType] = useState<'expense' | 'revenue'>('expense');
  const [accountPickerState, setAccountPickerState] = useState<{ isOpen: boolean; type: 'debit' | 'credit' | null }>({ isOpen: false, type: null });
  const [accountSearchTerm, setAccountSearchTerm] = useState('');
  const [accountCategoryFilter, setAccountCategoryFilter] = useState<string>('ALL');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [filters, setFilters] = useState({ date: '', description: '', account: '', amount: '' });
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<TransactionInput[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number } | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [receiptOcr, setReceiptOcr] = useState<ReceiptOcrResult | null>(null);

  // Bulk selection (delete / change property)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTargetProp, setBulkTargetProp] = useState('');
  const [isBulkBusy, setIsBulkBusy] = useState(false);

  const itemsPerPage = 50;

  const activeReport = useMemo(() => {
    if (rawData && headers) return processFinancials(rawData, headers, localYear);
    return initialReport;
  }, [rawData, headers, localYear, initialReport]);

  const activeHeaders = activeReport.headers.length > 0 ? activeReport.headers : (initialReport.headers || []);
  const displayHeaders = activeHeaders.filter(h => h !== '取引No' && h !== '証憑');

  const groupedAccounts = useMemo(() => {
    const groups: Record<string, string[]> = {
      [AccountType.Revenue]: [], [AccountType.Expense]: [], [AccountType.CostOfSales]: [],
      [AccountType.Asset]: [], [AccountType.Liability]: [], [AccountType.Equity]: [],
    };
    Object.entries(ACCOUNT_TYPE_MAP).forEach(([name, type]) => { if (groups[type]) groups[type].push(name); });
    return groups;
  }, []);

  const formatCurrency = (val: unknown) => {
    const num = parseFloat(String(val).replace(/,/g, ''));
    if (isNaN(num)) return String(val);
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(num);
  };

  const formatDateValue = (val: string) => {
    if (!val) return "";
    if (val.includes('T') && val.includes('Z')) {
      try { return new Date(val).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }); } catch { return val; }
    }
    return val;
  };

  const isNumericColumn = (h: string) => h.includes('金額') || h.includes('円');
  const isDateColumn = (h: string) => h.includes('日');
  const isLinkColumn = (h: string) => ['証憑', 'URL', 'Evidence', 'Receipt', 'Link', '画像', 'ファイル', '添付', 'Image', 'File'].some(k => h.includes(k));

  const handleSort = (key: string) => {
    setSortConfig(prev => ({ key, direction: prev?.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  };

  const filteredEntries = useMemo(() => {
    let entries = [...activeReport.journalEntries];
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      entries = entries.filter(e => Object.values(e.rawData).some(v => String(v).toLowerCase().includes(lower)));
    }
    if (filters.date) entries = entries.filter(e => e.date.includes(filters.date));
    if (filters.description) entries = entries.filter(e => e.description.toLowerCase().includes(filters.description.toLowerCase()));
    if (filters.account) {
      const a = filters.account.toLowerCase();
      entries = entries.filter(e => e.debitAccount.toLowerCase().includes(a) || e.creditAccount.toLowerCase().includes(a));
    }
    if (filters.amount) {
      const val = filters.amount.replace(/,/g, '');
      const op = val.match(/^[><=]/) ? val[0] : null;
      const numF = parseFloat(val.replace(/^[><=]/, ''));
      if (!isNaN(numF)) {
        entries = entries.filter(e => {
          if (op === '>') return e.debitAmount > numF || e.creditAmount > numF;
          if (op === '<') return e.debitAmount < numF || e.creditAmount < numF;
          return String(e.debitAmount).includes(String(numF)) || String(e.creditAmount).includes(String(numF));
        });
      }
    }
    if (sortConfig) {
      entries.sort((a, b) => {
        let vA: string | number = "", vB: string | number = "";
        if (sortConfig.key.includes('日')) { vA = a.date; vB = b.date; }
        else if (sortConfig.key.includes('借方') && isNumericColumn(sortConfig.key)) { vA = a.debitAmount; vB = b.debitAmount; }
        else if (sortConfig.key.includes('貸方') && isNumericColumn(sortConfig.key)) { vA = a.creditAmount; vB = b.creditAmount; }
        else if (sortConfig.key.includes('借方')) { vA = a.debitAccount; vB = b.debitAccount; }
        else if (sortConfig.key.includes('貸方')) { vA = a.creditAccount; vB = b.creditAccount; }
        else { vA = a.rawData[sortConfig.key] || ""; vB = b.rawData[sortConfig.key] || ""; }
        if (vA < vB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (vA > vB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return entries;
  }, [activeReport.journalEntries, searchTerm, filters, sortConfig]);

  const totalPages = Math.ceil(filteredEntries.length / itemsPerPage);
  const displayedEntries = useMemo(() => {
    if (showAllForPrint) return filteredEntries;
    const start = (currentPage - 1) * itemsPerPage;
    return filteredEntries.slice(start, start + itemsPerPage);
  }, [filteredEntries, currentPage, itemsPerPage, showAllForPrint]);

  // ── Bulk selection helpers ────────────────────────────────────────────
  const entryDbId = (entry: JournalEntry) => entry.rawData['_id'] || '';
  const selectableIds = filteredEntries.map(entryDbId).filter(Boolean);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.has(id));

  const toggleSelect = (id: string) => {
    if (!id) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds));
  };
  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!window.confirm(`${ids.length} 件を削除しますか？この操作は元に戻せません。`)) return;
    setIsBulkBusy(true);
    try {
      for (const id of ids) await financeApi.deleteTransaction(id);
      clearSelection();
      onRefresh?.();
    } catch { alert('一括削除に失敗しました。'); }
    finally { setIsBulkBusy(false); }
  };

  const handleBulkChangeProperty = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0 || !bulkTargetProp) return;
    const propName = allProperties?.find(p => p.id === bulkTargetProp)?.name || bulkTargetProp;
    if (!window.confirm(`${ids.length} 件を「${propName}」に変更しますか？`)) return;
    setIsBulkBusy(true);
    try {
      for (const id of ids) await financeApi.updateTransaction(id, { propertyId: bulkTargetProp });
      clearSelection();
      setBulkTargetProp('');
      onRefresh?.();
    } catch { alert('プロパティ変更に失敗しました。'); }
    finally { setIsBulkBusy(false); }
  };

  const getEmbedUrl = (url: string | null) => {
    if (!url) return null;
    const isPrivateGcs = (() => {
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        const isGcsHost = host === 'storage.googleapis.com' || /\.storage\.googleapis\.com$/.test(host);
        if (!isGcsHost) return false;

        const p = parsed.searchParams;
        const hasTemporaryAccess = p.has('X-Goog-Signature')
          || p.has('X-Goog-Algorithm')
          || p.has('GoogleAccessId')
          || p.has('Signature')
          || p.has('token');

        return !hasTemporaryAccess;
      } catch {
        return false;
      }
    })();

    if (isPrivateGcs) return { url, type: 'blocked' as const };

    const driveMatch = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([^/?#\s]+)/) || url.match(/[?&]id=([^/?#&\s]+)/);
    // Google Drive blocks iframe embedding via CSP (frame-ancestors). Use the
    // thumbnail image endpoint which loads as a normal <img>, plus keep the
    // original link so the user can open the full file in a new tab.
    if (driveMatch) return {
      url: `https://drive.google.com/uc?export=view&id=${driveMatch[1]}`,
      imgUrl: `https://drive.google.com/thumbnail?id=${driveMatch[1]}&sz=w1600`,
      openUrl: `https://drive.google.com/file/d/${driveMatch[1]}/view`,
      type: 'drive' as const,
    };
    if (url.startsWith('data:image/')) return { url, type: 'image' as const };
    // Allow query string / fragment after the extension (e.g. GCS signed URLs ending in ?X-Goog-...)
    if (/\.(jpeg|jpg|gif|png|webp|bmp|svg|avif)(\?|#|$)/i.test(url)) return { url, type: 'image' as const };
    // GCS signed URLs are always images uploaded by our pipeline
    if (/storage\.googleapis\.com\//i.test(url) || /\.storage\.googleapis\.com\//i.test(url)) return { url, type: 'image' as const };
    return { url, type: 'other' as const };
  };

  const openAddModal = () => {
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '/');
    setTransactionType('expense');
    setEditingEntry({ date: today, debitAmount: 0, creditAmount: 0, description: "", debitAccount: "消耗品費", creditAccount: "現金", receiptUrl: "" });
    setReceiptOcr(null);
    setIsModalOpen(true);
  };

  const openEditModal = (entry: JournalEntry) => {
    const isRevenue = ACCOUNT_TYPE_MAP[entry.creditAccount] === AccountType.Revenue;
    setTransactionType(isRevenue ? 'revenue' : 'expense');
    setEditingEntry({ ...entry, _dbId: entry.rawData['_id'] || undefined, receiptUrl: entry.rawData['証憑'] || "" });
    setReceiptOcr(null);
    setIsModalOpen(true);
  };

  const handleTransactionTypeChange = (type: 'expense' | 'revenue') => {
    setTransactionType(type);
    setEditingEntry(prev => ({
      ...prev,
      debitAccount: type === 'expense' ? "消耗品費" : "普通預金",
      creditAccount: type === 'expense' ? "現金" : "売上高",
    }));
  };

  const openAccountPicker = (type: 'debit' | 'credit') => {
    setAccountPickerState({ isOpen: true, type });
    setAccountSearchTerm('');
    setAccountCategoryFilter(type === 'debit'
      ? (transactionType === 'expense' ? AccountType.Expense : AccountType.Asset)
      : (transactionType === 'expense' ? AccountType.Asset : AccountType.Revenue));
  };

  const handleAccountSelect = (account: string) => {
    if (accountPickerState.type && editingEntry) {
      setEditingEntry({ ...editingEntry, [accountPickerState.type === 'debit' ? 'debitAccount' : 'creditAccount']: account });
    }
    setAccountPickerState({ isOpen: false, type: null });
  };

  const handleDelete = async (entry: EditingEntry) => {
    const dbId = entry._dbId || entry.rawData?.['_id'];
    if (!dbId) { alert("この取引はDB上に存在しません。"); return; }
    if (!window.confirm("このデータを削除しますか？")) return;
    setIsSubmitting(true);
    try {
      await financeApi.deleteTransaction(dbId);
      setIsModalOpen(false);
      onRefresh?.();
    } catch {
      alert("削除に失敗しました。");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry || editingEntry.debitAmount !== editingEntry.creditAmount) return;
    setIsSubmitting(true);
    try {
      const dbId = editingEntry._dbId || editingEntry.rawData?.['_id'];
      const dateValue = (editingEntry.date || '').replace(/\//g, '-');
      // Existing entries keep their own property; new entries go to the chosen write target.
      const targetPropertyId = dbId ? (editingEntry.rawData?.['_propertyId'] || propertyId) : writeTargetId;
      const payload = {
        propertyId: targetPropertyId,
        transactionNo: editingEntry.id || '',
        transactionDate: dateValue,
        debitAccount: editingEntry.debitAccount || '',
        debitAmount: editingEntry.debitAmount || 0,
        creditAccount: editingEntry.creditAccount || '',
        creditAmount: editingEntry.creditAmount || 0,
        description: editingEntry.description || '',
        receiptUrl: editingEntry.receiptUrl || undefined,
      };
      if (dbId) {
        await financeApi.updateTransaction(dbId, payload);
      } else {
        await financeApi.createTransaction(payload);
      }
      setIsModalOpen(false);
      onRefresh?.();
    } catch {
      alert("保存に失敗しました。");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReceiptUpload = async (file: File) => {
    const dbId = editingEntry?._dbId || editingEntry?.rawData?.['_id'];
    const uploadPropertyId = dbId ? (editingEntry?.rawData?.['_propertyId'] || propertyId) : writeTargetId;
    if (!uploadPropertyId) return;
    setIsUploadingReceipt(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await financeApi.uploadReceipt(base64, uploadPropertyId);
      setEditingEntry(prev => ({ ...prev, receiptUrl: result.receiptUrl }));
      setReceiptOcr(result.ocr);
      // Auto-fill empty fields from OCR
      setEditingEntry(prev => ({
        ...prev,
        receiptUrl: result.receiptUrl,
        date: (!prev?.date || prev.date === new Date().toISOString().split('T')[0].replace(/-/g, '/'))
          && result.ocr.transactionDate ? result.ocr.transactionDate.replace(/-/g, '/') : prev?.date,
        debitAmount: (!prev?.debitAmount && result.ocr.amount) ? result.ocr.amount : prev?.debitAmount,
        creditAmount: (!prev?.creditAmount && result.ocr.amount) ? result.ocr.amount : prev?.creditAmount,
        description: (!prev?.description && result.ocr.description)
          ? (result.ocr.vendor ? `${result.ocr.vendor} - ${result.ocr.description}` : result.ocr.description)
          : prev?.description,
        debitAccount: (!prev?.debitAccount || prev.debitAccount === '消耗品費') && result.ocr.suggestedDebitAccount
          ? result.ocr.suggestedDebitAccount : prev?.debitAccount,
      }));
    } catch {
      alert('領収書のアップロードに失敗しました。');
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  const openImportModal = () => {
    setImportRows([]);
    setImportError(null);
    setImportResult(null);
    setIsImportOpen(true);
  };

  const handleCsvFile = (file: File) => {
    setImportError(null);
    setImportResult(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = result.data as Record<string, string>[];
        if (rows.length === 0) { setImportError('CSVにデータがありません。'); return; }
        const parsed: TransactionInput[] = rows.map(row => ({
          propertyId: writeTargetId,
          transactionNo: row['取引No'] || '',
          transactionDate: (row['取引日'] || '').replace(/\//g, '-'),
          debitAccount: row['借方勘定科目'] || '',
          debitAmount: parseInt(String(row['借方金額(円)'] || '0').replace(/[,，]/g, '')) || 0,
          creditAccount: row['貸方勘定科目'] || '',
          creditAmount: parseInt(String(row['貸方金額(円)'] || '0').replace(/[,，]/g, '')) || 0,
          description: row['摘要'] || '',
          receiptUrl: row['証憑リンク'] || row['証憑'] || row['URL'] || row['Evidence'] || row['Receipt'] || undefined,
        }));
        const invalid = parsed.filter(r => !r.transactionDate || !r.debitAccount || !r.creditAccount);
        if (invalid.length > 0) setImportError(`${invalid.length} 行に必須項目が不足しています。インポートは続行できます。`);
        setImportRows(parsed);
      },
      error: () => setImportError('CSVの解析に失敗しました。'),
    });
  };

  const handleImport = async () => {
    if (importRows.length === 0 || !writeTargetId) return;
    setIsImporting(true);
    try {
      const result = await financeApi.bulkImport(writeTargetId, importRows.map(r => ({ ...r, propertyId: writeTargetId })));
      setImportResult(result);
      onRefresh?.();
    } catch {
      setImportError('インポートに失敗しました。');
    } finally {
      setIsImporting(false);
    }
  };

  const renderCellContent = (header: string, rawValue: string, entry: JournalEntry) => {
    const value = rawValue || "";
    if (isNumericColumn(header)) return formatCurrency(value);
    if (isDateColumn(header)) return formatDateValue(value);
    const url = extractUrl(value);
    const isDedicatedLinkCol = isLinkColumn(header);
    if (url || isDedicatedLinkCol) {
      const button = (
        <button onClick={(e) => { e.stopPropagation(); setPreviewEntry(entry); }}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-[#e4e2e3] text-blue-600 hover:bg-slate-50 rounded-lg shadow-sm text-[10px] font-bold mx-1">
          <FileImage className="w-3.5 h-3.5" /><span>確認</span>
        </button>
      );
      if (isDedicatedLinkCol) return button;
      const cleanText = value.replace(/\[\[HYPERLINK:.+?\]\]/g, '').replace(/=HYPERLINK\(".+?",\s*".+?"\)/g, '').replace(/https?:\/\/[^\s]+/, '').trim();
      return <div className="flex items-center justify-between"><span className="truncate">{cleanText}</span>{button}</div>;
    }
    return value;
  };

  const renderAccountPicker = () => {
    if (!accountPickerState.isOpen) return null;
    const isDebit = accountPickerState.type === 'debit';
    const colorClass = isDebit ? 'text-blue-600' : 'text-rose-600';
    const categories = [
      { id: 'ALL', label: '全て' }, { id: AccountType.Expense, label: '経費' },
      { id: AccountType.Revenue, label: '売上' }, { id: AccountType.Asset, label: '資産' },
      { id: AccountType.Liability, label: '負債' },
    ];
    const filteredGroups = Object.entries(groupedAccounts).reduce((acc, [type, accounts]) => {
      if (accountCategoryFilter !== 'ALL' && type !== accountCategoryFilter) return acc;
      const matched = (accounts as string[]).filter(a => a.toLowerCase().includes(accountSearchTerm.toLowerCase()));
      if (matched.length > 0) acc[type] = matched;
      return acc;
    }, {} as Record<string, string[]>);

    return (
      <div className="fixed inset-0 z-[100] bg-white flex flex-col font-sans">
        <div className="px-4 py-3 border-b border-[#e4e2e3] flex items-center gap-2 bg-[#f5f3f4] flex-shrink-0">
          <button onClick={() => setAccountPickerState({ isOpen: false, type: null })} className="p-2 -ml-2 text-[#74777d] hover:text-[#1b1c1d]"><ChevronLeft className="w-6 h-6" /></button>
          <h3 className={`font-bold text-lg ${colorClass}`}>{isDebit ? '借方' : '貸方'} 科目選択</h3>
        </div>
        <div className="p-4 bg-white border-b border-[#e4e2e3] space-y-3 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input type="text" placeholder="科目を検索..." value={accountSearchTerm} onChange={e => setAccountSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-[#f5f3f4] border border-[#e4e2e3] rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 text-[#1b1c1d]" />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {categories.map(cat => (
              <button key={cat.id} onClick={() => setAccountCategoryFilter(cat.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border ${accountCategoryFilter === cat.id ? 'bg-[#041627] text-white border-[#041627]' : 'bg-white text-[#44474c] border-[#ccc9ca] hover:bg-[#f5f3f4]'}`}>
                {cat.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 bg-[#e8e5e6]">
          {Object.keys(filteredGroups).length === 0 ? (
            <div className="text-center py-10 text-[#74777d]"><p>一致する科目がありません</p></div>
          ) : Object.entries(filteredGroups).map(([type, accounts]) => (
            <div key={type} className="bg-white rounded-2xl border border-[#e4e2e3] overflow-hidden mb-4 shadow-sm">
              <div className="px-4 py-2 bg-[#f5f3f4] border-b border-[#e4e2e3]"><span className="text-xs font-bold text-[#74777d]">{type}</span></div>
              <div className="p-3 grid grid-cols-2 gap-2">
                {accounts.map(account => (
                  <button key={account} onClick={() => handleAccountSelect(account)}
                    className="p-3 text-left text-xs font-semibold text-[#44474c] bg-white border border-[#e4e2e3] rounded-xl hover:bg-[#f5f3f4] flex items-center justify-between transition-colors">
                    <span className="truncate">{account}</span>
                    {(isDebit ? editingEntry?.debitAccount : editingEntry?.creditAccount) === account && <div className="w-2.5 h-2.5 bg-blue-500 rounded-full shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const isBalanced = (editingEntry?.debitAmount || 0) === (editingEntry?.creditAmount || 0);
  const balanceDiff = (editingEntry?.debitAmount || 0) - (editingEntry?.creditAmount || 0);

  return (
    <div className="bg-white p-0 md:p-3 rounded-2xl border border-[#ccc9ca] mx-auto print-area w-full max-w-none shadow-sm">
      {/* Header */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-0 md:mb-3 border-b border-[#ccc9ca] md:pb-2.5 gap-3 px-3 py-2.5 md:px-2">
        <div className="flex items-center justify-between w-full md:w-auto gap-4">
          <div className="flex items-center gap-2 md:gap-4">
            <h2 className="text-lg md:text-xl text-[#1b1c1d] font-bold">仕訳帳</h2>
            <div className="flex items-center bg-[#f5f3f4] rounded-xl px-3 py-1.5 gap-1.5 border border-[#e4e2e3]">
              <CalendarRange className="w-4 h-4 text-[#74777d]" />
              <select value={localYear} onChange={(e) => { setLocalYear(e.target.value === 'ALL' ? 'ALL' : parseInt(e.target.value)); setCurrentPage(1); }}
                className="bg-transparent text-xs font-bold text-[#44474c] outline-none cursor-pointer">
                <option value="ALL">全期間</option>
                {Array.from({ length: 10 }, (_, i) => currentYear + 1 - i).map(year => (
                  <option key={year} value={year}>{year}年</option>
                ))}
              </select>
            </div>
            <span className="bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full text-[11px] font-bold border border-blue-100">{filteredEntries.length} 件</span>
          </div>
          <div className="flex md:hidden items-center gap-2">
            <button onClick={() => setIsFilterOpen(!isFilterOpen)}
              className={`w-8 h-8 flex items-center justify-center rounded-full border transition-colors ${isFilterOpen ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-200 text-gray-500'}`}>
              <Filter className="w-4 h-4" />
            </button>
            <button onClick={openImportModal} className="w-8 h-8 flex items-center justify-center border border-gray-300 bg-white text-gray-600 rounded-full">
              <Upload className="w-4 h-4" />
            </button>
            <button onClick={openAddModal} className="w-8 h-8 flex items-center justify-center bg-[#003580] text-white rounded-full">
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="hidden md:flex flex-wrap items-center gap-3 w-full xl:w-auto no-print">
          <div className="relative flex-grow md:max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input type="text" placeholder="全項目内を検索..." value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="pl-9 pr-4 py-2 bg-[#f5f3f4] border border-[#e4e2e3] rounded-xl text-xs w-full focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none transition-colors" />
          </div>
          <button onClick={() => setIsFilterOpen(!isFilterOpen)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border transition-all ${isFilterOpen ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white text-[#44474c] border-[#ccc9ca] hover:bg-[#f5f3f4]'}`}>
            <Filter className="w-4 h-4" /> 絞り込み
          </button>
          <button onClick={openAddModal} className="flex items-center gap-1.5 px-4 py-2 bg-[#003580] hover:bg-brand-750 text-white rounded-xl text-xs font-bold active:scale-95 transition-all shadow-sm">
            <Plus className="w-4 h-4" />追加
          </button>
          <button onClick={openImportModal} className="flex items-center gap-1.5 px-3.5 py-2 bg-white text-[#44474c] border border-[#ccc9ca] rounded-xl text-xs font-semibold hover:bg-[#f5f3f4] active:scale-95 transition-all">
            <Upload className="w-4 h-4" />CSV取込
          </button>
          <button onClick={() => setShowAllForPrint(!showAllForPrint)}
            className={`px-3.5 py-2 rounded-xl text-xs border font-semibold transition-all ${showAllForPrint ? 'bg-[#041627] text-white border-[#041627]' : 'bg-white text-[#44474c] border-[#ccc9ca] hover:bg-[#f5f3f4]'}`}>
            {showAllForPrint ? "ページ表示に戻す" : "全件印刷モード"}
          </button>
        </div>
        <div className="md:hidden w-full relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
          <input type="text" placeholder="検索..." value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
            className="pl-8 pr-3 py-2 bg-[#f5f3f4] border border-[#e4e2e3] rounded-xl text-xs w-full outline-none focus:bg-white text-[#1b1c1d]" />
        </div>
      </div>

      {/* Filter panel */}
      {isFilterOpen && (
        <div className="bg-[#f5f3f4]/50 border-b border-[#e4e2e3] p-4 rounded-2xl mb-4 no-print transition-all">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: '日付 (YYYY/MM)', key: 'date', placeholder: '例: 2026/01' },
              { label: '科目 (借方/貸方)', key: 'account', placeholder: '例: 接待, 売上...' },
              { label: '金額', key: 'amount', placeholder: '例: 1000, >5000' },
              { label: '摘要', key: 'description', placeholder: 'キーワード...' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-[10px] font-bold text-[#74777d] mb-1">{f.label}</label>
                <input type="text" value={filters[f.key as keyof typeof filters]}
                  onChange={e => { setFilters({ ...filters, [f.key]: e.target.value }); setCurrentPage(1); }}
                  placeholder={f.placeholder}
                  className="w-full px-3 py-2 bg-white border border-[#ccc9ca] rounded-lg text-xs focus:ring-1 focus:ring-blue-500 outline-none text-[#1b1c1d]" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mobile list */}
      <div className="lg:hidden bg-white divide-y divide-[#f5f3f4] mb-20">
        {displayedEntries.map((entry, idx) => {
          const isRevenue = ACCOUNT_TYPE_MAP[entry.creditAccount] === AccountType.Revenue;
          const dateParts = entry.date ? entry.date.split('/') : [];
          const year = dateParts[0] ? dateParts[0].slice(-2) : '--';
          const month = dateParts[1] || '--';
          const day = dateParts[2] || '--';
          return (
            <div key={`${entry.id}-${idx}`} className={`flex items-center gap-3 p-3.5 transition-all ${entry.isUnbalanced ? 'bg-rose-50/50' : 'bg-white'}`}>
              <div onClick={() => openEditModal(entry)} className="flex flex-col items-center justify-center w-[46px] h-10 bg-[#f5f3f4] rounded-lg text-[#74777d] shrink-0 border border-[#e4e2e3] cursor-pointer">
                <span className="text-[10px] font-bold leading-none">{year}{month}{day}</span>
              </div>
              <div onClick={() => openEditModal(entry)} className="flex-1 min-w-0 grid gap-0.5 cursor-pointer">
                <div className="flex items-center gap-2">
                  {entry.isUnbalanced && <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />}
                  {entry.rawData?.['プロパティ名'] && (
                    <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100 text-[9px] font-bold truncate max-w-[90px] shrink-0">{entry.rawData['プロパティ名']}</span>
                  )}
                  <p className="text-xs font-bold text-[#1b1c1d] truncate">{entry.description || "(摘要なし)"}</p>
                </div>
                <div className="flex items-center text-[10px] text-[#74777d] gap-1 truncate">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] truncate max-w-[80px] ${isRevenue ? 'bg-[#f5f3f4]' : 'bg-blue-50 text-blue-700 font-semibold border border-blue-100'}`}>{entry.debitAccount}</span>
                  <span className="text-gray-300">&rarr;</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] truncate max-w-[80px] ${isRevenue ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-100' : 'bg-[#f5f3f4]'}`}>{entry.creditAccount}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className={`text-xs font-bold font-mono whitespace-nowrap ${isRevenue ? 'text-blue-600' : 'text-[#1b1c1d]'}`}>{formatCurrency(entry.debitAmount)}</div>
                <button onClick={(e) => { e.stopPropagation(); setPreviewEntry(entry); }} className="p-1.5 text-[#74777d] hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors" title="証憑確認">
                  <FileImage className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
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
              {(allProperties ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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

      {/* Desktop table */}
      <div className="hidden lg:block w-full overflow-hidden rounded-xl border border-[#8f8d8e]">
        <table className="w-full text-[11px] border-collapse font-sans table-fixed">
          <thead>
            <tr className="bg-[#f5f3f4] text-[#44474c]">
              <th className="py-2 px-1 text-center w-[36px] border border-[#8f8d8e] no-print">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                  className="w-3.5 h-3.5 accent-blue-600 cursor-pointer align-middle" title="全選択" />
              </th>
              {displayHeaders.map((header, i) => {
                const isSorted = sortConfig?.key === header;
                const widthClass = COLUMN_WIDTHS[header] ?? '';
                return (
                  <th key={i} onClick={() => handleSort(header)}
                    className={`py-2 px-2 font-bold border border-[#8f8d8e] cursor-pointer hover:bg-[#e4e2e3] select-none group text-center ${widthClass}`}>
                    <div className="flex items-center justify-center gap-1">
                      <span className="truncate">{header}</span>
                      {isSorted ? (sortConfig?.direction === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />) : <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-50 text-slate-400" />}
                    </div>
                  </th>
                );
              })}
              <th className="py-2 px-2 text-center w-[52px] border border-[#8f8d8e] no-print">証憑</th>
              <th className="py-2 px-2 text-center w-[88px] sticky right-0 bg-[#f5f3f4] border border-[#8f8d8e] z-10 no-print">操作</th>
            </tr>
          </thead>
          <tbody className="text-[#1b1c1d]">
            {displayedEntries.map((entry, idx) => {
              const isRevenue = ACCOUNT_TYPE_MAP[entry.creditAccount] === AccountType.Revenue;
              const rowClass = entry.isUnbalanced ? "bg-rose-50" : isRevenue ? "bg-green-50/20" : (idx % 2 === 0 ? "bg-white" : "bg-[#f5f3f4]/10");
              return (
                <tr key={`${entry.id}-${idx}`} className={`transition-colors group hover:bg-[#f5f3f4]/35 ${selectedIds.has(entryDbId(entry)) ? 'bg-blue-50/60' : rowClass}`}>
                  <td className="py-1.5 px-1 text-center border border-[#8f8d8e] no-print">
                    <input type="checkbox" checked={selectedIds.has(entryDbId(entry))} onChange={() => toggleSelect(entryDbId(entry))}
                      disabled={!entryDbId(entry)} className="w-3.5 h-3.5 accent-blue-600 cursor-pointer align-middle" />
                  </td>
                  {displayHeaders.map((header, i) => (
                    <td key={i} className={`py-1.5 px-2 border border-[#8f8d8e] break-words leading-tight ${isNumericColumn(header) ? 'text-right font-mono font-semibold' : 'text-left'}`}>
                      {renderCellContent(header, entry.rawData[header] || "", entry)}
                    </td>
                  ))}
                  <td className="py-1.5 px-2 text-center border border-[#8f8d8e] no-print">
                    <button onClick={(e) => { e.stopPropagation(); setPreviewEntry(entry); }} className="p-1.5 text-[#74777d] hover:text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors" title="証憑確認"><FileImage className="w-3.5 h-3.5" /></button>
                  </td>
                  <td className="py-1.5 px-2 text-center sticky right-0 bg-inherit border border-[#8f8d8e] z-10 no-print">
                    <div className="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEditModal(entry)} className="p-1.5 text-[#74777d] hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors" title="編集"><Edit2 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => handleDelete({ ...entry, _dbId: entry.rawData['_id'] })} className="p-1.5 text-[#74777d] hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors" title="削除"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!showAllForPrint && totalPages > 1 && (
        <div className="flex justify-between items-center mt-3 pt-3 border-t border-[#ccc9ca] no-print gap-4 pb-20 md:pb-0">
          <div className="text-xs text-[#74777d]">{(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, filteredEntries.length)} / {filteredEntries.length} 件</div>
          <div className="flex items-center gap-1">
            <button onClick={() => { setCurrentPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={currentPage === 1}
              className="p-2 border border-[#ccc9ca] rounded-xl bg-white text-[#44474c] disabled:opacity-30 hover:bg-[#f5f3f4] transition-colors"><ChevronLeft className="w-4 h-4" /></button>
            <div className="flex items-center px-3 py-1.5 text-xs font-bold text-[#44474c] bg-[#f5f3f4] rounded-xl border border-[#ccc9ca]">{currentPage} / {totalPages}</div>
            <button onClick={() => { setCurrentPage(p => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }} disabled={currentPage === totalPages}
              className="p-2 border border-[#ccc9ca] rounded-xl bg-white text-[#44474c] disabled:opacity-30 hover:bg-[#f5f3f4] transition-colors"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* Account picker */}
      {renderAccountPicker()}

      {/* Edit modal */}
      {isModalOpen && !accountPickerState.isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm no-print font-sans animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col h-auto max-h-[85vh]">
            <div className="px-4 py-3 bg-[#f5f3f4] border-b border-[#ccc9ca] flex justify-between items-center sticky top-0 z-10 flex-shrink-0">
              <div>
                <h3 className="font-bold text-[#1b1c1d] text-sm">{editingEntry?._dbId ? "仕訳取引を編集" : "新規仕訳取引を登録"}</h3>
                {/* New entry + multiple properties selected → require choosing the target property. */}
                {!editingEntry?._dbId && isMultiProperty ? (
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-rose-600">記帳先:</span>
                    <select
                      value={writeTargetId}
                      onChange={e => setWriteTargetId(e.target.value)}
                      className="px-2 py-1 bg-white border border-rose-300 rounded-lg text-[11px] font-bold text-[#1b1c1d] outline-none focus:ring-1 focus:ring-rose-400"
                    >
                      {writeTargetOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                ) : (
                  (editingEntry?.rawData?.['プロパティ名'] || propertyName) &&
                    <p className="text-[10px] text-[#74777d] mt-0.5">{editingEntry?.rawData?.['プロパティ名'] || propertyName}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {editingEntry?._dbId && (
                  <button onClick={() => handleDelete(editingEntry)} className="text-rose-500 p-2 md:hidden hover:bg-rose-50 rounded-full"><Trash2 className="w-5 h-5" /></button>
                )}
                <button onClick={() => setIsModalOpen(false)} className="text-[#74777d] hover:text-[#1b1c1d] p-1 hover:bg-slate-200 rounded-full transition-colors"><X className="w-5 h-5" /></button>
              </div>
            </div>
            <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
              <div className="p-4 overflow-y-auto flex-1 space-y-3">
                <div className="flex justify-center mb-2">
                  <div className="bg-[#f5f3f4] p-1 rounded-xl flex w-full md:w-auto border border-[#e4e2e3]">
                    {(['expense', 'revenue'] as const).map(type => (
                      <button key={type} type="button" onClick={() => handleTransactionTypeChange(type)}
                        className={`flex-1 md:flex-none flex items-center justify-center gap-1.5 px-6 py-2 rounded-lg text-xs font-bold transition-all ${transactionType === type ? 'bg-white shadow-sm ring-1 ring-slate-200/50 ' + (type === 'expense' ? 'text-rose-600' : 'text-blue-600') : 'text-[#74777d]'}`}>
                        {type === 'expense' ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
                        {type === 'expense' ? '支出 (経費)' : '収入 (売上)'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-2">
                  <div>
                    <label className="block text-xs font-bold text-[#44474c] mb-1">取引日</label>
                    <input type="date" required value={(editingEntry?.date || '').replace(/\//g, '-')}
                      onChange={e => setEditingEntry(prev => ({ ...prev, date: e.target.value.replace(/-/g, '/') }))}
                      className="w-full px-3 py-2 bg-[#f5f3f4] border border-[#e4e2e3] rounded-lg focus:ring-1 focus:ring-blue-500 outline-none font-mono text-xs text-[#1b1c1d]" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-[#44474c] mb-1">摘要 (内容)</label>
                    <input type="text" required value={editingEntry?.description || ''}
                      onChange={e => setEditingEntry(prev => ({ ...prev, description: e.target.value }))}
                      className="w-full px-3 py-2 bg-[#f5f3f4] border border-[#e4e2e3] rounded-lg focus:ring-1 focus:ring-blue-500 outline-none text-xs text-[#1b1c1d]" placeholder="取引の内容を入力..." />
                  </div>
                </div>

                {/* Receipt upload */}
                <div className="mb-2">
                  <label className="block text-xs font-bold text-[#44474c] mb-1">領収書 / 証憑</label>
                  <input
                    ref={receiptInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleReceiptUpload(f); e.target.value = ''; }}
                  />
                  {editingEntry?.receiptUrl ? (
                    <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                      <FileImage className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="text-[10px] text-emerald-700 font-semibold flex-1 truncate">
                        {receiptOcr ? 'アップロード完了 · OCR処理済' : '証憑あり'}
                      </span>
                      <button type="button"
                        onClick={() => setPreviewEntry({ ...editingEntry as JournalEntry, rawData: { '証憑': editingEntry.receiptUrl || '' } })}
                        className="text-[10px] text-emerald-700 font-bold hover:underline shrink-0">確認</button>
                      <button type="button"
                        onClick={() => receiptInputRef.current?.click()}
                        className="text-[10px] text-[#74777d] hover:text-[#1b1c1d] font-semibold shrink-0">変更</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => receiptInputRef.current?.click()}
                      disabled={isUploadingReceipt}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-[#ccc9ca] rounded-xl text-xs text-[#74777d] hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-60"
                    >
                      {isUploadingReceipt ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /><span>アップロード中 · OCR処理中...</span></>
                      ) : (
                        <><Upload className="w-4 h-4" /><span>領収書をアップロード (JPEG / PNG · 自動OCR)</span></>
                      )}
                    </button>
                  )}
                  {receiptOcr && (
                    <div className="mt-2 p-2.5 bg-blue-50 border border-blue-100 rounded-xl text-[10px] text-blue-800 space-y-0.5">
                      <p className="font-bold text-blue-600 mb-1">OCR 読取結果 (自動入力済)</p>
                      {receiptOcr.vendor && <p>店舗: <span className="font-semibold">{receiptOcr.vendor}</span></p>}
                      {receiptOcr.transactionDate && <p>日付: <span className="font-semibold">{receiptOcr.transactionDate}</span></p>}
                      {receiptOcr.amount && <p>金額: <span className="font-semibold">{receiptOcr.amount.toLocaleString()}円</span></p>}
                      {receiptOcr.suggestedDebitAccount && <p>科目提案: <span className="font-semibold">{receiptOcr.suggestedDebitAccount}</span></p>}
                    </div>
                  )}
                </div>
                
                <div className="bg-[#f5f3f4] p-4 rounded-xl border border-[#e4e2e3]">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#e4e2e3] hidden md:block -translate-x-1/2" />
                    
                    {/* Debit */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-1.5 border-b border-[#e4e2e3] pb-1.5">
                        <span className="w-1.5 h-3.5 bg-brand-500 rounded-full" />
                        <span className="font-bold text-xs text-[#1b1c1d]">借方 (Debit)</span>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">借方勘定科目</label>
                        <div className="relative">
                          <input type="text" required readOnly
                            value={editingEntry?.debitAccount || ''}
                            onClick={() => openAccountPicker('debit')}
                            className="w-full px-3 py-2 bg-white border border-[#e4e2e3] rounded-lg text-xs cursor-pointer hover:bg-slate-50 text-blue-900 font-bold outline-none"
                            placeholder="選択してください" />
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">金額 (円)</label>
                        <input type="number" inputMode="numeric" required
                          value={editingEntry?.debitAmount || ''}
                          onChange={e => {
                            const val = parseInt(e.target.value) || 0;
                            setEditingEntry(prev => ({ ...prev, debitAmount: val, creditAmount: val })); // Auto balance match
                          }}
                          className="w-full px-3 py-2 bg-white border border-[#e4e2e3] rounded-lg focus:ring-1 focus:ring-blue-500 outline-none font-mono text-right text-xs font-bold text-[#1b1c1d]" />
                      </div>
                    </div>

                    {/* Credit */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-1.5 border-b border-[#e4e2e3] pb-1.5">
                        <span className="w-1.5 h-3.5 bg-rose-500 rounded-full" />
                        <span className="font-bold text-xs text-[#1b1c1d]">貸方 (Credit)</span>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">貸方勘定科目</label>
                        <div className="relative">
                          <input type="text" required readOnly
                            value={editingEntry?.creditAccount || ''}
                            onClick={() => openAccountPicker('credit')}
                            className="w-full px-3 py-2 bg-white border border-[#e4e2e3] rounded-lg text-xs cursor-pointer hover:bg-slate-50 text-rose-900 font-bold outline-none"
                            placeholder="選択してください" />
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-500 mb-1">金額 (円)</label>
                        <input type="number" inputMode="numeric" required
                          value={editingEntry?.creditAmount || ''}
                          onChange={e => {
                            const val = parseInt(e.target.value) || 0;
                            setEditingEntry(prev => ({ ...prev, creditAmount: val, debitAmount: val })); // Auto balance match
                          }}
                          className="w-full px-3 py-2 bg-white border border-[#e4e2e3] rounded-lg focus:ring-1 focus:ring-blue-500 outline-none font-mono text-right text-xs font-bold text-[#1b1c1d]" />
                      </div>
                    </div>
                  </div>
                  
                  {!isBalanced && (
                    <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2">
                      <AlertCircle className="w-5 h-5 text-rose-600" />
                      <div className="text-rose-800 text-xs">
                        <p className="font-bold">貸借不一致</p>
                        <p className="opacity-90">差額: <span className="font-mono font-bold">{formatCurrency(Math.abs(balanceDiff))}</span></p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="px-5 py-4 border-t border-[#e4e2e3] flex gap-3 bg-[#f5f3f4] flex-shrink-0">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 px-4 py-2.5 bg-white border border-[#ccc9ca] text-[#44474c] rounded-xl font-bold hover:bg-[#f5f3f4] text-xs transition-colors">キャンセル</button>
                <button type="submit" disabled={isSubmitting || !isBalanced}
                  className="flex-[2] px-4 py-2.5 bg-[#003580] hover:bg-brand-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm text-xs transition-all">
                  {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {isBalanced ? "保存" : "不一致"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Hidden CSV file input */}
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); e.target.value = ''; }}
      />

      {/* CSV Import modal */}
      {isImportOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm no-print font-sans animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 bg-[#f5f3f4] border-b border-[#e4e2e3] flex justify-between items-center flex-shrink-0">
              <h3 className="font-bold text-[#1b1c1d] text-sm flex items-center gap-2"><Upload className="w-5 h-5 text-[#003580]" />CSV取込</h3>
              <button onClick={() => setIsImportOpen(false)} className="text-[#74777d] hover:text-[#1b1c1d] p-1 hover:bg-slate-200 rounded-full transition-colors"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-6 flex-1 overflow-y-auto space-y-4">
              {!importResult && isMultiProperty && (
                <div className="flex items-center gap-2 p-3 bg-rose-50 border border-rose-200 rounded-xl">
                  <span className="text-xs font-bold text-rose-700 shrink-0">取込先プロパティ:</span>
                  <select
                    value={writeTargetId}
                    onChange={e => setWriteTargetId(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 bg-white border border-rose-300 rounded-lg text-xs font-bold text-[#1b1c1d] outline-none focus:ring-1 focus:ring-rose-400"
                  >
                    {writeTargetOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              )}
              {!importResult && (
                <div
                  className="border-2 border-dashed border-[#ccc9ca] rounded-2xl p-8 text-center hover:border-blue-400 hover:bg-blue-50/20 transition-all cursor-pointer"
                  onClick={() => csvInputRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleCsvFile(f); }}
                >
                  <Upload className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                  <p className="font-bold text-[#1b1c1d] mb-1 text-xs">CSVファイルを選択またはドロップ</p>
                  <p className="text-[10px] text-[#74777d]">列: 取引No, 取引日, 借方勘定科目, 借方金額(円), 貸方勘定科目, 貸方金額(円), 摘要</p>
                </div>
              )}

              {importError && (
                <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-xs">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{importError}
                </div>
              )}

              {importResult && (
                <div className="flex flex-col items-center gap-3 py-6 text-center">
                  <CheckCircle2 className="w-14 h-14 text-emerald-500" />
                  <p className="text-base font-bold text-slate-800">{importResult.imported} 件をインポートしました</p>
                  <button onClick={() => setIsImportOpen(false)} className="mt-2 px-6 py-2.5 bg-[#003580] hover:bg-brand-700 text-white rounded-xl font-bold shadow-sm">閉じる</button>
                </div>
              )}

              {importRows.length > 0 && !importResult && (
                <div>
                  <p className="text-xs font-bold text-slate-700 mb-2">{importRows.length} 件のプレビュー</p>
                  <div className="overflow-x-auto rounded-xl border border-[#e4e2e3] max-h-64">
                    <table className="w-full text-xs border-collapse">
                      <thead className="bg-[#f5f3f4] sticky top-0 border-b border-[#ccc9ca]">
                        <tr>
                          {['取引日', '借方科目', '借方金額', '貸方科目', '貸方金額', '摘要'].map(h => (
                            <th key={h} className="px-2 py-2 text-left font-bold text-[#44474c] border-r border-[#ccc9ca]/50 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e4e2e3]/60 text-[#44474c] font-mono text-[11px]">
                        {importRows.slice(0, 50).map((row, i) => (
                          <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#f5f3f4]/10'}>
                            <td className="px-2 py-1.5 border-r border-[#ccc9ca]/30">{row.transactionDate}</td>
                            <td className="px-2 py-1.5 border-r border-[#ccc9ca]/30">{row.debitAccount}</td>
                            <td className="px-2 py-1.5 border-r border-[#ccc9ca]/30 text-right">{row.debitAmount.toLocaleString()}</td>
                            <td className="px-2 py-1.5 border-r border-[#ccc9ca]/30">{row.creditAccount}</td>
                            <td className="px-2 py-1.5 border-r border-[#ccc9ca]/30 text-right">{row.creditAmount.toLocaleString()}</td>
                            <td className="px-2 py-1.5 truncate max-w-[160px] font-sans">{row.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {importRows.length > 50 && <p className="text-[10px] text-gray-400 mt-1">... 他 {importRows.length - 50} 件</p>}
                </div>
              )}
            </div>

            {!importResult && (
              <div className="px-6 py-4 border-t border-[#e4e2e3] flex gap-3 bg-[#f5f3f4] flex-shrink-0">
                <button onClick={() => setIsImportOpen(false)} className="flex-1 px-4 py-2.5 bg-white border border-[#ccc9ca] text-[#44474c] rounded-xl font-bold hover:bg-[#f5f3f4] text-xs">キャンセル</button>
                {importRows.length === 0 ? (
                  <button onClick={() => csvInputRef.current?.click()} className="flex-[2] px-4 py-2.5 bg-[#003580] hover:bg-brand-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm">
                    <Upload className="w-4 h-4" />ファイルを選択
                  </button>
                ) : (
                  <button onClick={handleImport} disabled={isImporting} className="flex-[2] px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50">
                    {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {isImporting ? 'インポート中...' : `${importRows.length} 件をインポート`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Styled Mock Document / Receipt Preview Modal */}
      {previewEntry && (() => {
        const rawEvidence = previewEntry.rawData['証憑'] || previewEntry.rawData['URL'] || "";
        const url = extractUrl(rawEvidence);
        const embed = getEmbedUrl(url);

        return (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm no-print font-sans animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col relative">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#e4e2e3] bg-[#f5f3f4] flex-shrink-0">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-blue-50 border border-blue-100 rounded-xl text-blue-600">
                    <FileText className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-900 text-xs">証憑プレビュー</h3>
                </div>
                <button onClick={() => setPreviewEntry(null)} className="p-1.5 text-[#74777d] hover:text-[#1b1c1d] hover:bg-slate-200 rounded-full transition-colors"><X className="w-5 h-5" /></button>
              </div>

              <div className="flex-1 bg-[#f5f3f4]/50 flex items-center justify-center overflow-auto p-6 min-h-[340px]">
                {embed ? (
                  embed.type === 'image' ? (
                    <img src={embed.url} alt="Evidence" className="max-w-full max-h-[60vh] object-contain rounded-xl shadow-lg border border-[#e4e2e3] bg-white" />
                  ) : embed.type === 'drive' ? (
                    <div className="flex flex-col items-center gap-3 w-full">
                      <img
                        src={embed.imgUrl}
                        alt="Drive Evidence"
                        className="max-w-full max-h-[55vh] object-contain rounded-xl shadow-lg border border-[#e4e2e3] bg-white"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                      <a href={embed.openUrl} target="_blank" rel="noopener noreferrer"
                        className="px-5 py-2 bg-[#003580] hover:bg-brand-700 text-white text-xs font-bold rounded-xl inline-flex items-center gap-2 shadow-sm transition-all">
                        <ExternalLink className="w-4 h-4" /> Driveで開く
                      </a>
                    </div>
                  ) : embed.type === 'blocked' ? (
                    <div className="text-center p-8 bg-white rounded-2xl shadow-lg border border-[#e4e2e3] max-w-sm">
                      <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-4" />
                      <h4 className="text-sm font-bold text-slate-800 mb-2">非公開ストレージのためプレビュー不可</h4>
                      <p className="text-xs text-[#74777d]">署名付きURLまたはDrive共有リンクを設定してください。</p>
                    </div>
                  ) : (
                    <div className="text-center p-8 bg-white rounded-2xl shadow-lg border border-[#e4e2e3] max-w-sm">
                      <ExternalLink className="w-8 h-8 text-slate-400 mx-auto mb-4" />
                      <h4 className="text-sm font-bold text-slate-800 mb-2">プレビュー不可のファイル形式</h4>
                      <a href={url!} target="_blank" rel="noopener noreferrer"
                        className="px-6 py-2.5 bg-[#003580] hover:bg-brand-700 text-white text-xs font-bold rounded-xl inline-flex items-center gap-2 shadow-sm transition-all">
                        <Eye className="w-4 h-4" /> 別タブで開く
                      </a>
                    </div>
                  )
                ) : (
                  /* Elegant mockup receipt paper card */
                  <div className="bg-white p-6 rounded-xl shadow-md border border-[#ccc9ca] w-full max-w-xs text-xs text-[#44474c] font-mono space-y-4">
                    <div class="text-center pb-3 border-b border-dashed border-[#ccc9ca]">
                      <h4 class="font-bold text-[#1b1c1d] text-base tracking-widest">領 収 書</h4>
                      <p class="text-[9px] text-[#74777d] mt-1">Receipt Invoice</p>
                    </div>
                    <div>
                      <p class="text-[9px] text-[#74777d]">宛名 (Customer)</p>
                      <p class="font-bold text-[#1b1c1d] text-[13px]">Sachi House 御中</p>
                    </div>
                    <div class="py-2 border-y border-[#e4e2e3] flex justify-between items-center text-sm">
                      <span class="font-bold text-[#1b1c1d]">金額 (Amount)</span>
                      <span class="font-black text-blue-600 text-base">{formatCurrency(previewEntry.debitAmount)}</span>
                    </div>
                    <div class="space-y-1">
                      <div class="flex justify-between"><span class="text-[#74777d]">日付 (Date)</span><span>{previewEntry.date}</span></div>
                      <div class="flex justify-between"><span class="text-[#74777d]">但書 (Category)</span><span>{previewEntry.debitAccount}として</span></div>
                      <div class="flex justify-between"><span class="text-[#74777d]">摘要 (Memo)</span><span class="truncate max-w-[130px] font-sans" title={previewEntry.description}>{previewEntry.description || "-"}</span></div>
                    </div>
                    <div class="pt-4 border-t border-dashed border-[#ccc9ca] text-center">
                      <div class="inline-block border border-rose-400 text-rose-500 font-bold px-2.5 py-0.5 rounded text-[10px] rotate-[-5deg]">
                        領収済
                      </div>
                      <p class="text-[8px] text-[#74777d] mt-2">Mock Receipt ID: SH-{(previewEntry.id || 0) * 1000 + 492}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default Journal;
