<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/includes/parser.php';
require_once dirname(__DIR__) . '/includes/chapter_service.php';

function assertSameValue($expected, $actual, string $message): void {
    if ($expected !== $actual) {
        fwrite(STDERR, "FAIL: {$message}\nExpected: {$expected}\nActual: {$actual}\n");
        exit(1);
    }
}

$normalised = normalizeParagraphs('<p>Mở đầu</p><script>alert(1)</script><p>===== Dấu phân cách hợp lệ</p>');
assertSameValue("<p>Mở đầu</p>\n<p>===== Dấu phân cách hợp lệ</p>\n", $normalised, 'Không được cắt phần truyện sau dấu phân cách.');

$html = '<div id="chapter-c"><p>Đoạn một</p><p>Đoạn hai</p></div><div id="ads-chapter-bottom">ads</div>';
$parsed = parseContentByRegex($html, 'truyenfull', [
    'content' => '#<div[^>]+id=["\']chapter-c["\'][^>]*>(.*?)</div>\\s*<div[^>]+id=["\']ads-chapter-bottom["\']#is',
]);
assertSameValue("<p>Đoạn một</p>\n<p>Đoạn hai</p>\n", $parsed, 'Regex phải trích xuất đúng nội dung chương.');

assertSameValue('truyenfull', sourceConfig('tf')['key'], 'Alias nguồn phải resolve qua registry.');
assertSameValue('Đoạn hai', chapterParagraphs('<p>Đoạn một</p><p>Đoạn hai</p>')[1]['text'], 'Chapter DTO phải giữ đúng thứ tự đoạn.');
try {
    sourceConfig('unknown-source');
    fwrite(STDERR, "FAIL: Registry phải từ chối nguồn không tồn tại.\n");
    exit(1);
} catch (Exception $error) {
    // Expected.
}

echo "parser tests passed\n";
