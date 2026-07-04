import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Mail, Plus, Trash2, RefreshCw, Info } from 'lucide-react';
import { financeApi, FinancialProperty, IngestRule } from '../../services/finance';

interface Props {
  allProperties: FinancialProperty[];
}

// Admin screen: map an email address (the To address of a vendor receipt, or
// the Gmail account running the Apps Script bridge) to the property that
// should absorb the expense. Rules here override the env-var fallback.
const IngestRules: React.FC<Props> = ({ allProperties }) => {
  const [rules, setRules] = useState<IngestRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newPropertyId, setNewPropertyId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  const propertyName = (id: string) => allProperties.find(p => p.id === id)?.name ?? id;

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setRules(await financeApi.listIngestRules());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email || !newPropertyId) return;
    setIsSaving(true);
    setError(null);
    try {
      const saved = await financeApi.upsertIngestRule(email, newPropertyId);
      setRules(prev => {
        const others = prev.filter(r => r.email !== saved.email);
        return [...others, saved].sort((a, b) => a.email.localeCompare(b.email));
      });
      setNewEmail('');
      setNewPropertyId('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangeProperty = async (email: string, propertyId: string) => {
    setBusyEmail(email);
    setError(null);
    try {
      const saved = await financeApi.upsertIngestRule(email, propertyId);
      setRules(prev => prev.map(r => (r.email === email ? saved : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyEmail(null);
    }
  };

  const handleDelete = async (email: string) => {
    if (!window.confirm(`ルールを削除しますか？\n${email}`)) return;
    setBusyEmail(email);
    setError(null);
    try {
      await financeApi.deleteIngestRule(email);
      setRules(prev => prev.filter(r => r.email !== email));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyEmail(null);
    }
  };

  const canAdd = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim()) && !!newPropertyId && !isSaving;

  return (
    <div className="max-w-4xl space-y-4">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-[#ccc9ca] shadow-sm p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <Mail className="w-5 h-5 text-[#003580]" />
            <h2 className="text-base font-extrabold text-[#1b1c1d]">メール連携ルール</h2>
          </div>
          <button
            onClick={load}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#ccc9ca] rounded-lg text-xs font-bold text-gray-900 hover:bg-slate-100 disabled:opacity-40 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            更新
          </button>
        </div>
        <p className="mt-2.5 text-xs text-gray-600 leading-relaxed flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-blue-700" />
          <span>
            レシートメールの宛先（To）アドレス、または Apps Script を実行している Gmail アカウントが一致した場合、
            経費はここで指定したプロパティの「仕訳帳（未承認）」に登録されます。
            どのルールにも一致しない場合はデフォルト設定（環境変数）が使われます。
          </span>
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-xs font-semibold">
          {error}
        </div>
      )}

      {/* Add form */}
      <div className="bg-white rounded-2xl border border-[#ccc9ca] shadow-sm p-5">
        <p className="text-[11px] font-bold text-gray-800 uppercase tracking-widest mb-3">ルール追加</p>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="email"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            placeholder="host@example.com"
            className="flex-1 px-3 py-2.5 bg-white border border-[#ccc9ca] rounded-xl text-xs font-semibold text-gray-900 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 shadow-sm"
          />
          <select
            value={newPropertyId}
            onChange={e => setNewPropertyId(e.target.value)}
            className="flex-1 px-3 py-2.5 bg-white border border-[#ccc9ca] rounded-xl text-xs font-bold text-gray-900 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 shadow-sm cursor-pointer"
          >
            <option value="">プロパティを選択...</option>
            {allProperties.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            disabled={!canAdd}
            className="flex items-center justify-center gap-1.5 px-5 py-2.5 bg-[#003580] text-white rounded-xl text-xs font-bold hover:bg-blue-900 disabled:opacity-40 shadow-md transition-all"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            追加
          </button>
        </div>
      </div>

      {/* Rules table */}
      <div className="bg-white rounded-2xl border border-[#ccc9ca] shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-7 h-7 animate-spin" />
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-sm">
            ルールがまだありません。上のフォームから追加してください。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[#f5f3f4] border-b border-[#ccc9ca] text-left text-gray-800 h-10">
                  <th className="py-2.5 px-4 font-extrabold border-r border-[#ccc9ca]">メールアドレス</th>
                  <th className="py-2.5 px-4 font-extrabold border-r border-[#ccc9ca] w-64">プロパティ</th>
                  <th className="py-2.5 px-4 font-extrabold text-center w-20">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ccc9ca] text-gray-900 font-medium">
                {rules.map((rule, idx) => (
                  <tr key={rule.email} className={`h-12 ${idx % 2 === 0 ? 'bg-white' : 'bg-[#f5f3f4]/15'}`}>
                    <td className="py-2 px-4 font-mono text-[11px] border-r border-[#ccc9ca] break-all">{rule.email}</td>
                    <td className="py-2 px-4 border-r border-[#ccc9ca]">
                      <select
                        value={rule.propertyId}
                        disabled={busyEmail === rule.email}
                        onChange={e => handleChangeProperty(rule.email, e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-[#ccc9ca] rounded-lg text-xs font-bold text-gray-900 outline-none focus:border-blue-600 disabled:opacity-50 cursor-pointer"
                      >
                        {/* Keep an option visible even if the property is no longer accessible */}
                        {!allProperties.some(p => p.id === rule.propertyId) && (
                          <option value={rule.propertyId}>{propertyName(rule.propertyId)}</option>
                        )}
                        {allProperties.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-4 text-center">
                      <button
                        onClick={() => handleDelete(rule.email)}
                        disabled={busyEmail === rule.email}
                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md disabled:opacity-40 transition-colors"
                        title="削除"
                      >
                        {busyEmail === rule.email
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Trash2 className="w-4 h-4" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default IngestRules;
