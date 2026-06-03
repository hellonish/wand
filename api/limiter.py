from slowapi import Limiter
from slowapi.util import get_remote_address
from fastapi import Request


def _real_ip(request: Request) -> str:
    return (
        request.headers.get("CF-Connecting-IP")
        or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or get_remote_address(request)
    )


limiter = Limiter(key_func=_real_ip, default_limits=["100/minute"])
