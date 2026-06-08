"""
Profile Router
"""

import os
import uuid
import math
import logging
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..auth import get_current_user
from ..tracking import track
from ..llm import resolve_and_build
from ..billing.gateway import MeterContext, metered, bg_settle_success, bg_settle_failure
from ..limiter import limiter
from engine.usage import UsageCollector
from ..schemas import (
    UserProfileResponse,
    ProfileUploadResponse,
    ProfileFileUploadResponse,
    ProfileFileResponse,
    ProfileFileListResponse,
    ProfileFileUpdate,
    AdditionalContextUpdate,
)
from ..models import User, UserProfile, ProfileFile
from .. import storage

from engine.profile import parse_profile_upload
from engine.profile.unification import create_unified_profile, merge_profile_sources

_log = logging.getLogger(__name__)


def _parse_file_background(
    file_id: str,
    user_id: str,
    file_content: bytes,
    filename: str,
    content_type: str,
    source_label: str,
    file_type: str,
) -> None:
    """Parse a profile file out-of-band and write parsed_data back to the DB."""
    db = SessionLocal()
    try:
        llm = resolve_and_build(db, user_id, "profile")
        try:
            parsed_data = parse_profile_upload(
                file_content=file_content,
                filename=filename,
                content_type=content_type,
                source_label=source_label,
                llm=llm,
            )
        except Exception as exc:
            _log.warning("Background parse failed for file %s: %s", file_id, exc)
            return

        profile_file = db.query(ProfileFile).filter(ProfileFile.id == file_id).first()
        if not profile_file:
            return

        profile_file.parsed_data = parsed_data

        # Mirror into legacy per-type columns on the profile (first file of each type only)
        if file_type in ("resume", "linkedin", "portfolio"):
            profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
            if profile and not getattr(profile, f"{file_type}_data", None):
                setattr(profile, f"{file_type}_data", parsed_data)

        db.commit()
    finally:
        db.close()

router = APIRouter(prefix="/api/profile", tags=["Profile"])

VALID_FILE_TYPES = ["resume", "linkedin", "other"]
ALLOWED_EXTENSIONS = {".pdf", ".txt", ".doc", ".docx"}
BLOCKED_CONTENT_TYPES = {"text/html", "application/xhtml+xml"}
MAX_FILE_SIZE = 10 * 1024 * 1024

# Magic-byte signatures for each allowed extension.
# First 16 bytes of the file must start with one of these patterns.
# Extensions with an empty list (e.g. .txt) skip the check (no reliable magic).
_MAGIC_BYTES: dict[str, list[bytes]] = {
    ".pdf":  [b"%PDF"],
    ".doc":  [b"\xd0\xcf\x11\xe0"],   # OLE2 compound document (legacy Word)
    ".docx": [b"PK\x03\x04"],          # ZIP / OOXML
    ".txt":  [],                        # no reliable magic — skip
}


def _check_magic_bytes(ext: str, content: bytes) -> bool:
    """Return True if the file's leading bytes match the expected signature.

    Returns False for unknown extensions (not in the map) so unrecognised
    types fail closed. Extensions with an empty signature list (e.g. .txt)
    always pass.
    """
    sigs = _MAGIC_BYTES.get(ext)
    if sigs is None:
        return False
    if not sigs:
        return True
    header = content[:16]
    return any(header.startswith(sig) for sig in sigs)


def _parse_source_label(file_type: str, file_ext: str) -> Optional[str]:
    if file_type in {"resume", "linkedin"}:
        return file_type
    if file_type == "other" and file_ext == ".pdf":
        return "resume"
    return None


def _get_or_create_profile(db: Session, user_id: str) -> UserProfile:
    profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    if not profile:
        profile = UserProfile(user_id=user_id)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@router.get("", response_model=UserProfileResponse)
async def get_profile(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get current user profile status."""
    return _get_or_create_profile(db, current_user.id)


@router.post("/upload", response_model=ProfileFileUploadResponse)
@limiter.limit("10/minute", override_defaults=False)
async def upload_file(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    type: str = Form(...),
    additional_context: Optional[str] = Form(None),
    ctx: MeterContext = Depends(metered("profile_upload")),
    db: Session = Depends(get_db),
):
    """Upload a profile file and parse it in the background."""
    if type not in VALID_FILE_TYPES:
        ctx.settle_failure()
        raise HTTPException(status_code=400, detail=f"Invalid file type. Must be one of: {', '.join(VALID_FILE_TYPES)}")

    file_ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
    if file_ext not in ALLOWED_EXTENSIONS:
        ctx.settle_failure()
        raise HTTPException(status_code=415, detail=f"Unsupported file extension: {file_ext}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}")

    if (file.content_type or "").split(";")[0].strip().lower() in BLOCKED_CONTENT_TYPES:
        ctx.settle_failure()
        raise HTTPException(status_code=415, detail="HTML files are not accepted.")

    # Hard cap: max 12 active (non-deleted) files per user regardless of plan.
    active_count = db.query(ProfileFile).filter(ProfileFile.user_id == ctx.user_id).count()
    if active_count >= 12:
        ctx.settle_failure()
        raise HTTPException(status_code=429, detail="Maximum active profile files (12) reached. Delete some before uploading more.")

    file_content = await file.read()
    file_size = len(file_content)

    # Magic-byte validation — confirms actual file content matches the extension.
    # Runs after reading so we have the bytes; before size check so we reject
    # clearly malformed files cheaply.
    if not _check_magic_bytes(file_ext, file_content):
        ctx.settle_failure()
        raise HTTPException(
            status_code=415,
            detail=f"File content does not match the expected format for {file_ext} files.",
        )

    if file_size > MAX_FILE_SIZE:
        ctx.settle_failure()
        raise HTTPException(status_code=413, detail=f"File too large ({file_size} bytes). Max: {MAX_FILE_SIZE // (1024*1024)} MB")

    unique_name = f"{uuid.uuid4().hex}{file_ext}"
    storage_path = f"{ctx.user_id}/{unique_name}"
    storage.upload_file(storage_path, file_content, file.content_type or "application/octet-stream")

    # Persist the record immediately (parsed_data=None until background task finishes)
    profile_file = ProfileFile(
        user_id=ctx.user_id,
        filename=file.filename,
        file_path=storage_path,
        file_type=type,
        file_size=file_size,
        parsed_data=None,
        additional_context=additional_context,
    )
    db.add(profile_file)

    profile = _get_or_create_profile(db, ctx.user_id)

    # Set the legacy path field immediately so the profile knows which file to use
    if type == "resume" and not profile.resume_path:
        profile.resume_path = storage_path
    elif type == "linkedin" and not profile.linkedin_path:
        profile.linkedin_path = storage_path

    db.commit()
    db.refresh(profile_file)

    track(db, user_id=ctx.user_id, event="file_uploaded", meta={
        "file_type": type,
        "filename": file.filename,
        "file_size": file_size,
    })

    ctx.settle_success()

    # Schedule parsing out-of-band so the response returns immediately
    source_label = _parse_source_label(type, file_ext)
    if source_label:
        background_tasks.add_task(
            _parse_file_background,
            file_id=profile_file.id,
            user_id=ctx.user_id,
            file_content=file_content,
            filename=file.filename or f"profile{file_ext}",
            content_type=file.content_type or "application/octet-stream",
            source_label=source_label,
            file_type=type,
        )

    return ProfileFileUploadResponse(
        id=profile_file.id,
        file_type=type,
        filename=file.filename,
        parsed_data=None,
    )


@router.get("/files", response_model=ProfileFileListResponse)
async def list_files(
    page: int = Query(1, ge=1),
    page_size: int = Query(8, ge=1, le=50),
    type: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Paginated list of user's profile files."""
    query = db.query(ProfileFile).filter(ProfileFile.user_id == current_user.id)

    if type and type in VALID_FILE_TYPES:
        query = query.filter(ProfileFile.file_type == type)

    total = query.count()
    total_pages = math.ceil(total / page_size) if total > 0 else 1

    offset = (page - 1) * page_size
    files = query.order_by(ProfileFile.created_at.desc()).offset(offset).limit(page_size).all()

    return ProfileFileListResponse(
        files=files,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/files/{file_id}", response_model=ProfileFileResponse)
async def get_file(
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get single file metadata."""
    profile_file = db.query(ProfileFile).filter(
        ProfileFile.id == file_id,
        ProfileFile.user_id == current_user.id
    ).first()
    if not profile_file:
        raise HTTPException(status_code=404, detail="File not found")
    return profile_file


@router.delete("/files/{file_id}")
async def delete_file(
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a specific file (disk + DB)."""
    profile_file = db.query(ProfileFile).filter(
        ProfileFile.id == file_id,
        ProfileFile.user_id == current_user.id
    ).first()
    if not profile_file:
        raise HTTPException(status_code=404, detail="File not found")

    storage.delete_file(profile_file.file_path)

    db.delete(profile_file)
    db.commit()
    return {"detail": "File deleted"}


@router.patch("/files/{file_id}", response_model=ProfileFileResponse)
async def update_file(
    file_id: str,
    data: ProfileFileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update file_type tag or additional_context."""
    profile_file = db.query(ProfileFile).filter(
        ProfileFile.id == file_id,
        ProfileFile.user_id == current_user.id
    ).first()
    if not profile_file:
        raise HTTPException(status_code=404, detail="File not found")

    if data.file_type is not None:
        if data.file_type not in VALID_FILE_TYPES:
            raise HTTPException(status_code=400, detail="Invalid file type")
        profile_file.file_type = data.file_type
    if data.additional_context is not None:
        profile_file.additional_context = data.additional_context

    db.commit()
    db.refresh(profile_file)
    return profile_file


@router.get("/file/{file_id}/download")
async def download_file(
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Serve the actual file for download/preview."""
    profile_file = db.query(ProfileFile).filter(
        ProfileFile.id == file_id,
        ProfileFile.user_id == current_user.id
    ).first()
    if not profile_file:
        raise HTTPException(status_code=404, detail="File not found")

    if not profile_file.file_path:
        raise HTTPException(status_code=404, detail="File not found")

    signed_url = storage.get_signed_url(profile_file.file_path)
    return RedirectResponse(url=signed_url, status_code=307)


@router.get("/file/{file_id}/signed-url")
async def get_file_signed_url(
    file_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Return a short-lived signed URL as JSON.

    The browser extension can't read the Location header off the /download
    307 redirect (cross-origin fetch yields an opaque response), so it asks
    for the signed URL directly and opens it in a new tab.
    """
    profile_file = db.query(ProfileFile).filter(
        ProfileFile.id == file_id,
        ProfileFile.user_id == current_user.id
    ).first()
    if not profile_file or not profile_file.file_path:
        raise HTTPException(status_code=404, detail="File not found")

    signed_url = storage.get_signed_url(profile_file.file_path)
    return {"url": signed_url}


@router.get("/file/{file_type}")
async def get_profile_file_legacy(
    file_type: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Serve a profile file securely (legacy endpoint)."""
    if file_type not in ["resume", "linkedin", "portfolio"]:
        raise HTTPException(status_code=400, detail="Invalid file type")

    profile = _get_or_create_profile(db, current_user.id)
    file_path = None

    if file_type == "resume":
        file_path = profile.resume_path
    elif file_type == "linkedin":
        file_path = profile.linkedin_path
    elif file_type == "portfolio":
        file_path = profile.portfolio_path

    if not file_path:
        raise HTTPException(status_code=404, detail="File not found")

    signed_url = storage.get_signed_url(file_path)
    return RedirectResponse(url=signed_url, status_code=307)


def _collect_unify_sources(db: Session, user_id: str, profile: UserProfile):
    """Gather parsed profile sources (and per-file context) for unification."""
    profile_files = [
        pf for pf in db.query(ProfileFile).filter(ProfileFile.user_id == user_id).all()
        if pf.parsed_data is not None
    ]

    sources: dict = {}
    type_counters: dict[str, int] = {}
    for pf in profile_files:
        ft = pf.file_type
        type_counters[ft] = type_counters.get(ft, 0) + 1
        sources[f"{ft}_{type_counters[ft]}"] = pf.parsed_data

    if not sources:
        for key in ("resume", "linkedin", "portfolio"):
            legacy_val = getattr(profile, f"{key}_data", None)
            if legacy_val:
                if isinstance(legacy_val, str):
                    import json
                    try:
                        legacy_val = json.loads(legacy_val)
                    except (json.JSONDecodeError, TypeError):
                        continue
                if isinstance(legacy_val, dict):
                    sources[f"{key}_1"] = legacy_val

    return sources, profile_files


def _fallback_unify(sources: dict) -> dict:
    """Deterministic, LLM-free unification used when the LLM merge fails."""
    if len(sources) == 1:
        unified, _ = merge_profile_sources(sources)  # single-source dedup, no LLM
        return unified

    type_sources: dict = {}
    for key, val in sources.items():
        lower = key.lower()
        if "resume" in lower:
            type_sources["resume"] = val
        elif "linkedin" in lower:
            type_sources["linkedin"] = val
        elif "portfolio" in lower:
            type_sources["portfolio"] = val
    return create_unified_profile(type_sources) if type_sources else list(sources.values())[0]


def _build_unified_profile_background(user_id: str, meter_ref: str) -> None:
    """Run the unified-profile merge out-of-band and flip build_status when done."""
    db = SessionLocal()
    collector = UsageCollector()
    try:
        profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
        if not profile:
            return

        sources, profile_files = _collect_unify_sources(db, user_id, profile)
        if not sources:
            profile.build_status = "error"
            db.commit()
            bg_settle_failure(user_id, "profile_build", meter_ref, collector)
            return

        try:
            llm = resolve_and_build(db, user_id, "profile", collector=collector)
            global_ctx = profile.additional_context
            per_file_ctx = {pf.filename: pf.additional_context for pf in profile_files if pf.additional_context}

            unified, _ = merge_profile_sources(
                sources, llm, global_context=global_ctx, per_file_context=per_file_ctx
            )

            profile.unified_profile = unified
            profile.extracted_profile = unified
            profile.build_status = "ready"
            db.commit()

            track(db, user_id=user_id, event="profile_unified", meta={"source_count": len(sources)})
            bg_settle_success(user_id, "profile_build", meter_ref, collector)
        except Exception as exc:
            _log.warning("Profile unification failed for user %s: %s", user_id, exc)
            # Fallback — still persist a non-LLM result, but do not charge for the failed call.
            unified = _fallback_unify(sources)
            profile.unified_profile = unified
            profile.extracted_profile = unified
            profile.build_status = "ready"
            db.commit()
            bg_settle_failure(user_id, "profile_build", meter_ref, collector)
    finally:
        db.close()


@router.post("/unified", response_model=UserProfileResponse)
@limiter.limit("3/minute", override_defaults=False)
async def create_unified(
    request: Request,
    background_tasks: BackgroundTasks,
    ctx: MeterContext = Depends(metered("profile_build")),
    db: Session = Depends(get_db),
):
    """Kick off Unified Profile generation in the background and return immediately.

    The LLM merge is a slow, blocking call; running it out-of-band keeps the API
    responsive. The frontend polls `build_status` until it leaves `building`.
    """
    profile = _get_or_create_profile(db, ctx.user_id)

    sources, _ = _collect_unify_sources(db, ctx.user_id, profile)
    if not sources:
        ctx.settle_failure()
        raise HTTPException(status_code=400, detail="No files uploaded to unify")

    # Already running — don't start a second build.
    if profile.build_status == "building":
        ctx.settle_failure()
        return profile

    profile.build_status = "building"
    db.commit()
    db.refresh(profile)

    background_tasks.add_task(_build_unified_profile_background, ctx.user_id, ctx.ref)
    return profile


@router.patch("/additional-context", response_model=UserProfileResponse)
async def update_additional_context(
    data: AdditionalContextUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Save user-supplied additional context."""
    profile = _get_or_create_profile(db, current_user.id)
    profile.additional_context = data.additional_context
    db.commit()
    db.refresh(profile)
    return profile


@router.delete("/{file_type}", response_model=UserProfileResponse)
async def delete_file_legacy(
    file_type: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a file and its data (legacy endpoint)."""
    if file_type not in ["resume", "linkedin", "portfolio"]:
        raise HTTPException(status_code=400, detail="Invalid file type")

    profile = _get_or_create_profile(db, current_user.id)

    old_path = None
    if file_type == "resume":
        old_path = profile.resume_path
        storage.delete_file(old_path)
        profile.resume_path = None
        profile.resume_data = None
    elif file_type == "linkedin":
        old_path = profile.linkedin_path
        storage.delete_file(old_path)
        profile.linkedin_path = None
        profile.linkedin_data = None
    elif file_type == "portfolio":
        old_path = profile.portfolio_path
        storage.delete_file(old_path)
        profile.portfolio_path = None
        profile.portfolio_data = None

    if old_path:
        orphaned = db.query(ProfileFile).filter(
            ProfileFile.user_id == current_user.id,
            ProfileFile.file_path == old_path
        ).all()
        for pf in orphaned:
            db.delete(pf)

    db.commit()
    db.refresh(profile)
    return profile
