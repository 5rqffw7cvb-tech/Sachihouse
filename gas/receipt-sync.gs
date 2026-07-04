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
 *  - DRIVE_FOLDER_NAME thư mục gốc lưu evidence trên Drive (mặc định: SachiHouse_Receipt_Evidence)
 *  - DRIVE_EVIDENCE_PUBLIC_LINK true/false, mặc định true để tạo link web xem evidence
 */

var LABEL_NAME = 'SachiHouse_Processed';
// Nhận diện theo subject (không lọc người gửi) để bắt được cả mail forward
// từ hộp thư khác sang. Bao gồm cả từ khoá tiếng Nhật cho hoá đơn nội địa.
// Không ép filename:pdf để xử lý được cả receipt chỉ có nội dung trong email.
var DEFAULT_QUERY = 'subject:(receipt OR invoice OR 領収書 OR 請求書) newer_than:90d';
var TARGET_CURRENCY = 'JPY';
var FX_CACHE_MAX_AGE_MINUTES = 360;

// Cache trong 1 lần chạy để không gọi Spreadsheet lặp lại cùng cặp tiền tệ.
var runtimeFxCache_ = {};

/* ========== Entry point (gắn trigger vào hàm này) ========== */

function syncReceipts() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('Bỏ qua lần chạy vì trigger trước vẫn đang xử lý.');
    return;
  }

  try {
  var props = PropertiesService.getScriptProperties();
  var webhookUrl = props.getProperty('SACHIHOUSE_WEBHOOK_URL');
  var apiKey = props.getProperty('SACHIHOUSE_API_KEY');

  if (!webhookUrl || !apiKey) {
    throw new Error('Chưa cấu hình SACHIHOUSE_WEBHOOK_URL / SACHIHOUSE_API_KEY trong Script Properties.');
  }

  var query = (props.getProperty('GMAIL_QUERY') || DEFAULT_QUERY) + ' -label:' + LABEL_NAME;
  var label = getOrCreateLabel_(LABEL_NAME);
  var threads = GmailApp.search(query, 0, 10);
  var config = {
    accountEmail: Session.getEffectiveUser().getEmail(),
    debitAccount: props.getProperty('DEBIT_ACCOUNT') || '',
    propertyId: props.getProperty('PROPERTY_ID') || '',
    parseDebug: isTruthyProp_(props.getProperty('ENABLE_PARSE_DEBUG'))
  };

  Logger.log('Tìm thấy %s thread cho query: %s', threads.length, query);

  threads.forEach(function (thread) {
    var allDone = true;
    var propertyUpdates = {};

    thread.getMessages().forEach(function (message) {
      var messageId = message.getId();
      var processedKey = 'processed:' + messageId;

      if (props.getProperty(processedKey)) return;

      try {
        var result = processMessage_(message, webhookUrl, apiKey, props, config);
        if (result.skipped) {
          Logger.log('Bỏ qua message %s: %s', messageId, result.reason);
          // Mail không phải receipt (VD: reply trong cùng thread) — đánh dấu đã xem.
          propertyUpdates[processedKey] = 'skipped';
          return;
        }
        propertyUpdates[processedKey] = result.duplicate ? 'duplicate' : 'sent';
        Logger.log('OK message %s [%s] (duplicate=%s)', messageId, result.vendor || '?', result.duplicate);
      } catch (err) {
        allDone = false; // để lần chạy sau retry
        Logger.log('LỖI message %s: %s', messageId, err);
      }
    });

    if (Object.keys(propertyUpdates).length > 0) {
      props.setProperties(propertyUpdates, false);
    }

    if (allDone) {
      thread.addLabel(label);
    }
  });
  } finally {
    lock.releaseLock();
  }
}

// Giữ tên hàm cũ để trigger đã cài từ bản Anthropic-only vẫn chạy được.
function syncAnthropicReceipts() {
  syncReceipts();
}

/* ========== Xử lý 1 message ========== */

function processMessage_(message, webhookUrl, apiKey, props, config) {
  var pdf = findPdfAttachment_(message);
  var generatedEvidencePdf = false;
  var driveEvidence = null;

  var subject = message.getSubject() || '';
  var body = getReceiptText_(message);

  var parsed = parseReceipt_(subject, body);
  if (config.parseDebug) {
    Logger.log(
      '[parse-debug] message=%s subject="%s" vendor="%s" amount=%s currency=%s paidDate=%s',
      message.getId(),
      subject,
      detectVendor_(subject, message.getFrom(), body),
      parsed.amount,
      parsed.currency,
      parsed.paidDate ? Utilities.formatDate(parsed.paidDate, 'Asia/Tokyo', 'yyyy-MM-dd') : ''
    );
  }

  if (!parsed.amount) {
    return { skipped: true, reason: 'không tìm thấy số tiền trong nội dung mail' };
  }

  var vendor = detectVendor_(subject, message.getFrom(), body);
  var paidDate = parsed.paidDate || message.getDate();
  var transactionDate = Utilities.formatDate(paidDate, 'Asia/Tokyo', 'yyyy-MM-dd');

  // Mail không có PDF gốc: tạo PDF chứng từ từ nội dung email để UI vẫn có evidence.
  if (!pdf) {
    pdf = createEmailEvidencePdf_(message, vendor, parsed, body, transactionDate);
    generatedEvidencePdf = !!pdf;
  }

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
    accountEmail: config.accountEmail,
    toEmail: message.getTo(),
    vendor: vendor,
    transactionDate: transactionDate,
    amountJpy: amountJpy,
    originalAmount: parsed.amount,
    originalCurrency: parsed.currency,
    exchangeRate: rate,
    description: description,
    debitAccount: config.debitAccount,
    propertyId: config.propertyId,
  };

  if (pdf) {
    // Luôn lưu evidence vào Drive để audit lâu dài, tách folder theo năm/tháng.
    driveEvidence = saveDriveEvidence_(pdf, props, paidDate, message.getId());
    payload.pdfBase64 = Utilities.base64Encode(pdf.getBytes());
    payload.fileName = pdf.getName();
    payload.evidenceUrl = driveEvidence.webViewUrl;
    payload.evidenceFileId = driveEvidence.fileId;
    payload.evidenceDrivePath = driveEvidence.drivePath;
  }

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
    if (config.parseDebug) {
      Logger.log(
        '[parse-debug] sent message=%s generatedEvidencePdf=%s evidenceUrl=%s',
        message.getId(),
        generatedEvidencePdf,
        driveEvidence ? driveEvidence.webViewUrl : ''
      );
    }
    return { duplicate: false, vendor: vendor, generatedEvidencePdf: generatedEvidencePdf };
  }
  if (code === 200 && text.indexOf('"duplicate":true') >= 0) {
    return { duplicate: true, vendor: vendor, generatedEvidencePdf: generatedEvidencePdf };
  }

  throw new Error('Webhook trả về HTTP ' + code + ': ' + text);
}

/* ========== Nhận diện vendor ========== */

function detectVendor_(subject, from, body) {
  // Bỏ prefix Fwd:/Re: để parse subject gốc.
  var s = subject.replace(/^(?:(?:Fwd|FW|Re|回答|転送)\s*:\s*)+/i, '');

  var directVendor = extractVendorFromSubject_(s);
  if (directVendor) return directVendor;

  // Mail forward thường có From gốc trong body; ưu tiên sender gốc hơn người forward.
  var forwardedVendor = detectVendorFromForwardedBody_(body || '');
  if (forwardedVendor) return forwardedVendor;

  // Fallback: display name trong From ("Anthropic <invoice@...>"), rồi domain.
  var parsedFrom = parseFromLine_(from || '');
  if (parsedFrom.name && parsedFrom.name.indexOf('@') === -1 && !isFreeEmailDomain_(parsedFrom.domain)) {
    return normalizeVendorName_(parsedFrom.name);
  }
  if (parsedFrom.domain) {
    return vendorFromDomain_(parsedFrom.domain);
  }
  return 'Unknown vendor';
}

function detectVendorFromForwardedBody_(body) {
  if (!body) return null;

  var subjectVendor = detectVendorFromForwardedSubjects_(body);
  if (subjectVendor) return subjectVendor;

  var fromLineRegex = /^From:\s*(.+)$/gim;
  var lines = [];
  var m;
  while ((m = fromLineRegex.exec(body)) !== null) {
    lines.push(m[1]);
  }
  if (lines.length === 0) return null;

  // Duyệt ngược để lấy sender gốc nhất trong chuỗi forward.
  for (var i = lines.length - 1; i >= 0; i--) {
    var parsed = parseFromLine_(lines[i]);
    if (!parsed.domain) continue;

    if (!isFreeEmailDomain_(parsed.domain) && !isInfrastructureMailDomain_(parsed.domain) && parsed.name) {
      return normalizeVendorName_(parsed.name);
    }

    if (!isFreeEmailDomain_(parsed.domain) && !isInfrastructureMailDomain_(parsed.domain)) {
      return vendorFromDomain_(parsed.domain);
    }
  }

  return null;
}

function detectVendorFromForwardedSubjects_(body) {
  var subjectLineRegex = /^Subject:\s*(.+)$/gim;
  var subjects = [];
  var m;

  while ((m = subjectLineRegex.exec(body)) !== null) {
    subjects.push(m[1]);
  }

  if (subjects.length === 0) return null;

  // Duyệt ngược để ưu tiên subject gốc nhất trong chuỗi forward.
  for (var i = subjects.length - 1; i >= 0; i--) {
    var vendor = extractVendorFromSubject_(subjects[i]);
    if (vendor) return vendor;
  }

  return null;
}

function extractVendorFromSubject_(subject) {
  var s = String(subject || '').trim();
  if (!s) return null;

  // Bỏ prefix chuyển tiếp/trả lời lặp nhiều lần.
  s = s.replace(/^(?:(?:Fwd|FW|Re|回答|転送)\s*:\s*)+/i, '').trim();

  var patterns = [
    /^\s*\[([^\]]+)\]/, // [GitHub] Payment Receipt
    /^your\s+(.+?)\s+order\s+(?:receipt|invoice|payment|billing)/i,
    /^your\s+(.+?)\s+(?:receipt|invoice|payment|billing)/i,
    /^(.+?)\s+order\s+(?:receipt|invoice|payment|billing)/i,
    /(?:receipt|invoice|payment|billing)\s+from\s+([^#\[\|]+?)(?:\s*[#\-–\|]|\s*$)/i,
    /^([\w][\w&.\-\s]{1,50}?)\s+(?:receipt|invoice|billing|payment)/i,
    /(?:receipt|invoice|billing|payment)\s+for\s+([^#\[\|]+?)(?:\s*[#\-–\|]|\s*$)/i,
    /(?:領収書|請求書)\s*(?:[:：]\s*)?(.{1,40}?)(?:\s*[#\-–\|]|\s*$)/
  ];

  for (var i = 0; i < patterns.length; i++) {
    var m = s.match(patterns[i]);
    if (!m) continue;
    var candidate = normalizeVendorName_(m[1]);
    if (isDateLikeOrNoiseVendor_(candidate)) continue;
    if (candidate && candidate !== 'Unknown vendor') return candidate;
  }

  return null;
}

function isDateLikeOrNoiseVendor_(name) {
  var s = String(name || '').trim();
  if (!s) return true;

  // Ví dụ: "May 7, 2026" hoặc "2026-05-07" không phải vendor.
  if (/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},\s*\d{4}$/i.test(s)) return true;
  if (/^\d{4}[\/-]\d{1,2}[\/-]\d{1,2}$/.test(s)) return true;
  if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(s)) return true;
  if (/^order\s*(?:receipt|invoice)?$/i.test(s)) return true;

  return false;
}

function parseFromLine_(line) {
  var txt = String(line || '').trim();
  var email = '';
  var em = txt.match(/<([^>]+)>/);
  if (em) {
    email = em[1].trim();
  } else {
    em = txt.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);
    if (em) email = em[0].trim();
  }

  var name = txt.replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();
  var domain = '';
  var dm = email.match(/@([\w.-]+)/);
  if (dm) domain = dm[1].toLowerCase();

  return { name: name, email: email, domain: domain };
}

function isFreeEmailDomain_(domain) {
  var d = String(domain || '').toLowerCase();
  return /(?:^|\.)gmail\.com$/.test(d)
    || /(?:^|\.)yahoo\./.test(d)
    || /(?:^|\.)outlook\.com$/.test(d)
    || /(?:^|\.)hotmail\.com$/.test(d)
    || /(?:^|\.)icloud\.com$/.test(d)
    || /(?:^|\.)proton\.me$/.test(d)
    || /(?:^|\.)protonmail\.com$/.test(d);
}

function isInfrastructureMailDomain_(domain) {
  var d = String(domain || '').toLowerCase();
  return /(?:^|\.)amazonses\.com$/.test(d)
    || /(?:^|\.)sendgrid\.net$/.test(d)
    || /(?:^|\.)mailgun\.org$/.test(d)
    || /(?:^|\.)sparkpostmail\.com$/.test(d)
    || /(?:^|\.)postmarkapp\.com$/.test(d)
    || /(?:^|\.)mandrillapp\.com$/.test(d)
    || /(?:^|\.)mailer\./.test(d)
    || /(?:^|\.)mailchimp\./.test(d);
}

function vendorFromDomain_(domain) {
  var d = String(domain || '').toLowerCase();

  if (/(?:^|\.)github\.com$/.test(d)) return 'GitHub';
  if (/(?:^|\.)openai\.com$/.test(d)) return 'OpenAI';
  if (/(?:^|\.)anthropic\.com$/.test(d)) return 'Anthropic';
  if (/(?:^|\.)google\.com$/.test(d)) return 'Google';
  if (/(?:^|\.)amazon\./.test(d)) return 'Amazon';

  // Fallback generic: lấy second-level domain có ý nghĩa.
  var clean = d.replace(/^mail\./, '').replace(/^email\./, '').replace(/^billing\./, '');
  var parts = clean.split('.').filter(function (x) { return !!x; });
  if (parts.length === 0) return 'Unknown vendor';

  var secondLevel = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  // Domain kiểu company.co.jp / company.com.au: bỏ lớp generic (co/com/net/org...).
  if (isGenericSecondLevelLabel_(secondLevel) && parts.length >= 3) {
    secondLevel = parts[parts.length - 3];
  }

  return normalizeVendorName_(secondLevel);
}

function isGenericSecondLevelLabel_(label) {
  var s = String(label || '').toLowerCase();
  return s === 'co' || s === 'com' || s === 'net' || s === 'org' || s === 'ac' || s === 'go' || s === 'or';
}

function normalizeVendorName_(name) {
  var s = String(name || '').trim();
  s = s.replace(/^[\[\(\s]+|[\]\)\s]+$/g, '');
  s = s.replace(/^your\s+/i, '');
  s = s.replace(/^(?:team|billing|payments?)\s+/i, '');
  s = s.replace(/\s+order$/i, '');
  s = s.replace(/\s+(?:team|billing|payments?)$/i, '');
  s = s.replace(/[\s,.;:]+$/g, '');
  s = s.replace(/\s+/g, ' ');
  if (!s) return 'Unknown vendor';

  if (/^github$/i.test(s)) return 'GitHub';
  if (/^openai$/i.test(s)) return 'OpenAI';
  if (/^anthropic$/i.test(s)) return 'Anthropic';
  if (/^amazon$/i.test(s)) return 'Amazon';
  if (/^google$/i.test(s)) return 'Google';
  if (/^google\s+play$/i.test(s)) return 'Google Play';

  return s;
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
  var LABEL = '(?:Amount paid|Amount charged|Amount due|Grand total|\\bTotal\\b|合計|ご請求金額|請求金額|お支払い金額|金額)';
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
    var value = parseAmountValue_(m[p.num]);
    if (!(value > 0)) continue;
    amount = value;
    if (p.fixed) currency = p.fixed;
    else if (p.code) currency = m[p.code].toUpperCase();
    else currency = signToCode[m[p.sign]] || 'USD';
  }

  if (amount === null) {
    var guessed = extractBestAmountFromBody_(body, signToCode);
    if (guessed) {
      amount = guessed.amount;
      currency = guessed.currency;
    }
  }

  // Ngày giao dịch: ưu tiên ngày trên receipt (issued/paid/date),
  // sau đó tới ngày header của mail gốc trong phần forwarded.
  var paidDate = parseReceiptDate_(subject, body);

  return { receiptNo: receiptNo, amount: amount, currency: currency || 'USD', paidDate: paidDate };
}

function extractBestAmountFromBody_(body, signToCode) {
  var lines = String(body || '').split(/\r?\n/);
  var best = null;

  var signedRe = /(US\$|[$€£¥￥₫])\s?([\d,]+(?:\.\d+)?)/g;
  var codedRe = /(USD|EUR|GBP|JPY|VND|AUD|SGD)\s?([\d,]+(?:\.\d+)?)/gi;
  var yenSuffixRe = /([\d,]+(?:\.\d+)?)\s*円/g;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line) continue;

    var lineScore = scoreAmountLine_(line);

    var m;
    while ((m = signedRe.exec(line)) !== null) {
      registerAmountCandidate_(m[2], signToCode[m[1]] || 'USD', lineScore);
    }
    while ((m = codedRe.exec(line)) !== null) {
      registerAmountCandidate_(m[2], m[1].toUpperCase(), lineScore);
    }
    while ((m = yenSuffixRe.exec(line)) !== null) {
      registerAmountCandidate_(m[1], 'JPY', lineScore);
    }
  }

  return best;

  function registerAmountCandidate_(rawAmount, curr, baseScore) {
    var value = parseAmountValue_(rawAmount);
    if (!(value > 0)) return;

    var score = baseScore;
    // Trong cùng ngữ cảnh, ưu tiên số tiền lớn hơn (thường là tổng thanh toán).
    if (best && score === best.score && value > best.amount) {
      best = { amount: value, currency: curr, score: score };
      return;
    }

    if (!best || score > best.score) {
      best = { amount: value, currency: curr, score: score };
    }
  }
}

function scoreAmountLine_(line) {
  var s = String(line || '').toLowerCase();
  var score = 0;

  if (/(?:total|grand total|amount paid|amount charged|paid on|payment|charged|paypay|paid|ご請求金額|請求金額|お支払い金額|合計|支払)/.test(s)) {
    score += 5;
  }
  if (/(?:subtotal|tax|vat|gst|jct|消費税|税)/.test(s)) {
    score -= 4;
  }
  if (/(?:invoice|receipt|billing)/.test(s)) {
    score += 1;
  }

  return score;
}

function parseReceiptDate_(subject, body) {
  var text = String(body || '');
  var s = String(subject || '');

  // 1) Ưu tiên các dòng có nhãn ngày rõ ràng trên receipt.
  var labeledPatterns = [
    /(?:Date paid|Date of issue|Issue date|Invoice date|Receipt date|Paid on|Payment date|Transaction date|Billing date|Processed on|発行日|支払日|お支払い日|請求日|取引日)[^\n\r]{0,80}?((?:[A-Z][a-z]{2,8}\s+\d{1,2},\s*\d{4})|(?:\d{4}[\/\-.年]\d{1,2}[\/\-.月]\d{1,2}日?)|(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}))/i,
    /(?:Date paid|Date of issue|Issue date|Invoice date|Receipt date|Paid on|Payment date|Transaction date|Billing date|Processed on|発行日|支払日|お支払い日|請求日|取引日)\s*[:：]?\s*((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+[A-Z][a-z]{2,8}\s+\d{1,2},\s*\d{4})/i
  ];

  for (var i = 0; i < labeledPatterns.length; i++) {
    var lm = text.match(labeledPatterns[i]);
    if (lm) {
      var ld = parseDateToken_(lm[1]);
      if (ld) return ld;
    }
  }

  // 2) Nhiều receipt có dạng chu kỳ "Nov 9, 2025 - Dec 8, 2025".
  // Chọn ngày cuối kỳ (thường là ngày phát hành/close kỳ thanh toán).
  var period = text.match(/([A-Z][a-z]{2,8}\s+\d{1,2},\s*\d{4})\s*[-–]\s*([A-Z][a-z]{2,8}\s+\d{1,2},\s*\d{4})/);
  if (period) {
    var periodEnd = parseDateToken_(period[2]);
    if (periodEnd) return periodEnd;
  }

  // 3) Parse header Date trong nội dung forwarded và lấy ngày cổ nhất
  // (thường là mail gốc từ nhà cung cấp, không phải lần forward gần nhất).
  var fromForwarded = parseOldestForwardedHeaderDate_(text);
  if (fromForwarded) return fromForwarded;

  // 4) Fallback theo mẫu ngày phổ biến trong body, rồi subject.
  var genericBody = parseFirstDateInText_(text);
  if (genericBody) return genericBody;

  var genericSubject = parseFirstDateInText_(s);
  if (genericSubject) return genericSubject;

  return null;
}

function parseOldestForwardedHeaderDate_(text) {
  var dateRegex = /^Date:\s*(.+)$/gim;
  var m;
  var oldest = null;

  while ((m = dateRegex.exec(text)) !== null) {
    var d = parseDateToken_(m[1]);
    if (!d) continue;
    if (!oldest || d.getTime() < oldest.getTime()) oldest = d;
  }

  return oldest;
}

function parseFirstDateInText_(text) {
  var t = String(text || '');
  if (!t) return null;

  var patterns = [
    /((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+[A-Z][a-z]{2,8}\s+\d{1,2},\s*\d{4})/i,
    /([A-Z][a-z]{2,8}\s+\d{1,2},\s*\d{4})/,
    /(\d{4}[\/\-.年]\d{1,2}[\/\-.月]\d{1,2}日?)/,
    /(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/
  ];

  for (var i = 0; i < patterns.length; i++) {
    var m = t.match(patterns[i]);
    if (!m) continue;
    var d = parseDateToken_(m[1]);
    if (d) return d;
  }

  return null;
}

function parseDateToken_(token) {
  var raw = String(token || '').trim();
  if (!raw) return null;

  // Chuẩn hoá chuỗi date để Date() parse ổn định hơn.
  var s = raw.replace(/[年月]/g, '/').replace(/日/g, '').replace(/[.]/g, '/').trim();
  s = s.replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+/i, '');

  // yyyy/mm/dd hoặc yyyy-mm-dd
  var ymd = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    var d1 = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    return isNaN(d1.getTime()) ? null : d1;
  }

  // mm/dd/yyyy hoặc dd/mm/yyyy (ưu tiên mm/dd cho receipt quốc tế).
  var mdy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (mdy) {
    var year = Number(mdy[3]);
    if (year < 100) year += 2000;
    var d2 = new Date(year, Number(mdy[1]) - 1, Number(mdy[2]));
    return isNaN(d2.getTime()) ? null : d2;
  }

  // Month dd, yyyy
  var d3 = new Date(s);
  if (!isNaN(d3.getTime())) return d3;

  // Trường hợp token có tiền tố khác, thử lấy lại phần date cuối cùng.
  var monthDate = raw.match(/([A-Z][a-z]{2,8}\s+\d{1,2},\s*\d{4})/);
  if (monthDate) {
    var d4 = new Date(monthDate[1]);
    if (!isNaN(d4.getTime())) return d4;
  }

  return null;
}

function parseAmountValue_(raw) {
  var s = String(raw || '').trim().replace(/\s+/g, '');
  if (!s) return NaN;

  var hasComma = s.indexOf(',') >= 0;
  var hasDot = s.indexOf('.') >= 0;

  // Hỗ trợ cả 1,234.56 (US) và 1.234,56 (EU).
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    var commaParts = s.split(',');
    if (commaParts.length === 2 && commaParts[1].length <= 2) {
      s = commaParts[0].replace(/\./g, '') + '.' + commaParts[1];
    } else {
      s = s.replace(/,/g, '');
    }
  } else {
    s = s.replace(/,/g, '');
  }

  return parseFloat(s);
}

function getReceiptText_(message) {
  var plain = message.getPlainBody() || '';
  var html = message.getBody() || '';
  var htmlText = htmlToReadableText_(html);

  // Ưu tiên plain body; thêm phần HTML để bắt các mail chỉ render invoice qua HTML.
  var combined = (plain + '\n' + htmlText).slice(0, 300000);
  return combined;
}

function htmlToReadableText_(html) {
  var s = String(html || '');
  if (!s) return '';

  // Loại bỏ style/script để tránh nhiễu parser.
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');

  // Chuyển block-level tags thành xuống dòng trước khi strip HTML.
  s = s.replace(/<\s*br\s*\/?>/gi, '\n');
  s = s.replace(/<\s*\/\s*(p|div|tr|li|h[1-6]|table)\s*>/gi, '\n');

  // Strip tags.
  s = s.replace(/<[^>]+>/g, ' ');

  // Decode một số HTML entities phổ biến trong receipt.
  s = s.replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&yen;/gi, '¥')
    .replace(/&#165;/g, '¥')
    .replace(/&#xA5;/gi, '¥')
    .replace(/&dollar;/gi, '$')
    .replace(/&#36;/g, '$')
    .replace(/&euro;/gi, '€')
    .replace(/&#8364;/g, '€')
    .replace(/&pound;/gi, '£')
    .replace(/&#163;/g, '£');

  // Chuyển quoted-printable text fragments hay gặp trong EML.
  s = s.replace(/=C2=A5/gi, '¥')
    .replace(/=E2=82=AC/gi, '€')
    .replace(/=C2=A3/gi, '£')
    .replace(/=0D=0A/gi, '\n');

  // Dọn spacing.
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function createEmailEvidencePdf_(message, vendor, parsed, body, transactionDate) {
  var doc = null;
  var file = null;
  try {
    var messageId = message.getId();
    var nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
    var receiptDate = parsed.paidDate
      ? Utilities.formatDate(parsed.paidDate, 'Asia/Tokyo', 'yyyy-MM-dd')
      : '';

    // Ưu tiên render HTML gốc của email rồi convert sang PDF để giống bản print mail hơn.
    var htmlBody = message.getBody() || '';
    var snapshotText = String(body || '');
    if (snapshotText.length > 120000) {
      snapshotText = snapshotText.slice(0, 120000) + '\n\n[Truncated at 120,000 chars]';
    }

    var htmlDoc = buildEmailEvidenceHtml_({
      messageId: messageId,
      generatedAt: nowStr,
      subject: message.getSubject() || '',
      from: message.getFrom() || '',
      to: message.getTo() || '',
      mailDate: Utilities.formatDate(message.getDate(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
      vendor: vendor || 'Unknown vendor',
      transactionDate: transactionDate || '',
      parsedReceiptDate: receiptDate,
      originalAmount: formatOriginalAmount_(parsed.amount || 0, parsed.currency || 'USD'),
      htmlBody: htmlBody,
      textFallback: snapshotText
    });

    var htmlBlob = Utilities.newBlob(htmlDoc, MimeType.HTML, 'email-receipt-' + messageId + '.html');
    var pdfBlob = htmlBlob.getAs(MimeType.PDF).setName('email-receipt-' + messageId + '.pdf');
    return pdfBlob;
  } catch (err) {
    Logger.log('Render PDF từ HTML lỗi, fallback sang Docs snapshot: %s', err);
  }

  // Fallback an toàn: giữ cơ chế cũ bằng Google Docs nếu convert HTML thất bại.
  try {
    var fallbackMessageId = message.getId();
    var fallbackReceiptDate = parsed.paidDate
      ? Utilities.formatDate(parsed.paidDate, 'Asia/Tokyo', 'yyyy-MM-dd')
      : '';

    doc = DocumentApp.create('SachiHouse Email Evidence ' + fallbackMessageId);
    var b = doc.getBody();
    b.appendParagraph('SachiHouse Email Receipt Evidence').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    b.appendParagraph('Source messageId: ' + fallbackMessageId);
    b.appendParagraph('Subject: ' + (message.getSubject() || ''));
    b.appendParagraph('From: ' + (message.getFrom() || ''));
    b.appendParagraph('To: ' + (message.getTo() || ''));
    b.appendParagraph('Mail Date: ' + Utilities.formatDate(message.getDate(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'));
    b.appendParagraph('Vendor: ' + (vendor || 'Unknown vendor'));
    b.appendParagraph('Transaction Date: ' + (transactionDate || ''));
    b.appendParagraph('Parsed Receipt Date: ' + fallbackReceiptDate);
    b.appendParagraph('Original Amount: ' + formatOriginalAmount_(parsed.amount || 0, parsed.currency || 'USD'));
    b.appendParagraph('');
    b.appendParagraph('Email Content Snapshot').setHeading(DocumentApp.ParagraphHeading.HEADING2);

    var fallbackSnapshot = String(body || '');
    if (fallbackSnapshot.length > 50000) {
      fallbackSnapshot = fallbackSnapshot.slice(0, 50000) + '\n\n[Truncated at 50,000 chars]';
    }
    b.appendParagraph(fallbackSnapshot);

    doc.saveAndClose();
    file = DriveApp.getFileById(doc.getId());
    var fallbackPdf = file.getAs(MimeType.PDF).setName('email-receipt-' + fallbackMessageId + '.pdf');
    file.setTrashed(true);
    return fallbackPdf;
  } catch (fallbackErr) {
    Logger.log('Không tạo được PDF evidence từ email (cả HTML và fallback): %s', fallbackErr);
    return null;
  }
}

function buildEmailEvidenceHtml_(data) {
  var emailHtml = sanitizeEmailHtml_(data.htmlBody || '');
  var useFallback = !emailHtml;
  var content = useFallback
    ? '<pre class="email-plain">' + escapeHtml_(data.textFallback || '') + '</pre>'
    : '<div class="email-html">' + emailHtml + '</div>';

  return ''
    + '<!doctype html>'
    + '<html><head><meta charset="utf-8">'
    + '<style>'
    + 'body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:13px;line-height:1.45;}'
    + '.title{font-size:20px;font-weight:700;margin-bottom:10px;}'
    + '.meta{border:1px solid #ddd;border-radius:8px;padding:12px 14px;margin-bottom:16px;background:#fafafa;}'
    + '.row{margin:2px 0;word-break:break-word;}'
    + '.k{display:inline-block;min-width:140px;color:#555;font-weight:600;}'
    + '.divider{height:1px;background:#e5e5e5;margin:12px 0;}'
    + '.section{font-size:14px;font-weight:700;margin:8px 0;}'
    + '.email-html{border:1px solid #ddd;border-radius:8px;padding:14px;}'
    + '.email-plain{white-space:pre-wrap;word-break:break-word;border:1px solid #ddd;border-radius:8px;padding:14px;background:#fff;}'
    + '</style></head><body>'
    + '<div class="title">SachiHouse Email Receipt Evidence</div>'
    + '<div class="meta">'
    + '<div class="row"><span class="k">Generated at:</span>' + escapeHtml_(data.generatedAt || '') + '</div>'
    + '<div class="row"><span class="k">Source messageId:</span>' + escapeHtml_(data.messageId || '') + '</div>'
    + '<div class="row"><span class="k">Subject:</span>' + escapeHtml_(data.subject || '') + '</div>'
    + '<div class="row"><span class="k">From:</span>' + escapeHtml_(data.from || '') + '</div>'
    + '<div class="row"><span class="k">To:</span>' + escapeHtml_(data.to || '') + '</div>'
    + '<div class="row"><span class="k">Mail Date:</span>' + escapeHtml_(data.mailDate || '') + '</div>'
    + '<div class="row"><span class="k">Vendor:</span>' + escapeHtml_(data.vendor || '') + '</div>'
    + '<div class="row"><span class="k">Transaction Date:</span>' + escapeHtml_(data.transactionDate || '') + '</div>'
    + '<div class="row"><span class="k">Parsed Receipt Date:</span>' + escapeHtml_(data.parsedReceiptDate || '') + '</div>'
    + '<div class="row"><span class="k">Original Amount:</span>' + escapeHtml_(data.originalAmount || '') + '</div>'
    + '</div>'
    + '<div class="divider"></div>'
    + '<div class="section">Email Content</div>'
    + content
    + '</body></html>';
}

function sanitizeEmailHtml_(html) {
  var s = String(html || '').trim();
  if (!s) return '';
  // Loại script/iframe/object để giảm rủi ro khi render.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  s = s.replace(/<object[\s\S]*?<\/object>/gi, '');
  s = s.replace(/<embed[^>]*>/gi, '');
  return s;
}

function escapeHtml_(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

  var cacheKey = fromCurrency + ':' + toCurrency;
  if (runtimeFxCache_[cacheKey]) {
    return runtimeFxCache_[cacheKey];
  }

  var cached = getCachedFxRate_(cacheKey);
  if (cached > 0) {
    runtimeFxCache_[cacheKey] = cached;
    return cached;
  }

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

  runtimeFxCache_[cacheKey] = value;
  setCachedFxRate_(cacheKey, value);
  return value;
}

function getCachedFxRate_(cacheKey) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('fx:' + cacheKey);
  if (!raw) return null;

  try {
    var parsed = JSON.parse(raw);
    var ts = Number(parsed.ts);
    var rate = Number(parsed.rate);
    if (!(rate > 0) || !(ts > 0)) return null;
    if ((Date.now() - ts) > FX_CACHE_MAX_AGE_MINUTES * 60 * 1000) return null;
    return rate;
  } catch (e) {
    return null;
  }
}

function setCachedFxRate_(cacheKey, rate) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('fx:' + cacheKey, JSON.stringify({ rate: rate, ts: Date.now() }));
}

/* ========== Lưu evidence lên Drive (audit) ========== */

function saveDriveEvidence_(pdf, props, paidDate, messageId) {
  var rootFolderName = props.getProperty('DRIVE_FOLDER_NAME') || 'SachiHouse_Receipt_Evidence';
  var shouldPublicLink = !props.getProperty('DRIVE_EVIDENCE_PUBLIC_LINK')
    || isTruthyProp_(props.getProperty('DRIVE_EVIDENCE_PUBLIC_LINK'));

  var date = (paidDate && paidDate.getTime && !isNaN(paidDate.getTime())) ? paidDate : new Date();
  var year = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy');
  var month = Utilities.formatDate(date, 'Asia/Tokyo', 'MM');
  var day = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');

  var rootFolder = getOrCreateDriveFolderByName_(rootFolderName);
  var yearFolder = getOrCreateSubFolder_(rootFolder, year);
  var monthFolder = getOrCreateSubFolder_(yearFolder, month);

  var fileName = 'receipt-' + day + '-' + messageId + '.pdf';
  var file = monthFolder.createFile(pdf.copyBlob().setName(fileName));

  if (shouldPublicLink) {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }

  return {
    fileId: file.getId(),
    webViewUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
    drivePath: rootFolderName + '/' + year + '/' + month + '/' + fileName
  };
}

function getOrCreateDriveFolderByName_(folderName) {
  var it = DriveApp.getFoldersByName(folderName);
  return it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
}

function getOrCreateSubFolder_(parentFolder, subFolderName) {
  var it = parentFolder.getFoldersByName(subFolderName);
  return it.hasNext() ? it.next() : parentFolder.createFolder(subFolderName);
}

/* ========== Helpers ========== */

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function isTruthyProp_(value) {
  var s = String(value || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
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
