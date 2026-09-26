<?php
// Khởi động session (vẫn cần để lưu trạng thái xác thực sau bước 1)
session_start();

// Đường dẫn tới tệp cấu hình
define('CONFIG_FILE', '../../config/config.json');

// Khởi tạo các biến
$message = '';
// Xác định xem có đang ở chế độ sửa một site cụ thể không (ví dụ: ?edit=tf)
$site_to_edit = $_GET['edit'] ?? null;
// Đọc toàn bộ file config
$config = json_decode(file_get_contents(CONFIG_FILE), true);
// Lấy danh sách các site hiện có
$sites = $config['sites'] ?? [];

// Mã bảo mật CHÍNH XÁC cố định
$correct_security_code = 'them_so_cua_ban_vao_day';

// Tạo mã ngẫu nhiên để làm "mồi nhử" hiển thị sẵn trong ó input
// Chuỗi này chỉ được tạo khi chưa xác thực hoặc khi quay về trang chọn site
if (!isset($_SESSION['authenticated']) || $_SESSION['authenticated'] !== true || !isset($_GET['edit'])) {
    $decoy_code_value = bin2hex(random_bytes(8)); // Tạo chuỗi ngẫu nhiên 16 ký tự hex
} else {
    // Nếu đã xác thực và đang ở trang edit, không cần decoy code
    $decoy_code_value = '';
}


// === XỬ LÝ KHI GỬI FORM (METHOD POST) ===
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // A. HÀNH ĐỘNG: CHỌN SITE ĐỂ SỬA
    if (isset($_POST['action_select_site'])) {
        $submitted_code = $_POST['security_code'] ?? '';

        // Bước 1: Kiểm tra mã bảo mật. Nếu sai, dừng mọi xử lý.
        if ($submitted_code !== $correct_security_code) { // So sánh với chuỗi cứng
            $message = '<p class="msg-error">Lỗi: Sai mã bảo mật!</p>';
            // Không làm gì với decoy_code_value, nó sẽ được tạo lại khi trang tải lại
            unset($_SESSION['authenticated']); // Đảm bảo cờ xác thực bị xóa nếu sai
        } else {
            // Mã bảo mật ĐÚNG, tiến hành chọn site và đặt cờ xác thực
            $_SESSION['authenticated'] = true; // Đánh dấu đã xác thực
            $selected_site = $_POST['site_key'] ?? null;
            if ($selected_site && isset($sites[$selected_site])) {
                // Chuyển hướng đến chính trang này với tham số ?edit=...
                header('Location: index.php?edit=' . $selected_site);
                exit();
            } else {
                $message = '<p class="msg-error">Lỗi: Site không hợp lệ!</p>';
            }
        }
    }

    // B. HÀNH ĐỘNG: LƯU CẤU HÌNH CỦA SITE ĐANG SỬA
    if (isset($_POST['action_save_config'])) {
        if (!isset($_SESSION['authenticated']) || $_SESSION['authenticated'] !== true) {
            $message = '<p class="msg-error">Lỗi: Bạn chưa được xác thực để thực hiện hành động này.</p>';
        } else {
            // Đã xác thực, tiến hành lưu
            $site_key_to_save = $_POST['site_key_to_save'] ?? null;
            if ($site_key_to_save && isset($sites[$site_key_to_save])) {
                // Cập nhật domain
                $config['sites'][$site_key_to_save]['domain'] = $_POST['domain'] ?? '';
                // Cập nhật phương thức parse
                $config['sites'][$site_key_to_save]['parse_method'] = $_POST['parse_method'] ?? 'dom';
                
                // Cập nhật regex patterns
                if (isset($_POST['regex_patterns']) && is_array($_POST['regex_patterns'])) {
                    foreach ($_POST['regex_patterns'] as $key => $value) {
                        $config['sites'][$site_key_to_save]['regex_patterns'][$key] = $value;
                    }
                }
                
                // Cập nhật selectors
                if (isset($_POST['selectors']) && is_array($_POST['selectors'])) {
                    foreach ($_POST['selectors'] as $key => $value) {
                        $config['sites'][$site_key_to_save]['selectors'][$key] = $value;
                    }
                }
                
                // Ghi lại vào file
                if (file_put_contents(CONFIG_FILE, json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE))) {
                    $message = '<p class="msg-success">Cập nhật thành công cho site: ' . strtoupper($site_key_to_save) . '</p>';
                    // Tải lại dữ liệu mới sau khi lưu
                    $sites = $config['sites'];
                } else {
                    $message = '<p class="msg-error">Lỗi: Không thể ghi vào tệp cấu hình.</p>';
                }
            }
        }
    }
}

// Lấy thông tin của site đang được sửa (nếu có)
$edit_data = ($site_to_edit && isset($sites[$site_to_edit])) ? $sites[$site_to_edit] : null;

?>
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bảng điều khiển Cấu hình</title>
    <link rel="stylesheet" href="../templates/css/update.css">
</head>
<body>
    <h1>Bảng điều khiển Cấu hình</h1>
    <?php echo $message; ?>

    <?php // === GIAO DIỆN SỬA CHI TIẾT (BƯỚC 2) === ?>
    <?php if ($edit_data && isset($_SESSION['authenticated']) && $_SESSION['authenticated'] === true): ?>
        <form method="POST" action="index.php?edit=<?php echo htmlspecialchars($site_to_edit); ?>">
            <input type="hidden" name="site_key_to_save" value="<?php echo htmlspecialchars($site_to_edit); ?>">
            
            <fieldset>
                <legend>Cấu hình cho site: <?php echo strtoupper(htmlspecialchars($site_to_edit)); ?></legend>
                <label for="domain">Tên miền:</label>
                <input type="text" id="domain" name="domain" value="<?php echo htmlspecialchars($edit_data['domain']); ?>">
                <label for="parse_method">Phương thức parse nội dung:</label>
                <select id="parse_method" name="parse_method">
                    <option value="dom" <?php echo (isset($edit_data['parse_method']) && $edit_data['parse_method'] === 'dom') ? 'selected' : ''; ?>>Parse theo DOM</option>
                    <option value="regex" <?php echo (isset($edit_data['parse_method']) && $edit_data['parse_method'] === 'regex') ? 'selected' : ''; ?>>Parse theo Regex</option>
                </select>
            </fieldset>
    
            <!-- Thêm phần cấu hình Regex Patterns -->
            <fieldset id="regex_patterns_fieldset">
                <legend>Regex Patterns (cho phương thức Regex)</legend>
                <label for="regex_pattern_content">Pattern nội dung:</label>
                <input type="text" id="regex_pattern_content" name="regex_patterns[content]" value="<?php echo htmlspecialchars($edit_data['regex_patterns']['content'] ?? ''); ?>" style="width: 100%;">
                <p class="field-hint">Ví dụ: #&lt;div[^&gt;]+id=["\']chapter-c["\'][^&gt;]*&gt;(.*?)&lt;/div&gt;&lt;div id="ads-chapter-google-bottom"#is</p>
            </fieldset>
    
            <fieldset>
                <legend>Selectors (XPath)</legend>
                <?php foreach ($edit_data['selectors'] as $key => $value): ?>
                    <label for="selector_<?php echo $key; ?>"><?php echo htmlspecialchars($key); ?>:</label>
                    <input type="text" id="selector_<?php echo $key; ?>" name="selectors[<?php echo $key; ?>]" value="<?php echo htmlspecialchars($value); ?>">
                <?php endforeach; ?>
            </fieldset>
            
            <br>
            <button type="submit" name="action_save_config" class="btn-save">Lưu Cấu hình</button>
        </form>
        
        <!-- Thêm JavaScript để hiển thị/ẩn phần regex patterns tùy theo phương thức parse -->
        <script>
        document.addEventListener('DOMContentLoaded', function() {
            var parseMethodSelect = document.getElementById('parse_method');
            var regexPatternsFieldset = document.getElementById('regex_patterns_fieldset');
            
            function toggleRegexPatterns() {
                if (parseMethodSelect.value === 'regex') {
                    regexPatternsFieldset.style.display = 'block';
                } else {
                    regexPatternsFieldset.style.display = 'none';
                }
            }
            
            // Thiết lập trạng thái ban đầu
            toggleRegexPatterns();
            
            // Thêm sự kiện khi thay đổi phương thức parse
            parseMethodSelect.addEventListener('change', toggleRegexPatterns);
        });
        </script>
            <br/>
                <a href="index.php" class="back-link">« Quay lại trang chọn site</a>
            <br/>
    <?php endif; ?>

    <?php
        // Khi quay lại trang chọn site, reset session authenticated để yêu cầu xác thực lại
        // Đảm bảo không reset nếu đang ở trang edit mà chỉ là POST request
        if (!isset($_GET['edit']) && $_SERVER['REQUEST_METHOD'] === 'GET') {
            unset($_SESSION['authenticated']);
        }
    ?>

    <?php // === GIAO DIỆN CHỌN SITE (BƯỚC 1) === ?>
<?php if (!isset($_SESSION['authenticated']) || $_SESSION['authenticated'] !== true): ?>
        <form method="POST" action="">
            <fieldset>
                <legend>Chọn Nguồn Cung ứng</legend>
                <label for="site_key">Chọn trang để sửa cấu hình:</label>
                <select name="site_key" id="site_key">
                    <?php foreach ($sites as $key => $site_data): ?>
                        <option value="<?php echo $key; ?>"><?php echo strtoupper($key); ?></option>
                    <?php endforeach; ?>
                </select>
            </fieldset>
            <br/>
            <fieldset>
                <legend>Xác thực</legend>
                <label for="security_code">Mã bảo mật:</label>
                <input type="text" id="security_code" name="security_code" value="<?php echo htmlspecialchars($decoy_code_value); ?>">
            </fieldset>

            <br>
            <button type="submit" name="action_select_site" class="btn-select">Sửa Site Đã Chọn</button>
        </form>
    <?php endif; ?>
</body>
</html>
