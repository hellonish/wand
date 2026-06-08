"""Cover-letter generation service."""

from typing import Any, Dict, List, Optional

import engine.inference as inference
from .models import CoverLetter, EnhancedPrompt, JDToneAnalysis
from .prompts import MODE_PROMPTS, MODE_TEMPERATURES, SUPPORTED_MODES

_SUPPORTED_MODE_SET = frozenset(SUPPORTED_MODES)
_SUPPORTED_MODE_LABEL = ", ".join(SUPPORTED_MODES)


class CoverLetterService:
    """Generate cover letters with optional JD tone and prompt enhancement steps."""

    def __init__(self, llm: Any) -> None:
        if llm is None:
            raise ValueError("llm is required")
        self._llm = llm

    def generate(
        self,
        job_posting: Dict,
        unified_profile: Dict,
        mode: str = "regular",
        applicant_name: Optional[str] = None,
        hiring_manager: Optional[str] = None,
        custom_prompt: Optional[str] = None,
        company_news: Optional[List[Dict]] = None,
        company_intel: Optional[str] = None,
    ) -> CoverLetter:
        """Generate a cover letter."""

        self._validate_mode(mode)
        custom_prompt_text = custom_prompt.strip() if custom_prompt else ""
        if mode == "custom" and not custom_prompt_text:
            raise ValueError("custom_prompt is required when mode='custom'")

        applicant_name = (
            applicant_name
            or unified_profile.get("basics", {}).get("name", "Applicant")
        )

        actual_mode = mode
        jd_tone: Optional[JDToneAnalysis] = None
        if mode == "auto":
            jd_tone = self._analyze_jd_tone(job_posting)
            actual_mode = jd_tone.recommended_mode
            self._validate_resolved_mode(actual_mode)

        enhanced: Optional[EnhancedPrompt] = None
        if mode == "custom":
            enhanced = self._enhance_prompt(custom_prompt_text, job_posting, unified_profile)

        context = self._build_context(
            job_posting,
            unified_profile,
            applicant_name,
            hiring_manager,
            company_news,
            company_intel,
        )
        result = inference.write_cover_letter(
            self._llm,
            self._resolve_system_prompt(actual_mode, enhanced),
            context,
            actual_mode,
        )

        result.mode = actual_mode
        result.company_intel_used = bool(company_news or company_intel)

        if jd_tone:
            result.jd_tone_detected = jd_tone.recommended_mode
            result.mode_label = f"Auto-Detected: {jd_tone.recommended_mode.title()}"

        if enhanced:
            result.enhanced_prompt = enhanced.enhanced_prompt

        if not result.full_letter:
            result.full_letter = self._format_full_letter(result, applicant_name)

        return result

    def _analyze_jd_tone(self, job_posting: Dict) -> JDToneAnalysis:
        """Analyze a JD and recommend a generation mode."""

        return inference.analyze_jd_tone(self._llm, job_posting)

    def _enhance_prompt(
        self,
        rough_prompt: str,
        job_posting: Dict,
        unified_profile: Dict,
    ) -> EnhancedPrompt:
        """Enhance a rough custom prompt before cover-letter generation."""

        return inference.enhance_cover_letter_prompt(self._llm, rough_prompt, job_posting, unified_profile)

    @staticmethod
    def _validate_mode(mode: str) -> None:
        if mode not in _SUPPORTED_MODE_SET:
            raise ValueError(
                f"Unsupported cover letter mode {mode!r}. "
                f"Supported modes: {_SUPPORTED_MODE_LABEL}."
            )

    @staticmethod
    def _validate_resolved_mode(mode: str) -> None:
        if mode not in MODE_PROMPTS:
            raise ValueError(
                f"Unsupported auto-detected cover letter mode {mode!r}. "
                "Expected one of: storyline, disruptive, regular."
            )

    def _build_context(
        self,
        job_posting: Dict,
        unified_profile: Dict,
        applicant_name: str,
        hiring_manager: Optional[str],
        company_news: Optional[List[Dict]],
        company_intel: Optional[str],
    ) -> str:
        parts = [
            f"APPLICANT NAME: {applicant_name}",
            f"HIRING MANAGER: {hiring_manager or 'Unknown'}",
            "",
            "JOB POSTING:",
            f"- Title: {job_posting.get('job_title', 'Unknown')}",
            f"- Company: {job_posting.get('company_name', 'Unknown')}",
            f"- About Company: {job_posting.get('company_about', '')}",
            f"- Description: {job_posting.get('job_description', '')}",
            f"- Required Qualifications: {job_posting.get('required_qualifications', [])}",
            f"- Technical Skills: {job_posting.get('technical_skills', [])}",
            f"- Soft Skills: {job_posting.get('soft_skills', [])}",
            f"- Keywords: {job_posting.get('job_keywords', [])}",
        ]

        if company_intel:
            parts += ["", "COMPANY INTELLIGENCE:", company_intel]

        if company_news:
            company = job_posting.get("company_name", "the company")
            articles = "\n".join(
                f"- [{article.get('source', '?')}] {article.get('title', '')}: "
                f"{article.get('description', '')}"
                for article in company_news[:5]
            )
            parts += [
                "",
                f"RECENT NEWS ABOUT {company}:",
                articles,
                "",
                "INSTRUCTION: Reference 1-2 relevant news items naturally to "
                "demonstrate genuine awareness of the company's current activities.",
            ]

        parts += ["", "APPLICANT PROFILE:", str(unified_profile)]
        return "\n".join(parts)

    def _resolve_system_prompt(
        self,
        mode: str,
        enhanced: Optional[EnhancedPrompt],
    ) -> str:
        if mode == "custom":
            if enhanced is None:
                raise ValueError("enhanced prompt is required for custom mode")
            return (
                "You are a professional cover letter writer.\n\n"
                f"FOLLOW THESE INSTRUCTIONS PRECISELY:\n{enhanced.enhanced_prompt}\n\n"
                "OUTPUT FORMAT - return a JSON object with these fields:\n"
                "- greeting (string)\n"
                "- body_paragraphs (array of strings - the main letter content)\n"
                "- closing_paragraph (string - call to action)\n"
                "- sign_off (string)\n"
                "- full_letter (string - the complete formatted letter with "
                "greeting, paragraphs, closing, sign_off, and applicant name appended)"
            )

        if mode in MODE_PROMPTS:
            return MODE_PROMPTS[mode]

        raise ValueError(
            f"Unsupported cover letter prompt mode {mode!r}. "
            "Expected one of: storyline, disruptive, regular, custom."
        )

    @staticmethod
    def _format_full_letter(letter: CoverLetter, applicant_name: str) -> str:
        sections = [
            section.strip()
            for section in [
                letter.greeting,
                *letter.body_paragraphs,
                letter.closing_paragraph,
            ]
            if section and section.strip()
        ]
        signature = [
            line.strip()
            for line in [letter.sign_off, applicant_name]
            if line and line.strip()
        ]
        if signature:
            sections.append("\n".join(signature))
        return "\n\n".join(sections)


def generate_cover_letter(
    job_posting: Dict,
    unified_profile: Dict,
    llm: Any,
    mode: str = "regular",
    applicant_name: Optional[str] = None,
    hiring_manager: Optional[str] = None,
    custom_prompt: Optional[str] = None,
    company_news: Optional[List[Dict]] = None,
    company_intel: Optional[str] = None,
) -> CoverLetter:
    """One-shot cover letter generation."""

    return CoverLetterService(llm).generate(
        job_posting=job_posting,
        unified_profile=unified_profile,
        mode=mode,
        applicant_name=applicant_name,
        hiring_manager=hiring_manager,
        custom_prompt=custom_prompt,
        company_news=company_news,
        company_intel=company_intel,
    )
