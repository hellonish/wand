"""API-owned LLM model routing."""

import json
from pathlib import Path
from typing import Any, Dict, Optional, Union

from pydantic import BaseModel

from engine.providers import DEFAULT_DEEPSEEK_MODEL, DEFAULT_XAI_MODEL, DeepSeekClient, XAIClient
from engine.usage import UsageCollector


CONFIG_PATH = Path(__file__).with_name("llm_config.json")

DEFAULT_TASK_MODELS = {
    "default": DEFAULT_XAI_MODEL,
    "profile": DEFAULT_XAI_MODEL,
    "job_description": DEFAULT_XAI_MODEL,
    "company_intel": DEFAULT_XAI_MODEL,
    "job_match": DEFAULT_XAI_MODEL,
    "reachout": DEFAULT_XAI_MODEL,
    "cover_letter": DEFAULT_XAI_MODEL,
    "cover_letter_tone": DEFAULT_XAI_MODEL,
}


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
    """Resolve the provider/model for a task."""

    config = load_llm_config()
    models = config["models"]
    return LLMRuntimeSettings(
        provider=config["provider"],
        model=models.get(task) or models["default"],
    )


def get_llm(
    task: str = "default",
    collector: Optional[UsageCollector] = None,
) -> Union[XAIClient, DeepSeekClient]:
    """Create the engine-compatible LLM client for a task.

    Pass a UsageCollector to capture token counts from every complete() call
    made on the returned client. The collector is thread-safe for single-task
    use; do not share one collector across concurrent requests.
    """
    client = build_llm_from_settings(resolve_llm_settings(task))
    client.collector = collector  # None = no-op; provider clients check before appending
    return client


def build_llm_from_settings(settings: LLMRuntimeSettings | Dict[str, Any]) -> Union[XAIClient, DeepSeekClient]:
    """Create an LLM client from server-side config.

    API keys are intentionally not stored in app config or user settings. The
    provider client reads credentials from server environment variables.
    """

    runtime = settings if isinstance(settings, LLMRuntimeSettings) else LLMRuntimeSettings.model_validate(settings)
    provider = (runtime.provider or "grok").lower()
    if provider == "deepseek":
        return DeepSeekClient(model=runtime.model)
    if provider in {"grok", "xai"}:
        return XAIClient(model=runtime.model)
    raise ValueError(f"Unsupported LLM provider: {runtime.provider}")
