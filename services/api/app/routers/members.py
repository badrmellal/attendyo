"""Members router — enrollment, CRUD & bulk import.

Contract endpoints:
* ``POST   /api/members``            multipart: member fields + one ``image`` → Member
* ``POST   /api/members/import``     multipart ``file`` (CSV) → ImportResult
* ``POST   /api/members/{id}/photo`` multipart ``image`` → add/replace a face
* ``GET    /api/members``            ``?q=&status=&department=&type=`` → Member[]
* ``GET    /api/members/{id}``       → Member
* ``GET    /api/members/{id}/photo`` → the stored enrollment image
* ``PATCH  /api/members/{id}``       → Member
* ``DELETE /api/members/{id}``       → removes member + engine subject

Enrollment creates the engine subject and adds the single face in one call —
"one photo is enough". If the engine is unavailable, enrollment fails loudly
rather than creating a member that can never be recognised. Bulk import creates
members WITHOUT photos (faces are enrolled later, one by one).
"""

from __future__ import annotations

import csv
import datetime as dt
import io
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

from ..core import audit, db, engine, media, security
from ..models.schemas import (
    ImportLineError,
    ImportResult,
    Member,
    MemberStatus,
    MemberType,
    MemberUpdate,
)

logger = logging.getLogger("attendyo.members")

router = APIRouter(prefix="/api/members", tags=["members"])

_MEMBER_COLUMNS = (
    "id, external_id, full_name, subject_name, member_type, department, title, "
    "email, phone, access_group_id, photo_path, valid_from, valid_until, status, "
    "created_at"
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
        valid_from=row.get("valid_from"),
        valid_until=row.get("valid_until"),
        status=row["status"],
        created_at=row["created_at"],
    )


def _slugify_subject(full_name: str, member_id: str) -> str:
    """Stable, human-readable engine subject id, unique per member.

    Engine subject names are free text; we use ``<slug>-<short-uuid>`` so two
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
    valid_from: Optional[dt.date] = Form(None),
    valid_until: Optional[dt.date] = Form(None),
    status_: MemberStatus = Form("active", alias="status"),
    image: UploadFile = File(...),
    user: dict = Depends(security.require_operator),
) -> Member:
    """Create a member and enroll their single face into the vision engine."""
    if valid_from and valid_until and valid_from > valid_until:
        raise HTTPException(status_code=422, detail="valid_from must be <= valid_until")
    data = await _read_image(image)
    member_id = str(uuid.uuid4())
    subject_name = _slugify_subject(full_name, member_id)

    # Enroll in the engine first; if it fails we never persist a half-member.
    try:
        await run_in_threadpool(
            engine.add_subject_with_face,
            subject_name,
            data,
            filename=image.filename or "enroll.jpg",
        )
    except engine.EngineUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Recognition engine unavailable; cannot enroll right now",
        ) from exc
    except engine.EngineRejected as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    photo_rel = await run_in_threadpool(media.save_enrollment, member_id, data)

    def _insert() -> dict[str, Any]:
        return db.execute_returning(
            f"""
            INSERT INTO members
                (id, external_id, full_name, subject_name, member_type, department,
                 title, email, phone, access_group_id, photo_path, valid_from,
                 valid_until, status)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING {_MEMBER_COLUMNS}
            """,
            (
                member_id, external_id, full_name, subject_name, member_type,
                department, title, email, phone, access_group_id, photo_rel,
                valid_from, valid_until, status_,
            ),
        )

    try:
        row = await run_in_threadpool(_insert)
    except Exception as exc:
        # Roll back the engine subject so we don't leak an orphan face.
        await run_in_threadpool(engine.delete_subject, subject_name)
        logger.exception("Member insert failed; rolled back subject %s", subject_name)
        raise HTTPException(status_code=400, detail="Could not create member") from exc

    assert row is not None
    await run_in_threadpool(
        audit.record, user, "member.create", entity="member", entity_id=member_id,
        details={"full_name": full_name, "member_type": member_type},
    )
    return _to_member(row)


# --------------------------------------------------------------------------- #
# Bulk import (CSV, no photos)
# --------------------------------------------------------------------------- #
_IMPORT_HEADER = [
    "full_name", "external_id", "member_type", "department", "title",
    "email", "phone", "valid_from", "valid_until",
]
_VALID_MEMBER_TYPES = {
    "employee", "resident", "contractor", "visitor", "student", "faculty", "staff",
}
_MAX_IMPORT_BYTES = 5 * 1024 * 1024  # 5 MB of CSV is thousands of members


def _parse_import_date(raw: str, field: str, line_no: int) -> dt.date:
    try:
        return dt.date.fromisoformat(raw)
    except ValueError as exc:
        raise ValueError(f"line {line_no}: invalid {field} '{raw}' (YYYY-MM-DD)") from exc


@router.post("/import", response_model=ImportResult)
async def import_members(
    file: UploadFile = File(...),
    user: dict = Depends(security.require_operator),
) -> ImportResult:
    """Bulk-create members from a CSV file (no photos; enrol faces later).

    Expected header:
    ``full_name,external_id,member_type,department,title,email,phone,valid_from,valid_until``
    Only ``full_name`` is mandatory per row. Rows whose ``external_id`` already
    exists are skipped; malformed rows are reported per line and do not abort
    the rest of the file.
    """
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")
    if len(raw) > _MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="CSV exceeds 5 MB limit")
    try:
        text = raw.decode("utf-8-sig")  # tolerate Excel's BOM
    except UnicodeDecodeError:
        try:
            text = raw.decode("latin-1")
        except UnicodeDecodeError as exc:  # pragma: no cover - latin-1 can't fail
            raise HTTPException(status_code=422, detail="File is not valid text") from exc

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise HTTPException(status_code=422, detail="CSV has no header row")
    fieldnames = [f.strip().lower() for f in reader.fieldnames]
    if "full_name" not in fieldnames:
        raise HTTPException(
            status_code=422,
            detail="CSV header must include 'full_name' "
            f"(expected columns: {','.join(_IMPORT_HEADER)})",
        )
    unknown = [f for f in fieldnames if f and f not in _IMPORT_HEADER]
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown CSV columns: {', '.join(unknown)} "
            f"(expected: {','.join(_IMPORT_HEADER)})",
        )
    # Re-map rows through the normalised header.
    reader = csv.DictReader(io.StringIO(text), fieldnames=fieldnames)
    rows = list(reader)[1:]  # skip the header row itself

    def _import_all() -> ImportResult:
        created = 0
        skipped = 0
        errors: list[ImportLineError] = []
        for offset, raw_row in enumerate(rows):
            line_no = offset + 2  # 1-based, +1 for the header line
            try:
                row = {k: (v or "").strip() for k, v in raw_row.items() if k}
                full_name = row.get("full_name", "")
                if not full_name:
                    raise ValueError(f"line {line_no}: full_name is required")
                member_type = (row.get("member_type") or "employee").lower()
                if member_type not in _VALID_MEMBER_TYPES:
                    raise ValueError(
                        f"line {line_no}: invalid member_type '{member_type}'"
                    )
                valid_from = (
                    _parse_import_date(row["valid_from"], "valid_from", line_no)
                    if row.get("valid_from") else None
                )
                valid_until = (
                    _parse_import_date(row["valid_until"], "valid_until", line_no)
                    if row.get("valid_until") else None
                )
                if valid_from and valid_until and valid_from > valid_until:
                    raise ValueError(f"line {line_no}: valid_from is after valid_until")

                external_id = row.get("external_id") or None
                if external_id:
                    exists = db.query_one(
                        "SELECT 1 FROM members WHERE external_id = %s", (external_id,)
                    )
                    if exists:
                        skipped += 1
                        continue

                db.execute(
                    """
                    INSERT INTO members
                        (external_id, full_name, member_type, department, title,
                         email, phone, valid_from, valid_until, status)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'active')
                    """,
                    (
                        external_id, full_name, member_type,
                        row.get("department") or None, row.get("title") or None,
                        row.get("email") or None, row.get("phone") or None,
                        valid_from, valid_until,
                    ),
                )
                created += 1
            except ValueError as exc:
                errors.append(ImportLineError(line=line_no, message=str(exc)))
            except Exception as exc:  # defensive: one bad row never kills the batch
                logger.warning("Import line %d failed: %s", line_no, exc)
                errors.append(
                    ImportLineError(line=line_no, message="Could not insert row")
                )
        return ImportResult(created=created, skipped=skipped, errors=errors)

    result = await run_in_threadpool(_import_all)
    await run_in_threadpool(
        audit.record, user, "member.import", entity="member",
        details={
            "filename": file.filename,
            "created": result.created,
            "skipped": result.skipped,
            "errors": len(result.errors),
        },
    )
    return result


# --------------------------------------------------------------------------- #
# Add / replace a face
# --------------------------------------------------------------------------- #
@router.post("/{member_id}/photo", response_model=Member)
async def add_face(
    member_id: str = Path(...),
    image: UploadFile = File(...),
    user: dict = Depends(security.require_operator),
) -> Member:
    """Add another face image to an existing member (improves robustness).

    Members created by bulk import have no engine subject yet; their first
    photo creates it.
    """
    member = await run_in_threadpool(
        db.query_one, f"SELECT {_MEMBER_COLUMNS} FROM members WHERE id = %s", (member_id,)
    )
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    subject_name = member.get("subject_name")
    if not subject_name:
        # Imported member without a face yet — create the subject now.
        subject_name = _slugify_subject(member["full_name"], str(member["id"]))

    data = await _read_image(image)
    try:
        await run_in_threadpool(
            engine.add_subject_with_face,
            subject_name,
            data,
            filename=image.filename or "enroll.jpg",
        )
    except engine.EngineUnavailable as exc:
        raise HTTPException(status_code=503, detail="Recognition engine unavailable") from exc
    except engine.EngineRejected as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Update the stored display photo (and subject link) to the latest face.
    photo_rel = await run_in_threadpool(media.save_enrollment, member_id, data)
    row = await run_in_threadpool(
        db.execute_returning,
        f"UPDATE members SET photo_path = %s, subject_name = %s, updated_at = now() "
        f"WHERE id = %s RETURNING {_MEMBER_COLUMNS}",
        (photo_rel, subject_name, member_id),
    )
    assert row is not None
    await run_in_threadpool(
        audit.record, user, "member.update", entity="member", entity_id=member_id,
        details={"photo": True},
    )
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
    _user: dict = Depends(security.get_current_user_flex),
) -> FileResponse:
    """Serve the member's stored enrollment image.

    Uses ``get_current_user_flex`` so a browser ``<img>`` can authenticate with a
    ``?token=`` query param (it cannot set an Authorization header) — the same
    pattern as CSV export / SSE. Keeps biometric photos behind the operator
    session rather than exposing them on an unauthenticated static path.
    """
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
    user: dict = Depends(security.require_operator),
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
    await run_in_threadpool(
        audit.record, user, "member.update", entity="member", entity_id=member_id,
        details={"fields": sorted(updates.keys())},
    )
    return _to_member(row)


# --------------------------------------------------------------------------- #
# Delete
# --------------------------------------------------------------------------- #
@router.delete("/{member_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_member(
    member_id: str = Path(...),
    user: dict = Depends(security.require_operator),
) -> None:
    """Delete a member and remove their engine subject."""
    row = await run_in_threadpool(
        db.query_one,
        "SELECT full_name, subject_name, photo_path FROM members WHERE id = %s",
        (member_id,),
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Member not found")

    if row.get("subject_name"):
        # Best-effort; a down engine should not block removing the member record.
        await run_in_threadpool(engine.delete_subject, row["subject_name"])

    await run_in_threadpool(db.execute, "DELETE FROM members WHERE id = %s", (member_id,))
    await run_in_threadpool(
        audit.record, user, "member.delete", entity="member", entity_id=member_id,
        details={"full_name": row.get("full_name")},
    )

    # Tidy the stored photo (non-fatal).
    if row.get("photo_path"):
        try:
            path = media.absolute(row["photo_path"])
            if path.exists():
                path.unlink()
        except (ValueError, OSError):  # pragma: no cover
            pass
    return None
