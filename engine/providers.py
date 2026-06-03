"""LLM provider clients.

All provider-specific setup lives here. Adding a new provider means adding a
subclass with its base URL, env-var names, and default model — nothing else
needs to change.

Provider notes
--------------
XAIClient   — instructor + JSON mode. Grok handles structured generation well;
              instructor retries are safe here.

DeepSeekClient — plain OpenAI SDK + response_format={"type":"json_object"}.
              DeepSeek's OpenAI-compatibility layer does not handle instructor's
              tool/JSON coercion reliably. Using instructor causes silent retry
              loops that burn through token quotas and trigger 403 spend limits.
              We parse the raw JSON response manually with Pydantic instead.
"""

import json
import os
import re
from typing import Any, Dict, List, Optional, Type

import instructor
from dotenv import load_dotenv
from openai import OpenAI

from engine.usage import Usage, UsageCollector


# ─── Input-size guard ─────────────────────────────────────────────────────────
# Bounds worst-case spend per LLM call. Input tokens are billed (Grok-3 in =
# $3/1M) and a single task can chain several calls, so an unbounded prompt is a
# cost-amplification vector (e.g. pasting a multi-MB JD, or 12 large profile
# files). We approximate tokens as chars/4 and reject prompts over the ceiling
# BEFORE hitting the provider. Tune via LLM_MAX_INPUT_CHARS (default ~300k chars
# ≈ 75k tokens ≈ $0.22 of Grok-3 input — generous for any real document set).
_MAX_INPUT_CHARS = int(os.getenv("LLM_MAX_INPUT_CHARS", "300000"))


class InputTooLarge(ValueError):
    """Raised when an LLM prompt exceeds the configured input ceiling."""

    def __init__(self, chars: int, limit: int):
        self.chars = chars
        self.limit = limit
        super().__init__(
            f"LLM input too large: {chars} chars exceeds limit of {limit}. "
            "Reduce the size of the job description or profile documents."
        )


def _guard_input_size(messages: List[Dict[str, str]]) -> None:
    """Reject oversized prompts before they reach the provider (cost guard)."""
    total = sum(len(m.get("content", "") or "") for m in messages)
    if total > _MAX_INPUT_CHARS:
        raise InputTooLarge(total, _MAX_INPUT_CHARS)


# ─── Shared helpers ───────────────────────────────────────────────────────────

def _extract_json(text: str) -> str:
    """Strip markdown code fences and return the first JSON block found."""
    match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
    if match:
        return match.group(1).strip()
    return text.strip()


def _ensure_json_word(messages: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """DeepSeek 400-guard: the prompt must contain the word 'json' when
    response_format={'type':'json_object'} is set, or the API rejects it.
    If none of the messages already contain the word, append a one-line
    instruction to the last message rather than touching callers' prompts."""
    combined = " ".join(m.get("content", "") for m in messages)
    if "json" in combined.lower():
        return messages
    messages = list(messages)
    last = messages[-1]
    messages[-1] = {**last, "content": last["content"] + "\n\nRespond with a JSON object."}
    return messages


def _inject_response_schema(
    messages: List[Dict[str, str]], response_model: Type[Any]
) -> List[Dict[str, str]]:
    """Append the response model's JSON schema to the system prompt.

    instructor does this automatically when wrapping an OpenAI client.
    Without instructor we must do it manually so the LLM knows the exact
    top-level wrapper structure (e.g. {"components": {...}, "warnings": []})
    and does not return inner-model fields at the root level.

    Skips injection if the model's schema title is already present in the
    existing system message (i.e. the prompt builder already injected it).
    """
    model_schema = response_model.model_json_schema()
    model_title = model_schema.get("title", "")

    # Check if the schema is already present — avoid double injection
    for msg in messages:
        if msg.get("role") == "system" and model_title and model_title in msg.get("content", ""):
            return messages

    schema = json.dumps(model_schema, indent=2)
    schema_block = (
        "\n\n---\nYou MUST return a single JSON object that exactly matches "
        "the following JSON Schema. Do not add, remove, or rename top-level keys.\n\n"
        f"{schema}"
    )
    messages = list(messages)
    for i, msg in enumerate(messages):
        if msg.get("role") == "system":
            messages[i] = {**msg, "content": msg["content"] + schema_block}
            return messages
    # No system message — prepend one
    messages.insert(0, {"role": "system", "content": "Respond with JSON." + schema_block})
    return messages


# ─── XAI (Grok) — instructor path ────────────────────────────────────────────

class XAIClient:
    """X.AI (Grok) structured-output client via instructor."""

    _BASE_URL = "https://api.x.ai/v1"
    _API_KEY_ENV = "XAI_API_KEY"
    _MODEL_ENV = "XAI_MODEL"
    _DEFAULT_MODEL = "grok-3"
    _DEFAULT_MAX_TOKENS = 24000
    max_output_tokens = 32768   # Grok-3 supports large outputs — single-call path

    def __init__(self, model: Optional[str] = None, api_key: Optional[str] = None):
        load_dotenv()
        key = api_key or os.getenv(self._API_KEY_ENV)
        if not key:
            raise ValueError(f"{self._API_KEY_ENV} is required in .env or the environment.")
        self.model = model or os.getenv(self._MODEL_ENV) or self._DEFAULT_MODEL
        self._client = instructor.from_openai(
            OpenAI(base_url=self._BASE_URL, api_key=key, timeout=120.0),
            mode=instructor.Mode.JSON,
        )
        # Attached by api/llm.get_llm(collector=...). None = no tracking.
        self.collector: Optional[UsageCollector] = None

    def complete(
        self,
        response_model: Type[Any],
        messages: List[Dict[str, str]],
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        max_retries: int = 2,
    ) -> Any:
        _guard_input_size(messages)
        # create_with_completion returns (parsed_model, raw_completion).
        # raw_completion.usage carries prompt_tokens / completion_tokens.
        result, completion = self._client.chat.completions.create_with_completion(
            model=self.model,
            response_model=response_model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens or self._DEFAULT_MAX_TOKENS,
            max_retries=max_retries,
            strict=False,
        )
        if self.collector is not None:
            usage = getattr(completion, "usage", None)
            if usage is not None:
                self.collector.add(Usage(
                    input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
                    output_tokens=getattr(usage, "completion_tokens", 0) or 0,
                    provider="grok",
                    model=self.model,
                ))
        return result


# ─── DeepSeek — plain OpenAI SDK path ────────────────────────────────────────

class DeepSeekClient:
    """DeepSeek client using the plain OpenAI SDK with JSON response_format.

    Why no instructor here:
    - DeepSeek's structured-generation compatibility is incomplete.
    - instructor retries on parse failures, which rapidly exhausts token budgets
      and triggers DeepSeek's per-team spend limits (403).
    - response_format={"type":"json_object"} is stable on deepseek-chat and
      avoids all instructor coercion overhead.
    """

    _BASE_URL = "https://api.deepseek.com"
    _API_KEY_ENV = "DEEPSEEK_API_KEY"
    _MODEL_ENV = "DEEPSEEK_MODEL"
    _DEFAULT_MODEL = "deepseek-chat"
    _DEFAULT_MAX_TOKENS = 4096  # 8192 was too aggressive; retries * 8k = quota death
    _MAX_OUTPUT_TOKENS = 8192   # deepseek-chat hard cap — exceeding this returns HTTP 400
    max_output_tokens = 8192    # capability flag — callers use this to pick single vs two-phase

    def __init__(self, model: Optional[str] = None, api_key: Optional[str] = None):
        load_dotenv()
        key = api_key or os.getenv(self._API_KEY_ENV)
        if not key:
            raise ValueError(f"{self._API_KEY_ENV} is required in .env or the environment.")
        self.model = model or os.getenv(self._MODEL_ENV) or self._DEFAULT_MODEL
        # Plain OpenAI client — no instructor wrapper
        self._client = OpenAI(base_url=self._BASE_URL, api_key=key, timeout=120.0)
        # Attached by api/llm.get_llm(collector=...). None = no tracking.
        self.collector: Optional[UsageCollector] = None

    def complete(
        self,
        response_model: Type[Any],
        messages: List[Dict[str, str]],
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        max_retries: int = 0,  # no silent retries — fail fast and surface the error
    ) -> Any:
        _guard_input_size(messages)
        # Inject the response model's JSON schema so DeepSeek knows the exact
        # wrapper structure. Without this, it returns inner-model fields flat
        # at the root level instead of the expected {"field": ..., ...} wrapper.
        messages = _inject_response_schema(messages, response_model)
        # DeepSeek also requires the literal word "json" somewhere in the prompt.
        messages = _ensure_json_word(messages)

        response = self._client.chat.completions.create(
            model=self.model,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=temperature,
            max_tokens=min(max_tokens or self._DEFAULT_MAX_TOKENS, self._MAX_OUTPUT_TOKENS),
        )
        if self.collector is not None:
            usage = getattr(response, "usage", None)
            if usage is not None:
                self.collector.add(Usage(
                    input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
                    output_tokens=getattr(usage, "completion_tokens", 0) or 0,
                    provider="deepseek",
                    model=self.model,
                ))
        content = response.choices[0].message.content or ""
        content = _extract_json(content)
        return response_model.model_validate_json(content)


# ─── Convenience constants ────────────────────────────────────────────────────

DEFAULT_XAI_MODEL = XAIClient._DEFAULT_MODEL
DEFAULT_DEEPSEEK_MODEL = DeepSeekClient._DEFAULT_MODEL
