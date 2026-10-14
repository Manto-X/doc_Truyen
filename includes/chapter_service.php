<?php

require_once __DIR__ . '/parser.php';

function chapterParagraphs(string $contentHtml): array {
    $document = new DOMDocument();
    libxml_use_internal_errors(true);
    $document->loadHTML('<?xml encoding="utf-8" ?>' . $contentHtml);
    libxml_clear_errors();
    $paragraphs = [];
    foreach ($document->getElementsByTagName('p') as $index => $paragraph) {
        $text = trim($paragraph->textContent);
        if ($text !== '') $paragraphs[] = ['id' => 'p' . $index, 'text' => $text];
    }
    return $paragraphs;
}

function chapterDto(string $siteKey, string $path): array {
    $source = sourceConfig($siteKey);
    $siteKey = $source['key'];
    $canonicalPath = trim($path, '/');
    $chapter = getStoryData($siteKey, $canonicalPath);
    $paragraphs = chapterParagraphs($chapter['noi_dung']);
    if (!$paragraphs) throw new Exception('Nguồn không trả về nội dung chương hợp lệ.');
    $previousPath = $chapter['path_chuong_truoc'] ?? 'void(0)';
    $nextPath = $chapter['path_chuong_sau'] ?? 'void(0)';
    return [
        'schemaVersion' => 1,
        'sourceKey' => $siteKey,
        'sourceRevision' => 'legacy-config',
        'chapterId' => hash('sha256', $siteKey . ':' . $canonicalPath),
        'path' => $canonicalPath,
        'storyTitle' => $chapter['ten_truyen'],
        'chapterTitle' => $chapter['ten_chuong'],
        'paragraphs' => $paragraphs,
        'previousPath' => $previousPath !== 'void(0)' ? $previousPath : null,
        'nextPath' => $nextPath !== 'void(0)' ? $nextPath : null,
        'navigationStatus' => 'legacy',
        'contentHash' => hash('sha256', implode("\n", array_column($paragraphs, 'text'))),
        'warnings' => [],
    ];
}
