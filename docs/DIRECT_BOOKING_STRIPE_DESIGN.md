# THIẾT KẾ: ĐẶT PHÒNG TRỰC TIẾP + THANH TOÁN STRIPE

| Mục | Nội dung |
| :--- | :--- |
| Phiên bản | 0.1 (Draft) |
| Ngày | 2026-07-25 |
| Phạm vi | Thay luồng "gửi email hỏi giá" bằng đặt phòng + thanh toán online |
| Cổng thanh toán | Stripe Checkout (mode=payment, JPY) |
| Trạng thái | **Pha 1 + Pha 2 (backend) đã triển khai.** Còn thiếu `STRIPE_WEBHOOK_SECRET` để chạy thật. |

> Tài liệu này **khác** với `SUBSCRIPTION_BASIC_DESIGN.md`: tài liệu kia là Stripe **Billing** cho gói thuê bao của Host. Tài liệu này là Stripe **Checkout một lần** cho khách đặt phòng.

---

## 0. QUYẾT ĐỊNH ĐÃ CHỐT

| # | Quyết định | Lựa chọn |
| :--- | :--- | :--- |
| D1 | Dòng tiền | **Một tài khoản Stripe của Sachi House**. Không dùng Stripe Connect. Chỉ mở booking trực tiếp cho các căn của chính Sachi House. |
| D2 | Kiểu đặt | **Instant Book** — thanh toán thành công là xác nhận ngay, host không cần duyệt. |
| D3 | Số tiền | **100% ngay tại thời điểm đặt.** Một Checkout Session, một PaymentIntent. |
| D4 | Hủy/hoàn tiền | **Linh hoạt**: hủy trước ngày check-in ≥ 7 ngày → hoàn 100% **trừ phí xử lý Stripe**. Trong vòng 7 ngày → không hoàn. Host chủ động hủy → hoàn 100%, Sachi House chịu phí. |
| D5 | Phương thức | **Chỉ thẻ.** Không Konbini → giữ chỗ ngắn (35 phút) là đủ, không cần trạng thái chờ thanh toán bất đồng bộ. |
| D6 | Thuế | Giá trong `pricing` **đã bao gồm thuế (税込)**. Không cần Stripe Tax. |
| D7 | Tài khoản | Stripe **cá nhân (個人事業主)**. Chỉ 2 căn đang active được mở bán trực tiếp. |
| D8 | Email | **Gmail SMTP qua nodemailer** (Pha 4). |

Hệ quả của D1: **không** cần onboarding KYC cho host, **không** cần `application_fee`, **không** đụng tới rủi ro pháp lý 資金移動業. Đổi lại cần một cờ trên property để đánh dấu căn nào được mở bán trực tiếp (Mục 3.3).

---

## 1. HIỆN TRẠNG & KHOẢNG TRỐNG

### 1.1. Tài sản tái sử dụng được

| Hạng mục | Vị trí | Ghi chú |
| :--- | :--- | :--- |
| Widget chọn ngày / số khách / tính giá | `frontend/components/BookingWidget.tsx` | Giữ nguyên UI, chỉ thay hành động của nút cuối |
| Tính giá phía server | `backend/src/domain/pricing.ts` → `calculateQuote()` | Đã có đủ: rate theo số khách, giảm giá trẻ em, giảm giá lưu trú dài, phí dọn dẹp |
| `POST /api/quotes` | `app.ts:1557` | Đã kiểm tra ngày trùng và trả **409** kèm danh sách ngày bị chặn |
| Tìm căn còn trống | `GET /api/properties/availability` (`app.ts:969`) | Dùng ở `ListingsPage.tsx` |
| Lịch host + block tay + đồng bộ iCal 2 chiều | `services/icalSync.ts`, `services/icsExport.ts`, `HostCalendarPage.tsx` | Đã chạy |
| Phiếu xác nhận + PDF | bảng `booking_confirmations` (`store/types.ts:182`) | Có sẵn trường `roomFee`, `cleaningFee`, `depositAmount`, `balanceDue` |
| Check-in Minpaku + OCR hộ chiếu | `services/idProcessing.ts` | Bắt buộc theo luật, đã chạy — sẽ nối link vào email xác nhận |
| Đa ngôn ngữ | `contexts/LanguageContext.tsx` — `en, vi, ja, zh, ko` | Toàn bộ chuỗi mới phải thêm cho cả 5 |

### 1.2. Khoảng trống phải lấp

| # | Vấn đề | Mức |
| :--- | :--- | :--- |
| G1 | `booking_confirmations` **không** chặn lịch. `getEffectiveBlockedDates()` (`app.ts:301`) chỉ gộp *block tay + iCal import*. Một booking trực tiếp hiện **không** làm căn đó biến mất khỏi kết quả tìm phòng → double booking. | 🔴 Chặn |
| G2 | Không có trạng thái booking, không có khái niệm "giữ chỗ tạm" trong lúc khách đang ở trang thanh toán → hai khách có thể trả tiền cho cùng một đêm. | 🔴 Chặn |
| G3 | Chưa có một dòng code Stripe nào trong repo. | 🔴 Chặn |
| G4 | Không có dịch vụ gửi email (không có nodemailer/sendgrid/resend). | 🟠 Cao |
| G5 | `booking_confirmations.createdByUserId` là bắt buộc → bảng này không dùng trực tiếp được cho khách tự đặt. | 🟠 Cao |
| G6 | Chưa có trang 特定商取引法 / chính sách hủy — Stripe JP yêu cầu khi duyệt tài khoản. | 🟠 Cao |

---

## 2. MÔ HÌNH DỮ LIỆU

### 2.1. Bảng mới

```sql
CREATE TABLE IF NOT EXISTS bookings (
  id                       TEXT PRIMARY KEY,          -- BK-xxxxxxxx
  confirmation_no          TEXT UNIQUE,               -- chỉ cấp khi đã confirmed
  property_id              TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  status                   TEXT NOT NULL,             -- xem 2.3
  guest_name               TEXT NOT NULL,
  guest_email              TEXT NOT NULL,
  guest_phone              TEXT,
  guest_token              TEXT NOT NULL,             -- 32 byte random, cho khách xem/hủy không cần đăng nhập
  adults                   INT  NOT NULL,
  children                 INT  NOT NULL DEFAULT 0,
  infants                  INT  NOT NULL DEFAULT 0,
  check_in_date            DATE NOT NULL,
  check_out_date           DATE NOT NULL,
  nights                   INT  NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'JPY',
  amount_total             INT  NOT NULL,             -- JPY nguyên, KHÔNG nhân 100
  quote                    JSONB NOT NULL,            -- snapshot QuoteResult tại thời điểm đặt
  stripe_session_id        TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  hold_expires_at          BIGINT,                    -- chỉ có ý nghĩa khi pending_payment
  confirmed_at             BIGINT,
  cancelled_at             BIGINT,
  cancel_reason            TEXT,
  refund_amount            INT NOT NULL DEFAULT 0,
  locale                   TEXT NOT NULL DEFAULT 'ja',
  created_at               BIGINT NOT NULL,
  updated_at               BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_property_dates ON bookings(property_id, check_in_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status_hold    ON bookings(status, hold_expires_at);

-- Chống trùng lịch ở tầng DB. Một đêm của một căn chỉ tồn tại đúng một hàng.
CREATE TABLE IF NOT EXISTS booking_held_dates (
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  stay_date   DATE NOT NULL,
  booking_id  TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  PRIMARY KEY (property_id, stay_date)
);

-- Idempotency cho webhook (Stripe gửi lại nhiều lần cùng một event).
CREATE TABLE IF NOT EXISTS stripe_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  booking_id  TEXT,
  received_at BIGINT NOT NULL,
  payload     JSONB
);
```

### 2.2. Vì sao tách `booking_held_dates`

Toàn bộ việc chống double-booking dựa vào `PRIMARY KEY (property_id, stay_date)`. Tạo booking là **một transaction**:

```
BEGIN;
  INSERT INTO bookings (...) VALUES (...);
  INSERT INTO booking_held_dates (property_id, stay_date, booking_id)
    VALUES ($1,'2026-08-01',$2), ($1,'2026-08-02',$2), ...;
COMMIT;
```

Hai khách bấm "Đặt ngay" cùng lúc cho cùng một đêm → người thứ hai bị **unique violation (23505)** → API trả `409 { error, conflictDates }`. Không phụ thuộc vào thứ tự chạy của application code, không cần lock thủ công.

Không gộp vào bảng `blocked_dates` sẵn có, để phân biệt rõ nguồn gốc (block tay / iCal / booking trực tiếp) khi hiển thị lịch host.

### 2.3. Máy trạng thái

```
                    ┌──────────────────┐
   POST /api/bookings│ pending_payment  │  giữ booking_held_dates, hold_expires_at = +35'
                    └────────┬─────────┘
        ┌────────────────────┼────────────────────┐
        │ webhook            │ webhook            │ cron quét
        │ session.completed  │ payment_failed     │ quá hạn / session.expired
        ▼                    ▼                    ▼
  ┌───────────┐      ┌────────────────┐     ┌──────────┐
  │ confirmed │      │ payment_failed │     │ expired  │
  └─────┬─────┘      └────────────────┘     └──────────┘
        │                    │ XÓA held_dates       │ XÓA held_dates
        │
   ┌────┴────────────────────────────┐
   ▼                                 ▼
┌───────────────────┐      ┌────────────────────┐
│ cancelled_by_guest│      │ cancelled_by_host  │
│ (± refund)        │      │ (luôn refund 100%) │
└───────────────────┘      └────────────────────┘
        XÓA held_dates → ngày mở bán lại
```

`booking_held_dates` chỉ tồn tại cho `pending_payment` và `confirmed`. Mọi trạng thái kết thúc đều xóa hàng tương ứng, trả ngày về trạng thái trống.

### 2.4. Quan hệ với `booking_confirmations`

Giữ nguyên bảng cũ (host vẫn tạo tay cho khách đặt qua Airbnb/điện thoại). Khi một `booking` chuyển sang `confirmed`, sinh thêm một bản ghi `booking_confirmations` tương ứng để tái dùng luồng PDF và báo cáo doanh thu — với `createdByUserId = 0` / `createdByName = 'Direct booking'` và thêm cột `booking_id` để liên kết ngược.

---

## 3. LOGIC NGHIỆP VỤ

### 3.1. Hợp nhất tính khả dụng — LÀM TRƯỚC TIÊN

Sửa `getEffectiveBlockedDates()` (`app.ts:301`):

```
blocked = block_tay  ∪  iCal_import  ∪  booking_held_dates(booking đang active)
```

Ảnh hưởng dây chuyền (tất cả tự động đúng theo sau một thay đổi):
- `GET /api/properties/availability` — căn đã bán trực tiếp biến mất khỏi kết quả tìm
- `GET /api/properties/:id/blocked-dates` — lịch trong `BookingWidget` gạch ngang ngày đã bán
- `POST /api/quotes` — trả 409 đúng
- `GET /api/properties/:id/calendar` — lịch host
- `services/icsExport.ts` — **quan trọng**: Airbnb / Booking.com đọc feed này, phải thấy ngày đã bán trực tiếp, nếu không sẽ bị trùng khách chéo nền tảng

### 3.2. Giá luôn tính lại ở server

Client gửi lên: `propertyId, checkIn, checkOut, adults, children, infants`. **Không** gửi số tiền. Server gọi `calculateQuote(property.pricing, input)` và dùng kết quả đó cho Stripe. Số tiền client hiển thị chỉ là ước tính; nếu lệch, server thắng.

### 3.3. Cờ mở bán trực tiếp

Thêm `directBooking?: { enabled: boolean; minNights?: number; maxAdvanceDays?: number; sameDayCutoffHour?: number }` vào `PropertyData` (JSONB, không cần migration cột). Chỉ căn có `enabled === true` mới nhận booking; các căn khác giữ nguyên nút hỏi giá qua email như hiện tại. Điều này cho phép mở bán dần từng căn và khớp với D1 (chỉ căn của Sachi House).

### 3.4. Quy tắc hoàn tiền (D4)

```
daysBefore = số ngày từ (thời điểm hủy, Asia/Tokyo) đến 00:00 ngày check-in
daysBefore >= 7  → hoàn 100% amount_total
daysBefore <  7  → hoàn 0
host chủ động hủy → luôn hoàn 100%, bất kể thời điểm
```

Thực thi bằng `stripe.refunds.create({ payment_intent, amount })`. Lưu ý Stripe **không** trả lại phí xử lý (~3.6%) khi hoàn tiền — xem câu hỏi Q5 ở Mục 10.

Toàn bộ so sánh ngày dùng múi giờ **Asia/Tokyo**, không dùng giờ server.

---

## 4. TÍCH HỢP STRIPE — CHI TIẾT KỸ THUẬT

### 4.1. Những cái sai kinh điển phải tránh

| Điểm | Yêu cầu |
| :--- | :--- |
| **JPY là zero-decimal** | `unit_amount: 15000` nghĩa là ¥15.000. **Tuyệt đối không nhân 100.** |
| **Raw body cho webhook** | `app.post('/api/stripe/webhook', express.raw({type:'application/json'}), ...)` phải được đăng ký **trước** `express.json()` trong `app.ts`, nếu không chữ ký luôn sai. |
| **Nguồn sự thật** | Chỉ webhook mới được phép đổi trạng thái sang `confirmed`. `success_url` chỉ để hiển thị — khách có thể tự gõ URL đó. |
| **Idempotency** | Ghi `event.id` vào `stripe_events` trước khi xử lý; nếu đã tồn tại → trả 200 và bỏ qua. |
| **Trả 200 nhanh** | Webhook phải trả 200 trong vài giây. Gửi email làm sau (fire-and-forget hoặc hàng đợi), không chặn response. |
| **`expires_at` tối thiểu 30 phút** | Ràng buộc của Stripe. Vì vậy hold nội bộ đặt **35 phút**, `expires_at` của session đặt **30 phút** → session luôn chết trước khi hold hết hạn. |

### 4.2. Tạo Checkout Session

```ts
stripe.checkout.sessions.create({
  mode: 'payment',
  client_reference_id: booking.id,
  customer_email: booking.guestEmail,
  locale: mapLocale(booking.locale),          // ja | en | zh | ko  (vi → en, Stripe chưa hỗ trợ)
  expires_at: Math.floor(Date.now()/1000) + 30*60,
  line_items: [{
    quantity: 1,
    price_data: {
      currency: 'jpy',
      unit_amount: booking.amountTotal,        // JPY nguyên
      product_data: {
        name: `${property.name} — ${checkIn} → ${checkOut} (${nights} đêm)`,
        description: `${adults} người lớn, ${children} trẻ em`,
      },
    },
  }],
  payment_intent_data: { metadata: { bookingId: booking.id, propertyId } },
  metadata: { bookingId: booking.id, propertyId },
  success_url: `${PUBLIC_SITE_URL}/booking/result?id=${booking.id}&token=${guestToken}`,
  cancel_url:  `${PUBLIC_SITE_URL}/booking/cancelled?id=${booking.id}`,
}, { idempotencyKey: `booking-${booking.id}` });
```

### 4.3. Event cần xử lý

| Event | Hành động |
| :--- | :--- |
| `checkout.session.completed` | `pending_payment → confirmed`; lưu `payment_intent`; xóa `hold_expires_at`; sinh `confirmation_no`; tạo `booking_confirmations`; gửi email khách + host |
| `checkout.session.expired` | `pending_payment → expired`; xóa `booking_held_dates` |
| `payment_intent.payment_failed` | `→ payment_failed`; xóa held dates; email thông báo |
| `charge.refunded` | Cập nhật `refund_amount` (đồng bộ cả trường hợp hoàn tiền thủ công trong Dashboard) |
| `charge.dispute.created` | Cảnh báo admin; **không** tự hủy booking |

### 4.4. Cron dọn hold hết hạn

`node-cron` đã có sẵn trong `index.ts`. Thêm job chạy **mỗi 5 phút**:

```
UPDATE bookings SET status='expired' WHERE status='pending_payment' AND hold_expires_at < now;
DELETE FROM booking_held_dates WHERE booking_id IN (những id vừa expired);
```

Đây là lưới an toàn cho trường hợp webhook `session.expired` không tới.

### 4.5. Biến môi trường mới

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
PUBLIC_SITE_URL=https://sachihouse.jp
BOOKING_HOLD_MINUTES=35
BOOKING_TIMEZONE=Asia/Tokyo
MAIL_PROVIDER_API_KEY=...
MAIL_FROM="Sachi House <booking@sachihouse.jp>"
MAIL_HOST_NOTIFY=...
```

---

## 5. API MỚI

| Method | Path | Auth | Mô tả |
| :--- | :--- | :--- | :--- |
| POST | `/api/bookings` | công khai | Tính giá lại, tạo hold trong transaction, tạo Checkout Session. Trả `{ bookingId, checkoutUrl }`. 409 nếu ngày đã bị chiếm. |
| GET | `/api/bookings/:id?token=` | guest token | Trạng thái booking cho trang kết quả (frontend poll 2s trong ~30s chờ webhook). |
| POST | `/api/bookings/:id/cancel` | guest token | Khách tự hủy, áp quy tắc 7 ngày, gọi refund. |
| POST | `/api/stripe/webhook` | chữ ký Stripe | Xử lý event. |
| GET | `/api/bookings` | host/admin | Danh sách booking trực tiếp, lọc theo property/ngày/trạng thái. |
| POST | `/api/bookings/:id/cancel-by-host` | host/admin | Hủy + hoàn 100%. |
| POST | `/api/bookings/:id/refund` | admin | Hoàn tiền số tiền tuỳ ý (xử lý ngoại lệ). |

Rate limit `POST /api/bookings` theo IP (ví dụ 10 lần/giờ) để tránh bị spam giữ chỗ làm cạn lịch.

---

## 6. FRONTEND

| File | Thay đổi |
| :--- | :--- |
| `components/BookingWidget.tsx` | Nếu `property.directBooking.enabled` → nút "Đặt ngay" mở form thông tin khách (tên, email, ĐT) → gọi `POST /api/bookings` → `window.location.href = checkoutUrl`. Nếu không → giữ nguyên nút email hiện tại. |
| `components/BookingGuestForm.tsx` *(mới)* | Form thông tin khách + tick đồng ý điều khoản & chính sách hủy (bắt buộc). |
| `pages/BookingResultPage.tsx` *(mới)* | Trang khách quay về từ Stripe. Poll trạng thái, hiển thị "đang xác nhận…" → thành công (mã đặt phòng, link check-in) hoặc lỗi. |
| `pages/BookingManagePage.tsx` *(mới)* | Xem/hủy booking bằng link `?id=&token=` trong email. |
| `pages/LegalTokushohoPage.tsx`, `pages/CancellationPolicyPage.tsx` *(mới)* | Bắt buộc (Mục 8). |
| `services/booking.ts` *(mới)* | `createBooking`, `getBookingStatus`, `cancelBooking`. |
| `App.tsx` | Thêm các route trên. |
| `utils/translations.ts` | Chuỗi mới cho **5 ngôn ngữ** (en, vi, ja, zh, ko). |
| `pages/HostCalendarPage.tsx` | Hiện booking trực tiếp bằng màu riêng, khác block tay và khác iCal import. |

---

## 7. FILE PHẢI SỬA (BACKEND)

```
backend/src/store/types.ts          + Booking, BookingInput, BookingStatus, + method vào interface DataStore
backend/src/store/postgresStore.ts  + 3 bảng, + transaction tạo hold, + query
backend/src/store/memoryStore.ts    + cùng interface (test chạy STORE_MODE=memory)
backend/src/domain/booking.ts       (mới) máy trạng thái, tính hoàn tiền, sinh mã
backend/src/services/stripe.ts      (mới) client + tạo session + refund
backend/src/services/mailer.ts      (mới) 
backend/src/app.ts                  + route mới, + raw body webhook, + sửa getEffectiveBlockedDates
backend/src/services/icsExport.ts   + đưa booking trực tiếp vào feed
backend/src/index.ts                + cron dọn hold
```

---

## 8. TUÂN THỦ PHÁP LÝ (NHẬT BẢN)

Stripe JP sẽ kiểm tra website khi duyệt tài khoản. Thiếu những mục này có thể bị treo tài khoản:

1. **特定商取引法に基づく表記** — tên pháp nhân/người đại diện, địa chỉ, số điện thoại, email, giá bán, các khoản phí khác, phương thức và thời điểm thanh toán, thời điểm cung cấp dịch vụ, điều kiện hủy/hoàn tiền.
2. **Chính sách hủy** hiển thị **trước** khi bấm thanh toán, và trong email xác nhận.
3. Điều khoản sử dụng + Chính sách bảo mật.
4. Ghi rõ giá đã bao gồm 消費税 10% hay chưa.
5. Booking trực tiếp vẫn phải qua luồng check-in ghi nhận hộ chiếu (民泊/旅館業法) — link vào email xác nhận.

---

## 9. KIỂM THỬ

Repo đã có vitest + supertest (`backend/tests/{unit,integration}`).

| Loại | Ca kiểm thử |
| :--- | :--- |
| Unit | Tính hoàn tiền quanh mốc 7 ngày (6/7/8 ngày, đúng nửa đêm Asia/Tokyo); máy trạng thái từ chối chuyển trạng thái sai |
| Integration | Hai request `POST /api/bookings` song song cùng ngày → đúng 1 thành công, 1 nhận 409 |
| Integration | Hold hết hạn → cron → ngày xuất hiện lại trong `/availability` |
| Integration | Webhook cùng `event.id` gửi 2 lần → chỉ tạo 1 confirmation |
| Integration | Webhook sai chữ ký → 400 |
| Integration | `getEffectiveBlockedDates` gộp đủ 3 nguồn |
| Thủ công | `stripe listen --forward-to localhost:3001/api/stripe/webhook` + thẻ test `4242…`, thẻ lỗi `4000000000000002`, thẻ 3DS `4000002500003155` |

---

## 10. THÔNG TIN CẦN CUNG CẤP TRƯỚC KHI CODE

Đã có: tài khoản Stripe cá nhân + `STRIPE_SECRET_KEY` (test, đã ghi vào `backend/.env`), chỉ thẻ, giá đã gồm thuế, phí Stripe trừ vào tiền hoàn, email dùng Gmail SMTP, 2 căn là `s01` và `s02`.

Còn thiếu:

| # | Câu hỏi | Ảnh hưởng |
| :--- | :--- | :--- |
| Q1 | `STRIPE_WEBHOOK_SECRET` — chỉ có sau khi tạo webhook endpoint trong Stripe. Không có thì webhook trả 400 và booking không bao giờ được xác nhận. | **Chặn chạy thật** |
| Q2 | Ràng buộc đặt phòng cho `s01`/`s02`: số đêm tối thiểu, đặt trước tối đa bao xa, giờ cắt đặt trong ngày. Mặc định: 1 đêm / 365 ngày / 12:00 JST. | Cấu hình |
| Q3 | App password của Gmail cho nodemailer. | Pha 4 |
| Q4 | Nội dung 特商法: họ tên chủ hộ kinh doanh, địa chỉ, số điện thoại, email liên hệ. | Pha 6 |
| Q5 | Có thu 宿泊税 (thuế lưu trú của tỉnh/thành) không, và thu online hay tại chỗ? | Tính tiền |

### Cách lấy `STRIPE_WEBHOOK_SECRET`

**Chạy thật (production):** Stripe Dashboard → Developers → Webhooks → *Add endpoint*
- URL: `https://sachihouse-production.up.railway.app/api/stripe/webhook` (**https, không có `:8080`** — Railway map cổng 8080 nội bộ ra 443 công khai)
- Events: `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`
- Sau khi tạo, bấm *Reveal* ở **Signing secret** → chuỗi `whsec_…` → đặt vào biến môi trường trên Railway.

**Chạy local:**
```
stripe login
stripe listen --forward-to localhost:3001/api/stripe/webhook
```
Lệnh `listen` in ra `whsec_…` riêng cho phiên đó → dán vào `backend/.env`.

### Bật bán trực tiếp cho s01 / s02

```
railway link   # một lần, chọn project aware-spirit / environment production

railway run --service Postgres node backend/scripts/enable-direct-booking.mjs s01 s02          # xem trước
railway run --service Postgres node backend/scripts/enable-direct-booking.mjs s01 s02 --apply  # ghi thật
```

`--service Postgres` là bắt buộc: service backend chỉ có `DATABASE_URL` trỏ tới `postgres.railway.internal` (chỉ phân giải trong mạng nội bộ Railway), còn service Postgres mới có thêm `DATABASE_PUBLIC_URL` — cái duy nhất kết nối được từ máy cá nhân.

---

## 11. THỨ TỰ TRIỂN KHAI

| Pha | Nội dung | Phụ thuộc |
| :--- | :--- | :--- |
| **1** | Bảng `bookings` + `booking_held_dates`; hợp nhất availability; cron dọn hold; iCal export gồm booking trực tiếp. **Chưa có tiền — kiểm thử được toàn bộ chống double-booking.** | — |
| **2** | `services/stripe.ts`, `POST /api/bookings`, webhook, trang kết quả | Q1, Q9 |
| **3** | Giao diện khách: form + nút "Đặt ngay" + 5 ngôn ngữ | Pha 2 |
| **4** | Email xác nhận (khách + host), link check-in | Q3 |
| **5** | Màn hình host/admin: danh sách, hủy, hoàn tiền; nối vào `FinancePage` | Pha 2 |
| **6** | Trang 特商法 + chính sách hủy; chuyển từ test key sang live key | Q4 |

Pha 1 là phần rủi ro nhất và không phụ thuộc Stripe — nên làm và kiểm thử xong trước khi động đến thanh toán.
