# Anthropic Receipt Sync — Gmail → SachiHouse Finance

Tự động: mail receipt từ Anthropic (kèm PDF) → Google Apps Script trích xuất → quy đổi JPY theo tỉ giá Google → POST sang SachiHouse → tạo giao dịch **PENDING** trong module Finance (chờ approve ở màn 未承認仕訳). PDF gốc được lưu vào GCS receipt bucket làm chứng từ.

## Luồng hoạt động

```
Gmail (receipt Anthropic + PDF)
   │  trigger 15 phút
   ▼
Google Apps Script
   │  1. parse số tiền / ngày / số receipt
   │  2. GOOGLEFINANCE: USD→JPY tại thời điểm xử lý
   │  3. POST JSON + PDF base64, header x-api-key
   ▼
POST /api/finance/ingest/email-receipt   (SachiHouse backend)
   │  - check API key (timing-safe)
   │  - chống trùng: sourceRef "gmail:<messageId>" unique trong DB
   │  - lưu PDF nguyên bản vào GCS (receipts/<property>/...pdf)
   ▼
pending_transactions (ocr_processed=true)
   │  admin/host level 4 vào Finance → 未承認 → Approve
   ▼
financial_transactions (journal chính thức)
```

## 1. Cấu hình backend

Thêm biến môi trường (`.env` của backend hoặc docker-compose):

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `FINANCE_INGEST_API_KEY` | ✅ | Shared secret cho webhook. Tạo chuỗi ngẫu nhiên dài (VD `openssl rand -hex 32`). Chưa set thì endpoint trả 503. |
| `FINANCE_INGEST_RULES` | ⭕ | JSON map **email → property**: mail liên quan email nào thì ghi chi phí cho property đó. VD: `{"host-a@gmail.com":"property_a","host-b@gmail.com":"property_b"}` |
| `FINANCE_INGEST_PROPERTY_ID` | ⭕ | Property mặc định khi không rule nào khớp. Có thể thay bằng `PROPERTY_ID` phía Apps Script. |

Migration tự chạy khi backend khởi động (thêm cột `source_ref` + unique index vào `pending_transactions` và `financial_transactions`).

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
2. Dán toàn bộ nội dung `anthropic-receipt-sync.gs`.
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

- **Query Gmail mặc định:** `from:anthropic.com subject:receipt has:attachment filename:pdf newer_than:90d` (loại trừ thread đã gắn label). Nếu receipt đến từ địa chỉ khác (VD qua Stripe), chỉnh `GMAIL_QUERY`.
- **Tỉ giá:** dùng `GOOGLEFINANCE("CURRENCY:USDJPY")` qua một spreadsheet phụ tự tạo (`SachiHouse FX Helper`) — đúng tỉ giá Google tại thời điểm script chạy. Tỉ giá + số tiền gốc được ghi vào description để đối chiếu.
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
