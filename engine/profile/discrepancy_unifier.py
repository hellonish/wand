"""
Discrepancy-Aware Unified Profile Creator.

Runs discrepancy analysis across all profile sources, then uses the results
to produce a maximally rich, deduplicated unified profile.
"""

import json
from typing import Dict, Any, Optional, Tuple

from engine.models.llm import LLMClient
from engine.discrepancy.analyzer import DiscrepancyAnalyzer
from .models import HybridResume

UNIFICATION_SYSTEM_PROMPT = """You are creating a Unified Master Profile from multiple sources.

You have been given:
1. Multiple profile source documents (Resume, LinkedIn, Portfolio, Other)
2. A discrepancy analysis that identifies which entities are the same across sources

RULES:
1. For each REAL entity (job, school, skill, project), create exactly ONE entry in the unified profile
2. Use the discrepancy analysis to identify when two entries across sources refer to the same entity
3. For each unified entity, MAXIMIZE the content:
   - Merge descriptions from all sources into the richest combined description
   - If Source A says "Python, React" and Source B says "Python, React, Node.js", use the union
   - If Source A has a brief description and Source B has a detailed one, keep the detailed one but add any unique points from A
4. Skills: Union of all skills from all sources
5. Education: Deduplicate by institution+degree, keep richest entry
6. Work Experience: Deduplicate by company+title, merge descriptions
7. Dynamic sections: Merge all unique sections, union list items

Output must match the HybridResume schema."""


def create_discrepancy_aware_unified_profile(
    sources: Dict[str, Dict[str, Any]],
    llm: LLMClient,
    global_context: Optional[str] = None,
    per_file_context: Optional[Dict[str, str]] = None,
) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    """
    Create a unified profile using discrepancy analysis to guide merging.

    Args:
        sources: Dict mapping source identifiers to parsed profile data.
                 e.g. {"resume_1": {...}, "linkedin_1": {...}, "portfolio_1": {...}}
        llm: LLMClient instance.

    Returns:
        Tuple of (unified_profile_dict, discrepancy_analysis_dict_or_None)
    """
    if not sources:
        return {}, None

    if len(sources) == 1:
        data = list(sources.values())[0]
        return data, None

    resume_data = None
    linkedin_data = None
    portfolio_data = None

    for key, val in sources.items():
        lower = key.lower()
        if "resume" in lower and resume_data is None:
            resume_data = val
        elif "linkedin" in lower and linkedin_data is None:
            linkedin_data = val
        elif "portfolio" in lower and portfolio_data is None:
            portfolio_data = val

    discrepancy_result = None
    try:
        analyzer = DiscrepancyAnalyzer(llm)
        discrepancy_result = analyzer.analyze(
            resume=resume_data,
            linkedin=linkedin_data,
            portfolio=portfolio_data
        )
    except Exception:
        pass

    sources_serialized = {}
    for key, val in sources.items():
        sources_serialized[key] = json.dumps(val, indent=2, default=str)

    discrepancy_text = ""
    if discrepancy_result is not None:
        discrepancy_text = json.dumps(
            discrepancy_result.model_dump(), indent=2, default=str
        )

    user_message = f"""PROFILE SOURCES:

{chr(10).join(f'=== {name} ==={chr(10)}{data}' for name, data in sources_serialized.items())}
"""

    if global_context:
        user_message += f"\nGLOBAL ADDITIONAL CONTEXT:\n{global_context}\n"

    if per_file_context:
        ctx_parts = [f"  {fname}: {ctx}" for fname, ctx in per_file_context.items()]
        user_message += f"\nPER-FILE CONTEXT:\n{chr(10).join(ctx_parts)}\n"

    user_message += f"""
DISCREPANCY ANALYSIS:
{discrepancy_text if discrepancy_text else 'No discrepancy analysis available (skipped due to insufficient sources or error).'}

Create the unified master profile following the rules in your system prompt."""

    try:
        unified = llm.complete(
            response_model=HybridResume,
            messages=[
                {"role": "system", "content": UNIFICATION_SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            temperature=0.0,
            max_tokens=8000,
        )
        unified_dict = unified.model_dump()
    except Exception:
        from .unifier import create_unified_profile
        type_sources = {}
        for key, val in sources.items():
            lower = key.lower()
            if "resume" in lower:
                type_sources["resume"] = val
            elif "linkedin" in lower:
                type_sources["linkedin"] = val
            elif "portfolio" in lower:
                type_sources["portfolio"] = val
        unified_dict = create_unified_profile(type_sources) if type_sources else list(sources.values())[0]

    discrepancy_dict = None
    if discrepancy_result is not None:
        discrepancy_dict = discrepancy_result.model_dump()

    return unified_dict, discrepancy_dict
