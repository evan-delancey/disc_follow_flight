'use strict';

// ── Gradient presets ──────────────────────────────────────────────────────────

const GRADIENTS = [
  { name: 'Teal',    start: [0,   160, 255],  end: [0,    230, 110] }, // blue → green (default)
  { name: 'Classic', start: [0,   230,  0],   end: [255,  0,   0]   }, // green → red
  { name: 'Ocean',   start: [0,   80,   255],  end: [0,    220, 200] }, // blue → cyan
  { name: 'Sunset',  start: [255, 60,   180],  end: [255,  220, 0]   }, // pink → yellow
  { name: 'Fire',    start: [255, 210,  0],    end: [255,  50,  0]   }, // yellow → orange
  { name: 'Galaxy',  start: [160, 0,    255],  end: [255,  80,  200] }, // purple → pink
  { name: 'Ice',     start: [200, 240,  255],  end: [0,    160, 255] }, // white → blue
  { name: 'Lava',    start: [200, 0,    0],    end: [255,  160, 0]   }, // deep red → amber
  { name: 'Neon',    start: [255, 255,  0],    end: [0,    255, 100] }, // yellow → neon green
  { name: 'Candy',   start: [255, 0,    150],  end: [120,  0,   255] }, // hot pink → purple
  { name: 'Thunder', start: [80,  0,    255],  end: [0,    220, 255] }, // electric purple → cyan
  { name: 'Rose',    start: [255, 120,  160],  end: [180,  0,   50]  }, // rose → crimson
  { name: 'Forest',  start: [0,   130,  0],    end: [120,  255, 50]  }, // dark green → lime
  { name: 'Copper',  start: [200, 90,   0],    end: [255,  215, 80]  }, // copper → gold
  { name: 'Spring',  start: [140, 255,  0],    end: [255,  220, 0]   }, // lime → yellow
  { name: 'Aqua',    start: [0,   180,  255],  end: [0,    255, 200] }, // sky blue → mint
  { name: 'Laser',   start: [255, 220,  0],    end: [0,    200, 255] }, // gold → cyan
];

let activeGradient = GRADIENTS[0];

function lerpColor(start, end, t) {
  return [
    Math.round(start[0] + t * (end[0] - start[0])),
    Math.round(start[1] + t * (end[1] - start[1])),
    Math.round(start[2] + t * (end[2] - start[2])),
  ];
}

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
  // smoothly interpolated using a Catmull-Rom spline through adjacent keyframes.
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
      // Catmull-Rom: clamp phantom control points at the boundaries
      const pp = sorted[Math.max(i - 1, 0)][1];
      const pn = sorted[Math.min(i + 2, sorted.length - 1)][1];
      for (let f = f0; f < f1; f++) {
        const t = (f - f0) / (f1 - f0);
        const t2 = t * t, t3 = t2 * t;
        points.push({
          frame: f,
          x: Math.round(0.5 * ((2*p0.x) + (-pp.x + p1.x)*t + (2*pp.x - 5*p0.x + 4*p1.x - pn.x)*t2 + (-pp.x + 3*p0.x - 3*p1.x + pn.x)*t3)),
          y: Math.round(0.5 * ((2*p0.y) + (-pp.y + p1.y)*t + (2*pp.y - 5*p0.y + 4*p1.y - pn.y)*t2 + (-pp.y + 3*p0.y - 3*p1.y + pn.y)*t3)),
        });
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
let seekAttempts = 0;
const MAX_SEEK_ATTEMPTS = 3;
let traceWidth   = 12;
let traceOpacity = 1.0;
let traceTaper   = 10; // -10 = narrow→wide, 0 = uniform, 10 = wide→narrow

// ── Video loading ─────────────────────────────────────────────────────────────

// On native iOS, use PHPickerViewController (library-only, no camera option)
// to avoid the "Take Video" action that crashes on iPad.
// On web, fall back to the hidden file input.
document.getElementById('choose-video-btn').addEventListener('click', async () => {
  if (window.Capacitor && window.Capacitor.isNativePlatform()) {
    try {
      const result = await window.Capacitor.Plugins.VideoPickerPlugin.pickFromLibrary();
      if (result && result.url) {
        video.src = window.Capacitor.convertFileSrc(result.url);
        video.load();
      }
    } catch (err) {
      if (err && err.message !== 'cancelled') {
        console.error('Video picker error:', err);
      }
    }
  } else {
    document.getElementById('video-input').click();
  }
});

// Web fallback: handle file input change event
document.getElementById('video-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  video.src = URL.createObjectURL(file);
  video.load();
});

video.addEventListener('loadeddata', () => {
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  totalFrames   = Math.max(1, Math.round(video.duration * fps));
  scrubber.max  = totalFrames - 1;
  scrubber.value = 0;
  tracker.clear();
  currentFrame = 0;
  setExportReady(null);
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
  seekAttempts++;
  const targetTime = seekTarget / fps;
  // If already at the right time the browser won't fire 'seeked' — handle now.
  if (Math.abs(video.currentTime - targetTime) < 0.001) {
    seeking = false;
    seekTarget = null;
    seekAttempts = 0;
    currentFrame = Math.round(video.currentTime * fps);
    scrubber.value = currentFrame;
    updateTopRow();
    drawCurrentFrame();
    return;
  }
  video.currentTime = targetTime;
}

video.addEventListener('seeked', () => {
  const actualFrame = Math.round(video.currentTime * fps);
  // On iOS, WKWebView snaps seeks to keyframes — retry up to MAX_SEEK_ATTEMPTS,
  // then accept wherever the video landed to avoid an infinite loop.
  if (seekTarget !== null && actualFrame !== seekTarget && seekAttempts < MAX_SEEK_ATTEMPTS) {
    doSeek();
    return;
  }
  seeking = false;
  seekTarget = null;
  seekAttempts = 0;
  // Always sync currentFrame to the actual decoded position so marks stay aligned.
  currentFrame = actualFrame;
  scrubber.value = currentFrame;
  updateTopRow();
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

  // Draw segment-by-segment so lineWidth (taper) and color can vary per step.
  // Smoothness comes from the Catmull-Rom points in getTrace() — segments are
  // very short (1 frame each) so the path looks perfectly smooth.
  let prev = null;
  for (let i = 0; i < nFull; i++) {
    const pt = fullTrace[i];
    if (pt.frame > upToFrame) break;
    if (prev !== null) {
      const t      = i / Math.max(nFull - 1, 1);
      const norm   = traceTaper / 10;               // −1 … 1
      const wStart = norm >= 0 ? traceWidth : 1 + (traceWidth - 1) * (1 + norm);
      const wEnd   = norm <= 0 ? traceWidth : 1 + (traceWidth - 1) * (1 - norm);
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(pt.x,   pt.y);
      ctx.lineWidth   = Math.max(scale, (wStart + (wEnd - wStart) * t) * scale);
      const [r, g, b] = lerpColor(activeGradient.start, activeGradient.end, t);
      ctx.strokeStyle = `rgba(${r},${g},${b},${traceOpacity})`;
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
  if (seeking) return;   // don't mark while the video is still seeking to the target frame
  const rect  = canvas.getBoundingClientRect();
  const x     = Math.round((clientX - rect.left)  * (canvas.width  / rect.width));
  const y     = Math.round((clientY - rect.top)   * (canvas.height / rect.height));
  tracker.add(currentFrame, x, y);
  drawCurrentFrame();
  updateTopRow();
}

// ── Touch crosshair ───────────────────────────────────────────────────────────

const crosshair      = document.getElementById('crosshair');
let   activeTouchId  = null;

function showCrosshair(clientX, clientY) {
  // Centre the SVG on the touch point, offset 80 px upward so it's above the thumb
  crosshair.style.left    = `${clientX - 40}px`;
  crosshair.style.top     = `${clientY - 120}px`;
  crosshair.style.display = 'block';
}

function hideCrosshair() {
  crosshair.style.display = 'none';
}

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  const touch      = e.touches[0];
  activeTouchId    = touch.identifier;
  showCrosshair(touch.clientX, touch.clientY);
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  const touch = [...e.touches].find(t => t.identifier === activeTouchId);
  if (touch) showCrosshair(touch.clientX, touch.clientY);
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  const touch = [...e.changedTouches].find(t => t.identifier === activeTouchId);
  if (touch) {
    // Crosshair is offset 80 px above the finger — use that adjusted point
    markFromEvent(touch.clientX, touch.clientY - 80);
    hideCrosshair();
    activeTouchId = null;
  }
}, { passive: false });

canvas.addEventListener('touchcancel', e => {
  hideCrosshair();
  activeTouchId = null;
}, { passive: false });

canvas.addEventListener('click', e => {
  markFromEvent(e.clientX, e.clientY);
});

// ── Gradient swatches ─────────────────────────────────────────────────────────

const gradientRow = document.getElementById('gradient-row');

GRADIENTS.forEach((g, i) => {
  const swatch = document.createElement('button');
  swatch.className = 'gradient-swatch' + (i === 0 ? ' selected' : '');
  swatch.title     = g.name;
  swatch.style.background =
    `linear-gradient(to right, rgb(${g.start}), rgb(${g.end}))`;
  swatch.addEventListener('click', () => {
    activeGradient = g;
    gradientRow.querySelectorAll('.gradient-swatch').forEach(s => s.classList.remove('selected'));
    swatch.classList.add('selected');
    drawCurrentFrame();
  });
  gradientRow.appendChild(swatch);
});

// ── Controls ──────────────────────────────────────────────────────────────────

const scrubber = document.getElementById('scrubber');

// Debounce scrubber: update UI immediately but only seek video every 80 ms
let scrubTimer = null;
scrubber.addEventListener('input', () => {
  const f = Number(scrubber.value);
  currentFrame = f;
  updateTopRow();
  clearTimeout(scrubTimer);
  scrubTimer = setTimeout(() => goToFrame(f), 80);
});

document.getElementById('btn-prev').addEventListener('click',  () => goToFrame(currentFrame - 1));
document.getElementById('btn-next').addEventListener('click',  () => goToFrame(currentFrame + 1));
document.getElementById('btn-m10').addEventListener('click',  () => goToFrame(currentFrame - 10));
document.getElementById('btn-p10').addEventListener('click',  () => goToFrame(currentFrame + 10));
document.getElementById('btn-undo').addEventListener('click', () => { tracker.undo(); drawCurrentFrame(); updateTopRow(); });
document.getElementById('btn-clear').addEventListener('click', () => {
  if (tracker.keyframes.size === 0) return;
  if (confirm('Remove all marks?')) { tracker.clear(); setExportReady(null); drawCurrentFrame(); updateTopRow(); }
});
// Export button: starts export when no finished blob is stored;
// becomes "Save to Photos" (fresh tap → share gesture) after export.
const exportBtn = document.getElementById('btn-export');
let   lastExport = null; // { blob, fileName, mimeType }

function setExportReady(ex) {
  lastExport = ex;
  exportBtn.textContent = ex ? 'Save to Photos ↗' : 'Export';
  exportBtn.classList.toggle('primary', !!ex);
  exportBtn.classList.toggle('export',  !ex);
}

exportBtn.addEventListener('click', async () => {
  if (lastExport) {
    // Called from a fresh tap — iOS will honour the user gesture
    await doShare(lastExport.blob, lastExport.fileName, lastExport.mimeType);
  } else {
    await exportVideo();
  }
});

// Customize panel toggle
const customizePanel = document.getElementById('customize-panel');
const btnCustomize   = document.getElementById('btn-customize');
let customizeOpen    = false;
btnCustomize.addEventListener('click', () => {
  customizeOpen = !customizeOpen;
  customizePanel.hidden  = !customizeOpen;
  btnCustomize.textContent = customizeOpen ? 'Customize Trace ▴' : 'Customize Trace ▾';
});

document.getElementById('trace-width').addEventListener('input', e => {
  traceWidth = Number(e.target.value);
  document.getElementById('width-value').textContent = traceWidth;
  drawCurrentFrame();
});

document.getElementById('trace-opacity').addEventListener('input', e => {
  traceOpacity = Number(e.target.value) / 100;
  document.getElementById('opacity-value').textContent = `${e.target.value}%`;
  drawCurrentFrame();
});

document.getElementById('trace-taper').addEventListener('input', e => {
  traceTaper = Number(e.target.value);
  const labels = { '-10': 'Narrow → Wide', '0': 'Uniform', '10': 'Wide → Narrow' };
  document.getElementById('taper-value').textContent =
    labels[e.target.value] ?? (traceTaper > 0 ? 'Wide → Narrow' : 'Narrow → Wide');
  drawCurrentFrame();
});
document.getElementById('btn-cancel-export').addEventListener('click', () => { exportCancelled = true; });

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
    status.textContent = `${n} marks — tap Export when done`;
  }
}

// ── Watermark ─────────────────────────────────────────────────────────────────

function drawWatermark(ctx, w, h) {
  const fontSize = Math.max(14, Math.round(h * 0.038));
  ctx.save();
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.shadowColor   = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur    = 6;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  const pad        = Math.round(fontSize * 0.6);
  const discWidth  = ctx.measureText('Disc').width;
  const trailWidth = ctx.measureText('Trail').width;
  const x = w - pad - discWidth - trailWidth;
  const y = h - pad;

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText('Disc', x, y);

  ctx.fillStyle = '#F97316';
  ctx.fillText('Trail', x + discWidth, y);

  ctx.restore();
}

// ── Video export ──────────────────────────────────────────────────────────────

let exportCancelled = false;

function getSupportedMimeType() {
  // Video-only candidates — no audio codec (canvas stream has no audio track)
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) ?? null;
}

async function seekVideoTo(frameIdx) {
  const targetTime = frameIdx / fps;
  if (Math.abs(video.currentTime - targetTime) < 0.001) return;
  return new Promise(resolve => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = targetTime;
  });
}

async function exportVideo() {
  if (tracker.keyframes.size < 2) {
    alert('Mark at least 2 positions before exporting.');
    return;
  }

  if (!window.MediaRecorder) {
    alert('Video export is not supported in this browser. Try Safari 14.3+ or Chrome.');
    return;
  }

  const mimeType = getSupportedMimeType();
  if (!mimeType) {
    alert('No supported video codec found in this browser.');
    return;
  }

  const ext        = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  const fileName   = `disc_trace.${ext}`;
  const savedFrame = currentFrame;

  const overlay   = document.getElementById('export-overlay');
  const statusEl  = document.getElementById('export-status');
  const fill      = document.getElementById('export-bar-fill');
  const pctEl     = document.getElementById('export-pct');
  const exportBtn = document.getElementById('btn-export');

  exportCancelled = false;
  overlay.hidden  = false;
  statusEl.textContent = 'Starting export…';
  fill.style.width  = '0%';
  pctEl.textContent = '0%';
  exportBtn.disabled = true;

  const sorted     = [...tracker.keyframes.keys()].sort((a, b) => a - b);
  const lastFrame  = sorted[sorted.length - 1];
  const msPerFrame = 1000 / fps;
  const chunks     = [];

  // ── Export canvas ────────────────────────────────────────────────────────
  // Scale down to at most 720 px on the longest edge.  Smaller canvas = smaller
  // JPEG blobs = fast encode (~5 ms) and decode (~5 ms) — well under the
  // 33 ms per-frame budget, so the absolute-timeline timing in Pass 2 gives
  // perfectly uniform frame durations (= smooth, correct-speed output).
  const MAX_EXPORT_PX = 720;
  const exportScale   = Math.min(1, MAX_EXPORT_PX / Math.max(canvas.width, canvas.height));
  const exportW       = Math.max(1, Math.round(canvas.width  * exportScale));
  const exportH       = Math.max(1, Math.round(canvas.height * exportScale));
  const exportCanvas  = Object.assign(document.createElement('canvas'),
                                      { width: exportW, height: exportH });
  const exportCtx     = exportCanvas.getContext('2d');

  // Decode a JPEG blob to a drawable object.  createImageBitmap is async but
  // off-thread; the result can be blitted in ~0 ms by ctx.drawImage.
  function decodeBlob(blob) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('blob decode failed')); };
      img.src = url;
    });
  }

  try {
    video.pause();
    video.loop = false;

    // ── Pass 1: Seek frame-by-frame and capture each as a small JPEG blob ──
    // Drawing happens at full resolution on the main canvas (so renderTrace
    // works at the correct scale), then we downscale to exportCanvas before
    // snapshotting.  This keeps JPEG file sizes small (~20–50 KB).
    statusEl.textContent = 'Capturing frames (1/2)…';
    const frameBlobs = [];

    for (let f = 0; f <= lastFrame; f++) {
      if (exportCancelled) break;

      await seekVideoTo(f);
      ctx.drawImage(video, 0, 0);
      renderTrace(f, false);
      // Downscale the composited frame to the export canvas
      exportCtx.drawImage(canvas, 0, 0, exportW, exportH);
      drawWatermark(exportCtx, exportW, exportH);

      const blob = await new Promise(r => exportCanvas.toBlob(r, 'image/jpeg', 0.92));
      if (!blob) throw new Error('canvas.toBlob returned null at frame ' + f);
      frameBlobs.push(blob);

      const pct = Math.round((f / Math.max(lastFrame, 1)) * 50);
      fill.style.width  = `${pct}%`;
      pctEl.textContent = `${pct}%`;
    }

    if (exportCancelled) return;

    // ── Pass 2: Replay blobs into MediaRecorder at exact fps ────────────────
    // captureStream(0) = manual mode; we call requestFrame() at the precise
    // moment each frame should appear, on an absolute-timeline clock so every
    // frame gets exactly msPerFrame ms regardless of blob-decode time.
    //
    // Lookahead: while the per-frame timer runs we decode the NEXT blob in
    // parallel, so the draw at the top of the next iteration is synchronous.
    statusEl.textContent = 'Encoding (2/2)…';

    const stream   = exportCanvas.captureStream(0);
    const track    = stream.getVideoTracks()[0];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onerror = e => { throw e.error ?? new Error('MediaRecorder error'); };
    recorder.start();

    let cur      = await decodeBlob(frameBlobs[0]);
    let nxtPromise = frameBlobs.length > 1 ? decodeBlob(frameBlobs[1]) : Promise.resolve(null);

    const t0 = performance.now();

    for (let i = 0; i < frameBlobs.length; i++) {
      if (exportCancelled) break;

      // cur is already decoded — this draw is synchronous (~0 ms)
      exportCtx.drawImage(cur, 0, 0, exportW, exportH);
      cur.close?.();          // free ImageBitmap GPU memory; no-op on Image
      track.requestFrame?.(); // stamp into stream exactly now

      const nnxtPromise = i + 2 < frameBlobs.length
        ? decodeBlob(frameBlobs[i + 2]) : Promise.resolve(null);

      const pct = Math.round(50 + (i / Math.max(frameBlobs.length - 1, 1)) * 50);
      fill.style.width  = `${pct}%`;
      pctEl.textContent = `${pct}%`;

      // Wait until the next frame's absolute wall-clock time AND until the
      // next blob is decoded, so the following iteration's draw is sync.
      const waitMs = Math.max(0, t0 + (i + 1) * msPerFrame - performance.now());
      const [, nxt] = await Promise.all([
        new Promise(r => setTimeout(r, waitMs)),
        nxtPromise,
      ]);

      cur        = nxt;
      nxtPromise = nnxtPromise;
    }

    if (!exportCancelled) {
      fill.style.width  = '100%';
      pctEl.textContent = '100%';
      await new Promise(r => setTimeout(r, 250)); // let encoder flush
    }

    recorder.stop();
    await new Promise(r => { recorder.onstop = r; });

    if (!exportCancelled) {
      const blob = new Blob(chunks, { type: mimeType });
      setExportReady({ blob, fileName, mimeType });
    }

  } catch (err) {
    if (!exportCancelled) {
      console.error(err);
      alert(`Export failed: ${err.message}`);
    }
  } finally {
    video.pause();
    overlay.hidden     = true;
    exportBtn.disabled = false;
    goToFrame(savedFrame);
  }
}

// doShare MUST be called from a direct tap handler so iOS honours the gesture.
async function doShare(blob, fileName, mimeType) {
  if (window.Capacitor) {
    const { Filesystem, Share } = window.Capacitor.Plugins;
    const base64 = await blobToBase64(blob);
    await Filesystem.writeFile({ path: fileName, data: base64, directory: 'CACHE' });
    const { uri } = await Filesystem.getUri({ path: fileName, directory: 'CACHE' });
    await Share.share({ title: 'DiscTrail', files: [uri] });
    return;
  }

  const file = new File([blob], fileName, { type: mimeType });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'DiscTrail' });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }

  // Final fallback: file download (works on desktop; on iOS opens in browser)
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── New Video / back navigation ───────────────────────────────────────────

function goToUpload() {
  if (tracker.keyframes.size > 0) {
    if (!confirm('Go back? Your marks will be lost.')) return;
  }
  tracker.clear();
  setExportReady(null);
  video.pause();
  video.src = '';
  document.getElementById('editor-screen').classList.remove('active');
  document.getElementById('upload-screen').classList.add('active');
  document.getElementById('video-input').value = '';
}

document.getElementById('btn-new-video').addEventListener('click', goToUpload);

// ── Android back button ───────────────────────────────────────────────────────

// ── Android back button ───────────────────────────────────────────────────────

if (window.Capacitor?.Plugins?.App) {
  window.Capacitor.Plugins.App.addListener('backButton', () => {
    const editorActive = document.getElementById('editor-screen').classList.contains('active');
    if (editorActive) {
      goToUpload();
    } else {
      window.Capacitor.Plugins.App.exitApp();
    }
  });
}
