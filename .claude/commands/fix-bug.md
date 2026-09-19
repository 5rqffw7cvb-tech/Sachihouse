---
description: Sua bug - debug, code-test loop, review
argument-hint: [mo ta bug hoac dan log loi]
---

# Sửa bug: Debug - Code/Test - Review

Bug cần sửa: **$ARGUMENTS**

Nếu `$ARGUMENTS` rỗng, hỏi tôi mô tả bug hoặc log lỗi rồi dừng, không tự đoán.

## BƯỚC 1: CHẨN ĐOÁN

Gọi subagent `debugger` để truy nguyên nhân gốc.

**Hai điều kiện dừng ngay tại đây:**

- Nếu debugger trả **"chưa xác định được"**: **DỪNG TOÀN BỘ**, báo tôi còn thiếu thông tin gì. Không đoán, không sửa bừa.
- Nếu debugger thấy bug **đụng tới kiến trúc** hoặc **cần sửa hơn 3 file**: **DỪNG TOÀN BỘ**, khuyên tôi dùng `/dev-loop` thay thế. Không tự chuyển.

Nếu qua được cả hai, ghi nhớ **Nguyên nhân gốc** và **Hướng sửa** mà debugger đưa ra, dùng cho các bước sau.

## BƯỚC 2: VÒNG TRONG — coder và tester

Lặp **TỐI ĐA 3 lần**:

a. Gọi subagent `coder`
   - Lần đầu: sửa đúng nguyên nhân gốc debugger chỉ ra, phạm vi tối thiểu, không tiện tay refactor
   - Các lần sau: chỉ sửa đúng những gì tester báo fail
b. Gọi subagent `tester` chạy test
c. Nếu `TEST_PASS`: thoát vòng trong, sang **BƯỚC 3**
d. Nếu `TEST_FAIL`: quay lại **a**, truyền nguyên văn phần báo lỗi của tester cho coder

**TUYỆT ĐỐI KHÔNG gọi `debugger` hay `reviewer` trong vòng trong.**

Nếu hết 3 lần vẫn `TEST_FAIL`: gọi lại `debugger` **MỘT lần duy nhất**, kèm toàn bộ lịch sử các lần sửa và lỗi. Sau đó cho vòng trong chạy thêm **tối đa 3 lần nữa**. Nếu vẫn fail thì **DỪNG TOÀN BỘ**, báo tôi và hỏi ý kiến. **Không được gọi debugger lần thứ ba.**

## BƯỚC 3: REVIEW CÓ ĐIỀU KIỆN

Đếm số file mà coder đã sửa.

- Nếu **chỉ 1 file**: DỪNG, bỏ qua review, sang phần báo cáo
- Nếu **từ 2 file trở lên**: gọi subagent `reviewer`
  - `PASS`: dừng, sang phần báo cáo
  - `NEEDS_REWORK`: sang **BƯỚC 4**

## BƯỚC 4: VÒNG NGOÀI

Lặp **TỐI ĐA 1 lần** (sửa bug không đáng lặp nhiều hơn):

a. Quay về **BƯỚC 2** với feedback của reviewer làm input cho coder. **KHÔNG gọi lại debugger.**
b. Gọi lại `reviewer`
c. Dù `PASS` hay `NEEDS_REWORK` cũng dừng sau lần này

Nếu vẫn `NEEDS_REWORK`: báo tôi những điểm reviewer còn phàn nàn, để tôi tự quyết.

## BÁO CÁO

Sau mỗi lần chạy `tester` hoặc `reviewer`, báo **đúng 1 dòng ngắn**:

```
[Vòng trong 2/3] TEST_FAIL - 2 test lỗi ở hàm tinh_thue
[Vòng ngoài 1/1] NEEDS_REWORK - 1 Critical
```

Báo cáo cuối cùng **đúng 5 dòng**:

```
- Nguyên nhân gốc:
- File đã sửa:
- Số vòng đã chạy:
- Kết quả test:
- Rủi ro còn lại:
```
