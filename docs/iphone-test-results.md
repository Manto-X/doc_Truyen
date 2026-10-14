# Kiểm thử iPhone — kết quả thiết bị thật

Trạng thái: chưa chạy trên iPhone. Không xem tài liệu này là bằng chứng Web Speech phát được khi khóa màn hình.

## Thông tin phiên test

| Trường | Giá trị |
| --- | --- |
| Ngày/giờ | |
| iPhone / iOS | |
| Safari hay Home Screen | |
| Giọng (tên / URI / ngôn ngữ) | |
| Low Power Mode | |
| Wi-Fi / 4G | |
| URL chương bắt đầu | |

## Ma trận nghiệm thu

| Tình huống | Kết quả cần ghi | Pass/Fail |
| --- | --- | --- |
| Mở trang, chờ 5 phút, bấm Đọc | Một chạm bắt đầu | |
| Khóa giữa chương | Có/không còn tiếng | |
| Khóa qua cuối chương với `/auto` | Có/không sang chương kế | |
| Nghe 60 phút, qua ba ranh giới chương | Thời điểm dừng/lặp/bỏ đoạn | |
| Pause rồi khóa/mở máy | Không tự đọc lại | |
| Đổi tốc độ/giọng giữa chương | Cursor có được giữ không | |
| Mất mạng sau khi đã chuẩn bị | Nội dung sẵn có còn đọc được không | |
| Cuộc gọi/Siri/Bluetooth | Hành vi pause/resume | |

Kết luận gate: chỉ đánh dấu đạt khi một đường nghe thực tế tiếp tục được trong lúc màn hình khóa, qua nhiều ranh giới chương. Nếu Safari không đạt, chuyển sang thử Speak Screen của iOS hoặc PoC app native; không dùng keepalive JavaScript làm phương án thay thế.
