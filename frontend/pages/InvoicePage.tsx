import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  Download,
  Trash,
  ExternalLink,
  FileText,
  Plus,
  Settings2,
  Trash2,
} from 'lucide-react';
import { AdminShell } from '../components/AdminShell';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Select, Table, Textarea } from '../components/ui';
import type { Column } from '../components/ui';
import { ApiError } from '../services/api';
import { getCurrentUser } from '../services/auth';
import {
  archiveInvoicePdf,
  createInvoice,
  deleteInvoice,
  getInvoiceSettings,
  listInvoices,
  listInvoiceStays,
  voidInvoice,
} from '../services/invoices';
import { downloadAndCaptureInvoicePdf, downloadInvoicePdf } from '../utils/invoicePdf';
import {
  buildInvoiceDraft,
  computeInvoiceTotals,
  DraftLineItem,
  draftLine,
  formatRegistrationNumber,
  formatYen,
  InvoiceDraft,
  TAX_CATEGORY_LABELS,
  TAX_CATEGORY_ORDER,
} from '../utils/invoiceDraft';
import { InvoiceSettingsSheet } from '../components/host/InvoiceSettingsSheet';
import {
  HostInvoiceSettings,
  Invoice,
  InvoiceCandidate,
  InvoiceTaxCategory,
} from '../types';

/**
 * Qualified invoices (適格請求書) in the console.
 *
 * Two views in one page rather than a modal: the register of what has been
 * issued, and the composer that issues the next one. A host raising an invoice
 * is reading a booking, a check-in record and a rate breakdown at once, and
 * none of that fits behind a dialog.
 *
 * The issuer profile form is the phone app's sheet, reused deliberately. It is
 * the same legally-loaded set of fields — a registration number, a trading name
 * and an address that get printed verbatim onto a tax document — and two forms
 * that could drift apart is exactly the wrong kind of duplication here.
 */

const CURRENCY_HINT = 'Amounts are tax-inclusive (税込).';

const InvoicePage: React.FC = () => {
  const [view, setView] = useState<'list' | 'compose'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [candidates, setCandidates] = useState<InvoiceCandidate[]>([]);
  const [settings, setSettings] = useState<HostInvoiceSettings | null>(null);
  const [archiveConfigured, setArchiveConfigured] = useState(false);
  const [archiveBucket, setArchiveBucket] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Hard delete is administrators only — see the route. A level-4 host gets
  // void, which is the right remedy for an invoice a guest already has.
  const isAdmin = getCurrentUser()?.role === 'ADMIN';

  const [draft, setDraft] = useState<InvoiceDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [issued, stays, settingsResponse] = await Promise.all([
        listInvoices(),
        listInvoiceStays(),
        getInvoiceSettings(),
      ]);
      setInvoices(issued);
      setCandidates(stays);
      setSettings(settingsResponse.settings);
      setArchiveConfigured(settingsResponse.archiveConfigured);
      setArchiveBucket(settingsResponse.archiveBucket);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load invoices.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const roundingMode = settings?.roundingMode ?? 'floor';
  const totals = useMemo(
    () => computeInvoiceTotals(draft?.lineItems ?? [], roundingMode),
    [draft?.lineItems, roundingMode],
  );

  const patchDraft = (patch: Partial<InvoiceDraft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  const patchLine = (key: string, patch: Partial<DraftLineItem>) =>
    setDraft((current) => (current
      ? { ...current, lineItems: current.lineItems.map((line) => (line.key === key ? { ...line, ...patch } : line)) }
      : current));

  /**
   * Issue → render → file, in that order.
   *
   * The invoice number is minted server-side and has to appear on the PDF, so
   * the document cannot be rendered before the row exists. Archiving then runs
   * against an invoice that is already safe, which is why its failure is
   * reported instead of thrown.
   */
  const handleIssue = async (allowDuplicate: boolean) => {
    if (!draft) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const { invoice } = await createInvoice({
        propertyId: draft.candidate.propertyId,
        sourceKind: draft.candidate.sourceKind,
        sourceId: draft.candidate.sourceId ?? undefined,
        sourceLabel: draft.candidate.sourceLabel,
        checkInDate: draft.candidate.checkInDate,
        checkOutDate: draft.candidate.checkOutDate,
        customerName: draft.customerName.trim(),
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

      const { base64 } = await downloadAndCaptureInvoicePdf(invoice);
      if (archiveConfigured) {
        try {
          await archiveInvoicePdf(invoice.id, base64);
          setNotice(`${invoice.invoiceNo} issued, downloaded and archived to Cloud Storage.`);
        } catch (cause) {
          setNotice(`${invoice.invoiceNo} issued and downloaded, but the archive copy failed: ${
            cause instanceof Error ? cause.message : 'unknown error'
          }`);
        }
      } else {
        setNotice(`${invoice.invoiceNo} issued and downloaded — no archive bucket on this server.`);
      }

      setDraft(null);
      setDuplicateWarning(null);
      setView('list');
      await load();
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

  const handleVoid = async (invoice: Invoice) => {
    const reason = window.prompt(
      `Void ${invoice.invoiceNo}? The number stays in the sequence — a gap is what an audit asks about.\n\nReason:`,
    );
    if (!reason?.trim()) return;
    try {
      await voidInvoice(invoice.id, reason.trim());
      setNotice(`${invoice.invoiceNo} marked void.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not void the invoice.');
    }
  };

  /**
   * Removes an invoice and hands its number back.
   *
   * For a row created in error and never given to a guest — a test run on a
   * live deployment, most often. The server only allows the newest number, so
   * the confirmation says what this actually is rather than pretending it is a
   * general-purpose delete.
   */
  const handleDelete = async (invoice: Invoice) => {
    const confirmed = window.confirm(
      `Delete ${invoice.invoiceNo} for good?

`
      + 'The number goes back into the sequence and the archived PDF is removed. '
      + 'Do this only for an invoice that was never given to the guest — if they '
      + 'have it, void it instead, because you are required to keep a copy for '
      + 'seven years.',
    );
    if (!confirmed) return;

    try {
      await deleteInvoice(invoice.id);
      setNotice(`${invoice.invoiceNo} deleted. That number is free again.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the invoice.');
    }
  };

  const columns: Column<Invoice>[] = [
    {
      header: '請求書番号 No.',
      className: 'font-mono whitespace-nowrap',
      cell: (row) => (
        <span className="flex items-center gap-2">
          <span className={row.status === 'void' ? 'line-through text-ink-muted' : 'text-ink'}>{row.invoiceNo}</span>
          {row.status === 'void' && <Badge tone="danger">VOID</Badge>}
        </span>
      ),
    },
    { header: '発行日', className: 'whitespace-nowrap', cell: (row) => row.issueDate },
    {
      header: '宛名 Bill to',
      cell: (row) => (
        <span className="flex flex-col">
          <span className="text-ink">{row.customerName}</span>
          {row.customerSource === 'checkin' && (
            <span className="text-[12px] text-ink-muted">from check-in form</span>
          )}
        </span>
      ),
    },
    {
      header: 'Stay',
      hideOnMobile: true,
      cell: (row) => (
        <span className="flex flex-col">
          <span className="text-ink">{row.propertyName}</span>
          <span className="text-[12px] text-ink-muted">
            {row.checkInDate} → {row.checkOutDate}
            {row.sourceLabel ? ` · ${row.sourceLabel}` : ''}
          </span>
        </span>
      ),
    },
    {
      header: '消費税',
      className: 'text-right tabular-nums whitespace-nowrap',
      hideOnMobile: true,
      cell: (row) => formatYen(row.totalTax, row.currency),
    },
    {
      header: '合計（税込）',
      className: 'text-right tabular-nums whitespace-nowrap font-semibold',
      cell: (row) => formatYen(row.totalAmount, row.currency),
    },
    {
      header: '',
      className: 'text-right whitespace-nowrap',
      cell: (row) => (
        <span className="flex items-center justify-end gap-1.5">
          {row.pdfUrl && (
            <a
              href={row.pdfUrl}
              target="_blank"
              rel="noreferrer"
              title="Open the archived PDF"
              className="inline-flex items-center justify-center w-8 h-8 rounded-control text-ink-soft hover:bg-subtle"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          <Button size="sm" variant="ghost" icon={Download} onClick={() => { void downloadInvoicePdf(row); }}>
            PDF
          </Button>
          {row.status === 'issued' && (
            <Button size="sm" variant="ghost" icon={Ban} onClick={() => { void handleVoid(row); }}>
              Void
            </Button>
          )}
          {isAdmin && (
            <Button
              size="sm"
              variant="ghost"
              icon={Trash}
              aria-label={`Delete ${row.invoiceNo}`}
              onClick={() => { void handleDelete(row); }}
            />
          )}
        </span>
      ),
    },
  ];

  const banners = (
    <>
      {error && <Alert tone="danger" onDismiss={() => setError(null)}>{error}</Alert>}
      {notice && <Alert tone="ok" onDismiss={() => setNotice(null)}>{notice}</Alert>}
      {!loading && !settings && (
        <Alert tone="warn">
          No registration number on file. Set your T number before issuing — without it the document is
          not a 適格請求書 and the guest cannot claim the tax back.{' '}
          <button type="button" className="underline font-semibold" onClick={() => setShowSettings(true)}>
            Open invoice settings
          </button>
        </Alert>
      )}
    </>
  );

  const listView = (
    <div className="flex flex-col gap-4">
      {banners}

      {settings && (
        <Card padded={false}>
          <div className="px-5 py-3.5 flex flex-wrap items-center gap-x-8 gap-y-2 text-[13px]">
            <span className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">登録番号</span>
              <span className="font-mono text-ink">{formatRegistrationNumber(settings.registrationNumber)}</span>
            </span>
            <span className="flex flex-col min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">発行者</span>
              <span className="text-ink truncate">{settings.issuerName}</span>
            </span>
            <span className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">端数処理</span>
              <span className="text-ink">{settings.roundingMode}</span>
            </span>
            <span className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">控えの保存</span>
              <span className={archiveConfigured ? 'text-ok' : 'text-ink-muted'}>
                {archiveConfigured ? archiveBucket ?? 'Archived to Cloud Storage' : 'Download only'}
              </span>
            </span>
          </div>
        </Card>
      )}

      <Card title="発行済み請求書 · Issued invoices" padded={false}>
        <Table
          columns={columns}
          rows={invoices}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              icon={FileText}
              title="No invoices yet"
              description="Pick a booking and issue the first one."
            />
          }
        />
      </Card>
    </div>
  );

  const composeView = (
    <div className="flex flex-col gap-4">
      {banners}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-4 items-start">
        <Card title="請求対象を選ぶ · Pick a booking" padded={false} className="lg:sticky lg:top-20">
          {candidates.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No bookings"
              description="Nothing on your properties to invoice yet."
            />
          ) : (
            <ul className="max-h-[62vh] overflow-y-auto">
              {candidates.map((candidate) => {
                const active = draft?.candidate.key === candidate.key;
                return (
                  <li key={candidate.key} className="border-b border-line last:border-b-0">
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(buildInvoiceDraft(candidate, {
                          defaultTaxCategory: settings?.defaultTaxCategory,
                          defaultNotes: settings?.defaultNotes,
                        }));
                        setDuplicateWarning(null);
                      }}
                      className={`w-full px-4 py-3 text-left transition-colors ${
                        active ? 'bg-brand-tint' : 'hover:bg-subtle'
                      }`}
                    >
                      <span className="flex items-start gap-3">
                        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <span className="text-[14px] text-ink truncate">
                            {candidate.checkIn?.fullName || candidate.guestName || '名前なし / No guest name'}
                          </span>
                          <span className="text-[12px] text-ink-muted truncate">
                            {candidate.propertyName} · {candidate.checkInDate} → {candidate.checkOutDate}
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5 mt-1">
                            <Badge tone="neutral">{candidate.sourceLabel}</Badge>
                            {candidate.checkIn && <Badge tone="ok">Check-in</Badge>}
                            {candidate.existingInvoice && (
                              <Badge tone="warn">{candidate.existingInvoice.invoiceNo}</Badge>
                            )}
                          </span>
                        </span>
                        <span className="shrink-0 text-[13px] font-semibold text-ink tabular-nums">
                          {candidate.totalAmount > 0 ? formatYen(candidate.totalAmount, candidate.currency) : '—'}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {!draft ? (
          <Card>
            <EmptyState
              icon={FileText}
              title="Pick a booking on the left"
              description="Every stay on your properties is listed — Airbnb and Booking.com included. Those arrive with no guest name and no price, so you fill those in."
            />
          </Card>
        ) : (
          <Card title={`${draft.candidate.propertyName} · ${draft.candidate.nights}泊`}>
            <div className="flex flex-col gap-4">
              {duplicateWarning && (
                <Alert tone="warn">
                  {duplicateWarning} Press “Issue anyway” to raise a second one.
                </Alert>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="宛名 / Bill to" required hint={
                  draft.candidate.checkIn
                    ? 'Taken from the check-in form’s main guest.'
                    : 'No check-in form for this stay — ask the guest how it should be addressed.'
                }>
                  <Input
                    value={draft.customerName}
                    onChange={(event) => patchDraft({ customerName: event.target.value, customerSource: 'manual' })}
                    placeholder="株式会社〇〇"
                  />
                </Field>
                <Field label="発行日 / Issue date">
                  <Input
                    type="date"
                    value={draft.issueDate}
                    onChange={(event) => patchDraft({ issueDate: event.target.value })}
                  />
                </Field>
              </div>

              <Field label="住所 / Address">
                <Textarea
                  rows={2}
                  value={draft.customerAddress}
                  onChange={(event) => patchDraft({ customerAddress: event.target.value })}
                />
              </Field>

              <div className="flex flex-col gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-soft">
                  取引内容 / Line items
                </span>
                <div className="hidden md:grid grid-cols-[1fr_80px_120px_150px_40px] gap-2 px-1
                  text-[11px] font-bold uppercase tracking-wide text-ink-muted">
                  <span>Description</span>
                  <span className="text-right">数量</span>
                  <span className="text-right">単価</span>
                  <span>税率</span>
                  <span />
                </div>
                {draft.lineItems.map((line) => (
                  <div
                    key={line.key}
                    className="grid grid-cols-1 md:grid-cols-[1fr_80px_120px_150px_40px] gap-2 items-center"
                  >
                    <Input
                      value={line.description}
                      onChange={(event) => patchLine(line.key, { description: event.target.value })}
                      placeholder="宿泊料金"
                    />
                    <Input
                      value={String(line.quantity)}
                      inputMode="numeric"
                      className="text-right tabular-nums"
                      onChange={(event) => {
                        const quantity = Number(event.target.value.replace(/[^\d.]/g, '')) || 0;
                        patchLine(line.key, { quantity, amount: Math.round(quantity * line.unitPrice) });
                      }}
                    />
                    <Input
                      value={String(line.unitPrice)}
                      inputMode="numeric"
                      className="text-right tabular-nums"
                      onChange={(event) => {
                        const unitPrice = Math.round(Number(event.target.value.replace(/[^\d-]/g, '')) || 0);
                        patchLine(line.key, { unitPrice, amount: Math.round(line.quantity * unitPrice) });
                      }}
                    />
                    <Select
                      value={line.taxCategory}
                      onChange={(event) => patchLine(line.key, {
                        taxCategory: event.target.value as InvoiceTaxCategory,
                      })}
                    >
                      {TAX_CATEGORY_ORDER.map((category) => (
                        <option key={category} value={category}>{TAX_CATEGORY_LABELS[category].ja}</option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Trash2}
                      aria-label="Remove line"
                      disabled={draft.lineItems.length <= 1}
                      onClick={() => patchDraft({
                        lineItems: draft.lineItems.filter((row) => row.key !== line.key),
                      })}
                    />
                  </div>
                ))}
                <div>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Plus}
                    onClick={() => patchDraft({
                      lineItems: [
                        ...draft.lineItems,
                        draftLine('', 0, settings?.defaultTaxCategory ?? 'standard10'),
                      ],
                    })}
                  >
                    Add a line
                  </Button>
                </div>
                <p className="text-[12px] text-ink-muted">{CURRENCY_HINT}</p>
              </div>

              <Field label="備考 / Notes">
                <Textarea
                  rows={2}
                  value={draft.notes}
                  onChange={(event) => patchDraft({ notes: event.target.value })}
                />
              </Field>

              {/* The per-rate table is what makes the document a qualified
                  invoice, so the host sees it before issuing, not only on the PDF. */}
              <div className="bg-subtle border border-line rounded-card overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">
                      <th className="text-left px-4 py-2">税率ごとの内訳</th>
                      <th className="text-right px-4 py-2">税抜</th>
                      <th className="text-right px-4 py-2">消費税</th>
                      <th className="text-right px-4 py-2">税込</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totals.taxBreakdown.map((row) => (
                      <tr key={row.taxCategory} className="border-t border-line">
                        <td className="px-4 py-2 text-ink-soft">
                          {TAX_CATEGORY_LABELS[row.taxCategory].ja}
                          <span className="text-ink-muted"> · {TAX_CATEGORY_LABELS[row.taxCategory].en}</span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatYen(row.taxExclusiveTotal, draft.candidate.currency)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatYen(row.taxAmount, draft.candidate.currency)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold">
                          {formatYen(row.taxInclusiveTotal, draft.candidate.currency)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-line-strong bg-surface">
                      <td className="px-4 py-2.5 font-bold text-ink" colSpan={3}>合計（税込） Total</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-bold text-ink">
                        {formatYen(totals.totalAmount, draft.candidate.currency)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button variant="secondary" onClick={() => { setDraft(null); setDuplicateWarning(null); }}>
                  Clear
                </Button>
                <Button
                  variant="primary"
                  icon={FileText}
                  loading={submitting}
                  disabled={!draft.customerName.trim() || totals.totalAmount <= 0}
                  onClick={() => { void handleIssue(Boolean(duplicateWarning)); }}
                >
                  {duplicateWarning ? 'Issue anyway' : 'Issue invoice'}
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );

  return (
    <AdminShell
      access="finance"
      activeKey="invoices"
      title="請求書 · Invoices"
      subtitle="Qualified invoices (適格請求書) for stays across your properties."
      isLoading={loading}
      deniedMessage="Issuing invoices requires host level 4."
      actions={
        view === 'list' ? (
          <>
            <Button variant="secondary" icon={Settings2} onClick={() => setShowSettings(true)}>
              Settings
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => setView('compose')}>
              請求書を発行
            </Button>
          </>
        ) : (
          <Button variant="secondary" icon={ArrowLeft} onClick={() => { setView('list'); setDraft(null); }}>
            Back to invoices
          </Button>
        )
      }
    >
      {view === 'list' ? listView : composeView}

      {showSettings && (
        <InvoiceSettingsSheet
          onClose={() => setShowSettings(false)}
          onSaved={() => { void load(); }}
        />
      )}
    </AdminShell>
  );
};

export default InvoicePage;
