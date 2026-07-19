import { BookingConfirmation } from '../types';

// Generates a single-page A4 PDF booking confirmation and triggers a download.
// The document is laid out as an offscreen HTML node and rasterized with
// html2canvas so that mixed-script content (Japanese property addresses,
// Vietnamese guest names) renders exactly as the browser draws it — no PDF
// font embedding required. jspdf/html2canvas are imported lazily so they are
// only pulled into the bundle when a host actually exports a PDF.

const A4_WIDTH_PX = 794;   // 210mm at ~96dpi
const A4_HEIGHT_PX = 1123; // 297mm at ~96dpi

function formatMoney(amount: number, currency: string): string {
  const safeCurrency = currency || 'JPY';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: safeCurrency,
      maximumFractionDigits: safeCurrency === 'JPY' ? 0 : 2,
    }).format(amount);
  } catch {
    return `${safeCurrency} ${amount.toLocaleString('en-US')}`;
  }
}

function formatDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const start = new Date(`${checkIn}T00:00:00`).getTime();
  const end = new Date(`${checkOut}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return 0;
  }
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildDocumentHtml(confirmation: BookingConfirmation): string {
  const nights = nightsBetween(confirmation.checkInDate, confirmation.checkOutDate);
  const money = (amount: number) => formatMoney(amount, confirmation.currency);

  const rows: Array<{ label: string; amount: number; negative?: boolean }> = [
    { label: 'Accommodation fee', amount: confirmation.roomFee },
    { label: 'Cleaning fee', amount: confirmation.cleaningFee },
  ];
  if (confirmation.extraFee > 0) {
    rows.push({ label: confirmation.extraFeeLabel?.trim() || 'Additional fee', amount: confirmation.extraFee });
  }
  const discountAmount = confirmation.discountAmount ?? 0;
  if (discountAmount > 0) {
    rows.push({ label: confirmation.discountLabel?.trim() || 'Discount', amount: discountAmount, negative: true });
  }

  const feeRowsHtml = rows
    .map(
      (row) => `
        <tr>
          <td style="padding:9px 0;color:${row.negative ? '#1a7f4b' : '#44474c'};font-size:13px;">${escapeHtml(row.label)}</td>
          <td style="padding:9px 0;text-align:right;color:${row.negative ? '#1a7f4b' : '#1b1c1d'};font-size:13px;font-variant-numeric:tabular-nums;">${row.negative ? '−' : ''}${money(row.amount)}</td>
        </tr>`,
    )
    .join('');

  const detailRow = (label: string, value: string) => `
    <div style="display:flex;justify-content:space-between;gap:16px;padding:7px 0;border-bottom:1px solid #f0eef0;">
      <span style="color:#74777d;font-size:12.5px;">${escapeHtml(label)}</span>
      <span style="color:#1b1c1d;font-size:12.5px;font-weight:600;text-align:right;">${value}</span>
    </div>`;

  const contactBits = [confirmation.guestEmail, confirmation.guestPhone].filter(Boolean).map(escapeHtml).join(' · ');

  const notesHtml = confirmation.notes?.trim()
    ? `<div style="margin-top:22px;">
         <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#74777d;margin-bottom:6px;">Notes</div>
         <div style="font-size:12.5px;color:#44474c;line-height:1.55;white-space:pre-wrap;">${escapeHtml(confirmation.notes.trim())}</div>
       </div>`
    : '';

  const urlHtml = confirmation.propertyUrl?.trim()
    ? `<div style="font-size:11.5px;color:#2563EB;margin-top:4px;word-break:break-all;">${escapeHtml(confirmation.propertyUrl.trim())}</div>`
    : '';

  return `
    <div style="box-sizing:border-box;width:${A4_WIDTH_PX}px;min-height:${A4_HEIGHT_PX}px;padding:54px 56px;background:#ffffff;font-family:'Helvetica Neue',Arial,'Hiragino Kaku Gothic ProN','Noto Sans JP','Noto Sans',sans-serif;color:#1b1c1d;">

      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1b1c1d;padding-bottom:20px;">
        <div>
          <div style="font-size:24px;font-weight:800;letter-spacing:-0.01em;">Booking Confirmation</div>
          <div style="font-size:12.5px;color:#74777d;margin-top:5px;">Confirmation No. <strong style="color:#1b1c1d;">${escapeHtml(confirmation.confirmationNo)}</strong></div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:16px;font-weight:700;">${escapeHtml(confirmation.propertyName)}</div>
          <div style="font-size:11.5px;color:#74777d;margin-top:2px;">Issued ${formatDate(new Date(confirmation.createdAt).toISOString().slice(0, 10))}</div>
        </div>
      </div>

      <div style="display:flex;gap:32px;margin-top:26px;">
        <div style="flex:1;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#74777d;margin-bottom:8px;">Property</div>
          <div style="font-size:13.5px;font-weight:700;">${escapeHtml(confirmation.propertyName)}</div>
          <div style="font-size:12.5px;color:#44474c;line-height:1.5;margin-top:3px;">${escapeHtml(confirmation.propertyAddress)}</div>
          ${urlHtml}
        </div>
        <div style="flex:1;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#74777d;margin-bottom:8px;">Guest</div>
          <div style="font-size:13.5px;font-weight:700;">${escapeHtml(confirmation.guestName)}</div>
          ${contactBits ? `<div style="font-size:12.5px;color:#44474c;margin-top:3px;">${contactBits}</div>` : ''}
          <div style="font-size:12.5px;color:#44474c;margin-top:3px;">${confirmation.numGuests} guest${confirmation.numGuests === 1 ? '' : 's'}</div>
        </div>
      </div>

      <div style="margin-top:26px;background:#f7f5f6;border-radius:14px;padding:20px 22px;">
        ${detailRow('Check-in', `${formatDate(confirmation.checkInDate)} · ${escapeHtml(confirmation.checkInTime)}`)}
        ${detailRow('Check-out', `${formatDate(confirmation.checkOutDate)} · ${escapeHtml(confirmation.checkOutTime)}`)}
        <div style="display:flex;justify-content:space-between;gap:16px;padding:7px 0;">
          <span style="color:#74777d;font-size:12.5px;">Length of stay</span>
          <span style="color:#1b1c1d;font-size:12.5px;font-weight:600;">${nights} night${nights === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div style="margin-top:26px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#74777d;margin-bottom:6px;">Price breakdown</div>
        <table style="width:100%;border-collapse:collapse;">
          ${feeRowsHtml}
          <tr>
            <td style="padding:13px 0 0;border-top:1.5px solid #e4e2e3;color:#1b1c1d;font-size:14.5px;font-weight:800;">Total</td>
            <td style="padding:13px 0 0;border-top:1.5px solid #e4e2e3;text-align:right;color:#1b1c1d;font-size:14.5px;font-weight:800;font-variant-numeric:tabular-nums;">${money(confirmation.totalAmount)}</td>
          </tr>
        </table>
      </div>

      <div style="margin-top:22px;display:flex;gap:16px;">
        <div style="flex:1;border:1px solid #e4e2e3;border-radius:12px;padding:16px 18px;">
          <div style="font-size:11.5px;color:#74777d;">Deposit paid</div>
          <div style="font-size:17px;font-weight:800;margin-top:4px;font-variant-numeric:tabular-nums;">${money(confirmation.depositAmount)}</div>
        </div>
        <div style="flex:1;border-radius:12px;padding:16px 18px;background:#1b1c1d;color:#ffffff;">
          <div style="font-size:11.5px;color:#c9cbce;">Balance due</div>
          <div style="font-size:17px;font-weight:800;margin-top:4px;font-variant-numeric:tabular-nums;">${money(confirmation.balanceDue)}</div>
        </div>
      </div>

      ${notesHtml}

      <div style="margin-top:38px;border-top:1px solid #f0eef0;padding-top:14px;font-size:10.5px;color:#9a9ca0;line-height:1.5;">
        Please review the details above and let us know if anything needs to be corrected. We look forward to hosting you.
      </div>
    </div>
  `;
}

export async function downloadBookingConfirmationPdf(confirmation: BookingConfirmation): Promise<void> {
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
  container.innerHTML = buildDocumentHtml(confirmation);
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

    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    // Single page in practice; guard against slight overflow by clamping height.
    pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, Math.min(imgHeight, pageHeight));

    const safeGuest = confirmation.guestName.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'guest';
    pdf.save(`BookingConfirmation_${confirmation.confirmationNo}_${safeGuest}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}
