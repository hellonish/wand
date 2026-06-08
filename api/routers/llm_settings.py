"""LLM Settings router — BYOK key management and per-task config endpoints."""

from __future__ import annotations

import logging
import os
from typing import Optional

from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import User, UsageEvent, UserLLMKey, UserLLMConfig
from engine.model_registry import (
    PROVIDER_LABELS,
    PROVIDERS,
    TASK_GROUPS,
    is_supported_model,
    models_for_providers,
    recommended_groups,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/llm", tags=["LLM Settings"])

VALID_PROVIDERS = set(PROVIDERS.keys())


# ── Encryption helpers ────────────────────────────────────────────────────────

def _fernet() -> Fernet:
    key = os.getenv("APP_ENCRYPTION_KEY")
    if not key:
        raise HTTPException(
            status_code=503,
            detail="Server is not configured for key storage. Set APP_ENCRYPTION_KEY in the server environment.",
        )
    return Fernet(key.encode())


def encrypt_key(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_key(ciphertext: str) -> str:
    return _fernet().decrypt(ciphertext.encode()).decode()


# ── Key validation ────────────────────────────────────────────────────────────

# Each provider's API keys have a recognizable prefix. We check the prefix to
# catch the common "pasted the wrong provider's key" mistake, but we DO NOT
# enforce length (lengths vary and change over time — a real auth failure will
# surface at inference time). Note: OpenAI and DeepSeek both use "sk-", so they
# cannot be told apart from each other by prefix alone.
_PROVIDER_KEY_RULES: dict[str, dict] = {
    "gemini":    {"prefixes": ("AIza",),    "label": "Google Gemini"},
    "xai":       {"prefixes": ("xai-",),    "label": "xAI (Grok)"},
    "anthropic": {"prefixes": ("sk-ant-",), "label": "Anthropic (Claude)"},
    "openai":    {"prefixes": ("sk-",),     "label": "OpenAI (ChatGPT)", "reject_prefixes": ("sk-ant-",)},
    "deepseek":  {"prefixes": ("sk-",),     "label": "DeepSeek",         "reject_prefixes": ("sk-ant-",)},
}


def _validate_provider_key(provider: str, api_key: str) -> tuple[bool, str]:
    """Validate that the key looks like it belongs to this provider.

    Checks the provider-specific prefix (catches cross-provider paste mistakes)
    without enforcing a length. A genuinely wrong key surfaces a clear auth
    error at inference time.
    """
    key = api_key.strip()
    if len(key) < 8:
        return False, "That key looks too short. Please paste the full API key."

    rule = _PROVIDER_KEY_RULES.get(provider)
    if not rule:
        return True, ""

    label = rule["label"]
    reject = rule.get("reject_prefixes", ())
    if reject and key.startswith(reject):
        return False, f"That doesn't look like a {label} key. Please check you pasted the right provider's key."

    prefixes = rule["prefixes"]
    if not key.startswith(prefixes):
        hint = " or ".join(f'"{p}"' for p in prefixes)
        return False, (
            f"That doesn't look like a {label} key — these usually start with {hint}. "
            "Please check you pasted the right provider's key."
        )

    return True, ""


# OpenAI-compatible providers expose a GET /models endpoint that authenticates
# the key without running any inference.
_OPENAI_COMPAT_BASE_URLS: dict[str, Optional[str]] = {
    "openai": None,  # default OpenAI base URL
    "deepseek": "https://api.deepseek.com",
    "xai": "https://api.x.ai/v1",
}


def _verify_key_live(provider: str, api_key: str) -> tuple[bool, str]:
    """Verify a key against the provider's list-models endpoint (no inference).

    Returns (ok, message):
      - (True,  "")   key authenticated, OR we couldn't reach the provider
                      (transient/network error — we never block on that).
      - (False, msg)  the provider explicitly REJECTED the key (401/403).

    This costs zero tokens — list-models only checks authentication.
    """
    label = PROVIDER_LABELS.get(provider, provider)
    rejected = (
        f"{label} rejected this key. Please double-check it's correct, "
        "active, and has the right permissions."
    )
    try:
        if provider == "gemini":
            import requests
            resp = requests.get(
                "https://generativelanguage.googleapis.com/v1beta/models",
                params={"key": api_key, "pageSize": 1},
                timeout=10,
            )
            if resp.status_code == 200:
                return True, ""
            if resp.status_code in (400, 401, 403):
                return False, rejected
            return True, ""  # 5xx / rate-limit / unknown — don't block

        if provider == "anthropic":
            import anthropic
            try:
                anthropic.Anthropic(api_key=api_key, timeout=10.0).models.list(limit=1)
                return True, ""
            except (anthropic.AuthenticationError, anthropic.PermissionDeniedError):
                return False, rejected
            except Exception:
                return True, ""  # transient — don't block

        # OpenAI-compatible: openai, deepseek, xai
        import openai
        from openai import OpenAI
        kwargs: dict = {"api_key": api_key, "timeout": 10.0}
        base = _OPENAI_COMPAT_BASE_URLS.get(provider)
        if base:
            kwargs["base_url"] = base
        try:
            OpenAI(**kwargs).models.list()
            return True, ""
        except (openai.AuthenticationError, openai.PermissionDeniedError):
            return False, rejected
        except Exception:
            return True, ""  # transient — don't block
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("Live key verification errored for %s: %s", provider, exc)
        return True, ""  # never block the user on our own failure


# ── Request/response models ───────────────────────────────────────────────────

class UpsertKeyRequest(BaseModel):
    api_key: str


class ProviderStatus(BaseModel):
    provider: str
    label: str
    configured: bool
    key_last4: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/providers")
async def list_providers(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ProviderStatus]:
    """List all 5 providers with their configured status for this user."""
    user_keys = {
        row.provider: row
        for row in db.query(UserLLMKey).filter(UserLLMKey.user_id == current_user.id).all()
    }
    return [
        ProviderStatus(
            provider=p,
            label=PROVIDER_LABELS.get(p, p),
            configured=p in user_keys,
            key_last4=user_keys[p].key_last4 if p in user_keys else None,
        )
        for p in VALID_PROVIDERS
    ]


@router.put("/keys/{provider}")
async def upsert_key(
    provider: str,
    body: UpsertKeyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Validate a provider API key then store it encrypted."""
    if provider not in VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    if not body.api_key or not body.api_key.strip():
        raise HTTPException(status_code=422, detail="API key cannot be empty.")

    api_key = body.api_key.strip()

    # 1. Fast prefix pre-filter — instant, no network. Catches the obvious
    #    "pasted the wrong provider's key" mistake with a clear message.
    valid, error_msg = _validate_provider_key(provider, api_key)
    if not valid:
        raise HTTPException(status_code=422, detail=error_msg)

    # 2. Live auth check against the provider's list-models endpoint (zero
    #    tokens, no inference). Rejects only on a confirmed auth failure; a
    #    transient/network error never blocks the save.
    verified, verify_msg = await run_in_threadpool(_verify_key_live, provider, api_key)
    if not verified:
        raise HTTPException(status_code=422, detail=verify_msg)

    encrypted = encrypt_key(api_key)
    last4 = api_key[-4:]

    existing = (
        db.query(UserLLMKey)
        .filter(UserLLMKey.user_id == current_user.id, UserLLMKey.provider == provider)
        .first()
    )
    if existing:
        existing.encrypted_key = encrypted
        existing.key_last4 = last4
    else:
        db.add(UserLLMKey(
            user_id=current_user.id,
            provider=provider,
            encrypted_key=encrypted,
            key_last4=last4,
        ))
    db.commit()
    return {"valid": True, "key_last4": last4}


@router.delete("/keys/{provider}")
async def delete_key(
    provider: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove a provider key."""
    if provider not in VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    row = (
        db.query(UserLLMKey)
        .filter(UserLLMKey.user_id == current_user.id, UserLLMKey.provider == provider)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Key not found")

    db.delete(row)
    db.commit()
    return {"ok": True}


def _build_config_response(db: Session, user_id: str) -> dict:
    """Assemble the full model-selection state for the AI Providers UI."""
    keys = db.query(UserLLMKey).filter(UserLLMKey.user_id == user_id).all()
    available_providers = {row.provider for row in keys}

    cfg_row = db.query(UserLLMConfig).filter(UserLLMConfig.user_id == user_id).first()
    saved = dict(cfg_row.group_models) if cfg_row and cfg_row.group_models else {}

    # Effective selection = saved (validated) overlaid on recommended defaults.
    defaults = recommended_groups(available_providers)
    selection: dict[str, dict[str, str]] = {}
    for group in TASK_GROUPS:
        gid = group["id"]
        s = saved.get(gid)
        if (
            s
            and s.get("provider") in available_providers
            and is_supported_model(s.get("provider", ""), s.get("model", ""))
        ):
            selection[gid] = {"provider": s["provider"], "model": s["model"]}
        elif gid in defaults:
            selection[gid] = defaults[gid]

    return {
        "groups": [{"id": g["id"], "label": g["label"]} for g in TASK_GROUPS],
        "selection": selection,
        "models_by_provider": models_for_providers(available_providers),
        "available_providers": list(available_providers),
        "has_any_key": len(available_providers) > 0,
    }


@router.get("/config")
async def get_config(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return model-selection groups, current selection, and the model catalogue."""
    return _build_config_response(db, current_user.id)


class SaveConfigRequest(BaseModel):
    # {group_id: {"provider": "...", "model": "..."}}
    selection: dict[str, dict[str, str]]


@router.put("/config")
async def save_config(
    body: SaveConfigRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Persist the user's per-group model selection."""
    keys = db.query(UserLLMKey).filter(UserLLMKey.user_id == current_user.id).all()
    available_providers = {row.provider for row in keys}
    valid_group_ids = {g["id"] for g in TASK_GROUPS}

    clean: dict[str, dict[str, str]] = {}
    for gid, sel in (body.selection or {}).items():
        if gid not in valid_group_ids:
            continue
        provider = (sel or {}).get("provider")
        model = (sel or {}).get("model")
        if provider not in available_providers:
            raise HTTPException(status_code=422, detail=f"No saved key for provider '{provider}'.")
        if not is_supported_model(provider, model):
            raise HTTPException(status_code=422, detail=f"Unsupported model '{model}' for {provider}.")
        clean[gid] = {"provider": provider, "model": model}

    cfg_row = db.query(UserLLMConfig).filter(UserLLMConfig.user_id == current_user.id).first()
    if cfg_row:
        cfg_row.group_models = clean
    else:
        db.add(UserLLMConfig(user_id=current_user.id, group_models=clean))
    db.commit()

    return _build_config_response(db, current_user.id)


@router.post("/recommended")
async def apply_recommended(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Reset selection to recommended defaults (clears any saved overrides)."""
    cfg_row = db.query(UserLLMConfig).filter(UserLLMConfig.user_id == current_user.id).first()
    if cfg_row:
        cfg_row.group_models = {}
        db.commit()
    return _build_config_response(db, current_user.id)


@router.get("/usage")
async def usage_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the authenticated user's last 50 UsageEvents."""
    events = (
        db.query(UsageEvent)
        .filter(UsageEvent.user_id == current_user.id)
        .order_by(UsageEvent.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "id": e.id,
            "task_type": e.task_type,
            "provider": e.provider,
            "model": e.model,
            "input_tokens": e.input_tokens,
            "output_tokens": e.output_tokens,
            "raw_cost_usd": e.raw_cost_usd,
            "credits_charged": e.credits_charged,
            "failed": e.failed,
            "created_at": e.created_at,
        }
        for e in events
    ]
