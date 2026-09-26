<?php
/**
 * Antigravity High-Performance Forward Proxy Bridge
 * Purpose: Secure crawling proxy for Host Ami (toha.us/ai/read)
 * PHP: 7.4+ (cURL + Gzip + SSRF protection + Secret Token)
 */

define('BRIDGE_TOKEN', 'Ami_www_Read2026');

// 1. Kiểm tra Secret Token bảo vệ (chặn Open Proxy)
$token = isset($_REQUEST['token']) ? $_REQUEST['token'] : '';
if (!$token && isset($_SERVER['HTTP_X_BRIDGE_TOKEN'])) {
    $token = $_SERVER['HTTP_X_BRIDGE_TOKEN'];
}

if ($token !== BRIDGE_TOKEN) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'error' => 'Forbidden',
        'message' => 'Invalid or missing authentication token.'
    ]);
    exit;
}

// 2. Kiểm tra Target URL
$url = isset($_REQUEST['url']) ? trim($_REQUEST['url']) : '';
if (empty($url)) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'error' => 'Bad Request',
        'message' => 'Missing target URL parameter.'
    ]);
    exit;
}

// 3. Chống SSRF (chặn đọc localhost / private IP của hosting)
$parsed = parse_url($url);
if (!isset($parsed['scheme']) || !in_array(strtolower($parsed['scheme']), ['http', 'https'])) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'error' => 'Bad Request',
        'message' => 'Only http and https schemes are permitted.'
    ]);
    exit;
}

$host = isset($parsed['host']) ? strtolower($parsed['host']) : '';
if (in_array($host, ['localhost', '127.0.0.1', '::1', '0.0.0.0'])) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'error' => 'Forbidden',
        'message' => 'Access to internal resources is blocked.'
    ]);
    exit;
}

// 4. Khởi tạo cURL tải dữ liệu tốc độ cao qua IP nội địa VN
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => $url,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_TIMEOUT => 25,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_ENCODING => '', // Hỗ trợ tự động giải nén gzip, deflate
    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => 0,
    CURLOPT_HTTPHEADER => [
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language: vi,vi-VN;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control: no-cache',
    ]
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$curlError = curl_error($ch);
curl_close($ch);

// 5. Xử lý phản hồi
if ($response === false) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'error' => 'Bad Gateway',
        'message' => 'cURL Error: ' . $curlError
    ]);
    exit;
}

if ($contentType) {
    header("Content-Type: " . $contentType);
}
http_response_code($httpCode ? $httpCode : 200);
echo $response;