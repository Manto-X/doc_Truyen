<?php
// Khởi động session với cookie chỉ dùng HTTP và chống fixation cơ bản.
$sessionSavePath = (string)getenv('READER_SESSION_SAVE_PATH');
if ($sessionSavePath !== '' && is_dir($sessionSavePath) && is_writable($sessionSavePath)) {
    session_save_path($sessionSavePath);
}
session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off']);
session_start();

// Đường dẫn tới tệp cấu hình
define('CONFIG_FILE', __DIR__ . '/../../config/config.json');
define('BACKUP_DIR', __DIR__ . '/../../backup/config-revisions');
define('DRAFT_DIR', __DIR__ . '/../../backup/config-drafts');

function saveConfigAtomically(array $config, string $siteKey): bool {
    $json = json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) return false;
    if (!is_dir(BACKUP_DIR) && !mkdir(BACKUP_DIR, 0750, true)) return false;
    $revision = BACKUP_DIR . '/' . preg_replace('/[^a-z0-9_-]/i', '_', $siteKey) . '-' . gmdate('Ymd-His') . '.json';
    if (!copy(CONFIG_FILE, $revision)) return false;
    $temporary = CONFIG_FILE . '.' . bin2hex(random_bytes(6)) . '.tmp';
    if (file_put_contents($temporary, $json, LOCK_EX) === false) return false;
    return rename($temporary, CONFIG_FILE);
}

function writeJsonAtomically(string $file, array $data): bool {
    $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) return false;
    $temporary = $file . '.' . bin2hex(random_bytes(6)) . '.tmp';
    if (file_put_contents($temporary, $json, LOCK_EX) === false) return false;
    return rename($temporary, $file);
}

function draftFile(string $siteKey): string {
    return DRAFT_DIR . '/' . preg_replace('/[^a-z0-9_-]/i', '_', $siteKey) . '.json';
}

function revisionFiles(string $siteKey): array {
    $prefix = preg_replace('/[^a-z0-9_-]/i', '_', $siteKey) . '-*.json';
    $files = glob(BACKUP_DIR . '/' . $prefix) ?: [];
    rsort($files, SORT_STRING);
    return $files;
}

function validateSiteConfig(array $site): array {
    $errors = [];
    if (empty($site['domain']) || !preg_match('/^[a-z0-9.-]+$/i', $site['domain'])) $errors[] = 'Tên miền không hợp lệ.';
    if (!in_array($site['parse_method'] ?? '', ['dom', 'regex'], true)) $errors[] = 'Phương thức parse không hợp lệ.';
    if (($site['parse_method'] ?? '') === 'regex' && !empty($site['regex_patterns']['content']) && @preg_match($site['regex_patterns']['content'], '') === false) $errors[] = 'Regex nội dung không hợp lệ.';
    foreach (($site['selectors'] ?? []) as $name => $selector) {
        if (!is_string($selector) || trim($selector) === '') $errors[] = "XPath {$name} trống.";
    }
    return $errors;
}

// Khởi tạo các biến
$message = '';
if (empty($_SESSION['csrf_token'])) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}
// Xác định xem có đang ở chế độ sửa một site cụ thể không (ví dụ: ?edit=tf)
$site_to_edit = $_GET['edit'] ?? null;
// Đọc toàn bộ file config
$config = json_decode(file_get_contents(CONFIG_FILE), true);
// Lấy danh sách các site hiện có
$sites = $config['sites'] ?? [];

$adminPasswordHash = (string)getenv('READER_ADMIN_PASSWORD_HASH');

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
        if ($adminPasswordHash === '') {
            $message = '<p class="msg-error">Lỗi: Admin chưa được cấu hình password hash.</p>';
            unset($_SESSION['authenticated']);
        } elseif (!password_verify($submitted_code, $adminPasswordHash)) {
            $message = '<p class="msg-error">Lỗi: Sai mã bảo mật!</p>';
            // Không làm gì với decoy_code_value, nó sẽ được tạo lại khi trang tải lại
            unset($_SESSION['authenticated']); // Đảm bảo cờ xác thực bị xóa nếu sai
        } else {
            // Mã bảo mật ĐÚNG, tiến hành chọn site và đặt cờ xác thực
            $_SESSION['authenticated'] = true; // Đánh dấu đã xác thực
            session_regenerate_id(true);
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
        if (!isset($_SESSION['authenticated']) || $_SESSION['authenticated'] !== true || !hash_equals($_SESSION['csrf_token'], $_POST['csrf_token'] ?? '')) {
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
                if (!is_dir(DRAFT_DIR) && !mkdir(DRAFT_DIR, 0750, true)) {
                    $message = '<p class="msg-error">Lỗi: Không thể tạo vùng bản nháp.</p>';
                } elseif ($errors = validateSiteConfig($config['sites'][$site_key_to_save])) {
                    $message = '<p class="msg-error">Bản nháp chưa hợp lệ: ' . htmlspecialchars(implode(' ', $errors), ENT_QUOTES, 'UTF-8') . '</p>';
                } elseif (writeJsonAtomically(draftFile($site_key_to_save), $config['sites'][$site_key_to_save])) {
                    $message = '<p class="msg-success">Đã lưu bản nháp cho site: ' . strtoupper($site_key_to_save) . '. Cấu hình live chưa thay đổi.</p>';
                } else {
                    $message = '<p class="msg-error">Lỗi: Không thể ghi bản nháp.</p>';
                }
            }
        }
    }

    if (isset($_POST['action_publish_draft'])) {
        $site_key_to_publish = $_POST['site_key_to_save'] ?? null;
        if (!isset($_SESSION['authenticated']) || $_SESSION['authenticated'] !== true || !hash_equals($_SESSION['csrf_token'], $_POST['csrf_token'] ?? '') || !$site_key_to_publish || !isset($sites[$site_key_to_publish])) {
            $message = '<p class="msg-error">Không được phép xuất bản bản nháp này.</p>';
        } else {
            $draftPath = draftFile($site_key_to_publish);
            $draft = is_file($draftPath) ? json_decode((string)file_get_contents($draftPath), true) : null;
            if (!is_array($draft)) {
                $message = '<p class="msg-error">Không tìm thấy bản nháp hợp lệ.</p>';
            } elseif ($errors = validateSiteConfig($draft)) {
                $message = '<p class="msg-error">Không thể xuất bản: ' . htmlspecialchars(implode(' ', $errors), ENT_QUOTES, 'UTF-8') . '</p>';
            } else {
                $published = $config;
                $published['sites'][$site_key_to_publish] = $draft;
                if (saveConfigAtomically($published, $site_key_to_publish)) {
                    unlink($draftPath);
                    $config = $published;
                    $sites = $config['sites'];
                    $message = '<p class="msg-success">Đã xuất bản bản nháp: ' . strtoupper($site_key_to_publish) . '</p>';
                } else {
                    $message = '<p class="msg-error">Không thể xuất bản cấu hình.</p>';
                }
            }
        }
    }

    if (isset($_POST['action_rollback_revision'])) {
        $site_key_to_rollback = $_POST['site_key_to_save'] ?? null;
        $revisionName = basename((string)($_POST['revision_file'] ?? ''));
        $allowed = $site_key_to_rollback ? array_map('basename', revisionFiles($site_key_to_rollback)) : [];
        if (!isset($_SESSION['authenticated']) || $_SESSION['authenticated'] !== true || !hash_equals($_SESSION['csrf_token'], $_POST['csrf_token'] ?? '') || !in_array($revisionName, $allowed, true)) {
            $message = '<p class="msg-error">Không được phép hoàn tác revision này.</p>';
        } else {
            $revision = json_decode((string)file_get_contents(BACKUP_DIR . '/' . $revisionName), true);
            if (!is_array($revision) || !isset($revision['sites'][$site_key_to_rollback])) {
                $message = '<p class="msg-error">Revision backup không hợp lệ.</p>';
            } elseif (saveConfigAtomically($revision, $site_key_to_rollback)) {
                $config = $revision;
                $sites = $config['sites'];
                $message = '<p class="msg-success">Đã hoàn tác revision: ' . htmlspecialchars($revisionName, ENT_QUOTES, 'UTF-8') . '</p>';
            } else {
                $message = '<p class="msg-error">Không thể hoàn tác revision.</p>';
            }
        }
    }
}

// Lấy thông tin của site đang được sửa (nếu có)
$edit_data = ($site_to_edit && isset($sites[$site_to_edit])) ? $sites[$site_to_edit] : null;
$draft_data = ($site_to_edit && is_file(draftFile($site_to_edit))) ? json_decode((string)file_get_contents(draftFile($site_to_edit)), true) : null;
if (is_array($draft_data)) $edit_data = $draft_data;
$revisions = $site_to_edit ? revisionFiles($site_to_edit) : [];

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
            <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($_SESSION['csrf_token'], ENT_QUOTES, 'UTF-8'); ?>">
            
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
            <button type="submit" name="action_save_config" class="btn-save">Lưu bản nháp</button>
            <?php if (is_array($draft_data)): ?>
                <button type="submit" name="action_publish_draft" class="btn-save" onclick="return confirm('Xuất bản bản nháp này?');">Xuất bản bản nháp</button>
                <p class="field-hint">Đang chỉnh sửa bản nháp; cấu hình live chưa thay đổi.</p>
            <?php endif; ?>
            <?php if ($revisions): ?>
                <label for="revision_file">Hoàn tác về revision:</label>
                <select id="revision_file" name="revision_file">
                    <?php foreach ($revisions as $revision): ?>
                        <option value="<?php echo htmlspecialchars(basename($revision), ENT_QUOTES, 'UTF-8'); ?>"><?php echo htmlspecialchars(basename($revision), ENT_QUOTES, 'UTF-8'); ?></option>
                    <?php endforeach; ?>
                </select>
                <button type="submit" name="action_rollback_revision" class="btn-save" onclick="return confirm('Hoàn tác cấu hình live?');">Hoàn tác</button>
            <?php endif; ?>
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
