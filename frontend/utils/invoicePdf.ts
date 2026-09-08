import type { jsPDF as JsPDF } from 'jspdf';
import { Invoice, InvoiceTaxCategory } from '../types';
import { formatRegistrationNumber, formatYen, TAX_CATEGORY_LABELS } from './invoiceDraft';

/**
 * Renders a Japanese qualified invoice (適格請求書) to a single A4 page.
 *
 * Same machinery as the booking confirmation: the document is laid out as an
 * offscreen HTML node and rasterized with html2canvas, because that is the only
 * way to get Japanese, Latin and Vietnamese text in one document without
 * embedding CJK fonts into the PDF — a Noto Sans JP subset alone would be a
 * multi-megabyte addition to the bundle.
 *
 * The six things the NTA requires on a qualified invoice, and where each one is
 * on this page:
 *
 *   1. Issuer's name and registration number   → the issuer block, top right
 *   2. Transaction date                        → the stay dates row
 *   3. Description of what was supplied        → the line-item table
 *   4. Per-rate totals and the rate applied    → 税率ごとの内訳
 *   5. Per-rate consumption tax                → same table, 消費税額 column
 *   6. Name of the recipient                   → 宛名, top left
 *
 * Drop any of them and the document stops being a 適格請求書, which is the only
 * reason a guest asked for it.
 */

const A4_WIDTH_PX = 794;   // 210mm at ~96dpi

const INK = '#1b1c1d';
const SOFT = '#44474c';
const MUTED = '#74777d';
const LINE = '#e4e2e3';
const HAIRLINE = '#f0eef0';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 2026-09-08 → 2026年9月8日, with the ISO form kept for non-Japanese readers. */
function formatJapaneseDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return `${parsed.getFullYear()}年${parsed.getMonth() + 1}月${parsed.getDate()}日`;
}

function taxRateLabel(category: InvoiceTaxCategory): string {
  return category === 'exempt' ? '—' : `${Math.round(TAX_CATEGORY_RATES_PERCENT[category])}%`;
}

const TAX_CATEGORY_RATES_PERCENT: Record<InvoiceTaxCategory, number> = {
  standard10: 10,
  reduced8: 8,
  exempt: 0,
};

function bilingual(ja: string, en: string): string {
  return `${escapeHtml(ja)} <span style="color:${MUTED};font-size:9.5px;">${escapeHtml(en)}</span>`;
}

function buildDocumentHtml(invoice: Invoice): string {
  const money = (amount: number) => formatYen(amount, invoice.currency);
  const hasReducedRate = invoice.taxBreakdown.some((row) => row.taxCategory === 'reduced8');

  const lineRows = invoice.lineItems
    .map((item) => {
      // The asterisk convention is the standard way a Japanese invoice flags
      // reduced-rate items, and the legend below the table explains it.
      const mark = item.taxCategory === 'reduced8' ? '<span style="color:#b45309;">*</span> ' : '';
      return `
        <tr>
          <td style="padding:8px 8px 8px 0;border-bottom:1px solid ${HAIRLINE};font-size:11.5px;color:${INK};">
            ${mark}${escapeHtml(item.description)}
          </td>
          <td style="padding:8px 6px;border-bottom:1px solid ${HAIRLINE};font-size:11.5px;color:${SOFT};text-align:right;font-variant-numeric:tabular-nums;">
            ${item.quantity}
          </td>
          <td style="padding:8px 6px;border-bottom:1px solid ${HAIRLINE};font-size:11.5px;color:${SOFT};text-align:right;font-variant-numeric:tabular-nums;">
            ${money(item.unitPrice)}
          </td>
          <td style="padding:8px 6px;border-bottom:1px solid ${HAIRLINE};font-size:11.5px;color:${SOFT};text-align:center;">
            ${taxRateLabel(item.taxCategory)}
          </td>
          <td style="padding:8px 0 8px 6px;border-bottom:1px solid ${HAIRLINE};font-size:11.5px;color:${INK};text-align:right;font-variant-numeric:tabular-nums;">
            ${money(item.amount)}
          </td>
        </tr>`;
    })
    .join('');

  // 税率ごとに区分した対価の額と消費税額 — requirements 4 and 5, and the part a
  // tax office looks at first.
  const breakdownRows = invoice.taxBreakdown
    .map((row) => `
      <tr>
        <td style="padding:7px 8px 7px 0;border-bottom:1px solid ${HAIRLINE};font-size:11px;color:${SOFT};">
          ${escapeHtml(TAX_CATEGORY_LABELS[row.taxCategory].ja)}
          <span style="color:${MUTED};font-size:9.5px;">${escapeHtml(TAX_CATEGORY_LABELS[row.taxCategory].en)}</span>
        </td>
        <td style="padding:7px 8px;border-bottom:1px solid ${HAIRLINE};font-size:11px;color:${SOFT};text-align:right;font-variant-numeric:tabular-nums;">
          ${money(row.taxExclusiveTotal)}
        </td>
        <td style="padding:7px 8px;border-bottom:1px solid ${HAIRLINE};font-size:11px;color:${SOFT};text-align:right;font-variant-numeric:tabular-nums;">
          ${money(row.taxAmount)}
        </td>
        <td style="padding:7px 0 7px 8px;border-bottom:1px solid ${HAIRLINE};font-size:11px;color:${INK};font-weight:600;text-align:right;font-variant-numeric:tabular-nums;">
          ${money(row.taxInclusiveTotal)}
        </td>
      </tr>`)
    .join('');

  const contactLines = [invoice.issuerPhone, invoice.issuerEmail]
    .filter(Boolean)
    .map((value) => escapeHtml(String(value)))
    .join(' · ');

  const notesHtml = invoice.notes?.trim()
    ? `<div style="margin-top:16px;">
         <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:${MUTED};margin-bottom:4px;">備考 NOTES</div>
         <div style="font-size:11px;color:${SOFT};line-height:1.55;white-space:pre-wrap;">${escapeHtml(invoice.notes.trim())}</div>
       </div>`
    : '';

  const bankHtml = invoice.bankInfo?.trim()
    ? `<div style="margin-top:16px;border:1px solid ${LINE};border-radius:10px;padding:12px 14px;">
         <div style="font-size:10px;font-weight:700;letter-spacing:0.08em;color:${MUTED};margin-bottom:4px;">お振込先 BANK TRANSFER</div>
         <div style="font-size:11px;color:${SOFT};line-height:1.55;white-space:pre-wrap;">${escapeHtml(invoice.bankInfo.trim())}</div>
       </div>`
    : '';

  const voidHtml = invoice.status === 'void'
    ? `<div style="margin-top:14px;border:1.5px solid #b91c1c;border-radius:10px;padding:10px 14px;color:#b91c1c;font-size:11.5px;font-weight:700;">
         この請求書は無効です / VOID${invoice.voidReason ? ` — ${escapeHtml(invoice.voidReason)}` : ''}
       </div>`
    : '';

  const reducedLegend = hasReducedRate
    ? `<div style="margin-top:8px;font-size:10px;color:${MUTED};">* は軽減税率（8%）対象品目です。 / Items marked * are subject to the reduced 8% rate.</div>`
    : '';

  return `
    <div style="box-sizing:border-box;width:${A4_WIDTH_PX}px;padding:46px 52px;background:#ffffff;
      font-family:'Hiragino Kaku Gothic ProN','Yu Gothic','Noto Sans JP','Helvetica Neue',Arial,sans-serif;color:${INK};">

      <div style="text-align:center;padding-bottom:18px;">
        <div style="font-size:23px;font-weight:800;letter-spacing:0.24em;">請 求 書</div>
        <div style="font-size:10.5px;color:${MUTED};margin-top:4px;letter-spacing:0.06em;">
          適格請求書 · Qualified Invoice
        </div>
      </div>

      <div style="display:flex;gap:28px;align-items:flex-start;">
        <div style="flex:1.15;min-width:0;">
          <div style="font-size:16px;font-weight:700;border-bottom:1.5px solid ${INK};padding-bottom:6px;">
            ${escapeHtml(invoice.customerName)} <span style="font-size:12px;font-weight:600;">御中</span>
          </div>
          ${invoice.customerAddress?.trim()
            ? `<div style="font-size:11px;color:${SOFT};line-height:1.55;margin-top:6px;">${escapeHtml(invoice.customerAddress.trim())}</div>`
            : ''}
          <div style="margin-top:14px;font-size:11px;color:${SOFT};">
            下記の通りご請求申し上げます。
            <div style="color:${MUTED};font-size:9.5px;margin-top:2px;">We hereby invoice you for the following.</div>
          </div>
          <div style="margin-top:12px;background:#f7f5f6;border-radius:10px;padding:12px 14px;">
            <div style="font-size:10px;color:${MUTED};letter-spacing:0.06em;">ご請求金額（税込） TOTAL DUE</div>
            <div style="font-size:24px;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums;">
              ${money(invoice.totalAmount)}
            </div>
          </div>
        </div>

        <div style="flex:1;min-width:0;font-size:11px;">
          <div style="display:flex;justify-content:space-between;gap:10px;padding-bottom:4px;">
            <span style="color:${MUTED};">${bilingual('請求書番号', 'Invoice No.')}</span>
            <span style="font-weight:700;">${escapeHtml(invoice.invoiceNo)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:10px;padding-bottom:10px;border-bottom:1px solid ${HAIRLINE};">
            <span style="color:${MUTED};">${bilingual('発行日', 'Issue date')}</span>
            <span style="font-weight:600;">${formatJapaneseDate(invoice.issueDate)}</span>
          </div>

          <div style="margin-top:10px;font-size:10px;color:${MUTED};letter-spacing:0.06em;">発行者 ISSUER</div>
          <div style="font-size:12.5px;font-weight:700;margin-top:3px;">${escapeHtml(invoice.issuerName)}</div>
          <div style="font-size:11px;color:${SOFT};line-height:1.5;margin-top:2px;">${escapeHtml(invoice.issuerAddress)}</div>
          ${contactLines ? `<div style="font-size:10.5px;color:${SOFT};margin-top:2px;">${contactLines}</div>` : ''}
          <div style="margin-top:8px;border:1px solid ${LINE};border-radius:8px;padding:7px 10px;">
            <div style="font-size:9.5px;color:${MUTED};">${bilingual('登録番号', 'Registration No.')}</div>
            <div style="font-size:13px;font-weight:800;letter-spacing:0.04em;font-variant-numeric:tabular-nums;">
              ${escapeHtml(formatRegistrationNumber(invoice.issuerRegistrationNumber))}
            </div>
          </div>
        </div>
      </div>

      <div style="margin-top:22px;border:1px solid ${LINE};border-radius:10px;padding:12px 14px;display:flex;gap:24px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:9.5px;color:${MUTED};letter-spacing:0.06em;">宿泊施設 PROPERTY</div>
          <div style="font-size:11.5px;font-weight:600;margin-top:2px;">${escapeHtml(invoice.propertyName)}</div>
          <div style="font-size:10.5px;color:${SOFT};margin-top:1px;line-height:1.45;">${escapeHtml(invoice.propertyAddress)}</div>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:9.5px;color:${MUTED};letter-spacing:0.06em;">宿泊期間 STAY / 取引年月日</div>
          <div style="font-size:11.5px;font-weight:600;margin-top:2px;font-variant-numeric:tabular-nums;">
            ${formatJapaneseDate(invoice.checkInDate)} 〜 ${formatJapaneseDate(invoice.checkOutDate)}
          </div>
          <div style="font-size:10.5px;color:${SOFT};margin-top:1px;">
            ${invoice.nights}泊 · ${invoice.nights} night${invoice.nights === 1 ? '' : 's'}
            ${invoice.sourceLabel ? ` · ${escapeHtml(invoice.sourceLabel)}` : ''}
          </div>
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-top:20px;">
        <thead>
          <tr>
            <th style="text-align:left;padding:0 8px 7px 0;border-bottom:1.5px solid ${INK};font-size:10px;color:${MUTED};font-weight:700;letter-spacing:0.05em;">取引内容 DESCRIPTION</th>
            <th style="text-align:right;padding:0 6px 7px;border-bottom:1.5px solid ${INK};font-size:10px;color:${MUTED};font-weight:700;width:46px;">数量</th>
            <th style="text-align:right;padding:0 6px 7px;border-bottom:1.5px solid ${INK};font-size:10px;color:${MUTED};font-weight:700;width:92px;">単価</th>
            <th style="text-align:center;padding:0 6px 7px;border-bottom:1.5px solid ${INK};font-size:10px;color:${MUTED};font-weight:700;width:52px;">税率</th>
            <th style="text-align:right;padding:0 0 7px 6px;border-bottom:1.5px solid ${INK};font-size:10px;color:${MUTED};font-weight:700;width:104px;">金額（税込）</th>
          </tr>
        </thead>
        <tbody>${lineRows}</tbody>
      </table>
      ${reducedLegend}

      <div style="margin-top:22px;display:flex;gap:20px;align-items:flex-start;">
        <div style="flex:1.3;min-width:0;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.06em;color:${MUTED};margin-bottom:4px;">
            税率ごとに区分した消費税額等 · BREAKDOWN BY TAX RATE
          </div>
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr>
                <th style="text-align:left;padding:0 8px 6px 0;border-bottom:1px solid ${LINE};font-size:9.5px;color:${MUTED};font-weight:600;">区分</th>
                <th style="text-align:right;padding:0 8px 6px;border-bottom:1px solid ${LINE};font-size:9.5px;color:${MUTED};font-weight:600;">税抜金額</th>
                <th style="text-align:right;padding:0 8px 6px;border-bottom:1px solid ${LINE};font-size:9.5px;color:${MUTED};font-weight:600;">消費税額</th>
                <th style="text-align:right;padding:0 0 6px 8px;border-bottom:1px solid ${LINE};font-size:9.5px;color:${MUTED};font-weight:600;">税込金額</th>
              </tr>
            </thead>
            <tbody>${breakdownRows}</tbody>
          </table>
        </div>

        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;font-size:11px;">
            <span style="color:${MUTED};">${bilingual('小計（税抜）', 'Subtotal')}</span>
            <span style="font-variant-numeric:tabular-nums;">${money(invoice.subtotalTaxExclusive)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;font-size:11px;border-bottom:1px solid ${LINE};">
            <span style="color:${MUTED};">${bilingual('消費税', 'Consumption tax')}</span>
            <span style="font-variant-numeric:tabular-nums;">${money(invoice.totalTax)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:10px;padding:10px 12px;margin-top:8px;border-radius:9px;background:${INK};color:#ffffff;">
            <span style="font-size:11px;">合計（税込）<span style="color:#c9cbce;font-size:9.5px;"> Total</span></span>
            <span style="font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;">${money(invoice.totalAmount)}</span>
          </div>
        </div>
      </div>

      ${bankHtml}
      ${notesHtml}
      ${voidHtml}

      <div style="margin-top:26px;border-top:1px solid ${HAIRLINE};padding-top:10px;font-size:9.5px;color:#9a9ca0;line-height:1.5;">
        本書は消費税法第57条の4に定める適格請求書です。 /
        This document is a qualified invoice under Article 57-4 of the Japanese Consumption Tax Act.
      </div>
    </div>
  `;
}

/**
 * Rasterizes the invoice once and hands back the jsPDF instance.
 *
 * Shared by the download and the base64 (Drive filing) paths so a single issue
 * action never renders the document twice — the bytes the host downloads and
 * the bytes filed to Drive are then provably the same document.
 */
async function renderInvoicePdf(invoice: Invoice): Promise<{ pdf: JsPDF; fileName: string }> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.style.width = `${A4_WIDTH_PX}px`;
  container.style.background = '#ffffff';
  container.innerHTML = buildDocumentHtml(invoice);
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    });

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgHeight = (canvas.height * pageWidth) / canvas.width;

    // JPEG at 0.95 rather than PNG: a rasterized page of text is ~5x smaller
    // this way, and the invoice gets emailed and filed, not enlarged.
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pageWidth, Math.min(imgHeight, pageHeight));

    const safeCustomer = invoice.customerName.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'guest';
    return { pdf, fileName: `Invoice_${invoice.invoiceNo}_${safeCustomer}.pdf` };
  } finally {
    document.body.removeChild(container);
  }
}

function toBase64(pdf: JsPDF): string {
  const dataUri: string = pdf.output('datauristring');
  return dataUri.slice(dataUri.indexOf(',') + 1);
}

export async function downloadInvoicePdf(invoice: Invoice): Promise<void> {
  const { pdf, fileName } = await renderInvoicePdf(invoice);
  pdf.save(fileName);
}

/** Base64 only — what gets posted to the server for filing into Drive. */
export async function generateInvoicePdfBase64(
  invoice: Invoice,
): Promise<{ base64: string; fileName: string }> {
  const { pdf, fileName } = await renderInvoicePdf(invoice);
  return { base64: toBase64(pdf), fileName };
}

/**
 * Renders once, downloads to the host's device, and returns the same bytes for
 * filing. Used on the issue path, where the host wants the file in their hand
 * and the archive copy wants it in Drive.
 */
export async function downloadAndCaptureInvoicePdf(
  invoice: Invoice,
): Promise<{ base64: string; fileName: string }> {
  const { pdf, fileName } = await renderInvoicePdf(invoice);
  const base64 = toBase64(pdf);
  pdf.save(fileName);
  return { base64, fileName };
}
