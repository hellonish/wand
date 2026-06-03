"""
Profile Router
"""

import os
import uuid
import shutil
import math
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from datetime import datetime

from ..database import get_db
from ..auth import get_current_user
from ..llm import get_llm
from ..billing.gateway import MeterContext, metered
from ..limiter import limiter
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

from engine.profile import parse_profile_upload
from engine.profile.unification import create_unified_profile, merge_profile_sources

router = APIRouter(prefix="/api/profile", tags=["Profile"])

UPLOAD_DIR = "api/uploads"

VALID_FILE_TYPES = ["resume", "linkedin", "portfolio", "other"]
ALLOWED_EXTENSIONS = {".pdf", ".html", ".htm", ".txt", ".doc", ".docx"}
MAX_FILE_SIZE = 10 * 1024 * 1024


def _parse_source_label(file_type: str, file_ext: str) -> Optional[str]:
    if file_type in {"resume", "linkedin", "portfolio"}:
        return file_type
    if file_type == "other" and file_ext == ".pdf":
        return "resume"
    if file_type == "other" and file_ext in (".html", ".htm"):
        return "portfolio"
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
@limiter.limit("10/minute")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    type: str = Form(...),
    additional_context: Optional[str] = Form(None),
    ctx: MeterContext = Depends(metered("profile_upload", charge=False)),
    db: Session = Depends(get_db),
):
    """Upload and parse a profile file (free, but daily-capped per plan)."""
    if type not in VALID_FILE_TYPES:
        ctx.settle_failure()
        raise HTTPException(status_code=400, detail="Invalid file type. Must be one of: resume, linkedin, portfolio, other")

    file_ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
    if file_ext not in ALLOWED_EXTENSIONS:
        ctx.settle_failure()
        raise HTTPException(status_code=415, detail=f"Unsupported file extension: {file_ext}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}")

    # Hard cap: max 12 active (non-deleted) files per user regardless of plan.
    active_count = db.query(ProfileFile).filter(ProfileFile.user_id == ctx.user_id).count()
    if active_count >= 12:
        ctx.settle_failure()
        raise HTTPException(status_code=429, detail="Maximum active profile files (12) reached. Delete some before uploading more.")

    user_dir = os.path.join(UPLOAD_DIR, ctx.user_id)
    os.makedirs(user_dir, exist_ok=True)

    unique_name = f"{uuid.uuid4().hex}{file_ext}"
    file_path = os.path.join(user_dir, unique_name)

    file_content = await file.read()
    file_size = len(file_content)

    if file_size > MAX_FILE_SIZE:
        ctx.settle_failure()
        raise HTTPException(status_code=413, detail=f"File too large ({file_size} bytes). Max: {MAX_FILE_SIZE // (1024*1024)} MB")

    with open(file_path, "wb") as buffer:
        buffer.write(file_content)

    parsed_data = None
    source_label = _parse_source_label(type, file_ext)
    if source_label:
        try:
            parsed_data = parse_profile_upload(
                file_content=file_content,
                filename=file.filename or f"profile{file_ext}",
                content_type=file.content_type or "application/octet-stream",
                source_label=source_label,
                llm=get_llm("profile", collector=ctx.collector),
            )
        except Exception as e:
            if os.path.exists(file_path):
                os.remove(file_path)
            ctx.settle_failure()
            raise HTTPException(status_code=500, detail=f"Parsing failed: {str(e)}")

    profile_file = ProfileFile(
        user_id=ctx.user_id,
        filename=file.filename,
        file_path=file_path,
        file_type=type,
        file_size=file_size,
        parsed_data=parsed_data,
        additional_context=additional_context,
    )
    db.add(profile_file)

    _get_or_create_profile(db, ctx.user_id)

    if type == "resume":
        profile = db.query(UserProfile).filter(UserProfile.user_id == ctx.user_id).first()
        if profile and not profile.resume_path:
            profile.resume_path = file_path
            profile.resume_data = parsed_data
    elif type == "linkedin":
        profile = db.query(UserProfile).filter(UserProfile.user_id == ctx.user_id).first()
        if profile and not profile.linkedin_path:
            profile.linkedin_path = file_path
            profile.linkedin_data = parsed_data
    elif type == "portfolio":
        profile = db.query(UserProfile).filter(UserProfile.user_id == ctx.user_id).first()
        if profile and not profile.portfolio_path:
            profile.portfolio_path = file_path
            profile.portfolio_data = parsed_data

    db.commit()
    db.refresh(profile_file)

    ctx.settle_success()
    return ProfileFileUploadResponse(
        id=profile_file.id,
        file_type=type,
        filename=file.filename,
        parsed_data=parsed_data,
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

    if profile_file.file_path and os.path.exists(profile_file.file_path):
        os.remove(profile_file.file_path)

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

    if not profile_file.file_path or not os.path.exists(profile_file.file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    safe_filename = os.path.basename(profile_file.filename) if profile_file.filename else f"file_{profile_file.id}"
    return FileResponse(
        profile_file.file_path,
        filename=safe_filename,
        media_type="application/octet-stream",
    )


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

    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(file_path)


@router.post("/unified", response_model=UserProfileResponse)
@limiter.limit("3/minute")
async def create_unified(
    request: Request,
    ctx: MeterContext = Depends(metered("profile_build", charge=True)),
    db: Session = Depends(get_db),
):
    """Create Unified Profile from uploaded files (costs 30 credits)."""
    profile = _get_or_create_profile(db, ctx.user_id)

    all_profile_files = db.query(ProfileFile).filter(
        ProfileFile.user_id == ctx.user_id
    ).all()

    profile_files = [pf for pf in all_profile_files if pf.parsed_data is not None]

    sources = {}
    type_counters: dict[str, int] = {}

    for pf in profile_files:
        ft = pf.file_type
        type_counters[ft] = type_counters.get(ft, 0) + 1
        key = f"{ft}_{type_counters[ft]}"
        sources[key] = pf.parsed_data

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

    if not sources:
        ctx.settle_failure()
        raise HTTPException(status_code=400, detail="No files uploaded to unify")

    try:
        llm = get_llm("profile", collector=ctx.collector)

        global_ctx = profile.additional_context
        per_file_ctx = {}
        for pf in profile_files:
            if pf.additional_context:
                per_file_ctx[pf.filename] = pf.additional_context

        unified, _ = merge_profile_sources(
            sources, llm, global_context=global_ctx, per_file_context=per_file_ctx
        )

        profile.unified_profile = unified
        profile.extracted_profile = unified
        db.commit()
        db.refresh(profile)

        ctx.settle_success()
        return profile

    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Profile unification failed: {e}")

        # Fallback — do not charge for a failed LLM call; still persist non-LLM result.
        ctx.settle_failure()

        if len(sources) == 1:
            unified = list(sources.values())[0]
        else:
            type_sources = {}
            for key, val in sources.items():
                lower = key.lower()
                if "resume" in lower:
                    type_sources["resume"] = val
                elif "linkedin" in lower:
                    type_sources["linkedin"] = val
                elif "portfolio" in lower:
                    type_sources["portfolio"] = val
            unified = create_unified_profile(type_sources) if type_sources else list(sources.values())[0]

        profile.unified_profile = unified
        profile.extracted_profile = unified
        db.commit()
        db.refresh(profile)
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
        if old_path and os.path.exists(old_path):
            os.remove(old_path)
        profile.resume_path = None
        profile.resume_data = None
    elif file_type == "linkedin":
        old_path = profile.linkedin_path
        if old_path and os.path.exists(old_path):
            os.remove(old_path)
        profile.linkedin_path = None
        profile.linkedin_data = None
    elif file_type == "portfolio":
        old_path = profile.portfolio_path
        if old_path and os.path.exists(old_path):
            os.remove(old_path)
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
