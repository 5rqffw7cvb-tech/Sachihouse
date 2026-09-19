---
description: Chay vong lap Plan - Code - Test - Review
argument-hint: [mo ta task]
---

# Vòng lặp Plan - Code - Test - Review

Task cần làm: **$ARGUMENTS**

Nếu `$ARGUMENTS` rỗng, hỏi tôi mô tả task rồi dừng, không tự đoán.

## Cách chạy

Chạy **TỐI ĐA 3 vòng lặp**. Mỗi vòng gồm 4 bước, gọi lần lượt từng subagent:

1. **planner** — nhận task (hoặc feedback của vòng trước), xuất plan 4 phần.
2. **coder** — thực thi đúng theo plan của planner.
3. **tester** — viết và chạy test cho thay đổi vừa rồi. Kết thúc bằng `TEST_PASS` hoặc `TEST_FAIL`.
4. **reviewer** — chạy `git diff` và review. Kết thúc bằng `PASS` hoặc `NEEDS_REWORK`.

Chạy tuần tự, không chạy song song: mỗi bước cần kết quả của bước trước làm đầu vào.

## Điều kiện lặp lại

- Nếu tester trả `TEST_FAIL` **hoặc** reviewer trả `NEEDS_REWORK` → quay lại **planner** cho vòng tiếp theo, **truyền nguyên feedback đó làm input**. Nhắc planner chỉ lập plan cho phần cần sửa, không lập lại từ đầu.
- Nếu tester trả `TEST_PASS` **và** reviewer trả `PASS` → **dừng ngay**, báo hoàn thành.

## Báo cáo sau mỗi vòng

Sau mỗi vòng, in ra **đúng 3 dòng**, không thêm gì khác:

```
Vòng N/3
Trạng thái: <TEST_PASS|TEST_FAIL> + <PASS|NEEDS_REWORK>
Việc còn lại: <tóm tắt 1 dòng, hoặc "không còn">
```

## Khi hết 3 vòng vẫn chưa PASS

**DỪNG LẠI và hỏi ý kiến tôi. Tuyệt đối không tự lặp thêm vòng thứ 4.**

Khi dừng, trình bày ngắn gọn:
- Những lỗi còn tồn đọng.
- Nhận định vì sao 3 vòng chưa xử lý được.
- 2-3 hướng đi đề xuất để tôi chọn.
