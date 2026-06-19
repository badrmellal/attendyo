"""CompreFace recognition-engine client.

Thin, defensive ``httpx`` wrapper over the CompreFace REST API. CompreFace is the
Apache-2.0 recognition core bundled in the same compose stack. We talk to its
**Recognition** service:

* ``POST /api/v1/recognition/recognize``           — match a face image to subjects
* ``POST /api/v1/recognition/faces?subject=<name>`` — add a face to a subject
* ``GET  /api/v1/recognition/subjects``            — list subjects
* ``DELETE /api/v1/recognition/subjects/<name>``    — delete a subject + its faces

Design goals:
* **Tolerant when the engine is down.** Every method either returns a typed,
  empty-ish result or raises ``ComprefaceUnavailable`` — it never leaks a raw
  httpx error into a request handler. Callers decide how to degrade.
* **Sync.** httpx is used synchronously; routers off-load via threadpool.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

from .config import get_settings

logger = logging.getLogger("liwan.compreface")


class ComprefaceError(Exception):
    """Base class for CompreFace client errors."""


class ComprefaceUnavailable(ComprefaceError):
    """The engine could not be reached or timed out."""


class ComprefaceRejected(ComprefaceError):
    """The engine reached but rejected the request (e.g. no face detected)."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(slots=True)
class SubjectMatch:
    """One recognition candidate for a detected face."""

    subject: str
    similarity: float


@dataclass(slots=True)
class RecognitionResult:
    """Best match for the most prominent detected face (if any)."""

    subject: str | None = None
    similarity: float | None = None
    detection_probability: float | None = None
    # All candidates for the top face, best first (debugging / future use).
    candidates: list[SubjectMatch] = field(default_factory=list)
    face_detected: bool = False


def _base_url() -> str:
    return get_settings().compreface_api_url.rstrip("/")


def _headers() -> dict[str, str]:
    return {"x-api-key": get_settings().compreface_api_key}


def _client() -> httpx.Client:
    return httpx.Client(timeout=get_settings().compreface_timeout_seconds)


# --------------------------------------------------------------------------- #
# Recognition
# --------------------------------------------------------------------------- #
def recognize(
    image_bytes: bytes,
    *,
    filename: str = "frame.jpg",
    det_prob_threshold: float | None = None,
    limit: int = 1,
    prediction_count: int = 1,
) -> RecognitionResult:
    """Recognize the most prominent face in ``image_bytes``.

    Returns a :class:`RecognitionResult`. When no face is detected the result has
    ``face_detected=False`` and no subject. Raises :class:`ComprefaceUnavailable`
    only when the engine is unreachable.
    """
    url = f"{_base_url()}/api/v1/recognition/recognize"
    params: dict[str, Any] = {"limit": limit, "prediction_count": prediction_count}
    if det_prob_threshold is not None:
        params["det_prob_threshold"] = det_prob_threshold

    files = {"file": (filename, image_bytes, "image/jpeg")}
    try:
        with _client() as client:
            resp = client.post(url, params=params, headers=_headers(), files=files)
    except httpx.HTTPError as exc:
        logger.warning("CompreFace recognize unreachable: %s", exc)
        raise ComprefaceUnavailable(str(exc)) from exc

    # 400 typically means "No face found" — a normal outcome, not an error.
    if resp.status_code == 400:
        logger.debug("CompreFace: no face detected (400)")
        return RecognitionResult(face_detected=False)
    if resp.status_code >= 500:
        raise ComprefaceUnavailable(f"engine {resp.status_code}")
    if resp.status_code != 200:
        raise ComprefaceRejected(
            f"recognize failed: {resp.text[:200]}", status_code=resp.status_code
        )

    data = resp.json()
    results = data.get("result") or []
    if not results:
        return RecognitionResult(face_detected=False)

    # Pick the largest face by bounding-box area (most prominent subject).
    def _area(face: dict[str, Any]) -> float:
        box = face.get("box") or {}
        try:
            return (box["x_max"] - box["x_min"]) * (box["y_max"] - box["y_min"])
        except (KeyError, TypeError):
            return 0.0

    top_face = max(results, key=_area)
    box = top_face.get("box") or {}
    subjects = top_face.get("subjects") or []
    candidates = [
        SubjectMatch(subject=s.get("subject", ""), similarity=float(s.get("similarity", 0.0)))
        for s in subjects
    ]
    candidates.sort(key=lambda c: c.similarity, reverse=True)

    best = candidates[0] if candidates else None
    return RecognitionResult(
        subject=best.subject if best else None,
        similarity=best.similarity if best else None,
        detection_probability=(
            float(box["probability"]) if isinstance(box.get("probability"), (int, float)) else None
        ),
        candidates=candidates,
        face_detected=True,
    )


# --------------------------------------------------------------------------- #
# Enrollment / subject management
# --------------------------------------------------------------------------- #
def add_subject_with_face(
    subject_name: str,
    image_bytes: bytes,
    *,
    filename: str = "enroll.jpg",
    det_prob_threshold: float | None = None,
) -> dict[str, Any]:
    """Add one face to ``subject_name`` (creating the subject implicitly).

    CompreFace creates the subject on first face add, so a single call both
    creates the subject and enrolls the face — "one photo is enough".
    """
    url = f"{_base_url()}/api/v1/recognition/faces"
    params: dict[str, Any] = {"subject": subject_name}
    if det_prob_threshold is not None:
        params["det_prob_threshold"] = det_prob_threshold

    files = {"file": (filename, image_bytes, "image/jpeg")}
    try:
        with _client() as client:
            resp = client.post(url, params=params, headers=_headers(), files=files)
    except httpx.HTTPError as exc:
        logger.warning("CompreFace add face unreachable: %s", exc)
        raise ComprefaceUnavailable(str(exc)) from exc

    if resp.status_code in (200, 201):
        return resp.json()
    if resp.status_code == 400:
        # No face / multiple faces / bad image — actionable client error.
        raise ComprefaceRejected(
            _extract_message(resp) or "No face detected in the supplied image",
            status_code=400,
        )
    if resp.status_code >= 500:
        raise ComprefaceUnavailable(f"engine {resp.status_code}")
    raise ComprefaceRejected(
        _extract_message(resp) or f"add face failed ({resp.status_code})",
        status_code=resp.status_code,
    )


def delete_subject(subject_name: str) -> bool:
    """Delete a subject and all its faces. Returns False if engine unreachable.

    A missing subject (404) is treated as success — the desired end state holds.
    """
    url = f"{_base_url()}/api/v1/recognition/subjects/{subject_name}"
    try:
        with _client() as client:
            resp = client.delete(url, headers=_headers())
    except httpx.HTTPError as exc:
        logger.warning("CompreFace delete subject unreachable: %s", exc)
        return False
    if resp.status_code in (200, 201, 204, 404):
        return True
    logger.warning("CompreFace delete subject %s -> %s", subject_name, resp.status_code)
    return False


def list_subjects() -> list[str]:
    """List enrolled subject names. Returns [] when the engine is unreachable."""
    url = f"{_base_url()}/api/v1/recognition/subjects"
    try:
        with _client() as client:
            resp = client.get(url, headers=_headers())
    except httpx.HTTPError as exc:
        logger.warning("CompreFace list subjects unreachable: %s", exc)
        return []
    if resp.status_code != 200:
        return []
    return list(resp.json().get("subjects", []))


def health() -> bool:
    """Report whether the recognition engine answers. Never raises."""
    url = f"{_base_url()}/api/v1/recognition/subjects"
    try:
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(url, headers=_headers())
        # 200 = ok; 401/403 still proves the engine is up and reachable.
        return resp.status_code < 500
    except httpx.HTTPError:
        return False


def _extract_message(resp: httpx.Response) -> str | None:
    """Pull a human message out of a CompreFace error body, if present."""
    try:
        body = resp.json()
    except ValueError:
        return resp.text[:200] or None
    if isinstance(body, dict):
        return body.get("message") or body.get("msg")
    return None
