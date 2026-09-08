import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { getInvoiceSettings, saveInvoiceSettings } from '../../services/invoices';
import { isValidRegistrationNumber } from '../../utils/invoiceDraft';
import { HostInvoiceSettings, InvoiceRoundingMode } from '../../types';

/**
 * The host's own issuer profile — the half of an invoice that is about them
 * rather than the guest.
 *
 * It lives here rather than in a server config because the registration number
 * is issued to a business, and a host runs their own: two hosts on this
 * deployment invoice under different numbers, and each must be able to set and
 * correct their own without an administrator in the loop.
 */

const fieldClass =
  'w-full h-12 px-3.5 rounded-control bg-subtle border border-line text-[16px] text-ink ' +
  'placeholder:text-ink-muted focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';
const labelClass = 'block text-[12px] font-semibold uppercase tracking-wide text-ink-soft mb-1.5';

const ROUNDING_OPTIONS: Array<{ value: InvoiceRoundingMode; label: string }> = [
  { value: 'floor', label: '切捨て / Round down' },
  { value: 'round', label: '四捨五入 / Round half up' },
  { value: 'ceil', label: '切上げ / Round up' },
];

export interface InvoiceSettingsSheetProps {
  onClose: () => void;
  /** Fired after a successful save, so the caller can retry whatever it was
   *  blocked on (usually: issuing the invoice that sent them here). */
  onSaved?: (settings: HostInvoiceSettings) => void;
}

export const InvoiceSettingsSheet: React.FC<InvoiceSettingsSheetProps> = ({ onClose, onSaved }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [archiveConfigured, setArchiveConfigured] = useState(false);

  const [registrationNumber, setRegistrationNumber] = useState('');
  const [issuerName, setIssuerName] = useState('');
  const [issuerAddress, setIssuerAddress] = useState('');
  const [issuerPhone, setIssuerPhone] = useState('');
  const [issuerEmail, setIssuerEmail] = useState('');
  const [bankInfo, setBankInfo] = useState('');
  const [invoicePrefix, setInvoicePrefix] = useState('INV');
  const [roundingMode, setRoundingMode] = useState<InvoiceRoundingMode>('floor');
  const [defaultNotes, setDefaultNotes] = useState('');

  useEffect(() => {
    let cancelled = false;
    getInvoiceSettings()
      .then(({ settings, archiveConfigured: archive }) => {
        if (cancelled) return;
        setArchiveConfigured(archive);
        if (settings) {
          setRegistrationNumber(settings.registrationNumber);
          setIssuerName(settings.issuerName);
          setIssuerAddress(settings.issuerAddress);
          setIssuerPhone(settings.issuerPhone ?? '');
          setIssuerEmail(settings.issuerEmail ?? '');
          setBankInfo(settings.bankInfo ?? '');
          setInvoicePrefix(settings.invoicePrefix);
          setRoundingMode(settings.roundingMode);
          setDefaultNotes(settings.defaultNotes ?? '');
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load your invoice settings.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const registrationValid = isValidRegistrationNumber(registrationNumber);

  const handleSave = async () => {
    if (!registrationValid) {
      setError('The registration number must be T followed by 13 digits.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { settings } = await saveInvoiceSettings({
        registrationNumber,
        issuerName: issuerName.trim(),
        issuerAddress: issuerAddress.trim(),
        issuerPhone: issuerPhone.trim() || undefined,
        issuerEmail: issuerEmail.trim() || undefined,
        bankInfo: bankInfo.trim() || undefined,
        invoicePrefix: invoicePrefix.trim() || undefined,
        roundingMode,
        defaultNotes: defaultNotes.trim() || undefined,
      });
      if (settings) onSaved?.(settings);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your invoice settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-brand/60 backdrop-blur-sm flex items-end animate-dialog-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full bg-surface rounded-t-[24px] max-h-[92dvh] overflow-y-auto animate-dialog-panel"
        style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Invoice settings"
      >
        <div className="pt-2.5 sticky top-0 bg-surface z-10">
          <div className="w-10 h-1 rounded-full bg-line-strong mx-auto" />
          <div className="flex items-start gap-2 px-5 pt-3 pb-3.5 border-b border-line">
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <h2 className="text-[20px] tracking-[-0.3px] truncate">Invoice settings</h2>
              <span className="text-[13px] text-ink-muted truncate">適格請求書発行事業者 · issuer profile</span>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1 -mr-1 mt-0.5">
              <X className="w-5 h-5 text-ink-soft" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-16 flex items-center justify-center text-ink-muted">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <div className="px-5 pt-4 flex flex-col gap-4">
            {error && (
              <div className="flex items-start gap-2.5 bg-danger-tint text-danger border border-danger/20
                rounded-control px-3.5 py-3 text-[13px]">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="flex-1 min-w-0">{error}</span>
              </div>
            )}

            <label className="block">
              <span className={labelClass}>登録番号 / Registration No. *</span>
              <input
                value={registrationNumber}
                onChange={(event) => setRegistrationNumber(event.target.value)}
                className={`${fieldClass} font-mono tracking-wide ${
                  registrationNumber && !registrationValid ? 'border-danger' : ''
                }`}
                placeholder="T1234567890123"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
              <span className="block mt-1.5 text-[12px] text-ink-muted leading-snug">
                The letter T plus your 13-digit corporate number. Without it the document is not a
                適格請求書 and the guest cannot claim the tax back.
              </span>
            </label>

            <label className="block">
              <span className={labelClass}>発行者名 / Issuer name *</span>
              <input
                value={issuerName}
                onChange={(event) => setIssuerName(event.target.value)}
                className={fieldClass}
                placeholder="株式会社サチハウス"
              />
            </label>

            <label className="block">
              <span className={labelClass}>住所 / Address *</span>
              <textarea
                value={issuerAddress}
                onChange={(event) => setIssuerAddress(event.target.value)}
                rows={2}
                className={`${fieldClass} h-auto py-2.5`}
                placeholder="東京都豊島区..."
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelClass}>電話 / Phone</span>
                <input
                  value={issuerPhone}
                  onChange={(event) => setIssuerPhone(event.target.value)}
                  type="tel"
                  inputMode="tel"
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>メール / Email</span>
                <input
                  value={issuerEmail}
                  onChange={(event) => setIssuerEmail(event.target.value)}
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  className={fieldClass}
                />
              </label>
            </div>

            <label className="block">
              <span className={labelClass}>お振込先 / Bank details</span>
              <textarea
                value={bankInfo}
                onChange={(event) => setBankInfo(event.target.value)}
                rows={2}
                className={`${fieldClass} h-auto py-2.5`}
                placeholder="〇〇銀行 △△支店 普通 1234567"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelClass}>番号の接頭辞 / Prefix</span>
                <input
                  value={invoicePrefix}
                  onChange={(event) => setInvoicePrefix(event.target.value)}
                  className={fieldClass}
                  placeholder="INV"
                  autoCapitalize="characters"
                />
              </label>
              <label className="block">
                <span className={labelClass}>端数処理 / Rounding</span>
                <select
                  value={roundingMode}
                  onChange={(event) => setRoundingMode(event.target.value as InvoiceRoundingMode)}
                  className={`${fieldClass} pr-8`}
                >
                  {ROUNDING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="-mt-2 text-[12px] text-ink-muted leading-snug">
              The tax is rounded once per rate per invoice, as the NTA requires. Pick one and keep it —
              switching between invoices is what an auditor notices.
            </p>

            <label className="block">
              <span className={labelClass}>既定の備考 / Default notes</span>
              <textarea
                value={defaultNotes}
                onChange={(event) => setDefaultNotes(event.target.value)}
                rows={2}
                className={`${fieldClass} h-auto py-2.5`}
              />
            </label>

            {/* The archive bucket is server configuration, not something a host
                types — but whether one exists changes what they should do with
                the file they just downloaded, so it is stated here. */}
            <div className="rounded-control border border-line bg-subtle px-3.5 py-3">
              <span className="block text-[12px] font-semibold uppercase tracking-wide text-ink-soft mb-1">
                控えの保存 / Archive copy
              </span>
              <span className="block text-[13px] text-ink-soft leading-snug">
                {archiveConfigured
                  ? 'Issued PDFs are kept in Cloud Storage as well as downloaded to your phone.'
                  : 'No archive bucket on this server — your download is the only copy, so keep it somewhere safe.'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => { void handleSave(); }}
              disabled={saving || !registrationValid || !issuerName.trim() || !issuerAddress.trim()}
              className="h-13 min-h-[52px] rounded-control bg-brand text-white
                font-['Plus_Jakarta_Sans'] text-[15px] font-bold flex items-center justify-center gap-2
                disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default InvoiceSettingsSheet;
