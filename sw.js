// File: sw.js
'use strict';

const CACHE_VERSION = 'doc-truyen-v2.5.0';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const DATA_CACHE = `${CACHE_VERSION}-chapters`;

const APP_SHELL_ASSETS = [
    './',
    'index.php',
    'manifest.json',
    'templates/js/tts-player.js',
    'templates/css/style.css',
    'assets/icons/icon-192.png',
    'assets/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(SHELL_CACHE).then((cache) => {
            return Promise.allSettled(
                APP_SHELL_ASSETS.map((url) => cache.add(url))
            );
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(
                keys.map((key) => {
                    if (key !== SHELL_CACHE && key !== DATA_CACHE) {
                        return caches.delete(key);
                    }
                    return Promise.resolve();
                })
            );
            await self.clients.claim();
        })()
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // 1. Bypass non-GET requests and external origins
    if (req.method !== 'GET' || url.origin !== self.location.origin) {
        return;
    }

    // 2. CRITICAL: Bypass Service Worker for TTS Audio Stream and HTTP Range requests.
    // Intercepting streaming audio or 206 Partial Content inside SW causes iOS/Android lock-screen freeze.
    if (
        url.pathname.includes('/api/tts.php') ||
        req.headers.has('range') ||
        req.destination === 'audio'
    ) {
        return;
    }

    // 3. Network-First with Offline Cache Fallback for Chapter JSON API & Story HTML views
    if (
        url.pathname.includes('/api/chapter.php') ||
        req.mode === 'navigate' ||
        (req.headers.get('accept') || '').includes('text/html')
    ) {
        event.respondWith(
            (async () => {
                try {
                    const networkResponse = await fetch(req);
                    if (networkResponse && networkResponse.status === 200) {
                        const cache = await caches.open(DATA_CACHE);
                        cache.put(req, networkResponse.clone());
                    }
                    return networkResponse;
                } catch (err) {
                    const cachedResponse = await caches.match(req);
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    const fallbackShell = await caches.match('index.php');
                    if (fallbackShell) {
                        return fallbackShell;
                    }
                    return new Response('Offline - Không có kết nối mạng.', {
                        status: 503,
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                    });
                }
            })()
        );
        return;
    }

    // 4. Stale-While-Revalidate for Static Assets (CSS, JS, Fonts, Icons)
    event.respondWith(
        (async () => {
            const cached = await caches.match(req);
            const networkFetch = fetch(req)
                .then(async (res) => {
                    if (res && res.status === 200) {
                        const cache = await caches.open(SHELL_CACHE);
                        cache.put(req, res.clone());
                    }
                    return res;
                })
                .catch(() => cached);

            return cached || networkFetch;
        })()
    );
});
