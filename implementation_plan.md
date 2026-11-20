# Implementation plan — đọc truyện bằng TTS trên iPhone và bảo trì nguồn

Ngày lập: 27/09/2026. Trạng thái: kế hoạch triển khai, chưa thay đổi mã ứng dụng.

## 1. Quyết định đề xuất

**Giữ PHP + JavaScript thuần, giữ TTS có sẵn trên iPhone và cách bấm Đọc đơn giản. Sửa lỗi thực tế trước, kiểm thử khóa màn hình trên iPhone thật rồi mới quyết định có cần thêm thành phần native. Không đưa dịch vụ TTS trả phí vào đường triển khai mặc định.**

Yêu cầu đã xác nhận từ Sếp:

- iPhone là thiết bị chính.
- Đang dùng giọng TTS do trình duyệt truy cập trên máy; hiện không trả phí TTS cho nhà cung cấp.
- Muốn tiếp tục nghe truyện khi điện thoại tự khóa màn hình trong lúc nấu ăn, kể cả qua cuối chương.
- Muốn giữ thao tác ít, đồng thời giúp admin sửa được các thay đổi nhỏ từ nguồn truyện.
- Yêu cầu hiện tại là đọc code và viết kế hoạch; không phải triển khai hoặc thay giọng đang dùng ngay.

Điểm cần phân biệt: **TTS miễn phí trên thiết bị không đồng nghĩa JavaScript trong Safari được chạy nền không giới hạn.** Việc Sếp đã nghe miễn phí là hoàn toàn phù hợp với thiết kế hiện tại. Đề xuất audio/server trước đó là một hướng kỹ thuật khác, không phải điều kiện bắt buộc và không phải lý do phải trả tiền.

Khuyến nghị theo thứ tự:

1. Sửa player hiện tại và parser/admin, giữ nguyên cách sử dụng.
2. Thử nghiệm có giới hạn thời gian để xác định Web Speech thực sự làm được gì trên chính iPhone của Sếp.
3. Nếu chưa đạt yêu cầu khóa màn hình, thử bộ đọc có sẵn của iOS trên một trang truyện đã chuẩn bị đủ nội dung.
4. Nếu cần tiếp tục giữ một nút Đọc của sản phẩm và đọc nền ổn định, dùng ứng dụng iPhone nhỏ với TTS native; tái sử dụng backend, không viết lại toàn hệ thống.

Không coi “mở khóa rồi mới tự tiếp tục” là đã đạt mục tiêu “nghe liên tục khi đang khóa”.

## 2. Phạm vi khảo sát và mức độ xác minh

Đã đọc các thành phần chính:

| Thành phần | Hiện trạng |
|---|---|
| `index.php` | Nhận nguồn/đường dẫn, hỗ trợ `/auto`, `/full`, `/+N`, gọi parser rồi render PHP |
| `includes/parser.php` | Fetch qua bridge, cache HTML 1 giờ, XPath/regex và chuẩn hóa nội dung |
| `config/config.json` | Hai cấu hình `truyenfull`, `tamlinh`; cả hai hiện dùng regex lấy nội dung |
| `bridge.php` | Proxy cURL tới nguồn, có token và một số kiểm tra URL |
| `templates/story_view.php` | HTML truyện, điều hướng, biến JS toàn cục, player và audio im lặng |
| `templates/js/tts-player.js` | Web Speech, queue chương, state, prefetch, Media Session, widget nổi |
| `templates/css/style.css` | Thanh desktop và widget mobile; quy tắc thu nhỏ/vô hiệu nút |
| `admin/update/index.php` | Đăng nhập bằng mã cố định, sửa domain/XPath/regex rồi ghi thẳng cấu hình |
| `.htaccess` | Rewrite URL; chưa thấy quy tắc bảo vệ các thư mục nội bộ trong file này |

Working tree có thay đổi từ trước ở `templates/js/tts-player.js`. Kế hoạch dựa trên **file đang có**, không giả định HEAD là phiên bản đang chạy. Không ghi đè thay đổi đó.

Tài liệu `.agents/PLAN_TTS_MOBILE.md` là tài liệu cũ: còn mô tả một số hành vi của JS trước khi sửa, và mục tiêu chủ yếu là phục hồi sau mở khóa. Tài liệu này thay thế vai trò kế hoạch tổng thể; không xóa tài liệu cũ.

Đã chạy và đạt kiểm tra cú pháp cho 5 file PHP chính và `node --check templates/js/tts-player.js`. Chưa chạy phiên nghe trên iPhone, chưa kiểm chứng nguồn live hoặc cấu hình hosting production. Các kết luận runtime bên dưới là từ đọc mã; kiểm tra cú pháp không chứng minh nghe nền thành công.

## 3. Những vấn đề cần sửa trước

| Ưu tiên | Bằng chứng trong code hiện tại | Ảnh hưởng | Hướng sửa |
|---|---|---|---|
| P0 | JS mới không thêm `.active`; CSS mobile đặt `pointer-events: none` cho nút con khi widget thiếu `.active`; thanh desktop bị ẩn | Widget mobile không có đường click hoạt động theo CSS/JS hiện tại | Sửa đồng thời JS, CSS và HTML; nút Đọc luôn nhận chạm |
| P0 | `ensureNextQueued()` có thể đặt `buffering`, nhưng `prefetchNext()` chỉ enqueue khi `starting/playing` | Tải được chương mà không xếp đọc khi queue cạn | Tách hàng đợi dữ liệu và hàng đợi phát; cho phép phục hồi từ buffering |
| P1 | `start()` luôn prefetch; không sử dụng `window.isAutoPlayMode` | Trang một chương cũng có thể đọc tiếp ngoài ý muốn | Chỉ nạp/đọc chương tiếp khi continuous mode được bật |
| P1 | Lên/Xuống đổi `currentParagraphIndex`, nhưng `restartWithSettings()` vẫn đọc toàn bộ `entry.text` | Nút nhảy đoạn và thay thiết lập có thể đọc lại đầu chương | Tạo utterance từ cursor thật và giữ `baseOffset` |
| P1 | `renderEntry()` đổi nội dung/URL nhưng không cập nhật hai navigation; không xử lý `popstate` | Tiêu đề chương, nút Trước/Tiếp và URL có thể lệch nhau | Render từ một Chapter DTO; đồng bộ điều hướng và history |
| P1 | `prefetchPromise` dùng chung; thiếu abort, giới hạn retry và timeout khởi phát | Stop/Start nhanh, lỗi mạng hoặc engine không phát có thể kẹt | Mỗi session sở hữu request/queue; callback phải kiểm tra generation |
| P1 | Chưa lưu vị trí đọc; voice được chọn bằng index | Tải lại mất vị trí; danh sách giọng thay đổi có thể đổi giọng | Lưu bookmark và voice identity ổn định |
| P1 | Default/example dùng `tf`, config chỉ có `truyenfull/tamlinh` | Link mẫu và nguồn mặc định không hợp lệ | Alias `tf → truyenfull`, giữ URL cũ hoạt động |
| P1 | Fetch cache mọi response không rỗng, bỏ qua status/content type | Trang lỗi hoặc chống bot có thể bị cache và đưa sang TTS | Fetch có kết quả cấu trúc; validate trước khi nhận là chương |
| P1 | Navigation chỉ query `prev_chapter_url`; `next_chapter_url` không được dùng độc lập | Admin sửa selector chương sau nhưng không có tác dụng như mong đợi | Parse hai hướng riêng, resolve URL chuẩn và phát hiện vòng lặp |
| P1 | Cleanup chung cắt toàn bộ phần sau chuỗi `=====`, `-----`, `*****`… | Mất nội dung truyện hợp lệ mà không báo lỗi | Cleanup theo nguồn, có preview/diff và fixture bảo vệ |
| P1 | Admin ghi trực tiếp live JSON, chưa có test/CSRF/atomic publish/rollback | Một thay đổi nhỏ có thể làm hỏng toàn nguồn | Draft → Test → Publish có version → Rollback |
| P1 | Token bridge nằm trong code/URL; bridge HTTP; tắt xác thực TLS; lọc private host chưa đầy đủ | Rủi ro lộ token và truy cập đích không mong muốn | Bí mật ngoài webroot, HTTPS, allowlist và kiểm tra mọi redirect |

`normalizeParagraphs()` không nên được coi là bộ sanitizer hoàn chỉnh: regex loại thẻ và nối chuỗi HTML khó chứng minh an toàn. Kiến trúc mới tạo mảng plain text và escape khi render.

## 4. Giới hạn nền tảng và cách chọn phương án

### 4.1. Điều đã biết

- WebKit cho biết tab iOS có thể bị đình chỉ để tiết kiệm tài nguyên. Suy luận cho ứng dụng này: không lấy `setTimeout`, callback fetch hoặc callback cuối chương làm điều kiện duy nhất để duy trì đọc khi khóa màn hình. [WebKit: power usage](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/).
- Screen Wake Lock phục vụ giữ màn hình hoạt động, không phải cấp quyền đọc khi màn hình đã khóa. Vì mục tiêu là để máy tự khóa, đây không phải giải pháp chính. [W3C: Screen Wake Lock](https://www.w3.org/TR/screen-wake-lock/).
- Web Speech cung cấp lệnh phát và hàng đợi, không cung cấp API chuẩn xuất giọng đang dùng thành MP3/PCM/MediaStream để nối vào thẻ audio. Vì vậy “bọc TTS trình duyệt bằng `<audio>`” không phải thay đổi nhỏ thực hiện được bằng API hiện tại. [Web Speech API](https://webaudio.github.io/web-speech-api/).
- Native iOS có cơ chế audio category `.playback` và background mode `audio` cho phát khi khóa màn hình. Đó là khả năng của app native, không phải quyền mà website tự bật được. [Apple: playback](https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playback), [Apple: background modes](https://developer.apple.com/documentation/Xcode/configuring-background-execution-modes).

Không khẳng định Safari luôn dừng mọi speech khi khóa, cũng không khẳng định queue trước là đủ cho mọi iOS. **Hành vi của máy Sếp: chưa rõ cho tới khi test thiết bị thật.**

### 4.2. Ma trận lựa chọn

| Phương án | Giọng trên iPhone / phí TTS | Trải nghiệm | Vai trò trong kế hoạch |
|---|---|---|---|
| Web Speech hiện tại đã sửa | Giữ giọng trình duyệt; không thêm nhà cung cấp | Một nút Đọc như hiện tại | Làm trước; chỉ công bố hỗ trợ khóa màn hình nếu đạt test |
| Trang đọc sạch + bộ đọc iOS | Tận dụng công cụ có sẵn; phải thử giọng/ngôn ngữ thực tế | Có thao tác của iOS thay cho nút web | Thử như đường ít công sức, không tự coi đã đáp ứng |
| App iPhone nhỏ + native TTS | Dùng giọng hệ thống; không tính phí ký tự cloud | Có thể giữ một nút Đọc và điều khiển khóa màn hình | Nhánh triển khai nếu web không đạt và cần đọc nền ổn định |
| Audio thật tạo ở server | Không trực tiếp dùng giọng đã cài trên iPhone | Web phát audio thuận lợi hơn cho media playback | Không thuộc mặc định; chỉ xét nếu sau này Sếp đổi ưu tiên |

PWA, service worker, audio im lặng hoặc phát oscillator không được đưa vào tiêu chí hoàn thành. Cài biểu tượng lên Home Screen không tự giải quyết quyền chạy nền. Đổi framework frontend cũng không xử lý giới hạn này.

## 5. Kiến trúc đích: cải tiến từng phần

```text
Nguồn truyện
    ↓
Fetcher / bridge có kiểm soát
    ↓
Source adapter: config + XPath + cleanup theo nguồn
    ↓
Chapter DTO đã validate + cache có version
    ├── PHP render trang đọc
    ├── JSON API → player web → Web Speech
    ├── Gói chương → trang đọc sạch cho bộ đọc iOS
    └── JSON API → app iPhone nhỏ → native TTS [nếu cần]

Admin → draft config → fixtures + kiểm thử live → publish version → rollback
```

Giữ `index.php` và URL hiện tại làm điểm vào. Không cần SPA, Redis, hệ thống job lớn hoặc database cho tài khoản độc giả trong phạm vi này.

Tách `includes/parser.php` dần thành các trách nhiệm nhỏ, vẫn giữ facade `getStoryData()` cho trang cũ trong quá trình chuyển đổi:

| File dự kiến | Trách nhiệm |
|---|---|
| `includes/source_registry.php` | Load/validate cấu hình và alias, lấy revision đang active |
| `includes/source_fetcher.php` | HTTP/bridge, timeout, redirect, cache HTML và lỗi cấu trúc |
| `includes/source_parser.php` | Parse từ HTML đã có; không tự gọi network |
| `includes/chapter_service.php` | Chuẩn hóa Chapter DTO, chất lượng nội dung, links, cache parse |
| `api/chapter.php` | JSON một chương; source key + path thay vì arbitrary URL |
| `templates/js/reader-controller.js` | State/cursor/bookmark/navigation, không chứa logic DOM nguồn |
| `templates/js/web-speech-engine.js` | Chỉ quản lý synth, utterances, voice và callbacks |
| `templates/js/tts-player.js` | Điểm khởi tạo và nối UI với controller; chuyển đổi từng bước |
| `admin/update/index.php` | UI quản lý nguồn với draft/test/publish/rollback |
| `tests/fixtures/`, `tests/` | HTML mẫu rút gọn, expected output, queue/parser/API tests |

Đây là tách module tối thiểu theo ranh giới trách nhiệm, không bắt buộc tạo toàn bộ file ngay trong PR đầu.

### 5.1. Chapter DTO chung

```json
{
  "schemaVersion": 1,
  "sourceKey": "truyenfull",
  "sourceRevision": "r12",
  "chapterId": "stable-source-and-canonical-path-id",
  "path": "ten-truyen/chuong-1",
  "storyTitle": "Tên truyện",
  "chapterTitle": "Chương 1",
  "paragraphs": [{ "id": "p0", "text": "Nội dung đã chuẩn hóa." }],
  "previous": null,
  "next": { "path": "ten-truyen/chuong-2" },
  "navigationStatus": "valid",
  "contentHash": "sha256-of-normalized-text",
  "warnings": []
}
```

Các giá trị trên chỉ minh họa contract, không phải dữ liệu đã triển khai.

- ID chương dựa trên nguồn + canonical path; không dựa vào domain có thể thay đổi.
- `next: null` chỉ là kết thúc hợp lệ khi adapter có bằng chứng tương ứng. Link bị mất do selector hỏng phải có `navigationStatus: unknown` và cảnh báo, không giả thành hết truyện.
- Nội dung là plain text; PHP dùng escaping, JS dùng `textContent` khi tạo paragraph.
- Lỗi có `code`, `requestId`, `retryable`, thông báo người dùng; không trả token, stack hoặc nguyên HTML nguồn.
- API dùng URL tương đối theo base path cấu hình; kiểm thử hosting ở thư mục con.
- Mỗi response có giới hạn kích thước; API batch/gói chương có giới hạn số chương và thời gian thực thi.

## 6. Luồng triển khai player web

### 6.1. Giữ thao tác đơn giản

Mặc định hiển thị một nút Đọc/Tạm dừng đủ lớn. Lựa chọn giọng, tốc độ và đọc liên tục nằm trong phần tùy chọn, được ghi nhớ. Stop và nhảy đoạn vẫn truy cập được; các trạng thái chuẩn bị/lỗi phải nhìn thấy được trên mobile, không chỉ ở thanh desktop đang ẩn.

`/auto` và `/full` tiếp tục bật đọc liên tục, nhưng không tự phát khi mở trang. `/+N` giữ nghĩa hiện tại: chương hiện tại cộng thêm N chương; thêm giới hạn và thông báo số chương thực sự tải được.

Không cần chọn engine mỗi lần. Nếu triển khai native sau này, web vẫn hoạt động bình thường; trong app, nút Đọc sử dụng engine native.

### 6.2. State và cursor

State: `idle → starting → playing ↔ paused`; có nhánh `buffering`, `interrupted`, `completed`, `error`.

Quy tắc triển khai:

1. Tách `desiredPlayback` khỏi state quan sát. Chỉ báo đang đọc khi có sự kiện phát hoặc xác nhận hợp lệ từ engine.
2. Tách `currentChapter`, `preparedChapters`, `queuedUtterances`, `cursor`; không dùng một mảng chứa lẫn chương hiện tại và các chương đang chờ.
3. Mỗi phiên có generation ID và AbortController. Stop, đổi chương, đổi voice hoặc bắt đầu phiên mới phải vô hiệu callback cũ. Promise cũ chỉ được dọn state do chính nó sở hữu.
4. Cursor gồm chapter ID, content hash, paragraph ID và offset. Nhảy đoạn hoặc đổi tốc độ phải tái tạo speech từ cursor, không từ đầu toàn chương.
5. Watchdog khởi phát dùng khi foreground; ví dụ sau 8 giây không có tiến triển thì hiện Retry. Không dùng timer làm bảo đảm nền.
6. Khi paused, được phép chuẩn bị dữ liệu nhưng không tự phát. Khi buffering, dữ liệu đến phải có đường chuyển sang queue/phát hợp lệ.
7. Retry mạng có giới hạn, backoff và hủy được; lỗi parser/nguồn không retry dồn dập.
8. Giữ tham chiếu utterance tới khi kết thúc/hủy; chuỗi quá dài chia theo câu/đoạn với giới hạn được test, không gộp hàng chục chương thành một utterance vô hạn.

Preload ban đầu tối đa hai chương cho `/auto`, có tổng giới hạn dung lượng, phát hiện chương trùng và vòng lặp A → B → A. Nếu thử nghiệm cần chuẩn bị nhiều hơn cho một phiên nấu ăn, tải thành gói có giới hạn khi foreground; không suy ra rằng nhiều utterance sẽ tự vượt qua hạn chế iOS.

### 6.3. Khôi phục và lịch sử

- Bookmark lưu trong localStorage có version: nguồn, chapter ID/path, content hash, đoạn/offset gần nhất, voice identity, rate, continuous mode.
- Ghi khi đổi đoạn/chương, pause, visibility hidden và theo nhịp giới hạn khi có callback. Tab bị đình chỉ có thể không lưu tiến độ mới; chỉ hứa khôi phục checkpoint đã lưu, không hứa chính xác từng từ.
- Nếu hash nội dung đã đổi: đối chiếu đoạn; không khớp thì quay về đầu chương kèm thông báo, không dùng offset cũ mù quáng.
- Lưu giọng bằng `voiceURI + lang + name`, có fallback khi giọng biến mất; không dùng index làm cấu hình lâu dài.
- Auto-advance dùng `history.replaceState`; thao tác người dùng chuyển chương có thể dùng `pushState` và phải xử lý Back/Forward. Mọi view lấy cùng một Chapter DTO.
- `visibilitychange/pageshow` dùng để đối chiếu state và khôi phục UI. Không tự resume nếu chính người dùng đã pause; không tạo speech trùng.
- Media Session chỉ là metadata/control bổ sung. Đăng ký từng action có kiểm tra hỗ trợ; không coi đã set handler là có quyền chạy nền.

### 6.4. Sửa HTML/CSS cùng một lần

- Đổi các div tương tác thành button có nhãn; vùng chạm tối thiểu 44×44 CSS px, ưu tiên 48×48.
- Xóa cơ chế thu về 33×33 rồi vô hiệu hóa tất cả nút; một chạm phải Play/Pause ngay.
- Bảo đảm chỉ một icon trạng thái hiện tại; không cùng hiện Play và Done.
- Định vị có safe area, clamp lại sau xoay máy/resize; không lưu tọa độ khiến nút nằm ngoài màn hình.
- Có metadata chương/bootstrap JSON rõ ràng; không scrape lại trang render để suy ra nội dung và điều hướng khi đã có JSON API.
- Loại bỏ audio im lặng còn sót trong template. Không bổ sung oscillator hoặc pause/resume định kỳ để giữ sống.
- Dùng `filemtime()` hoặc build revision cho CSS/JS thay cho `time()/microtime()` mỗi request.

## 7. Thử nghiệm quyết định cho iPhone

### 7.1. Timebox trước khi đầu tư lớn

Dành khoảng 1–2 ngày công cho sửa lỗi tối thiểu và thử nghiệm nền; đây là ước lượng, không phải cam kết tiến độ. Ghi model iPhone, iOS, trình duyệt, voice URI/name/lang/localService và chế độ tiết kiệm pin. Không cần thu nội dung truyện hoặc thông tin riêng tư trong log.

Thử theo tầng để biết lỗi ở đâu:

| Thử nghiệm | Mục đích |
|---|---|
| Một đoạn/chương tĩnh, không network, khóa sau khi đã phát | Xác định bản thân speech có tiếp tục khi khóa không |
| Nhiều utterance/chương đã chuẩn bị, không network | Xác định có chuyển được queue khi khóa không |
| Queue + tải chương tiếp từ backend | Tách vấn đề lifecycle khỏi network/parser |
| Để máy tự khóa và thử khóa bằng nút nguồn | Bao phủ đúng hoàn cảnh nấu ăn |
| 30–60 phút, qua ít nhất ba ranh giới chương, lặp ba phiên | Tránh kết luận chỉ từ vài giây nghe thành công |

Nếu speech tĩnh đã dừng khi khóa, không tiếp tục mở rộng prefetch/keepalive với kỳ vọng sửa được bằng parser. Nếu chỉ dừng ở ranh giới chương, điều tra queue/callback trước.

### 7.2. Điều kiện chọn đường đi

- **Web đạt:** giữ Web Speech là đường chính trên cấu hình đã test; ghi ma trận hỗ trợ, test lại sau nâng iOS.
- **Web không đạt, bộ đọc iOS đạt:** cung cấp trang đọc sạch/gói chương và hướng dẫn ngắn. Phải thừa nhận thao tác bắt đầu do iOS điều khiển, không giả rằng website có thể tự bấm bộ đọc hệ thống.
- **Cả hai không đạt hoặc thao tác iOS không phù hợp:** dùng nhánh native bên dưới để đáp ứng mục tiêu khóa màn hình. Việc cải tiến API/parser/admin vẫn được tái sử dụng.

### 7.3. Đường ít công sức: bộ đọc có sẵn của iOS

Apple có Speak Screen và Safari Listen to Page cho nội dung được hỗ trợ. Kế hoạch là thử chúng với tiếng Việt và giọng Sếp dùng, không khẳng định mọi trang/giọng đều được hỗ trợ hoặc luôn đọc nền. [Apple: Speak Screen](https://support.apple.com/guide/iphone/hear-whats-on-the-screen-or-typed-iph96b214f0/ios), [Apple: Listen to Page](https://support.apple.com/en-ie/guide/iphone/iph449fc616c/ios).

Tạo view sạch bằng `<main><article>`, tiêu đề truyện/chương rõ, không lặp thanh điều hướng giữa nội dung. Có thể tận dụng gộp chương nhưng phải chặn vòng lặp, giới hạn N, giới hạn tổng thời gian tải, và báo khi gói mới tải được một phần.

Phiên nghe ở đường này chỉ bao gồm nội dung đã chuẩn bị; không hứa bộ đọc hệ thống tự mở chương web kế tiếp. Website không biết chính xác cursor của bộ đọc hệ thống và không nên hiển thị highlight giả.

## 8. Nhánh native nếu bắt buộc đọc nền ổn định

**Chỉ khởi động nhánh này sau gate iPhone. Giữ giọng hệ thống, không bổ sung hóa đơn cloud TTS.**

### 8.1. Phạm vi tối thiểu

Một app iPhone nhỏ hoặc shell có phần phát native, nhận cùng source/path và JSON Chapter API. Có thể tái sử dụng trang đọc cho hiển thị, nhưng queue, TTS, network prefetch và bookmark khi nghe nền phải do native quản lý; chỉ bọc website trong WebView là chưa đủ.

Các thành phần:

- `ReaderSession`: state, current chapter/cursor, queue đã tải, generation, bookmark.
- `ChapterClient`: đọc JSON API; cùng parser phía server, không nhân bản XPath trong app.
- `SpeechEngine`: AVSpeechSynthesizer + AVSpeechUtterance, chọn voice từ danh sách thiết bị; kiểm tra giọng tiếng Việt thực sự có sẵn.
- Audio session `.playback`, mode phù hợp nội dung nói và Background Modes → Audio; activate khi bắt đầu, deactivate đúng khi dừng.
- Now Playing/remote commands cho Play/Pause, chương/đoạn tiếp theo; xử lý cuộc gọi, Siri, tháo tai nghe và chuyển audio route.
- Lưu checkpoint native theo callback; chuẩn bị vài chương trước khi khóa để giảm phụ thuộc mạng.

Apple cung cấp AVSpeechSynthesizer cho giọng hệ thống và khả năng dùng audio session do app quản lý. Đây là cơ sở kỹ thuật của nhánh native; vẫn phải kiểm thử giọng, chuyển chương và gián đoạn thực tế. [Apple: AVSpeechSynthesizer](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer), [Apple: usesApplicationAudioSession](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer/usesapplicationaudiosession).

Không yêu cầu ghi MP3 để làm MVP native. Nếu cần cache audio sau này, Apple có API `write(_:toBufferCallback:)`, nhưng phải xác minh khả năng của voice và quản lý dung lượng; đây không phải khả năng mà Web Speech tự có. [Apple: speech audio buffers](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer/write(_:tobuffercallback:)).

### 8.2. Chi phí và điều kiện thực tế

Không có phí TTS theo ký tự không có nghĩa triển khai native không tốn công. Cần môi trường build/sign iOS, cách cài/cập nhật app trên máy Sếp và kiểm thử thiết bị. Workspace hiện tại là Windows; khả năng có Mac/Xcode và phương án phân phối: **chưa rõ**. Chốt các điểm đó trước khi mở rộng native, không giả định có sẵn hay cần mua ngay.

Tiêu chí native: bắt đầu một lần, để máy tự khóa 60 phút, qua ít nhất ba chương, điều khiển Pause/Play từ khóa màn hình hoạt động, không mất cursor sau gián đoạn, không phụ thuộc JavaScript của WebView tiếp tục chạy.

## 9. Parser và source adapter dễ bảo trì

### 9.1. Chuẩn hóa cấu hình thay vì sửa code cho mọi thay đổi nhỏ

Giữ cấu hình khai báo JSON cho từng nguồn với các trường:

| Nhóm | Nội dung |
|---|---|
| Identity | key ổn định, aliases, display name, revision, enabled |
| Fetch | base URL, allowed hosts, timeout, TTL, giới hạn bytes, rate limit |
| Selectors | story title, chapter title, content, previous link, next link riêng |
| Extraction | XPath chính, fallback có thứ tự, chế độ regex legacy nếu cần |
| Cleanup | selector loại quảng cáo tương đối, exact text/regex có phạm vi, version |
| Validation | số match kỳ vọng, nội dung tối thiểu theo nguồn, dấu hiệu bị chặn, điều kiện hết truyện |
| Fixtures | mẫu chương đầu, giữa, cuối, mẫu nguồn bị đổi layout |

Ưu tiên XPath theo id/thuộc tính ổn định hoặc class token, tránh tuyệt đối `/html/body/div[6]/...` khi có lựa chọn tốt hơn. Selector loại node bên trong content dùng `.//...`; không để `//...` vô tình quét toàn document.

Không tự fallback sang lấy toàn bộ body khi selector hỏng. Fallback phải được cấu hình, kiểm chứng và ghi cảnh báo khi được dùng để admin biết nguồn bắt đầu lệch.

### 9.2. Tách fetch, parse, validate

Fetcher trả status, final URL, content type, duration, cache hit/miss và body/error. Parser nhận HTML string + source config, vì vậy preview và fixture tests không phụ thuộc network.

Phải xử lý:

- HTTP lỗi, timeout, trang xác minh/chặn bot dù status 200; không đánh dấu là chương thành công.
- XPath/regex không hợp lệ: thành lỗi có mã, không gây fatal ngoài kiểm soát. Giới hạn kích thước input và tài nguyên regex.
- Nội dung rỗng/ngắn bất thường, title mất, nhiều content node, link sai nguồn hoặc quay lại chính chương.
- Link relative, root-relative, absolute, query và fragment bằng URL resolver chuẩn; kiểm tra host rồi mới chuyển về internal path. Không dùng chỉ `parse_url(..., PATH)` để đoán tất cả trường hợp.
- “Chương cuối thật” khác “không còn tìm thấy nút Next”. Preview luôn cho thấy lý do.
- Cleanup không được cắt đuôi toàn cục chỉ vì truyện có dấu phân cách; mọi phép cắt mạnh cần cấu hình riêng và expected text trong fixture.

### 9.3. Cache và thay đổi version

- Cache HTML thô: theo canonical source URL/fetch profile; lưu metadata để nhận biết status và độ cũ.
- Cache kết quả parse: theo source key + path + HTML hash + source revision + parser/normalizer version.
- Khi sửa selector, có thể parse lại HTML đã cache để so sánh; khi nguồn live đổi, admin có nút lấy bản mới bỏ qua cache cho đúng URL.
- Publish một nguồn chỉ làm mất hiệu lực dữ liệu parse của nguồn/version đó; không xóa toàn cache của mọi nguồn.
- Chỉ dùng last-known-good khi bản đó đã được validate; hiển thị đang dùng bản cũ và tuổi dữ liệu. Không dùng stale HTML lỗi để che sự cố.
- Ghi file temp + đổi tên trong cùng filesystem, có khóa và kiểm tra lỗi. Runtime cache/version nằm ngoài webroot hoặc bị web server chặn đọc trực tiếp.

### 9.4. Bridge và admin cần an toàn để vận hành

Chuyển token ra config riêng ngoài webroot/environment; gửi bằng header, bật HTTPS và TLS verification; thay token đã nằm trong mã khi triển khai. Không sao chép giá trị token vào log hoặc tài liệu.

Bridge chỉ cho phép host nguồn đã cấu hình; chặn userinfo/port ngoài chính sách, private/loopback/link-local/reserved IPv4 và IPv6. Kiểm tra DNS/IP và mỗi redirect, tránh validate hostname rồi để cURL tự đi tới IP/host khác. Có giới hạn bytes sau giải nén, timeout và số redirect.

Admin dùng mật khẩu hash từ secret riêng, session cookie Secure/HttpOnly/SameSite, regenerate session sau đăng nhập, CSRF token, timeout/logout và hạn chế thử sai. Test/publish/rollback đều yêu cầu xác thực. Preview HTML nguồn phải escape hoặc sandbox chặt, không chạy script nguồn trong origin admin.

Kiểm tra deployment thực tế trước khi kết luận thư mục nào đang public. `.gitignore` không bảo vệ HTTP; cần rule deny trước rule cho file/thư mục tồn tại của `.htaccess`, hoặc đặt secrets/cache/fixtures/backups ngoài document root.

## 10. Quy trình admin khi nguồn đổi chi tiết nhỏ

### 10.1. Giao diện đề xuất

Mỗi nguồn có trạng thái, phiên bản đang dùng, lần thành công gần nhất, lỗi gần nhất, URL mẫu đã che dữ liệu nhạy cảm nếu có, và các thao tác: **Chẩn đoán — Sửa bản nháp — Thử — Áp dụng — Hoàn tác**.

Người quản trị thường dùng các nhãn tiếng Việt: tên miền, vùng nội dung, tên chương, chương trước/sau, vùng quảng cáo. XPath/regex đặt trong phần nâng cao nhưng vẫn xem/sửa được. Khi lỗi, UI chỉ rõ trường nào không tìm thấy và match count, không chỉ báo “parse failed”.

### 10.2. Quy trình chuẩn

1. **Chẩn đoán URL lỗi:** chạy trên revision live, xem status HTTP, final host, cache age, title, số đoạn, số ký tự, prev/next, rule cleanup đã áp dụng.
2. **Lấy HTML mới:** bỏ qua cache đúng URL để phân biệt nguồn đổi và cache cũ. HTTP 403/429/captcha chuyển sang lỗi fetch/block; không sửa XPath để “chữa” trang bị chặn.
3. **Tạo draft từ revision live:** sửa đúng trường bị đổi; không ghi thẳng lên live.
4. **Preview trước/sau:** hiển thị tiêu đề, nội dung đầu/cuối, đoạn bị xóa, diff, link trước/sau và số match. Nội dung tụt mạnh phải cảnh báo ngay.
5. **Chạy bộ mẫu:** chương lỗi + đầu/giữa/cuối + ít nhất một truyện khác nếu nguồn có nhiều layout. Lỗi cấu trúc chặn publish; cảnh báo ngoại lệ cần ghi lý do, không có nút bỏ qua âm thầm.
6. **Publish:** lưu revision bất biến, người sửa/thời gian/lý do, hash draft và kết quả test. Chỉ publish đúng draft đã test; draft thay đổi phải test lại. So sánh base revision để tránh admin thứ hai ghi đè sửa đổi mới hơn.
7. **Smoke test và theo dõi:** đọc lại vài chương qua API và UI với revision mới; lỗi tăng thì rollback đúng nguồn về revision đã tốt.

Phiên đang đọc giữ snapshot nội dung hiện tại để tránh thay đổi giữa câu. Chương tiếp theo lấy revision mới sau publish; bookmark có content hash để xử lý khác biệt.

### 10.3. Cách xử lý những thay đổi thường gặp

| Nguồn thay đổi | Admin sửa gì | Bằng chứng phải xem trước publish |
|---|---|---|
| Đổi domain | Base URL + allowed hosts/alias | Final URL đúng, TLS hợp lệ, chapter path không bị đổi sai |
| Đổi id/class content | Content XPath hoặc fallback | Đúng một vùng nội dung, đầu/cuối chương còn đủ |
| Chèn thêm wrapper div | Selector ngữ nghĩa thay selector theo vị trí | Chương khác vẫn parse được, không lấy cả sidebar |
| Đổi chữ Tiếp thành Sau hoặc icon | Next XPath/rel/aria label, text fallback | URL kế đúng, không self-loop; chương cuối được nhận biết |
| Đổi `<br>`/`<p>` | Normalization rule có fixture | Giữ thứ tự/đủ văn bản và ngắt đoạn hợp lý |
| Thêm quảng cáo | Exclude XPath tương đối/exact text rule | Chỉ quảng cáo bị xóa, không mất phần truyện sau dấu phân cách |
| 403/429/trang xác minh | Kiểm tra fetch/bridge, giảm tốc hoặc tạm ngưng nguồn | Không phát nội dung lỗi; không cache là thành công |
| Chuyển sang JS-render/encrypted content | Đánh dấu cần adapter kỹ thuật | Không cố chữa bằng selector tùy tiện hoặc tự vượt kiểm soát truy cập |

### 10.4. Theo dõi và runbook

Lưu thống kê nhẹ theo nguồn: fetch failures, parse failures, content-empty, navigation-unknown, fallback used, số ký tự bất thường và lần thành công cuối. Không log toàn bộ truyện hay credential.

Ưu tiên thống kê từ request thật; nếu hosting có cron thì thêm canary định kỳ với tần suất nhỏ, có rate limit/backoff. Chỉ cảnh báo khi lỗi lặp hoặc có thay đổi đáng xử lý, không gửi thông báo cho từng request. Không tạo automation/cron trong đợt viết kế hoạch này.

Mục tiêu vận hành: một thay đổi selector/domain thông thường có thể chẩn đoán, test và publish trong khoảng 10–15 phút sau khi admin quen quy trình; đây là mục tiêu thiết kế, không bảo đảm cho mọi nguồn.

## 11. Lộ trình theo PR và điều kiện nghiệm thu

| Bước | Việc thực hiện | Điều kiện hoàn thành | Ước lượng |
|---|---|---|---|
| P0 — baseline/player tối thiểu | Giữ bản đang sửa, fixtures tối thiểu, sửa mobile click, auto flag, queue deadlock, cursor | Mobile bấm một lần được; Play/Pause/Stop/Retry đúng; không đọc chương ngoài mode | 1–2 ngày |
| G1 — gate iPhone | Test speech tĩnh, queue, network, tự khóa 30–60 phút | Có kết quả thực tế và chọn web/iOS reader/native, không gọi resume-sau-mở-khóa là pass | Gộp với P0 hoặc thêm 1 ngày |
| P1 — nguồn và API | Tách fetch/parse/validate, alias, links, cleanup, DTO, cache version, bridge baseline | Hai nguồn qua fixture; lỗi nguồn không thành nội dung TTS; URL cũ vẫn chạy | 2–3 ngày |
| P2 — player hoàn chỉnh | Dùng API, bookmarks, history, voice, buffering/retry, UI trạng thái | Không lặp/mất chương; phục hồi checkpoint; test lại iPhone trên bản tích hợp | 1–2 ngày |
| P3 — admin | Draft/test/diff/publish/rollback, xác thực, audit | Admin sửa một fixture drift rồi publish/rollback không sửa PHP | 2–3 ngày |
| P4A — bộ đọc iOS, nếu phù hợp | View sạch/gói chương giới hạn | Giọng tiếng Việt và phiên khóa màn hình đạt trên máy Sếp | 0,5–1 ngày thử nghiệm |
| P4B — native, nếu cần | PoC audio session trước, rồi app nhỏ dùng API | Đạt phiên 60 phút và điều khiển khóa màn hình; cách cài/cập nhật rõ | PoC 1–2 ngày; phần còn lại ước lượng sau |

Các mốc là ngày công ước lượng của một người, không phải lịch giao. Thời gian phụ thuộc quyền truy cập hosting, thiết bị test và môi trường iOS. P3 có thể làm song song sau khi contract P1 ổn định.

Không tiếp tục một tuần thử keepalive nếu gate G1 đã chứng minh engine của Safari bị dừng trong tình huống tối giản. Khi đó dùng nhánh phù hợp với yêu cầu đã xác nhận.

## 12. Kiểm thử cần có

### 12.1. Tự động: tập trung lỗi có hậu quả

**Parser/config:** fixture cho hai nguồn; class/id đổi; wrapper mới; mất Next; chương cuối; quảng cáo; `<br>`; dấu phân cách hợp lệ; invalid XPath/regex; response 403 và challenge 200; URL relative/absolute/query; self-loop/cycle; domain redirect không được phép; cache revision thay đổi.

**Player/controller:** event giả có thứ tự khác nhau; Stop trong khi fetch; Stop → Start trước khi fetch cũ xong; pause lúc prefetch; buffering nhận chương mới; stale onend/onerror; đổi voice/rate giữ cursor; auto off; boundary không được phát; Back/Forward và reload bookmark; mất localStorage không làm chết player.

**Admin/integration:** draft sai không ảnh hưởng live; publish phải khớp hash đã test; xung đột hai admin; CSRF; ghi file thất bại; rollback; invalidation đúng nguồn; HTML preview không thực thi script; rewrite hoạt động ở subdirectory.

Không lấy test mô phỏng JavaScript hay desktop browser làm bằng chứng đạt background audio trên iOS.

### 12.2. Ma trận iPhone thực tế

| Tình huống | Kết quả cần đạt |
|---|---|
| Mở trang, chờ 5 phút rồi Đọc | Một chạm bắt đầu; không kẹt starting |
| Tự khóa giữa chương | Tiếng vẫn tiếp tục trong nhánh được chọn để đáp ứng đọc nền |
| Khóa qua nhiều cuối chương | Không cần bật màn hình để sang chương |
| Nghe 60 phút qua ít nhất ba ranh giới chương | Không dừng ngoài ý muốn hoặc lặp/bỏ nội dung; chạy ba phiên |
| Pause/Resume, Stop → Play | Đúng cursor và không duplicate speech |
| Đổi tốc độ/giọng lúc đang đọc | Hành vi rõ ràng; không vô cớ đọc lại toàn chương |
| Mất mạng trong phần đã chuẩn bị | Tiếp tục phần sẵn có; hết dữ liệu thì trạng thái chờ/lỗi rõ |
| Cuộc gọi/Siri/Bluetooth | Pause hoặc interruption đúng; không tự đọc chồng lên cuộc gọi |
| Người dùng chủ động Pause rồi khóa/mở | Không tự bật lại |
| App/tab bị đóng hoặc OS chấm dứt | Không hứa tiếp tục phát; mở lại khôi phục checkpoint đã lưu |
| Low Power Mode và xoay máy | Ghi kết quả thực; nút và bookmark vẫn sử dụng được |

Thử Safari là chính; Home Screen chỉ test nếu thực sự hỗ trợ cách dùng đó. Không cần đưa nhiều browser vào MVP khi thiết bị chính đã là iPhone.

## 13. Triển khai, rollback và hồ sơ bàn giao

1. Tạo checkpoint riêng cho working tree đang sửa trước khi bắt đầu code. Không reset hoặc chép đè JS hiện có.
2. Phát hành từng PR nhỏ; player mới có cờ rollout, API giữ tương thích facade và URL cũ.
3. Import config hiện tại thành revision đầu; giữ bản config cũ để rollback. Không publish draft chưa test.
4. Smoke test trên staging với dữ liệu mẫu và nguồn live có giới hạn trước khi dùng thật.
5. Nếu player lỗi: tắt cờ mới và phục hồi asset version trước. Nếu adapter lỗi: rollback riêng source revision. Không xóa toàn cache hay bookmark.
6. Bàn giao `README` chạy/deploy, `docs/admin-runbook.md`, mẫu cấu hình không chứa secret và `docs/iphone-test-results.md` ghi kết quả thiết bị thật.

Definition of Done:

- Cách nghe thông thường vẫn đơn giản và không bắt Sếp đăng ký dịch vụ TTS trả phí.
- Có một đường nghe đạt phiên khóa màn hình trên iPhone thật; nếu chỉ sửa web mà gate không đạt thì chưa được đánh dấu hoàn thành mục tiêu này.
- Không còn lỗi widget, queue buffering, nhảy đoạn, auto mode và navigation đã nêu.
- Lỗi nguồn không làm TTS đọc trang quảng cáo/chặn bot hoặc âm thầm bỏ phần truyện.
- Admin tự xử lý thay đổi nhỏ qua draft/test/publish/rollback, có fixture và lịch sử phục hồi.
- Báo cáo triển khai phân biệt rõ phần đã test, phần chưa test và giới hạn do hệ điều hành.

## 14. Thông tin còn cần xác nhận khi bắt đầu triển khai

Không chặn việc lập kế hoạch hoặc sửa P0/P1/P3:

- Model/iOS, tên giọng đang dùng, Safari tab hay biểu tượng Home Screen.
- Một phiên nấu ăn thường dài bao lâu; mặc định nghiệm thu 60 phút.
- Hosting production dùng PHP/web server nào, base path, HTTPS và khả năng sửa cấu hình bridge.
- Nếu gate web không đạt: có chấp nhận dùng bộ đọc iOS hoặc cài app nhỏ; môi trường build/sign chỉ cần xác nhận ở thời điểm đó.

Không cần chọn nhà cung cấp TTS hay ngân sách API để bắt đầu phương án này.
