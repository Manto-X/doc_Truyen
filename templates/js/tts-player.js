// File: templates/js/tts-player.js
// Dual-Engine TTS Controller with RAM Blob Prefetching & MediaSession for doc_Truyen
(function (window, document) {
  'use strict';

  const basePath = (window.ttsApiUrl || '/api/tts.php').replace(/\/api\/tts\.php$/, '');
  const CONFIG = {
    ttsEndpoint: window.ttsApiUrl || '/api/tts.php',
    chapterEndpoint: window.readerApiUrl || '/api/chapter.php',
    prefetchAheadCount: 3,
    nextChapterPreloadThreshold: 0.70,
    defaultLang: 'vi',
    defaultSpeed: 1.0,
    storageKey: 'doc_truyen_reader_prefs_v2',
    artworkPaths: [
      { src: `${basePath}/assets/icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${basePath}/assets/icons/icon-512.png`, sizes: '512x512', type: 'image/png' }
    ]
  };

  /**
   * Engine 1: HTML5 Audio Stream + RAM Blob Prefetching
   * Keeps audio session alive across mobile lock screens (iOS AVAudioSessionCategoryPlayback / Android Foreground Service)
   */
  class AudioStreamEngine {
    constructor(controller) {
      this.controller = controller;
      this.audio = new Audio();
      this.audio.preload = 'auto';
      this.audio.playsInline = true;
      this.audio.crossOrigin = 'anonymous';

      // Key format: `${chapterId}:::${paragraphIndex}`
      this.blobCache = new Map();
      this.inflightFetches = new Map();
      this.abortControllers = new Map();

      this._bindAudioEvents();
    }

    _bindAudioEvents() {
      this.audio.addEventListener('ended', () => {
        this.controller.onChunkEnded();
      });

      this.audio.addEventListener('error', (err) => {
        console.warn('[AudioStreamEngine] Chunk playback error:', err);
        this.controller.handleEngineError(err);
      });

      this.audio.addEventListener('play', () => {
        this.controller.syncMediaSessionPlaybackState('playing');
        this.controller.updatePositionState(this.audio.currentTime, this.audio.duration);
      });

      this.audio.addEventListener('pause', () => {
        if (!this.audio.ended && !this.controller.isTransitioning) {
          this.controller.syncMediaSessionPlaybackState('paused');
          this.controller.updatePositionState(this.audio.currentTime, this.audio.duration);
        }
      });
    }

    _makeKey(chapterId, index) {
      return `${chapterId}:::${index}`;
    }

    _parseKey(key) {
      const idxSep = key.lastIndexOf(':::');
      if (idxSep === -1) {
        return { chapterId: key, index: -1 };
      }
      return {
        chapterId: key.slice(0, idxSep),
        index: parseInt(key.slice(idxSep + 3), 10)
      };
    }

    async prefetchChunk(chapterId, index, text, lang, speed) {
      const key = this._makeKey(chapterId, index);
      if (this.blobCache.has(key)) {
        return this.blobCache.get(key).blobUrl;
      }
      if (this.inflightFetches.has(key)) {
        return this.inflightFetches.get(key);
      }

      const abortCtrl = new AbortController();
      this.abortControllers.set(key, abortCtrl);

      const fetchPromise = (async () => {
        try {
          const params = new URLSearchParams({
            text: text,
            lang: lang || CONFIG.defaultLang,
            speed: String(speed || CONFIG.defaultSpeed)
          });

          const response = await fetch(`${CONFIG.ttsEndpoint}?${params.toString()}`, {
            method: 'GET',
            signal: abortCtrl.signal,
            headers: { 'Accept': 'audio/mpeg' }
          });

          if (!response.ok) {
            throw new Error(`HTTP_${response.status}`);
          }

          const blob = await response.blob();
          if (blob.size < 64) {
            throw new Error('INVALID_AUDIO_BLOB');
          }

          const blobUrl = URL.createObjectURL(blob);
          this.blobCache.set(key, {
            blobUrl: blobUrl,
            timestamp: Date.now()
          });

          return blobUrl;
        } finally {
          this.inflightFetches.delete(key);
          this.abortControllers.delete(key);
        }
      })();

      this.inflightFetches.set(key, fetchPromise);
      return fetchPromise;
    }

    async playChunk(chapterId, index, text, lang, speed) {
      const key = this._makeKey(chapterId, index);
      let blobUrl = this.blobCache.has(key) ? this.blobCache.get(key).blobUrl : null;

      if (!blobUrl) {
        blobUrl = await this.prefetchChunk(chapterId, index, text, lang, speed);
      }

      this.audio.src = blobUrl;
      this.audio.playbackRate = speed || CONFIG.defaultSpeed;

      const playPromise = this.audio.play();
      if (playPromise !== undefined) {
        await playPromise;
      }
    }

    /**
     * Synchronous lock-screen transition: assigns pre-buffered Blob URL immediately
     * inside the audio 'ended' callback so the OS audio session is never torn down.
     */
    playPrebufferedSync(chapterId, index, speed) {
      const key = this._makeKey(chapterId, index);
      const cached = this.blobCache.get(key);
      if (!cached || !cached.blobUrl) {
        return false;
      }

      this.audio.src = cached.blobUrl;
      this.audio.playbackRate = speed || CONFIG.defaultSpeed;
      const playPromise = this.audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('[AudioStreamEngine] Sync transition play rejected:', err);
          this.controller.handleEngineError(err);
        });
      }
      return true;
    }

    pause() {
      this.audio.pause();
    }

    resume() {
      if (this.audio.src) {
        return this.audio.play();
      }
      return Promise.resolve();
    }

    stop() {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }

    setSpeed(speed) {
      this.audio.playbackRate = speed;
    }

    seekTo(seconds) {
      if (!isNaN(this.audio.duration) && isFinite(this.audio.duration)) {
        this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration));
        this.controller.updatePositionState(this.audio.currentTime, this.audio.duration);
      }
    }

    evictOldBlobs(activeChapterId, currentIndex) {
      for (const [key, entry] of this.blobCache.entries()) {
        const parsed = this._parseKey(key);
        if (String(parsed.chapterId) === String(activeChapterId) && parsed.index < currentIndex - 1) {
          URL.revokeObjectURL(entry.blobUrl);
          this.blobCache.delete(key);
        }
      }
    }

    purgeChapterBlobs(chapterIdToPurge) {
      for (const [key, entry] of this.blobCache.entries()) {
        const parsed = this._parseKey(key);
        if (String(parsed.chapterId) === String(chapterIdToPurge)) {
          URL.revokeObjectURL(entry.blobUrl);
          this.blobCache.delete(key);
        }
      }
      for (const [key, ctrl] of this.abortControllers.entries()) {
        const parsed = this._parseKey(key);
        if (String(parsed.chapterId) === String(chapterIdToPurge)) {
          ctrl.abort();
          this.abortControllers.delete(key);
        }
      }
    }

    destroy() {
      this.stop();
      for (const [, ctrl] of this.abortControllers.entries()) {
        ctrl.abort();
      }
      this.abortControllers.clear();
      for (const [, entry] of this.blobCache.entries()) {
        URL.revokeObjectURL(entry.blobUrl);
      }
      this.blobCache.clear();
    }
  }

  /**
   * Engine 2: Native WebSpeech Synthesis (Fallback)
   */
  class WebSpeechEngine {
    constructor(controller) {
      this.controller = controller;
      this.synth = window.speechSynthesis || null;
      this.utterance = null;
    }

    isSupported() {
      return Boolean(this.synth && typeof window.SpeechSynthesisUtterance !== 'undefined');
    }

    async prefetchChunk() {
      return Promise.resolve(null);
    }

    playPrebufferedSync() {
      return false;
    }

    async playChunk(chapterId, index, text, lang, speed) {
      if (!this.isSupported()) {
        throw new Error('WEBSPEECH_NOT_SUPPORTED');
      }

      this.synth.cancel();

      return new Promise((resolve, reject) => {
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = lang === 'vi' ? 'vi-VN' : lang;
        utter.rate = speed || CONFIG.defaultSpeed;

        const voices = this.synth.getVoices();
        const viVoice = voices.find((v) => /vi|vietnamese/i.test(`${v.lang} ${v.name}`));
        if (viVoice) {
          utter.voice = viVoice;
        }

        utter.onstart = () => {
          this.controller.syncMediaSessionPlaybackState('playing');
          resolve();
        };

        utter.onend = () => {
          this.controller.onChunkEnded();
        };

        utter.onerror = (e) => {
          if (e.error === 'canceled' || e.error === 'interrupted') {
            return;
          }
          reject(e);
        };

        this.utterance = utter;
        this.synth.speak(utter);
      });
    }

    pause() {
      if (this.synth && this.synth.speaking) {
        this.synth.pause();
        this.controller.syncMediaSessionPlaybackState('paused');
      }
    }

    resume() {
      if (this.synth && this.synth.paused) {
        this.synth.resume();
        this.controller.syncMediaSessionPlaybackState('playing');
      }
      return Promise.resolve();
    }

    stop() {
      if (this.synth) {
        this.synth.cancel();
      }
    }

    setSpeed() {}
    seekTo() {}
    evictOldBlobs() {}
    purgeChapterBlobs() {}
  }

  /**
   * Master TTS Reader Controller
   */
  class TTSPlayerController {
    constructor() {
      this.streamEngine = new AudioStreamEngine(this);
      this.speechEngine = new WebSpeechEngine(this);

      this.activeEngineType = 'stream'; // Default: stream (Safe for background lock-screen)
      this.isPlaying = false;
      this.isPaused = false;
      this.isTransitioning = false;
      this.autoNextChapter = true;
      this.speed = CONFIG.defaultSpeed;
      this.lang = CONFIG.defaultLang;

      this.storyTitle = window.storyTitle || document.querySelector('.story-header h1')?.textContent?.trim() || 'Đọc Truyện';
      this.chapterTitle = window.chapterTitle || document.querySelector('.nav-links a:nth-child(2)')?.textContent?.trim() || 'Chương hiện tại';
      this.currentUrl = location.href;
      this.nextChapterUrl = window.nextChapterUrl || '';

      this.paragraphs = []; // Array<{ el: HTMLElement, text: string }>
      this.currentIndex = 0;

      this.stagedNextChapter = null;
      this.isPreloadingNextChapter = false;
      this._preloadPromise = null;
      this._retryCount = 0;
      this.wakeLock = null;

      this._loadPreferences();
      this._bindDOMElements();
      this._parseCurrentChapterDOM();
      this._setupMediaSession();
      this._setupVisibilityHandlers();
      this._setupFloatingPlayerTouch();

      this._updateStatusUI('Sẵn sàng — chạm để bắt đầu.');
    }

    get engine() {
      return this.activeEngineType === 'stream' ? this.streamEngine : this.speechEngine;
    }

    _loadPreferences() {
      try {
        const raw = localStorage.getItem(CONFIG.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (typeof parsed.speed === 'number' && parsed.speed >= 0.5 && parsed.speed <= 2.5) {
            this.speed = parsed.speed;
          }
          if (typeof parsed.autoNextChapter === 'boolean') {
            this.autoNextChapter = parsed.autoNextChapter;
          }
          if (parsed.engine === 'stream' || parsed.engine === 'speech') {
            this.activeEngineType = parsed.engine;
          }
        }
      } catch (e) {
        console.warn('[TTSPlayer] Failed to load preferences:', e);
      }
    }

    _savePreferences() {
      try {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify({
          speed: this.speed,
          autoNextChapter: this.autoNextChapter,
          engine: this.activeEngineType
        }));
      } catch (_) {}
    }

    _bindDOMElements() {
      this.btnPlay = document.getElementById('tts-play');
      this.btnPause = document.getElementById('tts-pause');
      this.btnStop = document.getElementById('tts-stop');
      this.selectRate = document.getElementById('tts-rate');
      this.selectEngine = document.getElementById('tts-engine-select');
      this.statusText = document.getElementById('tts-status');

      this.floatPlayer = document.getElementById('tts-floating-player');
      this.floatPlayPause = document.getElementById('tts-float-playpause');
      this.iconPlay = document.getElementById('icon-play');
      this.iconPause = document.getElementById('icon-pause');
      this.iconDone = document.getElementById('icon-done');
      this.floatPrev = document.getElementById('tts-float-prev');
      this.floatNext = document.getElementById('tts-float-next');

      if (this.selectRate) {
        this.selectRate.value = String(this.speed);
        this.selectRate.addEventListener('change', (e) => {
          this.speed = parseFloat(e.target.value) || 1.0;
          this.engine.setSpeed(this.speed);
          this._savePreferences();
        });
      }

      if (this.selectEngine) {
        this.selectEngine.value = this.activeEngineType;
        this.selectEngine.addEventListener('change', (e) => {
          const wasPlaying = this.isPlaying && !this.isPaused;
          this.engine.stop();
          this.activeEngineType = e.target.value;
          this._savePreferences();
          if (wasPlaying) {
            this.playCurrentChunk();
          }
        });
      }

      this.btnPlay?.addEventListener('click', () => this.start());
      this.btnPause?.addEventListener('click', () => this.pause());
      this.btnStop?.addEventListener('click', () => this.stop());

      this.floatPlayPause?.addEventListener('click', () => {
        if (!this.wasDragged) {
          (this.isPlaying && !this.isPaused) ? this.pause() : this.start();
        }
      });

      this.floatPrev?.addEventListener('click', () => this.previousChunk());
      this.floatNext?.addEventListener('click', () => this.nextChunk());
    }

    _parseCurrentChapterDOM() {
      const contentEl = document.querySelector('.story-content');
      this.paragraphs = [];
      if (!contentEl) return;

      const pNodes = contentEl.querySelectorAll('p');
      pNodes.forEach((node, index) => {
        const text = (node.innerText || '').trim();
        if (text) {
          node.classList.add('tts-paragraph-node');
          node.dataset.paragraphIndex = String(index);
          this.paragraphs.push({ el: node, text: text });
        }
      });

      // Allow clicking on any paragraph to jump directly to it
      contentEl.addEventListener('click', (e) => {
        const pNode = e.target.closest('.tts-paragraph-node');
        if (pNode) {
          const idx = this.paragraphs.findIndex((item) => item.el === pNode);
          if (idx !== -1) {
            this.currentIndex = idx;
            this.playCurrentChunk();
          }
        }
      });
    }

    _updateStatusUI(message) {
      if (this.statusText && message) {
        this.statusText.textContent = message;
      }

      const active = this.isPlaying && !this.isPaused;
      if (this.btnPlay) this.btnPlay.hidden = active;
      if (this.btnPause) this.btnPause.hidden = !active;

      if (this.iconPlay) this.iconPlay.style.display = active ? 'none' : 'block';
      if (this.iconPause) this.iconPause.style.display = active ? 'block' : 'none';
      if (this.iconDone) this.iconDone.style.display = 'none';

      if (this.floatPlayer) {
        this.floatPlayer.classList.toggle('active', this.isPlaying);
      }
    }

    _highlightParagraph(index) {
      this.paragraphs.forEach((item, i) => {
        item.el.classList.toggle('tts-speaking', i === index);
      });

      const currentItem = this.paragraphs[index];
      if (currentItem && currentItem.el && document.visibilityState === 'visible') {
        const rect = currentItem.el.getBoundingClientRect();
        const viewHeight = window.innerHeight || document.documentElement.clientHeight;
        if (rect.top < 80 || rect.bottom > viewHeight - 100) {
          currentItem.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }

    /**
     * Sliding Window Prefetching: keeps upcoming 3 MP3 chunks in RAM Blob cache.
     * Fires cross-chapter preloader when 70% threshold is reached.
     */
    _schedulePrefetchWindow() {
      if (this.activeEngineType !== 'stream') return;

      const total = this.paragraphs.length;
      if (total === 0) return;

      const chapterId = this.currentUrl;

      // 1. Prefetch next N chunks in current chapter
      for (let offset = 1; offset <= CONFIG.prefetchAheadCount; offset++) {
        const targetIdx = this.currentIndex + offset;
        if (targetIdx < total) {
          const text = this.paragraphs[targetIdx].text;
          this.streamEngine.prefetchChunk(
            chapterId,
            targetIdx,
            text,
            this.lang,
            this.speed
          ).catch(() => {});
        }
      }

      // 2. Free RAM for Blobs already played (Critical Bug Fix: cleanly parses key and evicts)
      this.streamEngine.evictOldBlobs(chapterId, this.currentIndex);

      // 3. Preload next chapter when >= 70% progress reached
      const progressRatio = (this.currentIndex + 1) / total;
      if (
        this.autoNextChapter &&
        progressRatio >= CONFIG.nextChapterPreloadThreshold &&
        !this.stagedNextChapter &&
        !this.isPreloadingNextChapter &&
        this.nextChapterUrl
      ) {
        this._preloadNextChapter();
      }
    }

    _chapterPathFromReaderUrl(url) {
      try {
        const readerUrl = new URL(url, location.href);
        const apiUrl = new URL(CONFIG.chapterEndpoint, location.href);
        const basePath = apiUrl.pathname.replace(/\/api\/chapter\.php$/, '').replace(/\/$/, '');
        const prefix = `${basePath}/${window.readerSourceKey || 'truyenfull'}/`;
        if (readerUrl.pathname.startsWith(prefix)) {
          return decodeURIComponent(readerUrl.pathname.slice(prefix.length));
        }
        return readerUrl.pathname;
      } catch (_) {
        return url;
      }
    }

    async _preloadNextChapter() {
      if (!this.nextChapterUrl) return;
      if (this._preloadPromise) return this._preloadPromise;

      this.isPreloadingNextChapter = true;

      this._preloadPromise = (async () => {
        try {
          const endpoint = new URL(CONFIG.chapterEndpoint, location.href);
          endpoint.searchParams.set('s', window.readerSourceKey || 'truyenfull');
          endpoint.searchParams.set('p', this._chapterPathFromReaderUrl(this.nextChapterUrl));

          const response = await fetch(endpoint.href, {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
          });

          if (!response.ok) {
            throw new Error(`API_${response.status}`);
          }

          const payload = await response.json();
          if (!payload || !Array.isArray(payload.paragraphs) || !payload.paragraphs.length) {
            throw new Error('EMPTY_CHAPTER');
          }

          this.stagedNextChapter = {
            url: this.nextChapterUrl,
            storyTitle: payload.storyTitle || this.storyTitle,
            chapterTitle: payload.chapterTitle || 'Chương kế tiếp',
            paragraphs: payload.paragraphs.map((p) => p.text),
            previousUrl: payload.previous?.url || '',
            nextUrl: payload.next?.url || ''
          };

          // Pre-warm the first 3 MP3 Blobs in parallel with Promise.all
          const preCount = Math.min(CONFIG.prefetchAheadCount, this.stagedNextChapter.paragraphs.length);
          const tasks = [];
          for (let i = 0; i < preCount; i++) {
            tasks.push(
              this.streamEngine.prefetchChunk(
                this.stagedNextChapter.url,
                i,
                this.stagedNextChapter.paragraphs[i],
                this.lang,
                this.speed
              ).catch(() => {})
            );
          }
          await Promise.all(tasks);
        } catch (err) {
          console.warn('[TTSPlayer] Next chapter preload failed:', err);
        } finally {
          this.isPreloadingNextChapter = false;
          this._preloadPromise = null;
        }
      })();

      return this._preloadPromise;
    }

    async start() {
      if (!this.isPlaying) {
        this.isPlaying = true;
        this.isPaused = false;
        await this._requestWakeLock();
        await this.playCurrentChunk();
      } else if (this.isPaused) {
        this.isPaused = false;
        await this.engine.resume();
        this._updateStatusUI(`Đang đọc đoạn ${this.currentIndex + 1}/${this.paragraphs.length}`);
      }
    }

    pause() {
      if (this.isPlaying && !this.isPaused) {
        this.isPaused = true;
        this.engine.pause();
        this._updateStatusUI(`Tạm dừng (${this.currentIndex + 1}/${this.paragraphs.length})`);
      }
    }

    stop() {
      this.isPlaying = false;
      this.isPaused = false;
      this.engine.stop();
      this.currentIndex = 0;
      this._retryCount = 0;
      this._highlightParagraph(-1);
      this._releaseWakeLock();
      this.syncMediaSessionPlaybackState('none');
      this._updateStatusUI('Đã dừng đọc.');
    }

    async playCurrentChunk() {
      if (this.paragraphs.length === 0) {
        this._parseCurrentChapterDOM();
        if (this.paragraphs.length === 0) {
          this._updateStatusUI('Không tìm thấy nội dung.');
          return;
        }
      }

      if (this.currentIndex < 0) this.currentIndex = 0;
      if (this.currentIndex >= this.paragraphs.length) {
        if (this.autoNextChapter) {
          await this.advanceToNextChapter(true);
        } else {
          this.finishChapter();
        }
        return;
      }

      const currentItem = this.paragraphs[this.currentIndex];
      this._highlightParagraph(this.currentIndex);
      this._updateStatusUI(`Đang đọc ${this.currentIndex + 1}/${this.paragraphs.length} - ${this.chapterTitle}`);
      this.updateMediaSessionMetadata();
      this._schedulePrefetchWindow();

      try {
        await this.engine.playChunk(
          this.currentUrl,
          this.currentIndex,
          currentItem.text,
          this.lang,
          this.speed
        );
        this._retryCount = 0;
      } catch (err) {
        this.handleEngineError(err);
      }
    }

    onChunkEnded() {
      if (!this.isPlaying || this.isPaused) return;
      this._retryCount = 0;

      const nextIdx = this.currentIndex + 1;
      if (nextIdx < this.paragraphs.length) {
        this.currentIndex = nextIdx;
        // Zero-gap synchronous Blob swap
        if (
          this.activeEngineType === 'stream' &&
          this.streamEngine.playPrebufferedSync(this.currentUrl, this.currentIndex, this.speed)
        ) {
          this._highlightParagraph(this.currentIndex);
          this._updateStatusUI(`Đang đọc ${this.currentIndex + 1}/${this.paragraphs.length} - ${this.chapterTitle}`);
          this._schedulePrefetchWindow();
          return;
        }
        this.playCurrentChunk();
        return;
      }

      // Reached the end of the chapter
      if (this.autoNextChapter) {
        this.advanceToNextChapter(true);
      } else {
        this.finishChapter();
      }
    }

    /**
     * Seamless Cross-Chapter Transition:
     * Swaps pre-buffered Blob 0 of Chapter K+1 synchronously inside the 'ended' tick
     * before DOM updates, keeping lock-screen background playback alive.
     */
    async advanceToNextChapter(keepPlaying = true) {
      if (this.isTransitioning) return;
      this.isTransitioning = true;
      const oldChapterUrl = this.currentUrl;

      try {
        if (!this.stagedNextChapter) {
          this._updateStatusUI('Đang nạp chương tiếp theo...');
          await this._preloadNextChapter();
        }

        if (this.stagedNextChapter && this.stagedNextChapter.paragraphs.length > 0) {
          const staged = this.stagedNextChapter;
          this.stagedNextChapter = null;

          let startedSync = false;
          if (keepPlaying && this.activeEngineType === 'stream') {
            startedSync = this.streamEngine.playPrebufferedSync(staged.url, 0, this.speed);
          }

          this._applyStagedChapterToDOM(staged);
          this.streamEngine.purgeChapterBlobs(oldChapterUrl);

          if (keepPlaying) {
            this.isPlaying = true;
            this.isPaused = false;
            if (startedSync) {
              this._highlightParagraph(0);
              this._updateStatusUI(`Đang đọc 1/${this.paragraphs.length} - ${this.chapterTitle}`);
              this.updateMediaSessionMetadata();
              this._schedulePrefetchWindow();
            } else {
              await this.playCurrentChunk();
            }
          }
        } else {
          // Fallback to URL navigation if API cannot prefetch
          if (this.nextChapterUrl) {
            location.href = this.nextChapterUrl;
          } else {
            this.finishChapter();
          }
        }
      } finally {
        this.isTransitioning = false;
      }
    }

    _applyStagedChapterToDOM(staged) {
      this.currentUrl = staged.url;
      this.nextChapterUrl = staged.nextUrl;
      this.chapterTitle = staged.chapterTitle;
      this.storyTitle = staged.storyTitle;
      this.currentIndex = 0;

      document.title = `${this.storyTitle} - ${this.chapterTitle}`;

      // Update Nav titles and links
      document.querySelectorAll('.navigation').forEach((nav) => {
        const links = nav.querySelectorAll('.nav-links a');
        if (links[0]) {
          links[0].href = staged.previousUrl || '#';
          links[0].classList.toggle('disabled', !staged.previousUrl);
        }
        if (links[1]) {
          links[1].textContent = staged.chapterTitle;
        }
        if (links[2]) {
          links[2].href = staged.nextUrl || '#';
          links[2].classList.toggle('disabled', !staged.nextUrl);
        }
      });

      // Update Content Box
      const contentEl = document.querySelector('.story-content');
      this.paragraphs = [];
      if (contentEl) {
        contentEl.innerHTML = '';
        const fragment = document.createDocumentFragment();
        staged.paragraphs.forEach((text, i) => {
          const p = document.createElement('p');
          p.className = 'tts-paragraph-node';
          p.dataset.paragraphIndex = String(i);
          p.textContent = text;
          fragment.appendChild(p);
          this.paragraphs.push({ el: p, text: text });
        });
        contentEl.appendChild(fragment);
      }

      if (window.history && window.history.replaceState) {
        history.replaceState(null, '', staged.url);
      }

      if (document.visibilityState === 'visible') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }

    previousChunk() {
      if (this.currentIndex > 0) {
        this.currentIndex--;
        if (this.isPlaying && !this.isPaused) {
          this.playCurrentChunk();
        } else {
          this._highlightParagraph(this.currentIndex);
        }
      }
    }

    nextChunk() {
      if (this.currentIndex < this.paragraphs.length - 1) {
        this.currentIndex++;
        if (this.isPlaying && !this.isPaused) {
          this.playCurrentChunk();
        } else {
          this._highlightParagraph(this.currentIndex);
        }
      } else if (this.autoNextChapter) {
        this.advanceToNextChapter(this.isPlaying && !this.isPaused);
      }
    }

    finishChapter() {
      this.stop();
      this._updateStatusUI('Đã đọc xong chương.');
      if (this.floatPlayer) {
        this.floatPlayer.classList.add('done-flash');
        setTimeout(() => this.floatPlayer?.classList.remove('done-flash'), 2500);
      }
    }

    handleEngineError(err) {
      console.warn('[TTSPlayer] Engine error:', err);
      // Critical Bug Fix: Do NOT permanently downgrade to WebSpeech during background streaming!
      // Permanent downgrade kills background playback when screen is locked.
      // Instead, retry the chunk once, or skip to the next chunk if retry fails.
      if (!this._retryCount) this._retryCount = 0;
      if (this._retryCount < 1) {
        this._retryCount++;
        setTimeout(() => {
          if (this.isPlaying && !this.isPaused) {
            this.playCurrentChunk();
          }
        }, 500);
      } else {
        this._retryCount = 0;
        setTimeout(() => {
          if (this.isPlaying && !this.isPaused) {
            this.onChunkEnded();
          }
        }, 300);
      }
    }

    _setupMediaSession() {
      if (!('mediaSession' in navigator)) return;
      this.updateMediaSessionMetadata();

      const handlers = {
        play: () => this.start(),
        pause: () => this.pause(),
        previoustrack: () => this.previousChunk(),
        nexttrack: () => this.nextChunk(),
        stop: () => this.stop()
      };

      for (const [action, handler] of Object.entries(handlers)) {
        try {
          navigator.mediaSession.setActionHandler(action, handler);
        } catch (_) {}
      }
    }

    updateMediaSessionMetadata() {
      if (!('mediaSession' in navigator) || typeof window.MediaMetadata === 'undefined') return;

      navigator.mediaSession.metadata = new MediaMetadata({
        title: `${this.chapterTitle} (Đoạn ${this.currentIndex + 1}/${Math.max(1, this.paragraphs.length)})`,
        artist: this.storyTitle,
        album: 'doc_Truyen Audio',
        artwork: CONFIG.artworkPaths
      });
    }

    syncMediaSessionPlaybackState(state) {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = state;
      }
    }

    updatePositionState(position, duration) {
      if (
        'mediaSession' in navigator &&
        typeof navigator.mediaSession.setPositionState === 'function' &&
        isFinite(duration) &&
        duration > 0
      ) {
        try {
          navigator.mediaSession.setPositionState({
            duration: duration,
            playbackRate: this.speed,
            position: Math.min(position, duration)
          });
        } catch (_) {}
      }
    }

    async _requestWakeLock() {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        try {
          this.wakeLock = await navigator.wakeLock.request('screen');
        } catch (_) {}
      }
    }

    _releaseWakeLock() {
      if (this.wakeLock) {
        this.wakeLock.release().catch(() => {});
        this.wakeLock = null;
      }
    }

    _setupVisibilityHandlers() {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.isPlaying && !this.isPaused) {
          this._highlightParagraph(this.currentIndex);
          this._requestWakeLock();
        }
      });
    }

    _setupFloatingPlayerTouch() {
      if (!this.floatPlayer) return;
      let startX = 0, initialX = 0;
      this.wasDragged = false;

      this.floatPlayer.addEventListener('touchstart', (e) => {
        this.wasDragged = false;
        startX = e.touches[0].clientX;
        initialX = this.floatPlayer.getBoundingClientRect().left;
      }, { passive: true });

      this.floatPlayer.addEventListener('touchmove', (e) => {
        const delta = e.touches[0].clientX - startX;
        if (Math.abs(delta) > 8) {
          this.wasDragged = true;
          const maxLeft = window.innerWidth - this.floatPlayer.offsetWidth - 12;
          this.floatPlayer.style.left = `${Math.max(12, Math.min(maxLeft, initialX + delta))}px`;
        }
      }, { passive: true });
    }
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.DocTruyenPlayer = new TTSPlayerController();
    });
  } else {
    window.DocTruyenPlayer = new TTSPlayerController();
  }
})(window, document);
