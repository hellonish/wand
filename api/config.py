"""Central settings — fail-fast on missing/weak secrets.

Every module that needs a secret or configured value should import from here
instead of calling os.getenv() directly. The Settings object raises ValueError
at import time (i.e. before the server starts accepting traffic) if any
required value is absent or matches a known-weak default.
"""
from __future__ import annotations
import os

_WEAK_SECRETS = {
    "",
    "change-me-in-production",
    "your-secret-key-change-in-production",
    "secret",
    "changeme",
}


class Settings:
    def __init__(self) -> None:
        self.JWT_SECRET_KEY: str = self._require("JWT_SECRET_KEY", min_len=32)
        self.APP_ENCRYPTION_KEY: str = self._require("APP_ENCRYPTION_KEY", min_len=32)
        self.FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000")
        self.BACKEND_URL: str = os.getenv("BACKEND_URL", "http://localhost:8000")
        self.ALLOWED_ORIGINS: list[str] = self._origins()
        self.BYOK_REQUIRED: bool = os.getenv("BYOK_REQUIRED", "true").lower() == "true"

    @staticmethod
    def _require(name: str, min_len: int = 1) -> str:
        val = os.getenv(name, "").strip()
        if not val or val in _WEAK_SECRETS or len(val) < min_len:
            raise ValueError(
                f"[config] {name} is missing, weak, or too short (min {min_len} chars). "
                "Set a strong value in your environment before starting the server."
            )
        return val

    @staticmethod
    def _origins() -> list[str]:
        raw = os.getenv("ALLOWED_ORIGINS", "").strip()
        if not raw or raw == "*":
            raise ValueError(
                "[config] ALLOWED_ORIGINS must be set to an explicit comma-separated list of "
                "allowed origins — '*' is not permitted in production."
            )
        return [o.strip() for o in raw.split(",") if o.strip()]


settings = Settings()
