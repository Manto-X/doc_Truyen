/**
 * doc_Truyen All-in-One Cloudflare Worker
 * Fully self-contained Serverless Reader + Edge Parser + TTS Audio Streaming
 * Zero servers needed. 100% Free on Cloudflare Workers.
 */

// --- 1. CONFIGURATION & SELECTORS ---
const SITES_CONFIG = {
  tamlinh: {
    domain: "tamlinh247.biz",
    selectors: {
      story_title: "//ol[contains(@class, 'breadcrumb')]/li[3]/a",
      chapter_title: "//h1[@id='chapter-heading']",
      content_div: "reading-content",
      prev_class: "prev_page",
      next_class: "next_page"
    }
  },
  truyenfull: {
    domain: "truyenfull.vision",
    aliases: ["tf"],
    selectors: {
      story_title: "truyen-title",
      chapter_title: "chapter-title",
      content_div: "chapter-c"
    }
  },
  truyenchu: {
    domain: "truyenchu.net",
    aliases: ["truyenchu", "tc"],
    pathPrefix: "truyen",
    selectors: {
      story_title: "breadcrumb li[2]",
      chapter_title: "breadcrumb li[3]",
      content_div: "reading-content",
      prev_class: "prev_page",
      next_class: "next_page"
    }
  }
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Endpoint 1: Health check
    if (url.pathname === '/health' || url.pathname === '/ping') {
      return jsonResponse({ status: 'ok', service: 'doc_truyen_all_in_one' });
    }

    // Endpoint 2: TTS Proxy Audio Streaming (supports /api/tts or /ai/read/api/tts)
    if (url.pathname === '/api/tts' || url.pathname.endsWith('/api/tts')) {
      return handleTtsRequest(url);
    }

    // Endpoint 3: Legacy Forward Proxy Bridge (compatible with previous token auth)
    if (url.pathname === '/bridge.php' || url.pathname.endsWith('/bridge.php')) {
      return handleLegacyBridge(request, url, env);
    }

    // Endpoint 4: API Chapter JSON
    if (url.pathname === '/api/chapter' || url.pathname.endsWith('/api/chapter')) {
      return handleChapterApi(url);
    }

    // Endpoint 5: Reader Web UI (Home or Chapter Reader)
    return handleReaderUi(url);
  }
};

// --- HELPER: JSON Response ---
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// --- MODULE 1: TTS AUDIO STREAMING ---
async function handleTtsRequest(url) {
  const text = (url.searchParams.get('text') || url.searchParams.get('q') || '').trim();
  const speed = parseFloat(url.searchParams.get('speed') || '1.0');
  const lang = (url.searchParams.get('lang') || 'vi').replace(/[^a-zA-Z-]/g, '');

  if (!text) {
    return jsonResponse({ error: 'EMPTY_TEXT' }, 400);
  }

  // Truncate to safe length
  const cleanText = text.replace(/\s+/g, ' ').substring(0, 500);
  const slowFlag = speed < 0.85 ? '1' : '0';

  const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&ttsspeed=${slowFlag}&q=${encodeURIComponent(cleanText)}`;

  try {
    const ttsResp = await fetch(ttsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Referer': 'https://translate.google.com/'
      }
    });

    if (!ttsResp.ok) {
      return jsonResponse({ error: 'TTS_UPSTREAM_ERROR', status: ttsResp.status }, 502);
    }

    const audioBuffer = await ttsResp.arrayBuffer();

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBuffer.byteLength),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return jsonResponse({ error: 'TTS_FETCH_FAILED', message: err.message }, 502);
  }
}

// --- MODULE 2: LEGACY BRIDGE ---
async function handleLegacyBridge(request, url, env) {
  const expectedToken = env.READER_BRIDGE_TOKEN;
  const clientToken = request.headers.get('X-Bridge-Token') || url.searchParams.get('token');

  if (expectedToken && clientToken !== expectedToken) {
    return jsonResponse({ error: 'Forbidden', message: 'Invalid or missing authentication token.' }, 403);
  }

  const targetUrlStr = url.searchParams.get('url');
  if (!targetUrlStr) {
    return jsonResponse({ error: 'Bad Request', message: 'Missing target URL parameter.' }, 400);
  }

  try {
    const targetUrl = new URL(targetUrlStr);
    const resp = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi,vi-VN;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    return new Response(resp.body, {
      status: resp.status,
      headers: {
        'Content-Type': resp.headers.get('Content-Type') || 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return jsonResponse({ error: 'Fetch failed', message: err.message }, 502);
  }
}

// --- MODULE 3: CHAPTER DATA PARSER ---
async function parseChapter(siteKey, rawPath) {
  siteKey = (siteKey || 'tf').toLowerCase().trim();
  if (siteKey === 'tf') siteKey = 'truyenfull';
  if (siteKey === 'tc') siteKey = 'truyenchu';
  if (siteKey === 'tl') siteKey = 'tamlinh';

  // Normalize path & parse mode (auto, +N)
  let path = rawPath.replace(/^\/+|\/+$/g, '');
  let isAutoPlay = false;
  let mergeCount = 0;

  if (path.endsWith('/auto')) {
    path = path.slice(0, -5);
    isAutoPlay = true;
  } else if (path.endsWith('/full')) {
    path = path.slice(0, -5);
    isAutoPlay = true;
  } else {
    const mMatch = path.match(/\/(\+\d+)$/);
    if (mMatch) {
      mergeCount = parseInt(mMatch[1].slice(1), 10);
      path = path.slice(0, -mMatch[0].length);
    }
  }

  const siteCfg = SITES_CONFIG[siteKey] || SITES_CONFIG.truyenfull;
  const domain = siteCfg.domain;
  const targetUrl = siteCfg.pathPrefix ? `https://${domain}/${siteCfg.pathPrefix}/${path}/` : `https://${domain}/${path}/`;

  const resp = await fetch(targetUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'vi,vi-VN;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  });

  if (!resp.ok) {
    throw new Error(`Nguồn trả về mã lỗi HTTP ${resp.status}`);
  }

  const html = await resp.text();

  let storyTitle = '';
  let chapterTitle = '';
  let prevUrl = '';
  let nextUrl = '';
  let rawContent = '';

  if (siteKey === 'tamlinh' || siteKey === 'truyenchu') {
    // 1. Story Title from breadcrumb (tamlinh: li[3]; truyenchu: li[2], chapter title in li[3])
    const bcMatch = html.match(/class=["'][^"']*breadcrumb[^"']*["'][\s\S]*?<\/ol>/i);
    if (bcMatch) {
      const liMatches = [...bcMatch[0].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
      const storyIdx = siteKey === 'truyenchu' ? 1 : 2;
      if (liMatches.length > storyIdx) {
        storyTitle = liMatches[storyIdx][1].replace(/<[^>]+>/g, '').trim();
      }
      if (siteKey === 'truyenchu' && liMatches.length >= 3) {
        chapterTitle = liMatches[liMatches.length - 1][1].replace(/<[^>]+>/g, '').trim();
      }
    }
    if (!storyTitle) {
      const h1M = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      storyTitle = h1M ? h1M[1].replace(/<[^>]+>/g, '').trim() : 'Truyện Tâm Linh';
    }

    // 2. Chapter Title from h1#chapter-heading (fallback if breadcrumb gave none)
    if (!chapterTitle) {
      const chMatch = html.match(/<h1[^>]+id=["']chapter-heading["'][^>]*>([\s\S]*?)<\/h1>/i);
      chapterTitle = chMatch ? chMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      if (siteKey === 'truyenchu' && storyTitle && chapterTitle.startsWith(storyTitle + ' - ')) {
        chapterTitle = chapterTitle.slice(storyTitle.length + 3);
      }
    }

    // 3. Navigation Prev / Next
    const prevRaw = extractAnchorHrefByClass(html, 'prev_page');
    if (prevRaw) prevUrl = cleanChapterPath(prevRaw, domain);

    const nextRaw = extractAnchorHrefByClass(html, 'next_page');
    if (nextRaw) nextUrl = cleanChapterPath(nextRaw, domain);

    // truyenchu source paths carry a "truyen/" prefix that Worker paths do not
    if (siteKey === 'truyenchu') {
      prevUrl = prevUrl.replace(/^truyen\//, '');
      nextUrl = nextUrl.replace(/^truyen\//, '');
    }

    // 4. Content from .reading-content (exclude reading-content-wrap)
    const cMatch = html.match(/<div[^>]+class=["'][^"']*\breading-content\b(?!\-wrap)[^"']*["'][^>]*>([\s\S]*?)(?:<div[^>]+id=["']manga-reading-nav-foot["']|<div[^>]+class=["'][^"']*(?:entry-header footer|footer)[^"']*["'])/i);
    rawContent = cMatch ? cMatch[1] : '';
  } else {
    // Truyenfull
    const stM = html.match(/<a[^>]+class=["']truyen-title["'][^>]*>([\s\S]*?)<\/a>/i);
    storyTitle = stM ? stM[1].replace(/<[^>]+>/g, '').trim() : 'Truyện Full';

    const chM = html.match(/<a[^>]+class=["']chapter-title["'][^>]*>([\s\S]*?)<\/a>/i);
    chapterTitle = chM ? chM[1].replace(/<[^>]+>/g, '').trim() : '';

    const navMatches = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    for (const nm of navMatches) {
      const text = nm[2].replace(/<[^>]+>/g, '').toLowerCase();
      if (text.includes('trước') && !prevUrl) prevUrl = cleanChapterPath(nm[1], domain);
      if (text.includes('tiếp') && !nextUrl) nextUrl = cleanChapterPath(nm[1], domain);
    }

    const cM = html.match(/<div[^>]+id=["']chapter-c["'][^>]*>([\s\S]*?)<\/div>\s*<div[^>]+id=["']ads-chapter/i);
    rawContent = cM ? cM[1] : '';
  }

  // Normalize paragraphs
  const paragraphs = normalizeParagraphsToText(rawContent);
  const formattedHtml = paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('\n');

  if (isAutoPlay) {
    if (prevUrl) prevUrl += '/auto';
    if (nextUrl) nextUrl += '/auto';
  }

  return {
    siteKey,
    cleanPath: path,
    isAutoPlay,
    ten_truyen: storyTitle || 'Đọc Truyện',
    ten_chuong: chapterTitle || 'Chương hiện tại',
    path_chuong_truoc: prevUrl,
    path_chuong_sau: nextUrl,
    paragraphs,
    noi_dung: formattedHtml
  };
}

function extractAnchorHrefByClass(html, className) {
  const aTags = [...html.matchAll(/<a\b([^>]*)>/gi)];
  for (const tag of aTags) {
    const attrs = tag[1];
    const classM = attrs.match(/\bclass=["']([^"']+)["']/i);
    if (classM && classM[1].split(/\s+/).includes(className)) {
      const hrefM = attrs.match(/\bhref=["']([^"']+)["']/i);
      if (hrefM) return hrefM[1];
    }
  }
  return '';
}

function cleanChapterPath(href, domain) {
  if (!href || href === '#' || href.startsWith('javascript:')) return '';
  try {
    const u = new URL(href, `https://${domain}`);
    return u.pathname.replace(/^\/+|\/+$/g, '');
  } catch {
    return href.replace(/^\/+|\/+$/g, '');
  }
}

function normalizeParagraphsToText(rawHtml) {
  let text = rawHtml
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<div[^>]+id=["']ads-[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<\/p[^>]*>/gi, '__PARA_BREAK__')
    .replace(/<br\s*\/?>/gi, '__PARA_BREAK__')
    .replace(/<[^>]+>/g, '')
    .replace(/\{"(?:iv|mac|value)":.*?\}/gs, '')
    .replace(/[a-zA-Z0-9+\/\\=]{100,}/gs, '');

  // Decode HTML entities (WordPress sources like truyenchu emit numeric entities)
  text = text
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch { return ''; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ''; } })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&hellip;/gi, '…')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&rsquo;/gi, '’')
    .replace(/&ldquo;/gi, '“')
    .replace(/&rdquo;/gi, '”')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');

  const junk = [
    "Bạn đang đọc truyện mới tại truyen tamlinh247 com.vn",
    "Bên khác copy sẽ thiếu nội dung"
  ];
  for (const j of junk) {
    text = text.replaceAll(j, '');
  }

  return text
    .split('__PARA_BREAK__')
    .map(p => p.trim())
    .filter(p => p.length > 0 && !p.startsWith('__PARA'));
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- MODULE 4: CHAPTER API HANDLER ---
async function handleChapterApi(url) {
  const site = url.searchParams.get('s') || 'tamlinh';
  const path = url.searchParams.get('p') || '';
  if (!path) return jsonResponse({ error: 'MISSING_PATH' }, 400);

  try {
    const data = await parseChapter(site, path);
    return jsonResponse(data);
  } catch (err) {
    return jsonResponse({ error: 'PARSE_FAILED', message: err.message }, 502);
  }
}

// --- MODULE 5: READER UI RENDERER ---
async function handleReaderUi(url) {
  let site = url.searchParams.get('s');
  let path = url.searchParams.get('p');

  // Support clean RESTful paths (e.g. /tamlinh/story/chapter/auto or /ai/read/...)
  if (!site || !path) {
    let cleanPath = url.pathname.replace(/^\/+|\/+$/g, '');
    if (cleanPath.startsWith('ai/read/')) {
      cleanPath = cleanPath.slice(8);
    }
    const parts = cleanPath.split('/');
    if (parts.length >= 2) {
      const candidate = parts[0].toLowerCase();
      if (['tamlinh', 'truyenfull', 'truyenchu', 'tf', 'tl', 'tc'].includes(candidate)) {
        site = candidate === 'tl' ? 'tamlinh' : (candidate === 'tc' ? 'truyenchu' : candidate);
        path = parts.slice(1).join('/');
      }
    }
  }

  if (!site || !path) {
    return new Response(renderHomePageHtml(url), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  try {
    const data = await parseChapter(site, path);
    return new Response(renderReaderHtml(data, url), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  } catch (err) {
    return new Response(renderErrorHtml(err.message, site, path), {
      status: 502,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

// --- UI TEMPLATES ---
function renderHomePageHtml(url) {
  const base = url.origin;
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trình Đọc Truyện Serverless</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Quicksand">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Quicksand, "Segoe UI", sans-serif; background: #fefae0; color: #2b2b2b; padding: 30px 16px; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .card { background: #faedcd; border: 1px solid #d4a373; border-radius: 12px; padding: 28px 24px; max-width: 540px; width: 100%; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
    h1 { font-size: 24px; color: #5c3d1e; margin-bottom: 8px; text-align: center; }
    p.sub { color: #7f5539; font-size: 14px; text-align: center; margin-bottom: 20px; }
    .sample-list { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; }
    .sample-btn { display: block; text-decoration: none; background: #e9cfaa; border: 1px solid #d4a373; color: #333; padding: 12px 14px; border-radius: 8px; font-weight: 600; font-size: 14px; transition: 0.2s; text-align: center; }
    .sample-btn:hover { background: #d4a373; color: #000; }
    .footer { margin-top: 24px; font-size: 13px; color: #7f5539; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🎧 Đọc & Nghe Truyện Serverless</h1>
    <p class="sub">Vận hành 100% trên Cloudflare Edge · 0 Máy chủ · Nghe audio nền liên tục</p>
    
    <!-- Input Box nạp link truyện -->
    <form id="open-form" onsubmit="handleOpenStory(event)" style="margin-bottom: 16px;">
      <div style="display: flex; flex-direction: column; gap: 8px;">
        <input 
          id="story-input" 
          type="text" 
          placeholder="Dán link truyện/chương (tamlinh247, truyenchu hoặc truyenfull)..." 
          style="width: 100%; padding: 12px 14px; border: 1px solid #d4a373; border-radius: 8px; font-family: inherit; font-size: 14px; background: #fff; color: #333; outline: none;"
          required
        />
        <button 
          type="submit" 
          style="background: #d4a373; border: 1px solid #b88656; color: #2b2b2b; padding: 12px; border-radius: 8px; font-family: inherit; font-weight: bold; font-size: 15px; cursor: pointer; transition: 0.2s;"
        >
          ▶ Nạp & Đọc ngay
        </button>
      </div>
    </form>

    <div style="font-size: 13px; font-weight: bold; color: #5c3d1e; margin-bottom: 6px;">Truyện chọn nhanh:</div>
    <div class="sample-list">
      <a class="sample-btn" href="${base}/tamlinh/cao-thu-ha-son-ta-la-tien-nhan-ly-duc-than-full/chuong-1/auto">
        ⚡ Cao Thủ Hạ Sơn, Ta Là Tiên Nhân (Lý Dục Thần - Chương 1)
      </a>
      <a class="sample-btn" href="${base}/tamlinh/cuong-long-xuat-the-diep-huyen-full/chuong-302/auto">
        📖 Cuồng Long Xuất Thế (Chương 302 - Tâm Linh)
      </a>
      <a class="sample-btn" href="${base}/truyenchu/de-ba/chuong-1/auto">
        📖 Đế Bá (Chương 1 - Truyện Chữ)
      </a>
    </div>
    <div class="footer">Cloudflare Worker All-in-One Engine · doc_Truyen</div>
  </div>

  <script>
    function handleOpenStory(e) {
      e.preventDefault();
      const raw = document.getElementById('story-input').value.trim();
      if (!raw) return;

      let site = 'tamlinh';
      let path = raw;

      try {
        if (raw.startsWith('http://') || raw.startsWith('https://')) {
          const u = new URL(raw);
          if (u.hostname.includes('truyenfull')) {
            site = 'tf';
          } else if (u.hostname.includes('truyenchu')) {
            site = 'truyenchu';
          } else {
            site = 'tamlinh';
          }
          path = u.pathname.replace(/^\\/+|\\/+$/g, '');
        } else {
          path = raw.replace(/^\\/+|\\/+$/g, '');
        }
      } catch (_) {
        path = raw.replace(/^\\/+|\\/+$/g, '');
      }

      if ((site === 'truyenchu' || site === 'tc') && path.startsWith('truyen/')) {
        path = path.slice('truyen/'.length);
      }

      if (!path.endsWith('/auto')) {
        path += '/auto';
      }

      window.location.href = '${base}/' + site + '/' + path;
    }
  </script>
</body>
</html>`;
}

function renderErrorHtml(error, site, path) {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>Lỗi tải chương</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Quicksand">
  <style>body{background:#fefae0;color:#842029;font-family:Quicksand,sans-serif;padding:40px 20px;text-align:center;}a{color:#5c3d1e;font-weight:bold;}</style>
</head>
<body>
  <h2>Không thể tải nội dung chương</h2>
  <p style="margin: 15px 0;">${escapeHtml(error)}</p>
  <p><small style="color: #666;">Site: ${escapeHtml(site)} | Path: ${escapeHtml(path)}</small></p>
  <p style="margin-top: 20px;"><a href="javascript:history.back()">« Quay lại</a></p>
</body>
</html>`;
}

function renderReaderHtml(data, url) {
  const base = url.origin;
  const isAiRead = url.pathname.includes('/ai/read');
  const isQueryStyle = url.searchParams.has('s');
  const prefix = isAiRead ? `${base}/ai/read/` : `${base}/`;
  const prevHref = data.path_chuong_truoc ? (isQueryStyle ? `${base}/?s=${data.siteKey}&p=${data.path_chuong_truoc}` : `${prefix}${data.siteKey}/${data.path_chuong_truoc}`) : '#';
  const nextHref = data.path_chuong_sau ? (isQueryStyle ? `${base}/?s=${data.siteKey}&p=${data.path_chuong_sau}` : `${prefix}${data.siteKey}/${data.path_chuong_sau}`) : '#';
  const ttsEndpoint = isAiRead ? `${base}/ai/read/api/tts` : `${base}/api/tts`;

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${escapeHtml(data.ten_truyen)} - ${escapeHtml(data.ten_chuong)}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Quicksand">
  <style>
    /* doc_Truyen signature theme - vàng nâu / sepia */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      background: #fefae0;
      transition: background-color 0.4s ease, color 0.4s ease;
      font-family: Quicksand, "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      font-size: calc(17px + 0.3vw);
      line-height: 1.5;
      margin: 0 auto;
      padding: 0 10px 1.5em;
      max-width: 860px;
      color: #2b2b2b;
    }

    p {
      margin: 0.8em 0 1.2em;
      text-align: justify;
    }

    hr {
      margin: 0.5em;
      border: none;
      color: transparent;
      background-color: transparent;
    }

    .story-header h1 {
      font-size: clamp(13px, 3.8vw, 16px);
      font-weight: 700;
      line-height: 1.3;
      margin: 10px 0 6px;
      text-align: left;
      color: #5c3d1e;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 0;
      max-width: 100%;
    }

    /* Main Navigation Container */
    .navigation {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      margin: 8px 0;
    }

    .nav-links {
      display: flex;
      width: 100%;
      justify-content: space-between;
      flex-wrap: nowrap;
    }

    .navigation a {
      font-size: calc(14px + 0.4vw);
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      text-decoration: none;
      padding: 6px 14px 8px;
      transition: padding 0.4s ease-in-out, line-height 0.4s ease-in-out;
      background-color: #e9cfaa;
      border: solid 1px #d4a373;
      color: #333;
      cursor: pointer;
      white-space: nowrap;
      font-weight: 600;
    }

    .nav-links a:nth-child(2) {
      flex-grow: 1;
      margin: 0 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
      text-align: center;
      padding-top: 6px;
    }

    .navigation a:hover {
      background-color: #d4a373;
    }

    .navigation a.disabled {
      pointer-events: none;
      background-color: #d4a373;
      color: #a17040;
      cursor: not-allowed;
      opacity: 0.5;
    }

    .stickybar {
      position: sticky;
      top: 0;
      z-index: 999;
      width: 100%;
      transition: padding 0.3s ease, line-height 0.3s ease, font-size 0.3s ease;
    }

    .story-content {
      text-align: left;
      margin: 15px 0 25px;
    }

    .story-content i {
      color: #666;
    }

    /* Dark Mode */
    body.dark {
      background: #0b090a;
      color: #e5e5e5;
    }

    body.dark .story-header h1 {
      color: #f1a966;
    }

    body.dark .navigation a {
      background-color: #432818;
      color: #ddd;
      border: solid 1px #99582a;
    }

    body.dark .navigation a:hover {
      background: #59341d;
    }

    body.dark .navigation a.disabled {
      pointer-events: none;
      background-color: #271911;
      color: #555;
      cursor: not-allowed;
    }

    body.dark .story-content i {
      color: #999;
    }

    /* TTS Player Bar */
    #tts-player-bar {
      width: 100%;
      flex-basis: 100%;
      order: 10;
      background-color: #dcb386;
      border: 1px solid #c99f70;
      border-top: none;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 6px;
      padding: 5px 8px;
      font-family: "Quicksand", sans-serif;
      transition: background-color 0.4s ease, color 0.4s ease;
    }

    body.dark #tts-player-bar {
      background-color: #2e1b10;
      border-color: #59341d;
      color: #ddd;
    }

    #tts-player-bar button {
      padding: 4px 10px;
      cursor: pointer;
      border: none;
      border-radius: 4px;
      background-color: #d4a373;
      color: #333;
      font-size: 13px;
      font-weight: bold;
    }

    body.dark #tts-player-bar button {
      background-color: #432818;
      color: #ddd;
    }

    #tts-player-bar button:hover {
      background-color: #c38e5d;
    }

    body.dark #tts-player-bar button:hover {
      background-color: #b06d3b;
    }

    #tts-player-bar select {
      background-color: #d4a373;
      padding: 3px 6px;
      border: 1px solid #b88656;
      border-radius: 4px;
      font-size: 13px;
      font-family: inherit;
      font-weight: 600;
      color: #333;
    }

    body.dark #tts-player-bar select {
      background-color: #432818;
      color: #ddd;
      border-color: #66391d;
    }

    #tts-status {
      font-size: 0.85em;
      font-style: italic;
      margin: 0 5px;
      white-space: nowrap;
      text-overflow: ellipsis;
      max-width: 260px;
      overflow: hidden;
    }

    /* Paragraph Highlighting during TTS */
    .tts-speaking {
      background-color: #ffeeba !important;
      color: #000 !important;
      border-radius: 4px;
      box-shadow: 0 0 6px rgba(212, 163, 115, 0.7);
      transition: background-color 0.3s ease;
      padding: 2px 4px;
      cursor: pointer;
    }

    body.dark .tts-speaking {
      background-color: #594a2a !important;
      color: #fff !important;
      box-shadow: 0 0 6px rgba(200, 150, 50, 0.4);
    }

    .story-content p {
      cursor: pointer;
      border-radius: 4px;
      transition: background-color 0.2s;
    }

    .story-content p:hover {
      background-color: rgba(212, 163, 115, 0.15);
    }

    /* Mobile Overrides */
    @media (max-width: 768px) {
      .navigation a {
        padding: 5px 8px;
        font-size: 13px;
      }
      .nav-links a:nth-child(2) {
        font-size: 13px;
        padding: 5px 4px;
      }
      #tts-player-bar {
        display: none !important;
      }
      #tts-floating-player {
        display: flex !important;
      }
    }

    /* Floating Player for Mobile */
    #tts-floating-player {
      display: none;
      position: fixed;
      bottom: 25vh;
      left: 15px;
      width: 150px;
      height: 66px;
      background-color: #d1b18a;
      border: 2px solid #a67c52;
      border-radius: 28px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      z-index: 9999;
      overflow: hidden;
      opacity: 0.85;
      transition: opacity 0.5s ease-in-out, width 0.3s ease, height 0.3s ease;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      cursor: pointer;
    }

    body.dark #tts-floating-player {
      background-color: #432818;
      border-color: #e08b4a;
    }

    #tts-floating-player:not(.active) {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      opacity: 0.65;
    }

    #tts-floating-player:not(.active) svg {
      width: 22px !important;
      height: 22px !important;
    }

    #tts-float-playpause {
      width: 45%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      border-right: 1px solid #d4a373;
      color: #4a2c11;
      cursor: pointer;
      border-top: 0;
      border-left: 0;
      border-bottom: 0;
      background: transparent;
    }

    body.dark #tts-float-playpause {
      border-right-color: #99582a;
      color: #fbd6b1;
    }

    #tts-floating-player:not(.active) #tts-float-playpause {
      width: 100%;
      border-right-color: transparent;
    }

    #tts-float-nav {
      width: 55%;
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    #tts-floating-player:not(.active) #tts-float-nav {
      width: 0%;
      opacity: 0;
      pointer-events: none;
      overflow: hidden;
    }

    .tts-float-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      padding-left: 10px;
      font-size: 14px;
      font-weight: bold;
      color: #4a2c11;
      cursor: pointer;
      border: 0;
      background: transparent;
    }

    body.dark .tts-float-btn {
      color: #fbd6b1;
    }

    #tts-float-prev {
      border-bottom: 1px solid #d4a373;
    }

    #tts-float-next {
      border-bottom: 1px solid #d4a373;
    }

    body.dark #tts-float-next {
      border-bottom-color: #99582a;
    }

    body.dark #tts-float-prev {
      border-bottom-color: #99582a;
    }

    .ripple {
      transition: background-color 0.1s ease;
    }
    .ripple:active {
      background-color: rgba(0, 0, 0, 0.15);
    }
    body.dark .ripple:active {
      background-color: rgba(255, 255, 255, 0.15);
    }
  </style>
</head>
<body>

  <header class="story-header">
    <h1>${escapeHtml(data.ten_truyen)}</h1>
  </header>

  <nav class="navigation stickybar">
    <div class="nav-links">
      <a href="${prevHref}" class="${!data.path_chuong_truoc ? 'disabled' : ''}">« Trước</a>
      <a onclick="toggleTheme()" title="Bấm để đổi chế độ Sáng / Tối">${escapeHtml(data.ten_chuong)}</a>
      <a href="${nextHref}" class="${!data.path_chuong_sau ? 'disabled' : ''}">Tiếp »</a>
    </div>
    
    <!-- TTS Player Bar INSIDE Nav -->
    <div id="tts-player-bar">
      <button id="tts-play" type="button">▶ <span class="btn-text">Đọc</span></button>
      <button id="tts-pause" type="button" style="display:none;">⏸ <span class="btn-text">Tạm dừng</span></button>
      <button id="tts-stop" type="button">⏹ <span class="btn-text">Dừng</span></button>
      <select id="tts-rate" title="Tốc độ đọc">
        <option value="0.75">0.75x</option>
        <option value="1.0">1.0x</option>
        <option value="1.25" selected>1.25x (Mặc định)</option>
        <option value="1.5">1.5x</option>
        <option value="2.0">2.0x</option>
      </select>
      <span id="tts-status">Sẵn sàng đọc.</span>
    </div>
  </nav>

  <main class="story-content" id="story-content">
    ${data.noi_dung}
  </main>

  <nav class="navigation">
    <div class="nav-links">
      <a href="${prevHref}" class="${!data.path_chuong_truoc ? 'disabled' : ''}">« Trước</a>
      <a onclick="toggleTheme()" title="Bấm để đổi chế độ Sáng / Tối">${escapeHtml(data.ten_chuong)}</a>
      <a href="${nextHref}" class="${!data.path_chuong_sau ? 'disabled' : ''}">Tiếp »</a>
    </div>
  </nav>
  <span>&nbsp;</span>

  <!-- TTS Floating Player for Mobile -->
  <div id="tts-floating-player" aria-label="Trình đọc truyện">
    <button id="tts-float-playpause" class="ripple" type="button" aria-label="Đọc hoặc tạm dừng">
      <svg id="icon-play" viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      <svg id="icon-pause" viewBox="0 0 24 24" width="28" height="28" fill="currentColor" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
    </button>
    <div id="tts-float-nav">
      <button id="tts-float-prev" class="tts-float-btn ripple" type="button">Lên</button>
      <button id="tts-float-next" class="tts-float-btn ripple" type="button">Xuống</button>
      <button id="tts-float-speed" class="tts-float-btn ripple" type="button">1.25x</button>
    </div>
  </div>

  <audio id="audio-engine" preload="auto" playsinline webkit-playsinline style="display:none;"></audio>

  <script>
    // Theme Management
    if (localStorage.getItem('theme') === 'dark') {
      document.body.classList.add('dark');
    }
    function toggleTheme() {
      document.body.classList.toggle('dark');
      localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
    }

    // Audio & Reader Controller
    const nextChapterUrl = "${nextHref !== '#' ? nextHref : ''}";
    const storyTitle = "${escapeHtml(data.ten_truyen)}";
    const chapterTitle = "${escapeHtml(data.ten_chuong)}";
    let isPlaying = false;
    let currentIndex = 0;
    let paragraphs = [];
    const blobCache = new Map();
    let currentSessionToken = 0;

    const audio = document.getElementById('audio-engine');
    if (audio) audio.playsInline = true;

    const btnPlay = document.getElementById('tts-play');
    const btnPause = document.getElementById('tts-pause');
    const btnStop = document.getElementById('tts-stop');
    const rateSelect = document.getElementById('tts-rate');
    const statusText = document.getElementById('tts-status');

    // Mobile float elements
    const floatPlayer = document.getElementById('tts-floating-player');
    const floatPlayPause = document.getElementById('tts-float-playpause');
    const iconPlay = document.getElementById('icon-play');
    const iconPause = document.getElementById('icon-pause');
    const floatPrev = document.getElementById('tts-float-prev');
    const floatNext = document.getElementById('tts-float-next');
    const floatSpeed = document.getElementById('tts-float-speed');

    document.addEventListener('DOMContentLoaded', () => {
      const pNodes = document.querySelectorAll('#story-content p');
      paragraphs = Array.from(pNodes);
      paragraphs.forEach((p, idx) => {
        p.addEventListener('click', () => {
          currentIndex = idx;
          startPlayback();
        });
      });

      // Desktop controls
      if (btnPlay) btnPlay.addEventListener('click', () => startPlayback());
      if (btnPause) btnPause.addEventListener('click', () => pausePlayback());
      if (btnStop) btnStop.addEventListener('click', () => stopPlayback());
      if (rateSelect) rateSelect.addEventListener('change', () => {
        if (floatSpeed) floatSpeed.textContent = rateSelect.value + 'x';
        if (isPlaying) playCurrentParagraph();
      });

      // Mobile float controls
      if (floatPlayPause) {
        floatPlayPause.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isPlaying) {
            pausePlayback();
          } else {
            startPlayback();
          }
        });
      }
      if (floatPrev) {
        floatPrev.addEventListener('click', (e) => {
          e.stopPropagation();
          if (currentIndex > 0) {
            currentIndex--;
            playCurrentParagraph();
          }
        });
      }
      if (floatNext) {
        floatNext.addEventListener('click', (e) => {
          e.stopPropagation();
          if (currentIndex < paragraphs.length - 1) {
            currentIndex++;
            playCurrentParagraph();
          }
        });
      }
      if (floatSpeed) {
        const RATE_STEPS = ['0.75', '1.0', '1.25', '1.5', '2.0'];
        floatSpeed.addEventListener('click', (e) => {
          e.stopPropagation();
          const cur = rateSelect ? rateSelect.value : '1.25';
          const idx = RATE_STEPS.indexOf(cur);
          const next = RATE_STEPS[(idx + 1) % RATE_STEPS.length];
          if (rateSelect) {
            rateSelect.value = next;
            rateSelect.dispatchEvent(new Event('change'));
          } else {
            floatSpeed.textContent = next + 'x';
          }
        });
      }
      if (floatPlayer) {
        floatPlayer.addEventListener('click', () => {
          floatPlayer.classList.toggle('active');
        });
      }

      // MediaSession for background audio & lock screen
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: chapterTitle,
          artist: storyTitle,
          album: 'doc_Truyen'
        });
        navigator.mediaSession.setActionHandler('play', () => startPlayback());
        navigator.mediaSession.setActionHandler('pause', () => pausePlayback());
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          if (currentIndex < paragraphs.length - 1) {
            currentIndex++;
            playCurrentParagraph();
          }
        });
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          if (currentIndex > 0) {
            currentIndex--;
            playCurrentParagraph();
          }
        });
      }

      audio.addEventListener('ended', onParagraphEnded);
      audio.addEventListener('error', (e) => {
        console.warn('[Audio] Error event fired:', e);
        updateStatus('Lỗi âm thanh, chuyển tiếp...');
        setTimeout(() => {
          if (isPlaying) onParagraphEnded();
        }, 1200);
      });

      // Auto play on load if auto URL
      if (window.location.search.includes('/auto') || window.location.search.includes('mode=auto')) {
        setTimeout(tryAutoPlay, 500);
      }
    });

    function updateStatus(msg) {
      if (statusText) statusText.textContent = msg;
    }

    function syncPlayState(playing) {
      isPlaying = playing;
      if (playing) {
        if (btnPlay) btnPlay.style.display = 'none';
        if (btnPause) btnPause.style.display = 'inline-block';
        if (iconPlay) iconPlay.style.display = 'none';
        if (iconPause) iconPause.style.display = 'inline-block';
        if (floatPlayer) floatPlayer.classList.add('active');
      } else {
        if (btnPlay) btnPlay.style.display = 'inline-block';
        if (btnPause) btnPause.style.display = 'none';
        if (iconPlay) iconPlay.style.display = 'inline-block';
        if (iconPause) iconPause.style.display = 'none';
      }
    }

    const ttsApiEndpoint = "${ttsEndpoint}";

    async function getOrFetchBlob(idx, text, speed) {
      const key = idx + '::' + speed;
      if (blobCache.has(key)) {
        return blobCache.get(key);
      }
      try {
        const resp = await fetch(ttsApiEndpoint + '?q=' + encodeURIComponent(text) + '&speed=' + speed);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        blobCache.set(key, blobUrl);
        return blobUrl;
      } catch (err) {
        console.warn('[TTS] Fetch blob error:', err);
        return ttsApiEndpoint + '?q=' + encodeURIComponent(text) + '&speed=' + speed;
      }
    }

    function prefetchUpcoming(startIdx, speed) {
      for (let i = 1; i <= 3; i++) {
        const target = startIdx + i;
        if (target < paragraphs.length) {
          const t = paragraphs[target].innerText.trim();
          getOrFetchBlob(target, t, speed).catch(() => {});
        }
      }
    }

    async function tryAutoPlay() {
      try {
        await startPlayback();
      } catch (err) {
        console.warn('Autoplay blocked by browser policy:', err);
        syncPlayState(false);
        updateStatus('Chạm ▶ để phát âm thanh');
      }
    }

    function startPlayback() {
      syncPlayState(true);
      return playCurrentParagraph();
    }

    function pausePlayback() {
      audio.pause();
      syncPlayState(false);
      updateStatus('Tạm dừng');
    }

    function stopPlayback() {
      audio.pause();
      syncPlayState(false);
      currentIndex = 0;
      paragraphs.forEach(p => p.classList.remove('tts-speaking'));
      updateStatus('Đã dừng');
      if (floatPlayer) floatPlayer.classList.remove('active');
    }

    async function playCurrentParagraph() {
      const session = ++currentSessionToken;
      if (currentIndex >= paragraphs.length) {
        onParagraphEnded();
        return;
      }

      // Highlight paragraph with authentic tts-speaking class
      paragraphs.forEach((p, idx) => {
        if (idx === currentIndex) {
          p.classList.add('tts-speaking');
          p.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          p.classList.remove('tts-speaking');
        }
      });

      const text = paragraphs[currentIndex].innerText.trim();
      const speed = rateSelect ? rateSelect.value : '1.0';
      updateStatus('Đang đọc đoạn ' + (currentIndex + 1) + '/' + paragraphs.length);

      // Trigger prefetch for upcoming 3 paragraphs in RAM
      prefetchUpcoming(currentIndex, speed);

      try {
        const audioSrc = await getOrFetchBlob(currentIndex, text, speed);
        if (session !== currentSessionToken || !isPlaying) return;

        audio.src = audioSrc;
        audio.playbackRate = parseFloat(speed) || 1.0;
        await audio.play();
        syncPlayState(true);
        updateStatus('Đang đọc đoạn ' + (currentIndex + 1) + '/' + paragraphs.length);
      } catch (err) {
        console.warn('[Audio] Play failed:', err);
        if (err.name === 'NotAllowedError') {
          syncPlayState(false);
          updateStatus('Chạm ▶ để phát âm thanh');
          throw err;
        } else {
          updateStatus('Lỗi phát đoạn ' + (currentIndex + 1) + ', chuyển tiếp...');
          setTimeout(() => {
            if (isPlaying && session === currentSessionToken) {
              currentIndex++;
              playCurrentParagraph();
            }
          }, 1200);
        }
      }
    }

    function onParagraphEnded() {
      if (!isPlaying) return;
      currentIndex++;
      if (currentIndex >= paragraphs.length) {
        updateStatus('Hết chương. Đang chuyển...');
        if (nextChapterUrl) {
          window.location.href = nextChapterUrl;
        } else {
          stopPlayback();
          updateStatus('Hết truyện.');
        }
        return;
      }
      playCurrentParagraph();
    }
  </script>
</body>
</html>`;
}
