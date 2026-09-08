# Cài đặt bucket lưu hóa đơn (適格請求書)

> **Bạn KHÔNG cần tạo project hay service account mới.** Dùng lại đúng cái đang
> chạy cho receipt. Việc duy nhất phải làm là tạo **1 bucket private** và cấp
> quyền cho service account cũ, rồi thêm **1 biến môi trường** trên Railway.
>
> **Không cần gửi JSON key cho ai.** Key đã nằm sẵn trên Railway
> (`GCP_SERVICE_ACCOUNT_JSON_B64`) từ hồi làm receipt — app tự dùng lại.

Thông tin bạn đang dùng (xem `backend/.env` hoặc Railway → Variables):
- **Project ID:** `gen-lang-client-0159116947`
- **Service account:** `receipt-storage@gen-lang-client-0159116947.iam.gserviceaccount.com`
- **Bucket hóa đơn:** `storagereceipt_for_customer` — bucket riêng, khác với
  bucket receipt. Đây là giá trị của biến `GCS_INVOICE_BUCKET`.

> Giá trị là **tên bucket trần**, không phải URL của Console. Lấy phần cuối của
> `https://console.cloud.google.com/storage/browser/<TÊN BUCKET>`.

---

## Bước 0. Quyết định: bucket riêng hay dùng chung bucket receipt?

Nếu **không** làm gì cả, hóa đơn vẫn được lưu — vào bucket receipt sẵn có, dưới
prefix `invoices/`. Chạy được ngay.

Nhưng có **một** lý do nên tách bucket riêng: **lifecycle rule**. Nếu bucket
receipt có luật tự xóa file cũ (kiểu "xóa sau 365 ngày"), luật đó sẽ xóa luôn hóa
đơn — mà hóa đơn phải giữ 7 năm theo luật thuế Nhật.

**Cách kiểm tra:**
1. Mở https://console.cloud.google.com/storage/browser
2. Bấm vào bucket receipt → tab **LIFECYCLE**.
3. Nếu ghi **"No lifecycle rules"** → dùng chung được, bỏ qua luôn Bước 1–3,
   không cần làm gì cả.
4. Nếu **có rule nào đó** → làm tiếp Bước 1 để tách bucket riêng.

Kể cả bucket receipt đang sạch, tách riêng vẫn an toàn hơn: sau này ai đó thêm
rule dọn receipt sẽ không vô tình xóa mất chứng từ thuế.

---

# CÁCH 1 — Dùng giao diện web (Console) ⭐ Khuyến nghị

## Bước 1. Tạo bucket private

> Bucket `storagereceipt_for_customer` **đã tạo rồi** — bỏ qua bước này, sang
> thẳng Bước 2. Phần dưới giữ lại để sau này cần tạo thêm bucket khác.

1. Mở https://console.cloud.google.com/storage/browser
2. Kiểm tra góc trên đang chọn đúng project **gen-lang-client-0159116947**.
3. Bấm **CREATE**.
4. **Name**: gõ tên chưa ai dùng trên thế giới, ví dụ `storagereceipt_for_customer`
   (trùng thì thêm số: `storagereceipt_for_customer-2`).
5. **CONTINUE**.
6. **Location type**: chọn **Region** → `asia-northeast1 (Tokyo)`. **CONTINUE**.
7. **Storage class**: để mặc định **Standard**. **CONTINUE**.
8. **Access control**: chọn **Uniform**. **CONTINUE**.
9. **Protection**: phần **"Prevent public access"** → **GIỮ NGUYÊN / BẬT**.
   ⚠️ Ngược hẳn với bucket ảnh nhà. Hóa đơn có tên, địa chỉ khách và số tiền —
   không được để ai cũng xem. App tự cấp link ký hạn 10 phút khi cần đọc.
10. Bấm **CREATE**.

✅ **Ghi nhớ tên bucket vừa tạo** — đây là thứ duy nhất bạn cần ở Bước 3.

## Bước 2. Cho service account quyền ghi

1. Mở bucket vừa tạo → tab **PERMISSIONS**.
2. Bấm **GRANT ACCESS**.
3. Ô **New principals**, dán:
   `receipt-storage@gen-lang-client-0159116947.iam.gserviceaccount.com`
4. Ô **Role**: chọn **Cloud Storage → Storage Object Admin**.
5. **SAVE**.

✅ Xong phần quyền. **Không** thêm `allUsers` ở đây.

## Bước 3. Khai báo trên Railway

1. Mở https://railway.app → vào project → bấm **service backend**.
2. Tab **Variables** → **+ New Variable**.
3. Nhập:
   - **Name:** `GCS_INVOICE_BUCKET`
   - **Value:** tên bucket ở Bước 1, ví dụ `storagereceipt_for_customer`
4. **Add** → đợi Railway redeploy xong (trạng thái **Active**).

> Không cần thêm key gì khác. App tự dùng chung `GCP_SERVICE_ACCOUNT_JSON_B64`
> và `GCP_PROJECT_ID` đã có sẵn.

> (Tùy chọn) Test ở máy local: thêm `GCS_INVOICE_BUCKET=storagereceipt_for_customer`
> vào `backend/.env` rồi chạy lại backend.

## Bước 4. (Nên làm) Bật versioning và giữ 7 năm

Hóa đơn đã giao cho khách là chứng từ thuế. Hai thiết lập này chặn hai tai nạn
khác nhau:

**Object Versioning** — chặn việc ghi đè:
1. Vào bucket → tab **PROTECTION**.
2. Mục **Object versioning** → bấm **EDIT** → chọn **Enable** → **SAVE**.

**Retention policy 7 năm** — chặn việc xóa (kể cả xóa nhầm):
1. Vẫn ở tab **PROTECTION** → mục **Retention policy** → **EDIT**.
2. Nhập **7** và chọn đơn vị **Years** → **SAVE**.

⚠️ Retention policy **không gỡ được** cho đến khi hết hạn (trừ khi chưa lock).
Đặt 7 năm là con số đúng theo luật thuế Nhật (法人税法), nhưng hãy chắc chắn
trước khi bấm — sau đó bạn sẽ không xóa được file nào trong bucket này nữa.

Và **đừng** tạo lifecycle rule xóa file trên bucket này.

## Bước 5. Kiểm tra

1. Đợi Railway redeploy xong.
2. Vào web production, đăng nhập tài khoản **host level 4** (hoặc admin).
3. **Finance → Invoices** → nếu chưa có T number thì bấm **Settings** điền trước.
4. Ở dòng thông tin trên cùng, mục **控えの保存** phải hiện
   **"Archived to Cloud Storage"** (chứ không phải "Download only").
5. Bấm **請求書を発行** → chọn 1 booking → **Issue invoice**.
6. Thành công khi: PDF tự tải về máy, và dòng thông báo ghi
   *"…issued, downloaded and archived to Cloud Storage."*
7. Quay lại bảng danh sách, bấm icon 🔗 ở cuối dòng → PDF mở ra trong tab mới.
8. Mở Console → bucket → thấy file ở đường dẫn dạng
   `invoices/<user id>/2026/INV-2026-0001_....pdf`

🎉 Xong!

---

# CÁCH 2 — Dùng dòng lệnh (gcloud CLI)

```bash
# 1. Đăng nhập + chọn project
gcloud auth login
gcloud config set project gen-lang-client-0159116947

# 2. Tạo bucket private (đổi tên nếu trùng)
gcloud storage buckets create gs://storagereceipt_for_customer \
  --location=asia-northeast1 \
  --uniform-bucket-level-access \
  --public-access-prevention

# 3. Cho service account cũ quyền ghi
gcloud storage buckets add-iam-policy-binding gs://storagereceipt_for_customer \
  --member=serviceAccount:receipt-storage@gen-lang-client-0159116947.iam.gserviceaccount.com \
  --role=roles/storage.objectAdmin

# 4. Bật versioning
gcloud storage buckets update gs://storagereceipt_for_customer --versioning

# 5. Giữ 7 năm (KHÔNG gỡ được cho tới khi hết hạn — cân nhắc kỹ)
gcloud storage buckets update gs://storagereceipt_for_customer --retention-period=7y
```

Rồi thêm biến `GCS_INVOICE_BUCKET=storagereceipt_for_customer` trên Railway (Bước 3).

---

# Câu hỏi thường gặp

**Q: Chưa làm gì cả thì tính năng có chạy không?**
Có. Hóa đơn vẫn phát hành bình thường, PDF vẫn tải về máy host. Chỉ khác là
không có bản lưu trên cloud — trang Invoices sẽ ghi **"Download only"**, và
host phải tự giữ file. Không mất dữ liệu hóa đơn: số hóa đơn, số tiền, thuế,
tên khách đều nằm trong database, PDF luôn in lại được bằng nút **PDF**.

**Q: Có phải gửi JSON key cho ai không?**
Không. Không gửi cho ai, không dán vào chat, không commit vào git. Key đã có
sẵn trên Railway. Nếu lỡ dán ra ngoài, vào Console → IAM → Service Accounts →
Keys → xóa key cũ và tạo key mới.

**Q: Lỡ tạo bucket public (quên bật Prevent public access)?**
Vào bucket → tab **PROTECTION** → bật **Public access prevention**. Rồi qua tab
**PERMISSIONS** kiểm tra, nếu có dòng `allUsers` thì xóa đi.

**Q: Bucket nên đặt ở region nào?**
`asia-northeast1` (Tokyo) — cùng nơi với dữ liệu còn lại, độ trễ thấp nhất, và
chứng từ thuế Nhật thì nằm ở Nhật là hợp lý nhất.

**Q: Link PDF trong bảng danh sách hết hạn sau bao lâu?**
10 phút, giống hệt ảnh receipt. Hết hạn thì F5 lại trang là có link mới. App
lưu đường dẫn `gcs://…` chứ không lưu link — link ký thì hết hạn, còn bản lưu
phải mở được sau 7 năm.

**Q: Tốn bao nhiêu tiền?**
Không đáng kể. Mỗi hóa đơn PDF cỡ 100–300 KB. 1000 hóa đơn/năm ≈ 300 MB ≈
dưới 0.01 USD/tháng tiền lưu trữ.
