<?php
declare(strict_types=1);

require_once __DIR__ . '/parser.php';

/**
 * Bóc tách hậu tố điều khiển (/auto, /full, /+N) khỏi đường dẫn chương
 * để đảm bảo API luôn tải đúng URL gốc từ nguồn truyện.
 */
function normalizeChapterRequestPath(string $rawPath): array {
    $cleanPath = trim($rawPath, '/');
    $mode = null;
    $mergeCount = 0;

    if (preg_match('/\/(auto|full)\/?$/i', $cleanPath, $matches)) {
        $mode = strtolower($matches[1]);
        $cleanPath = (string)preg_replace('/\/(auto|full)\/?$/i', '', $cleanPath);
    } elseif (preg_match('/\/([\+ ](\d+))\/?$/', $cleanPath, $matches)) {
        $mergeCount = (int)$matches[2];
        $cleanPath = (string)preg_replace('/\/([\+ ](\d+))\/?$/', '', $cleanPath);
    }

    return [
        'cleanPath' => trim($cleanPath, '/'),
        'mode' => $mode,
        'mergeCount' => $mergeCount,
    ];
}

function chapterParagraphs(string $contentHtml): array {
    $document = new DOMDocument();
    libxml_use_internal_errors(true);
    $document->loadHTML('<?xml encoding="utf-8" ?>' . $contentHtml);
    libxml_clear_errors();
    $paragraphs = [];
    foreach ($document->getElementsByTagName('p') as $index => $paragraph) {
        $text = trim($paragraph->textContent);
        if ($text !== '') {
            $paragraphs[] = ['id' => 'p' . $index, 'text' => $text];
        }
    }
    return $paragraphs;
}

function chapterDto(string $siteKey, string $path): array {
    $source = sourceConfig($siteKey);
    $siteKey = $source['key'];
    $normalized = normalizeChapterRequestPath($path);
    $canonicalPath = $normalized['cleanPath'];

    if ($canonicalPath === '') {
        throw new Exception('Đường dẫn chương trống sau khi chuẩn hóa.');
    }

    $chapter = getStoryData($siteKey, $canonicalPath);
    $paragraphs = chapterParagraphs($chapter['noi_dung']);
    if (!$paragraphs) {
        throw new Exception('Nguồn không trả về nội dung chương hợp lệ.');
    }

    $previousPath = $chapter['path_chuong_truoc'] ?? 'void(0)';
    $nextPath = $chapter['path_chuong_sau'] ?? 'void(0)';

    $suffix = $normalized['mode'] ? '/' . $normalized['mode'] : '';
    $prevOut = ($previousPath !== 'void(0)' && $previousPath !== '') ? $previousPath . $suffix : null;
    $nextOut = ($nextPath !== 'void(0)' && $nextPath !== '') ? $nextPath . $suffix : null;

    return [
        'schemaVersion' => 1,
        'sourceKey' => $siteKey,
        'sourceRevision' => 'v2-continuous',
        'chapterId' => hash('sha256', $siteKey . ':' . $canonicalPath),
        'path' => $canonicalPath,
        'storyTitle' => $chapter['ten_truyen'],
        'chapterTitle' => $chapter['ten_chuong'],
        'paragraphs' => $paragraphs,
        'previousPath' => $prevOut,
        'nextPath' => $nextOut,
        'navigationStatus' => ($nextOut !== null) ? 'has_next' : 'end_of_story',
        'contentHash' => hash('sha256', implode("\n", array_column($paragraphs, 'text'))),
        'warnings' => [],
    ];
}
