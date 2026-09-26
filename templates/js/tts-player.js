document.addEventListener("DOMContentLoaded", function () {
  // 1. Check Browser Support
  if (!("speechSynthesis" in window)) {
    console.warn("Web Speech API not supported in this browser.");
    return;
  }

  const synth = window.speechSynthesis;
  let utterance = null;
  let isPlaying = false;
  let isPaused = false;
  let isDoneState = false;
  let voices = [];

  // Data Structures for Single-Stream Logic
  let fullText = "";
  let paragraphOffsets = []; // [{start: 0, end: 50, el: pNode}, ...]
  let currentParagraphIndex = -1;

  // Background Keep-alive Objects
  let wakeLock = null;
  let audioCtx = null;
  let keepAliveOsc = null;
  let keepAliveInterval = null; // Chrome 15s timeout preventer

  // UI Elements
  const playerBar = document.getElementById("tts-player-bar");
  const selectVoice = document.createElement("select");
  selectVoice.id = "tts-voice";
  const selectRate = document.getElementById("tts-rate");
  if (playerBar) {
    playerBar.insertBefore(selectVoice, selectRate);
  }

  const contentEl = document.querySelector(".story-content");
  const btnPlay = document.getElementById("tts-play");
  const btnPause = document.getElementById("tts-pause");
  const btnStop = document.getElementById("tts-stop");
  const statusText = document.getElementById("tts-status");
  const floatPlayerPosKey = "floatPlayerPos";

  if (!contentEl) return;

  // Clean up any stale queues on reload
  try {
    synth.cancel();
  } catch (e) {}

  // --- PREPARATION ---

  function prepareContent() {
    const paragraphs = Array.from(contentEl.querySelectorAll("p"));
    fullText = "";
    paragraphOffsets = [];
    let currentLength = 0;

    paragraphs.forEach((p, index) => {
      const text = p.innerText.trim();
      if (text.length > 0) {
        // Add a pause (period space) between paragraphs for natural reading
        const segment = text + " . ";

        paragraphOffsets.push({
          start: currentLength,
          end: currentLength + text.length,
          el: p,
          index: index,
        });

        fullText += segment;
        currentLength += segment.length;
      }
    });
  }
  prepareContent();

  // --- VOICE MANAGEMENT ---

  function populateVoices() {
    voices = synth.getVoices();
    selectVoice.innerHTML = "";
    let defaultViIndex = -1;

    voices.forEach((voice, index) => {
      const option = document.createElement("option");
      option.textContent = `${voice.name} (${voice.lang})`;
      option.value = index;

      if (voice.lang.includes("vi") || voice.name.includes("Vietnamese")) {
        option.style.fontWeight = "bold";
        option.textContent = "★ " + option.textContent;

        if (defaultViIndex === -1) {
          defaultViIndex = index;
        } else {
          const currentBest = voices[defaultViIndex].name.toLowerCase();
          const candidate = voice.name.toLowerCase();
          if (candidate.includes("google") && !currentBest.includes("google"))
            defaultViIndex = index;
          else if (candidate.includes("hoai") && !currentBest.includes("google"))
            defaultViIndex = index;
        }
      }
      selectVoice.appendChild(option);
    });

    if (defaultViIndex !== -1) selectVoice.selectedIndex = defaultViIndex;
  }

  populateVoices();
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = populateVoices;
  }

  // --- KEEP ALIVE LOGIC (WakeLock & AudioContext) ---

  async function requestWakeLock() {
    if ("wakeLock" in navigator) {
      try {
        wakeLock = await navigator.wakeLock.request("screen");
      } catch (err) {
        console.warn("Wake Lock error:", err);
      }
    }
  }

  function releaseWakeLock() {
    if (wakeLock !== null) {
      try {
        wakeLock.release().then(() => (wakeLock = null));
      } catch (e) {
        wakeLock = null;
      }
    }
  }

  function startAudioKeepAlive() {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === "suspended") {
        audioCtx.resume();
      }
      if (!keepAliveOsc) {
        keepAliveOsc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0.001; // nearly silent
        keepAliveOsc.frequency.value = 1; // 1Hz
        keepAliveOsc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        keepAliveOsc.start();
      }
    } catch (e) {
      console.warn("AudioContext keepalive error:", e);
    }
  }

  function stopAudioKeepAlive() {
    try {
      if (keepAliveOsc) {
        keepAliveOsc.stop();
        keepAliveOsc.disconnect();
        keepAliveOsc = null;
      }
      if (audioCtx && audioCtx.state === "running") {
        audioCtx.suspend();
      }
    } catch (e) {
      console.warn("AudioContext stop error:", e);
    }
  }

  // Anti-stale speech keepalive: pause/resume every 10s to keep Chromium voice running
  function startSpeechKeepAlive() {
    if (keepAliveInterval) clearInterval(keepAliveInterval);
    keepAliveInterval = setInterval(() => {
      if (synth.speaking && !synth.paused) {
        try {
          synth.pause();
          synth.resume();
        } catch (e) {
          console.warn("Keepalive pause/resume failed:", e);
        }
      }
    }, 10000);
  }

  function stopSpeechKeepAlive() {
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
  }

  function setupMediaSession() {
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: document.title.split(" - ")[1] || "Đang đọc",
          artist: document.title.split(" - ")[0] || "Truyện",
        });
        navigator.mediaSession.setActionHandler("play", play);
        navigator.mediaSession.setActionHandler("pause", pause);
        navigator.mediaSession.setActionHandler("stop", stop);
      } catch (err) {
        console.warn("MediaSession setup failed:", err);
      }
    }
  }

  // --- HIGHLIGHTING LOGIC ---

  function highlightParagraph(index) {
    if (index === currentParagraphIndex) return;

    if (currentParagraphIndex !== -1 && paragraphOffsets[currentParagraphIndex]) {
      paragraphOffsets[currentParagraphIndex].el.classList.remove("tts-speaking");
    }

    currentParagraphIndex = index;

    if (index !== -1 && paragraphOffsets[index]) {
      const pData = paragraphOffsets[index];
      pData.el.classList.add("tts-speaking");

      const progress = Math.round(((index + 1) / paragraphOffsets.length) * 100);
      statusText.textContent = `Đọc đoạn ${index + 1}/${paragraphOffsets.length} (${progress}%)`;
    }
  }

  function updateHighlight(charIndex) {
    for (let i = 0; i < paragraphOffsets.length; i++) {
      const p = paragraphOffsets[i];
      if (charIndex >= p.start && charIndex < p.start + (p.end - p.start + 5)) {
        highlightParagraph(i);
        return;
      }
    }
  }

  // --- PLAYBACK CONTROL ---

  function speak() {
    try {
      synth.cancel();
    } catch (e) {}

    let textToRead = fullText;
    let baseOffset = 0;

    if (currentParagraphIndex > 0) {
      const pStart = paragraphOffsets[currentParagraphIndex].start;
      textToRead = fullText.substring(pStart);
      baseOffset = pStart;
    }

    if (!textToRead.trim()) {
      statusText.textContent = "Hết nội dung.";
      return;
    }

    utterance = new SpeechSynthesisUtterance(textToRead);

    const selectedVoiceIndex = selectVoice.value;
    if (voices[selectedVoiceIndex]) utterance.voice = voices[selectedVoiceIndex];
    else utterance.lang = "vi-VN";
    utterance.rate = parseFloat(selectRate.value);

    // Keep global reference to prevent garbage collection
    window.activeUtterance = utterance;

    utterance.onstart = function () {
      isPlaying = true;
      isPaused = false;
      updateUI();
      startSpeechKeepAlive();
      if (currentParagraphIndex === -1) highlightParagraph(0);
    };

    utterance.onend = function () {
      stopSpeechKeepAlive();
      if (isPlaying) {
        statusText.textContent = "Đã đọc xong.";
        highlightParagraph(-1);
        isPlaying = false;
        isPaused = false;
        
        if (window.isAutoPlayMode && window.nextChapterUrl) {
          autoAdvanceChapter();
          return;
        }

        if (floatPlayer) {
          isDoneState = true;
          floatPlayer.classList.add("done-flash");
          wakeUpFloatingPlayer();
        }
        updateUI();
        stopAudioKeepAlive();
        releaseWakeLock();
      }
    };

    utterance.onerror = function (e) {
      stopSpeechKeepAlive();
      if (e.error !== "interrupted" && e.error !== "canceled") {
        console.error("TTS Error:", e.error);
        statusText.textContent = "Lỗi: " + e.error;
        isPlaying = false;
        updateUI();
        stopAudioKeepAlive();
        releaseWakeLock();
      }
    };

    utterance.onboundary = function (event) {
      if (event.name === "word" || event.name === "sentence") {
        const absoluteIndex = baseOffset + event.charIndex;
        updateHighlight(absoluteIndex);
      }
    };

    try {
      synth.speak(utterance);
    } catch (err) {
      console.error("synth.speak failed:", err);
    }
  }

  function autoAdvanceChapter() {
    statusText.textContent = "Đang tải chương tiếp theo...";
    let nextUrl = window.nextChapterUrl;

    fetch(nextUrl)
      .then((res) => res.text())
      .then((html) => {
        let parser = new DOMParser();
        let doc = parser.parseFromString(html, "text/html");
        let newContent = doc.querySelector(".story-content");

        if (newContent) {
          contentEl.innerHTML = newContent.innerHTML;
          document.title = doc.title;
          const newHeader = doc.querySelector(".story-header h1");
          if (newHeader) document.querySelector(".story-header h1").innerHTML = newHeader.innerHTML;

          let docNavLinks = doc.querySelectorAll(".nav-links");
          let currentNavLinks = document.querySelectorAll(".nav-links");
          if (docNavLinks.length === currentNavLinks.length) {
            for (let i = 0; i < docNavLinks.length; i++) {
              currentNavLinks[i].innerHTML = docNavLinks[i].innerHTML;
            }
          }

          let nextA = doc.querySelectorAll(".nav-links a")[2];
          if (nextA && !nextA.classList.contains("disabled") && nextA.getAttribute("href") !== "#") {
            window.nextChapterUrl = nextA.href;
          } else {
            window.nextChapterUrl = "";
          }

          history.pushState(null, "", nextUrl);
          prepareContent();
          currentParagraphIndex = -1;
          setupMediaSession();
          
          play();
        } else {
          statusText.textContent = "Lỗi: Không tìm thấy nội dung.";
        }
      })
      .catch((err) => {
        console.error(err);
        window.location.href = nextUrl;
      });
  }

  function play() {
    isPlaying = true;
    requestWakeLock();
    startAudioKeepAlive();
    setupMediaSession();

    if (isDoneState) {
      isDoneState = false;
      if (floatPlayer) floatPlayer.classList.remove("done-flash");
    }

    if (isPaused && synth.paused) {
      try {
        synth.resume();
        isPaused = false;
        updateUI();
        statusText.textContent = "Đang đọc...";
        startSpeechKeepAlive();
        return;
      } catch (e) {
        console.warn("synth.resume failed, restarting...", e);
      }
    }

    isPaused = false;
    
    // Direct cancel and speak for synchronous context
    try {
      synth.cancel();
    } catch(e) {}

    // Small synchronous trigger
    if (currentParagraphIndex === -1) {
      highlightParagraph(0);
    }
    speak();
  }

  function pause() {
    if (synth.speaking && !synth.paused) {
      try {
        synth.pause();
      } catch(e) {}
      isPaused = true;
      statusText.textContent = "Tạm dừng.";
      updateUI();
      stopSpeechKeepAlive();
      stopAudioKeepAlive();
      releaseWakeLock();
    }
  }

  function stop() {
    isPlaying = false;
    isPaused = false;
    isDoneState = false;
    if (floatPlayer) floatPlayer.classList.remove("done-flash");
    highlightParagraph(-1);
    currentParagraphIndex = -1;
    statusText.textContent = "Sẵn sàng.";
    try {
      synth.cancel();
    } catch (e) {}
    updateUI();
    stopSpeechKeepAlive();
    stopAudioKeepAlive();
    releaseWakeLock();
  }

  function updateSettings() {
    if (isPlaying) {
      speak();
    }
  }

  // --- FLOATING PLAYER LOGIC ---
  const floatPlayer = document.getElementById("tts-floating-player");
  const floatPlayPause = document.getElementById("tts-float-playpause");
  const iconPlay = document.getElementById("icon-play");
  const iconPause = document.getElementById("icon-pause");
  const iconDone = document.getElementById("icon-done");
  const floatPrev = document.getElementById("tts-float-prev");
  const floatNext = document.getElementById("tts-float-next");
  let floatTimeout;

  function wakeUpFloatingPlayer() {
    if (!floatPlayer) return;
    floatPlayer.classList.add("active");
    clearTimeout(floatTimeout);
    floatTimeout = setTimeout(() => {
      floatPlayer.classList.remove("active");
    }, 9000);
  }

  function updateUI() {
    if (isDoneState) {
      if(btnPlay) btnPlay.style.display = "inline-block";
      if(btnPause) btnPause.style.display = "none";
      if (iconPlay && iconPause && iconDone) {
        iconPlay.style.display = "none";
        iconPause.style.display = "none";
        iconDone.style.display = "block";
      }
      return;
    }

    if (iconDone) iconDone.style.display = "none";

    if (isPlaying && !isPaused) {
      if(btnPlay) btnPlay.style.display = "none";
      if(btnPause) btnPause.style.display = "inline-block";
      if (iconPlay && iconPause) {
        iconPlay.style.display = "none";
        iconPause.style.display = "block";
      }
    } else {
      if(btnPlay) btnPlay.style.display = "inline-block";
      if(btnPause) btnPause.style.display = "none";
      if (iconPlay && iconPause) {
        iconPlay.style.display = "block";
        iconPause.style.display = "none";
      }
    }
  }

  // --- DRAGGABLE FLOATING PLAYER FOR MOBILE ---
  let startX = 0, startY = 0;
  let initialX = 0, initialY = 0;
  let wasDragged = false;

  function applyFloatPlayerPosition(x, y) {
    const marginX = 15;
    const marginYBottom = 30;

    let finalX = x;
    const midX = window.innerWidth / 2;
    
    if (finalX < midX) {
      finalX = marginX; // Bottom-Left
    } else {
      finalX = window.innerWidth - floatPlayer.offsetWidth - marginX; // Bottom-Right
    }

    let finalY = window.innerHeight - floatPlayer.offsetHeight - marginYBottom;

    floatPlayer.style.left = finalX + "px";
    floatPlayer.style.top = finalY + "px";
    floatPlayer.style.bottom = "auto";

    localStorage.setItem(floatPlayerPosKey, JSON.stringify({ x: finalX, y: finalY }));
  }

  if (floatPlayer) {
    const savedPos = localStorage.getItem(floatPlayerPosKey);
    if (savedPos) {
      try {
        const pos = JSON.parse(savedPos);
        floatPlayer.style.left = pos.x + "px";
        floatPlayer.style.top = pos.y + "px";
        floatPlayer.style.bottom = "auto";
      } catch (e) {}
    }

    floatPlayer.addEventListener("touchstart", function (e) {
      wasDragged = false;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      const rect = floatPlayer.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;

      floatPlayer.style.transition = "none";
    }, { passive: true });

    floatPlayer.addEventListener("touchmove", function (e) {
      const touch = e.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        wasDragged = true;
      }

      if (wasDragged) {
        if (e.cancelable) e.preventDefault();
        floatPlayer.style.left = initialX + dx + "px";
        floatPlayer.style.top = initialY + dy + "px";
        floatPlayer.style.bottom = "auto";
      }
    }, { passive: false });

    floatPlayer.addEventListener("touchend", function (e) {
      floatPlayer.style.transition = "left 0.4s cubic-bezier(0.25, 1, 0.5, 1), top 0.4s cubic-bezier(0.25, 1, 0.5, 1), opacity 1.2s ease-in-out, background-color 0.8s ease, border-color 0.8s ease, width 0.3s ease, height 0.3s ease, border-radius 0.3s ease";

      if (wasDragged) {
        if (e.cancelable) e.preventDefault();
        const rect = floatPlayer.getBoundingClientRect();
        applyFloatPlayerPosition(rect.left, rect.top);
        wakeUpFloatingPlayer();
      }
    });
  }

  // --- FALLBACK RESUME ON VISIBILITY CHANGE ---
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (isPlaying && !isPaused) {
        if (synth.paused) {
          console.log("Visibility regained: Resuming paused synth...");
          try {
            synth.resume();
            startSpeechKeepAlive();
          } catch (e) {
            console.error("Resume error:", e);
          }
        } else if (!synth.speaking) {
          console.log("Visibility regained: Speech stopped, restarting...");
          speak();
        }
      }
    }
  });

  // Listeners
  if(btnPlay) btnPlay.addEventListener("click", play);
  if(btnPause) btnPause.addEventListener("click", pause);
  if(btnStop) btnStop.addEventListener("click", stop);
  if(selectRate) selectRate.addEventListener("change", updateSettings);
  if(selectVoice) selectVoice.addEventListener("change", updateSettings);

  if (floatPlayer) {
    floatPlayer.addEventListener("click", (e) => {
      if (wasDragged) return;
      wakeUpFloatingPlayer();
    });

    floatPlayPause.addEventListener("click", (e) => {
      if (wasDragged) return;
      e.stopPropagation();
      wakeUpFloatingPlayer();
      if (isPlaying && !isPaused) pause();
      else play();
    });

    floatPrev.addEventListener("click", (e) => {
      if (wasDragged) return;
      e.stopPropagation();
      wakeUpFloatingPlayer();

      let targetIndex = currentParagraphIndex > 0 ? currentParagraphIndex - 1 : 0;
      if (currentParagraphIndex === -1 && paragraphOffsets.length > 0) targetIndex = 0;

      isPlaying = false;
      isPaused = false;
      try {
        synth.cancel();
      } catch (e) {}

      setTimeout(() => {
        currentParagraphIndex = targetIndex;
        play();
      }, 150);
    });

    floatNext.addEventListener("click", (e) => {
      if (wasDragged) return;
      e.stopPropagation();
      wakeUpFloatingPlayer();

      let targetIndex = currentParagraphIndex < paragraphOffsets.length - 1 ? currentParagraphIndex + 1 : currentParagraphIndex;
      if (currentParagraphIndex === -1 && paragraphOffsets.length > 0) targetIndex = 0;

      isPlaying = false;
      isPaused = false;
      try {
        synth.cancel();
      } catch (e) {}

      setTimeout(() => {
        currentParagraphIndex = targetIndex;
        play();
      }, 150);
    });
  }

  window.addEventListener("beforeunload", () => {
    try {
      synth.cancel();
    } catch (e) {}
    stopSpeechKeepAlive();
    stopAudioKeepAlive();
    releaseWakeLock();
  });

  // Initial UI
  updateUI();

  if (floatPlayer) {
    wakeUpFloatingPlayer();
  }

  if (window.isAutoPlayMode) {
    setTimeout(() => {
      play();
    }, 1000);
  }
});
