"""
LIWAN Bridge — configuration & camera discovery.

The bridge is a headless worker for FIXED cameras (RTSP / USB). It needs two
things to run:

  1. Where the Liwan API is and how to authenticate to it as a device
     (``LIWAN_API_URL`` + ``LIWAN_DEVICE_KEY``).
  2. The list of cameras to watch — each with a video ``source`` and the
     ``camera_id`` / ``door_id`` the API uses for decisioning.

Cameras can be discovered in two ways (in priority order):

  * **Local JSON** — ``CAMERAS`` (inline JSON) or ``CAMERAS_FILE`` (path). This
    is the fully-offline path: no operator credentials needed, the integrator
    pins exactly which streams this box pulls. Preferred for air-gapped sites.

  * **Liwan API** — ``GET /api/cameras``. That endpoint is operator-authed
    (``Authorization: Bearer``), so if used, set ``LIWAN_OPERATOR_EMAIL`` /
    ``LIWAN_OPERATOR_PASSWORD`` and the bridge will log in to fetch the list.
    The device key alone cannot list cameras (it only opens ``/api/recognize``).

Nothing here is hard-coded to a site, IP, or door — every value comes from the
environment, matching the on-prem white-label contract.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

log = logging.getLogger("liwan.bridge.config")

# Load a local .env when present (dev / bare-metal). In Docker the values are
# injected as real env vars and this is a harmless no-op.
load_dotenv()


def _get(name: str, default: Optional[str] = None) -> Optional[str]:
    """Read an env var, treating empty/whitespace as unset."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    raw = raw.strip()
    return raw if raw else default


def _get_float(name: str, default: float) -> float:
    raw = _get(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        log.warning("env %s=%r is not a number; using default %s", name, raw, default)
        return default


def _get_int(name: str, default: int) -> int:
    raw = _get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError:
        log.warning("env %s=%r is not an int; using default %s", name, raw, default)
        return default


def _get_bool(name: str, default: bool) -> bool:
    raw = _get(name)
    if raw is None:
        return default
    return raw.lower() in ("1", "true", "yes", "on")


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or malformed."""


# ---------------------------------------------------------------------------
# Camera model
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class CameraConfig:
    """
    One video source the bridge pulls from.

    ``camera_id`` / ``door_id`` are the identifiers the Liwan API expects on
    ``POST /api/recognize`` — they drive threshold, access-group and schedule
    decisions server-side. ``recognition_threshold`` / ``det_prob_threshold``
    are carried only for local gating/observability; the API remains the source
    of truth for the grant/deny decision (it re-applies the camera's own
    threshold from the database).
    """

    name: str
    source: str                       # rtsp://… or a USB device index like "0"
    camera_id: Optional[str] = None
    door_id: Optional[str] = None
    enabled: bool = True
    recognition_threshold: Optional[float] = None
    det_prob_threshold: Optional[float] = None

    @property
    def capture_source(self) -> "int | str":
        """
        Return the value to hand to ``cv2.VideoCapture``.

        A bare integer string ("0", "1", …) is a local USB device index and must
        be passed as an int; anything else (rtsp://, http://, file path) is a
        string URL.
        """
        s = self.source.strip()
        if s.isdigit():
            return int(s)
        return s

    @staticmethod
    def from_api(row: dict[str, Any]) -> "CameraConfig":
        """Build from a Liwan API ``/api/cameras`` row."""
        return CameraConfig(
            name=str(row.get("name") or row.get("id") or "camera"),
            source=str(row.get("source") or "").strip(),
            camera_id=_str_or_none(row.get("id")),
            door_id=_str_or_none(row.get("door_id")),
            enabled=bool(row.get("enabled", True)),
            recognition_threshold=_num_or_none(row.get("recognition_threshold")),
            det_prob_threshold=_num_or_none(row.get("det_prob_threshold")),
        )

    @staticmethod
    def from_local(row: dict[str, Any]) -> "CameraConfig":
        """
        Build from a local CAMERAS JSON entry.

        Accepts both ``camera_id`` and ``id`` for convenience so the same JSON
        shape works whether it was copied from the API or hand-written.
        """
        source = row.get("source")
        if not source:
            raise ConfigError(f"camera entry missing 'source': {row!r}")
        return CameraConfig(
            name=str(row.get("name") or row.get("camera_id") or row.get("id") or "camera"),
            source=str(source).strip(),
            camera_id=_str_or_none(row.get("camera_id") or row.get("id")),
            door_id=_str_or_none(row.get("door_id")),
            enabled=bool(row.get("enabled", True)),
            recognition_threshold=_num_or_none(row.get("recognition_threshold")),
            det_prob_threshold=_num_or_none(row.get("det_prob_threshold")),
        )


def _str_or_none(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _num_or_none(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Top-level config
# ---------------------------------------------------------------------------
@dataclass
class BridgeConfig:
    """Resolved runtime configuration for the whole bridge process."""

    api_url: str
    device_key: str

    # Optional operator login, only needed when discovering cameras via the API.
    operator_email: Optional[str] = None
    operator_password: Optional[str] = None

    # Local camera discovery (offline path).
    cameras_inline: Optional[str] = None
    cameras_file: Optional[str] = None

    # Loop tuning (sane CPU-friendly defaults; all overridable via env).
    request_interval_s: float = 1.5     # min seconds between POSTs per camera
    debounce_seconds: float = 8.0       # per-camera: skip same person within this
    motion_min_area_frac: float = 0.012  # frame fraction that must change to "wake"
    reconnect_backoff_s: float = 2.0    # initial backoff after a stream drop
    reconnect_backoff_max_s: float = 30.0
    http_timeout_s: float = 15.0
    jpeg_quality: int = 85
    frame_max_width: int = 960          # downscale wide frames before POST (bandwidth)
    log_level: str = "INFO"

    # Resolved camera list (filled by load()).
    cameras: list[CameraConfig] = field(default_factory=list)

    @property
    def recognize_url(self) -> str:
        return f"{self.api_url}/api/recognize"

    @property
    def cameras_url(self) -> str:
        return f"{self.api_url}/api/cameras"

    @property
    def login_url(self) -> str:
        return f"{self.api_url}/api/auth/login"


def load() -> BridgeConfig:
    """
    Build a :class:`BridgeConfig` from the environment and resolve the camera
    list. Raises :class:`ConfigError` if required values are missing or no
    usable cameras are found.
    """
    api_url = _get("LIWAN_API_URL")
    if not api_url:
        raise ConfigError("LIWAN_API_URL is required (e.g. http://liwan-api:8088)")
    api_url = api_url.rstrip("/")

    device_key = _get("LIWAN_DEVICE_KEY")
    if not device_key:
        raise ConfigError("LIWAN_DEVICE_KEY is required (shared device secret)")

    cfg = BridgeConfig(
        api_url=api_url,
        device_key=device_key,
        operator_email=_get("LIWAN_OPERATOR_EMAIL"),
        operator_password=_get("LIWAN_OPERATOR_PASSWORD"),
        cameras_inline=_get("CAMERAS"),
        cameras_file=_get("CAMERAS_FILE"),
        request_interval_s=_get_float("BRIDGE_REQUEST_INTERVAL_S", 1.5),
        debounce_seconds=_get_float("BRIDGE_DEBOUNCE_SECONDS", 8.0),
        motion_min_area_frac=_get_float("BRIDGE_MOTION_MIN_AREA_FRAC", 0.012),
        reconnect_backoff_s=_get_float("BRIDGE_RECONNECT_BACKOFF_S", 2.0),
        reconnect_backoff_max_s=_get_float("BRIDGE_RECONNECT_BACKOFF_MAX_S", 30.0),
        http_timeout_s=_get_float("BRIDGE_HTTP_TIMEOUT_S", 15.0),
        jpeg_quality=_get_int("BRIDGE_JPEG_QUALITY", 85),
        frame_max_width=_get_int("BRIDGE_FRAME_MAX_WIDTH", 960),
        log_level=(_get("BRIDGE_LOG_LEVEL", "INFO") or "INFO").upper(),
    )

    cfg.cameras = _resolve_cameras(cfg)
    if not cfg.cameras:
        raise ConfigError(
            "no enabled cameras found. Set CAMERAS / CAMERAS_FILE, or configure "
            "cameras in Liwan and provide LIWAN_OPERATOR_EMAIL / "
            "LIWAN_OPERATOR_PASSWORD so the bridge can call GET /api/cameras."
        )
    return cfg


def _resolve_cameras(cfg: BridgeConfig) -> list[CameraConfig]:
    """
    Resolve the camera list. Local JSON wins when present (offline-first); the
    API is the fallback. Only enabled cameras with a usable source are kept.
    """
    cameras: list[CameraConfig] = []

    local = _load_local_cameras(cfg)
    if local is not None:
        cameras = local
        log.info("loaded %d camera(s) from local CAMERAS config", len(cameras))
    else:
        cameras = _load_api_cameras(cfg)
        log.info("loaded %d camera(s) from %s", len(cameras), cfg.cameras_url)

    usable: list[CameraConfig] = []
    for cam in cameras:
        if not cam.enabled:
            log.info("skipping disabled camera %r", cam.name)
            continue
        if not cam.source:
            log.warning("skipping camera %r: empty source", cam.name)
            continue
        usable.append(cam)
    return usable


def _load_local_cameras(cfg: BridgeConfig) -> Optional[list[CameraConfig]]:
    """
    Load cameras from CAMERAS (inline) or CAMERAS_FILE (path). Returns ``None``
    when neither is set, so the caller falls back to the API.
    """
    raw: Optional[str] = None
    origin = ""

    if cfg.cameras_inline:
        raw = cfg.cameras_inline
        origin = "CAMERAS env"
    elif cfg.cameras_file:
        path = Path(cfg.cameras_file)
        if not path.is_file():
            raise ConfigError(f"CAMERAS_FILE not found: {path}")
        raw = path.read_text(encoding="utf-8")
        origin = str(path)

    if raw is None:
        return None

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ConfigError(f"invalid JSON in {origin}: {exc}") from exc

    # Accept either a bare list or {"cameras": [...]}.
    if isinstance(data, dict):
        data = data.get("cameras", [])
    if not isinstance(data, list):
        raise ConfigError(f"{origin} must be a JSON array of camera objects")

    return [CameraConfig.from_local(item) for item in data]


def _load_api_cameras(cfg: BridgeConfig) -> list[CameraConfig]:
    """
    Fetch the camera list from ``GET /api/cameras``. Requires operator
    credentials because that endpoint is bearer-authed per the contract.

    Imported lazily so config loading does not require ``requests`` unless the
    API path is actually used (keeps the local/offline path dependency-light).
    """
    if not (cfg.operator_email and cfg.operator_password):
        raise ConfigError(
            "no local CAMERAS provided and no operator credentials set. "
            "Provide CAMERAS / CAMERAS_FILE for offline use, or set "
            "LIWAN_OPERATOR_EMAIL and LIWAN_OPERATOR_PASSWORD to list cameras "
            "via the API."
        )

    import requests  # local import: only needed on the API path

    try:
        login = requests.post(
            cfg.login_url,
            json={"email": cfg.operator_email, "password": cfg.operator_password},
            timeout=cfg.http_timeout_s,
        )
        login.raise_for_status()
        token = login.json().get("access_token")
        if not token:
            raise ConfigError("login succeeded but no access_token in response")

        resp = requests.get(
            cfg.cameras_url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=cfg.http_timeout_s,
        )
        resp.raise_for_status()
        rows = resp.json()
    except requests.RequestException as exc:
        raise ConfigError(f"failed to fetch cameras from API: {exc}") from exc

    if not isinstance(rows, list):
        raise ConfigError("GET /api/cameras did not return a JSON array")

    return [CameraConfig.from_api(row) for row in rows]
