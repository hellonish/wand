"""
Authentication Router - Google OAuth + User Settings
"""

import logging
import os
import uuid
from urllib.parse import urlencode
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from starlette.config import Config

_log = logging.getLogger(__name__)

from ..database import get_db
from ..auth import oauth, create_access_token, get_or_create_user, get_current_user
from ..schemas import TokenResponse, UserResponse, UserUpdate
from ..models import User
from ..limiter import limiter
from ..tracking import track
from .. import storage

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_AVATAR_SIZE = 5 * 1024 * 1024  # 5 MB

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def _clear_google_oauth_state(request: Request) -> None:
    """Remove stale Authlib state entries before starting a new OAuth flow."""
    for key in list(request.session.keys()):
        if key.startswith("_state_google_"):
            request.session.pop(key, None)


@router.get("/google")
@limiter.limit("5/minute", override_defaults=False)
async def google_login(request: Request):
    """Redirect to Google OAuth."""
    _clear_google_oauth_state(request)
    backend_url = os.getenv("BACKEND_URL", "http://localhost:8000")
    redirect_uri = f"{backend_url}/api/auth/google/callback"
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/google/callback")
@limiter.limit("10/minute", override_defaults=False)
async def google_callback(request: Request, db: Session = Depends(get_db)):
    """Handle Google OAuth callback."""
    try:
        token = await oauth.google.authorize_access_token(request)
        user_info = token.get('userinfo')
        
        if not user_info:
            raise HTTPException(status_code=400, detail="Failed to get user info")
        
        # Get or create user
        user = get_or_create_user(
            db=db,
            email=user_info['email'],
            name=user_info.get('name', user_info['email']),
            picture=user_info.get('picture')
        )
        
        # Track login
        track(db, user_id=str(user.id), event="login", meta={"email": user_info.get("email")})

        # Create JWT token
        access_token = create_access_token({"sub": str(user.id)})

        # Deliver token via httpOnly cookie — never put it in the URL (leaks to
        # logs, browser history, and Referer headers).
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        response = RedirectResponse(
            url=f"{frontend_url}/auth/callback?auth_via=cookie",
            status_code=302,
        )
        response.set_cookie(
            key="auth_token",
            value=access_token,
            httponly=True,
            secure=True,          # only sent over HTTPS
            samesite="lax",       # CSRF protection; allows top-level GET redirects
            max_age=7 * 24 * 3600,  # 7 days — matches ACCESS_TOKEN_EXPIRE_DAYS
            path="/",
        )
        return response

    except Exception as e:
        # Log internally; never expose raw exception text to the client.
        _log.error("OAuth callback error: %s", e, exc_info=True)
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        return RedirectResponse(
            url=f"{frontend_url}/auth/callback?{urlencode({'error': 'auth_failed'})}"
        )


@router.get("/token")
async def get_token_from_cookie(
    auth_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
):
    """Exchange the httpOnly auth cookie for a JSON token response.

    Called by the frontend on load when ?auth_via=cookie is present in the URL,
    to retrieve the token for use in Authorization headers. The cookie is
    httpOnly so JavaScript cannot read it directly.
    """
    if not auth_token:
        raise HTTPException(status_code=401, detail="No auth cookie")

    from ..auth import verify_token
    payload = verify_token(auth_token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == user_id, User.is_deleted == False).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return {"token": auth_token}


def _build_user_response(user: User, db: Session) -> UserResponse:
    from ..models import ProfileFile
    has_profile = (
        db.query(ProfileFile).filter(ProfileFile.user_id == user.id).first() is not None
        or (user.profile is not None and user.profile.unified_profile is not None)
    )
    response = UserResponse.model_validate(user)
    response.has_profile = has_profile
    response.onboarding_completed = bool(user.onboarding_completed)
    return response


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Get current user info."""
    return _build_user_response(current_user, db)


@router.post("/complete-onboarding", response_model=UserResponse)
async def complete_onboarding(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark onboarding as completed for this user."""
    current_user.onboarding_completed = True
    db.commit()
    db.refresh(current_user)
    return _build_user_response(current_user, db)


@router.post("/logout")
async def logout():
    """Logout - client should discard token."""
    return {"message": "Logged out successfully"}


# User profile routes
@router.get("/profile", response_model=UserResponse)
async def get_profile(current_user: User = Depends(get_current_user)):
    """Get user profile."""
    return current_user


@router.patch("/profile", response_model=UserResponse)
async def update_profile(
    update: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update user profile."""
    if update.name:
        current_user.name = update.name
    if update.profile_picture:
        current_user.profile_picture = update.profile_picture
    
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/avatar", response_model=UserResponse)
@limiter.limit("10/minute", override_defaults=False)
async def upload_avatar(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload or replace the user's profile picture."""
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, WebP, or GIF images are allowed.")

    contents = await file.read()
    if len(contents) > MAX_AVATAR_SIZE:
        raise HTTPException(status_code=400, detail="Image must be under 5 MB.")

    # Delete old Supabase avatar if present
    if current_user.profile_picture and "/object/public/avatars/" in current_user.profile_picture:
        storage.delete_avatar(current_user.profile_picture)

    ext = os.path.splitext(file.filename or "avatar")[1] or ".jpg"
    storage_path = f"{current_user.id}_{uuid.uuid4().hex[:8]}{ext}"
    public_url = storage.upload_avatar(storage_path, contents, file.content_type or "image/jpeg")

    current_user.profile_picture = public_url
    db.commit()
    db.refresh(current_user)
    return _build_user_response(current_user, db)


@router.delete("/avatar", response_model=UserResponse)
async def delete_avatar(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove the user's profile picture."""
    if current_user.profile_picture and "/object/public/avatars/" in current_user.profile_picture:
        storage.delete_avatar(current_user.profile_picture)

    current_user.profile_picture = None
    db.commit()
    db.refresh(current_user)
    return _build_user_response(current_user, db)

