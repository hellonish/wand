"""Model registry for BYOK provider/model resolution.

Two things live here:
1. The catalogue of supported providers and their selectable models.
2. The mapping of internal pipeline tasks -> user-facing selection groups, plus
   the recommended-default resolution used when a user hasn't picked a model.
"""

from __future__ import annotations


# ── Tier defaults (used for recommended/auto resolution) ──────────────────────

PROVIDERS: dict[str, dict[str, str]] = {
    "anthropic": {"reasoning": "claude-opus-4-5",    "fast": "claude-haiku-4-5"},
    "openai":    {"reasoning": "gpt-4o",              "fast": "gpt-4o-mini"},
    "gemini":    {"reasoning": "gemini-2.5-pro",      "fast": "gemini-2.5-flash"},
    "xai":       {"reasoning": "grok-3",              "fast": "grok-3-fast"},
    "deepseek":  {"reasoning": "deepseek-reasoner",   "fast": "deepseek-chat"},
}

PROVIDER_LABELS: dict[str, str] = {
    "anthropic": "Anthropic (Claude)",
    "openai":    "OpenAI (ChatGPT)",
    "gemini":    "Google Gemini",
    "xai":       "xAI (Grok)",
    "deepseek":  "DeepSeek",
}


# ── Selectable model catalogue (friendly names, best-first per provider) ───────
# Labels follow the conventions used by multi-provider platforms (OpenRouter,
# LiteLLM, Vercel AI SDK). The first entry per provider is its sensible default.

PROVIDER_MODELS: dict[str, list[dict[str, str]]] = {
    "anthropic": [
        {"id": "claude-opus-4-5",   "label": "Claude Opus 4.5"},
        {"id": "claude-sonnet-4-5", "label": "Claude Sonnet 4.5"},
        {"id": "claude-haiku-4-5",  "label": "Claude Haiku 4.5"},
    ],
    "openai": [
        {"id": "gpt-4o",      "label": "GPT-4o"},
        {"id": "gpt-4o-mini", "label": "GPT-4o mini"},
        {"id": "o3",          "label": "o3"},
        {"id": "o3-mini",     "label": "o3-mini"},
    ],
    "gemini": [
        {"id": "gemini-2.5-pro",   "label": "Gemini 2.5 Pro"},
        {"id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash"},
        {"id": "gemini-2.0-flash", "label": "Gemini 2.0 Flash"},
    ],
    "xai": [
        {"id": "grok-4",      "label": "Grok 4"},
        {"id": "grok-3",      "label": "Grok 3"},
        {"id": "grok-3-fast", "label": "Grok 3 Fast"},
        {"id": "grok-3-mini", "label": "Grok 3 Mini"},
    ],
    "deepseek": [
        {"id": "deepseek-chat",     "label": "DeepSeek V4 Flash"},
        {"id": "deepseek-reasoner", "label": "DeepSeek V4 Pro"},
    ],
}


def is_supported_model(provider: str, model: str) -> bool:
    """True if model is a known, supported model for provider."""
    return any(m["id"] == model for m in PROVIDER_MODELS.get(provider, []))


def models_for_providers(providers: set[str]) -> dict[str, list[dict[str, str]]]:
    """Catalogue restricted to the given (configured) providers."""
    return {p: PROVIDER_MODELS[p] for p in PROVIDER_MODELS if p in providers}


# ── Internal task -> capability tier ──────────────────────────────────────────

TASK_TIER: dict[str, str] = {
    "default":           "fast",
    "profile":           "fast",
    "job_description":   "fast",
    "cover_letter_tone": "fast",
    "company_intel":     "reasoning",
    "job_match":         "reasoning",
    "reachout":          "reasoning",
    "cover_letter":      "reasoning",
}

# Quality-first preference order per tier.
PREFERENCE: dict[str, list[str]] = {
    "reasoning": ["anthropic", "openai", "gemini", "xai", "deepseek"],
    "fast":      ["gemini", "openai", "anthropic", "xai", "deepseek"],
}


# ── User-facing selection groups ──────────────────────────────────────────────
# The user picks ONE model per group; each group expands to the internal tasks
# it covers. The "primary" task drives the recommended default for the group.

TASK_GROUPS: list[dict] = [
    {
        "id": "cover_letter",
        "label": "Cover Letter",
        "primary": "cover_letter",
        "tasks": ["cover_letter", "cover_letter_tone"],
    },
    {
        "id": "job_analysis",
        "label": "JobLens — Job Analysis",
        "primary": "job_match",
        "tasks": ["job_description", "company_intel", "job_match", "reachout"],
    },
    {
        "id": "profile",
        "label": "Profile Management",
        "primary": "profile",
        "tasks": ["profile"],
    },
]

# Reverse lookup: internal task -> group id.
_TASK_TO_GROUP: dict[str, str] = {
    task: group["id"] for group in TASK_GROUPS for task in group["tasks"]
}


def group_for_task(task: str) -> str | None:
    """Return the selection-group id that owns this internal task, if any."""
    return _TASK_TO_GROUP.get(task)


# ── Resolution ────────────────────────────────────────────────────────────────

def recommended_config(available_providers: set[str]) -> dict[str, dict[str, str]]:
    """For each task, pick the first preferred provider the user has a key for.
    Returns {task: {provider, model}} for tasks that can be fulfilled.
    """
    cfg: dict[str, dict[str, str]] = {}
    for task, tier in TASK_TIER.items():
        for provider in PREFERENCE[tier]:
            if provider in available_providers:
                cfg[task] = {"provider": provider, "model": PROVIDERS[provider][tier]}
                break
    return cfg


def recommended_groups(available_providers: set[str]) -> dict[str, dict[str, str]]:
    """Recommended {group_id: {provider, model}} for each selection group."""
    per_task = recommended_config(available_providers)
    out: dict[str, dict[str, str]] = {}
    for group in TASK_GROUPS:
        primary = group["primary"]
        if primary in per_task:
            out[group["id"]] = per_task[primary]
    return out


def resolve_task(
    task: str,
    available_providers: set[str],
    group_selection: dict[str, dict[str, str]] | None,
) -> dict[str, str] | None:
    """Resolve the final {provider, model} for an internal task.

    Order:
      1. The user's saved selection for the task's group (if the provider still
         has a key and the model is supported).
      2. The recommended default for the task.
      3. None (no provider available).
    """
    group_id = group_for_task(task)
    if group_id and group_selection:
        sel = group_selection.get(group_id)
        if (
            sel
            and sel.get("provider") in available_providers
            and is_supported_model(sel.get("provider", ""), sel.get("model", ""))
        ):
            return {"provider": sel["provider"], "model": sel["model"]}

    return recommended_config(available_providers).get(task)
