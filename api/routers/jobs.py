"""Jobs Router - CRUD, tracking, and analysis pipeline."""

import asyncio
import hashlib
import json
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile, BackgroundTasks, Request
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from engine.joblens.company_intel import CompanyIntelInput, CompanyIntelResult, CompanyIntelService
from engine.joblens.job_description import JobDescriptionBreakdownResult, break_down_job_description
from engine.joblens.job_match import JobMatchResult, match_profile_to_job
from engine.joblens.job_match.models import JobMatchScore, ResumeActions
from engine.joblens.reachout import ReachoutInput, ReachoutService
from engine.profile.models import UnifiedProfile
from engine.profile.unification import create_unified_profile, merge_profile_sources
import engine.inference as inference

from ..database import SessionLocal, get_db
from ..auth import get_current_user
from ..llm import get_llm, resolve_and_build
from ..billing.gateway import MeterContext, metered, bg_settle_success, bg_settle_failure
from engine.usage import UsageCollector
from ..schemas import (
    JobCreate, JobTrackCreate, JobUpdate, JobResponse, JobListResponse, JobStatusEnum, JobLensSessionResponse,
)
from ..models import User, Job, JobLensSession, JobStatus, UserProfile, ProfileFile, CompanyCache
from ..websocket import manager
from ..limiter import limiter
from ..tracking import track
from .. import storage as _file_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jobs", tags=["Jobs"])


def _collect_profile_sources(
    db: Session,
    profile: UserProfile,
    user_id: str,
) -> tuple[dict[str, Any], list[ProfileFile]]:
    """Collect parsed profile sources from profile files, with legacy fallback."""

    profile_files = (
        db.query(ProfileFile)
        .filter(ProfileFile.user_id == user_id, ProfileFile.parsed_data.isnot(None))
        .all()
    )
    sources: dict[str, Any] = {}
    type_counters: dict[str, int] = {}

    for profile_file in profile_files:
        file_type = profile_file.file_type
        type_counters[file_type] = type_counters.get(file_type, 0) + 1
        sources[f"{file_type}_{type_counters[file_type]}"] = profile_file.parsed_data

    if sources:
        return sources, profile_files

    for key in ("resume", "linkedin", "portfolio"):
        legacy_val = getattr(profile, f"{key}_data", None)
        if isinstance(legacy_val, str):
            try:
                legacy_val = json.loads(legacy_val)
            except (json.JSONDecodeError, TypeError):
                continue
        if isinstance(legacy_val, dict):
            sources[f"{key}_1"] = legacy_val

    return sources, profile_files


def _fallback_unified_profile(sources: dict[str, Any]) -> dict[str, Any]:
    if len(sources) == 1:
        return next(iter(sources.values()))

    type_sources = {}
    for key, value in sources.items():
        lower = key.lower()
        if "resume" in lower:
            type_sources["resume"] = value
        elif "linkedin" in lower:
            type_sources["linkedin"] = value
        elif "portfolio" in lower:
            type_sources["portfolio"] = value
    return create_unified_profile(type_sources) if type_sources else next(iter(sources.values()))


def _get_or_create_unified_profile(
    user_id: str,
    collector: Optional[UsageCollector] = None,
) -> UnifiedProfile:
    """Load the user's unified profile or create/cache it from parsed profile files."""

    db = SessionLocal()
    try:
        profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
        if not profile:
            profile = UserProfile(user_id=user_id)
            db.add(profile)
            db.commit()
            db.refresh(profile)

        if profile.unified_profile:
            return UnifiedProfile.model_validate(profile.unified_profile)

        sources, profile_files = _collect_profile_sources(db, profile, user_id)
        if not sources:
            raise ValueError("No parsed profile files found. Upload profile files before creating a job.")

        try:
            per_file_ctx = {
                profile_file.filename: profile_file.additional_context
                for profile_file in profile_files
                if profile_file.additional_context
            }
            unified, _ = merge_profile_sources(
                sources,
                resolve_and_build(db, user_id, "profile", collector=collector),
                global_context=profile.additional_context,
                per_file_context=per_file_ctx,
            )
        except Exception as error:
            logger.warning("LLM profile unification failed for user %s: %s", user_id, error)
            unified = _fallback_unified_profile(sources)

        profile.unified_profile = unified
        profile.extracted_profile = unified
        db.commit()
        return UnifiedProfile.model_validate(unified)
    finally:
        db.close()


def _company_cache_key(company_name: str, website: Optional[str]) -> str:
    if website:
        try:
            # Strip scheme, www, and path — keep bare domain as the key.
            domain = re.sub(r"^https?://", "", website.strip().lower())
            domain = re.sub(r"^www\.", "", domain)
            domain = domain.split("/")[0].strip()
            if domain:
                return domain
        except Exception:
            pass
    return re.sub(r"[^a-z0-9]+", "-", company_name.lower()).strip("-")


def _reachout_roles_key(target_roles: list) -> str:
    return hashlib.md5(",".join(sorted(r.lower() for r in target_roles if r)).encode()).hexdigest()


def _get_company_cache(
    company_key: str,
    cache_type: str,
    roles_key: Optional[str],
    db: Session,
) -> Optional[dict]:
    now = datetime.now(timezone.utc)
    q = (
        db.query(CompanyCache)
        .filter(
            CompanyCache.company_key == company_key,
            CompanyCache.cache_type == cache_type,
            CompanyCache.expires_at > now,
        )
    )
    if roles_key is not None:
        q = q.filter(CompanyCache.roles_key == roles_key)
    else:
        q = q.filter(CompanyCache.roles_key.is_(None))
    row = q.order_by(CompanyCache.created_at.desc()).first()
    return row.data if row else None


def _set_company_cache(
    company_key: str,
    cache_type: str,
    data: dict,
    ttl_days: int,
    roles_key: Optional[str],
    db: Session,
) -> None:
    # Delete any stale row for the same key before inserting so we never accumulate.
    q = db.query(CompanyCache).filter(
        CompanyCache.company_key == company_key,
        CompanyCache.cache_type == cache_type,
    )
    if roles_key is not None:
        q = q.filter(CompanyCache.roles_key == roles_key)
    else:
        q = q.filter(CompanyCache.roles_key.is_(None))
    q.delete(synchronize_session=False)

    expires_at = datetime.now(timezone.utc) + timedelta(days=ttl_days)
    db.add(CompanyCache(
        company_key=company_key,
        cache_type=cache_type,
        roles_key=roles_key,
        data=data,
        expires_at=expires_at,
    ))
    db.commit()


def _get_search_cache(query_key: str, db: Session) -> Optional[list]:
    """Return cached search results for a query key, or None on miss."""
    row = _get_company_cache(query_key, "search", None, db)
    return row.get("results") if isinstance(row, dict) else None


def _set_search_cache(query_key: str, results: list, db: Session) -> None:
    """Cache raw search results for a query key with a 3-day TTL."""
    try:
        _set_company_cache(query_key, "search", {"results": results}, 3, None, db)
    except Exception:
        logger.warning("Failed to write search cache for key=%s", query_key)


def _gather_company_intel(
    job_description: JobDescriptionBreakdownResult,
    company_website: Optional[str],
    user_id: str,
    db: Session,
    collector: Optional[UsageCollector] = None,
) -> tuple:
    """Company intel section: derive lookup handles and collect company intelligence.

    Returns (result, cache_hit: bool).
    """
    company_name = job_description.breakdown.metadata.company_name or ""
    cache_key = _company_cache_key(company_name, company_website)
    cached = _get_company_cache(cache_key, "intel", None, db)
    if cached is not None:
        logger.info("company_intel cache hit for key=%s", cache_key)
        return CompanyIntelResult.model_validate(cached), True

    result = CompanyIntelService(llm=resolve_and_build(db, user_id, "company_intel", collector=collector)).collect(
        CompanyIntelInput(
            company_name=company_name,
            website=company_website,
        )
    )
    try:
        _set_company_cache(cache_key, "intel", result.model_dump(mode="json"), 14, None, db)
    except Exception:
        logger.warning("Failed to write company_intel cache for key=%s", cache_key)
    return result, False


def _score_match(
    profile: Optional[UnifiedProfile],
    job_description: JobDescriptionBreakdownResult,
    user_id: str,
    company_summary: str | None = None,
    collector: Optional[UsageCollector] = None,
) -> JobMatchScore:
    """Phase A — score + evidence, no resume actions."""
    if not profile:
        raise ValueError("No unified profile available.")
    from engine.joblens.job_match.models import JobMatchRequest
    with SessionLocal() as db:
        llm = resolve_and_build(db, user_id, "job_match", collector=collector)
    request = JobMatchRequest(profile=profile, job_description=job_description, company_summary=company_summary)
    response = inference.score_job_match(llm, request)
    from engine.utils import dedupe_warning_strings
    score = response.result
    score = score.model_copy(update={"warnings": dedupe_warning_strings([*score.warnings, *response.warnings])})
    return score


def _extract_resume_text(resume_file: ProfileFile) -> Optional[str]:
    """Extract plain text from a ProfileFile tagged as resume. Returns None on failure."""
    try:
        import mimetypes
        from engine.profile.ingestion import ingest_document as _ingest_doc
        from engine.profile.models import ProfileDocumentInput
        file_bytes = _file_storage.download_file(resume_file.file_path)
        doc_input = ProfileDocumentInput(
            filename=resume_file.filename,
            file_bytes=file_bytes,
            content_type=mimetypes.guess_type(resume_file.filename)[0] or "application/octet-stream",
        )
        ingested = _ingest_doc(doc_input)
        text = "\n".join(block.text for block in ingested.text_blocks)
        if not text:
            logger.warning("Empty text extracted from resume file %s (%s) — PDF may be image-only or protected",
                           resume_file.id, resume_file.filename)
        return text or None
    except Exception as exc:
        logger.warning("Could not extract text from resume file %s (%s): %s",
                       resume_file.id, resume_file.filename, exc, exc_info=True)
        return None


def _get_all_resume_candidates(user_id: str, db: Session):
    """Return list of ResumeCandidateInput for every file tagged 'resume'. Empty list if none."""
    from engine.joblens.job_match.models import ResumeCandidateInput
    resume_files = (
        db.query(ProfileFile)
        .filter(ProfileFile.user_id == user_id, ProfileFile.file_type == "resume")
        .order_by(ProfileFile.created_at.desc())
        .all()
    )
    candidates = []
    for f in resume_files:
        text = _extract_resume_text(f)
        if text:
            candidates.append(ResumeCandidateInput(filename=f.filename, text=text))
    # Return (candidates, total_tagged) so callers can distinguish
    # "no files tagged" from "files tagged but extraction failed for all".
    return candidates, len(resume_files)


def _has_resume_file(user_id: str, db: Session) -> bool:
    """Return True if the user has at least one file tagged as 'resume'."""
    return (
        db.query(ProfileFile)
        .filter(ProfileFile.user_id == user_id, ProfileFile.file_type == "resume")
        .first()
    ) is not None


def _generate_actions(
    profile: Optional[UnifiedProfile],
    job_description: JobDescriptionBreakdownResult,
    score: JobMatchScore,
    user_id: str,
    resume_candidates=None,
    collector: Optional[UsageCollector] = None,
    tailoring_mode: str = "surgical",
) -> ResumeActions:
    """Phase B — resume actions grounded in Phase A score."""
    if not profile:
        raise ValueError("No unified profile available.")
    from engine.joblens.job_match.models import JobMatchRequest
    with SessionLocal() as db:
        llm = resolve_and_build(db, user_id, "job_match", collector=collector)
    request = JobMatchRequest(
        profile=profile,
        job_description=job_description,
        resume_candidates=resume_candidates or [],
        tailoring_mode=tailoring_mode if tailoring_mode in ("surgical", "full_rewrite") else "surgical",
    )
    response = inference.generate_resume_actions(llm, request, score)
    from engine.utils import dedupe_warning_strings
    actions = response.result
    merged_warnings = dedupe_warning_strings([*actions.warnings, *response.warnings])

    # Attach the actual text of whichever resume the LLM selected so the UI can
    # render the real document instead of the synthesised unified profile.
    resume_text: Optional[str] = None
    candidates = resume_candidates or []
    if actions.selected_resume_filename and candidates:
        for c in candidates:
            if c.filename == actions.selected_resume_filename:
                resume_text = c.text
                break
    if resume_text is None and len(candidates) == 1:
        resume_text = candidates[0].text

    actions = actions.model_copy(update={"warnings": merged_warnings, "selected_resume_text": resume_text})
    return actions


def _discover_reachout(
    profile: UnifiedProfile,
    job_description: JobDescriptionBreakdownResult,
    company_website: Optional[str],
    user_id: str,
    db: Session,
    collector: Optional[UsageCollector] = None,
) -> tuple:
    """Reachout section: derive roles/schools and discover candidate contacts.

    Returns (result, cache_hit: bool).
    """
    breakdown = job_description.breakdown
    roles = [
        breakdown.metadata.job_title,
        breakdown.role_classification.role_family,
        breakdown.role_classification.primary_track,
    ]
    roles.extend(skill.name for skill in breakdown.primary_skills[:3])
    target_roles = [role for role in roles if role]
    schools = [item.institution for item in profile.education if item.institution]

    company_name = breakdown.metadata.company_name or ""
    cache_key = _company_cache_key(company_name, company_website)
    rkey = _reachout_roles_key(target_roles)
    cached = _get_company_cache(cache_key, "reachout", rkey, db)
    if cached is not None:
        from engine.joblens.reachout.models import ReachoutResult
        logger.info("reachout cache hit for key=%s roles=%s", cache_key, rkey)
        return ReachoutResult.model_validate(cached), True

    def _cached_search(query: str, limit: int) -> list:
        qkey = hashlib.md5(f"{query}|{limit}".encode()).hexdigest()
        with SessionLocal() as _cdb:
            hit = _get_search_cache(qkey, _cdb)
            if hit is not None:
                logger.debug("search cache hit for query=%r", query[:60])
                from engine.joblens.reachout.models import SearchResult as _SR
                return [_SR.model_validate(r) for r in hit]
        # Cache miss — use the service's default provider chain
        _raw = ReachoutService(llm=None).search_fn(query, limit)
        if _raw:
            with SessionLocal() as _wdb:
                _set_search_cache(qkey, [r.model_dump() for r in _raw], _wdb)
        return _raw

    result = ReachoutService(
        llm=resolve_and_build(db, user_id, "reachout", collector=collector),
        search_fn=_cached_search,
    ).discover(
        ReachoutInput(
            company_name=company_name,
            company_website=company_website,
            target_roles=target_roles,
            location=breakdown.metadata.location,
            schools=schools,
        )
    )
    try:
        _set_company_cache(cache_key, "reachout", result.model_dump(mode="json"), 7, rkey, db)
    except Exception:
        logger.warning("Failed to write reachout cache for key=%s", cache_key)
    return result, False


def _job_posting_summary(job_description: JobDescriptionBreakdownResult) -> dict:
    """Build the durable Job.job_posting from the parsed job description."""

    breakdown = job_description.breakdown
    metadata = breakdown.metadata
    return {
        "job_title": metadata.job_title or "Untitled role",
        "company_name": metadata.company_name or "Unknown company",
        "location": metadata.location,
        "work_mode": metadata.work_mode.value,
        "employment_type": metadata.employment_type.value,
        "seniority_level": metadata.seniority_level.value,
        "years_of_experience_min": metadata.years_of_experience_min,
        "years_of_experience_max": metadata.years_of_experience_max,
        "role_family": breakdown.role_classification.role_family,
        "primary_track": breakdown.role_classification.primary_track,
        "primary_skills": [skill.name for skill in breakdown.primary_skills],
        "secondary_skills": [skill.name for skill in breakdown.secondary_skills],
        "responsibilities": [
            " ".join(part for part in (item.action, item.object, item.context) if part)
            for item in breakdown.responsibilities
        ],
        "constraints": [item.text for item in breakdown.constraints],
        "keywords": breakdown.keywords,
    }


def _analysis_summary(match: JobMatchResult) -> dict:
    """Build the durable Job.analysis_result from a full JobMatchResult."""
    return {
        "final_score": match.summary.total_score,
        "match_band": match.summary.match_band.value,
        "headline": match.summary.headline,
        "strongest_matches": match.summary.strongest_matches,
        "biggest_gaps": match.summary.biggest_gaps,
    }


def _analysis_summary_from_score(score: "JobMatchScore") -> dict:
    """Build the durable Job.analysis_result from a Phase A JobMatchScore."""
    return {
        "final_score": score.summary.total_score,
        "match_band": score.summary.match_band.value,
        "headline": score.summary.headline,
        "strongest_matches": score.summary.strongest_matches,
        "biggest_gaps": score.summary.biggest_gaps,
    }


def _slim_company_intel(result) -> dict:
    """Strip scraped page content before storage/transmission — frontend only uses source_pages.length."""
    data = result.model_dump(mode="json")
    for page in data.get("source_pages", []):
        page.pop("text", None)
        page.pop("headings", None)
        page.pop("links", None)
    return data


def _slim_reachout(result) -> dict:
    """Strip diagnostic-only arrays before storage/transmission."""
    data = result.model_dump(mode="json")
    data.pop("pre_gated_results", None)
    data.pop("rejected_results", None)
    return data


def _emit(user_id: str, session_id: str, job_id: Optional[str], step: str, event: str, data: Optional[dict] = None) -> None:
    asyncio.create_task(
        manager.send_to_user(
            user_id,
            {
                "type": event,
                "session_id": session_id,
                "job_id": job_id,
                "step": step,
                **(data or {}),
            },
        )
    )


def _db_write(fn) -> None:
    db = SessionLocal()
    try:
        fn(db)
        db.commit()
    finally:
        db.close()


async def run_job_analysis_background(
    job_id: str,
    session_id: str,
    user_id: str,
    jd_text: str,
    company_website: Optional[str],
    meter_ref: Optional[str] = None,
) -> None:
    """Run the job analysis flow from profile + parsed job description.

    meter_ref          — the reservation ref from the gateway (None = free/no-charge).
    """
    collector = UsageCollector()
    profile_snapshot = None
    job_description = None
    company_intel = None
    match_analysis = None
    reachout = None

    try:
        _emit(user_id, session_id, job_id, "profile", "joblens_step_started")
        _emit(user_id, session_id, job_id, "job_description", "joblens_step_started")

        async def run_profile() -> None:
            nonlocal profile_snapshot
            try:
                profile_snapshot = await asyncio.to_thread(
                    lambda: _get_or_create_unified_profile(user_id, collector=collector)
                )
                _emit(
                    user_id,
                    session_id,
                    job_id,
                    "profile",
                    "joblens_step_complete",
                    {"data": profile_snapshot.model_dump(mode="json")},
                )
            except Exception as error:
                _emit(user_id, session_id, job_id, "profile", "joblens_step_failed", {"error": str(error)})

        async def run_job_description() -> None:
            nonlocal job_description
            try:
                jd_hash = hashlib.md5(jd_text.strip().encode()).hexdigest()

                def _load_or_call_llm() -> JobDescriptionBreakdownResult:
                    with SessionLocal() as db:
                        cached = (
                            db.query(JobLensSession)
                            .filter(
                                JobLensSession.user_id == user_id,
                                JobLensSession.jd_text_hash == jd_hash,
                                JobLensSession.job_description.isnot(None),
                            )
                            .order_by(JobLensSession.created_at.desc())
                            .first()
                        )
                        if cached and cached.job_description:
                            logger.info("JD breakdown cache hit for hash %s (session %s)", jd_hash, cached.id)
                            return JobDescriptionBreakdownResult.model_validate(cached.job_description)
                        llm = resolve_and_build(db, user_id, "job_description", collector=collector)
                    return break_down_job_description(
                        job_text=jd_text,
                        llm=llm,
                        source_id=job_id,
                    )

                _t0 = time.perf_counter()
                job_description = await asyncio.to_thread(_load_or_call_llm)
                _emit(
                    user_id,
                    session_id,
                    job_id,
                    "job_description",
                    "joblens_step_complete",
                    {"data": job_description.model_dump(mode="json"), "duration_ms": round((time.perf_counter() - _t0) * 1000, 1)},
                )
            except Exception as error:
                _emit(user_id, session_id, job_id, "job_description", "joblens_step_failed", {"error": str(error)})

        await asyncio.gather(run_profile(), run_job_description())

        def save_first_wave(db: Session) -> None:
            session = db.query(JobLensSession).filter(JobLensSession.id == session_id).first()
            job = db.query(Job).filter(Job.id == job_id).first()
            if not session:
                return
            if profile_snapshot:
                session.profile_snapshot = profile_snapshot.model_dump(mode="json")
                session.current_step = max(session.current_step, 1)
            if job_description:
                session.job_description = job_description.model_dump(mode="json")
                session.raw_jd_text = jd_text
                session.jd_text_hash = hashlib.md5(jd_text.strip().encode()).hexdigest()
                session.current_step = max(session.current_step, 2)
                if job:
                    job.job_posting = _job_posting_summary(job_description)

        _db_write(save_first_wave)

        if not job_description:
            logger.error("Job analysis aborted: job description failed for job %s", job_id)
            def mark_job_tracked(db: Session) -> None:
                job = db.query(Job).filter(Job.id == job_id).first()
                if job and job.status == JobStatus.ANALYZING:
                    job.status = JobStatus.TRACKED

            _db_write(mark_job_tracked)
            return

        async def run_parallel_section(step: str, fn, extra_data: Optional[dict] = None):
            _emit(user_id, session_id, job_id, step, "joblens_step_started")
            try:
                _t0 = time.perf_counter()
                result = await asyncio.to_thread(fn)
                payload = {"data": result.model_dump(mode="json"), "duration_ms": round((time.perf_counter() - _t0) * 1000, 1)}
                if extra_data:
                    payload.update(extra_data)
                _emit(user_id, session_id, job_id, step, "joblens_step_complete", payload)
                return result
            except Exception as error:
                _emit(user_id, session_id, job_id, step, "joblens_step_failed", {"error": str(error)})
                return None

        # Wave 2 — company_intel, match_analysis, and reachout run in parallel.
        company_intel = None
        _company_summary: str | None = None

        async def run_company_intel_parallel():
            nonlocal company_intel
            _emit(user_id, session_id, job_id, "company_intel", "joblens_step_started")
            try:
                def _do_company_intel():
                    with SessionLocal() as _db:
                        return _gather_company_intel(job_description, company_website, user_id, _db, collector=collector)
                _t0 = time.perf_counter()
                company_intel, _ci_hit = await asyncio.to_thread(_do_company_intel)
                _emit(user_id, session_id, job_id, "company_intel", "joblens_step_complete",
                      {"data": _slim_company_intel(company_intel), "cache_hit": _ci_hit,
                       "duration_ms": round((time.perf_counter() - _t0) * 1000, 1)})
            except Exception as _ci_error:
                _emit(user_id, session_id, job_id, "company_intel", "joblens_step_failed", {"error": str(_ci_error)})
                company_intel = None

        async def run_reachout():
            _emit(user_id, session_id, job_id, "reachout", "joblens_step_started")
            try:
                def _do_reachout():
                    with SessionLocal() as _db:
                        return _discover_reachout(
                            profile_snapshot or UnifiedProfile(), job_description, company_website, user_id, _db,
                            collector=collector,
                        )
                _t0 = time.perf_counter()
                result, hit = await asyncio.to_thread(_do_reachout)
                _emit(user_id, session_id, job_id, "reachout", "joblens_step_complete",
                      {"data": _slim_reachout(result), "cache_hit": hit,
                       "duration_ms": round((time.perf_counter() - _t0) * 1000, 1)})
                return result
            except Exception as error:
                _emit(user_id, session_id, job_id, "reachout", "joblens_step_failed", {"error": str(error)})
                return None

        # Launch match and reachout as tasks so Wave 3 can start as soon as match finishes.
        match_task = asyncio.create_task(
            run_parallel_section(
                "match_analysis",
                lambda: _score_match(profile_snapshot, job_description, user_id, None, collector=collector),
                extra_data={"partial": True},
            )
        )
        reachout_task = asyncio.create_task(run_reachout())

        # company_intel runs concurrently alongside match and reachout.
        await asyncio.gather(run_company_intel_parallel(), match_task)

        match_score = match_task.result()

        # Wave 3 — resume actions (needs match_score + a file tagged 'resume').
        # Start immediately after match finishes; reachout may still be running.
        resume_actions = None
        _NO_RESUME_MARKER: dict = {"_skipped": True, "_reason": "no_resume_file"}
        _EXTRACT_FAILED_MARKER: dict = {"_skipped": True, "_reason": "extraction_failed"}

        db_tmp = SessionLocal()
        try:
            _wave3_candidates, _wave3_tagged_count = _get_all_resume_candidates(user_id, db_tmp)
        finally:
            db_tmp.close()

        if _wave3_tagged_count == 0:
            _emit(user_id, session_id, job_id, "resume_actions", "joblens_step_complete",
                  {"data": _NO_RESUME_MARKER})
            reachout = await reachout_task
        elif not _wave3_candidates:
            logger.error("resume_actions skipped for user=%s: %d file(s) tagged but text extraction failed for all",
                         user_id, _wave3_tagged_count)
            _emit(user_id, session_id, job_id, "resume_actions", "joblens_step_complete",
                  {"data": _EXTRACT_FAILED_MARKER})
            reachout = await reachout_task
        elif match_score and profile_snapshot:
            _cands = _wave3_candidates
            resume_actions_task = asyncio.create_task(
                run_parallel_section(
                    "resume_actions",
                    lambda: _generate_actions(
                        profile_snapshot, job_description, match_score, user_id, _cands, collector=collector
                    ),
                )
            )
            reachout = await reachout_task
            resume_actions = await resume_actions_task
        else:
            reachout = await reachout_task

        def save_second_wave(db: Session) -> None:
            session = db.query(JobLensSession).filter(JobLensSession.id == session_id).first()
            job = db.query(Job).filter(Job.id == job_id).first()
            if not session:
                return
            if company_intel:
                session.company_intel = _slim_company_intel(company_intel)
                session.current_step = max(session.current_step, 3)
            if match_score:
                session.match_analysis = match_score.model_dump(mode="json")
                session.current_step = max(session.current_step, 4)
                if job:
                    job.analysis_result = _analysis_summary_from_score(match_score)
            if reachout:
                session.reachout = _slim_reachout(reachout)
                session.current_step = max(session.current_step, 5)

        _db_write(save_second_wave)

        def save_third_wave(db: Session) -> None:
            session = db.query(JobLensSession).filter(JobLensSession.id == session_id).first()
            job = db.query(Job).filter(Job.id == job_id).first()
            if not session:
                return
            if resume_actions:
                session.resume_actions = resume_actions.model_dump(mode="json")
                session.current_step = max(session.current_step, 6)
            elif _wave3_tagged_count == 0 or not _wave3_candidates:
                session.resume_actions = _NO_RESUME_MARKER
                session.current_step = max(session.current_step, 6)
            if job and job.status == JobStatus.ANALYZING:
                job.status = JobStatus.TRACKED

        _db_write(save_third_wave)

        # ── Billing: success settle ───────────────────────────────────────────
        if meter_ref:
            bg_settle_success(
                user_id=user_id,
                task_type="job_analysis",
                ref=meter_ref,
                collector=collector,
            )

        _db_write(lambda db: track(db, user_id=user_id, event="job_analysis_completed", meta={"job_id": job_id}))
        _emit(user_id, session_id, job_id, "pipeline", "joblens_pipeline_complete")

    except Exception as error:
        logger.exception("Job analysis pipeline error for job %s: %s", job_id, error)

        # ── Billing: failure — refund + roll back rate windows ────────────────
        if meter_ref:
            bg_settle_failure(
                user_id=user_id,
                task_type="job_analysis",
                ref=meter_ref,
                collector=collector,
            )

        def mark_job_tracked(db: Session) -> None:
            job = db.query(Job).filter(Job.id == job_id).first()
            if job and job.status == JobStatus.ANALYZING:
                job.status = JobStatus.TRACKED

        _db_write(mark_job_tracked)
        _emit(user_id, session_id, job_id, "pipeline", "joblens_pipeline_failed", {"error": str(error)})


async def retry_steps_background(
    job_id: str,
    session_id: str,
    user_id: str,
    steps: List[str],
    meter_ref: Optional[str] = None,
    tailoring_mode: str = "surgical",
) -> None:
    """Re-run only the specified failed steps using existing session data."""

    collector = UsageCollector()

    # Load what we need from the session
    db = SessionLocal()
    try:
        session_row = db.query(JobLensSession).filter(JobLensSession.id == session_id).first()
        if not session_row:
            return
        profile_data = session_row.profile_snapshot
        jd_data = session_row.job_description
        match_data = session_row.match_analysis
        company_website = session_row.company_website
    finally:
        db.close()

    profile_snapshot: Optional[UnifiedProfile] = None
    job_description: Optional[JobDescriptionBreakdownResult] = None
    match_score = None

    if profile_data:
        try:
            profile_snapshot = UnifiedProfile.model_validate(profile_data)
        except Exception:
            pass

    if jd_data:
        try:
            job_description = JobDescriptionBreakdownResult.model_validate(jd_data)
        except Exception:
            pass

    if match_data:
        try:
            from engine.joblens.job_match.models import JobMatchScore as _JobMatchScore
            match_score = _JobMatchScore.model_validate(match_data)
        except Exception:
            pass

    if not job_description:
        # Cannot retry without a parsed job description
        _emit(user_id, session_id, job_id, "pipeline", "joblens_pipeline_failed",
              {"error": "No job description in session — run full analysis first."})
        return

    results: dict = {}

    # Independent steps (can run in parallel)
    independent = [s for s in steps if s not in ("resume_actions",)]
    needs_resume_actions = "resume_actions" in steps

    async def maybe_run(step: str):
        _emit(user_id, session_id, job_id, step, "joblens_step_started")
        try:
            if step == "company_intel":
                def _do_intel():
                    with SessionLocal() as _db:
                        return _gather_company_intel(job_description, company_website, user_id, _db, collector=collector)
                result, hit = await asyncio.to_thread(_do_intel)
                _emit(user_id, session_id, job_id, step, "joblens_step_complete",
                      {"data": _slim_company_intel(result), "cache_hit": hit})
                results["company_intel"] = result
            elif step == "reachout":
                def _do_reachout():
                    with SessionLocal() as _db:
                        return _discover_reachout(
                            profile_snapshot or UnifiedProfile(), job_description, company_website, user_id, _db,
                            collector=collector,
                        )
                result, hit = await asyncio.to_thread(_do_reachout)
                _emit(user_id, session_id, job_id, step, "joblens_step_complete",
                      {"data": _slim_reachout(result), "cache_hit": hit})
                results["reachout"] = result
            elif step == "match_analysis":
                result = await asyncio.to_thread(lambda: _score_match(profile_snapshot, job_description, user_id, collector=collector))
                _emit(user_id, session_id, job_id, step, "joblens_step_complete",
                      {"data": result.model_dump(mode="json")})
                results["match_analysis"] = result
        except Exception as error:
            logger.exception("Retry step %s failed for job %s: %s", step, job_id, error)
            _emit(user_id, session_id, job_id, step, "joblens_step_failed", {"error": str(error)})

    await asyncio.gather(*[maybe_run(s) for s in independent])

    # resume_actions depends on match_analysis (use fresh result if we just ran it)
    if needs_resume_actions:
        score_for_actions = results.get("match_analysis") or match_score
        _NO_RESUME_MARKER_RETRY: dict = {"_skipped": True, "_reason": "no_resume_file"}
        _EXTRACT_FAILED_MARKER_RETRY: dict = {"_skipped": True, "_reason": "extraction_failed"}

        retry_db = SessionLocal()
        try:
            _retry_candidates, _retry_tagged_count = _get_all_resume_candidates(user_id, retry_db)
        finally:
            retry_db.close()

        if _retry_tagged_count == 0:
            _emit(user_id, session_id, job_id, "resume_actions", "joblens_step_complete",
                  {"data": _NO_RESUME_MARKER_RETRY})
            results["_resume_actions_skipped"] = True
        elif not _retry_candidates:
            logger.error("resume_actions retry skipped for user=%s: %d file(s) tagged but extraction failed for all",
                         user_id, _retry_tagged_count)
            _emit(user_id, session_id, job_id, "resume_actions", "joblens_step_complete",
                  {"data": _EXTRACT_FAILED_MARKER_RETRY})
            results["_resume_actions_skipped"] = True
        elif score_for_actions and profile_snapshot:
            _rcands = _retry_candidates
            _emit(user_id, session_id, job_id, "resume_actions", "joblens_step_started")
            try:
                results["resume_actions"] = await asyncio.to_thread(
                    lambda: _generate_actions(profile_snapshot, job_description, score_for_actions, user_id, _rcands, collector=collector, tailoring_mode=tailoring_mode)
                )
                _emit(user_id, session_id, job_id, "resume_actions", "joblens_step_complete",
                      {"data": results["resume_actions"].model_dump(mode="json")})
            except Exception as _ra_err:
                logger.exception("Retry step resume_actions failed for job %s: %s", job_id, _ra_err)
                _emit(user_id, session_id, job_id, "resume_actions", "joblens_step_failed",
                      {"error": str(_ra_err)})
        else:
            _emit(user_id, session_id, job_id, "resume_actions", "joblens_step_failed",
                  {"error": "Cannot generate resume actions without a match score."})

    def save_retry(db: Session) -> None:
        row = db.query(JobLensSession).filter(JobLensSession.id == session_id).first()
        job = db.query(Job).filter(Job.id == job_id).first()
        if not row:
            return
        if results.get("company_intel"):
            row.company_intel = _slim_company_intel(results["company_intel"])
        if results.get("reachout"):
            row.reachout = _slim_reachout(results["reachout"])
        if results.get("match_analysis"):
            row.match_analysis = results["match_analysis"].model_dump(mode="json")
            if job:
                job.analysis_result = _analysis_summary_from_score(results["match_analysis"])
        if results.get("resume_actions"):
            row.resume_actions = results["resume_actions"].model_dump(mode="json")
        elif results.get("_resume_actions_skipped"):
            row.resume_actions = {"_skipped": True, "_reason": "no_resume_file"}
            row.current_step = max(row.current_step, 6)

    _db_write(save_retry)

    # Billing: retry is free — write usage event only for analytics.
    if meter_ref:
        bg_settle_success(
            user_id=user_id,
            task_type="job_analysis_retry",
            ref=meter_ref,
            collector=collector,
        )

    _emit(user_id, session_id, job_id, "pipeline", "joblens_pipeline_complete")


# ============================================================================
# Routes
# ============================================================================

def _check_profile_documents(user_id: str, db: Session) -> None:
    """Raise 400 if the user has no parsed profile documents (new API or legacy)."""
    doc_count = (
        db.query(ProfileFile)
        .filter(ProfileFile.user_id == user_id, ProfileFile.parsed_data.isnot(None))
        .count()
    )
    if doc_count > 0:
        return
    # Legacy fallback: old-style per-column blobs
    user_profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    if user_profile and any([
        user_profile.resume_data,
        user_profile.linkedin_data,
        user_profile.portfolio_data,
    ]):
        return
    raise HTTPException(
        status_code=400,
        detail={
            "code": "NO_PROFILE_DOCUMENTS",
            "message": "Upload at least one profile document (resume, LinkedIn export, or portfolio) before analyzing a job.",
        },
    )


@router.post("", response_model=JobResponse)
@limiter.limit("10/minute", override_defaults=False)
async def create_job(
    request: Request,
    job_data: JobCreate,
    background_tasks: BackgroundTasks,
    ctx: MeterContext = Depends(metered("job_analysis")),
    db: Session = Depends(get_db),
):
    """Create a new job and kick off the analysis pipeline (costs 12 credits)."""
    _check_profile_documents(ctx.user_id, db)

    # Create placeholder job
    job = Job(
        user_id=ctx.user_id,
        job_posting={
            "job_title": "Analyzing...",
            "company_name": "Pending",
            "raw_jd": job_data.jd_text[:500],
        },
        company_website=job_data.company_website,
        status=JobStatus.ANALYZING,
    )
    db.add(job)
    db.flush()  # get job.id

    # Create internal analysis session
    session = JobLensSession(
        user_id=ctx.user_id,
        job_id=job.id,
        raw_jd_text=job_data.jd_text,
        company_website=job_data.company_website,
    )
    db.add(session)
    db.flush()

    job.joblens_session_id = session.id
    db.commit()
    db.refresh(job)

    track(db, user_id=ctx.user_id, event="job_analysis_started", meta={"job_id": job.id})

    # Pass billing context into the background task.
    # The task owns settle_success / settle_failure from this point forward.
    background_tasks.add_task(
        run_job_analysis_background,
        job.id, session.id, ctx.user_id,
        job_data.jd_text, job_data.company_website,
        meter_ref=ctx.ref,
    )

    return job


@router.get("", response_model=List[JobListResponse])
async def list_jobs(
    status: Optional[JobStatusEnum] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all user's jobs, optionally filtered by status."""
    query = db.query(Job).filter(Job.user_id == current_user.id)

    if status:
        query = query.filter(Job.status == status.value)

    jobs = query.order_by(Job.updated_at.desc()).all()

    session_ids = [j.joblens_session_id for j in jobs if j.joblens_session_id]
    session_steps: dict[str, int] = {}
    if session_ids:
        rows = db.query(JobLensSession.id, JobLensSession.current_step).filter(
            JobLensSession.id.in_(session_ids)
        ).all()
        session_steps = {row.id: row.current_step for row in rows}

    result = []
    for job in jobs:
        final_score = None
        if job.analysis_result:
            final_score = job.analysis_result.get("final_score")
        job_dict = {
            "id": job.id,
            "job_posting": job.job_posting,
            "status": job.status,
            "final_score": final_score,
            "company_website": job.company_website,
            "joblens_session_id": job.joblens_session_id,
            "current_step": session_steps.get(job.joblens_session_id) if job.joblens_session_id else None,
            "created_at": job.created_at,
        }
        result.append(JobListResponse(**job_dict))

    return result


@router.get("/{job_id}/analysis", response_model=JobLensSessionResponse)
async def get_job_analysis(
    job_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get the internal analysis session linked to a job."""

    session = db.query(JobLensSession).filter(
        JobLensSession.job_id == str(job_id),
        JobLensSession.user_id == current_user.id,
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Job analysis not found")

    return session


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get job with full data."""
    job = db.query(Job).filter(
        Job.id == str(job_id),
        Job.user_id == current_user.id
    ).first()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return job


@router.patch("/{job_id}", response_model=JobResponse)
async def update_job(
    job_id: UUID,
    update: JobUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update job status or notes."""
    job = db.query(Job).filter(
        Job.id == str(job_id),
        Job.user_id == current_user.id
    ).first()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if update.status:
        job.status = update.status.value
    if update.user_notes is not None:
        job.user_notes = update.user_notes
    if update.job_link is not None:
        job_posting = dict(job.job_posting)
        if update.job_link == "":
            job_posting.pop("job_link", None)
        else:
            job_posting["job_link"] = update.job_link
        job.job_posting = job_posting

    db.commit()
    db.refresh(job)
    return job


@router.delete("/{job_id}")
async def delete_job(
    job_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete job."""
    job = db.query(Job).filter(
        Job.id == str(job_id),
        Job.user_id == current_user.id
    ).first()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # JobLensSession references jobs.id; Job has no ORM cascade for sessions, so remove them first.
    session_filters = [JobLensSession.job_id == str(job_id)]
    if job.joblens_session_id:
        session_filters.append(JobLensSession.id == job.joblens_session_id)
    db.query(JobLensSession).filter(
        JobLensSession.user_id == current_user.id,
        or_(*session_filters),
    ).delete(synchronize_session=False)

    db.delete(job)
    db.commit()
    return {"message": "Job deleted"}


@router.post("/{job_id}/analyze", response_model=JobResponse)
@limiter.limit("5/minute", override_defaults=False)
async def analyze_job(
    request: Request,
    job_id: UUID,
    background_tasks: BackgroundTasks,
    ctx: MeterContext = Depends(metered("job_analysis")),
    db: Session = Depends(get_db),
):
    """(Re-)run the JobLens analysis pipeline for an existing tracked job (costs 12 credits)."""
    job = db.query(Job).filter(
        Job.id == str(job_id),
        Job.user_id == ctx.user_id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    _check_profile_documents(ctx.user_id, db)

    # Get or create a JobLens session
    session = None
    if job.joblens_session_id:
        session = db.query(JobLensSession).filter(JobLensSession.id == job.joblens_session_id).first()

    if not session:
        raw_jd = (job.job_posting or {}).get("raw_jd", "") or ""
        session = JobLensSession(
            user_id=ctx.user_id,
            job_id=job.id,
            raw_jd_text=raw_jd,
            company_website=job.company_website,
        )
        db.add(session)
        db.flush()
        job.joblens_session_id = session.id

    if job.status == JobStatus.ANALYZING:
        if ctx.ref:
            bg_settle_failure(
                user_id=ctx.user_id,
                task_type="job_analysis",
                ref=ctx.ref,
                collector=UsageCollector(),
            )
        return job

    job.status = JobStatus.ANALYZING
    db.commit()
    db.refresh(job)

    jd_text = session.raw_jd_text or (job.job_posting or {}).get("raw_jd", "") or ""

    background_tasks.add_task(
        run_job_analysis_background,
        job.id, session.id, ctx.user_id,
        jd_text, job.company_website,
        meter_ref=ctx.ref,
    )

    return job


class RetryStepsRequest(BaseModel):
    steps: List[str]
    tailoring_mode: str = "surgical"


@router.post("/{job_id}/retry-steps", response_model=JobLensSessionResponse)
@limiter.limit("5/minute", override_defaults=False)
async def retry_steps(
    request: Request,
    job_id: UUID,
    body: RetryStepsRequest,
    background_tasks: BackgroundTasks,
    ctx: MeterContext = Depends(metered("job_analysis_retry")),
    db: Session = Depends(get_db),
):
    """Re-run only specific failed steps (free — already paid at initial analysis)."""
    VALID_STEPS = {"company_intel", "match_analysis", "resume_actions", "reachout"}
    requested = [s for s in body.steps if s in VALID_STEPS]
    if not requested:
        raise HTTPException(status_code=400, detail="No valid retry steps provided.")

    job = db.query(Job).filter(
        Job.id == str(job_id),
        Job.user_id == ctx.user_id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if not job.joblens_session_id:
        raise HTTPException(status_code=400, detail="No analysis session found. Run full analysis first.")

    session = db.query(JobLensSession).filter(
        JobLensSession.id == job.joblens_session_id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Analysis session not found.")

    background_tasks.add_task(
        retry_steps_background,
        job.id, session.id, ctx.user_id, requested,
        meter_ref=ctx.ref,
        tailoring_mode=body.tailoring_mode,
    )

    return session


@router.post("/track", response_model=JobResponse)
async def track_job(
    job_data: JobTrackCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a simple tracked job without running the AI pipeline."""
    job = Job(
        user_id=current_user.id,
        job_posting={
            "job_title": job_data.job_title,
            "company_name": job_data.company_name,
            **({"job_link": job_data.job_url} if job_data.job_url else {}),
            **({"location": job_data.location} if job_data.location else {}),
        },
        status=job_data.status or "tracked",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@router.post("/{job_id}/parse-resume")
@limiter.limit("10/minute", override_defaults=False)
async def parse_resume_for_job(
    request: Request,
    job_id: UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Parse a resume PDF for re-evaluation."""
    from engine.profile import parse_resume

    job = db.query(Job).filter(
        Job.id == str(job_id),
        Job.user_id == current_user.id
    ).first()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        file_content = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {str(e)}")

    try:
        parsed_data = parse_resume(file_content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse resume: {str(e)}")

    return {
        "success": True,
        "filename": file.filename,
        "parsed_resume": parsed_data
    }
