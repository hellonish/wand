"""Cover Letters Router - CRUD + JD Analysis."""

from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_user
from ..tracking import track
from ..schemas import (
    CoverLetterCreate, CoverLetterUpdate, CoverLetterResponse,
    JDToneAnalysisResponse,
)
from ..models import User, Job, CoverLetter, UserProfile
from ..llm import get_llm, resolve_and_build
from ..billing.gateway import MeterContext, metered
from ..limiter import limiter
from engine.joblens.company_intel import CompanyIntelInput, CompanyIntelService
from engine.joblens.job_description import break_down_job_description

router = APIRouter(prefix="/api/cover-letters", tags=["Cover Letters"])


def _parse_jd_text(jd_text: str, llm, company_name: str = None) -> dict:
    """Parse raw JD text into a structured job_posting dict."""

    parsed = break_down_job_description(jd_text, llm=llm)
    breakdown = parsed.breakdown
    metadata = breakdown.metadata
    return {
        "job_title": metadata.job_title or "",
        "company_name": company_name or metadata.company_name or "",
        "location": metadata.location,
        "job_description": jd_text,
        "required_qualifications": [item.text for item in breakdown.qualifications if item.is_must_have],
        "technical_skills": [item.name for item in breakdown.primary_skills],
        "soft_skills": [item.text for item in breakdown.qualifications if item.category == "soft_skill"],
        "job_keywords": breakdown.keywords,
        "work_mode": metadata.work_mode.value,
        "employment_type": metadata.employment_type.value,
        "seniority_level": metadata.seniority_level.value,
    }


@router.post("/analyze-jd", response_model=JDToneAnalysisResponse)
@limiter.limit("10/minute", override_defaults=False)
async def analyze_jd(
    request: Request,
    data: CoverLetterCreate,
    ctx: MeterContext = Depends(metered("cover_letter_tone")),
    db: Session = Depends(get_db),
):
    """Analyze a job description and recommend the best cover letter mode."""
    from engine.cover_letter import CoverLetterService

    llm = resolve_and_build(db, ctx.user_id, "cover_letter_tone", collector=ctx.collector)
    job_posting = {}
    if data.job_id:
        job = db.query(Job).filter(
            Job.id == str(data.job_id),
            Job.user_id == ctx.user_id,
        ).first()
        if job:
            job_posting = job.job_posting
    elif data.jd_text:
        job_posting = _parse_jd_text(data.jd_text, llm, data.company_name)

    if not job_posting:
        ctx.settle_failure()
        raise HTTPException(status_code=400, detail="Job posting required for JD analysis")

    try:
        result = CoverLetterService(llm)._analyze_jd_tone(job_posting)
        ctx.settle_success()
        return JDToneAnalysisResponse(
            recommended_mode=result.recommended_mode,
            confidence=result.confidence,
            tone_signals=result.tone_signals,
            culture_indicators=result.culture_indicators,
            formality_level=result.formality_level,
            industry=result.industry,
            reasoning=result.reasoning,
        )
    except Exception:
        ctx.settle_failure()
        raise


@router.post("", response_model=CoverLetterResponse)
@limiter.limit("5/minute", override_defaults=False)
async def create_cover_letter(
    request: Request,
    data: CoverLetterCreate,
    ctx: MeterContext = Depends(metered("cover_letter")),
    db: Session = Depends(get_db),
):
    """Generate a cover letter (costs 4 credits)."""
    from engine.cover_letter import generate_cover_letter

    llm = resolve_and_build(db, ctx.user_id, "cover_letter", collector=ctx.collector)
    job = None
    job_posting = {}

    if data.job_id:
        job = db.query(Job).filter(
            Job.id == str(data.job_id),
            Job.user_id == ctx.user_id,
        ).first()
        if job:
            job_posting = job.job_posting
    elif data.jd_text:
        job_posting = _parse_jd_text(data.jd_text, llm, data.company_name)

    if not job_posting:
        ctx.settle_failure()
        raise HTTPException(
            status_code=400,
            detail="Provide either job_id or jd_text to generate a cover letter.",
        )

    try:
        profile = db.query(UserProfile).filter(
            UserProfile.user_id == ctx.user_id,
        ).first()
        unified_profile = profile.unified_profile if profile else {}

        company_intel = None
        if data.include_news and job_posting.get("company_name"):
            try:
                intel = CompanyIntelService(llm=llm).collect(
                    CompanyIntelInput(
                        company_name=job_posting["company_name"],
                        website=job.company_website if job else None,
                        max_pages=4,
                    )
                )
                company_intel = intel.model_dump_json()
            except Exception:
                company_intel = None

        result = generate_cover_letter(
            job_posting=job_posting,
            unified_profile=unified_profile,
            llm=llm,
            mode=data.mode.value,
            custom_prompt=data.custom_prompt,
            company_intel=company_intel,
        )

        result_dict = result.model_dump()
        result_dict["job_title"] = job_posting.get("job_title", "")
        result_dict["company_name"] = job_posting.get("company_name", "")

        cover_letter = CoverLetter(
            user_id=ctx.user_id,
            job_id=str(data.job_id) if data.job_id else None,
            mode=data.mode.value,
            content=result_dict,
            custom_prompt=data.custom_prompt,
        )
        db.add(cover_letter)
        db.commit()
        db.refresh(cover_letter)

        track(db, user_id=ctx.user_id, event="cover_letter_generated", meta={
            "mode": data.mode.value,
            "has_job_id": bool(data.job_id),
        })

        ctx.settle_success()
        return cover_letter

    except Exception:
        ctx.settle_failure()
        raise


@router.get("", response_model=List[CoverLetterResponse])
async def list_cover_letters(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List user's cover letters."""
    letters = db.query(CoverLetter).filter(
        CoverLetter.user_id == current_user.id,
    ).order_by(CoverLetter.updated_at.desc()).all()
    return letters


@router.get("/{letter_id}", response_model=CoverLetterResponse)
async def get_cover_letter(
    letter_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get cover letter."""
    letter = db.query(CoverLetter).filter(
        CoverLetter.id == str(letter_id),
        CoverLetter.user_id == current_user.id,
    ).first()

    if not letter:
        raise HTTPException(status_code=404, detail="Cover letter not found")

    return letter


@router.patch("/{letter_id}", response_model=CoverLetterResponse)
async def update_cover_letter(
    letter_id: UUID,
    update: CoverLetterUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update cover letter."""
    letter = db.query(CoverLetter).filter(
        CoverLetter.id == str(letter_id),
        CoverLetter.user_id == current_user.id,
    ).first()

    if not letter:
        raise HTTPException(status_code=404, detail="Cover letter not found")

    if update.full_letter:
        letter.content = {**letter.content, "full_letter": update.full_letter}
    if update.content:
        letter.content = {**letter.content, **update.content}

    db.commit()
    db.refresh(letter)
    return letter


@router.delete("/{letter_id}")
async def delete_cover_letter(
    letter_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete cover letter."""
    letter = db.query(CoverLetter).filter(
        CoverLetter.id == str(letter_id),
        CoverLetter.user_id == current_user.id,
    ).first()

    if not letter:
        raise HTTPException(status_code=404, detail="Cover letter not found")

    db.delete(letter)
    db.commit()
    return {"message": "Cover letter deleted"}
