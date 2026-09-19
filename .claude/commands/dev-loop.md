---
description: Lam tinh nang moi - plan, code-test loop, review
argument-hint: [mo ta task]
---

# Vòng lặp Plan - Code/Test - Review

Task cần làm: **$ARGUMENTS**

Nếu `$ARGUMENTS` rỗng, hỏi tôi mô tả task rồi dừng, không tự đoán.

Quy trình gồm **hai vòng lồng nhau**: vòng trong `coder` ↔ `tester`, vòng ngoài sửa theo `reviewer`.

## BƯỚC 1: LẬP KẾ HOẠCH (chạy 1 lần)

Gọi subagent `planner` để lập plan.

Ghi nhớ **Acceptance criteria** mà planner đưa ra, dùng cho các bước sau.

## BƯỚC 2: VÒNG TRONG — coder và tester

Lặp **TỐI ĐA 3 lần**:

a. Gọi subagent `coder`
   - Lần đầu: hiện thực theo plan
   - Các lần sau: chỉ sửa đúng những gì tester báo fail, không làm thêm việc khác
b. Gọi subagent `tester` chạy test
c. Nếu `TEST_PASS`: thoát vòng trong, sang **BƯỚC 3**
d. Nếu `TEST_FAIL`: quay lại **a**, truyền nguyên văn phần báo lỗi của tester cho coder

**TUYỆT ĐỐI KHÔNG gọi `planner` hay `reviewer` trong vòng trong này.**

Nếu hết 3 lần vẫn `TEST_FAIL`: **DỪNG TOÀN BỘ**, báo cho tôi lỗi còn lại là gì và hỏi ý kiến. Không tự chạy tiếp.

## BƯỚC 3: REVIEW (chỉ chạy khi test đã PASS)

Gọi subagent `reviewer`.

- Nếu `PASS`: dừng, báo cáo kết quả cuối cùng cho tôi
- Nếu `NEEDS_REWORK`: sang **BƯỚC 4**

## BƯỚC 4: VÒNG NGOÀI — sửa theo review

Lặp **TỐI ĐA 2 lần**:

a. Nếu reviewer chỉ ra vấn đề **KIẾN TRÚC** hoặc nói plan ban đầu sai hướng: gọi lại `planner` với feedback đó, rồi quay về **BƯỚC 2**
b. Nếu chỉ là vấn đề code thông thường (đa số trường hợp): **KHÔNG gọi planner**. Quay thẳng về **BƯỚC 2** với nội dung feedback của reviewer làm input cho coder.
c. Sau khi **BƯỚC 2** xong, gọi lại `reviewer`
d. `PASS` thì dừng, `NEEDS_REWORK` thì lặp lại

Hết 2 lần vòng ngoài vẫn `NEEDS_REWORK`: **DỪNG**, báo tôi những điểm reviewer còn phàn nàn và hỏi ý kiến.

## BÁO CÁO

Sau mỗi lần chạy `tester` hoặc `reviewer`, báo cho tôi **đúng 1 dòng ngắn** theo mẫu:

```
[Vòng trong 2/3] TEST_FAIL - 3 test lỗi ở module thanh toán
[Vòng ngoài 1/2] NEEDS_REWORK - 1 Critical, 2 Warning
```

Báo cáo cuối cùng **đúng 4 dòng**:

```
- Đã làm:
- Số vòng đã chạy:
- Kết quả test:
- Kết quả review:
```
