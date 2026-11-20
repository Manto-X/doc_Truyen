<?php
    // Biến $siteKey và $storyData được truyền từ index.php
    $ten_truyen = htmlspecialchars($storyData['ten_truyen'] ?? '');
    $ten_chuong = htmlspecialchars($storyData['ten_chuong'] ?? '');
    $prev_path = (($storyData['path_chuong_truoc'] ?? '') && $storyData['path_chuong_truoc'] !== "void(0)") ? htmlspecialchars($storyData['path_chuong_truoc'], ENT_QUOTES, 'UTF-8') : '';
    $next_path = (($storyData['path_chuong_sau'] ?? '') && $storyData['path_chuong_sau'] !== "void(0)") ? htmlspecialchars($storyData['path_chuong_sau'], ENT_QUOTES, 'UTF-8') : '';
    $next_url = $next_path ? __SITEURL__ . "/{$siteKey}/" . $next_path : '';
?>
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title><?php echo $ten_truyen . ' - ' . $ten_chuong; ?></title>

    <!-- PWA & Mobile Web App Meta Tags -->
    <link rel="manifest" href="<?php echo __SITEURL__;?>/manifest.json">
    <meta name="theme-color" content="#111827">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="Đọc Truyện">
    <link rel="apple-touch-icon" href="<?php echo __SITEURL__;?>/assets/icons/icon-192.png">
    <link rel="icon" type="image/png" sizes="192x192" href="<?php echo __SITEURL__;?>/assets/icons/icon-192.png">

    <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Quicksand">
    <link rel="stylesheet" href="<?php echo __SITEURL__;?>/templates/css/style.css?v=<?php echo filemtime(__DIR__ . '/css/style.css'); ?>">
</head>
<body>

    <header class="story-header">
        <h1><?php echo $ten_truyen; ?></h1>
    </header>

    <nav class="navigation stickybar">
        <div class="nav-links">
            <a href="<?php echo $prev_path? __SITEURL__ . "/{$siteKey}/" . $prev_path : '#'; ?>" class="<?php echo !$prev_path ? 'disabled' : ''; ?>">«<span class="wide"> Trước</span></a>
            <a onclick="toggleTheme()"><?php echo $ten_chuong; ?></a>
            <a href="<?php echo $next_path? __SITEURL__ . "/{$siteKey}/" . $next_path : '#'; ?>" class="<?php echo !$next_path ? 'disabled' : ''; ?>"><span class="wide">Tiếp </span>»</a>
        </div>
        
        <!-- TTS Player Bar INSIDE Nav -->
        <div id="tts-player-bar">
            <button id="tts-play" type="button">▶ <span class="btn-text">Đọc</span></button>
            <button id="tts-pause" type="button" hidden>⏸ <span class="btn-text">Tạm dừng</span></button>
            <button id="tts-stop" type="button">⏹ <span class="btn-text">Dừng</span></button>
            <select id="tts-rate" title="Tốc độ đọc">
                <option value="0.75">0.75x</option>
                <option value="1.0" selected>1.0x (Chuẩn)</option>
                <option value="1.25">1.25x</option>
                <option value="1.5">1.5x</option>
                <option value="2.0">2.0x</option>
            </select>
            <select id="tts-engine-select" title="Nguồn âm thanh" style="margin-left:4px; padding:2px 4px; font-size:12px; border-radius:4px;">
                <option value="stream" selected>Audio Stream (Chạy nền)</option>
                <option value="speech">Giọng máy (WebSpeech)</option>
            </select>
            <span id="tts-status">Sẵn sàng.</span>
        </div>
    </nav>

    <script>
        window.isAutoPlayMode = <?php echo ($isAutoPlay ?? true) ? 'true' : 'false'; ?>;
        window.nextChapterUrl = <?php echo json_encode(($next_path && $next_path !== 'void(0)') ? __SITEURL__ . "/{$siteKey}/" . $next_path : ''); ?>;
        window.readerSourceKey = <?php echo json_encode($siteKey); ?>;
        window.readerApiUrl = <?php echo json_encode(__SITEURL__ . '/api/chapter.php'); ?>;
        window.ttsApiUrl = <?php echo json_encode(__SITEURL__ . '/api/tts.php'); ?>;
        window.storyTitle = <?php echo json_encode($storyData['ten_truyen'] ?? 'Đọc Truyện'); ?>;
        window.chapterTitle = <?php echo json_encode($storyData['ten_chuong'] ?? 'Chương hiện tại'); ?>;
    </script>
    <script src="<?php echo __SITEURL__;?>/templates/js/tts-player.js?v=<?php echo filemtime(__DIR__ . '/js/tts-player.js'); ?>"></script>
    
    <main class="story-content" data-next-url="<?php echo htmlspecialchars($next_url, ENT_QUOTES, 'UTF-8'); ?>">
        <?php echo $storyData['noi_dung'] . "\n"; ?>
    </main>

    <nav class="navigation">
        <div class="nav-links">
            <a href="<?php echo $prev_path? __SITEURL__ . "/{$siteKey}/" . $prev_path : '#'; ?>" class="<?php echo !$prev_path ? 'disabled' : ''; ?>">«<span class="wide"> Trước</span></a>
            <a onclick="toggleTheme()"><?php echo $ten_chuong; ?></a>
            <a href="<?php echo $next_path? __SITEURL__ . "/{$siteKey}/" . $next_path : '#'; ?>" class="<?php echo !$next_path ? 'disabled' : ''; ?>"><span class="wide">Tiếp </span>»</a>
        </div>
    </nav>
    <span>&nbsp;</span>
    
    <!-- TTS Floating Player for Mobile -->
    <div id="tts-floating-player" aria-label="Trình đọc truyện">
        <button id="tts-float-playpause" class="ripple" type="button" aria-label="Đọc hoặc tạm dừng">
            <svg id="icon-play" viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            <svg id="icon-pause" viewBox="0 0 24 24" width="28" height="28" fill="currentColor" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            <svg id="icon-done" viewBox="0 0 24 24" width="28" height="28" fill="currentColor" style="display:none;"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
        </button>
        <div id="tts-float-nav">
            <button id="tts-float-prev" class="tts-float-btn ripple" type="button">Lên</button>
            <button id="tts-float-next" class="tts-float-btn ripple" type="button">Xuống</button>
        </div>
    </div>

    <script src="<?php echo __SITEURL__;?>/templates/js/dark-mode.js"></script>
    <script src="<?php echo __SITEURL__;?>/templates/js/sticky-menu.js"></script>

    <!-- PWA Service Worker Registration -->
    <script>
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', function () {
                navigator.serviceWorker.register('<?php echo __SITEURL__;?>/sw.js')
                    .then(function (reg) {
                        reg.update();
                    })
                    .catch(function (err) {
                        console.warn('[PWA] Service Worker registration failed:', err);
                    });
            });
        }
    </script>
</body>
</html>
