# Runbook cập nhật nguồn truyện

## Trước khi sửa

1. Mở trang lỗi và ghi URL, thời điểm, thông báo.
2. Xác nhận lỗi là nguồn thay layout, không phải 403/429/captcha hoặc lỗi mạng.
3. Sao lưu config hiện có; bản ghi tự động nằm trong `backup/config-revisions/` sau khi lưu.

## Sửa cấu hình

1. Vào `admin/update/`, xác thực rồi chọn nguồn.
2. Sửa đúng domain, XPath hoặc regex bị thay đổi; không đổi nhiều trường nếu chưa cần.
3. Kiểm tra tối thiểu chương đầu, giữa, cuối và một truyện khác của cùng nguồn.
4. Lưu bản nháp; cấu hình live không thay đổi ở bước này. Regex/domain không hợp lệ sẽ bị chặn.
5. Kiểm tra lại bản nháp, rồi bấm **Xuất bản bản nháp**.
6. Sau khi xuất bản, mở lại chương qua giao diện và `api/chapter.php?s=<source>&p=<path>`.

## Hoàn tác

1. Chọn file revision gần nhất trong `backup/config-revisions/` đã biết hoạt động.
2. Thay config bằng bản đó qua thao tác có kiểm soát trên host.
3. Kiểm tra lại một chương đã lỗi và một chương không liên quan.

Không lưu token bridge, mật khẩu admin hoặc HTML thô chứa dữ liệu nhạy cảm vào ticket/log.
