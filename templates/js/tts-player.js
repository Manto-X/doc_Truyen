document.addEventListener("DOMContentLoaded", () => {
  if (!("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  const contentEl = document.querySelector(".story-content");
  const playerBar = document.getElementById("tts-player-bar");
  const btnPlay = document.getElementById("tts-play"), btnPause = document.getElementById("tts-pause"), btnStop = document.getElementById("tts-stop");
  const statusText = document.getElementById("tts-status"), selectRate = document.getElementById("tts-rate");
  const floatPlayer = document.getElementById("tts-floating-player"), floatPlayPause = document.getElementById("tts-float-playpause");
  const iconPlay = document.getElementById("icon-play"), iconPause = document.getElementById("icon-pause"), iconDone = document.getElementById("icon-done");
  const floatPrev = document.getElementById("tts-float-prev"), floatNext = document.getElementById("tts-float-next");
  if (!contentEl) return;

  const selectVoice = document.createElement("select");
  selectVoice.id = "tts-voice"; selectVoice.setAttribute("aria-label", "Giọng đọc");
  if (playerBar) playerBar.insertBefore(selectVoice, selectRate);
  const continuous = window.isAutoPlayMode === true, prefetchDepth = 2;
  const bookmarkKey = "readerBookmark:v1";
  let voices = [], state = "idle", sessionId = 0, currentEntry = null, queuedEntries = [];
  let paragraphOffsets = [], currentParagraphIndex = 0, currentOffset = 0, prefetchController = null, prefetchPromise = null, wasDragged = false;

  function debug(event, details = {}) { window.__ttsDebug = (window.__ttsDebug || []).slice(-99); window.__ttsDebug.push({ at: Date.now(), event, state, ...details }); }
  function setState(next, message) {
    state = next; if (statusText && message) statusText.textContent = message;
    const busy = ["playing", "starting", "buffering"].includes(next);
    if (btnPlay) btnPlay.hidden = busy; if (btnPause) btnPause.hidden = !busy;
    if (iconPlay) iconPlay.hidden = busy || next === "completed"; if (iconPause) iconPause.hidden = !busy; if (iconDone) iconDone.hidden = next !== "completed";
    if (floatPlayer) floatPlayer.classList.toggle("active", next !== "idle" && next !== "completed"); debug("state", { next, message });
  }
  function populateVoices() {
    const saved = selectVoice.value; voices = synth.getVoices(); selectVoice.replaceChildren(); let vietnamese = -1;
    voices.forEach((voice, index) => { const option = document.createElement("option"); option.value = String(index); option.textContent = `${voice.name} (${voice.lang})`; if (/vi|vietnamese/i.test(`${voice.lang} ${voice.name}`)) { option.textContent = `★ ${option.textContent}`; if (vietnamese < 0) vietnamese = index; } selectVoice.appendChild(option); });
    selectVoice.value = voices[Number(saved)] ? saved : String(Math.max(0, vietnamese));
  }
  function prepareContent() { paragraphOffsets = []; let offset = 0; Array.from(contentEl.querySelectorAll("p")).forEach((el) => { const text = (el.innerText || "").trim(); if (!text) return; paragraphOffsets.push({ el, text, start: offset, end: offset + text.length }); offset += text.length + 2; }); }
  function textFromCursor() { return paragraphOffsets.map((item, index) => index === currentParagraphIndex ? item.text.slice(currentOffset) : index > currentParagraphIndex ? item.text : "").filter(Boolean).join(". "); }
  function highlightParagraph(index) { paragraphOffsets.forEach((item, i) => item.el.classList.toggle("tts-speaking", i === index)); currentParagraphIndex = Math.max(0, Math.min(index, Math.max(0, paragraphOffsets.length - 1))); }
  function updateCursor(relativeOffset) { const base = paragraphOffsets.slice(0, currentParagraphIndex).reduce((total, item) => total + item.text.length + 2, 0) + currentOffset; const absolute = base + relativeOffset; const index = paragraphOffsets.findIndex((item) => absolute >= item.start && absolute <= item.end + 2); if (index >= 0) { highlightParagraph(index); currentOffset = Math.max(0, absolute - paragraphOffsets[index].start); } }
  function saveBookmark() { try { if (!currentEntry) return; const voice = voices[Number(selectVoice.value)]; localStorage.setItem(bookmarkKey, JSON.stringify({ version: 1, url: currentEntry.url, paragraphIndex: currentParagraphIndex, offset: currentOffset, rate: Number(selectRate?.value || 1), voice: voice ? { uri: voice.voiceURI, lang: voice.lang, name: voice.name } : null, savedAt: Date.now() })); } catch (_) {} }
  function restoreBookmark() { try { const bookmark = JSON.parse(localStorage.getItem(bookmarkKey) || "null"); if (!bookmark || bookmark.version !== 1 || bookmark.url !== location.href) return; currentParagraphIndex = Math.max(0, Math.min(Number(bookmark.paragraphIndex) || 0, Math.max(0, paragraphOffsets.length - 1))); currentOffset = Math.max(0, Number(bookmark.offset) || 0); if (selectRate && Number(bookmark.rate)) selectRate.value = String(bookmark.rate); if (bookmark.voice) { const index = voices.findIndex((voice) => voice.voiceURI === bookmark.voice.uri && voice.lang === bookmark.voice.lang); if (index >= 0) selectVoice.value = String(index); } highlightParagraph(currentParagraphIndex); if (statusText) statusText.textContent = "Đã khôi phục vị trí đọc."; } catch (_) {} }
  function absoluteUrl(value) { try { return value && value !== "#" ? new URL(value, location.href).href : ""; } catch (_) { return ""; } }
  function entryFromPage() { prepareContent(); const navigation = document.querySelector(".nav-links"); return { url: location.href, html: contentEl.innerHTML, title: document.title, header: document.querySelector(".story-header h1")?.textContent || "", chapterTitle: navigation?.querySelector("a:nth-child(2)")?.textContent || "", previousUrl: absoluteUrl(navigation?.querySelector("a:first-child")?.getAttribute("href") || ""), nextUrl: absoluteUrl(contentEl.dataset.nextUrl || window.nextChapterUrl || "") }; }
  function chapterPathFromReaderUrl(url) {
    const readerUrl = new URL(url, location.href), apiUrl = new URL(window.readerApiUrl || "/api/chapter.php", location.href);
    const basePath = apiUrl.pathname.replace(/\/api\/chapter\.php$/, "").replace(/\/$/, "");
    const prefix = `${basePath}/${window.readerSourceKey}/`;
    if (!readerUrl.pathname.startsWith(prefix)) throw new Error("Đường dẫn chương không thuộc nguồn hiện tại.");
    return decodeURIComponent(readerUrl.pathname.slice(prefix.length));
  }
  function htmlFromParagraphs(paragraphs) {
    const wrapper = document.createElement("div");
    paragraphs.forEach((paragraph) => { const item = document.createElement("p"); item.textContent = paragraph.text; wrapper.appendChild(item); });
    return wrapper.innerHTML;
  }
  function entryFromApi(payload, requestedUrl) {
    if (!payload || !Array.isArray(payload.paragraphs) || !payload.paragraphs.length) throw new Error("API không trả về nội dung chương.");
    return { url: requestedUrl, html: htmlFromParagraphs(payload.paragraphs), title: `${payload.storyTitle} - ${payload.chapterTitle}`, header: payload.storyTitle, chapterTitle: payload.chapterTitle, previousUrl: absoluteUrl(payload.previous?.url || ""), nextUrl: absoluteUrl(payload.next?.url || "") };
  }
  async function fetchEntry(url, signal) {
    const endpoint = new URL(window.readerApiUrl || "/api/chapter.php", location.href);
    endpoint.searchParams.set("s", window.readerSourceKey || "truyenfull");
    endpoint.searchParams.set("p", chapterPathFromReaderUrl(url));
    const response = await fetch(endpoint.href, { credentials: "same-origin", signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Tải chương thất bại (${response.status}).`);
    return entryFromApi(await response.json(), url);
  }
  function renderEntry(entry, pushHistory, preserveCursor = false) { contentEl.innerHTML = entry.html; contentEl.dataset.nextUrl = entry.nextUrl || ""; document.title = entry.title || document.title; const header = document.querySelector(".story-header h1"); if (header && entry.header) header.textContent = entry.header; document.querySelectorAll(".nav-links").forEach((navigation) => { const links = navigation.querySelectorAll("a"); if (links[0]) { links[0].href = entry.previousUrl || "#"; links[0].classList.toggle("disabled", !entry.previousUrl); } if (links[1] && entry.chapterTitle) links[1].textContent = entry.chapterTitle; if (links[2]) { links[2].href = entry.nextUrl || "#"; links[2].classList.toggle("disabled", !entry.nextUrl); } }); window.nextChapterUrl = entry.nextUrl || ""; if (pushHistory && entry.url !== location.href) history.replaceState(null, "", entry.url); prepareContent(); if (!preserveCursor) { currentParagraphIndex = 0; currentOffset = 0; } highlightParagraph(currentParagraphIndex); }
  function speakEntry(entry, runId) {
    if (runId !== sessionId) return; renderEntry(entry, true, currentEntry?.url === entry.url); currentEntry = entry; const text = textFromCursor(); if (!text) return finishSession();
    const utterance = new SpeechSynthesisUtterance(text), voice = voices[Number(selectVoice.value)]; if (voice) utterance.voice = voice; else utterance.lang = "vi-VN"; utterance.rate = Number(selectRate?.value || 1);
    utterance.onstart = () => { if (runId === sessionId) setState("playing", "Đang đọc..."); };
    utterance.onboundary = (event) => { if (runId === sessionId && (event.name === "word" || event.name === "sentence")) { updateCursor(event.charIndex); saveBookmark(); } };
    utterance.onend = () => { if (runId === sessionId) playNext(runId); };
    utterance.onerror = (event) => { if (runId === sessionId && !["canceled", "interrupted"].includes(event.error)) setState("error", "Lỗi đọc. Chạm để thử lại."); };
    try { synth.speak(utterance); } catch (_) { setState("error", "Không thể bắt đầu đọc. Chạm để thử lại."); }
  }
  async function prefetch(runId) {
    if (!continuous || prefetchPromise || runId !== sessionId) return prefetchPromise; prefetchController = new AbortController();
    prefetchPromise = (async () => { try { let tail = queuedEntries[queuedEntries.length - 1] || currentEntry; for (let count = queuedEntries.length; count < prefetchDepth && tail?.nextUrl; count += 1) { const next = await fetchEntry(tail.nextUrl, prefetchController.signal); if (runId !== sessionId || queuedEntries.some((item) => item.url === next.url) || next.url === currentEntry?.url) break; queuedEntries.push(next); tail = next; } } catch (error) { if (error.name !== "AbortError") debug("prefetch-error", { message: error.message }); } finally { prefetchPromise = null; prefetchController = null; } })(); return prefetchPromise;
  }
  function playNext(runId) { if (runId !== sessionId || ["paused", "idle"].includes(state)) return; if (!continuous) return finishSession(); const next = queuedEntries.shift(); if (next) { speakEntry(next, runId); prefetch(runId); return; } if (!currentEntry?.nextUrl) return finishSession(); setState("buffering", "Đang tải chương tiếp theo..."); prefetch(runId).then(() => { if (runId === sessionId && state === "buffering") playNext(runId); }); }
  function finishSession() { highlightParagraph(-1); setState("completed", "Đã đọc xong."); if (floatPlayer) floatPlayer.classList.add("done-flash"); }
  function cancelSpeech() { sessionId += 1; prefetchController?.abort(); prefetchController = null; prefetchPromise = null; try { synth.cancel(); if (synth.paused) synth.resume(); } catch (_) {} }
  function start() { if (state === "paused") { try { synth.resume(); setState("playing", "Đang đọc..."); return; } catch (_) {} } if (["playing", "starting", "buffering"].includes(state)) return; cancelSpeech(); const runId = sessionId; queuedEntries = []; currentEntry = currentEntry || entryFromPage(); if (state === "completed") { currentEntry = entryFromPage(); currentOffset = 0; currentParagraphIndex = 0; } if (floatPlayer) floatPlayer.classList.remove("done-flash"); setState("starting", "Đang chuẩn bị..."); speakEntry(currentEntry, runId); prefetch(runId); }
  function pause() { if (state === "playing" && synth.speaking) { synth.pause(); saveBookmark(); setState("paused", "Tạm dừng."); } }
  function stop() { cancelSpeech(); queuedEntries = []; currentEntry = entryFromPage(); currentParagraphIndex = 0; currentOffset = 0; highlightParagraph(-1); setState("idle", "Sẵn sàng — chạm để bắt đầu."); }
  function restartWithSettings() { if (!["playing", "paused"].includes(state)) return; const wasPaused = state === "paused"; cancelSpeech(); const runId = sessionId; queuedEntries = []; setState("starting", "Đang áp dụng thiết lập..."); speakEntry(currentEntry, runId); prefetch(runId); if (wasPaused) setTimeout(pause, 0); }
  function loadHistoryEntry() { const controller = new AbortController(); cancelSpeech(); queuedEntries = []; setState("starting", "Đang tải chương từ lịch sử..."); fetchEntry(location.href, controller.signal).then((entry) => { currentEntry = entry; renderEntry(entry, false); setState("idle", "Đã chuyển chương từ lịch sử."); }).catch(() => setState("error", "Không thể tải chương từ lịch sử.")); }

  populateVoices(); synth.addEventListener("voiceschanged", () => { populateVoices(); restoreBookmark(); }); currentEntry = entryFromPage(); restoreBookmark(); setState("idle", statusText?.textContent || "Sẵn sàng — chạm để bắt đầu.");
  btnPlay?.addEventListener("click", start); btnPause?.addEventListener("click", pause); btnStop?.addEventListener("click", stop); selectRate?.addEventListener("change", restartWithSettings); selectVoice.addEventListener("change", restartWithSettings);
  floatPlayPause?.addEventListener("click", () => { if (!wasDragged) state === "playing" ? pause() : start(); });
  floatPrev?.addEventListener("click", () => { if (currentParagraphIndex > 0) { currentParagraphIndex -= 1; currentOffset = 0; restartWithSettings(); } });
  floatNext?.addEventListener("click", () => { if (currentParagraphIndex < paragraphOffsets.length - 1) { currentParagraphIndex += 1; currentOffset = 0; restartWithSettings(); } });
  if (floatPlayer) { let startX = 0, initialX = 0; floatPlayer.addEventListener("touchstart", (event) => { wasDragged = false; startX = event.touches[0].clientX; initialX = floatPlayer.getBoundingClientRect().left; }, { passive: true }); floatPlayer.addEventListener("touchmove", (event) => { const delta = event.touches[0].clientX - startX; if (Math.abs(delta) > 8) { wasDragged = true; floatPlayer.style.left = `${Math.max(12, Math.min(innerWidth - floatPlayer.offsetWidth - 12, initialX + delta))}px`; floatPlayer.style.bottom = "auto"; } }, { passive: true }); }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveBookmark(); });
  window.addEventListener("popstate", loadHistoryEntry);
  window.addEventListener("beforeunload", () => { saveBookmark(); cancelSpeech(); });
});
