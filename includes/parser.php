<?php
// includes/parser.php

/**
 * Hàm fetch URL có cơ chế cache và dùng cURL để tránh bị chặn.
 * @param string $url URL cần tải
 * @param int $cache_time Thời gian cache (giây), mặc định 1 giờ.
 * @return string Nội dung HTML của trang
 */
function fetchUrlWithCache($url, $cache_time = 3600) {
    $cacheDir = __DIR__ . '/../cache'; // Tạo thư mục cache cùng cấp với includes
    if (!is_dir($cacheDir)) {
        mkdir($cacheDir, 0755, true);
    }
    
    $cacheFile = $cacheDir . '/' . md5($url) . '.cache';

    // Nếu có cache và cache chưa hết hạn, dùng cache
    if (file_exists($cacheFile) && (time() - filemtime($cacheFile) < $cache_time)) {
        return file_get_contents($cacheFile);
    }

    // Nếu không có cache, tiến hành fetch bằng cURL
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,       // Trả về kết quả dưới dạng chuỗi
        CURLOPT_FOLLOWLOCATION => true,       // Tự động theo các redirect
        CURLOPT_MAXREDIRS      => 5,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36', // Giả mạo trình duyệt Chrome
        CURLOPT_TIMEOUT        => 30,          // Timeout sau 30 giây
        CURLOPT_SSL_VERIFYPEER => false        // Bỏ qua xác thực SSL (hữu ích với 1 số host)
    ]);
    
    $html = curl_exec($ch);
    curl_close($ch);

    // Nếu fetch thành công, lưu vào cache
    if ($html) {
        file_put_contents($cacheFile, $html);
    }
    
    return $html;
}

function normalizeParagraphs($rawHtmlContent) {
        // Đây là hàm normalizeParagraphs giả định của bạn
        // Hàm này sẽ nhận một chuỗi HTML thô (có thể chứa các </p> không chuẩn)
        // và trả về HTML với các đoạn được chuẩn hóa (ví dụ: bọc trong <p>...</p>)
        
        // Bước 0: Loại bỏ hoàn toàn các khối <script> và <style> (bao gồm cả nội dung bên trong)
        $rawHtmlContent = preg_replace('#<script[^>]*>.*?</script>#is', '', $rawHtmlContent);
        $rawHtmlContent = preg_replace('#<style[^>]*>.*?</style>#is', '', $rawHtmlContent);

        // Bước 1: Loại bỏ các thẻ quảng cáo nếu cần (trong trường hợp chưa bị loại bỏ trước đó)
        // Ví dụ: loại bỏ div quảng cáo có id="ads-chapter-pc-top"
        $rawHtmlContent = preg_replace('#<div[^>]+id=["\']ads-chapter-pc-top["\'][^>]*>.*?</div>#isU', '', $rawHtmlContent);
        // Loại bỏ div ads-chapter-google-bottom nếu nó nằm trong nội dung trích xuất
        $rawHtmlContent = preg_replace('#<div[^>]+id=["\']ads-chapter-google-bottom["\'][^>]*>.*?</div>#isU', '', $rawHtmlContent);

        // Bước 2: Thay thế các thẻ </p> bằng một dấu phân cách tạm thời
        // Đây là điểm mấu chốt để sử dụng </p> làm dấu phân cách ngay cả khi nó không có <p> mở
        $cleanedHtml = preg_replace('#</p[^>]*>#i', '__PARA_BREAK__', $rawHtmlContent);

        // Bước 3: Loại bỏ các thẻ HTML khác không mong muốn hoặc các <p> mở nếu có
        $cleanedHtml = preg_replace('#<br\s*/?>#i', "__BR_BREAK__", $cleanedHtml); // Thay <br> bằng dấu phân cách tạm thời khác
        $cleanedHtml = preg_replace('#<[^>]+>#', '', $cleanedHtml); // Loại bỏ tất cả các thẻ HTML còn lại

        // Bước 3.1: Loại bỏ sạch rác mã hóa JSON tháp tùng (thường chứa "mac":"...") và các chuỗi base64 dài bất thường
        // Lọc các chuỗi mã hóa JSON (thường bắt đầu bằng {"iv": hoặc {"mac":)
        $cleanedHtml = preg_replace('/\{"(?:iv|mac|value)":.*?\}/s', '', $cleanedHtml);
        // Lọc các chuỗi Base64 hoặc mã hóa dài liên tục (trên 100 ký tự không khoảng trắng) - Đặc trị cho các site như tamlinh
        $cleanedHtml = preg_replace('/[a-zA-Z0-9+\/\\\]{100,}/s', '', $cleanedHtml);

        // Bước 3.2: Xóa các câu quảng cáo rác cụ thể (theo đề xuất của bạn)
        $junkAds = [
            "Bạn đang đọc truyện mới tại truyen tamlinh247 com.vn",
            "Bên khác copy sẽ thiếu nội dung"
        ];
        foreach ($junkAds as $ad) {
            // Xóa từ chữ đó đến hết dòng (trước khi xuống dòng)
            $cleanedHtml = preg_replace('/' . preg_quote($ad, '/') . '.*?(\n|$)/iu', '', $cleanedHtml);
        }

        // Bước 3.5: Lọc nội dung rác và cắt đuôi quảng cáo
        // Tìm kiếm từ trên xuống dưới các chuỗi gồm 5 ký tự đặc biệt liên tiếp (=====, *****, -----, _____)
        // và thay thế chúng cùng toàn bộ nội dung phía sau thành chuỗi rỗng.
        $cleanedHtml = preg_replace('/[=\-\*_]{5,}.*$/us', '', $cleanedHtml);

        // Bước 4: Chuẩn hóa các dấu phân cách
        $cleanedHtml = str_replace(["\r\n", "\r"], "\n", $cleanedHtml);
        $cleanedHtml = preg_replace('#\s*__BR_BREAK__\s*#i', '__PARA_BREAK__', $cleanedHtml);
        $cleanedHtml = preg_replace('#(?:__PARA_BREAK__\s*){2,}#i', '__PARA_BREAK__', $cleanedHtml);

        // Bước 5: Chia chuỗi thành các đoạn
        $paragraphs = preg_split('#__PARA_BREAK__#i', $cleanedHtml, -1, PREG_SPLIT_NO_EMPTY);
        
        $result = '';
        foreach ($paragraphs as $para) {
            $para = trim($para);
            // Loại bỏ hoàn toàn nếu đoạn văn chỉ chứa các chuỗi kỹ thuật rò rỉ (như __PARA_BREAK do regex cắt dở)
            $para = preg_replace('#^_*PARA_BREAK_*$#i', '', $para);
            $para = trim($para);
            
            if (!empty($para)) {
                $result .= "<p>" . $para . "</p>\n";
            }
        }
        return $result;
    }

/**
 * Parse nội dung truyện sử dụng phương pháp DOM
 * @param string $htmlString Chuỗi HTML gốc
 * @param array $selectors Mảng các selector
 * @param DOMXPath $xpath Đối tượng XPath
 * @return string Nội dung đã được xử lý
 */
function parseContentByDOM($htmlString, $selectors, $xpath) {
    $contentNode = $xpath->query($selectors['content_div'])->item(0);
    $contentHtml = '';
    
    if ($contentNode) {
        // Xóa quảng cáo nếu có selector
        if (!empty($selectors['ads_in_content'])) {
            $adsNodes = $xpath->query($selectors['ads_in_content'], $contentNode);
            foreach ($adsNodes as $adsNode) {
                if ($adsNode) {
                    $adsNode->parentNode->removeChild($adsNode);
                }
            }
        }
        
        // Lấy nội dung HTML
        $dom = $contentNode->ownerDocument;
        foreach ($contentNode->childNodes as $child) {
            $contentHtml .= $dom->saveHTML($child);
        }
    }
    
    return normalizeParagraphs($contentHtml);
}

/**
 * Parse nội dung truyện sử dụng phương pháp Regex
 * @param string $htmlString Chuỗi HTML gốc
 * @param string $siteKey Khóa của site
 * @param array $regexPatterns Mảng các pattern regex
 * @return string Nội dung đã được xử lý
 */
function parseContentByRegex($htmlString, $siteKey, $regexPatterns) {
    $rawChapterContent = '';
    
    // Sử dụng pattern từ cấu hình nếu có
    if (!empty($regexPatterns['content'])) {
        $pattern = $regexPatterns['content'];
    } else {
        // Fallback vào pattern mặc định nếu không có trong cấu hình
        if ($siteKey === "truyenfull") {
            $pattern = '#<div[^>]+id=["\']chapter-c["\'][^>]*>(.*?)</div>\s*<div[^>]+id=["\']ads-chapter-(?:google-)?(?:bottom|middle)["\']#is';
        } else {
            $pattern = '#<div class=".*?content".*?<div class=".*?content".*?>(.*?)(?:</div>\s*){2,}#is';
        }
    }

    if (preg_match($pattern, $htmlString, $matches)) {
        $rawChapterContent = $matches[1];
    }
    
    return normalizeParagraphs($rawChapterContent);
}

function getStoryData($siteKey, $path, $forceParseMethod = null) {
    // 1. Đọc file config
    $configFile = __DIR__ . '/../config/config.json';
    if (!file_exists($configFile)) {
        throw new Exception("Lỗi: File config.json không tồn tại.");
    }
    $config = json_decode(file_get_contents($configFile), true);

    // 2. Lấy đúng cấu hình cho site được yêu cầu
    if (!isset($config['sites'][$siteKey])) {
        throw new Exception("Lỗi: Không tìm thấy cấu hình cho site '{$siteKey}'.");
    }
    $siteConfig = $config['sites'][$siteKey];
    $sourceDomain = $siteConfig['domain'];
    $selectors = $siteConfig['selectors'];

    // Xác định phương thức parse (ưu tiên tham số force nếu có)
    $parseMethod = $forceParseMethod ?: ($siteConfig['parse_method'] ?? 'dom');
    
    // Lấy regex patterns nếu có
    $regexPatterns = $siteConfig['regex_patterns'] ?? [];
    
    // 3. Tiến hành fetch qua bridge tại VN để tránh bị chặn IP
    $fullUrl = 'https://' . $sourceDomain . '/' . $path;
    $bridgeUrl = "http://103.124.95.161/~nhthuubk/bridge.php?token=Ami_www_Read2026&url=" . urlencode($fullUrl);
    
    $htmlString = fetchUrlWithCache($bridgeUrl);
    
    if (!$htmlString) {
        throw new Exception("Không thể tải nội dung (qua bridge) từ: " . $fullUrl);
    }
    $dom = new DOMDocument();
    libxml_use_internal_errors(true);
    $dom->loadHTML('<?xml encoding="utf-8" ?>' . $htmlString);
    libxml_clear_errors();
    $xpath = new DOMXPath($dom);

    // 4. Trích xuất dữ liệu dựa trên selectors đã chọn
    $data = [];
    $getNodeValue = function($query) use ($xpath) {
        $node = $xpath->query($query)->item(0);
        return $node ? trim($node->nodeValue) : null;
    };

    $getNodeAttribute = function($query, $attribute) use ($xpath) {
        $node = $xpath->query($query)->item(0);
        return ($node instanceof DOMElement) ? $node->getAttribute($attribute) : null;
    };

    $data['ten_truyen'] = $getNodeValue($selectors['story_title']);
    $data['ten_chuong'] = $getNodeValue($selectors['chapter_title']);

     // Trích xuất liên kết "Trước" và "Tiếp"
    $prev_path = '';
    $next_path = '';
    // Lấy tất cả thẻ <a> trong khu vực điều hướng
    $links = $xpath->query($selectors['prev_chapter_url']); // Cả prev và next dùng chung selector
    foreach ($links as $link) {
        $text = trim($link->textContent);
        $href = ($link instanceof DOMElement) ? $link->getAttribute('href') : '';
        // Kiểm tra liên kết "Trước"
        if (stripos($text, $selectors['prev_chapter_text']) !== false && $href !== 'javascript:void(0)') {
            $prev_path = $href; //echo "PREV PATH: [" . $prev_path . "]<br/>";
        }
        // Kiểm tra liên kết "Tiếp"/"Sau"
        if (stripos($text, $selectors['next_chapter_text']) !== false && $href !== 'javascript:void(0)') {
            $next_path = $href; //echo "NEXT PATH: [" . $next_path . "]<br/>";
        }
    }
    // Làm sạch đường dẫn: loại bỏ domain và #fragment
    $data['path_chuong_truoc'] = $prev_path ? trim(parse_url($prev_path, PHP_URL_PATH), '/') : 'void(0)';
    $data['path_chuong_sau'] = $next_path ? trim(parse_url($next_path, PHP_URL_PATH), '/') : 'void(0)';

    // 5. Parse nội dung theo phương thức đã chọn
    if ($parseMethod === 'dom') {
        $data['noi_dung'] = parseContentByDOM($htmlString, $selectors, $xpath);
    } else {
        $data['noi_dung'] = parseContentByRegex($htmlString, $siteKey, $regexPatterns);
    }

    return $data;
}