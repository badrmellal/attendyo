"""Local media storage helpers.

Enrollment photos and recognition snapshots are written under ``MEDIA_ROOT``
(``/data/media`` on the docker volume). Files are served back through the API
(``GET /api/members/{id}/photo`` and a static mount for snapshots), so nothing
leaves the LAN.
"""

from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path

from .config import get_settings

logger = logging.getLogger("attendyo.media")

# Subdirectories under MEDIA_ROOT.
ENROLL_DIR = "enroll"
SNAPSHOT_DIR = "snapshots"

# Minimal magic-byte sniffing — we only accept still images for faces.
_MAGIC = {
    b"\xff\xd8\xff": ".jpg",
    b"\x89PNG\r\n\x1a\n": ".png",
    b"RIFF": ".webp",  # RIFF....WEBP (further checked below)
    b"BM": ".bmp",
}


def media_root() -> Path:
    root = Path(get_settings().media_root)
    return root


def ensure_dirs() -> None:
    """Create media subdirectories at startup."""
    root = media_root()
    for sub in (ENROLL_DIR, SNAPSHOT_DIR):
        (root / sub).mkdir(parents=True, exist_ok=True)


def sniff_extension(data: bytes) -> str:
    """Best-effort image extension from magic bytes; defaults to ``.jpg``."""
    if data[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data[:2] == b"BM":
        return ".bmp"
    return ".jpg"


def save_enrollment(member_id: str, data: bytes) -> str:
    """Persist an enrollment image, returning its path relative to MEDIA_ROOT."""
    ext = sniff_extension(data)
    rel = f"{ENROLL_DIR}/{member_id}{ext}"
    abspath = media_root() / rel
    abspath.parent.mkdir(parents=True, exist_ok=True)
    # Remove any prior enrollment image with a different extension.
    for old in abspath.parent.glob(f"{member_id}.*"):
        if old != abspath:
            try:
                old.unlink()
            except OSError:  # pragma: no cover
                pass
    abspath.write_bytes(data)
    return rel


def save_snapshot(data: bytes) -> str:
    """Persist a recognition snapshot, returning its path relative to MEDIA_ROOT."""
    ext = sniff_extension(data)
    today = ""  # flat snapshots dir keeps it simple for an appliance
    name = f"{uuid.uuid4().hex}{ext}"
    rel = f"{SNAPSHOT_DIR}/{today}{name}".replace("//", "/")
    abspath = media_root() / rel
    abspath.parent.mkdir(parents=True, exist_ok=True)
    abspath.write_bytes(data)
    return rel


def absolute(rel_path: str) -> Path:
    """Resolve a stored relative path to an absolute path, guarding traversal."""
    root = media_root().resolve()
    candidate = (root / rel_path).resolve()
    if not str(candidate).startswith(str(root)):
        raise ValueError("Path traversal detected")
    return candidate


def public_url(rel_path: str | None) -> str | None:
    """Map a stored relative path to a client-fetchable URL.

    Enrollment photos are served via the member photo endpoint; everything else
    (snapshots) via the ``/media`` static mount.
    """
    if not rel_path:
        return None
    return f"/media/{rel_path}"
