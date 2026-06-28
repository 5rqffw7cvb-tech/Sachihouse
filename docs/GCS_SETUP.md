# Hướng dẫn cài đặt Google Cloud Storage (GCS)

Dự án dùng GCS cho **2 loại ảnh khác nhau**:

| Loại | Bucket (env) | Tính chất | Cách phục vụ | Dùng cho |
|------|--------------|-----------|--------------|----------|
| **Private** | `GCS_BUCKET`, `GCS_RECEIPT_BUCKET` | Riêng tư, không cho truy cập công khai | Signed URL hết hạn 10 phút, `Cache-Control: no-store` | Ảnh CCCD/hộ chiếu check-in, ảnh hóa đơn (receipt) |
| **Public** | `GCS_PUBLIC_BUCKET` | Công khai, ai cũng xem được | URL cố định `https://storage.googleapis.com/...`, cache 1 năm, ảnh AVIF | Ảnh nhà: gallery, phòng, host, footer, manual |

> Vì sao tách 2 bucket? Ảnh check-in/hóa đơn là dữ liệu nhạy cảm → phải private. Ảnh nhà hiển thị cho mọi khách trên web (endpoint công khai, cần cache) → phải có URL public ổn định, không hết hạn.

Code liên quan: [backend/src/services/objectStorage.ts](../backend/src/services/objectStorage.ts).

---

## 0. Chuẩn bị

- Tài khoản Google Cloud có bật **billing** (tạo bucket cần billing).
- Cài [gcloud CLI](https://cloud.google.com/sdk/docs/install) (khuyến nghị) **hoặc** dùng [Google Cloud Console](https://console.cloud.google.com) (giao diện web).
- Biết **Project ID** của bạn. Dự án hiện tại đang dùng: `gen-lang-client-0159116947`.

Đăng nhập và chọn project (nếu dùng CLI):

```bash
gcloud auth login
gcloud config set project gen-lang-client-0159116947
```

Bật API Cloud Storage:

```bash
gcloud services enable storage.googleapis.com
```

Các biến dùng lại trong hướng dẫn (đổi theo ý bạn):

```bash
export PROJECT_ID=gen-lang-client-0159116947
export REGION=asia-northeast1        # Tokyo. Đổi nếu muốn (vd asia-southeast1 = Singapore)
export PRIVATE_BUCKET=sachihouse-private
export PUBLIC_BUCKET=sachihouse-public
```

> Tên bucket phải **duy nhất toàn cầu** (không trùng với bất kỳ ai trên GCS). Nếu trùng sẽ báo lỗi → đổi tên khác.

---

## 1. Tạo bucket PRIVATE (ảnh check-in + hóa đơn)

### Cách A — gcloud CLI

```bash
# Tạo bucket, bật Uniform bucket-level access (khuyến nghị)
gcloud storage buckets create gs://$PRIVATE_BUCKET \
  --project=$PROJECT_ID \
  --location=$REGION \
  --uniform-bucket-level-access \
  --public-access-prevention
```

`--public-access-prevention` đảm bảo bucket này **không bao giờ** vô tình bị công khai → an toàn cho dữ liệu nhạy cảm.

### Cách B — Console

1. Vào **Cloud Storage → Buckets → Create**.
2. Name: `sachihouse-private`.
3. Location type: **Region** → chọn `asia-northeast1`.
4. **Access control**: chọn **Uniform**.
5. **Prevent public access**: để **bật (Enforced)**.
6. Create.

> Bạn có thể dùng **chung 1 bucket private** cho cả check-in và receipt (đặt `GCS_BUCKET` = `GCS_RECEIPT_BUCKET`), hoặc tách 2 bucket riêng nếu muốn phân quyền chặt hơn. Mặc định code sẽ fallback `GCS_RECEIPT_BUCKET` → `GCS_BUCKET` nếu không khai báo riêng.

---

## 2. Tạo bucket PUBLIC (ảnh nhà)

### Cách A — gcloud CLI

```bash
# Tạo bucket. KHÔNG bật public-access-prevention vì cần công khai.
gcloud storage buckets create gs://$PUBLIC_BUCKET \
  --project=$PROJECT_ID \
  --location=$REGION \
  --uniform-bucket-level-access

# Cho phép TẤT CẢ mọi người xem (read-only) các object trong bucket
gcloud storage buckets add-iam-policy-binding gs://$PUBLIC_BUCKET \
  --member=allUsers \
  --role=roles/storage.objectViewer
```

### Cách B — Console

1. **Create bucket** → Name: `sachihouse-public`, Region `asia-northeast1`, Access control **Uniform**.
2. **Prevent public access**: phải **TẮT** (chọn "không" khi được hỏi) — nếu không sẽ không công khai được.
3. Tạo xong → tab **Permissions → Grant access**:
   - New principals: `allUsers`
   - Role: **Storage Object Viewer**
   - Save → xác nhận "Allow public access".

> Sau bước này, bất kỳ ai có link `https://storage.googleapis.com/sachihouse-public/...` đều xem được ảnh. Đúng như mong muốn cho ảnh nhà. **Không** đặt dữ liệu nhạy cảm vào bucket này.

### (Tùy chọn) CORS cho bucket public

Nếu sau này dùng `<canvas>` hoặc fetch ảnh từ domain khác, thêm CORS:

```bash
echo '[{"origin":["*"],"method":["GET"],"responseHeader":["Content-Type"],"maxAgeSeconds":3600}]' > cors.json
gcloud storage buckets update gs://$PUBLIC_BUCKET --cors-file=cors.json
```

Hiển thị ảnh `<img src>` thông thường **không cần** CORS.

---

## 3. Tạo Service Account (SA) + cấp quyền

App dùng 1 service account để ghi/đọc/ký URL. Có thể dùng **1 SA chung** cho cả private và public (đơn giản nhất), hoặc tách riêng.

### 3.1. Tạo SA

```bash
gcloud iam service-accounts create sachihouse-storage \
  --project=$PROJECT_ID \
  --display-name="SachiHouse Storage"

export SA_EMAIL=sachihouse-storage@$PROJECT_ID.iam.gserviceaccount.com
```

> Dự án hiện đang dùng SA `receipt-storage@gen-lang-client-0159116947.iam.gserviceaccount.com`. Bạn có thể tái dùng SA này thay vì tạo mới — chỉ cần cấp thêm quyền trên bucket public (bước 3.2).

### 3.2. Cấp quyền cho SA trên từng bucket

`roles/storage.objectAdmin` = đọc + ghi + xóa object trong bucket đó (đủ cho app).

```bash
# Quyền trên bucket private
gcloud storage buckets add-iam-policy-binding gs://$PRIVATE_BUCKET \
  --member=serviceAccount:$SA_EMAIL \
  --role=roles/storage.objectAdmin

# Quyền trên bucket public
gcloud storage buckets add-iam-policy-binding gs://$PUBLIC_BUCKET \
  --member=serviceAccount:$SA_EMAIL \
  --role=roles/storage.objectAdmin
```

> **Về Signed URL (bucket private):** code ký URL bằng `getSignedUrl({ version: 'v4' })`. Khi cung cấp **key JSON** (bước 4), thư viện ký **cục bộ bằng private key trong key**, không cần thêm quyền IAM. Nếu sau này chạy không có key file (vd Cloud Run dùng SA gắn sẵn theo ADC), bạn cần cấp thêm `roles/iam.serviceAccountTokenCreator` cho SA để ký qua API.

### 3.3. Tạo key JSON cho SA

```bash
gcloud iam service-accounts keys create sachihouse-sa.json \
  --iam-account=$SA_EMAIL
```

File `sachihouse-sa.json` chứa private key. **Tuyệt đối không commit vào git.**

---

## 4. Cấu hình biến môi trường

App đọc credentials theo thứ tự: JSON thô (`*_JSON`) → base64 (`*_JSON_B64`). Khuyến nghị dùng **base64** để nhét gọn vào 1 dòng env (tránh xuống dòng phá vỡ private key).

Tạo chuỗi base64 từ key:

```bash
# Linux / macOS
base64 -w0 sachihouse-sa.json
# macOS không có -w0:  base64 sachihouse-sa.json | tr -d '\n'
```

```powershell
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("sachihouse-sa.json"))
```

### 4.1. Các biến môi trường

| Biến | Bắt buộc? | Ý nghĩa |
|------|-----------|---------|
| `GCP_PROJECT_ID` | Có | Project ID |
| `GCS_BUCKET` | Có (cho check-in) | Bucket private ảnh check-in |
| `GCS_PREFIX` | Không (mặc định `checkins`) | Thư mục con cho ảnh check-in |
| `GCS_RECEIPT_BUCKET` | Không | Bucket private hóa đơn. Bỏ trống → dùng `GCS_BUCKET` |
| `GCS_PUBLIC_BUCKET` | Có (cho ảnh nhà) | **Bucket public ảnh nhà** |
| `GCP_SERVICE_ACCOUNT_JSON_B64` | Có | Key SA (base64) dùng chung |
| `GCP_RECEIPT_SERVICE_ACCOUNT_JSON_B64` | Không | Key SA riêng cho receipt (fallback về key chung) |
| `GCP_PUBLIC_SERVICE_ACCOUNT_JSON_B64` | Không | Key SA riêng cho public (fallback về key chung) |
| `GCP_RECEIPT_PROJECT_ID` / `GCP_PUBLIC_PROJECT_ID` | Không | Project riêng nếu bucket nằm project khác (fallback `GCP_PROJECT_ID`) |

> Bản đầy đủ `*_JSON` (không base64) cũng được hỗ trợ: `GCP_SERVICE_ACCOUNT_JSON`, `GCP_RECEIPT_SERVICE_ACCOUNT_JSON`, `GCP_PUBLIC_SERVICE_ACCOUNT_JSON`.

### 4.2. Ví dụ `backend/.env` (local) — cấu hình tối giản, 1 SA chung

```env
GCP_PROJECT_ID=gen-lang-client-0159116947

# Private (check-in + receipt dùng chung 1 bucket)
GCS_BUCKET=sachihouse-private

# Public (ảnh nhà)
GCS_PUBLIC_BUCKET=sachihouse-public

# 1 service account cho tất cả
GCP_SERVICE_ACCOUNT_JSON_B64=<chuỗi base64 dán vào đây>
```

### 4.3. Production

Đặt các biến trên trong nơi quản lý env của hạ tầng deploy (Cloud Run / Render / Railway / Docker secrets...). **Không** đưa key vào image hay git. Với Cloud Run, ưu tiên dùng **Secret Manager** cho `GCP_SERVICE_ACCOUNT_JSON_B64`.

---

## 5. Kiểm tra (Verification)

### 5.1. Test nhanh quyền bằng CLI

```bash
# Upload thử object public
echo "hello" > test.txt
gcloud storage cp test.txt gs://$PUBLIC_BUCKET/test.txt
# Mở link công khai trong trình duyệt ẩn danh → phải thấy "hello"
echo "https://storage.googleapis.com/$PUBLIC_BUCKET/test.txt"
gcloud storage rm gs://$PUBLIC_BUCKET/test.txt
```

### 5.2. Test qua app

1. Chạy `backend` (`npm run dev`) và `frontend` (`npm run dev`).
2. Đăng nhập **admin** → mở **Content Manager** một nhà → tab **Gallery** → bấm **Upload Image** → chọn ảnh.
   - Đang load: thấy spinner "Uploading...".
   - Xong: preview hiện ảnh, field URL thành `https://storage.googleapis.com/sachihouse-public/properties/.../*.avif`.
3. Mở URL đó ở tab ẩn danh → ảnh load được. Kiểm tra header: `Content-Type: image/avif`, `Cache-Control: public, max-age=31536000, immutable`. Dung lượng nhỏ hơn ảnh gốc đáng kể.
4. **Lưu** property → reload → ảnh vẫn còn.
5. Đăng nhập **host** (có quyền nhà đó) → mở Content Manager → ô **dán URL bị ẩn**, chỉ còn nút Upload.
6. Test check-in / upload hóa đơn → ảnh vào bucket private, xem qua app được (signed URL), nhưng mở thẳng `storage.googleapis.com/.../checkins/...` mà không có chữ ký → **403** (đúng, vì private).

> Nếu **chưa cấu hình** `GCS_PUBLIC_BUCKET`, app vẫn upload được nhưng trả ảnh dạng `data:image/avif;base64,...` nhúng thẳng vào dữ liệu — chỉ dùng để test local, **không** dùng cho production.

---

## 6. Bảo mật & lưu ý

- **Không commit** file key `*.json` hay chuỗi base64 lên git. (`.env` và `.env.*` đã có trong `.gitignore`, `backend/.env` hiện **không** bị git track — đã an toàn.)
- File `backend/.env` ở máy bạn đang chứa key thật (chỉ là dùng để test local). Nếu key này từng bị lộ/đẩy đi nơi khác, hãy **xoay (rotate) key** và chuyển sang quản lý secret an toàn cho production.
- Bucket **private** luôn bật **Public access prevention = Enforced**.
- Bucket **public** chỉ chứa ảnh nhà; **không** đặt dữ liệu nhạy cảm vào đây.
- Áp dụng **nguyên tắc quyền tối thiểu**: SA chỉ cần `objectAdmin` trên đúng các bucket dùng, không cấp quyền cấp project.
- Xoay key định kỳ; xóa key cũ bằng `gcloud iam service-accounts keys list/delete`.

---

## 7. Phụ lục — Toàn bộ lệnh gộp (copy-paste nhanh)

```bash
# Biến
export PROJECT_ID=gen-lang-client-0159116947
export REGION=asia-northeast1
export PRIVATE_BUCKET=sachihouse-private
export PUBLIC_BUCKET=sachihouse-public
export SA_EMAIL=sachihouse-storage@$PROJECT_ID.iam.gserviceaccount.com

gcloud config set project $PROJECT_ID
gcloud services enable storage.googleapis.com

# Bucket private
gcloud storage buckets create gs://$PRIVATE_BUCKET --location=$REGION \
  --uniform-bucket-level-access --public-access-prevention

# Bucket public + công khai
gcloud storage buckets create gs://$PUBLIC_BUCKET --location=$REGION \
  --uniform-bucket-level-access
gcloud storage buckets add-iam-policy-binding gs://$PUBLIC_BUCKET \
  --member=allUsers --role=roles/storage.objectViewer

# Service account + quyền + key
gcloud iam service-accounts create sachihouse-storage --display-name="SachiHouse Storage"
gcloud storage buckets add-iam-policy-binding gs://$PRIVATE_BUCKET \
  --member=serviceAccount:$SA_EMAIL --role=roles/storage.objectAdmin
gcloud storage buckets add-iam-policy-binding gs://$PUBLIC_BUCKET \
  --member=serviceAccount:$SA_EMAIL --role=roles/storage.objectAdmin
gcloud iam service-accounts keys create sachihouse-sa.json --iam-account=$SA_EMAIL

# Lấy base64 để dán vào GCP_SERVICE_ACCOUNT_JSON_B64
base64 -w0 sachihouse-sa.json
```
