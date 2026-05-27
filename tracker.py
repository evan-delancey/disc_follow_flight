from collections import OrderedDict


class KeyframeTracker:
    def __init__(self):
        self.keyframes: dict[int, tuple[int, int]] = {}
        self._history: list[tuple[int, tuple[int, int] | None]] = []

    def add(self, frame_idx: int, x: int, y: int) -> None:
        self._history.append((frame_idx, self.keyframes.get(frame_idx)))
        self.keyframes[frame_idx] = (x, y)

    def undo(self) -> None:
        if not self._history:
            return
        frame_idx, prev = self._history.pop()
        if prev is None:
            self.keyframes.pop(frame_idx, None)
        else:
            self.keyframes[frame_idx] = prev

    def clear(self) -> None:
        self.keyframes.clear()
        self._history.clear()

    def get_trace(self) -> list[tuple[int, tuple[int, int]]]:
        """Return (frame_idx, (x, y)) for every frame between the first and last keyframe,
        linearly interpolated between adjacent keyframes."""
        if not self.keyframes:
            return []
        if len(self.keyframes) == 1:
            return list(self.keyframes.items())

        sorted_keys = sorted(self.keyframes)
        points: list[tuple[int, tuple[int, int]]] = []

        for i in range(len(sorted_keys) - 1):
            f0, f1 = sorted_keys[i], sorted_keys[i + 1]
            x0, y0 = self.keyframes[f0]
            x1, y1 = self.keyframes[f1]
            for f in range(f0, f1):
                t = (f - f0) / (f1 - f0)
                points.append((f, (int(round(x0 + t * (x1 - x0))),
                                   int(round(y0 + t * (y1 - y0))))))

        last = sorted_keys[-1]
        points.append((last, self.keyframes[last]))
        return points


class FrameCache:
    """LRU cache for decoded video frames (limits RAM use on long videos)."""

    def __init__(self, max_size: int = 60):
        self._cache: OrderedDict[int, object] = OrderedDict()
        self._max = max_size

    def get(self, idx: int):
        if idx not in self._cache:
            return None
        self._cache.move_to_end(idx)
        return self._cache[idx]

    def put(self, idx: int, frame) -> None:
        if idx in self._cache:
            self._cache.move_to_end(idx)
        else:
            if len(self._cache) >= self._max:
                self._cache.popitem(last=False)
            self._cache[idx] = frame
