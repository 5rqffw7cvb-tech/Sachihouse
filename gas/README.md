# Receipt Sync — Gmail → SachiHouse Finance

Tự động: **mọi mail receipt/invoice kèm PDF** (Anthropic, OpenAI, Google, Amazon, hoá đơn tiếng Nhật...) → Google Apps Script trích xuất vendor/số tiền/ngày → quy đổi JPY theo tỉ giá Google (receipt JPY thì giữ nguyên) → POST sang SachiHouse → tạo giao dịch **PENDING** trong module Finance (chờ approve ở màn 未承認仕訳). PDF gốc được lưu vào GCS receipt bucket làm chứng từ.

## Luồng hoạt động

```
Gmail (receipt/invoice + PDF, mọi vendor)
   │  trigger 15 phút
   ▼
Google Apps Script
   │  1. parse vendor / số tiền / ngày / số receipt
   │  2. GOOGLEFINANCE: quy đổi → JPY tại thời điểm xử lý
   │  3. POST JSON + PDF base64, header x-api-key
   ▼
POST /api/finance/ingest/email-receipt   (SachiHouse backend)
   │  - check API key (timing-safe)
   │  - phân loại property theo rule email → property (tab メール連携ルール)
   │  - chống trùng: sourceRef "gmail:<messageId>" unique trong DB
   │  - lưu PDF nguyên bản vào GCS (receipts/<property>/...pdf)
   ▼
pending_transactions (ocr_processed=true)
   │  admin/host level 4 vào Finance → 未承認 → Approve
   ▼
financial_transactions (journal chính thức)
```

## 1. Cấu hình backend (Railway)

App chạy trên Railway nên biến môi trường phải đặt **trên Railway** (không phải file `.env` ở máy — file đó chỉ dùng test local).

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `FINANCE_INGEST_API_KEY` | ✅ | Shared secret cho webhook. Tạo chuỗi ngẫu nhiên dài (VD `openssl rand -hex 32`). Chưa set thì endpoint trả 503. |
| `FINANCE_INGEST_RULES` | ⭕ | **Fallback** — JSON map email → property, chỉ dùng khi email chưa có rule trong DB. Khuyến nghị quản lý rule qua giao diện (xem mục dưới) thay vì env này. VD: `{"host-a@gmail.com":"property_a"}` |
| `FINANCE_INGEST_PROPERTY_ID` | ⭕ | Property mặc định khi không rule nào khớp. Có thể thay bằng `PROPERTY_ID` phía Apps Script. |

Các bước trên Railway:

1. Mở https://railway.app → vào **project** của bạn → chọn **service backend** (service chạy API, cùng chỗ đã có `GCP_SERVICE_ACCOUNT_JSON_B64`, `GCS_BUCKET`...).
2. Tab **Variables** → **New Variable**:
   - Name: `FINANCE_INGEST_API_KEY`, Value: chuỗi secret (đã tạo sẵn — xem `backend/.env` local hoặc tạo mới).
   - (Tuỳ chọn) thêm `FINANCE_INGEST_PROPERTY_ID` nếu muốn có property mặc định.
3. Railway tự redeploy sau khi thêm biến (hoặc bấm **Deploy**). Migration tự chạy khi backend khởi động: thêm cột `source_ref` + unique index vào `pending_transactions` / `financial_transactions`, và tạo bảng `finance_ingest_rules` (rule quản lý qua giao diện).
4. Lấy **domain public** của service backend: tab **Settings → Networking → Public Networking** (dạng `https://<tên>.up.railway.app`, hoặc custom domain nếu đã gắn). Webhook URL cho Apps Script sẽ là:

   ```
   https://<domain-backend>/api/finance/ingest/email-receipt
   ```

5. Kiểm tra nhanh sau khi deploy: gọi thử không có API key phải trả `401` (còn `503` nghĩa là biến chưa được set):

   ```bash
   curl -i -X POST https://<domain-backend>/api/finance/ingest/email-receipt \
     -H "Content-Type: application/json" -d '{}'
   ```

### Phân loại property theo rule

**Quản lý qua giao diện (khuyến nghị):** đăng nhập admin → 財務管理 (Finance) → tab **メール連携ルール** — thêm/sửa/xoá rule email → property trực tiếp, lưu trong DB (bảng `finance_ingest_rules`), có hiệu lực ngay không cần deploy.

Apps Script gửi kèm 2 thông tin: `toEmail` (địa chỉ **To** của mail — email thanh toán của từng host) và `accountEmail` (tài khoản Gmail đang chạy script). Backend chọn property theo thứ tự:

1. **Rule trong DB** (quản lý qua giao diện) — duyệt các địa chỉ trong `toEmail` trước, rồi `accountEmail`.
2. Rule trong env `FINANCE_INGEST_RULES` (fallback khi chưa có rule DB).
3. `PROPERTY_ID` do Apps Script gửi lên (nếu có).
4. `FINANCE_INGEST_PROPERTY_ID` (mặc định toàn cục).

Không khớp gì cả → trả 400 kèm danh sách email đã thấy (xem trong log Executions của Apps Script để biết cần thêm rule nào).

## 2. Cài Google Apps Script

1. Vào https://script.google.com (đúng tài khoản Gmail nhận receipt) → **New project**.
2. Dán toàn bộ nội dung `receipt-sync.gs`.
3. **Project Settings → Script Properties**, thêm:

   | Key | Value |
   |---|---|
   | `SACHIHOUSE_WEBHOOK_URL` | `https://<domain>/api/finance/ingest/email-receipt` |
   | `SACHIHOUSE_API_KEY` | trùng `FINANCE_INGEST_API_KEY` |
   | `PROPERTY_ID` | (tuỳ chọn) property nhận chi phí |
   | `DEBIT_ACCOUNT` | (tuỳ chọn) khoa mục nợ, mặc định `通信費` |
   | `GMAIL_QUERY` | (tuỳ chọn) override query tìm mail |
   | `DRIVE_FOLDER_NAME` | (tuỳ chọn) nếu set, backup thêm PDF vào Drive folder này |

4. Chạy hàm `setup()` một lần (Run → setup) → cấp quyền Gmail/Drive/Sheets khi được hỏi. Hàm này tạo trigger 15 phút + label `SachiHouse_Processed`.
5. Chạy `testRunOnce()` để thử ngay, xem log tại **Executions**.

## 3. Chi tiết kỹ thuật

- **Query Gmail mặc định:** `subject:(receipt OR invoice OR 領収書 OR 請求書) has:attachment filename:pdf newer_than:90d` (loại trừ thread đã gắn label). Nhận diện theo **subject** chứ không theo người gửi, nên hoạt động cả khi receipt được **forward** từ hộp thư khác sang. Cần pattern khác thì override bằng `GMAIL_QUERY`.
- **Nhận diện vendor:** từ subject ("Your receipt from Anthropic, PBC #..." → "Anthropic, PBC"), fallback sang tên hiển thị/domain người gửi. Vendor được ghi vào cột vendor + description của giao dịch.
- **Parse số tiền:** ưu tiên dòng có nhãn (Amount paid / Total / 合計 / ご請求金額...), hỗ trợ ký hiệu `$ € £ ¥ ₫`, mã `USD EUR GBP JPY...` và dạng `1,234円`. Vì mail mỗi vendor mỗi khác, **luôn kiểm tra lại số tiền khi approve**.
- **Tỉ giá:** dùng `GOOGLEFINANCE("CURRENCY:<XXX>JPY")` qua một spreadsheet phụ tự tạo (`SachiHouse FX Helper`) — đúng tỉ giá Google tại thời điểm script chạy. Tỉ giá + số tiền gốc được ghi vào description để đối chiếu. Receipt đã là JPY thì không quy đổi.
- **Chống trùng lặp (3 lớp):**
  1. Label Gmail + Script Properties (`processed:<messageId>`) — không gửi lại.
  2. Backend check `sourceRef` trước khi tạo record → trả `{ duplicate: true }`.
  3. Unique index trong Postgres — chặn cả race condition; sourceRef đi theo record khi approve (pending → journal) nên approve xong cũng không thể nhập trùng.
- **Giữ PDF:** bản gốc lưu GCS (không nén) + Gmail vẫn giữ mail gốc; tuỳ chọn backup Drive. Màn preview 未承認 hiển thị PDF qua iframe.
- **Lỗi tạm thời** (webhook down, rate chưa load): message không bị đánh dấu processed → tự retry ở lần chạy sau.
- **Số tiền JPY** làm tròn về số nguyên (cột amount là INTEGER).

## 4. Test webhook thủ công

```bash
curl -X POST https://<domain>/api/finance/ingest/email-receipt \
  -H "Content-Type: application/json" \
  -H "x-api-key: <FINANCE_INGEST_API_KEY>" \
  -d '{
    "sourceRef": "gmail:test-001",
    "toEmail": "host-a@gmail.com",
    "vendor": "Anthropic",
    "transactionDate": "2026-07-01",
    "amountJpy": 3900,
    "originalAmount": 25.00,
    "originalCurrency": "USD",
    "exchangeRate": 156.0,
    "description": "Anthropic API利用料 (test)"
  }'
```

- Lần 1 → `201 { "id": "...", "duplicate": false }`
- Lần 2 (cùng sourceRef) → `200 { "duplicate": true }`

Lưu ý: request trên chỉ trả 201 khi `host-a@gmail.com` đã có rule (tab メール連携ルール hoặc `FINANCE_INGEST_RULES`), hoặc đã set `FINANCE_INGEST_PROPERTY_ID`. Nếu không sẽ trả `400` kèm danh sách email đã thấy — có thể thêm `"propertyId": "<id>"` vào payload để test không cần rule.
