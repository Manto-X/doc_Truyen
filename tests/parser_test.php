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

// Test normalizeChapterRequestPath (Vá lỗi P0)
$norm1 = normalizeChapterRequestPath('de-ba/chuong-1/auto');
assertSameValue('de-ba/chuong-1', $norm1['cleanPath'], 'normalizeChapterRequestPath phải bóc tách /auto');
assertSameValue('auto', $norm1['mode'], 'normalizeChapterRequestPath mode phải là auto');

$norm2 = normalizeChapterRequestPath('de-ba/chuong-1/+3');
assertSameValue('de-ba/chuong-1', $norm2['cleanPath'], 'normalizeChapterRequestPath phải bóc tách /+N');
assertSameValue(3, $norm2['mergeCount'], 'normalizeChapterRequestPath mergeCount phải là 3');

$norm3 = normalizeChapterRequestPath('de-ba/chuong-1/full');
assertSameValue('de-ba/chuong-1', $norm3['cleanPath'], 'normalizeChapterRequestPath phải bóc tách /full');
assertSameValue('full', $norm3['mode'], 'normalizeChapterRequestPath mode phải là full');

try {
    sourceConfig('unknown-source');
    fwrite(STDERR, "FAIL: Registry phải từ chối nguồn không tồn tại.\n");
    exit(1);
} catch (Exception $error) {
    // Expected.
}

// Test cấu hình và trích xuất nguồn tamlinh (Madara theme)
$tamlinhConfig = sourceConfig('tamlinh')['config'];
assertSameValue('dom', $tamlinhConfig['parse_method'], 'Nguồn tamlinh phải dùng parse_method dom.');

$mockTamlinhHtml = <<<'HTML'
<!DOCTYPE html>
<html>
<body>
<ol class="breadcrumb"><li>Home</li><li>Truyen</li><li><a href="/truyen-mau/">Truyện Mẫu</a></li></ol>
<h1 id="chapter-heading">Chương 1: Khởi Đầu</h1>
<a class="prev_page" href="/truyen-mau/chuong-0/">Prev</a>
<a class="next_page" href="/truyen-mau/chuong-2/">Next</a>
<div class="reading-content">
    <p>Nội dung đoạn một của tâm linh</p>
    <p>Nội dung đoạn hai của tâm linh</p>
</div>
<div class="entry-header footer" id="manga-reading-nav-foot"></div>
</body>
</html>
HTML;

$tlDom = new DOMDocument();
libxml_use_internal_errors(true);
$tlDom->loadHTML('<?xml encoding="utf-8" ?>' . $mockTamlinhHtml);
libxml_clear_errors();
$tlXpath = new DOMXPath($tlDom);

$tlStory = trim($tlXpath->query($tamlinhConfig['selectors']['story_title'])->item(0)->nodeValue ?? '');
$tlChapter = trim($tlXpath->query($tamlinhConfig['selectors']['chapter_title'])->item(0)->nodeValue ?? '');
assertSameValue('Truyện Mẫu', $tlStory, 'XPath story_title tamlinh phải bóc tách đúng.');
assertSameValue('Chương 1: Khởi Đầu', $tlChapter, 'XPath chapter_title tamlinh phải bóc tách đúng.');

$tlParsedDom = parseContentByDOM($mockTamlinhHtml, $tamlinhConfig['selectors'], $tlXpath);
assertSameValue("<p>Nội dung đoạn một của tâm linh</p>\n<p>Nội dung đoạn hai của tâm linh</p>\n", $tlParsedDom, 'DOM parse tamlinh phải bóc tách đúng nội dung.');

$tlParsedRegex = parseContentByRegex($mockTamlinhHtml, 'tamlinh', $tamlinhConfig['regex_patterns']);
assertSameValue("<p>Nội dung đoạn một của tâm linh</p>\n<p>Nội dung đoạn hai của tâm linh</p>\n", $tlParsedRegex, 'Regex parse tamlinh phải bóc tách đúng nội dung fallback.');

echo "All parser and normalization unit tests passed!\n";
