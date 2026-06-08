"""
Wand API - FastAPI Backend
"""

import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from dotenv import load_dotenv

load_dotenv()

from .routers import auth, jobs, cover_letters, news, ws, profile, analytics
from .routers import llm_settings as llm_settings_router
from .database import engine, Base, ensure_sqlite_schema
from .limiter import limiter, is_blocked, record_violation, _real_ip
from .config import settings
from . import models  # Import models to register them

# Create all tables
Base.metadata.create_all(bind=engine)
ensure_sqlite_schema(engine)

app = FastAPI(
    title="Wand API",
    description="Resume analysis and job tracking platform",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

# Rate limiting (slowapi). The decorators on individual routes do nothing
# unless the limiter is registered on the app here.
app.state.limiter = limiter


# NOTE: must be sync, not async. SlowAPIMiddleware's sync_check_limits() silently
# falls back to slowapi's default handler for coroutine handlers, which would skip
# record_violation() (and thus auto-blocking) on undecorated routes.
@app.exception_handler(RateLimitExceeded)
def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    """Return 429 on rate-limit hits and auto-block IPs that repeatedly trip it."""
    ip = _real_ip(request)
    blocked = record_violation(ip)
    if blocked:
        return JSONResponse(
            status_code=403,
            content={"detail": "Your IP has been temporarily blocked due to repeated rate-limit violations."},
            headers={"Retry-After": "3600"},
        )
    return JSONResponse(
        status_code=429,
        content={"detail": f"Rate limit exceeded: {exc.detail}"},
        headers={"Retry-After": "60"},
    )


async def block_ip_middleware(request: Request, call_next):
    """Reject blocklisted / auto-blocked IPs before any route logic runs."""
    if is_blocked(_real_ip(request)):
        return JSONResponse(
            status_code=403,
            content={"detail": "Forbidden: your IP address is blocked."},
        )
    return await call_next(request)


# Middleware runs outermost-first in reverse registration order, so the effective
# request path is: CORS -> IP block -> Session -> rate limiter -> route.
# The IP block sits outside SlowAPIMiddleware so blocked IPs get a clean 403
# without consuming limiter buckets.
#
# SlowAPIMiddleware applies the global default limits (hour/day) to undecorated
# routes; decorated routes stack them via @limiter.limit(..., override_defaults=False).
app.add_middleware(SlowAPIMiddleware)

# Session middleware for OAuth
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.JWT_SECRET_KEY,
)

app.add_middleware(BaseHTTPMiddleware, dispatch=block_ip_middleware)

# CORS — set ALLOWED_ORIGINS in env, comma-separated. No wildcard fallback.
_raw_origins = os.getenv("ALLOWED_ORIGINS", "")
_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
if not _origins:
    raise RuntimeError("ALLOWED_ORIGINS env var is not set — refusing to start with open CORS")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)


class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security response headers to every response."""
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        # API serves no HTML, so a tight CSP is safe here.
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        return response


app.add_middleware(_SecurityHeadersMiddleware)

# Include routers
app.include_router(auth.router)
app.include_router(jobs.router)
app.include_router(cover_letters.router)
app.include_router(news.router)
app.include_router(ws.router)
app.include_router(profile.router)
app.include_router(llm_settings_router.router)
app.include_router(analytics.router)


# Health check
@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
async def root():
    return {"message": "Wand API"}
