# Cloudflare Worker — Kiến Trúc & Vận Hành (SSOT)

> **Cập nhật ngày:** 17/11/2026  
> **Trạng thái:** LIVE trên production Cloudflare

---

## 1. Thông Tin Tổng Quan (Single Source of Truth)

* **Worker Name:** `story-reader-bridge`
* **Custom Domain Route:** `*toha.us/ai/read/*`
* **Zone Name:** `toha.us` (Zone ID: `ce59b1abb3d671cf063a9ed43923129b`)
* **Live URLs:**
  * Custom Domain: `https://toha.us/ai/read/`
  * Cloudflare Dev: `https://story-reader-bridge.tomytran.workers.dev`
* **Mã nguồn thực thi:** `scripts/cloudflare-worker/worker_all_in_one.js`
* **File cấu hình:**
  * Gốc dự án: `wrangler.toml` (cho wrangler chạy từ root)
  * Thư mục worker: `scripts/cloudflare-worker/wrangler.toml` (cho deploy tool độc lập)

---

## 2. Cấu Hình Route & Nguồn Truyện

```toml
name = "story-reader-bridge"
main = "scripts/cloudflare-worker/worker_all_in_one.js"
compatibility_date = "2024-09-23"

routes = [
  { pattern = "*toha.us/ai/read/*", zone_name = "toha.us" }
]

[vars]
READER_BRIDGE_ALLOWED_HOSTS = "tamlinh247.biz,truyenfull.vision,truyenchu.net"
```

---

## 3. Các Nguồn Hỗ Trợ Hiện Tại

1. **Tâm Linh:** Alias `tamlinh`, `tl`. Domain: `tamlinh247.biz`.
2. **Truyện Chữ:** Alias `truyenchu`, `tc`. Domain: `truyenchu.net`.
3. **Truyện Full:** Alias `truyenfull`, `tf`. Domain: `truyenfull.vision` (dự phòng).

---

## 4. Quy Trình Triển Khai (Deploy)

* **Cách 1 (Zero-dependency Python CLI):**
  ```powershell
  python scripts/deploy_worker.py
  ```
* **Cách 2 (Wrangler CLI):**
  ```powershell
  npx wrangler deploy
  ```
