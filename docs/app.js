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
let traceWidth   = 12;
let traceOpacity = 1.0;
let traceTaper   = 10; // -10 = narrow→wide, 0 = uniform, 10 = wide→narrow

// ── Video loading ─────────────────────────────────────────────────────────────

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
  const targetTime = seekTarget / fps;
  // If already at the right time the browser won't fire 'seeked' — handle now.
  if (Math.abs(video.currentTime - targetTime) < 0.001) {
    seeking = false;
    seekTarget = null;
    drawCurrentFrame();
    return;
  }
  video.currentTime = targetTime;
}

video.addEventListener('seeked', () => {
  // If target moved while we were seeking, seek again.
  if (seekTarget !== null && Math.round(video.currentTime * fps) !== seekTarget) {
    doSeek();
    return;
  }
  seeking = false;
  seekTarget = null;
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

scrubber.addEventListener('input', () => goToFrame(Number(scrubber.value)));

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

  const sorted    = [...tracker.keyframes.keys()].sort((a, b) => a - b);
  const lastFrame = sorted[sorted.length - 1];
  const endTime   = (lastFrame + 1) / fps;
  const chunks    = [];
  let rafId       = null;
  let rafActive   = false;   // hard stop flag — prevents the RAF loop outliving its cancel

  try {
    // Seek to the beginning before recording starts
    await seekVideoTo(0);

    // ── Fix 3: draw the clean first frame NOW, before the recorder captures anything ──
    // This prevents the stale full-trace canvas from appearing at the start of the export.
    ctx.drawImage(video, 0, 0);

    video.loop = false;   // ── Fix 2a: ensure video never loops during export ──

    const stream   = canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onerror = e => { throw e.error ?? new Error('MediaRecorder error'); };
    recorder.start(100);

    // Let the recorder initialise (canvas already shows clean frame 0, no trace)
    await new Promise(resolve => setTimeout(resolve, 150));
    statusEl.textContent = 'Exporting…';

    // ── Fix 2b: use rafActive flag so the loop stops the moment we set it false ──
    rafActive = true;
    const drawFrame = () => {
      if (!rafActive || exportCancelled) return;
      const f = Math.min(Math.round(video.currentTime * fps), lastFrame);
      ctx.drawImage(video, 0, 0);
      renderTrace(f, false);
      const progress = video.currentTime / endTime;
      fill.style.width  = `${Math.min(progress * 100, 100)}%`;
      pctEl.textContent = `${Math.min(Math.round(progress * 100), 100)}%`;
      rafId = requestAnimationFrame(drawFrame);
    };
    rafId = requestAnimationFrame(drawFrame);

    // Play the video and stop once we've passed the last marked frame
    await new Promise((resolve, reject) => {
      const onTimeUpdate = () => {
        if (exportCancelled || video.currentTime >= endTime) {
          video.removeEventListener('timeupdate', onTimeUpdate);
          video.removeEventListener('ended', onEnded);
          resolve();
        }
      };
      const onEnded = () => {
        video.removeEventListener('timeupdate', onTimeUpdate);
        video.removeEventListener('ended', onEnded);
        resolve();
      };
      video.addEventListener('timeupdate', onTimeUpdate);
      video.addEventListener('ended', onEnded, { once: true });
      video.play().catch(reject);
    });

    rafActive = false;   // stop the RAF loop before cancelling
    video.pause();
    cancelAnimationFrame(rafId);
    rafId = null;

    if (!exportCancelled) {
      // Hold the final frame so it is fully captured
      ctx.drawImage(video, 0, 0);
      renderTrace(lastFrame, false);
      fill.style.width  = '100%';
      pctEl.textContent = '100%';
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    recorder.stop();
    await new Promise(resolve => { recorder.onstop = resolve; });

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
    rafActive = false;
    if (rafId) cancelAnimationFrame(rafId);
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
