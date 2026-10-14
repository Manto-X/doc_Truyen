# Đọc truyện TTS

Ứng dụng PHP đọc chương truyện qua Web Speech trên trình duyệt. URL cũ `tf` vẫn tương đương `truyenfull`.

## Chạy cục bộ

```powershell
php -S localhost:8080
```

Mở `http://localhost:8080/?s=tf&p=<duong-dan-chuong>`. API chương dùng `api/chapter.php?s=truyenfull&p=<duong-dan-chuong>`.

Thiết lập `READER_BRIDGE_URL`, `READER_BRIDGE_TOKEN` và `READER_BRIDGE_ALLOWED_HOSTS` trên môi trường PHP trước khi tải nguồn. Sao chép tên biến từ `.env.example`, nhưng không đặt token thật vào Git hoặc query string.

Admin cần `READER_ADMIN_PASSWORD_HASH`; tạo giá trị bằng `php -r "echo password_hash('mat-khau-moi', PASSWORD_DEFAULT), PHP_EOL;"` rồi đặt hash đó ở môi trường production.
Nếu PHP hosting không có session directory ghi được, đặt `READER_SESSION_SAVE_PATH` tới thư mục ngoài webroot có quyền ghi cho web server.

## Kiểm tra trước deploy

```powershell
php tests/parser_test.php
php -l index.php
php -l includes/parser.php
php -l api/chapter.php
node --check templates/js/tts-player.js
```

Không deploy token, password hoặc bản sao cấu hình vào webroot. Xem `docs/admin-runbook.md` để cập nhật nguồn và `docs/iphone-test-results.md` để nghiệm thu iPhone.
