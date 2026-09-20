---
description: Thay doi hoac them tinh nang vao he thong dang chay
argument-hint: [mo ta thay doi can lam]
---

# Thay đổi hệ thống: Impact → Plan → (Code ↔ Test) → Đối chiếu → Review

Yêu cầu thay đổi: **$ARGUMENTS**

Nếu `$ARGUMENTS` rỗng, hỏi tôi cần thay đổi gì rồi dừng, không tự đoán.

## BƯỚC 1: PHÂN TÍCH ẢNH HƯỞNG

Gọi subagent `impact-analyst`.

**DỪNG LẠI.** Cho tôi xem **toàn bộ 5 phần** kết quả, kèm một dòng tổng kết theo mẫu:

```
Ảnh hưởng: [Nhỏ / Vừa / Lớn] - N nơi phụ thuộc, M chức năng cần test lại
```

Hỏi tôi xác nhận có làm tiếp không. **KHÔNG tự chuyển bước.**

Nếu `impact-analyst` báo **hơn 10 nơi phụ thuộc**: khuyên tôi tách nhỏ yêu cầu và **dừng lại**, đừng chạy tiếp.

## BƯỚC 2: LẬP KẾ HOẠCH

Gọi subagent `planner`, truyền kèm **TOÀN BỘ** kết quả của `impact-analyst`.

Yêu cầu `planner` đưa thêm vào phần Acceptance criteria:

- Các chức năng ở phần **"PHẢI TEST LẠI"** vẫn phải chạy đúng
- Hành vi cũ ở phần **"HÀNH VI HIỆN TẠI"** không được đổi, trừ những chỗ tôi yêu cầu đổi

## BƯỚC 3: VÒNG TRONG — coder và tester

Lặp **TỐI ĐA 3 lần**:

a. Gọi subagent `coder`
   - Lần đầu: làm theo plan
   - Các lần sau: **chỉ sửa đúng những gì tester báo fail**
b. Gọi subagent `tester`, yêu cầu chạy **CẢ HAI**:
   - Test cho phần mới sửa
   - Test hồi quy các chức năng trong danh sách **"PHẢI TEST LẠI"** của `impact-analyst`

   **Báo riêng kết quả hai loại, đừng gộp chung.**
c. `TEST_PASS` **cả hai**: thoát vòng trong, sang **BƯỚC 4**
d. `TEST_FAIL`: quay lại **a**, truyền **nguyên văn** báo lỗi của tester cho coder

**TUYỆT ĐỐI KHÔNG gọi `impact-analyst`, `planner` hay `reviewer` trong vòng này.**

Hết 3 lần vẫn fail: **DỪNG TOÀN BỘ**, báo tôi và hỏi ý kiến.

## BƯỚC 4: ĐỐI CHIẾU HÀNH VI

So sánh hành vi sau khi sửa với phần **"HÀNH VI HIỆN TẠI"** mà `impact-analyst` đã ghi.

Báo cho tôi **đúng 2 danh sách**:

- **Đã đổi theo yêu cầu:** ...
- **Đã đổi NGOÀI yêu cầu:** ...

Nếu danh sách thứ hai **không rỗng**: **DỪNG LẠI**, hỏi tôi **từng cái một** có chấp nhận không.

> Đây là bước quan trọng nhất, **không được bỏ qua**.

## BƯỚC 5: REVIEW

Gọi subagent `reviewer`.

Yêu cầu nó chú ý riêng: thay đổi có làm hỏng **tính tương thích ngược** không, **dữ liệu cũ** có còn đọc được không.

- `PASS`: dừng, sang phần báo cáo
- `NEEDS_REWORK`: quay về **BƯỚC 3** với feedback làm input cho `coder` (**KHÔNG gọi lại `impact-analyst` hay `planner`**). Tối đa **2 lần**, sau đó dừng dù kết quả thế nào.

## BÁO CÁO CUỐI

Đúng 6 dòng:

```
- Thay đổi đã làm:
- File đã sửa:
- Nơi phụ thuộc đã kiểm tra:
- Kết quả test mới:
- Kết quả test hồi quy:
- Rủi ro còn lại:
```
