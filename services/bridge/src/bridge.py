"""
LIWAN Bridge — per-camera recognition loop.

For each fixed camera the bridge:

  1. Opens the video source (RTSP / USB) with ``cv2.VideoCapture`` and keeps it
     fresh — on any read failure or stream drop it reconnects with exponential
     backoff.
  2. Runs a cheap *presence gate* so it does not spam the API with empty
     corridors: a frame must show recent motion AND contain a frontal face
     (Haar cascade, CPU-only) before it is considered for a request.
  3. Throttles to roughly one request per ``request_interval_s`` per camera.
  4. Debounces: once a frame is *granted* (a member recognised), it stays quiet
     for ``debounce_seconds`` so the same person standing at the door is not
     posted over and over. Non-grant decisions use a shorter quiet window so a
     genuinely new face is still tried quickly.
  5. POSTs the JPEG to ``/api/recognize`` as multipart with ``X-Device-Key`` and
     ``camera_id`` / ``door_id``; the API does ALL decisioning (threshold,
     access group, schedule, attendance roll-up, door driver). The bridge only
     logs the structured :class:`RecognizeResult` it gets back.

Cameras run on independent daemon threads; the main thread waits for a stop
signal and shuts everything down cleanly.

The bridge never decides access itself and never talks to CompreFace or the
door directly — it is purely an eye that feeds the Liwan API. That keeps the
decision rules in exactly one place (the API), per CONTRACT.md.
"""

from __future__ import annotations

import logging
import signal
import sys
import threading
import time
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np
import requests

from . import config
from .config import BridgeConfig, CameraConfig, ConfigError

log = logging.getLogger("liwan.bridge")

# Short quiet window after a non-grant decision (unknown_face / not_authorized /
# off_schedule / error). Keeps us from hammering the API on a stranger loitering
# in frame, while still re-trying soon enough for a real arrival.
_NON_GRANT_QUIET_S = 2.5

# Motion is measured against a slowly-updated running background. A higher alpha
# adapts faster to lighting changes but is more likely to miss slow walkers.
_BG_LEARN_ALPHA = 0.05


@dataclass
class _Debounce:
    """Per-camera memory of the last decision, to suppress repeats."""

    last_request_ts: float = 0.0
    quiet_until: float = 0.0
    last_member_id: Optional[str] = None

    def may_request(self, now: float, min_interval: float) -> bool:
        """True if enough time has passed to attempt another request."""
        return now >= self.quiet_until and (now - self.last_request_ts) >= min_interval

    def note_request(self, now: float) -> None:
        self.last_request_ts = now

    def note_decision(self, now: float, decision: str, member_id: Optional[str],
                      grant_quiet_s: float) -> None:
        """Set the quiet window based on the API's decision."""
        if decision == "granted":
            self.last_member_id = member_id
            self.quiet_until = now + grant_quiet_s
        else:
            self.quiet_until = now + _NON_GRANT_QUIET_S


class FaceGate:
    """
    Cheap presence detector: motion + a frontal-face cascade.

    Pure OpenCV, no model downloads, runs comfortably on a CPU. It is a *gate*,
    not a recognizer — its only job is to decide whether a frame is worth a
    network round-trip. The API/CompreFace make the real call.
    """

    def __init__(self, motion_min_area_frac: float) -> None:
        self._motion_min_area_frac = motion_min_area_frac
        self._bg: Optional[np.ndarray] = None
        # Bundled with opencv-python; frontal face, fast and adequate for a gate.
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        self._cascade = cv2.CascadeClassifier(cascade_path)
        if self._cascade.empty():
            log.warning("face cascade failed to load from %s; gating on motion only",
                        cascade_path)
            self._cascade = None

    def _has_motion(self, gray: np.ndarray) -> bool:
        """Running-average background diff; True if a meaningful region changed."""
        blurred = cv2.GaussianBlur(gray, (21, 21), 0)
        if self._bg is None:
            self._bg = blurred.astype("float32")
            return False  # first frame seeds the background, never "motion"

        cv2.accumulateWeighted(blurred, self._bg, _BG_LEARN_ALPHA)
        delta = cv2.absdiff(blurred, cv2.convertScaleAbs(self._bg))
        thresh = cv2.threshold(delta, 25, 255, cv2.THRESH_BINARY)[1]
        thresh = cv2.dilate(thresh, None, iterations=2)
        changed = int(cv2.countNonZero(thresh))
        total = gray.shape[0] * gray.shape[1]
        return total > 0 and (changed / total) >= self._motion_min_area_frac

    def _has_face(self, gray: np.ndarray) -> bool:
        if self._cascade is None:
            return True  # cascade unavailable → don't block on faces
        faces = self._cascade.detectMultiScale(
            gray, scaleFactor=1.2, minNeighbors=5, minSize=(60, 60)
        )
        return len(faces) > 0

    def should_send(self, frame: np.ndarray) -> bool:
        """Return True when the frame both moved recently and shows a face."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if not self._has_motion(gray):
            return False
        return self._has_face(gray)


class CameraWorker(threading.Thread):
    """Owns one camera's capture, gate, throttle/debounce and HTTP posting."""

    def __init__(self, cam: CameraConfig, cfg: BridgeConfig,
                 stop_event: threading.Event) -> None:
        super().__init__(name=f"cam:{cam.name}", daemon=True)
        self._cam = cam
        self._cfg = cfg
        self._stop = stop_event
        self._gate = FaceGate(cfg.motion_min_area_frac)
        self._debounce = _Debounce()
        # One pooled session per camera (keep-alive to the API).
        self._session = requests.Session()
        self._log = logging.getLogger(f"liwan.bridge.{cam.name}")

    # -- capture lifecycle --------------------------------------------------
    def _open_capture(self) -> Optional[cv2.VideoCapture]:
        """Open the source; return a ready capture or None on failure."""
        source = self._cam.capture_source
        self._log.info("opening source %r", self._cam.source)
        cap = cv2.VideoCapture(source)
        if not cap or not cap.isOpened():
            if cap:
                cap.release()
            return None
        # Keep buffering minimal so we always grab a near-live frame, not a
        # stale one from a backed-up queue. Best-effort; ignored by some backends.
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except cv2.error:
            pass
        return cap

    def run(self) -> None:  # noqa: C901 - the loop is intentionally explicit
        backoff = self._cfg.reconnect_backoff_s
        cap: Optional[cv2.VideoCapture] = None

        while not self._stop.is_set():
            if cap is None:
                cap = self._open_capture()
                if cap is None:
                    self._log.warning("cannot open source; retrying in %.1fs", backoff)
                    self._stop.wait(backoff)
                    backoff = min(backoff * 2, self._cfg.reconnect_backoff_max_s)
                    continue
                self._log.info("stream connected")
                backoff = self._cfg.reconnect_backoff_s  # reset on success

            ok, frame = cap.read()
            if not ok or frame is None:
                self._log.warning("read failed / stream dropped; reconnecting")
                cap.release()
                cap = None
                self._stop.wait(backoff)
                backoff = min(backoff * 2, self._cfg.reconnect_backoff_max_s)
                continue

            try:
                self._process_frame(frame)
            except Exception:  # never let one bad frame kill the camera
                self._log.exception("error processing frame")

            # Light pacing so we don't pin a CPU core decoding every frame; the
            # request throttle is enforced separately in _process_frame.
            self._stop.wait(0.05)

        if cap is not None:
            cap.release()
        self._session.close()
        self._log.info("worker stopped")

    # -- per-frame logic ----------------------------------------------------
    def _process_frame(self, frame: np.ndarray) -> None:
        now = time.monotonic()
        if not self._debounce.may_request(now, self._cfg.request_interval_s):
            return
        if not self._gate.should_send(frame):
            return

        self._debounce.note_request(now)
        prepared = self._prepare_frame(frame)
        result = self._post_recognize(prepared)
        if result is None:
            # Network/API error already logged; apply the non-grant quiet window
            # so we back off briefly rather than retry on the very next frame.
            self._debounce.note_decision(now, "error", None,
                                         self._cfg.debounce_seconds)
            return

        self._log_decision(result)
        self._debounce.note_decision(
            now,
            decision=result.get("decision", "unknown_face"),
            member_id=(result.get("member") or {}).get("id"),
            grant_quiet_s=self._cfg.debounce_seconds,
        )

    def _prepare_frame(self, frame: np.ndarray) -> bytes:
        """Downscale wide frames and JPEG-encode for the multipart upload."""
        h, w = frame.shape[:2]
        max_w = self._cfg.frame_max_width
        if max_w and w > max_w:
            scale = max_w / float(w)
            frame = cv2.resize(frame, (max_w, int(h * scale)),
                               interpolation=cv2.INTER_AREA)
        quality = max(50, min(95, self._cfg.jpeg_quality))
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
        if not ok:
            raise RuntimeError("JPEG encoding failed")
        return buf.tobytes()

    def _post_recognize(self, image_bytes: bytes) -> Optional[dict]:
        """
        POST the frame to ``/api/recognize``. Returns the parsed
        :class:`RecognizeResult` dict, or None on any transport/HTTP error.
        """
        files = {"image": ("frame.jpg", image_bytes, "image/jpeg")}
        data: dict[str, str] = {}
        if self._cam.camera_id:
            data["camera_id"] = self._cam.camera_id
        if self._cam.door_id:
            data["door_id"] = self._cam.door_id

        headers = {"X-Device-Key": self._cfg.device_key}
        try:
            resp = self._session.post(
                self._cfg.recognize_url,
                files=files,
                data=data,
                headers=headers,
                timeout=self._cfg.http_timeout_s,
            )
        except requests.RequestException as exc:
            self._log.warning("recognize request failed: %s", exc)
            return None

        if resp.status_code == 401 or resp.status_code == 403:
            self._log.error("recognize rejected (%s): check LIWAN_DEVICE_KEY",
                            resp.status_code)
            return None
        if resp.status_code >= 400:
            self._log.warning("recognize returned HTTP %s: %s",
                              resp.status_code, _short(resp.text))
            return None

        try:
            return resp.json()
        except ValueError:
            self._log.warning("recognize returned non-JSON body: %s",
                              _short(resp.text))
            return None

    def _log_decision(self, result: dict) -> None:
        """Log the structured decision at a level matching its severity."""
        decision = result.get("decision", "unknown_face")
        member = result.get("member") or {}
        name = member.get("full_name")
        similarity = result.get("similarity")
        direction = result.get("direction", "unknown")
        door_opened = bool(result.get("door_opened"))

        sim_txt = f"{similarity:.3f}" if isinstance(similarity, (int, float)) else "—"
        who = name or "(no match)"
        msg = ("decision=%s who=%s sim=%s dir=%s door_opened=%s"
               % (decision, who, sim_txt, direction, door_opened))

        if decision == "granted":
            self._log.info(msg)
        elif decision in ("not_authorized", "off_schedule", "denied"):
            self._log.warning(msg)
        else:  # unknown_face / anything else
            self._log.info(msg)


def _short(text: str, limit: int = 200) -> str:
    text = (text or "").strip().replace("\n", " ")
    return text if len(text) <= limit else text[:limit] + "…"


def _setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
        stream=sys.stdout,
    )


def main() -> int:
    # Bootstrap logging early at INFO so config errors are visible, then re-apply
    # the configured level once we have it.
    _setup_logging("INFO")
    try:
        cfg = config.load()
    except ConfigError as exc:
        log.error("configuration error: %s", exc)
        return 2

    _setup_logging(cfg.log_level)
    log.info("LIWAN Bridge starting | api=%s cameras=%d interval=%.1fs debounce=%.1fs",
             cfg.api_url, len(cfg.cameras), cfg.request_interval_s,
             cfg.debounce_seconds)

    stop_event = threading.Event()

    def _handle_signal(signum, _frame):
        log.info("received signal %s; shutting down", signum)
        stop_event.set()

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    workers = [CameraWorker(cam, cfg, stop_event) for cam in cfg.cameras]
    for w in workers:
        w.start()
        log.info("started worker %s", w.name)

    # Wait until a signal sets the stop event. Polling keeps the main thread
    # responsive to signals on every platform.
    try:
        while not stop_event.is_set():
            stop_event.wait(1.0)
    except KeyboardInterrupt:
        stop_event.set()

    log.info("stopping %d worker(s)…", len(workers))
    for w in workers:
        w.join(timeout=10.0)
    log.info("bridge stopped cleanly")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
