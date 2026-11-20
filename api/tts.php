<?php
// File: api/tts.php
declare(strict_types=1);

error_reporting(0);
ini_set('display_errors', '0');

// CORS and Preflight configuration for PWA Standalone & WebView contexts
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Range, Accept-Encoding');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$rawText = (string)($_REQUEST['text'] ?? $_REQUEST['q'] ?? '');
$langParam = (string)($_REQUEST['lang'] ?? $_REQUEST['tl'] ?? 'vi');
$lang = preg_replace('/[^a-zA-Z\-]/', '', $langParam) ?: 'vi';
$speed = isset($_REQUEST['speed']) ? (float)$_REQUEST['speed'] : 1.0;

// Normalize Unicode whitespace and strip control characters
$cleanText = trim(preg_replace('/\s+/u', ' ', strip_tags($rawText)));

if ($cleanText === '') {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'EMPTY_TEXT_PAYLOAD'], JSON_UNESCAPED_UNICODE);
    exit;
}

// Hard cap per request to prevent memory exhaustion
if (mb_strlen($cleanText, 'UTF-8') > 2500) {
    $cleanText = mb_substr($cleanText, 0, 2500, 'UTF-8');
}

// Configure deterministic local file cache
$cacheBaseDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'cache' . DIRECTORY_SEPARATOR . 'tts';
if (!is_dir($cacheBaseDir)) {
    @mkdir($cacheBaseDir, 0775, true);
}
if (!is_dir($cacheBaseDir) || !is_writable($cacheBaseDir)) {
    $cacheBaseDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'doc_truyen_tts_cache';
    if (!is_dir($cacheBaseDir)) {
        @mkdir($cacheBaseDir, 0775, true);
    }
}

$slowFlag = ($speed < 0.85) ? '1' : '0';
$cacheKey = hash('sha256', $lang . '|' . $slowFlag . '|' . $cleanText);
$cacheFile = $cacheBaseDir . DIRECTORY_SEPARATOR . $cacheKey . '.mp3';

/**
 * Splits a paragraph into sub-clauses under 180 UTF-8 characters
 * so upstream synthesis endpoints never reject the payload.
 *
 * @param string $text
 * @param int $maxLen
 * @return array<int, string>
 */
function segmentTextForSynthesis(string $text, int $maxLen = 180): array
{
    if (mb_strlen($text, 'UTF-8') <= $maxLen) {
        return [$text];
    }

    $tokens = preg_split('/([.!?…;,\x{2026}]+\s*)/u', $text, -1, PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY);
    if ($tokens === false) {
        return mb_str_split($text, $maxLen, 'UTF-8');
    }

    $segments = [];
    $current = '';

    foreach ($tokens as $token) {
        if (mb_strlen($current . $token, 'UTF-8') <= $maxLen) {
            $current .= $token;
        } else {
            if (trim($current) !== '') {
                $segments[] = trim($current);
            }
            if (mb_strlen($token, 'UTF-8') <= $maxLen) {
                $current = $token;
            } else {
                // Force word-boundary split on oversized unpunctuated clauses
                $words = explode(' ', $token);
                $subChunk = '';
                foreach ($words as $word) {
                    if (mb_strlen($subChunk . ' ' . $word, 'UTF-8') <= $maxLen) {
                        $subChunk = ($subChunk === '') ? $word : $subChunk . ' ' . $word;
                    } else {
                        if (trim($subChunk) !== '') {
                            $segments[] = trim($subChunk);
                        }
                        $subChunk = $word;
                    }
                }
                $current = $subChunk;
            }
        }
    }

    if (trim($current) !== '') {
        $segments[] = trim($current);
    }

    return $segments;
}

/**
 * Fetches binary MP3 frames for each text segment via cURL.
 *
 * @param array<int, string> $segments
 * @param string $lang
 * @param string $slowFlag
 * @return string|false
 */
function synthesizeAudioBuffer(array $segments, string $lang, string $slowFlag)
{
    $combinedBinary = '';
    $userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    ];
    $ua = $userAgents[array_rand($userAgents)];

    // Parallel fetch using curl_multi for ultra low latency (< 300ms)
    $multiHandle = curl_multi_init();
    $curlHandles = [];

    foreach ($segments as $idx => $segment) {
        $query = http_build_query([
            'ie'       => 'UTF-8',
            'client'   => 'tw-ob',
            'tl'       => $lang,
            'ttsspeed' => ($slowFlag === '1') ? '0.24' : '1',
            'q'        => $segment,
        ], '', '&', PHP_QUERY_RFC3986);

        $endpoint = 'https://translate.google.com/translate_tts?' . $query;

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $endpoint,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 3,
            CURLOPT_TIMEOUT        => 12,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_USERAGENT      => $ua,
            CURLOPT_REFERER        => 'https://translate.google.com/',
            CURLOPT_HTTPHEADER     => [
                'Accept: audio/mpeg, audio/*;q=0.9, */*;q=0.8',
                'Connection: keep-alive',
            ],
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        curl_multi_add_handle($multiHandle, $ch);
        $curlHandles[$idx] = $ch;
    }

    $running = null;
    do {
        $status = curl_multi_exec($multiHandle, $running);
        if ($running) {
            curl_multi_select($multiHandle, 0.2);
        }
    } while ($running > 0 && $status === CURLM_OK);

    $failed = false;
    foreach ($curlHandles as $idx => $ch) {
        $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $body = curl_multi_getcontent($ch);
        curl_multi_remove_handle($multiHandle, $ch);
        curl_close($ch);

        if ($httpCode !== 200 || !is_string($body) || strlen($body) < 64) {
            $failed = true;
        } else {
            $combinedBinary .= $body;
        }
    }
    curl_multi_close($multiHandle);

    if ($failed || $combinedBinary === '') {
        return false;
    }

    return $combinedBinary;
}

// Load from disk cache or synthesize fresh binary stream
$mp3Binary = false;
if (is_file($cacheFile) && filesize($cacheFile) > 64) {
    $mp3Binary = @file_get_contents($cacheFile);
    @touch($cacheFile);
}

if ($mp3Binary === false || strlen($mp3Binary) < 64) {
    $segments = segmentTextForSynthesis($cleanText, 180);
    $mp3Binary = synthesizeAudioBuffer($segments, $lang, $slowFlag);

    if ($mp3Binary === false) {
        http_response_code(502);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'UPSTREAM_TTS_FAILURE'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if (is_dir($cacheBaseDir) && is_writable($cacheBaseDir)) {
        $tmpFile = $cacheFile . '.' . bin2hex(random_bytes(4)) . '.tmp';
        if (@file_put_contents($tmpFile, $mp3Binary, LOCK_EX) !== false) {
            @rename($tmpFile, $cacheFile);
        }
    }
}

// Probabilistic opportunistic cache garbage collection (1% chance per request, TTL 7 days)
if (mt_rand(1, 100) === 1 && is_dir($cacheBaseDir)) {
    $now = time();
    $files = @glob($cacheBaseDir . DIRECTORY_SEPARATOR . '*.mp3');
    if (is_array($files) && count($files) > 500) {
        foreach ($files as $f) {
            if (($now - (int)@filemtime($f)) > 604800) {
                @unlink($f);
            }
        }
    }
}

$totalBytes = strlen($mp3Binary);
$etag = '"' . $cacheKey . '"';

header('Content-Type: audio/mpeg');
header('Accept-Ranges: bytes');
header('Cache-Control: public, max-age=86400, immutable');
header('ETag: ' . $etag);
header('X-Content-Type-Options: nosniff');

if (isset($_SERVER['HTTP_IF_NONE_MATCH']) && trim($_SERVER['HTTP_IF_NONE_MATCH']) === $etag) {
    http_response_code(304);
    exit;
}

// RFC 7233 Byte-Range responder for mobile lock-screen scrubbers
if (isset($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'], $matches)) {
    $start = ($matches[1] !== '') ? (int)$matches[1] : 0;
    $end   = ($matches[2] !== '') ? (int)$matches[2] : ($totalBytes - 1);

    if ($start > $end || $start >= $totalBytes || $end >= $totalBytes) {
        http_response_code(416);
        header("Content-Range: bytes */{$totalBytes}");
        exit;
    }

    $length = $end - $start + 1;
    http_response_code(206);
    header("Content-Range: bytes {$start}-{$end}/{$totalBytes}");
    header("Content-Length: {$length}");
    echo substr($mp3Binary, $start, $length);
    exit;
}

http_response_code(200);
header("Content-Length: {$totalBytes}");
echo $mp3Binary;
exit;
