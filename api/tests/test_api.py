"""
API Test Suite - Comprehensive tests for all endpoints
Run with: pytest api/tests/ -v
"""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.responses import RedirectResponse
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from api.main import app


@pytest.fixture
def client():
    """Test client fixture."""
    return TestClient(app)


@pytest.fixture
def mock_user():
    """Mock authenticated user."""
    return MagicMock(
        id="test-user-id",
        email="test@example.com",
        name="Test User",
        profile_picture="https://example.com/pic.jpg"
    )


# ============================================================
# Health & Root Tests
# ============================================================

class TestHealth:
    """Test health and root endpoints."""
    
    def test_health(self, client):
        """Test health endpoint."""
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}
    
    def test_root(self, client):
        """Test root endpoint."""
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "docs" in data


# ============================================================
# News Tests (No Auth Required)
# ============================================================

class TestNews:
    """Test news endpoints - no authentication required."""
    
    def test_get_news_success(self, client):
        """Test fetching news for a company."""
        response = client.get("/api/news/Microsoft")
        assert response.status_code == 200
        data = response.json()
        assert "company_name" in data
        assert "articles" in data
        assert "total_results" in data
    
    def test_get_news_with_limit(self, client):
        """Test news with num_articles param."""
        response = client.get("/api/news/Google?num_articles=3")
        assert response.status_code == 200
        data = response.json()
        assert len(data["articles"]) <= 3


# ============================================================
# Auth Tests
# ============================================================

class TestAuth:
    """Test authentication endpoints."""
    
    def test_google_login_redirect(self, client):
        """Test Google OAuth redirect."""
        redirect = RedirectResponse("https://accounts.google.com/o/oauth2/v2/auth", status_code=302)
        with patch(
            "api.routers.auth.oauth.google.authorize_redirect",
            new=AsyncMock(return_value=redirect),
        ):
            response = client.get("/api/auth/google", follow_redirects=False)
        # Should redirect to Google
        assert response.status_code in [302, 307]
    
    def test_me_unauthorized(self, client):
        """Test /me without token."""
        response = client.get("/api/auth/me")
        assert response.status_code == 403  # Forbidden without auth
    
    def test_logout(self, client):
        """Test logout endpoint."""
        response = client.post("/api/auth/logout")
        assert response.status_code == 200


# ============================================================
# Jobs Tests (Auth Required - Mocked)
# ============================================================

class TestJobs:
    """Test job endpoints - requires authentication."""
    
    def test_list_jobs_unauthorized(self, client):
        """Test listing jobs without auth."""
        response = client.get("/api/jobs")
        assert response.status_code == 403
    
    def test_create_job_unauthorized(self, client):
        """Test creating job without auth."""
        response = client.post("/api/jobs", json={
            "job_posting": {"job_title": "Test"},
            "resume": {}
        })
        assert response.status_code == 403
    
    def test_get_job_not_found(self, client):
        """Test getting non-existent job."""
        response = client.get("/api/jobs/00000000-0000-0000-0000-000000000000")
        assert response.status_code == 403  # Auth first


# ============================================================
# Cover Letters Tests (Auth Required - Mocked)
# ============================================================

class TestCoverLetters:
    """Test cover letter endpoints."""
    
    def test_list_cover_letters_unauthorized(self, client):
        """Test listing cover letters without auth."""
        response = client.get("/api/cover-letters")
        assert response.status_code == 403
    
    def test_create_cover_letter_unauthorized(self, client):
        """Test creating cover letter without auth."""
        response = client.post("/api/cover-letters", json={
            "mode": "professional"
        })
        assert response.status_code == 403


# ============================================================
# Run all tests
# ============================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
