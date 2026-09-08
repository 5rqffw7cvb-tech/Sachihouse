import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { ApiError } from '../../services/api';
import { archiveInvoicePdf, createInvoice, getInvoiceSettings, listInvoiceStays } from '../../services/invoices';
import { downloadAndCaptureInvoicePdf } from '../../utils/invoicePdf';
import {
  buildInvoiceDraft,
  computeInvoiceTotals,
  DraftLineItem,
  draftLine,
  formatYen,
  InvoiceDraft,
  TAX_CATEGORY_LABELS,
  TAX_CATEGORY_ORDER,
} from '../../utils/invoiceDraft';
import { HostProperty } from '../../services/hostApp';
import {
  HostInvoiceSettings,
  Invoice,
  InvoiceCandidate,
  InvoiceRoundingMode,
  InvoiceTaxCategory,
} from '../../types';
import { InvoiceSettingsSheet } from './InvoiceSettingsSheet';

/**
 * Issue a qualified invoice from a stay, on a phone.
 *
 * Same two-step shape as QuoteSheet — pick, then commit — because it is the
 * same situation: the host is mid-conversation with a guest who has just asked
 * for a 領収書/請求書, and the fastest correct answer wins.
 *
 * Three things it deliberately does not assume:
 *
 *  - That the stay came from us. Every booking on the property is listed,
 *    Airbnb and Booking.com included. Those arrive over iCal with no guest name
 *    and no price, so the amounts open blank for the host to type rather than
 *    being hidden from the list.
 *  - That the booking's guest name is the right 宛名. When the guest filled in
 *    the check-in form, that name and address are used instead — it is the only
 *    verified one in the system.
 *  - That the archive bucket is reachable. The PDF is always downloaded to the
 *    phone; the Cloud Storage copy is an extra that reports its own failure
 *    without costing the host the document.
 */

const fieldClass =
  'w-full h-12 px-3.5 rounded-control bg-subtle border border-line text-[16px] text-ink ' +
  'placeholder:text-ink-muted focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15';
const labelClass = 'block text-[12px] font-semibold uppercase tracking-wide text-ink-soft mb-1.5';

export interface InvoiceSheetProps {
  properties: HostProperty[];
  onClose: () => void;
}

/** Where the PDF ended up, which is what the success screen has to explain. */
type FilingState =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'filed'; link: string }
  | { kind: 'downloaded' }
  | { kind: 'failed'; message: string };

export const InvoiceSheet: React.FC<InvoiceSheetProps> = ({ properties, onClose }) => {
  const [step, setStep] = useState<'pick' | 'edit'>('pick');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<InvoiceCandidate[]>([]);
  const [settings, setSettings] = useState<HostInvoiceSettings | null>(null);
  const [archiveConfigured, setArchiveConfigured] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [propertyFilter, setPropertyFilter] = useState<string>('all');
  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set when the server refused because this stay already has an invoice. The
  // next press re-sends with allowDuplicate, so a genuine reissue is two
  // deliberate taps rather than one accidental one.
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const [created, setCreated] = useState<Invoice | null>(null);
  const [filing, setFiling] = useState<FilingState>({ kind: 'idle' });

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([listInvoiceStays(), getInvoiceSettings()])
      .then(([stays, settingsResponse]) => {
        if (cancelled) return;
        setCandidates(stays);
        setSettings(settingsResponse.settings);
        setArchiveConfigured(settingsResponse.archiveConfigured);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load your bookings.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const visible = useMemo(
    () => (propertyFilter === 'all'
      ? candidates
      : candidates.filter((row) => row.propertyId === propertyFilter)),
    [candidates, propertyFilter],
  );

  const roundingMode: InvoiceRoundingMode = settings?.roundingMode ?? 'floor';
  const totals = useMemo(
    () => computeInvoiceTotals(draft?.lineItems ?? [], roundingMode),
    [draft?.lineItems, roundingMode],
  );

  const patchDraft = (patch: Partial<InvoiceDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const patchLine = (key: string, patch: Partial<DraftLineItem>) => {
    setDraft((current) => (current
      ? { ...current, lineItems: current.lineItems.map((line) => (line.key === key ? { ...line, ...patch } : line)) }
      : current));
  };

  const openStay = (candidate: InvoiceCandidate) => {
    setDraft(buildInvoiceDraft(candidate, {
      defaultTaxCategory: settings?.defaultTaxCategory,
      defaultNotes: settings?.defaultNotes,
    }));
    setDuplicateWarning(null);
    setError(null);
    setStep('edit');
  };

  /**
   * Issue, then render, then file — in that order and never merged.
   *
   * The invoice number only exists once the server has committed the row, and
   * that number has to be printed on the PDF, so the PDF cannot be made first.
   * Archiving then happens against a document that already exists, which is
   * why a storage failure below is reported rather than thrown.
   */
  const handleIssue = async (allowDuplicate = false) => {
    if (!draft) return;
    const customerName = draft.customerName.trim();
    if (!customerName) {
      setError('An invoice has to name who it is issued to (宛名).');
      return;
    }
    if (totals.totalAmount <= 0) {
      setError('Fill in the amounts — the invoice total must be more than zero.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const { invoice } = await createInvoice({
        propertyId: draft.candidate.propertyId,
        sourceKind: draft.candidate.sourceKind,
        sourceId: draft.candidate.sourceId ?? undefined,
        sourceLabel: draft.candidate.sourceLabel,
        checkInDate: draft.candidate.checkInDate,
        checkOutDate: draft.candidate.checkOutDate,
        customerName,
        customerAddress: draft.customerAddress.trim() || undefined,
        customerEmail: draft.customerEmail.trim() || undefined,
        customerPhone: draft.customerPhone.trim() || undefined,
        customerSource: draft.customerSource,
        checkInSubmissionId: draft.candidate.checkIn?.submissionId,
        issueDate: draft.issueDate,
        currency: draft.candidate.currency,
        lineItems: draft.lineItems.map(({ key: _key, ...line }) => line),
        notes: draft.notes.trim() || undefined,
        allowDuplicate,
      });

      setCreated(invoice);
      setDuplicateWarning(null);
      setFiling({ kind: 'working' });

      const { base64 } = await downloadAndCaptureInvoicePdf(invoice);
      if (!archiveConfigured) {
        setFiling({ kind: 'downloaded' });
        return;
      }
      try {
        const archived = await archiveInvoicePdf(invoice.id, base64);
        setCreated(archived);
        setFiling({ kind: 'filed', link: archived.pdfUrl ?? '' });
      } catch (cause) {
        setFiling({
          kind: 'failed',
          message: cause instanceof Error ? cause.message : 'The PDF was not archived.',
        });
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setDuplicateWarning(cause.message);
      } else if (cause instanceof ApiError
        && (cause.body as { code?: string } | undefined)?.code === 'INVOICE_SETTINGS_MISSING') {
        setError(cause.message);
        setShowSettings(true);
      } else {
        setError(cause instanceof Error ? cause.message : 'Could not issue the invoice.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const header = (title: string, subtitle: string, back?: () => void) => (
    <div className="pt-2.5 sticky top-0 bg-surface z-10">
      <div className="w-10 h-1 rounded-full bg-line-strong mx-auto" />
      <div className="flex items-start gap-2 px-5 pt-3 pb-3.5 border-b border-line">
        {back && (
          <button type="button" onClick={back} aria-label="Back" className="shrink-0 p-1 -ml-1 mt-0.5">
            <ArrowLeft className="w-5 h-5 text-ink-soft" />
          </button>
        )}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <h2 className="text-[20px] tracking-[-0.3px] truncate">{title}</h2>
          <span className="text-[13px] text-ink-muted truncate">{subtitle}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1 -mr-1 mt-0.5">
          <X className="w-5 h-5 text-ink-soft" />
        </button>
      </div>
    </div>
  );

  const errorBanner = error && (
    <div className="flex items-start gap-2.5 bg-danger-tint text-danger border border-danger/20
      rounded-control px-3.5 py-3 text-[13px]">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span className="flex-1 min-w-0">{error}</span>
    </div>
  );

  const successBody = created && (
    <>
      {header('請求書を発行しました', created.invoiceNo)}
      <div className="px-5 pt-6 flex flex-col items-center text-center gap-3">
        <div className="w-16 h-16 rounded-full bg-ok-tint text-ok flex items-center justify-center">
          <CheckCircle2 className="w-9 h-9" />
        </div>
        <p className="text-[16px] font-semibold text-ink">
          {created.customerName} 御中 · {formatYen(created.totalAmount, created.currency)}
        </p>
        <p className="text-[13px] text-ink-muted">
          {filing.kind === 'working' && 'Rendering the PDF…'}
          {filing.kind === 'downloaded' && 'The PDF was downloaded to this device.'}
          {filing.kind === 'filed' && 'The PDF was downloaded and a copy archived in Cloud Storage.'}
          {filing.kind === 'failed' && 'The invoice was issued and the PDF downloaded, but the archive copy failed.'}
        </p>

        {filing.kind === 'failed' && (
          <div className="w-full flex items-start gap-2.5 bg-warn-tint text-warn border border-warn/20
            rounded-control px-3.5 py-3 text-[13px] text-left">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1 min-w-0">{filing.message}</span>
          </div>
        )}

        {filing.kind === 'filed' && filing.link && (
          <a
            href={filing.link}
            target="_blank"
            rel="noreferrer"
            className="w-full h-12 rounded-control bg-surface border border-line-strong
              flex items-center justify-center gap-2 text-[15px] font-semibold text-ink"
          >
            <ExternalLink className="w-[18px] h-[18px]" />
            Open the archived PDF
          </a>
        )}

        <button
          type="button"
          onClick={onClose}
          disabled={filing.kind === 'working'}
          className="mt-1 w-full h-13 min-h-[52px] rounded-control bg-brand text-white
            font-['Plus_Jakarta_Sans'] text-[15px] font-bold flex items-center justify-center gap-2
            disabled:opacity-50"
        >
          {filing.kind === 'working' && <Loader2 className="w-4 h-4 animate-spin" />}
          Done
        </button>
      </div>
    </>
  );

  const pickBody = (
    <>
      {header('請求書を発行', 'Pick the booking to invoice')}

      <div className="px-5 pt-4 flex flex-col gap-4">
        {errorBanner}

        {!loading && !settings && (
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="flex items-start gap-2.5 bg-warn-tint text-warn border border-warn/20
              rounded-control px-3.5 py-3 text-[13px] text-left"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1 min-w-0">
              Set your registration number (T number) first — tap here. Without it the document is not
              a 適格請求書.
            </span>
          </button>
        )}

        {properties.length > 1 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5">
            {[{ id: 'all', name: 'All' }, ...properties].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPropertyFilter(item.id)}
                className={`h-[34px] px-3.5 rounded-full text-[13px] whitespace-nowrap shrink-0 ${
                  item.id === propertyFilter
                    ? 'bg-brand text-white font-semibold'
                    : 'bg-surface border border-line text-ink-soft font-medium'
                }`}
              >
                {item.name}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="py-14 flex items-center justify-center text-ink-muted">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <p className="py-12 text-center text-[14px] text-ink-muted">
            No bookings to invoice yet.
          </p>
        ) : (
          <ul className="bg-surface border border-line rounded-card overflow-hidden">
            {visible.map((candidate) => (
              <li key={candidate.key} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => openStay(candidate)}
                  className="w-full px-4 py-3 flex items-start gap-3 text-left active:bg-subtle"
                >
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="text-[15px] text-ink truncate">
                      {candidate.checkIn?.fullName || candidate.guestName || '名前なし / No guest name'}
                    </span>
                    <span className="text-[12.5px] text-ink-muted truncate">
                      {candidate.propertyName} · {candidate.checkInDate} → {candidate.checkOutDate}
                    </span>
                    <span className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[11px] font-semibold text-ink-soft bg-brand-tint rounded-full px-2 py-[1px]">
                        {candidate.sourceLabel}
                      </span>
                      {candidate.checkIn && (
                        <span className="text-[11px] font-semibold text-ok bg-ok-tint rounded-full px-2 py-[1px]">
                          Check-in ✓
                        </span>
                      )}
                      {candidate.existingInvoice && (
                        <span className="text-[11px] font-semibold text-warn bg-warn-tint rounded-full px-2 py-[1px]">
                          {candidate.existingInvoice.invoiceNo}
                        </span>
                      )}
                    </span>
                  </div>
                  <span className="shrink-0 text-[14px] font-semibold text-ink tabular-nums pt-0.5">
                    {candidate.totalAmount > 0 ? formatYen(candidate.totalAmount, candidate.currency) : '—'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[12px] text-ink-muted leading-relaxed">
          Every booking on your properties is here, not only the ones sold on this site. Stays imported
          from Airbnb or Booking.com carry no name or price in the feed, so you type those in.
        </p>
      </div>
    </>
  );

  const editBody = draft && (
    <>
      {header(
        '請求書の内容',
        `${draft.candidate.propertyName} · ${draft.candidate.checkInDate} → ${draft.candidate.checkOutDate}`,
        () => setStep('pick'),
      )}

      <div className="px-5 pt-4 flex flex-col gap-4">
        {errorBanner}

        {duplicateWarning && (
          <div className="flex items-start gap-2.5 bg-warn-tint text-warn border border-warn/20
            rounded-control px-3.5 py-3 text-[13px]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1 min-w-0">
              {duplicateWarning} Press issue again to raise a second one anyway.
            </span>
          </div>
        )}

        <label className="block">
          <span className={labelClass}>宛名 / Bill to *</span>
          <input
            value={draft.customerName}
            onChange={(event) => patchDraft({ customerName: event.target.value, customerSource: 'manual' })}
            className={fieldClass}
            placeholder="株式会社〇〇 / Tanaka Yuki"
          />
          <span className="block mt-1.5 text-[12px] text-ink-muted leading-snug">
            {draft.candidate.checkIn
              ? 'Taken from the check-in form’s main guest.'
              : 'No check-in form was submitted for this stay, so ask the guest how the invoice should be addressed.'}
          </span>
        </label>

        <label className="block">
          <span className={labelClass}>住所 / Address</span>
          <textarea
            value={draft.customerAddress}
            onChange={(event) => patchDraft({ customerAddress: event.target.value })}
            rows={2}
            className={`${fieldClass} h-auto py-2.5`}
          />
        </label>

        <label className="block">
          <span className={labelClass}>発行日 / Issue date</span>
          <input
            type="date"
            value={draft.issueDate}
            onChange={(event) => patchDraft({ issueDate: event.target.value })}
            className={fieldClass}
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className={labelClass}>取引内容 / Line items</span>
          {draft.lineItems.map((line) => (
            <div key={line.key} className="bg-subtle border border-line rounded-card p-3 flex flex-col gap-2">
              <input
                value={line.description}
                onChange={(event) => patchLine(line.key, { description: event.target.value })}
                className={`${fieldClass} h-11 bg-surface`}
                placeholder="宿泊料金"
              />
              <div className="flex gap-2">
                <input
                  value={String(line.amount)}
                  onChange={(event) => {
                    const amount = Math.round(Number(event.target.value.replace(/[^\d-]/g, '')) || 0);
                    // quantity stays 1 on the phone: the unit price and the
                    // line total are the same number here, and keeping them in
                    // step stops the PDF printing 1 × ¥0 = ¥30,000.
                    patchLine(line.key, { amount, unitPrice: amount, quantity: 1 });
                  }}
                  inputMode="numeric"
                  className={`${fieldClass} h-11 flex-1 bg-surface tabular-nums`}
                  placeholder="0"
                />
                <select
                  value={line.taxCategory}
                  onChange={(event) => patchLine(line.key, { taxCategory: event.target.value as InvoiceTaxCategory })}
                  className={`${fieldClass} h-11 w-[132px] pr-7 bg-surface text-[14px]`}
                >
                  {TAX_CATEGORY_ORDER.map((category) => (
                    <option key={category} value={category}>{TAX_CATEGORY_LABELS[category].ja}</option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="Remove line"
                  disabled={draft.lineItems.length <= 1}
                  onClick={() => patchDraft({ lineItems: draft.lineItems.filter((row) => row.key !== line.key) })}
                  className="w-11 h-11 shrink-0 rounded-control border border-line-strong bg-surface
                    flex items-center justify-center text-ink-soft disabled:opacity-30"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => patchDraft({
              lineItems: [...draft.lineItems, draftLine('', 0, settings?.defaultTaxCategory ?? 'standard10')],
            })}
            className="h-11 rounded-control border border-line-strong bg-surface
              flex items-center justify-center gap-2 text-[14px] font-semibold text-ink-soft"
          >
            <Plus className="w-4 h-4" /> Add a line
          </button>
        </div>

        <label className="block">
          <span className={labelClass}>備考 / Notes</span>
          <textarea
            value={draft.notes}
            onChange={(event) => patchDraft({ notes: event.target.value })}
            rows={2}
            className={`${fieldClass} h-auto py-2.5`}
          />
        </label>

        {/* The per-rate table is the part that makes this a qualified invoice,
            so it is shown before issuing rather than only on the PDF. */}
        <div className="bg-subtle border border-line rounded-card px-4 py-1">
          {totals.taxBreakdown.map((row) => (
            <div key={row.taxCategory} className="flex items-center justify-between py-2 border-b border-line">
              <span className="text-[13px] text-ink-soft">
                {TAX_CATEGORY_LABELS[row.taxCategory].ja}
                <span className="text-ink-muted"> · 消費税 {formatYen(row.taxAmount, draft.candidate.currency)}</span>
              </span>
              <span className="text-[14px] text-ink tabular-nums">
                {formatYen(row.taxInclusiveTotal, draft.candidate.currency)}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between py-3">
            <span className="text-[15px] font-semibold text-ink">合計（税込）</span>
            <span className="font-['Plus_Jakarta_Sans'] text-[20px] font-bold text-ink tabular-nums">
              {formatYen(totals.totalAmount, draft.candidate.currency)}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => { void handleIssue(Boolean(duplicateWarning)); }}
          disabled={submitting || !draft.customerName.trim() || totals.totalAmount <= 0}
          className="h-13 min-h-[52px] rounded-control bg-brand text-white
            font-['Plus_Jakarta_Sans'] text-[15px] font-bold flex items-center justify-center gap-2
            disabled:opacity-50"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-[18px] h-[18px]" />}
          {duplicateWarning ? 'Issue anyway' : 'Issue invoice'}
        </button>

        <p className="text-[12px] text-ink-muted leading-relaxed">
          Amounts are tax-inclusive (税込). The consumption tax is worked out from each rate’s subtotal
          and rounded once, which is what the invoice has to show.
        </p>
      </div>
    </>
  );

  return (
    <>
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
          aria-label="Issue invoice"
        >
          {created ? successBody : step === 'pick' ? pickBody : editBody}
        </div>
      </div>

      {showSettings && (
        <InvoiceSettingsSheet
          onClose={() => setShowSettings(false)}
          onSaved={(saved) => {
            setSettings(saved);
            // The stay list is unaffected, but archiveConfigured and the
            // default tax category came back with it, so re-read both.
            setReloadKey((key) => key + 1);
          }}
        />
      )}
    </>
  );
};

export default InvoiceSheet;
