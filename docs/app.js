'use strict';

// ── Keyframe tracker ──────────────────────────────────────────────────────────

class KeyframeTracker {
  constructor() {
    this.keyframes = new Map(); // frameIdx → {x, y}
    this._history  = [];        // [{frameIdx, prev}] for undo
  }

  add(frameIdx, x, y) {
    this._history.push({ frameIdx, prev: this.keyframes.get(frameIdx) ?? null });
    this.keyframes.set(frameIdx, { x, y });
  }

  undo() {
    const entry = this._history.pop();
    if (!entry) return;
    if (entry.prev === null) this.keyframes.delete(entry.frameIdx);
    else                     this.keyframes.set(entry.frameIdx, entry.prev);
  }

  clear() {
    this.keyframes.clear();
    this._history = [];
  }

  // Returns [{frame, x, y}] for every frame between first and last keyframe,
  // linearly interpolated between adjacent keyframes.
  getTrace() {
    if (this.keyframes.size === 0) return [];
    const sorted = [...this.keyframes.entries()].sort(([a], [b]) => a - b);
    if (sorted.length === 1) {
      const [f, p] = sorted[0];
      return [{ frame: f, x: p.x, y: p.y }];
    }
    const points = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const [f0, p0] = sorted[i];
      const [f1, p1] = sorted[i + 1];
      for (let f = f0; f < f1; f++) {
        const t = (f - f0) / (f1 - f0);
        points.push({ frame: f, x: Math.round(p0.x + t * (p1.x - p0.x)),
                                y: Math.round(p0.y + t * (p1.y - p0.y)) });
      }
    }
    const [lf, lp] = sorted[sorted.length - 1];
    points.push({ frame: lf, x: lp.x, y: lp.y });
    return points;
  }
}

// ── App state ─────────────────────────────────────────────────────────────────

const video    = document.getElementById('video');
const canvas   = document.getElementById('canvas');
const ctx      = canvas.getContext('2d');
const tracker  = new KeyframeTracker();

let fps          = 30;
let totalFrames  = 0;
let currentFrame = 0;
let seeking      = false;
let seekTarget   = null;

// ── Video loading ─────────────────────────────────────────────────────────────

document.getElementById('video-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  video.src = URL.createObjectURL(file);
  video.load();
});

video.addEventListener('loadedmetadata', () => {
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  totalFrames   = Math.max(1, Math.round(video.duration * fps));
  scrubber.max  = totalFrames - 1;
  scrubber.value = 0;
  tracker.clear();
  currentFrame = 0;
  showEditor();
  goToFrame(0);
});

function showEditor() {
  document.getElementById('upload-screen').classList.remove('active');
  document.getElementById('editor-screen').classList.add('active');
}

// ── Frame seeking ─────────────────────────────────────────────────────────────

function goToFrame(f) {
  currentFrame = Math.max(0, Math.min(f, totalFrames - 1));
  scrubber.value = currentFrame;
  updateTopRow();
  seekTarget = currentFrame;
  if (!seeking) doSeek();
}

function doSeek() {
  seeking = true;
  document.getElementById('seek-overlay').hidden = false;
  video.currentTime = seekTarget / fps;
}

video.addEventListener('seeked', () => {
  // If target moved while we were seeking, seek again
  if (seekTarget !== null && Math.round(video.currentTime * fps) !== seekTarget) {
    doSeek();
    return;
  }
  seeking = false;
  seekTarget = null;
  document.getElementById('seek-overlay').hidden = true;
  drawCurrentFrame();
});

// ── Rendering ─────────────────────────────────────────────────────────────────

function drawCurrentFrame() {
  ctx.drawImage(video, 0, 0);
  renderTrace(currentFrame, true);
}

// upToFrame: only draw trace points at or before this frame
// showMarkers: draw keyframe dots + labels (false for exports)
function renderTrace(upToFrame, showMarkers) {
  const fullTrace = tracker.getTrace();
  const nFull     = fullTrace.length;
  if (nFull < 2) {
    if (showMarkers) drawMarkers(upToFrame);
    return;
  }

  // Scale line widths from video-pixel space → screen-pixel space
  const dispW = canvas.getBoundingClientRect().width || canvas.width;
  const scale = canvas.width / dispW;

  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';

  let prev = null;
  for (let i = 0; i < nFull; i++) {
    const pt = fullTrace[i];
    if (pt.frame > upToFrame) break;
    if (prev !== null) {
      const t = i / Math.max(nFull - 1, 1);
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.lineWidth   = Math.max(scale, (12 * (1 - t) + 1) * scale);
      ctx.strokeStyle = `rgb(${Math.round(255 * t)},${Math.round(255 * (1 - t))},0)`;
      ctx.stroke();
    }
    prev = pt;
  }

  if (showMarkers) drawMarkers(upToFrame);
}

function drawMarkers(upToFrame) {
  const dispW = canvas.getBoundingClientRect().width || canvas.width;
  const scale = canvas.width / dispW;
  const r     = 8 * scale;

  const visible = [...tracker.keyframes.entries()]
    .filter(([f]) => f <= upToFrame)
    .sort(([a], [b]) => a - b);

  visible.forEach(([f, { x, y }], i) => {
    const isCur   = f === upToFrame && tracker.keyframes.has(upToFrame);
    const isFirst = i === 0;
    const isLast  = i === visible.length - 1;

    ctx.beginPath();
    ctx.arc(x, y, isCur ? r * 1.25 : r, 0, Math.PI * 2);
    ctx.fillStyle = isCur ? 'cyan' : isFirst ? '#00ff00' : isLast ? 'red' : 'gold';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth   = 2 * scale;
    ctx.stroke();
  });
}

// ── Tap / click to mark disc ──────────────────────────────────────────────────

function markFromEvent(clientX, clientY) {
  const rect  = canvas.getBoundingClientRect();
  const x     = Math.round((clientX - rect.left)  * (canvas.width  / rect.width));
  const y     = Math.round((clientY - rect.top)   * (canvas.height / rect.height));
  tracker.add(currentFrame, x, y);
  drawCurrentFrame();
  updateTopRow();
}

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  markFromEvent(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

canvas.addEventListener('click', e => {
  markFromEvent(e.clientX, e.clientY);
});

// ── Controls ──────────────────────────────────────────────────────────────────

const scrubber = document.getElementById('scrubber');

scrubber.addEventListener('input', () => goToFrame(Number(scrubber.value)));

document.getElementById('btn-prev').addEventListener('click',  () => goToFrame(currentFrame - 1));
document.getElementById('btn-next').addEventListener('click',  () => goToFrame(currentFrame + 1));
document.getElementById('btn-m10').addEventListener('click',  () => goToFrame(currentFrame - 10));
document.getElementById('btn-p10').addEventListener('click',  () => goToFrame(currentFrame + 10));
document.getElementById('btn-undo').addEventListener('click', () => { tracker.undo(); drawCurrentFrame(); updateTopRow(); });
document.getElementById('btn-clear').addEventListener('click', () => {
  if (tracker.keyframes.size === 0) return;
  if (confirm('Remove all marks?')) { tracker.clear(); drawCurrentFrame(); updateTopRow(); }
});
document.getElementById('btn-save').addEventListener('click', saveTraceImage);

// FPS toggle (30 ↔ 60)
document.getElementById('fps-toggle').addEventListener('click', () => {
  fps = fps === 30 ? 60 : 30;
  document.getElementById('fps-toggle').textContent = `${fps} fps`;
  totalFrames    = Math.max(1, Math.round(video.duration * fps));
  scrubber.max   = totalFrames - 1;
  currentFrame   = Math.round(video.currentTime * fps);
  scrubber.value = currentFrame;
  updateTopRow();
});

function updateTopRow() {
  const n = tracker.keyframes.size;
  document.getElementById('frame-label').textContent =
    `Frame ${currentFrame + 1} / ${totalFrames}`;
  document.getElementById('mark-count').textContent =
    n === 0 ? '0 marks' : `${n} mark${n === 1 ? '' : 's'}`;

  const status = document.getElementById('status');
  if (n === 0) {
    status.textContent = 'Tap on the disc to mark its position';
  } else if (n === 1) {
    status.textContent = 'Good — advance the video and keep tapping the disc';
  } else {
    status.textContent = `${n} marks — tap Save Trace when done`;
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

async function saveTraceImage() {
  if (tracker.keyframes.size < 2) {
    alert('Mark at least 2 positions before saving.');
    return;
  }

  const sorted     = [...tracker.keyframes.keys()].sort((a, b) => a - b);
  const firstFrame = sorted[0];
  const lastFrame  = sorted[sorted.length - 1];
  const savedFrame = currentFrame;

  // Seek to the release frame to use as the image background
  await new Promise(resolve => {
    const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = firstFrame / fps;
  });

  // Draw full trace (no markers) on the release frame
  ctx.drawImage(video, 0, 0);
  renderTrace(lastFrame, false);
  const dataUrl = canvas.toDataURL('image/png');

  // Restore the view the user was on
  goToFrame(savedFrame);

  if (window.Capacitor) {
    // Running inside the native iOS app — use Capacitor plugins
    await shareViaCapacitor(dataUrl);
  } else {
    // Running in browser (web / GitHub Pages)
    await shareViaWeb(dataUrl);
  }
}

async function shareViaCapacitor(dataUrl) {
  const { Filesystem, Share } = window.Capacitor.Plugins;
  const base64 = dataUrl.split(',')[1];
  const fileName = `disc_trace_${Date.now()}.png`;

  try {
    await Filesystem.writeFile({
      path: fileName,
      data: base64,
      directory: 'CACHE',
    });
    const { uri } = await Filesystem.getUri({ path: fileName, directory: 'CACHE' });
    await Share.share({ title: 'Disc Trace', files: [uri] });
  } catch (err) {
    if (err.name !== 'AbortError') console.error(err);
  }
}

async function shareViaWeb(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], 'disc_trace.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Disc Trace' });
    } catch (err) {
      if (err.name !== 'AbortError') console.error(err);
    }
  } else {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'),
                { href: url, download: 'disc_trace.png' });
    a.click();
    URL.revokeObjectURL(url);
  }
}
