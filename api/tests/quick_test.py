"""
Quick API Health Check - Run without pytest
Tests all endpoints and shows pass/fail status
"""

import httpx
import sys

BASE_URL = "http://127.0.0.1:8000"


def check_endpoint(name: str, method: str, path: str, expected_status: list = [200], **kwargs):
    """Test a single endpoint."""
    try:
        with httpx.Client(timeout=30.0) as client:
            if method == "GET":
                response = client.get(f"{BASE_URL}{path}", **kwargs)
            elif method == "POST":
                response = client.post(f"{BASE_URL}{path}", **kwargs)
            elif method == "PATCH":
                response = client.patch(f"{BASE_URL}{path}", **kwargs)
            elif method == "DELETE":
                response = client.delete(f"{BASE_URL}{path}", **kwargs)
            
            if response.status_code in expected_status:
                print(f"  ✅ {name}: PASSED ({response.status_code})")
                return True
            else:
                print(f"  ❌ {name}: FAILED (expected {expected_status}, got {response.status_code})")
                return False
    except httpx.ConnectError:
        print(f"  ❌ {name}: FAILED (server not running)")
        return False
    except Exception as e:
        print(f"  ❌ {name}: FAILED ({e})")
        return False


def run_tests():
    """Run all API tests."""
    print("\n" + "="*60)
    print("🧪 WAND API TEST SUITE")
    print("="*60)
    
    results = []
    
    # Health & Root
    print("\n📍 Health & Root:")
    results.append(check_endpoint("Health Check", "GET", "/health"))
    results.append(check_endpoint("Root", "GET", "/"))
    
    # News (No Auth)
    print("\n📰 News (Public):")
    results.append(check_endpoint("Get News", "GET", "/api/news/Apple"))
    
    # Auth
    print("\n🔐 Auth:")
    results.append(check_endpoint("Google Redirect", "GET", "/api/auth/google", [302, 307]))
    results.append(check_endpoint("Logout", "POST", "/api/auth/logout"))
    results.append(check_endpoint("Me (No Auth)", "GET", "/api/auth/me", [403]))
    
    # Jobs (Auth Required)
    print("\n📋 Jobs (Auth Required):")
    results.append(check_endpoint("List Jobs (No Auth)", "GET", "/api/jobs", [403]))
    results.append(check_endpoint("Create Job (No Auth)", "POST", "/api/jobs", [403, 422], json={}))
    
    # Cover Letters (Auth Required)
    print("\n📝 Cover Letters (Auth Required):")
    results.append(check_endpoint("List Cover Letters (No Auth)", "GET", "/api/cover-letters", [403]))
    
    # Summary
    passed = sum(results)
    total = len(results)
    
    print("\n" + "="*60)
    print(f"📊 RESULTS: {passed}/{total} tests passed")
    if passed == total:
        print("🎉 All tests passed!")
    else:
        print(f"⚠️ {total - passed} tests failed")
    print("="*60 + "\n")
    
    return passed == total


if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
