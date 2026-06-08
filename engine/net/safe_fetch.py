"""Safe outbound HTTP fetch — SSRF protection layer.

All server-side fetches of user-supplied or derived URLs MUST go through
safe_get(). Direct use of requests.get() on untrusted external URLs is
forbidden elsewhere in the engine.

Protection model
----------------
1. Scheme allowlist: only http and https are permitted.
2. DNS resolution: ALL A/AAAA records for the hostname are resolved.
   If ANY resolved IP is private, loopback, link-local, reserved,
   multicast, or unspecified, the URL is rejected.
3. Redirect following: automatic redirects are disabled. Up to 3 hops
   are followed manually, re-validating the destination at each hop.
   This prevents the common "redirect to internal host" bypass.

DNS-rebinding note
------------------
Validation time vs. connect time are different moments; a hostile DNS
server can return a public IP at validation and a private IP at connect.
For full protection, add network-layer egress filtering (firewall rule
blocking RFC1918/loopback at the host/container level) as a backstop.
"""
from __future__ import annotations

import ipaddress
import socket
from typing import Any
from urllib.parse import urlparse

import requests

_ALLOWED_SCHEMES = {"http", "https"}
_MAX_REDIRECTS = 3
_DEFAULT_TIMEOUT = 10


class SSRFError(ValueError):
    """Raised when a URL is rejected by the SSRF protection layer."""


def _assert_public_host(hostname: str) -> None:
    """Resolve hostname; raise SSRFError if any resolved IP is non-public."""
    if not hostname:
        raise SSRFError("Empty hostname")
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise SSRFError("DNS resolution failed for host") from exc

    if not infos:
        raise SSRFError("No DNS records found for host")

    for _family, _type, _proto, _canonname, sockaddr in infos:
        raw_ip = sockaddr[0]
        try:
            ip = ipaddress.ip_address(raw_ip)
        except ValueError:
            raise SSRFError("Could not parse resolved IP address")
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise SSRFError(
                "URL resolves to a non-public address and cannot be fetched by the server"
            )


def assert_safe_url(url: str) -> str:
    """Validate URL scheme and hostname. Raises SSRFError on rejection."""
    parsed = urlparse(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise SSRFError(f"URL scheme '{parsed.scheme}' is not allowed (only http/https)")
    if not parsed.hostname:
        raise SSRFError("URL has no hostname")
    _assert_public_host(parsed.hostname)
    return url


def safe_get(url: str, *, timeout: int = _DEFAULT_TIMEOUT, **kwargs: Any) -> requests.Response:
    """Fetch url with SSRF protection.

    Drop-in replacement for requests.get() for use with user-supplied or
    derived URLs. Validates scheme and resolved IPs before connecting, then
    manually follows up to 3 redirects re-validating each hop.

    Raises SSRFError if the URL (or any redirect destination) is rejected.
    Raises requests.RequestException on network errors (same as requests.get).
    """
    assert_safe_url(url)

    # Disable automatic redirect following so we can validate every hop.
    kwargs["allow_redirects"] = False
    kwargs["timeout"] = timeout

    resp = requests.get(url, **kwargs)

    hops = 0
    while resp.is_redirect and hops < _MAX_REDIRECTS:
        location = resp.headers.get("Location", "")
        if not location:
            break
        # Resolve relative redirects against the current base URL.
        next_url = requests.compat.urljoin(url, location)
        assert_safe_url(next_url)  # re-validate every hop
        url = next_url
        resp = requests.get(
            url,
            allow_redirects=False,
            timeout=timeout,
            headers=kwargs.get("headers"),
        )
        hops += 1

    return resp
