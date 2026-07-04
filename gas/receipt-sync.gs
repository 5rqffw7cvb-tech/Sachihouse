/**
 * SachiHouse — Receipt Sync (Gmail → Finance module)
 *
 * Xử lý MỌI mail receipt/invoice có PDF đính kèm (Anthropic, OpenAI, Google,
 * Amazon, hoá đơn tiếng Nhật...), chạy theo time-driven trigger (15 phút/lần):
 *  1. Tìm mail có subject dạng receipt/invoice/領収書/請求書 kèm PDF, chưa xử lý.
 *  2. Trích xuất: vendor, số tiền, tiền tệ, ngày thanh toán, số receipt.
 *  3. Quy đổi sang JPY theo tỉ giá Google Finance tại thời điểm xử lý
 *     (receipt đã là JPY thì giữ nguyên).
 *  4. POST sang SachiHouse webhook (kèm PDF base64) → tạo giao dịch PENDING
 *     (chờ approve trong màn hình 未承認 của module Finance — vì parser chạy
 *     trên nhiều định dạng mail khác nhau nên LUÔN xem lại số tiền khi approve).
 *  5. Gắn label "SachiHouse_Processed" để không xử lý lại.
 *
 * Chống trùng lặp 2 lớp:
 *  - Client: label Gmail + Script Properties (processed:<messageId>).
 *  - Server: sourceRef "gmail:<messageId>" là unique trong DB (pending + journal).
 *
 * Phân loại property: backend tự chọn theo rule email → property quản lý ở
 * giao diện admin (Finance → tab メール連携ルール). Script chỉ cần gửi kèm
 * toEmail/accountEmail; PROPERTY_ID bên dưới chỉ là fallback khi không rule
 * nào khớp.
 *
 * Cài đặt: xem gas/README.md. Script Properties bắt buộc:
 *  - SACHIHOUSE_WEBHOOK_URL  ví dụ https://sachihouse-production.up.railway.app/api/finance/ingest/email-receipt
 *  - SACHIHOUSE_API_KEY      trùng với FINANCE_INGEST_API_KEY trên Railway
 * Tuỳ chọn:
 *  - PROPERTY_ID       fallback khi không rule nào khớp (backend còn có
 *                      FINANCE_INGEST_PROPERTY_ID làm fallback cuối cùng)
 *  - GMAIL_QUERY       override câu query Gmail mặc định
 *  - DEBIT_ACCOUNT     khoản mục nợ (借方) mặc định, backend dùng 通信費 nếu bỏ trống
 *                      (khoản mục chỉnh lại được từng dòng lúc approve)
 *  - DRIVE_FOLDER_NAME nếu set, lưu thêm 1 bản PDF vào Drive folder này
 */

var LABEL_NAME = 'SachiHouse_Processed';
// Nhận diện theo subject (không lọc người gửi) để bắt được cả mail forward
// từ hộp thư khác sang. Bao gồm cả từ khoá tiếng Nhật cho hoá đơn nội địa.
var DEFAULT_QUERY = 'subject:(receipt OR invoice OR 領収書 OR 請求書) has:attachment filename:pdf newer_than:90d';
var TARGET_CURRENCY = 'JPY';

/* ========== Entry point (gắn trigger vào hàm này) ========== */

function syncReceipts() {
  var props = PropertiesService.getScriptProperties();
  var webhookUrl = props.getProperty('SACHIHOUSE_WEBHOOK_URL');
  var apiKey = props.getProperty('SACHIHOUSE_API_KEY');

  if (!webhookUrl || !apiKey) {
    throw new Error('Chưa cấu hình SACHIHOUSE_WEBHOOK_URL / SACHIHOUSE_API_KEY trong Script Properties.');
  }

  var query = (props.getProperty('GMAIL_QUERY') || DEFAULT_QUERY) + ' -label:' + LABEL_NAME;
  var label = getOrCreateLabel_(LABEL_NAME);
  var threads = GmailApp.search(query, 0, 20);

  Logger.log('Tìm thấy %s thread cho query: %s', threads.length, query);

  threads.forEach(function (thread) {
    var allDone = true;

    thread.getMessages().forEach(function (message) {
      var messageId = message.getId();
      var processedKey = 'processed:' + messageId;

      if (props.getProperty(processedKey)) return;

      try {
        var result = processMessage_(message, webhookUrl, apiKey, props);
        if (result.skipped) {
          Logger.log('Bỏ qua message %s: %s', messageId, result.reason);
          // Mail không phải receipt (VD: reply trong cùng thread) — đánh dấu đã xem.
          props.setProperty(processedKey, 'skipped');
          return;
        }
        props.setProperty(processedKey, result.duplicate ? 'duplicate' : 'sent');
        Logger.log('OK message %s [%s] (duplicate=%s)', messageId, result.vendor || '?', result.duplicate);
      } catch (err) {
        allDone = false; // để lần chạy sau retry
        Logger.log('LỖI message %s: %s', messageId, err);
      }
    });

    if (allDone) {
      thread.addLabel(label);
    }
  });
}

// Giữ tên hàm cũ để trigger đã cài từ bản Anthropic-only vẫn chạy được.
function syncAnthropicReceipts() {
  syncReceipts();
}

/* ========== Xử lý 1 message ========== */

function processMessage_(message, webhookUrl, apiKey, props) {
  var pdf = findPdfAttachment_(message);
  if (!pdf) {
    return { skipped: true, reason: 'không có PDF đính kèm' };
  }

  var subject = message.getSubject() || '';
  var body = message.getPlainBody() || '';

  var parsed = parseReceipt_(subject, body);
  if (!parsed.amount) {
    return { skipped: true, reason: 'không tìm thấy số tiền trong nội dung mail' };
  }

  var vendor = detectVendor_(subject, message.getFrom());
  var paidDate = parsed.paidDate || message.getDate();
  var transactionDate = Utilities.formatDate(paidDate, 'Asia/Tokyo', 'yyyy-MM-dd');

  // Quy đổi theo tỉ giá Google Finance tại thời điểm xử lý (JPY → giữ nguyên).
  var rate = getGoogleFxRate_(parsed.currency, TARGET_CURRENCY);
  var amountJpy = Math.round(parsed.amount * rate);

  var description = vendor
    + (parsed.receiptNo ? ' Receipt#' + parsed.receiptNo : '')
    + ' | ' + formatOriginalAmount_(parsed.amount, parsed.currency)
    + (parsed.currency === TARGET_CURRENCY ? '' : ' × ' + rate.toFixed(4) + ' = ¥' + amountJpy
        + ' (tỉ giá Google ' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') + ')');

  var payload = {
    sourceRef: 'gmail:' + message.getId(),
    // Để backend tự phân loại property theo rule (tab メール連携ルール):
    // ưu tiên địa chỉ To của mail (email thanh toán của từng host),
    // sau đó đến tài khoản Gmail đang chạy script này.
    accountEmail: Session.getEffectiveUser().getEmail(),
    toEmail: message.getTo(),
    vendor: vendor,
    transactionDate: transactionDate,
    amountJpy: amountJpy,
    originalAmount: parsed.amount,
    originalCurrency: parsed.currency,
    exchangeRate: rate,
    description: description,
    debitAccount: props.getProperty('DEBIT_ACCOUNT') || '',
    propertyId: props.getProperty('PROPERTY_ID') || '',
    pdfBase64: Utilities.base64Encode(pdf.getBytes()),
    fileName: pdf.getName(),
  };

  var response = UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  var code = response.getResponseCode();
  var text = response.getContentText();

  if (code === 201) {
    saveDriveBackup_(pdf, props); // giữ thêm bản PDF trên Drive (tuỳ chọn)
    return { duplicate: false, vendor: vendor };
  }
  if (code === 200 && text.indexOf('"duplicate":true') >= 0) {
    return { duplicate: true, vendor: vendor };
  }

  throw new Error('Webhook trả về HTTP ' + code + ': ' + text);
}

/* ========== Nhận diện vendor ========== */

function detectVendor_(subject, from) {
  // Bỏ prefix Fwd:/Re: để parse subject gốc.
  var s = subject.replace(/^(?:(?:Fwd|FW|Re|回答|転送)\s*:\s*)+/i, '');

  // Dạng phổ biến (Stripe): "Your receipt from Anthropic, PBC #2531-4483"
  var m = s.match(/(?:receipt|invoice) from ([^#\[]+?)(?:\s*[#\-–]|\s*$)/i);
  if (m) return m[1].trim().replace(/[,.\s]+$/, '');

  // Dạng "Anthropic receipt" / "OpenAI invoice ..."
  m = s.match(/^([\w][\w&.\s]{1,30}?)\s+(?:receipt|invoice)/i);
  if (m) return m[1].trim();

  // Fallback: display name trong From ("Anthropic <invoice@...>"), rồi domain.
  var name = (from || '').replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();
  if (name && name.indexOf('@') === -1) return name;
  var dm = (from || '').match(/@([\w.-]+)/);
  return dm ? dm[1] : 'Unknown vendor';
}

/* ========== Trích xuất thông tin receipt ========== */

function parseReceipt_(subject, body) {
  // Số receipt/invoice: "#2531-4483" trong subject.
  var receiptNo = null;
  var mNo = subject.match(/#([\w-]+)/);
  if (mNo) receiptNo = mNo[1];

  var signToCode = { '$': 'USD', 'US$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '￥': 'JPY', '₫': 'VND' };
  var amount = null;
  var currency = null;

  // Ưu tiên dòng có nhãn rõ ràng (EN + JP), sau đó mới fallback số tiền đầu tiên.
  var LABEL = '(?:Amount paid|Amount charged|Amount due|Total|Grand total|合計|ご請求金額|請求金額|お支払い金額|金額)';
  var patterns = [
    // "Amount paid $25.00" / "合計 ¥3,900"
    { re: new RegExp(LABEL + '[^\\d$€£¥￥₫]*?(US\\$|[$€£¥￥₫])\\s?([\\d,]+(?:\\.\\d+)?)', 'i'), sign: 1, num: 2 },
    // "Total: USD 25.00" / "JPY 3,900"
    { re: new RegExp(LABEL + '[^\\dA-Z]*?(USD|EUR|GBP|JPY|VND|AUD|SGD)\\s?([\\d,]+(?:\\.\\d+)?)', 'i'), code: 1, num: 2 },
    // "合計 3,900円" / "1,234円"
    { re: new RegExp(LABEL + '[^\\d]*?([\\d,]+)\\s*円'), num: 1, fixed: 'JPY' },
    { re: /([\d,]+)\s*円/, num: 1, fixed: 'JPY' },
    // Fallback: số tiền có ký hiệu đầu tiên trong body
    { re: /(US\$|[$€£¥￥₫])\s?([\d,]+(?:\.\d+)?)/, sign: 1, num: 2 },
  ];

  for (var i = 0; i < patterns.length && amount === null; i++) {
    var p = patterns[i];
    var m = body.match(p.re);
    if (!m) continue;
    var value = parseFloat(m[p.num].replace(/,/g, ''));
    if (!(value > 0)) continue;
    amount = value;
    if (p.fixed) currency = p.fixed;
    else if (p.code) currency = m[p.code].toUpperCase();
    else currency = signToCode[m[p.sign]] || 'USD';
  }

  // Ngày thanh toán: "Date paid July 1, 2026" / "2026/07/01" / "2026年7月1日"
  var paidDate = null;
  var mDate = body.match(/(?:Date paid|Date of issue|Paid on|Paid)[^\n]*?([A-Z][a-z]+ \d{1,2}, \d{4})/);
  if (mDate) {
    var d = new Date(mDate[1]);
    if (!isNaN(d.getTime())) paidDate = d;
  }
  if (!paidDate) {
    mDate = body.match(/(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})日?/);
    if (mDate) {
      var d2 = new Date(Number(mDate[1]), Number(mDate[2]) - 1, Number(mDate[3]));
      if (!isNaN(d2.getTime())) paidDate = d2;
    }
  }

  return { receiptNo: receiptNo, amount: amount, currency: currency || 'USD', paidDate: paidDate };
}

function formatOriginalAmount_(amount, currency) {
  // JPY/VND không có phần thập phân.
  if (currency === 'JPY' || currency === 'VND') {
    return String(Math.round(amount)) + ' ' + currency;
  }
  return amount.toFixed(2) + ' ' + currency;
}

function findPdfAttachment_(message) {
  var attachments = message.getAttachments({ includeInlineImages: false });
  for (var i = 0; i < attachments.length; i++) {
    var a = attachments[i];
    if (/pdf/i.test(a.getContentType()) || /\.pdf$/i.test(a.getName())) {
      return a;
    }
  }
  return null;
}

/* ========== Tỉ giá Google Finance ========== */
// GOOGLEFINANCE chỉ chạy trong Spreadsheet, nên dùng 1 sheet phụ (tự tạo lần đầu,
// ID lưu vào Script Properties) để đọc tỉ giá thời điểm hiện tại.

function getGoogleFxRate_(fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return 1;

  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('FX_HELPER_SHEET_ID');
  var ss = null;

  if (ssId) {
    try { ss = SpreadsheetApp.openById(ssId); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('SachiHouse FX Helper (auto-generated)');
    props.setProperty('FX_HELPER_SHEET_ID', ss.getId());
  }

  var sheet = ss.getSheets()[0];
  sheet.getRange('A1').setFormula('=GOOGLEFINANCE("CURRENCY:' + fromCurrency + toCurrency + '")');
  SpreadsheetApp.flush();

  var value = sheet.getRange('A1').getValue();
  for (var tries = 0; tries < 10 && !(typeof value === 'number' && value > 0); tries++) {
    Utilities.sleep(1000);
    value = sheet.getRange('A1').getValue();
  }

  if (!(typeof value === 'number' && value > 0)) {
    throw new Error('Không lấy được tỉ giá GOOGLEFINANCE cho ' + fromCurrency + toCurrency);
  }
  return value;
}

/* ========== Tuỳ chọn: backup PDF lên Drive ========== */

function saveDriveBackup_(pdf, props) {
  var folderName = props.getProperty('DRIVE_FOLDER_NAME');
  if (!folderName) return;
  try {
    var it = DriveApp.getFoldersByName(folderName);
    var folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
    folder.createFile(pdf.copyBlob());
  } catch (err) {
    Logger.log('Drive backup lỗi (bỏ qua): %s', err);
  }
}

/* ========== Helpers ========== */

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/* ========== Cài đặt 1 lần ========== */

// Chạy tay 1 lần để cấp quyền + tạo trigger 15 phút.
function setup() {
  // Xoá trigger cũ (cả tên hàm cũ syncAnthropicReceipts lẫn tên mới).
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'syncReceipts' || fn === 'syncAnthropicReceipts') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('syncReceipts')
    .timeBased()
    .everyMinutes(15)
    .create();

  getOrCreateLabel_(LABEL_NAME);
  Logger.log('Đã tạo trigger 15 phút + label %s', LABEL_NAME);
}

// Chạy thử 1 lần bằng tay, xem log ở Executions.
function testRunOnce() {
  syncReceipts();
}
