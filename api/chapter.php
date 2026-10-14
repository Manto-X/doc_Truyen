<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/includes/chapter_service.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, max-age=60');

function chapterApiError(int $status, string $code, string $message): void {
    http_response_code($status);
    echo json_encode([
        'error' => ['code' => $code, 'message' => $message, 'retryable' => $status >= 500],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function chapterApiPath(string $siteKey, string $path): string {
    $scriptName = $_SERVER['SCRIPT_NAME'] ?? '/api/chapter.php';
    $basePath = rtrim(dirname(dirname($scriptName)), '/');
    return $basePath . '/' . rawurlencode($siteKey) . '/' . implode('/', array_map('rawurlencode', explode('/', trim($path, '/'))));
}

try {
    $siteKey = strtolower(trim((string)($_GET['s'] ?? 'tf')));
    if ($siteKey === 'tf') {
        $siteKey = 'truyenfull';
    }
    $path = trim((string)($_GET['p'] ?? ''));
    if ($path === '') {
        chapterApiError(400, 'invalid_request', 'Thiếu đường dẫn chương.');
    }

    $response = chapterDto($siteKey, $path);
    $response['previous'] = $response['previousPath'] !== null ? ['path' => $response['previousPath'], 'url' => chapterApiPath($response['sourceKey'], $response['previousPath'])] : null;
    $response['next'] = $response['nextPath'] !== null ? ['path' => $response['nextPath'], 'url' => chapterApiPath($response['sourceKey'], $response['nextPath'])] : null;
    unset($response['previousPath'], $response['nextPath']);
    echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    error_log('chapter API: ' . $error->getMessage());
    chapterApiError(502, 'chapter_unavailable', 'Không thể tải chương lúc này.');
}
