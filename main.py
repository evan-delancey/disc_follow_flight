"""
disc_follow_flight — manual keyframe disc tracer

Usage:
    python main.py <video_path>

Controls:
    ← / →          step one frame backward / forward
    Shift+← / →    jump 10 frames
    Click           mark disc position on current frame
    Z               undo last mark
    S               save trace image
"""

import sys
import tkinter as tk
from tkinter import ttk, messagebox
from pathlib import Path

import cv2 as cv
import numpy as np
from PIL import Image, ImageTk

from tracker import KeyframeTracker, FrameCache

# Display window won't exceed these dimensions
MAX_DISP_W = 960
MAX_DISP_H = 620


class App:
    def __init__(self, root: tk.Tk, video_path: str):
        self.root = root
        self.video_path = video_path
        self.stem = Path(video_path).stem

        self.cap = cv.VideoCapture(video_path)
        if not self.cap.isOpened():
            raise FileNotFoundError(f"Cannot open video: {video_path}")

        self.total_frames = int(self.cap.get(cv.CAP_PROP_FRAME_COUNT))
        self.fps = self.cap.get(cv.CAP_PROP_FPS) or 30.0
        self.vid_w = int(self.cap.get(cv.CAP_PROP_FRAME_WIDTH))
        self.vid_h = int(self.cap.get(cv.CAP_PROP_FRAME_HEIGHT))

        scale = min(MAX_DISP_W / self.vid_w, MAX_DISP_H / self.vid_h, 1.0)
        self.disp_w = int(self.vid_w * scale)
        self.disp_h = int(self.vid_h * scale)
        self.scale = scale

        self.tracker = KeyframeTracker()
        self.cache = FrameCache(max_size=80)
        self.cur = 0
        self._photo_ref = None  # prevent GC

        self._build_ui()
        self._goto(0)

    # ── UI construction ───────────────────────────────────────────────────────

    def _build_ui(self):
        self.root.title(f"Disc Follow Flight — {Path(self.video_path).name}")
        self.root.resizable(False, False)

        # ── canvas ──
        self.canvas = tk.Canvas(
            self.root, width=self.disp_w, height=self.disp_h,
            bg="black", cursor="crosshair", highlightthickness=0,
        )
        self.canvas.pack(padx=10, pady=(10, 4))
        self.canvas.bind("<Button-1>", self._on_click)

        # ── frame counter ──
        self.lbl_frame = tk.Label(self.root, text="", font=("Helvetica", 11))
        self.lbl_frame.pack()

        # ── slider ──
        self.slider_var = tk.IntVar(value=0)
        self.slider = ttk.Scale(
            self.root, from_=0, to=self.total_frames - 1,
            orient="horizontal", length=self.disp_w,
            variable=self.slider_var, command=self._on_slider,
        )
        self.slider.pack(pady=4)

        # ── nav + action buttons ──
        nav = tk.Frame(self.root)
        nav.pack(pady=(2, 2))

        def btn(parent, text, cmd, **kw):
            return tk.Button(parent, text=text, command=cmd, width=13, **kw)

        btn(nav, "◀◀  −10", lambda: self._step(-10)).grid(row=0, column=0, padx=3)
        btn(nav, "◀  Prev", self._prev).grid(row=0, column=1, padx=3)
        btn(nav, "Next  ▶", self._next).grid(row=0, column=2, padx=3)
        btn(nav, "+10  ▶▶", lambda: self._step(10)).grid(row=0, column=3, padx=3)

        act = tk.Frame(self.root)
        act.pack(pady=(2, 4))

        btn(act, "Undo  (Z)", self._undo).grid(row=0, column=0, padx=3)
        btn(act, "Clear All", self._clear).grid(row=0, column=1, padx=3)
        btn(act, "Save Image", self._save_image,
            bg="#2196F3", fg="white").grid(row=0, column=2, padx=3)
        btn(act, "Save Video", self._save_video,
            bg="#2196F3", fg="white").grid(row=0, column=3, padx=3)

        # ── status bar ──
        self.status = tk.StringVar(value="Navigate to a frame, then click on the disc to mark it.")
        tk.Label(self.root, textvariable=self.status,
                 font=("Helvetica", 10), fg="#444").pack(pady=(0, 8))

        # ── keyboard bindings ──
        self.root.bind("<Left>", lambda _: self._prev())
        self.root.bind("<Right>", lambda _: self._next())
        self.root.bind("<Shift-Left>", lambda _: self._step(-10))
        self.root.bind("<Shift-Right>", lambda _: self._step(10))
        self.root.bind("<z>", lambda _: self._undo())
        self.root.bind("<Z>", lambda _: self._undo())
        self.root.bind("<s>", lambda _: self._save_image())
        self.root.bind("<S>", lambda _: self._save_image())

    # ── frame access ─────────────────────────────────────────────────────────

    def _read(self, idx: int):
        hit = self.cache.get(idx)
        if hit is not None:
            return hit
        self.cap.set(cv.CAP_PROP_POS_FRAMES, idx)
        ret, frame = self.cap.read()
        if not ret:
            return None
        self.cache.put(idx, frame)
        return frame

    # ── navigation ───────────────────────────────────────────────────────────

    def _goto(self, idx: int):
        self.cur = max(0, min(idx, self.total_frames - 1))
        self.slider_var.set(self.cur)
        self._redraw()

    def _prev(self):
        self._goto(self.cur - 1)

    def _next(self):
        self._goto(self.cur + 1)

    def _step(self, delta: int):
        self._goto(self.cur + delta)

    def _on_slider(self, val):
        idx = int(float(val))
        if idx != self.cur:
            self.cur = idx
            self._redraw()

    # ── rendering ────────────────────────────────────────────────────────────

    def _redraw(self):
        frame = self._read(self.cur)
        if frame is None:
            return
        rendered = self._render(frame, self.cur)
        small = cv.resize(rendered, (self.disp_w, self.disp_h), interpolation=cv.INTER_LINEAR)
        rgb = cv.cvtColor(small, cv.COLOR_BGR2RGB)
        pil = Image.fromarray(rgb)
        self._photo_ref = ImageTk.PhotoImage(pil)
        self.canvas.delete("all")
        self.canvas.create_image(0, 0, anchor="nw", image=self._photo_ref)

        n = len(self.tracker.keyframes)
        marked = "  ●" if self.cur in self.tracker.keyframes else ""
        self.lbl_frame.config(text=f"Frame {self.cur + 1} / {self.total_frames}{marked}")
        if n == 0:
            self.status.set("Click on the disc to mark its position. Use ← → to navigate frames.")
        else:
            self.status.set(f"{n} keyframe{'s' if n != 1 else ''} marked — keep clicking at each position along the flight.")

    def _render(self, frame, frame_idx: int):
        out = frame.copy()
        full_trace = self.tracker.get_trace()
        n_full = len(full_trace)

        # only show the portion of the trace up to frame_idx
        visible = [(i, f, p) for i, (f, p) in enumerate(full_trace) if f <= frame_idx]

        # draw interpolated path; colour position based on full-path length so
        # the gradient is consistent whether viewing a partial or complete trace
        for j in range(1, len(visible)):
            i0, _, p0 = visible[j - 1]
            i1, _, p1 = visible[j]
            t = i1 / max(n_full - 1, 1)
            color = (0, int(255 * (1 - t)), int(255 * t))  # BGR: green→red
            cv.line(out, p0, p1, color, 3, cv.LINE_AA)

        # only show keyframe markers that have been reached
        all_kf = sorted(self.tracker.keyframes.items())
        visible_kf = [(f, p) for f, p in all_kf if f <= frame_idx]
        n_vis_kf = len(visible_kf)
        for j, (fnum, pt) in enumerate(visible_kf):
            is_first = j == 0
            is_last = j == n_vis_kf - 1
            is_cur = fnum == frame_idx
            if is_cur:
                color = (0, 255, 255)   # cyan: current frame
                r = 9
            elif is_first:
                color = (0, 255, 0)     # green: release
                r = 7
            elif is_last:
                color = (0, 0, 255)     # red: furthest reached so far
                r = 7
            else:
                color = (255, 200, 0)   # gold: intermediate
                r = 5
            cv.circle(out, pt, r, color, -1, cv.LINE_AA)
            cv.circle(out, pt, r + 2, (0, 0, 0), 1, cv.LINE_AA)

        # labels
        if visible_kf:
            _, sp = visible_kf[0]
            cv.putText(out, "Release", (sp[0] + 10, sp[1] - 8),
                       cv.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0), 1, cv.LINE_AA)
            if n_vis_kf > 1:
                _, ep = visible_kf[-1]
                cv.putText(out, "Land", (ep[0] + 10, ep[1] - 8),
                           cv.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 255), 1, cv.LINE_AA)
        return out

    # ── interactions ─────────────────────────────────────────────────────────

    def _on_click(self, event):
        # map display coords → original video coords
        x = int(round(event.x / self.scale))
        y = int(round(event.y / self.scale))
        x = max(0, min(x, self.vid_w - 1))
        y = max(0, min(y, self.vid_h - 1))
        self.tracker.add(self.cur, x, y)
        self._redraw()

    def _undo(self):
        self.tracker.undo()
        self._redraw()

    def _clear(self):
        if self.tracker.keyframes and messagebox.askyesno("Clear All", "Remove all marked keyframes?"):
            self.tracker.clear()
            self._redraw()

    # ── export ───────────────────────────────────────────────────────────────

    def _ensure_outputs(self) -> Path:
        out = Path("outputs")
        out.mkdir(parents=True, exist_ok=True)
        return out

    def _save_image(self):
        if len(self.tracker.keyframes) < 2:
            messagebox.showwarning("Too few marks", "Mark at least 2 disc positions before saving.")
            return
        first_frame_idx = min(self.tracker.keyframes)
        last_frame_idx = max(self.tracker.keyframes)
        bg = self._read(first_frame_idx)
        result = self._render(bg, last_frame_idx)  # show full trace on static image
        out_path = self._ensure_outputs() / f"{self.stem}_trace.png"
        cv.imwrite(str(out_path), result)
        self.status.set(f"Saved → {out_path}")
        messagebox.showinfo("Saved", f"Trace image saved to:\n{out_path}")

    def _save_video(self):
        if len(self.tracker.keyframes) < 2:
            messagebox.showwarning("Too few marks", "Mark at least 2 disc positions before saving.")
            return
        out_path = self._ensure_outputs() / f"{self.stem}_trace.avi"
        fourcc = cv.VideoWriter_fourcc(*"MJPG")
        writer = cv.VideoWriter(str(out_path), fourcc, self.fps, (self.vid_w, self.vid_h))
        self.status.set("Rendering video… please wait")
        self.root.update()

        self.cap.set(cv.CAP_PROP_POS_FRAMES, 0)
        for frame_idx in range(self.total_frames):
            ret, frame = self.cap.read()
            if not ret:
                break
            writer.write(self._render(frame, frame_idx))
        writer.release()

        # restore seek position
        self.cap.set(cv.CAP_PROP_POS_FRAMES, self.cur)

        self.status.set(f"Saved → {out_path}")
        messagebox.showinfo("Saved", f"Trace video saved to:\n{out_path}")

    def cleanup(self):
        self.cap.release()


# ── entry point ───────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    video_path = sys.argv[1]
    root = tk.Tk()
    try:
        app = App(root, video_path)
    except FileNotFoundError as e:
        print(e)
        sys.exit(1)
    root.protocol("WM_DELETE_WINDOW", lambda: (app.cleanup(), root.destroy()))
    root.mainloop()


if __name__ == "__main__":
    main()
