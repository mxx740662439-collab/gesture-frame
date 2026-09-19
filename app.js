"use strict";

const MAX_VIDEO_SECONDS = 10;
const MAX_FRAME_EDGE = 1600;

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const countdownEl = document.getElementById("countdown");
const infoEl = document.getElementById("info");
const playBtn = document.getElementById("playBtn");
const trainingBtn = document.getElementById("trainingBtn");
const settingsBackdrop = document.getElementById("settingsBackdrop");
const fileInput = document.getElementById("fileInput");

let frameImages = [];
let frameUrls = [];
let currentFrame = 0;
let onion = false;
let playing = false;
let timer = null;
let remaining = 0;
let endTime = 0;
let activeVideoUrl = null;
let extractionId = 0;

function selectedSeconds() {
  return Number(document.getElementById("timeSelect").value);
}

function openSettings() {
  settingsBackdrop.classList.remove("hidden");
  settingsBackdrop.setAttribute("aria-hidden", "false");
}

function closeSettings() {
  settingsBackdrop.classList.add("hidden");
  settingsBackdrop.setAttribute("aria-hidden", "true");
}

function clearFrames() {
  frameUrls.forEach(url => URL.revokeObjectURL(url));
  frameUrls = [];
  frameImages = [];
  currentFrame = 0;
  canvas.classList.add("hidden");
}

fileInput.addEventListener("change", event => {
  const file = event.target.files[0];
  if (file) loadVideo(file);
});

function loadVideo(file) {
  stopPlay(false);
  clearFrames();
  extractionId += 1;

  if (activeVideoUrl) URL.revokeObjectURL(activeVideoUrl);
  activeVideoUrl = URL.createObjectURL(file);
  video.src = activeVideoUrl;
  closeSettings();
  showProgress(true, "正在读取视频...");

  video.onloadedmetadata = () => {
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      failVideo("无法读取视频时长，请更换视频格式");
      return;
    }
    if (video.duration > MAX_VIDEO_SECONDS) {
      failVideo(`视频时长为 ${video.duration.toFixed(1)} 秒，请选择 10 秒以内的视频`);
      return;
    }

    const runId = extractionId;
    extractFrames(runId).catch(error => {
      if (runId !== extractionId) return;
      console.error(error);
      showProgress(false);
      document.getElementById("empty").style.display = "block";
      alert("视频拆帧失败，请尝试 MP4、MOV 或 WebM 格式");
    });
  };
}

function failVideo(message) {
  showProgress(false);
  document.getElementById("empty").style.display = "block";
  alert(message);
  openSettings();
}

async function extractFrames(runId) {
  const fps = Number(document.getElementById("fpsSelect").value);
  const total = Math.max(1, Math.ceil(video.duration * fps));
  const scale = Math.min(1, MAX_FRAME_EDGE / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));

  const temp = document.createElement("canvas");
  temp.width = width;
  temp.height = height;
  const tempCtx = temp.getContext("2d", { alpha: false });

  document.getElementById("empty").style.display = "none";
  showProgress(true, "正在拆分视频帧...");

  for (let index = 0; index < total; index += 1) {
    if (runId !== extractionId) return;
    const time = Math.min(index / fps, Math.max(0, video.duration - 0.001));
    await seekVideo(time);
    tempCtx.drawImage(video, 0, 0, width, height);

    const blob = await canvasToBlob(temp, "image/jpeg", 0.88);
    const url = URL.createObjectURL(blob);
    const image = await loadImage(url);
    frameUrls.push(url);
    frameImages.push(image);
    updateProgress(index + 1, total);
  }

  if (runId !== extractionId) return;
  showProgress(false);
  setupTimeline();
  currentFrame = 0;
  remaining = selectedSeconds();
  canvas.classList.remove("hidden");
  countdownEl.classList.remove("hidden");
  showFrame();
  renderCountdown();
}

function seekVideo(time) {
  if (video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.0005) {
    return new Promise(resolve => requestAnimationFrame(resolve));
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error("视频定位超时")), 8000);

    function finish(error) {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      if (error) reject(error);
      else resolve();
    }

    function onSeeked() { finish(); }
    function onError() { finish(new Error("视频定位失败")); }

    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = time;
  });
}

function canvasToBlob(sourceCanvas, type, quality) {
  return new Promise((resolve, reject) => {
    sourceCanvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("静态帧生成失败"));
    }, type, quality);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("静态帧读取失败"));
    image.src = src;
  });
}

function showProgress(show, message = "分析中...") {
  const box = document.getElementById("progressBox");
  box.style.display = show ? "block" : "none";
  if (show) document.getElementById("progressText").textContent = message;
}

function updateProgress(now, total) {
  document.getElementById("progressBar").value = now / total * 100;
  document.getElementById("progressText").textContent = `正在生成静态帧 ${now}/${total}`;
}

function showFrame() {
  if (frameImages.length === 0) return;
  const current = frameImages[currentFrame];
  canvas.width = current.naturalWidth;
  canvas.height = current.naturalHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
  ctx.drawImage(current, 0, 0, canvas.width, canvas.height);

  if (onion && currentFrame > 0) {
    const previous = frameImages[currentFrame - 1];
    ctx.globalAlpha = Number(document.getElementById("onionOpacity").value) / 100;
    ctx.drawImage(previous, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }

  updateFrameInfo();
}

function setupTimeline() {
  const timeline = document.getElementById("timeline");
  timeline.max = Math.max(0, frameImages.length - 1);
  timeline.value = 0;
}

document.getElementById("timeline").addEventListener("input", function () {
  pauseTraining();
  currentFrame = Number(this.value);
  showFrame();
});

function updateFrameInfo() {
  document.getElementById("frameLabel").textContent = `Frame ${currentFrame + 1} / ${frameImages.length}`;
  document.getElementById("timeline").value = currentFrame;
  infoEl.textContent = playing
    ? `训练中 · 每帧 ${selectedSeconds()} 秒`
    : `已暂停 · 每帧 ${selectedSeconds()} 秒`;
}

function renderCountdown() {
  if (frameImages.length === 0) {
    countdownEl.classList.add("hidden");
    return;
  }

  countdownEl.classList.remove("hidden");
  countdownEl.classList.toggle("paused", !playing);
  countdownEl.textContent = playing
    ? `剩余 ${Math.max(0, remaining)} 秒`
    : `准备：${selectedSeconds()} 秒/帧`;
  playBtn.textContent = playing ? "Ⅱ" : "▶";
  trainingBtn.textContent = playing ? "暂停" : "训练";
}

function moveFrame(direction, shouldPause = true) {
  if (frameImages.length === 0) return;
  if (shouldPause) pauseTraining();
  currentFrame = (currentFrame + direction + frameImages.length) % frameImages.length;
  showFrame();
}

function nextFrame() { moveFrame(1); }
function prevFrame() { moveFrame(-1); }

function toggleOnion() {
  onion = !onion;
  document.getElementById("onionBtn").textContent = onion ? "洋葱皮 ON" : "洋葱皮";
  showFrame();
}

function startTraining() {
  if (frameImages.length === 0) {
    alert("请先上传视频");
    return;
  }
  closeSettings();
  startPlay();
}

function toggleTraining() {
  if (playing) pauseTraining();
  else startPlay();
}

function startPlay() {
  if (frameImages.length === 0) {
    alert("请先上传视频");
    return;
  }

  clearTimer();
  const seconds = selectedSeconds();
  playing = true;
  remaining = seconds;
  endTime = Date.now() + seconds * 1000;
  renderCountdown();
  updateFrameInfo();
  timer = window.setInterval(tickCountdown, 100);
}

function tickCountdown() {
  if (!playing) return;
  const millisecondsLeft = endTime - Date.now();
  const nextRemaining = Math.max(0, Math.ceil(millisecondsLeft / 1000));

  if (nextRemaining !== remaining) {
    remaining = nextRemaining;
    renderCountdown();
  }

  if (millisecondsLeft <= 0) {
    moveFrame(1, false);
    const seconds = selectedSeconds();
    remaining = seconds;
    endTime = Date.now() + seconds * 1000;
    renderCountdown();
  }
}

function clearTimer() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function stopPlay(resetCountdown = true) {
  clearTimer();
  playing = false;
  if (resetCountdown) remaining = selectedSeconds();
  renderCountdown();
  if (frameImages.length > 0) updateFrameInfo();
}

function pauseTraining() {
  stopPlay(true);
}

document.getElementById("timeSelect").addEventListener("change", () => {
  if (playing) startPlay();
  else {
    remaining = selectedSeconds();
    renderCountdown();
    if (frameImages.length > 0) updateFrameInfo();
  }
});

document.getElementById("onionOpacity").addEventListener("input", () => {
  if (onion) showFrame();
});

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    console.warn("当前浏览器不支持全屏切换", error);
  }
}

document.getElementById("tutorialStartBtn").addEventListener("click", () => {
  openSettings();
  window.setTimeout(() => fileInput.click(), 120);
});
document.getElementById("prevBtn").addEventListener("click", prevFrame);
document.getElementById("playBtn").addEventListener("click", toggleTraining);
document.getElementById("nextBtn").addEventListener("click", nextFrame);
document.getElementById("onionBtn").addEventListener("click", toggleOnion);
document.getElementById("trainingBtn").addEventListener("click", toggleTraining);
document.getElementById("settingsBtn").addEventListener("click", openSettings);
document.getElementById("fullscreenBtn").addEventListener("click", toggleFullscreen);
document.getElementById("startBtn").addEventListener("click", startTraining);
document.getElementById("closeSettingsBtn").addEventListener("click", closeSettings);

settingsBackdrop.addEventListener("click", event => {
  if (event.target === settingsBackdrop) closeSettings();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !settingsBackdrop.classList.contains("hidden")) {
    closeSettings();
  } else if (event.code === "Space" && settingsBackdrop.classList.contains("hidden")) {
    event.preventDefault();
    toggleTraining();
  } else if (event.key === "ArrowRight") {
    nextFrame();
  } else if (event.key === "ArrowLeft") {
    prevFrame();
  } else if (event.key.toLowerCase() === "o") {
    toggleOnion();
  } else if (event.key.toLowerCase() === "f") {
    toggleFullscreen();
  }
});

window.addEventListener("beforeunload", () => {
  clearTimer();
  clearFrames();
  if (activeVideoUrl) URL.revokeObjectURL(activeVideoUrl);
});
