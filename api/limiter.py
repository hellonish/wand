import ipaddress
import os
import threading
import time
from collections import defaultdict
from typing import Dict, List

from slowapi import Limiter
from slowapi.util import get_remote_address
from fastapi import Request


def _real_ip(request: Request) -> str:
    """Return the verified client IP from the reverse-proxy-set X-Real-IP header.

    We do NOT read CF-Connecting-IP or the left-most X-Forwarded-For entry —
    both are attacker-controlled and can be used to bypass rate limiting by
    rotating a fake IP on every request.

    nginx sets 'X-Real-IP $remote_addr' (the actual socket peer), so this
    value is always trustworthy. If X-Real-IP is absent (direct connection /
    tests), fall back to the ASGI remote address.
    """
    xri = request.headers.get("X-Real-IP", "").strip()
    if xri:
        return xri
    return get_remote_address(request)


# ---------------------------------------------------------------------------
# Rate limits
# ---------------------------------------------------------------------------
# Global per-IP limits, ";"-separated, overridable via the RATE_LIMITS env var.
# These apply to every route:
#   * undecorated routes      -> enforced by SlowAPIMiddleware
#   * @limiter.limit() routes -> enforced via override_defaults=False on the
#     decorator, which stacks these on top of the route's per-minute burst limit
# Daily cap is intentionally strict (500/day); hourly prevents burning the whole
# daily budget in a few minutes.
_DEFAULT_LIMITS = [
    chunk.strip()
    for chunk in os.getenv("RATE_LIMITS", "100/minute;150/hour;500/day").split(";")
    if chunk.strip()
]

limiter = Limiter(key_func=_real_ip, default_limits=_DEFAULT_LIMITS)


# ---------------------------------------------------------------------------
# IP blocking
# ---------------------------------------------------------------------------
# Two layers:
#   1. A static blocklist from the BLOCKED_IPS env var (comma-separated, accepts
#      individual IPs and CIDR ranges, e.g. "1.2.3.4,10.0.0.0/8").
#   2. Automatic, temporary blocks for IPs that repeatedly trip the rate limiter
#      (record_violation() is called from the 429 handler in main.py).
#
# State is in-process, matching slowapi's default in-memory storage. For a
# multi-worker / multi-host deployment, back both with Redis.

def _parse_networks(raw: str) -> List[ipaddress._BaseNetwork]:
    nets: List[ipaddress._BaseNetwork] = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            nets.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            # Ignore malformed entries rather than crash startup.
            pass
    return nets


_manual_blocklist: List[ipaddress._BaseNetwork] = _parse_networks(
    os.getenv("BLOCKED_IPS", "")
)

# Auto-block tunables (all overridable via env).
_VIOLATION_WINDOW = int(os.getenv("BLOCK_VIOLATION_WINDOW", "600"))      # 10 min
_VIOLATION_THRESHOLD = int(os.getenv("BLOCK_VIOLATION_THRESHOLD", "5"))
_BLOCK_DURATION = int(os.getenv("BLOCK_DURATION", "3600"))               # 1 hour

_lock = threading.Lock()
_auto_blocked: Dict[str, float] = {}            # ip -> unix ts when block expires
_violations: Dict[str, List[float]] = defaultdict(list)  # ip -> recent violation ts


def _in_manual_blocklist(ip: str) -> bool:
    if not _manual_blocklist:
        return False
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in _manual_blocklist)


def is_blocked(ip: str) -> bool:
    """True if the IP is statically blocklisted or currently auto-blocked."""
    if _in_manual_blocklist(ip):
        return True
    with _lock:
        expiry = _auto_blocked.get(ip)
        if expiry is None:
            return False
        if expiry <= time.time():
            _auto_blocked.pop(ip, None)
            _violations.pop(ip, None)
            return False
        return True


def block_ip(ip: str, duration: int = None) -> None:
    """Manually place an IP in the temporary auto-block list."""
    with _lock:
        _auto_blocked[ip] = time.time() + (duration or _BLOCK_DURATION)


def unblock_ip(ip: str) -> None:
    """Clear any temporary auto-block for an IP (does not affect BLOCKED_IPS)."""
    with _lock:
        _auto_blocked.pop(ip, None)
        _violations.pop(ip, None)


def record_violation(ip: str) -> bool:
    """Record a rate-limit violation for an IP.

    Returns True if this violation pushed the IP over the threshold and it was
    auto-blocked as a result.
    """
    now = time.time()
    with _lock:
        recent = [t for t in _violations[ip] if now - t < _VIOLATION_WINDOW]
        recent.append(now)
        _violations[ip] = recent
        if len(recent) >= _VIOLATION_THRESHOLD:
            _auto_blocked[ip] = now + _BLOCK_DURATION
            _violations.pop(ip, None)
            return True
    return False
