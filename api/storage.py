"""
Storage backend — Supabase in production, local filesystem in development.

Local mode activates automatically when SUPABASE_URL / SUPABASE_SERVICE_KEY
are absent. Files are read/written under LOCAL_STORAGE_ROOT (project root by
default), so DB paths like "api/uploads/<user>/<file>" resolve to
<project_root>/api/uploads/<user>/<file>.

Buckets expected in the Supabase project:
  - avatars      (public)   — profile pictures
  - wand-uploads (private)  — resume / linkedin / portfolio files
"""

import os
from functools import lru_cache
from pathlib import Path
from storage3 import create_client as create_storage_client
from storage3.utils import StorageException

AVATAR_BUCKET = "avatars"
FILES_BUCKET = "wand-uploads"

# Root for local-mode file storage — project root so "api/uploads/..." resolves.
LOCAL_STORAGE_ROOT = Path(__file__).resolve().parent.parent


def _is_local() -> bool:
    return not (os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_KEY"))


@lru_cache(maxsize=1)
def _storage():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    headers = {
        "apiKey": key,
        "Authorization": f"Bearer {key}",
    }
    return create_storage_client(f"{url}/storage/v1", headers, is_async=False)


# ── Avatars (public bucket) ──────────────────────────────────────────────────

def upload_avatar(storage_path: str, data: bytes, content_type: str = "image/jpeg") -> str:
    """Upload avatar bytes, return the public URL."""
    if _is_local():
        dest = LOCAL_STORAGE_ROOT / storage_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return f"/local-avatar/{storage_path}"
    _storage().from_(AVATAR_BUCKET).upload(
        storage_path, data, {"content-type": content_type, "upsert": "true"}
    )
    return _storage().from_(AVATAR_BUCKET).get_public_url(storage_path)


def delete_avatar(public_url: str) -> None:
    """Delete avatar given its public URL."""
    if _is_local():
        marker = "/local-avatar/"
        if marker in public_url:
            path = public_url.split(marker, 1)[1]
            try:
                (LOCAL_STORAGE_ROOT / path).unlink(missing_ok=True)
            except OSError:
                pass
        return
    marker = f"/object/public/{AVATAR_BUCKET}/"
    if marker not in public_url:
        return
    storage_path = public_url.split(marker, 1)[1]
    try:
        _storage().from_(AVATAR_BUCKET).remove([storage_path])
    except StorageException:
        pass


# ── Profile files (private bucket) ──────────────────────────────────────────

def upload_file(storage_path: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    """Upload file bytes, return the storage path."""
    if _is_local():
        dest = LOCAL_STORAGE_ROOT / storage_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return storage_path
    _storage().from_(FILES_BUCKET).upload(
        storage_path, data, {"content-type": content_type, "upsert": "true"}
    )
    return storage_path


def get_signed_url(storage_path: str, expires_in: int = 3600) -> str:
    """Return a signed download URL (local: a direct /api/profile/serve path)."""
    if _is_local():
        return f"/api/profile/serve-local?path={storage_path}"
    result = _storage().from_(FILES_BUCKET).create_signed_url(storage_path, expires_in)
    return result["signedURL"]


def download_file(storage_path: str) -> bytes:
    """Download a private file by its storage path and return raw bytes."""
    if _is_local():
        local_path = LOCAL_STORAGE_ROOT / storage_path
        if not local_path.exists():
            raise FileNotFoundError(f"Local file not found: {local_path}")
        return local_path.read_bytes()
    return _storage().from_(FILES_BUCKET).download(storage_path)


def delete_file(storage_path: str) -> None:
    """Delete a private file by its storage path."""
    if not storage_path:
        return
    if _is_local():
        try:
            (LOCAL_STORAGE_ROOT / storage_path).unlink(missing_ok=True)
        except OSError:
            pass
        return
    try:
        _storage().from_(FILES_BUCKET).remove([storage_path])
    except StorageException:
        pass
