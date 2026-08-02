import { Booking, BookingConfirmation } from '../store/types.js';

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export interface BookingEmailContext {
  booking: Booking;
  propertyName: string;
  propertyAddress: string;
  // Where the guest manages or cancels the booking (carries their token).
  manageUrl: string;
  // Same page, with a query flag that auto-triggers the confirmation PDF
  // download once the booking has loaded — the PDF itself is rendered
  // client-side, so there is nothing to attach server-side.
  pdfUrl: string;
  // The Minpaku check-in form guests must complete before arrival.
  checkInUrl: string;
  // How many days before check-in a guest can still cancel for a refund.
  // Configurable per property; policyNote is a template interpolated with it.
  freeCancellationDays: number;
}

interface Labels {
  confirmSubject: string;
  confirmHeading: string;
  confirmIntro: string;
  cancelSubject: string;
  cancelHeading: string;
  cancelIntro: string;
  refundLine: string;
  noRefund: string;
  confirmationNo: string;
  property: string;
  address: string;
  checkIn: string;
  checkOut: string;
  guests: string;
  nights: string;
  total: string;
  adults: string;
  children: string;
  infants: string;
  manageCta: string;
  downloadPdfCta: string;
  checkInCta: string;
  checkInNote: string;
  policyNote: string;
  hostConfirmSubject: string;
  hostCancelSubject: string;
  hostContact: string;
  hostTopUpLabel: string;
  hostTopUpNote: string;
  footer: string;
}

const LABELS: Record<string, Labels> = {
  en: {
    confirmSubject: 'Booking confirmed',
    confirmHeading: 'Your booking is confirmed',
    confirmIntro: 'Thank you. Your stay is reserved and paid for. Details are below.',
    cancelSubject: 'Booking cancelled',
    cancelHeading: 'Your booking has been cancelled',
    cancelIntro: 'This booking has been cancelled and the dates are no longer reserved.',
    refundLine: 'Refund issued',
    noRefund: 'No refund applies to this cancellation under the policy you accepted at booking.',
    confirmationNo: 'Confirmation number',
    property: 'Property',
    address: 'Address',
    checkIn: 'Check-in',
    checkOut: 'Check-out',
    guests: 'Guests',
    nights: 'Nights',
    total: 'Total paid',
    adults: 'adults',
    children: 'children',
    infants: 'infants',
    manageCta: 'View or cancel this booking',
    downloadPdfCta: 'Download booking confirmation (PDF)',
    checkInCta: 'Complete online check-in',
    checkInNote: 'Japanese law requires us to record every guest before arrival. Please complete check-in in advance.',
    policyNote: 'Cancel {days} or more days before check-in for a refund, less the payment processing fee. Within {days} days the booking is non-refundable.',
    hostConfirmSubject: 'New direct booking',
    hostCancelSubject: 'Direct booking cancelled',
    hostContact: 'Guest contact',
    hostTopUpLabel: 'Stripe fee (not refunded to you)',
    hostTopUpNote: 'This refund returns 100% of what the guest paid. Stripe does not refund its processing fee, so this amount comes out of your own balance.',
    footer: 'Sachi House',
  },
  vi: {
    confirmSubject: 'Đặt phòng đã xác nhận',
    confirmHeading: 'Đặt phòng của bạn đã được xác nhận',
    confirmIntro: 'Cảm ơn bạn. Kỳ nghỉ đã được giữ chỗ và thanh toán xong. Chi tiết bên dưới.',
    cancelSubject: 'Đặt phòng đã hủy',
    cancelHeading: 'Đặt phòng của bạn đã được hủy',
    cancelIntro: 'Đặt phòng này đã bị hủy và các ngày không còn được giữ nữa.',
    refundLine: 'Số tiền hoàn',
    noRefund: 'Theo chính sách bạn đã đồng ý khi đặt phòng, lần hủy này không được hoàn tiền.',
    confirmationNo: 'Mã đặt phòng',
    property: 'Căn hộ',
    address: 'Địa chỉ',
    checkIn: 'Nhận phòng',
    checkOut: 'Trả phòng',
    guests: 'Số khách',
    nights: 'Số đêm',
    total: 'Tổng đã thanh toán',
    adults: 'người lớn',
    children: 'trẻ em',
    infants: 'em bé',
    manageCta: 'Xem hoặc hủy đặt phòng',
    downloadPdfCta: 'Tải xác nhận đặt phòng (PDF)',
    checkInCta: 'Hoàn tất check-in trực tuyến',
    checkInNote: 'Luật Nhật Bản yêu cầu ghi nhận thông tin mọi khách trước khi nhận phòng. Vui lòng hoàn tất check-in trước.',
    policyNote: 'Hủy trước ngày nhận phòng từ {days} ngày trở lên được hoàn tiền sau khi trừ phí xử lý thanh toán. Trong vòng {days} ngày sẽ không được hoàn tiền.',
    hostConfirmSubject: 'Đặt phòng trực tiếp mới',
    hostCancelSubject: 'Đặt phòng trực tiếp đã hủy',
    hostContact: 'Liên hệ khách',
    hostTopUpLabel: 'Phí Stripe (không được hoàn lại)',
    hostTopUpNote: 'Khoản hoàn tiền này trả lại 100% số tiền khách đã thanh toán. Stripe không hoàn lại phí xử lý, nên bạn sẽ phải tự bù khoản này từ số dư của mình.',
    footer: 'Sachi House',
  },
  ja: {
    confirmSubject: 'ご予約が確定しました',
    confirmHeading: 'ご予約が確定しました',
    confirmIntro: 'ありがとうございます。お支払いが完了し、ご予約が確定しました。詳細は以下のとおりです。',
    cancelSubject: 'ご予約のキャンセル',
    cancelHeading: 'ご予約がキャンセルされました',
    cancelIntro: 'こちらのご予約はキャンセルされ、日程の確保は解除されました。',
    refundLine: '返金額',
    noRefund: 'ご予約時に同意いただいたポリシーにより、今回のキャンセルは返金対象外です。',
    confirmationNo: '予約番号',
    property: '施設',
    address: '住所',
    checkIn: 'チェックイン',
    checkOut: 'チェックアウト',
    guests: '人数',
    nights: '泊数',
    total: 'お支払い金額',
    adults: '大人',
    children: '子供',
    infants: '幼児',
    manageCta: '予約を確認・キャンセルする',
    downloadPdfCta: '予約確認書をダウンロード（PDF）',
    checkInCta: 'オンラインチェックインを行う',
    checkInNote: '日本の法令により、ご到着前に全宿泊者の情報を記録する必要があります。事前にチェックインをお済ませください。',
    policyNote: 'チェックイン日の{days}日前までのキャンセルは、決済手数料を差し引いた金額を返金いたします。{days}日前以降は返金いたしかねます。',
    hostConfirmSubject: '直販の新規予約',
    hostCancelSubject: '直販予約のキャンセル',
    hostContact: 'ゲスト連絡先',
    hostTopUpLabel: 'Stripe手数料（返金されません）',
    hostTopUpNote: 'この返金はゲストが支払った金額の100%を返すものです。Stripeの決済手数料は返金されないため、この金額はホスト様の残高からご負担いただくことになります。',
    footer: 'Sachi House',
  },
  zh: {
    confirmSubject: '预订已确认',
    confirmHeading: '您的预订已确认',
    confirmIntro: '感谢您的预订。付款已完成，房间已为您保留。详情如下。',
    cancelSubject: '预订已取消',
    cancelHeading: '您的预订已取消',
    cancelIntro: '此预订已取消，这些日期不再为您保留。',
    refundLine: '退款金额',
    noRefund: '根据您预订时同意的政策，本次取消不予退款。',
    confirmationNo: '预订编号',
    property: '房源',
    address: '地址',
    checkIn: '入住',
    checkOut: '退房',
    guests: '人数',
    nights: '晚数',
    total: '已付总额',
    adults: '成人',
    children: '儿童',
    infants: '婴儿',
    manageCta: '查看或取消此预订',
    downloadPdfCta: '下载预订确认书（PDF）',
    checkInCta: '完成在线登记',
    checkInNote: '日本法律要求我们在客人到达前登记所有住客信息，请提前完成在线登记。',
    policyNote: '入住日前{days}天或更早取消可获退款，需扣除支付手续费。入住日前{days}天内恕不退款。',
    hostConfirmSubject: '新的直接预订',
    hostCancelSubject: '直接预订已取消',
    hostContact: '客人联系方式',
    hostTopUpLabel: 'Stripe手续费（不予退还）',
    hostTopUpNote: '此次退款将全额退还客人支付的金额。由于Stripe不会退还其手续费，这笔费用需要从您的余额中自行承担。',
    footer: 'Sachi House',
  },
  ko: {
    confirmSubject: '예약이 확정되었습니다',
    confirmHeading: '예약이 확정되었습니다',
    confirmIntro: '감사합니다. 결제가 완료되어 예약이 확정되었습니다. 상세 내용은 아래와 같습니다.',
    cancelSubject: '예약이 취소되었습니다',
    cancelHeading: '예약이 취소되었습니다',
    cancelIntro: '이 예약은 취소되었으며 해당 날짜는 더 이상 확보되어 있지 않습니다.',
    refundLine: '환불 금액',
    noRefund: '예약 시 동의하신 정책에 따라 이번 취소는 환불 대상이 아닙니다.',
    confirmationNo: '예약 번호',
    property: '숙소',
    address: '주소',
    checkIn: '체크인',
    checkOut: '체크아웃',
    guests: '인원',
    nights: '박',
    total: '결제 금액',
    adults: '성인',
    children: '어린이',
    infants: '유아',
    manageCta: '예약 확인 또는 취소',
    downloadPdfCta: '예약 확인서 다운로드 (PDF)',
    checkInCta: '온라인 체크인 완료하기',
    checkInNote: '일본 법령에 따라 도착 전 모든 숙박객 정보를 기록해야 합니다. 미리 체크인을 완료해 주세요.',
    policyNote: '체크인 {days}일 전까지 취소하시면 결제 수수료를 제외한 금액을 환불해 드립니다. {days}일 이내에는 환불이 불가합니다.',
    hostConfirmSubject: '신규 직접 예약',
    hostCancelSubject: '직접 예약 취소',
    hostContact: '게스트 연락처',
    hostTopUpLabel: 'Stripe 수수료 (환불되지 않음)',
    hostTopUpNote: '이번 환불은 게스트가 결제한 금액의 100%를 돌려드리는 것입니다. Stripe는 결제 수수료를 환불하지 않으므로, 이 금액은 호스트님의 잔액에서 부담하셔야 합니다.',
    footer: 'Sachi House',
  },
};

export function getLabels(locale: string): Labels {
  return LABELS[locale] ?? LABELS.en;
}

function yen(amount: number): string {
  return `¥${amount.toLocaleString('en-US')}`;
}

function formatMoney(amount: number, currency: string): string {
  if (currency === 'JPY') {
    return yen(amount);
  }
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-US')}`;
  }
}

function guestSummary(booking: Booking, labels: Labels): string {
  const parts = [`${booking.adults} ${labels.adults}`];
  if (booking.children > 0) {
    parts.push(`${booking.children} ${labels.children}`);
  }
  if (booking.infants > 0) {
    parts.push(`${booking.infants} ${labels.infants}`);
  }
  return parts.join(', ');
}

// Emails are read in clients that strip most styling and sometimes show only
// the plain-text part, so every message carries both and neither depends on
// images or external CSS.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Row = [string, string];

function renderText(heading: string, intro: string, rows: Row[], extras: string[]): string {
  const body = rows.map(([label, value]) => `${label}: ${value}`).join('\n');
  return [heading, '', intro, '', body, '', ...extras].join('\n').trim();
}

function renderHtml(heading: string, intro: string, rows: Row[], extras: string[], footer: string): string {
  const cells = rows
    .map(([label, value]) => `
      <tr>
        <td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;white-space:nowrap;">${escapeHtml(label)}</td>
        <td style="padding:6px 0;color:#111827;font-size:14px;font-weight:600;">${escapeHtml(value)}</td>
      </tr>`)
    .join('');

  const extraBlocks = extras
    .map((extra) => `<p style="margin:0 0 12px;color:#4b5563;font-size:13px;line-height:1.6;">${extra}</p>`)
    .join('');

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
    <h1 style="margin:0 0 16px;font-size:20px;color:#111827;">${escapeHtml(heading)}</h1>
    <p style="margin:0 0 24px;color:#4b5563;font-size:14px;line-height:1.6;">${escapeHtml(intro)}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">${cells}</table>
    ${extraBlocks}
    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;">${escapeHtml(footer)}</p>
  </div>
</body></html>`;
}

function link(url: string, text: string): string {
  return `<a href="${escapeHtml(url)}" style="color:#2563eb;">${escapeHtml(text)}</a>`;
}

// A real button (not just a coloured link) for the one action we most want a
// guest to notice and tap without hunting for a plain-text link — filling in
// the PDF gap left by mail providers that strip attachments or hold them for
// scanning.
function button(url: string, text: string): string {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;background:#111827;color:#ffffff;` +
    'text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:10px;">' +
    `${escapeHtml(text)}</a>`;
}

function bookingRows(ctx: BookingEmailContext, labels: Labels): Row[] {
  const { booking } = ctx;
  const rows: Row[] = [];
  if (booking.confirmationNo) {
    rows.push([labels.confirmationNo, booking.confirmationNo]);
  }
  rows.push(
    [labels.property, ctx.propertyName],
    [labels.address, ctx.propertyAddress],
    [labels.checkIn, `${booking.checkInDate} 15:00`],
    [labels.checkOut, `${booking.checkOutDate} 10:00`],
    [labels.nights, String(booking.nights)],
    [labels.guests, guestSummary(booking, labels)],
    [labels.total, yen(booking.amountTotal)],
  );
  return rows;
}

function formatPolicyNote(labels: Labels, freeCancellationDays: number): string {
  return labels.policyNote.replace(/\{days\}/g, String(freeCancellationDays));
}

export function buildGuestConfirmationEmail(ctx: BookingEmailContext): EmailContent {
  const labels = getLabels(ctx.booking.locale);
  const rows = bookingRows(ctx, labels);
  const subject = `${labels.confirmSubject} — ${ctx.propertyName}`
    + (ctx.booking.confirmationNo ? ` (${ctx.booking.confirmationNo})` : '');
  const policyNote = formatPolicyNote(labels, ctx.freeCancellationDays);

  return {
    subject,
    text: renderText(labels.confirmHeading, labels.confirmIntro, rows, [
      `${labels.downloadPdfCta}: ${ctx.pdfUrl}`,
      '',
      `${labels.checkInCta}: ${ctx.checkInUrl}`,
      labels.checkInNote,
      '',
      `${labels.manageCta}: ${ctx.manageUrl}`,
      '',
      policyNote,
    ]),
    html: renderHtml(labels.confirmHeading, labels.confirmIntro, rows, [
      button(ctx.pdfUrl, labels.downloadPdfCta),
      `${link(ctx.checkInUrl, labels.checkInCta)}<br>${escapeHtml(labels.checkInNote)}`,
      link(ctx.manageUrl, labels.manageCta),
      escapeHtml(policyNote),
    ], labels.footer),
  };
}

export function buildGuestCancellationEmail(ctx: BookingEmailContext, refundAmount: number): EmailContent {
  const labels = getLabels(ctx.booking.locale);
  const rows = bookingRows(ctx, labels);
  if (refundAmount > 0) {
    rows.push([labels.refundLine, yen(refundAmount)]);
  }

  return {
    subject: `${labels.cancelSubject} — ${ctx.propertyName}`
      + (ctx.booking.confirmationNo ? ` (${ctx.booking.confirmationNo})` : ''),
    text: renderText(labels.cancelHeading, labels.cancelIntro, rows,
      refundAmount > 0 ? [] : [labels.noRefund]),
    html: renderHtml(labels.cancelHeading, labels.cancelIntro, rows,
      refundAmount > 0 ? [] : [escapeHtml(labels.noRefund)], labels.footer),
  };
}

export function buildHostConfirmationEmail(ctx: BookingEmailContext, hostLocale: string): EmailContent {
  const labels = getLabels(hostLocale);
  const rows = bookingRows(ctx, labels);
  rows.push([labels.hostContact, `${ctx.booking.guestName} <${ctx.booking.guestEmail}>`
    + (ctx.booking.guestPhone ? ` / ${ctx.booking.guestPhone}` : '')]);

  return {
    subject: `${labels.hostConfirmSubject} — ${ctx.propertyName} ${ctx.booking.checkInDate}`,
    text: renderText(labels.hostConfirmSubject, ctx.propertyName, rows, []),
    html: renderHtml(labels.hostConfirmSubject, ctx.propertyName, rows, [], labels.footer),
  };
}

export function buildHostCancellationEmail(
  ctx: BookingEmailContext,
  refundAmount: number,
  hostLocale: string,
): EmailContent {
  const labels = getLabels(hostLocale);
  const rows = bookingRows(ctx, labels);
  rows.push([labels.refundLine, yen(refundAmount)]);

  // A guest's own free cancellation already nets the Stripe fee out of their
  // refund, so the host is made whole. A host cancellation refunds the guest
  // in full instead, so whatever this refund pays out beyond that net amount
  // is money Stripe is not returning — the host has to cover it themselves.
  const netOfFee = Math.max(0, ctx.booking.amountTotal - ctx.booking.stripeFeeAmount);
  const hostTopUp = Math.max(0, refundAmount - netOfFee);
  if (hostTopUp > 0) {
    rows.push([labels.hostTopUpLabel, yen(hostTopUp)]);
  }

  rows.push([labels.hostContact, `${ctx.booking.guestName} <${ctx.booking.guestEmail}>`]);

  return {
    subject: `${labels.hostCancelSubject} — ${ctx.propertyName} ${ctx.booking.checkInDate}`,
    text: renderText(labels.hostCancelSubject, ctx.propertyName, rows, hostTopUp > 0 ? [labels.hostTopUpNote] : []),
    html: renderHtml(labels.hostCancelSubject, ctx.propertyName, rows,
      hostTopUp > 0 ? [escapeHtml(labels.hostTopUpNote)] : [], labels.footer),
  };
}

export interface ManualConfirmationEmailContext {
  confirmation: Pick<
    BookingConfirmation,
    'confirmationNo' | 'propertyName' | 'propertyAddress' | 'checkInDate' | 'checkOutDate'
    | 'checkInTime' | 'checkOutTime' | 'numGuests' | 'currency' | 'totalAmount'
  >;
  // The Minpaku check-in form for this stay. Carries the confirmation number
  // so it auto-matches the same way an online booking's link does.
  checkInUrl: string;
}

// Sent when a host records an off-platform (OTA, phone, walk-in) booking by
// hand. Deliberately lighter than buildGuestConfirmationEmail: there is no
// online self-service cancellation or Stripe fee to disclose here, since the
// guest did not pay through us.
export function buildManualBookingConfirmationEmail(ctx: ManualConfirmationEmailContext, locale: string): EmailContent {
  const labels = getLabels(locale);
  const { confirmation } = ctx;
  const rows: Row[] = [
    [labels.confirmationNo, confirmation.confirmationNo],
    [labels.property, confirmation.propertyName],
    [labels.address, confirmation.propertyAddress],
    [labels.checkIn, `${confirmation.checkInDate} ${confirmation.checkInTime}`],
    [labels.checkOut, `${confirmation.checkOutDate} ${confirmation.checkOutTime}`],
    [labels.guests, String(confirmation.numGuests)],
    [labels.total, formatMoney(confirmation.totalAmount, confirmation.currency)],
  ];

  return {
    subject: `${labels.confirmSubject} — ${confirmation.propertyName} (${confirmation.confirmationNo})`,
    text: renderText(labels.confirmHeading, labels.confirmIntro, rows, [
      `${labels.checkInCta}: ${ctx.checkInUrl}`,
      labels.checkInNote,
    ]),
    html: renderHtml(labels.confirmHeading, labels.confirmIntro, rows, [
      `${link(ctx.checkInUrl, labels.checkInCta)}<br>${escapeHtml(labels.checkInNote)}`,
    ], labels.footer),
  };
}
