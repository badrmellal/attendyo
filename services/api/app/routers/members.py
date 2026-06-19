"""Members router — enrollment & CRUD.

Contract endpoints:
* ``POST   /api/members``            multipart: member fields + one ``image`` → Member
* ``POST   /api/members/{id}/photo`` multipart ``image`` → add/replace a face
* ``GET    /api/members``            ``?q=&status=&department=&type=`` → Member[]
* ``GET    /api/members/{id}``       → Member
* ``GET    /api/members/{id}/photo`` → the stored enrollment image
* ``PATCH  /api/members/{id}``       → Member
* ``DELETE /api/members/{id}``       → removes member + CompreFace subject

Enrollment creates the CompreFace subject and adds the single face in one call —
"one photo is enough". If the engine is unavailable, enrollment fails loudly
(422) rather than creating a member that can never be recognised.
"""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Path,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from ..core import compreface, db, media, security
from ..models.schemas import Member, MemberType, MemberStatus, MemberUpdate

logger = logging.getLogger("liwan.members")

router = APIRouter(prefix="/api/members", tags=["members"])

_MEMBER_COLUMNS = (
    "id, external_id, full_name, subject_name, member_type, department, title, "
    "email, phone, access_group_id, photo_path, status, created_at"
)

_MAX_IMAGE_BYTES = 12 * 1024 * 1024  # 12 MB safety bound


def _to_member(row: dict[str, Any]) -> Member:
    """Map a DB row to the contract ``Member`` (photo_path → photo_url)."""
    return Member(
        id=str(row["id"]),
        external_id=row.get("external_id"),
        full_name=row["full_name"],
        subject_name=row.get("subject_name"),
        member_type=row["member_type"],
        department=row.get("department"),
        title=row.get("title"),
        email=row.get("email"),
        phone=row.get("phone"),
        access_group_id=str(row["access_group_id"]) if row.get("access_group_id") else None,
        photo_url=(f"/api/members/{row['id']}/photo" if row.get("photo_path") else None),
        status=row["status"],
        created_at=row["created_at"],
    )


def _slugify_subject(full_name: str, member_id: str) -> str:
    """Stable, human-readable CompreFace subject id, unique per member.

    CompreFace subject names are free text; we use ``<slug>-<short-uuid>`` so two
    people with the same name never collide.
    """
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", full_name.strip().lower()).strip("-")
    slug = slug or "member"
    return f"{slug}-{member_id.split('-')[0]}"


async def _read_image(image: UploadFile) -> bytes:
    data = await image.read()
    if not data:
        raise HTTPException(status_code=422, detail="Uploaded image is empty")
    if len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds 12 MB limit")
    return data


# --------------------------------------------------------------------------- #
# Create (enroll)
# --------------------------------------------------------------------------- #
@router.post("", response_model=Member, status_code=status.HTTP_201_CREATED)
async def create_member(
    full_name: str = Form(...),
    member_type: MemberType = Form("employee"),
    external_id: Optional[str] = Form(None),
    department: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
    email: Optional[str] = Form(None),
    phone: Optional[str] = Form(None),
    access_group_id: Optional[str] = Form(None),
    status_: MemberStatus = Form("active", alias="status"),
    image: UploadFile = File(...),
    _user: dict = Depends(security.get_current_user),
) -> Member:
    """Create a member and enroll their single face into CompreFace."""
    data = await _read_image(image)
    member_id = str(uuid.uuid4())
    subject_name = _slugify_subject(full_name, member_id)

    # Enroll in CompreFace first; if it fails we never persist a half-member.
    try:
        await run_in_threadpool(
            compreface.add_subject_with_face,
            subject_name,
            data,
            filename=image.filename or "enroll.jpg",
        )
    except compreface.ComprefaceUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Recognition engine unavailable; cannot enroll right now",
        ) from exc
    except compreface.ComprefaceRejected as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    photo_rel = await run_in_threadpool(media.save_enrollment, member_id, data)

    def _insert() -> dict[str, Any]:
        return db.execute_returning(
            f"""
            INSERT INTO members
                (id, external_id, full_name, subject_name, member_type, department,
                 title, email, phone, access_group_id, photo_path, status)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING {_MEMBER_COLUMNS}
            """,
            (
                member_id, external_id, full_name, subject_name, member_type,
                department, title, email, phone, access_group_id, photo_rel, status_,
            ),
        )

    try:
        row = await run_in_threadpool(_insert)
    except Exception as exc:
        # Roll back the CompreFace subject so we don't leak an orphan face.
        await run_in_threadpool(compreface.delete_subject, subject_name)
        logger.exception("Member insert failed; rolled back subject %s", subject_name)
        raise HTTPException(status_code=400, detail="Could not create member") from exc

    assert row is not None
    return _to_member(row)


# --------------------------------------------------------------------------- #
# Add / replace a face
# --------------------------------------------------------------------------- #
@router.post("/{member_id}/photo", response_model=Member)
async def add_face(
    member_id: str = Path(...),
    image: UploadFile = File(...),
    _user: dict = Depends(security.get_current_user),
) -> Member:
    """Add another face image to an existing member (improves robustness)."""
    member = await run_in_threadpool(
        db.query_one, f"SELECT {_MEMBER_COLUMNS} FROM members WHERE id = %s", (member_id,)
    )
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    subject_name = member.get("subject_name")
    if not subject_name:
        raise HTTPException(status_code=409, detail="Member has no recognition subject")

    data = await _read_image(image)
    try:
        await run_in_threadpool(
            compreface.add_subject_with_face,
            subject_name,
            data,
            filename=image.filename or "enroll.jpg",
        )
    except compreface.ComprefaceUnavailable as exc:
        raise HTTPException(status_code=503, detail="Recognition engine unavailable") from exc
    except compreface.ComprefaceRejected as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Update the stored display photo to the latest face.
    photo_rel = await run_in_threadpool(media.save_enrollment, member_id, data)
    row = await run_in_threadpool(
        db.execute_returning,
        f"UPDATE members SET photo_path = %s, updated_at = now() WHERE id = %s "
        f"RETURNING {_MEMBER_COLUMNS}",
        (photo_rel, member_id),
    )
    assert row is not None
    return _to_member(row)


# --------------------------------------------------------------------------- #
# List / read
# --------------------------------------------------------------------------- #
@router.get("", response_model=list[Member])
async def list_members(
    q: Optional[str] = Query(None, description="Search name / external id / email"),
    status_: Optional[MemberStatus] = Query(None, alias="status"),
    department: Optional[str] = Query(None),
    type_: Optional[MemberType] = Query(None, alias="type"),
    _user: dict = Depends(security.get_current_user),
) -> list[Member]:
    """List members with optional search and filters."""
    clauses: list[str] = []
    params: list[Any] = []
    if q:
        clauses.append(
            "(full_name ILIKE %s OR external_id ILIKE %s OR email ILIKE %s)"
        )
        like = f"%{q}%"
        params.extend([like, like, like])
    if status_:
        clauses.append("status = %s")
        params.append(status_)
    if department:
        clauses.append("department = %s")
        params.append(department)
    if type_:
        clauses.append("member_type = %s")
        params.append(type_)

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f"SELECT {_MEMBER_COLUMNS} FROM members {where} ORDER BY full_name ASC"
    rows = await run_in_threadpool(db.query_all, sql, params)
    return [_to_member(r) for r in rows]


@router.get("/{member_id}", response_model=Member)
async def get_member(
    member_id: str = Path(...),
    _user: dict = Depends(security.get_current_user),
) -> Member:
    row = await run_in_threadpool(
        db.query_one, f"SELECT {_MEMBER_COLUMNS} FROM members WHERE id = %s", (member_id,)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Member not found")
    return _to_member(row)


@router.get("/{member_id}/photo")
async def get_member_photo(
    member_id: str = Path(...),
    _user: dict = Depends(security.get_current_user),
) -> FileResponse:
    """Serve the member's stored enrollment image."""
    row = await run_in_threadpool(
        db.query_one, "SELECT photo_path FROM members WHERE id = %s", (member_id,)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if not row.get("photo_path"):
        raise HTTPException(status_code=404, detail="No photo on file")
    try:
        path = media.absolute(row["photo_path"])
    except ValueError:
        raise HTTPException(status_code=404, detail="Photo not found")
    if not path.exists():
        raise HTTPException(status_code=404, detail="Photo not found")
    return FileResponse(path)


# --------------------------------------------------------------------------- #
# Update
# --------------------------------------------------------------------------- #
@router.patch("/{member_id}", response_model=Member)
async def update_member(
    payload: MemberUpdate,
    member_id: str = Path(...),
    _user: dict = Depends(security.get_current_user),
) -> Member:
    """Patch mutable member fields. Recognition subject is never changed here."""
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        row = await run_in_threadpool(
            db.query_one, f"SELECT {_MEMBER_COLUMNS} FROM members WHERE id = %s", (member_id,)
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Member not found")
        return _to_member(row)

    set_parts = [f"{col} = %s" for col in updates]
    params = list(updates.values())
    params.append(member_id)
    sql = (
        f"UPDATE members SET {', '.join(set_parts)}, updated_at = now() "
        f"WHERE id = %s RETURNING {_MEMBER_COLUMNS}"
    )
    row = await run_in_threadpool(db.execute_returning, sql, params)
    if row is None:
        raise HTTPException(status_code=404, detail="Member not found")
    return _to_member(row)


# --------------------------------------------------------------------------- #
# Delete
# --------------------------------------------------------------------------- #
@router.delete("/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_member(
    member_id: str = Path(...),
    _user: dict = Depends(security.get_current_user),
) -> None:
    """Delete a member and remove their CompreFace subject."""
    row = await run_in_threadpool(
        db.query_one, "SELECT subject_name, photo_path FROM members WHERE id = %s", (member_id,)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Member not found")

    if row.get("subject_name"):
        # Best-effort; a down engine should not block removing the member record.
        await run_in_threadpool(compreface.delete_subject, row["subject_name"])

    await run_in_threadpool(db.execute, "DELETE FROM members WHERE id = %s", (member_id,))

    # Tidy the stored photo (non-fatal).
    if row.get("photo_path"):
        try:
            path = media.absolute(row["photo_path"])
            if path.exists():
                path.unlink()
        except (ValueError, OSError):  # pragma: no cover
            pass
    return None
