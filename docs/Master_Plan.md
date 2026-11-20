> Scope: BIG | Phase: 4/7 (QA & Independent Review Completed) | SDLC: 4.1 | Mode: Brownfield Adopted | Updated: 2026-10-21

# MASTER IMPLEMENTATION PLAN — DOC_TRUYEN (BROWNFIELD ADOPTED)

## 0. Workspace & Documentation Layout (HaGo 3-Tier)
```text
doc_Truyen/
├── docs/                             # TẦNG 1: TÀI LIỆU DỰ ÁN (Human & System Centric)
│   ├── Master_Plan.md                # Kế hoạch tổng thể & hiện trạng tiếp quản
│   ├── architecture/                 # Kiến trúc, sơ đồ thực tế
│   └── operations/                   # Hướng dẫn vận hành & triển khai
│
├── .agents/                          # TẦNG 2: AGENT RUNTIME & COGNITION (Machine Centric)
│   ├── sdlc_state.json               # Trạng thái máy đọc (Phase hiện tại, mode: brownfield_adopted)
│   ├── project_config.json           # Cấu hình dự án & config surface
│   ├── plans/                        # Kế hoạch chi tiết từng Phase
│   └── audits/                       # Sổ cái audit log
│
└── scratch/                          # TẦNG 3: VÙNG NHỚ TẠM (Ephemeral Scratchpad)
```

---

## 1. Baseline Inventory (Hiện Trạng Trước Tiếp Quản)
- **Tech Stack phát hiện**: CSS, JavaScript, PHP
- **Tổng số file hiện có**: 240 files (~4153 dòng code)
- **Thành phần chính**: .cache: 174 files, .ini: 25 files, .php: 19 files, .md: 6 files
- **Điểm vào (Entrypoints)**: `index.php`
- **Tài liệu hiện có**: README.md

---

## 2. Target Goals & Delta Gap (Mục Tiêu Sếp Đặt Ra)
> Nguồn: Prompt tiếp quản của Sếp (2026-10-21)

**Mục tiêu cần hoàn thiện:**
Implement continuous background audio reading with PWA and MediaSession for cooking handsfree

---

## 3. Phase Roadmap (Lộ Trình Triển Khai)
- [x] **Phase 1: Discovery & Baseline**: Đã quét mã nguồn và tiếp quản vào HaGo.
- [x] **Phase 2: Architecture & Gap Plan**: Khóa kiến trúc, lập danh sách file cần sửa/thêm (`.agents/plans/Phase_2_Adopted_Plan.md`).
- [x] **Phase 3: Surgical Coding & Fixes**: Triển khai AudioStreamEngine, TTS Proxy, PWA manifest/sw, normalizeChapterRequestPath.
- [x] **Phase 4: QA & Independent Review**: Audit độc lập bởi `code_reviewer_critic`, phát hiện và vá triệt để 2 lỗi CRITICAL (Blob RAM leak, auto-speech downgrade) + 4 WARNINGS. Unit test toàn hệ thống PASS 100%.
- [ ] **Phase 5: Security & Hardening**: Kiểm tra an toàn, bảo vệ dữ liệu.
- [ ] **Phase 6: Polish & Clean**: Dọn dẹp code rác, kiểm tra chuẩn UI.
- [ ] **Phase 7: Delivery & Release**: Triển khai chính thức.

---

## 4. Phase Completion Log
- **2026-10-21**: Adopted existing codebase into HaGo SDLC. Baseline scanned: 240 files.
- **2026-10-21**: Completed Phase 2 Architecture & Plan with Gemini Argon consultation.
- **2026-10-21**: Completed Phase 3 Coding (commit `3d87c7f`).
- **2026-10-21**: Completed Phase 4 Independent Review & Fixes (commit `f503fa5`).
