# Bộ agent dùng chung cho team SachiHouse

## Bộ này là gì

4 subagent + 1 slash command, dùng chung cho cả team qua Git.

| Agent | Model | Vai trò |
|---|---|---|
| `planner` | opus | Kỹ sư trưởng — đọc code, lập plan. Chỉ đọc, không sửa file. |
| `coder` | opus | Lập trình viên — làm đúng theo plan. Không sửa file test. |
| `tester` | opus | QA — viết và chạy test. Không sửa code nghiệp vụ để test pass. |
| `reviewer` | opus | Senior reviewer — `git diff` rồi review. Chỉ đọc, không sửa file. |
| `debugger` | opus | Chuyên gia debug — truy nguyên nhân gốc của lỗi. Chỉ đọc, không sửa file. |

Có 2 slash command nối các agent trên thành vòng lặp tự động:

- `/dev-loop` — Plan → (Code ↔ Test) → Review
- `/fix-bug` — Debug → (Code ↔ Test) → Review

## Dùng command nào?

| Tình huống | Command |
|---|---|
| Có lỗi, có gì đó chạy sai | `/fix-bug` |
| Làm tính năng mới hoặc sửa đổi theo yêu cầu | `/dev-loop` |

> **Lưu ý:** `/fix-bug` sẽ tự dừng và khuyên chuyển sang `/dev-loop` nếu bug hóa ra quá lớn (đụng kiến trúc hoặc phải sửa hơn 3 file). Nên cứ bắt đầu bằng `/fix-bug` khi gặp lỗi.

## Cách dùng

**Gọi lẻ từng agent** — nhắc tên trong câu lệnh:

```
@planner lập plan cho việc thêm bộ lọc ngày vào trang Calendar
@coder làm theo plan ở trên
@tester viết test cho thay đổi vừa rồi
@reviewer review phần vừa sửa
@debugger tìm nguyên nhân lỗi TypeError ở CalendarPage
```

**Chạy cả vòng lặp** — một lệnh duy nhất:

```
/dev-loop thêm bộ lọc ngày vào trang Calendar
/fix-bug trang Calendar crash khi đổi tháng, log: TypeError undefined
```

Vòng lặp tự dừng khi tester trả `TEST_PASS` và reviewer trả `PASS`. Nếu hết 3 vòng vẫn chưa xong, nó dừng lại và hỏi bạn — không tự lặp thêm.

## Lưu ý quan trọng

> **Sau khi pull code lần đầu, phải Reload Window thì Claude Code mới nhận agent.**
> Nhấn `Ctrl+Shift+P` → gõ `Reload Window` → Enter.

Chưa reload thì gõ `@planner` hay `/dev-loop` sẽ không ra gì cả.

## Muốn sửa prompt của agent

1. Sửa file tương ứng trong [`.claude/agents/`](agents/) (hoặc [`.claude/commands/`](commands/) với slash command).
2. Reload Window để kiểm tra tại máy mình.
3. Commit và push lại để cả team cùng dùng bản mới.

Lưu ý khi sửa: phần YAML frontmatter (`name`, `description`) viết bằng tiếng Anh hoặc tiếng Việt **không dấu** để tránh lỗi parse YAML. Phần thân prompt viết tiếng Việt có dấu bình thường.

## Cấu trúc thư mục

```
.claude/
├── README.md
├── agents/
│   ├── planner.md
│   ├── coder.md
│   ├── tester.md
│   ├── reviewer.md
│   └── debugger.md
└── commands/
    ├── dev-loop.md
    └── fix-bug.md
```
