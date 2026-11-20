<?php
// File: scripts/generate_pwa_icons.php
declare(strict_types=1);

$targetDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . 'icons';
if (!is_dir($targetDir)) {
    mkdir($targetDir, 0775, true);
}

$specs = [
    'icon-192.png'          => 192,
    'icon-192-maskable.png' => 192,
    'icon-512.png'          => 512,
    'icon-512-maskable.png' => 512,
];

foreach ($specs as $filename => $size) {
    $img = imagecreatetruecolor($size, $size);
    $bg  = imagecolorallocate($img, 17, 24, 39);    // #111827
    $fg  = imagecolorallocate($img, 59, 130, 246);  // #3B82F6
    $txt = imagecolorallocate($img, 249, 250, 251); // #F9FAFB

    imagefilledrectangle($img, 0, 0, $size, $size, $bg);
    $radius = (int)round($size * 0.62);
    imagefilledellipse($img, (int)($size / 2), (int)($size / 2), $radius, $radius, $fg);

    // Draw central play triangle emblem
    $p1x = (int)round($size * 0.40);
    $p1y = (int)round($size * 0.33);
    $p2x = (int)round($size * 0.40);
    $p2y = (int)round($size * 0.67);
    $p3x = (int)round($size * 0.66);
    $p3y = (int)round($size * 0.50);
    imagefilledpolygon($img, [$p1x, $p1y, $p2x, $p2y, $p3x, $p3y], 3, $txt);

    imagepng($img, $targetDir . DIRECTORY_SEPARATOR . $filename, 9);
    imagedestroy($img);
}

echo "PWA icons generated successfully in {$targetDir}\n";
