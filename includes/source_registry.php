<?php

function loadSourceRegistry(): array {
    $configFile = dirname(__DIR__) . '/config/config.json';
    $raw = is_file($configFile) ? file_get_contents($configFile) : false;
    $config = $raw === false ? null : json_decode($raw, true);
    if (!is_array($config) || !is_array($config['sites'] ?? null)) {
        throw new Exception('Cấu hình nguồn không hợp lệ.');
    }
    return $config;
}

function resolveSourceKey(string $sourceKey, array $registry): string {
    $sourceKey = strtolower(trim($sourceKey));
    $aliases = ['tf' => 'truyenfull'];
    foreach ($registry['sites'] as $key => $source) {
        foreach (($source['aliases'] ?? []) as $alias) {
            $aliases[strtolower((string)$alias)] = $key;
        }
    }
    $sourceKey = $aliases[$sourceKey] ?? $sourceKey;
    if (!isset($registry['sites'][$sourceKey])) {
        throw new Exception("Không tìm thấy cấu hình cho site '{$sourceKey}'.");
    }
    return $sourceKey;
}

function sourceConfig(string $sourceKey): array {
    $registry = loadSourceRegistry();
    $key = resolveSourceKey($sourceKey, $registry);
    return ['key' => $key, 'config' => $registry['sites'][$key]];
}
