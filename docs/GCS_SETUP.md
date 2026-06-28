# Cài đặt GCS cho phần Quản lý nhà (ảnh nhà)

> Phần check-in và hóa đơn (receipt) **đã kết nối GCS xong**. Tài liệu này chỉ hướng dẫn thêm **1 bucket công khai (public)** để lưu ảnh nhà (gallery, ảnh phòng, host, footer, manual).
>
> Bạn **không cần** tạo project hay service account mới — dùng lại cái đang chạy cho receipt.

## Vì sao cần bucket riêng?

- Ảnh check-in / hóa đơn là **riêng tư** → bucket private, link có hạn 10 phút.
- Ảnh nhà hiển thị cho **mọi khách** trên web → cần **bucket public**, link cố định không hết hạn, ảnh tự nén sang AVIF cho nhẹ.

Thông tin bạn đang dùng (xem `backend/.env`):
- **Project ID:** `gen-lang-client-0159116947`
- **Service account:** `receipt-storage@gen-lang-client-0159116947.iam.gserviceaccount.com`

---

# CÁCH 1 — Dùng giao diện web (Console) ⭐ Khuyến nghị

## Bước 1. Tạo bucket public mới

1. Mở https://console.cloud.google.com/storage/browser
2. Kiểm tra góc trên cùng đang chọn đúng project **gen-lang-client-0159116947**.
3. Bấm nút **CREATE** (Tạo).
4. **Name** (Tên bucket): gõ một tên **chưa ai dùng trên thế giới**, ví dụ:
   `sachihouse-public-images`
   (nếu báo trùng → thêm số phía sau, ví dụ `sachihouse-public-images-2026`).
5. Bấm **CONTINUE**.
6. **Location type**: chọn **Region** → chọn `asia-northeast1 (Tokyo)`. Bấm **CONTINUE**.
7. **Storage class**: để mặc định **Standard**. Bấm **CONTINUE**.
8. **Access control**: chọn **Uniform**. Bấm **CONTINUE**.
9. **Protection**: phần **"Prevent public access"** → **BỎ TICK / TẮT** (vì ta cần công khai).
   - Nếu hiện cảnh báo "This bucket may become public" → đúng ý, cứ tiếp tục.
10. Bấm **CREATE**.
11. Nếu hiện hộp thoại "Public access will be prevented" → chọn **Confirm / Allow public access** để tắt chặn.

✅ Đã có bucket. **Ghi nhớ tên bucket** vừa tạo.

## Bước 2. Cho phép mọi người xem ảnh (làm bucket public)

1. Mở bucket vừa tạo → vào tab **PERMISSIONS**.
2. Bấm **GRANT ACCESS**.
3. Ô **New principals**: gõ đúng chữ `allUsers`
4. Ô **Role**: tìm và chọn **Cloud Storage → Storage Object Viewer**.
5. Bấm **SAVE**.
6. Hiện cảnh báo công khai → bấm **ALLOW PUBLIC ACCESS**.

✅ Giờ ai có link ảnh đều xem được.

## Bước 3. Cho service account quyền ghi ảnh vào bucket

1. Vẫn ở tab **PERMISSIONS** của bucket → bấm **GRANT ACCESS** lần nữa.
2. Ô **New principals**: dán email service account:
   `receipt-storage@gen-lang-client-0159116947.iam.gserviceaccount.com`
3. Ô **Role**: chọn **Cloud Storage → Storage Object Admin**.
4. Bấm **SAVE**.

✅ Service account giờ ghi/xóa được ảnh trong bucket này.

## Bước 4. Khai báo bucket trên Railway

App chạy trên Railway nên biến môi trường phải đặt **trên Railway** (không phải file `.env` ở máy). Các biến receipt như `GCP_SERVICE_ACCOUNT_JSON_B64`, `GCS_BUCKET` đã có sẵn ở đây rồi — ta chỉ thêm 1 biến mới.

1. Mở https://railway.app → vào **project** của bạn.
2. Bấm vào **service backend** (service đang chạy API).
3. Mở tab **Variables**.
4. Bấm **+ New Variable**.
5. Nhập:
   - **Name:** `GCS_PUBLIC_BUCKET`
   - **Value:** tên bucket bạn tạo ở Bước 1, ví dụ `sachihouse-public-images`
6. Bấm **Add** → rồi bấm **Deploy** (hoặc Railway tự deploy lại).
7. Đợi service redeploy xong (trạng thái **Active**).

> Không cần thêm key gì khác — app tự dùng chung `GCP_SERVICE_ACCOUNT_JSON_B64` đã có sẵn trên Railway.

> (Tùy chọn) Nếu muốn **test ở máy local**, thêm dòng `GCS_PUBLIC_BUCKET=sachihouse-public-images` vào `backend/.env` rồi chạy lại backend.

## Bước 5. Kiểm tra

1. Đợi Railway redeploy xong (Bước 4).
2. Mở web production → đăng nhập **admin** → vào **Content Manager** một nhà → tab **Gallery** → bấm **Upload Image** → chọn ảnh.
3. Thành công khi: hiện ảnh preview và ô URL đổi thành đường dẫn dạng
   `https://storage.googleapis.com/sachihouse-public-images/properties/.../xxx.avif`
4. Mở link đó bằng tab ẩn danh → ảnh hiện ra là **đúng**.

🎉 Xong!

---

# CÁCH 2 — Dùng dòng lệnh (gcloud CLI)

Nếu bạn quen terminal, làm nhanh hơn. Cài [gcloud CLI](https://cloud.google.com/sdk/docs/install) trước.

```bash
# 1. Đăng nhập + chọn project
gcloud auth login
gcloud config set project gen-lang-client-0159116947

# 2. Tạo bucket public (đổi tên nếu trùng)
gcloud storage buckets create gs://sachihouse-public-images \
  --location=asia-northeast1 \
  --uniform-bucket-level-access

# 3. Cho mọi người xem (public)
gcloud storage buckets add-iam-policy-binding gs://sachihouse-public-images \
  --member=allUsers \
  --role=roles/storage.objectViewer

# 4. Cho service account cũ quyền ghi
gcloud storage buckets add-iam-policy-binding gs://sachihouse-public-images \
  --member=serviceAccount:receipt-storage@gen-lang-client-0159116947.iam.gserviceaccount.com \
  --role=roles/storage.objectAdmin
```

Sau đó thêm biến `GCS_PUBLIC_BUCKET=sachihouse-public-images` **trên Railway** (xem Bước 4 và 5 ở trên).

---

# Câu hỏi thường gặp

**Q: Chưa làm các bước này thì sao?**
Vẫn upload được, nhưng ảnh bị nhúng thẳng vào dữ liệu (dạng `data:`), làm chậm và nặng. Chỉ dùng tạm để test, **đừng** dùng production.

**Q: Tại sao ô "dán link URL" của host bị ẩn?**
Cố ý. Chỉ admin được dán link; host chỉ được Upload — để tránh host dán ảnh kém chất lượng/quá nặng làm web chậm.

**Q: Ảnh có bị nặng không?**
Không. Khi upload, ảnh tự được nén và chuyển sang **AVIF** dung lượng thấp (giống cách Airbnb làm), cache 1 năm.

**Q: Lỡ tạo nhầm bucket private (quên tắt Prevent public access)?**
Vào bucket → tab **PROTECTION** → tắt **Public access prevention**, rồi làm lại Bước 2.

**Q: Có nên đặt ảnh check-in/hóa đơn vào bucket public này không?**
**Không.** Bucket này ai cũng xem được. Dữ liệu nhạy cảm phải để ở bucket private (đã cấu hình sẵn).
