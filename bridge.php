<?php
/**
 * Antigravity High-Performance Forward Proxy Bridge
 * Purpose: Secure crawling proxy for Host Ami (toha.us/ai/read)
 * PHP: 7.4+ (cURL + Gzip + SSRF protection + Secret Token)
 */

// 1. Kiểm tra Secret Token bảo vệ (chặn Open Proxy)
$expectedToken = (string)getenv('READER_BRIDGE_TOKEN');
$token = isset($_SERVER['HTTP_X_BRIDGE_TOKEN']) ? $_SERVER['HTTP_X_BRIDGE_TOKEN'] : '';

if ($expectedToken === '' || !hash_equals($expectedToken, $token)) {
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
if (!isset($parsed['scheme']) || !in_array(strtolower($parsed['scheme']), ['http', 'https']) || isset($parsed['user']) || isset($parsed['pass']) || isset($parsed['port'])) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'error' => 'Bad Request',
        'message' => 'Only http and https schemes are permitted.'
    ]);
    exit;
}

$host = isset($parsed['host']) ? strtolower($parsed['host']) : '';
$allowedHosts = array_filter(array_map('trim', explode(',', (string)getenv('READER_BRIDGE_ALLOWED_HOSTS'))));
if (!$host || !$allowedHosts || !in_array($host, $allowedHosts, true)) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'error' => 'Forbidden',
        'message' => 'Access to internal resources is blocked.'
    ]);
    exit;
}

// Resolve once to a public IPv4 address and pin cURL to it, tránh DNS rebinding.
$resolved = gethostbynamel($host) ?: [];
$publicIps = array_values(array_filter($resolved, function ($ip) {
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
}));
if (!$publicIps) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Forbidden', 'message' => 'Target host does not resolve to a public address.']);
    exit;
}
$pinnedIp = $publicIps[0];
$maxResponseBytes = 4 * 1024 * 1024;
$response = '';

// 4. Khởi tạo cURL tải dữ liệu tốc độ cao qua IP nội địa VN
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => $url,
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_TIMEOUT => 25,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_ENCODING => '', // Hỗ trợ tự động giải nén gzip, deflate
    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_IPRESOLVE => CURL_IPRESOLVE_V4,
    CURLOPT_RESOLVE => [$host . ':' . (strtolower($parsed['scheme']) === 'https' ? '443' : '80') . ':' . $pinnedIp],
    CURLOPT_HTTPHEADER => [
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language: vi,vi-VN;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control: no-cache',
    ],
    CURLOPT_WRITEFUNCTION => function ($handle, $chunk) use (&$response, $maxResponseBytes) {
        if (strlen($response) + strlen($chunk) > $maxResponseBytes) {
            return 0;
        }
        $response .= $chunk;
        return strlen($chunk);
    }
]);

$requestOk = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$curlError = curl_error($ch);
curl_close($ch);

// 5. Xử lý phản hồi
if ($requestOk === false) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'error' => 'Bad Gateway',
        'message' => 'cURL Error: ' . $curlError
    ]);
    exit;
}

if ($httpCode >= 300 && $httpCode < 400) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Bad Gateway', 'message' => 'Redirects are not permitted by this bridge.']);
    exit;
}

if ($contentType) {
    header("Content-Type: " . $contentType);
}
http_response_code($httpCode ? $httpCode : 200);
echo $response;
