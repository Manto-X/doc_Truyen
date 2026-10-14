<?php
// Định nghĩa hằng số cho đường dẫn thư mục gốc vật lý của project
// __DIR__ là hằng số ma thuật trong PHP, trả về đường dẫn thư mục hiện tại của file.
// Nếu config.php nằm ở thư mục gốc của project, thì __ROOT__ sẽ là đường dẫn đó.
define('__ROOT__', __DIR__);

// --- Định nghĩa hằng số cho URL gốc của project ---

// Lấy giao thức (http hoặc https)
$protocol = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http";

// Lấy tên host (ví dụ: localhost, 127.0.0.1, yourdomain.com)
$host = $_SERVER['HTTP_HOST'];

// Lấy đường dẫn cơ sở của project trên server
// VD: nếu bạn truy cập http://localhost/my_project/index.php
// dirname($_SERVER['SCRIPT_NAME']) sẽ trả về /my_project
$base_path = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/');

// Kết hợp để tạo ra URL gốc của project
// VD: http://localhost/my_project
define('__SITEURL__', $protocol . "://" . $host . $base_path);

// 1. NẠP PARSER
require_once 'includes/parser.php';

// 2. LẤY THAM SỐ TỪ URL
// Lấy mã trang, mặc định là 'tf' (truyenfull) nếu không có
$siteKey = $_GET['s'] ?? 'tf';
// Giữ tương thích với các URL mẫu và bookmark cũ.
$siteKey = strtolower(trim($siteKey));
if ($siteKey === 'tf') {
    $siteKey = 'truyenfull';
}
// Lấy đường dẫn chương, dùng 'p' cho ngắn gọn
$path = $_GET['p'] ?? null;

// 3. KIỂM TRA VÀ XỬ LÝ
if (!$path) {
    echo "<h1>Trang đọc truyện đa nguồn</h1>";
    echo "<p>Vui lòng mở đúng cấu trúc, ví dụ: <a href='?s=tf&p=de-ba/chuong-1'>?s=tf&p=de-ba/chuong-1</a></p>";
    exit();
}

try {
    // Trích xuất số lượng chương cần gộp hoặc chế độ tự động chạy
    // Lưu ý: PHP tự động giải mã ký tự '+' trong Query String thành khoảng trắng ' '
    $mergeCount = 0;
    $isAutoPlay = false;
    $autoPlayKeyword = 'auto';
    $cleanPath = $path;

    if ($path && preg_match('/\/(auto|full)\/?$/i', $path, $matches)) {
        $isAutoPlay = true;
        $autoPlayKeyword = strtolower($matches[1]);
        $cleanPath = preg_replace('/\/(auto|full)\/?$/i', '', $path);
    } elseif ($path && preg_match('/\/([\+ ](\d+))\/?$/', $path, $matches)) {
        $mergeCount = (int)$matches[2];
        $cleanPath = preg_replace('/\/([\+ ](\d+))\/?$/', '', $path);
    }

    // Gọi parser với cả mã trang và đường dẫn sạch
    $forceParseMethod = $_GET['parse_method'] ?? null; // 'dom' hoặc 'regex' hoặc null (dùng mặc định)
    $storyData = getStoryData($siteKey, $cleanPath, $forceParseMethod);

    // Xử lý gộp tiếp các chương sau nếu có yêu cầu merge (+N)
    if ($mergeCount > 0) {
        $currentNextPath = $storyData['path_chuong_sau'];
        $originalTitle = $storyData['ten_chuong'];
        $lastTitle = $originalTitle;
        
        for ($i = 0; $i < $mergeCount; $i++) {
            if ($currentNextPath && $currentNextPath !== 'void(0)' && $currentNextPath !== '#') {
                try {
                    // Tải chương tiếp theo
                    $nextStoryData = getStoryData($siteKey, $currentNextPath, $forceParseMethod);
                    // Ghép nội dung chương mới vào chương hiện tại
                    $storyData['noi_dung'] .= "\n<hr class='chapter-separator'><h3 class='merged-chapter-title'>" . htmlspecialchars($nextStoryData['ten_chuong']) . "</h3>\n" . $nextStoryData['noi_dung'];
                    // Lưu vết chương cuối cùng để cập nhật tiêu đề gộp
                    $lastTitle = $nextStoryData['ten_chuong'];
                    // Chuyển hướng con trỏ chương tiếp theo tới chương kế của chương vừa gộp
                    $currentNextPath = $nextStoryData['path_chuong_sau'];
                } catch (Exception $e) {
                    // Nếu tải chương tiếp theo gặp lỗi (ví dụ hết truyện), dừng vòng lặp
                    break;
                }
            } else {
                break;
            }
        }
        
        // Cập nhật đường dẫn chương tiếp theo của phiên bản gộp
        $storyData['path_chuong_sau'] = $currentNextPath;
        
        // Cập nhật tiêu đề chương gộp (Ví dụ: Chương 1 - Chương 4)
        if ($originalTitle !== $lastTitle) {
            $storyData['ten_chuong'] = $originalTitle . ' - ' . $lastTitle;
        }

        // Đính kèm tham số gộp vào link chuyển chương Trước và Tiếp để giữ trạng thái gộp khi click điều hướng
        if ($storyData['path_chuong_truoc'] && $storyData['path_chuong_truoc'] !== 'void(0)') {
            $storyData['path_chuong_truoc'] .= "/+$mergeCount";
        }
        if ($storyData['path_chuong_sau'] && $storyData['path_chuong_sau'] !== 'void(0)') {
            $storyData['path_chuong_sau'] .= "/+$mergeCount";
        }
    }

    // Đính kèm tham số auto/full vào link chuyển chương Trước và Tiếp để giữ trạng thái tự động đọc
    if ($isAutoPlay) {
        if ($storyData['path_chuong_truoc'] && $storyData['path_chuong_truoc'] !== 'void(0)') {
            $storyData['path_chuong_truoc'] .= "/$autoPlayKeyword";
        }
        if ($storyData['path_chuong_sau'] && $storyData['path_chuong_sau'] !== 'void(0)') {
            $storyData['path_chuong_sau'] .= "/$autoPlayKeyword";
        }
    }

    // 4. GỌI GIAO DIỆN ĐỂ HIỂN THỊ
    // Tệp view sẽ có quyền truy cập vào $storyData và $siteKey
    require_once 'templates/story_view.php';

} catch (Exception $e) {
    // Xử lý nếu parser gặp lỗi
    header("HTTP/1.1 500 Internal Server Error");
    die('Đã có lỗi xảy ra: ' . $e->getMessage());
}
