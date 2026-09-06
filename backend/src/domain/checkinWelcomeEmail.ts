import { EmailContent } from './bookingEmails.js';

export interface CheckInWelcomeContext {
  propertyName: string;
  propertyAddress: string;
  checkInInfo: {
    wifiName?: string;
    wifiPassword?: string;
    entryCode?: string;
    emergencyContactPhone?: string;
    googleMapsUrl?: string;
  };
  manualUrl: string;
  rulesUrl: string;
  locale: string;
}

interface Labels {
  subject: string;
  heading: string;
  intro: string;
  address: string;
  mapsLink: string;
  wifiName: string;
  wifiPassword: string;
  entryCode: string;
  emergencyContact: string;
  manualLink: string;
  rulesLink: string;
  footer: string;
}

// Every subject opens with the same untranslated "[No reply]". The mail goes
// out from a send-only address, and a guest who replies to it is talking to
// nobody — the marker has to survive being skimmed in a crowded inbox, which a
// phrase buried in the body does not. Left in English on purpose: it reads as
// the same recognisable tag in every locale, and a guest reading a subject in
// their own language still sees the same warning as everyone else.
const LABELS: Record<string, Labels> = {
  en: {
    subject: '[No reply] Everything you need for your stay',
    heading: 'You\'re all checked in',
    intro: 'Thanks for completing check-in. Here is everything you need to get into the property and settle in.',
    address: 'Address',
    mapsLink: 'Open in Google Maps',
    wifiName: 'Wi-Fi network',
    wifiPassword: 'Wi-Fi password',
    entryCode: 'Entry / door code',
    emergencyContact: 'Emergency contact',
    manualLink: 'House manual',
    rulesLink: 'House rules',
    footer: 'Sachi House',
  },
  vi: {
    subject: '[No reply] Thông tin cần thiết cho kỳ nghỉ của bạn',
    heading: 'Bạn đã check-in xong',
    intro: 'Cảm ơn bạn đã hoàn tất check-in. Dưới đây là mọi thông tin để vào nhà và ổn định chỗ ở.',
    address: 'Địa chỉ',
    mapsLink: 'Mở bằng Google Maps',
    wifiName: 'Tên mạng Wi-Fi',
    wifiPassword: 'Mật khẩu Wi-Fi',
    entryCode: 'Mã cửa / mã mở khoá',
    emergencyContact: 'Liên hệ khẩn cấp',
    manualLink: 'Hướng dẫn sử dụng nhà',
    rulesLink: 'Nội quy nhà',
    footer: 'Sachi House',
  },
  ja: {
    subject: '[No reply] ご滞在に必要な情報',
    heading: 'チェックインが完了しました',
    intro: 'チェックインいただきありがとうございます。入室に必要な情報は以下のとおりです。',
    address: '住所',
    mapsLink: 'Googleマップで開く',
    wifiName: 'Wi-Fi名',
    wifiPassword: 'Wi-Fiパスワード',
    entryCode: '入室コード / 鍵の暗証番号',
    emergencyContact: '緊急連絡先',
    manualLink: 'ハウスマニュアル',
    rulesLink: 'ハウスルール',
    footer: 'Sachi House',
  },
  zh: {
    subject: '[No reply] 入住所需的全部信息',
    heading: '您已完成登记',
    intro: '感谢您完成入住登记。以下是进入房屋并安顿所需的全部信息。',
    address: '地址',
    mapsLink: '在Google地图中打开',
    wifiName: 'Wi-Fi名称',
    wifiPassword: 'Wi-Fi密码',
    entryCode: '门锁密码 / 开门方式',
    emergencyContact: '紧急联系方式',
    manualLink: '房屋使用手册',
    rulesLink: '房屋守则',
    footer: 'Sachi House',
  },
  ko: {
    subject: '[No reply] 숙박에 필요한 모든 정보',
    heading: '체크인이 완료되었습니다',
    intro: '체크인을 완료해 주셔서 감사합니다. 입실에 필요한 모든 정보는 아래와 같습니다.',
    address: '주소',
    mapsLink: 'Google 지도에서 열기',
    wifiName: 'Wi-Fi 이름',
    wifiPassword: 'Wi-Fi 비밀번호',
    entryCode: '출입 코드 / 도어락 비밀번호',
    emergencyContact: '긴급 연락처',
    manualLink: '하우스 매뉴얼',
    rulesLink: '하우스 룰',
    footer: 'Sachi House',
  },
};

function getLabels(locale: string): Labels {
  return LABELS[locale] ?? LABELS.en;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type Row = [string, string, string?]; // label, value, optional link href

function buildRows(ctx: CheckInWelcomeContext, labels: Labels): Row[] {
  const rows: Row[] = [[labels.address, ctx.propertyAddress]];
  const info = ctx.checkInInfo;
  if (info.googleMapsUrl) rows.push([labels.mapsLink, labels.mapsLink, info.googleMapsUrl]);
  if (info.entryCode) rows.push([labels.entryCode, info.entryCode]);
  if (info.wifiName) rows.push([labels.wifiName, info.wifiName]);
  if (info.wifiPassword) rows.push([labels.wifiPassword, info.wifiPassword]);
  if (info.emergencyContactPhone) rows.push([labels.emergencyContact, info.emergencyContactPhone]);
  rows.push([labels.manualLink, labels.manualLink, ctx.manualUrl]);
  rows.push([labels.rulesLink, labels.rulesLink, ctx.rulesUrl]);
  return rows;
}

export function buildCheckInWelcomeEmail(ctx: CheckInWelcomeContext): EmailContent {
  const labels = getLabels(ctx.locale);
  const rows = buildRows(ctx, labels);

  const text = [
    labels.heading,
    '',
    labels.intro,
    '',
    ...rows.map(([label, value, href]) => `${label}: ${href ?? value}`),
  ].join('\n');

  const cells = rows
    .map(([label, value, href]) => `
      <tr>
        <td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;white-space:nowrap;">${escapeHtml(label)}</td>
        <td style="padding:6px 0;color:#111827;font-size:14px;font-weight:600;">${
          href
            ? `<a href="${escapeHtml(href)}" style="color:#2563eb;">${escapeHtml(value)}</a>`
            : escapeHtml(value)
        }</td>
      </tr>`)
    .join('');

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
    <h1 style="margin:0 0 16px;font-size:20px;color:#111827;">${escapeHtml(labels.heading)}</h1>
    <p style="margin:0 0 24px;color:#4b5563;font-size:14px;line-height:1.6;">${escapeHtml(labels.intro)}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;">${cells}</table>
    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;">${escapeHtml(labels.footer)}</p>
  </div>
</body></html>`;

  return {
    subject: `${labels.subject} — ${ctx.propertyName}`,
    text,
    html,
  };
}
