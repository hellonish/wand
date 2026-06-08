"""
Cover Letter Module - Multi-mode generation with optional context enrichment.

Modes: storyline | disruptive | regular | auto | custom
"""

from .models import CoverLetter, EnhancedPrompt, JDToneAnalysis
from .service import CoverLetterService, generate_cover_letter

__all__ = [
    "CoverLetter",
    "EnhancedPrompt",
    "JDToneAnalysis",
    "CoverLetterService",
    "generate_cover_letter",
]
