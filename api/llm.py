"""API-owned LLM model routing."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional, Union

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from engine.providers import (
    XAIClient, DeepSeekClient, GeminiClient, OpenAIClient, AnthropicClient,
    DEFAULT_XAI_MODEL, DEFAULT_DEEPSEEK_MODEL,
)
from engine.model_registry import recommended_config, resolve_task
from engine.usage import UsageCollector


CONFIG_PATH = Path(__file__).with_name("llm_config.json")

DEFAULT_TASK_MODELS = {
    "default":           DEFAULT_XAI_MODEL,
    "profile":           DEFAULT_XAI_MODEL,
    "job_description":   DEFAULT_XAI_MODEL,
    "company_intel":     DEFAULT_XAI_MODEL,
    "job_match":         DEFAULT_XAI_MODEL,
    "reachout":          DEFAULT_XAI_MODEL,
    "cover_letter":      DEFAULT_XAI_MODEL,
    "cover_letter_tone": DEFAULT_XAI_MODEL,
}

# Env var to require BYOK (no server-side fallback)
BYOK_REQUIRED = os.getenv("BYOK_REQUIRED", "false").lower() == "true"


class LLMRuntimeSettings(BaseModel):
    """Resolved server-side LLM settings for one API task."""

    provider: str = "grok"
    model: str = DEFAULT_XAI_MODEL


def default_llm_config() -> Dict[str, Any]:
    """Return the product-owner controlled LLM config shape."""
    return {
        "provider": "grok",
        "models": DEFAULT_TASK_MODELS,
    }


def load_llm_config() -> Dict[str, Any]:
    """Load API-owned LLM routing from disk."""
    if not CONFIG_PATH.exists():
        return save_llm_config(default_llm_config())
    try:
        raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        raw = {}

    config = default_llm_config()
    if raw.get("provider"):
        config["provider"] = raw["provider"]
    if isinstance(raw.get("models"), dict):
        config["models"].update({key: value for key, value in raw["models"].items() if value})
    elif raw.get("model"):
        config["models"]["default"] = raw["model"]
    return config


def save_llm_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """Persist API-owned LLM routing without API keys."""
    normalized = default_llm_config()
    if config.get("provider"):
        normalized["provider"] = config["provider"]
    if isinstance(config.get("models"), dict):
        normalized["models"].update({key: value for key, value in config["models"].items() if value})
    CONFIG_PATH.write_text(json.dumps(normalized, indent=2), encoding="utf-8")
    return normalized


def resolve_llm_settings(task: str = "default") -> LLMRuntimeSettings:
    """Resolve the provider/model for a task (server-side env path)."""
    config = load_llm_config()
    models = config["models"]
    return LLMRuntimeSettings(
        provider=config["provider"],
        model=models.get(task) or models["default"],
    )


def build_llm_from_settings(
    settings: Union[LLMRuntimeSettings, Dict[str, Any]],
    api_key: Optional[str] = None,
):
    """Create an LLM client from settings. Optionally pass an explicit api_key."""
    runtime = settings if isinstance(settings, LLMRuntimeSettings) else LLMRuntimeSettings.model_validate(settings)
    provider = (runtime.provider or "grok").lower()
    if provider == "deepseek":
        return DeepSeekClient(model=runtime.model, api_key=api_key)
    if provider in {"grok", "xai"}:
        return XAIClient(model=runtime.model, api_key=api_key)
    if provider == "gemini":
        return GeminiClient(model=runtime.model, api_key=api_key)
    if provider == "openai":
        return OpenAIClient(model=runtime.model, api_key=api_key)
    if provider == "anthropic":
        return AnthropicClient(model=runtime.model, api_key=api_key)
    raise ValueError(f"Unsupported LLM provider: {runtime.provider}")


def get_llm(
    task: str = "default",
    collector: Optional[UsageCollector] = None,
):
    """Create the engine-compatible LLM client for a task (server-side env path).

    This is the backward-compat fallback used when BYOK_REQUIRED is false.
    In production BYOK mode, use resolve_and_build() instead.
    """
    client = build_llm_from_settings(resolve_llm_settings(task))
    client.collector = collector
    return client


def resolve_and_build(
    db: Session,
    user_id: str,
    task: str,
    collector: Optional[UsageCollector] = None,
):
    """Resolve the best available LLM for a user+task and return a ready client.

    Resolution order:
    1. Query user's BYOK keys + saved per-group model selection from DB
    2. Use the user's saved model for this task's group if set, else the
       recommended default for the task
    3. Decrypt key and build client
    4. Fall back to server-side env key if BYOK_REQUIRED is false and no user key
    5. Raise 402 if BYOK_REQUIRED and no user key configured
    """
    from .models import UserLLMKey, UserLLMConfig
    from .routers.llm_settings import decrypt_key

    keys = db.query(UserLLMKey).filter(UserLLMKey.user_id == user_id).all()
    available_providers = {row.provider for row in keys}
    key_map = {row.provider: row for row in keys}

    if available_providers:
        cfg_row = db.query(UserLLMConfig).filter(UserLLMConfig.user_id == user_id).first()
        group_selection = cfg_row.group_models if cfg_row else None
        task_cfg = resolve_task(task, available_providers, group_selection) \
            or recommended_config(available_providers).get("default")
        if task_cfg:
            provider = task_cfg["provider"]
            model = task_cfg["model"]
            api_key = decrypt_key(key_map[provider].encrypted_key)
            client = build_llm_from_settings(
                LLMRuntimeSettings(provider=provider, model=model),
                api_key=api_key,
            )
            client.collector = collector
            return client

    # No user key for this task
    if BYOK_REQUIRED:
        raise HTTPException(
            status_code=402,
            detail="No AI provider configured. Add an API key in Settings.",
        )

    # Fallback to server-side env keys
    return get_llm(task, collector=collector)
