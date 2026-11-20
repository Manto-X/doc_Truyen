/**
 * Cloudflare Worker: doc_Truyen Secure Forward Proxy Bridge
 * Purpose: High-performance crawl bridge bypassing datacenter IP blocks
 * Free Tier: 100,000 requests/day
 * Environment Variables (Secrets in Cloudflare Dashboard):
 *   - READER_BRIDGE_TOKEN: Secret auth token
 *   - READER_BRIDGE_ALLOWED_HOSTS (Optional): e.g. "tamlinh247.biz,truyenfull.vision"
 */

export default {
  async fetch(request, env, ctx) {
    // 1. Chỉ chấp nhận GET và HEAD
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const requestUrl = new URL(request.url);

    // 2. Health check endpoint
    if (requestUrl.pathname === '/health' || requestUrl.pathname === '/ping') {
      return new Response(JSON.stringify({ status: 'ok', service: 'doc_truyen_bridge' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // 3. Xác thực Secret Token (Header X-Bridge-Token)
    const expectedToken = env.READER_BRIDGE_TOKEN;
    const clientToken = request.headers.get('X-Bridge-Token') || requestUrl.searchParams.get('token');

    if (!expectedToken || clientToken !== expectedToken) {
      return new Response(JSON.stringify({ error: 'Forbidden', message: 'Invalid or missing authentication token.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // 4. Lấy và kiểm tra Target URL
    const targetUrlStr = requestUrl.searchParams.get('url');
    if (!targetUrlStr) {
      return new Response(JSON.stringify({ error: 'Bad Request', message: 'Missing target URL parameter.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    let targetUrl;
    try {
      targetUrl = new URL(targetUrlStr);
    } catch {
      return new Response(JSON.stringify({ error: 'Bad Request', message: 'Malformed target URL.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // Chỉ cho phép scheme http / https
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      return new Response(JSON.stringify({ error: 'Bad Request', message: 'Only http and https schemes are permitted.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // Kiểm tra Allowed Hosts nếu có cấu hình
    const allowedHostsEnv = env.READER_BRIDGE_ALLOWED_HOSTS;
    if (allowedHostsEnv) {
      const allowedHosts = allowedHostsEnv.split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
      if (allowedHosts.length > 0 && !allowedHosts.includes(targetUrl.hostname.toLowerCase())) {
        return new Response(JSON.stringify({ error: 'Forbidden', message: 'Target host is not permitted by bridge.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }

    // 5. Khởi tạo request tới web truyện với headers giả lập trình duyệt
    const outboundHeaders = new Headers({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'vi,vi-VN;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    });

    try {
      const response = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers: outboundHeaders,
        redirect: 'follow',
        cf: {
          cacheEverything: false,
          cacheTtl: 0
        }
      });

      // Tạo response trả về, giữ nguyên content-type và status
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('X-Proxied-By', 'Cloudflare-Worker-DocTruyen');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Bad Gateway', message: 'Fetch failed: ' + err.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }
  }
};
