# Che link ảnh GCS bằng custom domain (Cloudflare)

Mục tiêu: ảnh nhà hiển thị qua domain riêng (vd `https://cdn.sachihouse.com/...`) thay vì lộ link gốc `https://storage.googleapis.com/sachihouse-public/...`.

> ⚠️ Lưu ý: cách này **che nguồn GCS**, không phải cấm tải ảnh. Người dùng vẫn mở/tải được ảnh, nhưng link hiển thị là domain của bạn (kèm CDN cache nhanh hơn). Không có cách nào cấm tải ảnh hoàn toàn trên web.

Yêu cầu: bạn có 1 domain đang quản lý DNS trên **Cloudflare** (vd `sachihouse.com`). Ta sẽ tạo subdomain `cdn.sachihouse.com`.

Bucket public hiện tại: `sachihouse-public` (giữ nguyên).

---

## Phần 1 — Tạo Cloudflare Worker proxy tới bucket

Worker nhận request `cdn.sachihouse.com/<path>` và lấy nội dung từ `storage.googleapis.com/sachihouse-public/<path>`, có cache CDN. Cách này **không cần đổi tên bucket**.

### Bước 1. Tạo Worker
1. Vào https://dash.cloudflare.com → chọn account → **Workers & Pages** → **Create application** → **Create Worker**.
2. Đặt tên, ví dụ `sachihouse-cdn` → **Deploy** (tạm thời dùng code mẫu).
3. Bấm **Edit code**, dán đoạn sau (đổi `BUCKET` nếu tên bucket khác):

```js
const BUCKET = 'sachihouse-public';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Chỉ cho phép GET/HEAD (chặn ghi)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const objectPath = url.pathname.replace(/^\/+/, ''); // bỏ dấu / đầu
    if (!objectPath) return new Response('Not found', { status: 404 });

    const originUrl = `https://storage.googleapis.com/${BUCKET}/${objectPath}`;

    // Dùng cache của Cloudflare
    const cache = caches.default;
    let response = await cache.match(request);
    if (response) return response;

    response = await fetch(originUrl, { cf: { cacheEverything: true, cacheTtl: 31536000 } });
    if (!response.ok) {
      return new Response('Not found', { status: response.status });
    }

    // Sao chép response + thêm cache header dài hạn
    response = new Response(response.body, response);
    response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    response.headers.delete('x-goog-hash');
    response.headers.delete('x-goog-generation');
    response.headers.delete('x-goog-metageneration');
    response.headers.delete('x-goog-stored-content-encoding');
    response.headers.delete('x-goog-stored-content-length');
    response.headers.delete('x-guploader-uploadid');

    ctx.waitUntil(cache.put(request, response.clone()));
    return response;
  },
};
```

4. **Deploy**.

### Bước 2. Gắn domain cho Worker
1. Trong Worker vừa tạo → tab **Settings** → **Domains & Routes** (hoặc **Triggers → Custom Domains**).
2. **Add Custom Domain** → nhập `cdn.sachihouse.com` → **Add**.
   - Cloudflare tự tạo DNS record + cấp chứng chỉ HTTPS cho subdomain này.
3. Đợi vài phút tới khi domain **Active**.

### Bước 3. Kiểm tra
Mở thử: `https://cdn.sachihouse.com/properties/<một-path-ảnh-có-thật>.avif`
→ phải thấy ảnh. (Lấy `<path>` từ một URL ảnh hiện tại: phần sau `sachihouse-public/`.)

---

## Phần 2 — Cho app dùng domain mới

Thêm biến môi trường trên **Railway** (service backend):

| Name | Value |
|------|-------|
| `GCS_PUBLIC_BASE_URL` | `https://cdn.sachihouse.com` |

Rồi **redeploy backend**.

Từ giờ, **ảnh upload mới** sẽ được lưu link dạng `https://cdn.sachihouse.com/properties/...` thay vì storage.googleapis.com.

> Code: backend đọc `GCS_PUBLIC_BASE_URL` trong [objectStorage.ts](../backend/src/services/objectStorage.ts) (`uploadPropertyImage`). Nếu không set → vẫn dùng link storage.googleapis.com như cũ.

---

## Lưu ý về ảnh cũ

- Ảnh **đã upload trước đây** đang lưu link `storage.googleapis.com/...` trong dữ liệu — sẽ **không tự đổi**. Chúng vẫn hiển thị bình thường (bucket vẫn public), chỉ là link cũ.
- Nếu muốn ảnh cũ cũng dùng domain mới: upload lại ảnh đó trong Content Manager (ảnh mới sẽ ra link cdn). Hoặc báo mình để viết script đổi hàng loạt link trong dữ liệu property.

---

## (Tùy chọn) Khoá truy cập trực tiếp tới bucket gốc

Muốn người dùng **chỉ** truy cập được qua `cdn.sachihouse.com` (không qua storage.googleapis.com trực tiếp) thì phức tạp hơn: phải bỏ public của bucket và cho Worker dùng signed URL / service account để đọc. Thường **không cần thiết** — che link qua CDN là đủ cho mục đích thẩm mỹ/branding. Nếu cần mức này, báo mình.
