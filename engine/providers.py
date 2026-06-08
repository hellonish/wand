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
import logging
import os
import random
import re
import sys
import time
from typing import Any, Dict, List, Optional, Type

import instructor
import openai
import requests
from dotenv import load_dotenv
from openai import OpenAI

from engine.usage import Usage, UsageCollector

_log = logging.getLogger(__name__)
_MAX_INPUT_CHARS = int(os.getenv("LLM_MAX_INPUT_CHARS", 400_000))


# ─── Debug capture ────────────────────────────────────────────────────────────

def _debug_capture(step: str, messages: List[Dict], raw_response: Any) -> None:
    log_path = os.getenv("LLM_DEBUG_LOG", "llm_debug.jsonl")
    entry = {"step": step, "ts": time.time(), "messages": messages, "response": raw_response}
    try:
        with open(log_path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, default=str) + "\n")
    except Exception as exc:
        print(f"[LLM_DEBUG_CAPTURE] write failed: {exc}", file=sys.stderr)


# ─── Shared helpers ───────────────────────────────────────────────────────────

def _truncate_if_needed(
    messages: List[Dict[str, str]],
    max_chars: int,
) -> List[Dict[str, str]]:
    total = sum(len(m.get("content", "")) for m in messages)
    if total <= max_chars:
        return messages
    budget = max_chars - (total - max(len(m.get("content", "")) for m in messages))
    messages = list(messages)
    longest_idx = max(range(len(messages)), key=lambda i: len(messages[i].get("content", "")))
    original = messages[longest_idx]["content"]
    suffix = "\n[... truncated to fit context limit]"
    truncated = original[: budget - len(suffix)] + suffix
    messages[longest_idx] = {**messages[longest_idx], "content": truncated}
    _log.warning(
        "Input truncated from %d to %d chars (longest message shortened by %d chars)",
        total,
        sum(len(m.get("content", "")) for m in messages),
        len(original) - len(truncated),
    )
    return messages


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


# Strips description/title only. Enum values, min/max constraints, required, and additionalProperties are preserved intentionally.
def _strip_schema_verbose_keys(schema: Any, top_level: bool = True) -> Any:
    """Recursively remove description and nested title keys to slim token usage."""
    if isinstance(schema, dict):
        result = {}
        for k, v in schema.items():
            if k == "description":
                continue
            if k == "title" and not top_level:
                continue
            result[k] = _strip_schema_verbose_keys(v, top_level=False)
        return result
    if isinstance(schema, list):
        return [_strip_schema_verbose_keys(item, top_level=False) for item in schema]
    return schema


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

    for msg in messages:
        if msg.get("role") == "system" and model_title and model_title in msg.get("content", ""):
            return messages

    slimmed_schema = _strip_schema_verbose_keys(model_schema, top_level=True)
    schema = json.dumps(slimmed_schema, indent=2)
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
    messages.insert(0, {"role": "system", "content": "Respond with JSON." + schema_block})
    return messages


def _is_transient_error(exc: BaseException) -> bool:
    """Return True for errors that are safe to retry (rate limits, 5xx, timeouts)."""
    if isinstance(exc, (openai.RateLimitError, openai.InternalServerError, openai.APITimeoutError)):
        return True
    if isinstance(exc, openai.APIStatusError) and exc.status_code >= 500:
        return True
    if isinstance(exc, requests.exceptions.Timeout):
        return True
    return False


def _retry_call(fn, max_attempts: int = 3):
    """Call fn() with exponential backoff on transient errors.

    Delays: 1s, 2s, 4s with ±20% jitter. Non-transient errors are re-raised
    immediately without consuming remaining attempts.
    """
    last_exc: Optional[BaseException] = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except BaseException as exc:
            if not _is_transient_error(exc):
                raise
            last_exc = exc
            if attempt < max_attempts - 1:
                base_delay = 2 ** attempt
                jitter = base_delay * 0.2 * (random.random() * 2 - 1)
                time.sleep(base_delay + jitter)
    raise last_exc


# ─── XAI (Grok) — instructor path ────────────────────────────────────────────

class XAIClient:
    """X.AI (Grok) structured-output client via instructor."""

    _BASE_URL = "https://api.x.ai/v1"
    _API_KEY_ENV = "XAI_API_KEY"
    _MODEL_ENV = "XAI_MODEL"
    _DEFAULT_MODEL = "grok-3"
    _DEFAULT_MAX_TOKENS = 24000
    max_output_tokens = 32768
    injects_schema_natively = False

    def __init__(self, model: Optional[str] = None, api_key: Optional[str] = None):
        load_dotenv()
        key = api_key or os.getenv(self._API_KEY_ENV)
        if not key:
            raise ValueError(f"{self._API_KEY_ENV} is required in .env or the environment.")
        self.model = model or os.getenv(self._MODEL_ENV) or self._DEFAULT_MODEL
        self._client = instructor.from_openai(
            OpenAI(base_url=self._BASE_URL, api_key=key, timeout=120.0),
            mode=instructor.Mode.XAI_JSON,
        )
        self.collector: Optional[UsageCollector] = None

    def complete(
        self,
        response_model: Type[Any],
        messages: List[Dict[str, str]],
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        max_retries: int = 2,
        step: str = "",
    ) -> Any:
        messages = _truncate_if_needed(messages, _MAX_INPUT_CHARS)
        t0 = time.perf_counter()

        def _call():
            return self._client.chat.completions.create_with_completion(
                model=self.model,
                response_model=response_model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens or self._DEFAULT_MAX_TOKENS,
                max_retries=max_retries,
                strict=False,
            )

        result, raw_completion = _retry_call(_call)
        duration_ms = (time.perf_counter() - t0) * 1000

        if self.collector is not None:
            usage_data = getattr(raw_completion, "usage", None)
            in_tok = getattr(usage_data, "prompt_tokens", 0) or 0
            out_tok = getattr(usage_data, "completion_tokens", 0) or 0
            u = Usage(input_tokens=in_tok, output_tokens=out_tok, provider="grok", model=self.model)
            self.collector.add(u)
            if step:
                self.collector.record_step(step, duration_ms, u)

        if os.getenv("LLM_DEBUG_CAPTURE"):
            try:
                raw_dict = raw_completion.model_dump() if hasattr(raw_completion, "model_dump") else str(raw_completion)
            except Exception:
                raw_dict = str(raw_completion)
            _debug_capture(step, messages, raw_dict)

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

    Note: _inject_response_schema() manually appends the JSON schema to the
    system prompt since DeepSeek has no native constrained decoding.
    """

    _BASE_URL = "https://api.deepseek.com"
    _API_KEY_ENV = "DEEPSEEK_API_KEY"
    _MODEL_ENV = "DEEPSEEK_MODEL"
    _DEFAULT_MODEL = "deepseek-chat"
    _DEFAULT_MAX_TOKENS = 4096
    _MAX_OUTPUT_TOKENS = 8192
    max_output_tokens = 8192
    injects_schema_natively = False

    def __init__(self, model: Optional[str] = None, api_key: Optional[str] = None):
        load_dotenv()
        key = api_key or os.getenv(self._API_KEY_ENV)
        if not key:
            raise ValueError(f"{self._API_KEY_ENV} is required in .env or the environment.")
        self.model = model or os.getenv(self._MODEL_ENV) or self._DEFAULT_MODEL
        self._client = OpenAI(base_url=self._BASE_URL, api_key=key, timeout=120.0)
        self.collector: Optional[UsageCollector] = None

    def complete(
        self,
        response_model: Type[Any],
        messages: List[Dict[str, str]],
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        max_retries: int = 0,
        step: str = "",
    ) -> Any:
        messages = _truncate_if_needed(messages, _MAX_INPUT_CHARS)
        messages = _inject_response_schema(messages, response_model)
        messages = _ensure_json_word(messages)
        max_tok = min(max_tokens or self._DEFAULT_MAX_TOKENS, self._MAX_OUTPUT_TOKENS)

        t0 = time.perf_counter()

        def _call():
            return self._client.chat.completions.create(
                model=self.model,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=temperature,
                max_tokens=max_tok,
            )

        response = _retry_call(_call)
        duration_ms = (time.perf_counter() - t0) * 1000
        content = response.choices[0].message.content or ""

        if self.collector is not None:
            usage_data = getattr(response, "usage", None)
            in_tok = getattr(usage_data, "prompt_tokens", 0) or 0
            out_tok = getattr(usage_data, "completion_tokens", 0) or 0
            u = Usage(input_tokens=in_tok, output_tokens=out_tok, provider="deepseek", model=self.model)
            self.collector.add(u)
            if step:
                self.collector.record_step(step, duration_ms, u)

        if os.getenv("LLM_DEBUG_CAPTURE"):
            _debug_capture(step, messages, content)

        content = _extract_json(content)
        try:
            return response_model.model_validate_json(content)
        except Exception as validation_err:
            # One repair attempt: feed the error back to the model and ask it to fix its output.
            _log.warning("DeepSeek validation error for step=%r — attempting repair: %s", step, validation_err)
            repair_messages = list(messages) + [
                {"role": "assistant", "content": content},
                {
                    "role": "user",
                    "content": (
                        f"Your response failed schema validation with this error:\n{validation_err}\n\n"
                        "Fix the JSON so it exactly matches the required schema and return only the corrected JSON."
                    ),
                },
            ]
            repair_response = _retry_call(
                lambda: self._client.chat.completions.create(
                    model=self.model,
                    messages=repair_messages,
                    response_format={"type": "json_object"},
                    temperature=0.0,
                    max_tokens=max_tok,
                )
            )
            repair_content = _extract_json(repair_response.choices[0].message.content or "")
            return response_model.model_validate_json(repair_content)


class GeminiClient:
    """Google Gemini structured-output client via instructor (OpenAI-compat path)."""

    _BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
    _API_KEY_ENV = "GEMINI_API_KEY"
    _DEFAULT_MODEL = "gemini-2.5-flash"
    _DEFAULT_MAX_TOKENS = 8192
    max_output_tokens = 8192
    injects_schema_natively = False

    def __init__(self, model: Optional[str] = None, api_key: Optional[str] = None):
        load_dotenv()
        key = api_key or os.getenv(self._API_KEY_ENV)
        if not key:
            raise ValueError(f"{self._API_KEY_ENV} is required in .env or the environment.")
        self.model = model or self._DEFAULT_MODEL
        self._client = instructor.from_openai(
            OpenAI(base_url=self._BASE_URL, api_key=key, timeout=120.0),
            mode=instructor.Mode.GEMINI_JSON,
        )
        self.collector: Optional[UsageCollector] = None

    def complete(
        self,
        response_model: Type[Any],
        messages: List[Dict[str, str]],
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        max_retries: int = 2,
        step: str = "",
    ) -> Any:
        t0 = time.perf_counter()

        def _call():
            return self._client.chat.completions.create_with_completion(
                model=self.model,
                response_model=response_model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens or self._DEFAULT_MAX_TOKENS,
                max_retries=max_retries,
                strict=False,
            )

        result, raw_completion = _retry_call(_call)
        duration_ms = (time.perf_counter() - t0) * 1000

        if self.collector is not None:
            usage_data = getattr(raw_completion, "usage", None)
            in_tok = getattr(usage_data, "prompt_tokens", 0) or 0
            out_tok = getattr(usage_data, "completion_tokens", 0) or 0
            u = Usage(input_tokens=in_tok, output_tokens=out_tok, provider="gemini", model=self.model)
            self.collector.add(u)
            if step:
                self.collector.record_step(step, duration_ms, u)

        return result


# ─── OpenAI — instructor path ─────────────────────────────────────────────────

class OpenAIClient:
    """OpenAI structured-output client via instructor."""

    _API_KEY_ENV = "OPENAI_API_KEY"
    _DEFAULT_MODEL = "gpt-4o-mini"
    _DEFAULT_MAX_TOKENS = 8192
    max_output_tokens = 16384
    injects_schema_natively = True

    def __init__(self, model: Optional[str] = None, api_key: Optional[str] = None):
        load_dotenv()
        key = api_key or os.getenv(self._API_KEY_ENV)
        if not key:
            raise ValueError(f"{self._API_KEY_ENV} is required in .env or the environment.")
        self.model = model or self._DEFAULT_MODEL
        self._client_schema = instructor.from_openai(
            OpenAI(api_key=key, timeout=120.0),
            mode=instructor.Mode.JSON_SCHEMA,
        )
        self._client_o1 = instructor.from_openai(
            OpenAI(api_key=key, timeout=120.0),
            mode=instructor.Mode.JSON_O1,
        )
        self.collector: Optional[UsageCollector] = None

    def complete(
        self,
        response_model: Type[Any],
        messages: List[Dict[str, str]],
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        max_retries: int = 2,
        step: str = "",
    ) -> Any:
        t0 = time.perf_counter()

        _O1_MODELS = {"o1", "o1-mini", "o1-preview", "o3", "o3-mini"}
        client = self._client_o1 if self.model in _O1_MODELS else self._client_schema

        def _call():
            return client.chat.completions.create_with_completion(
                model=self.model,
                response_model=response_model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens or self._DEFAULT_MAX_TOKENS,
                max_retries=max_retries,
                strict=False,
            )

        result, raw_completion = _retry_call(_call)
        duration_ms = (time.perf_counter() - t0) * 1000

        if self.collector is not None:
            usage_data = getattr(raw_completion, "usage", None)
            in_tok = getattr(usage_data, "prompt_tokens", 0) or 0
            out_tok = getattr(usage_data, "completion_tokens", 0) or 0
            u = Usage(input_tokens=in_tok, output_tokens=out_tok, provider="openai", model=self.model)
            self.collector.add(u)
            if step:
                self.collector.record_step(step, duration_ms, u)

        return result


# ─── Anthropic — instructor via anthropic SDK ─────────────────────────────────

class AnthropicClient:
    """Anthropic (Claude) structured-output client via instructor."""

    _API_KEY_ENV = "ANTHROPIC_API_KEY"
    _DEFAULT_MODEL = "claude-haiku-4-5"
    _DEFAULT_MAX_TOKENS = 8192
    max_output_tokens = 8192
    injects_schema_natively = True

    def __init__(self, model: Optional[str] = None, api_key: Optional[str] = None):
        load_dotenv()
        key = api_key or os.getenv(self._API_KEY_ENV)
        if not key:
            raise ValueError(f"{self._API_KEY_ENV} is required in .env or the environment.")
        self.model = model or self._DEFAULT_MODEL
        self._client = instructor.from_anthropic(anthropic.Anthropic(api_key=key))
        self.collector: Optional[UsageCollector] = None

    def complete(
        self,
        response_model: Type[Any],
        messages: List[Dict[str, str]],
        temperature: float = 0.0,
        max_tokens: Optional[int] = None,
        max_retries: int = 2,
        step: str = "",
    ) -> Any:
        t0 = time.perf_counter()

        def _call():
            return self._client.messages.create_with_completion(
                model=self.model,
                response_model=response_model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens or self._DEFAULT_MAX_TOKENS,
                max_retries=max_retries,
                strict=True,
            )

        result, raw = _retry_call(_call)
        duration_ms = (time.perf_counter() - t0) * 1000

        if self.collector is not None:
            usage_data = getattr(raw, "usage", None)
            in_tok = getattr(usage_data, "input_tokens", 0) or 0
            out_tok = getattr(usage_data, "output_tokens", 0) or 0
            u = Usage(input_tokens=in_tok, output_tokens=out_tok, provider="anthropic", model=self.model)
            self.collector.add(u)
            if step:
                self.collector.record_step(step, duration_ms, u)

        return result


# ─── Convenience constants ────────────────────────────────────────────────────

DEFAULT_XAI_MODEL = XAIClient._DEFAULT_MODEL
DEFAULT_DEEPSEEK_MODEL = DeepSeekClient._DEFAULT_MODEL
DEFAULT_GEMINI_MODEL = GeminiClient._DEFAULT_MODEL
DEFAULT_OPENAI_MODEL = OpenAIClient._DEFAULT_MODEL
DEFAULT_ANTHROPIC_MODEL = AnthropicClient._DEFAULT_MODEL
