"""Tests for /api/notifications and /api/daily-closing (HydroFlow new features)."""
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = {"email": "admin@hydroflow.com", "password": "admin123"}
DRIVER = {"email": "carlos@hydroflow.com", "password": "driver123"}


def _login(session: requests.Session, creds):
    r = session.post(f"{BASE_URL}/api/auth/login", json=creds)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    if token:
        session.headers.update({"Authorization": f"Bearer {token}"})
    return data


@pytest.fixture
def admin_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    _login(s, ADMIN)
    return s


@pytest.fixture
def driver_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    _login(s, DRIVER)
    return s


# ---------- /api/notifications ----------
class TestNotifications:
    def test_admin_notifications_shape(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/notifications")
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("pending_users", "pending_expenses", "total"):
            assert k in data, f"missing {k}"
            assert isinstance(data[k], int)
        assert data["total"] == data["pending_users"] + data["pending_expenses"]

    def test_driver_gets_zeros(self, driver_client):
        r = driver_client.get(f"{BASE_URL}/api/notifications")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data == {"pending_users": 0, "pending_expenses": 0, "total": 0}

    def test_signup_increases_pending_users(self, admin_client):
        # Baseline
        before = admin_client.get(f"{BASE_URL}/api/notifications").json()["pending_users"]
        # Public signup
        email = f"TEST_signup_{uuid.uuid4().hex[:8]}@example.com"
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        r = s.post(f"{BASE_URL}/api/auth/signup", json={
            "email": email, "password": "test1234", "name": "TEST Signup",
        })
        assert r.status_code in (200, 201), f"signup failed: {r.status_code} {r.text}"
        after = admin_client.get(f"{BASE_URL}/api/notifications").json()["pending_users"]
        assert after == before + 1, f"expected pending_users to grow from {before} to {before+1}, got {after}"

        # Cleanup: find and delete the new user
        users = admin_client.get(f"{BASE_URL}/api/users").json()
        target = next((u for u in users if u.get("email") == email), None)
        if target:
            admin_client.delete(f"{BASE_URL}/api/users/{target['id']}")


# ---------- /api/daily-closing ----------
class TestDailyClosing:
    def test_driver_forbidden(self, driver_client):
        r = driver_client.get(f"{BASE_URL}/api/daily-closing")
        assert r.status_code == 403, f"expected 403 for driver, got {r.status_code}"

    def test_admin_default_today(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/daily-closing")
        assert r.status_code == 200, r.text
        data = r.json()
        today = datetime.now(timezone.utc).date().isoformat()
        assert data["date"] == today
        assert "drivers" in data and isinstance(data["drivers"], list)
        assert "totals" in data
        for k in ("revenue", "expenses_approved", "expenses_pending", "deliveries_done", "deliveries_total", "balance"):
            assert k in data["totals"], f"totals missing {k}"

    def test_admin_specific_date_shape(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/daily-closing", params={"date": "2026-01-01"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["date"] == "2026-01-01"
        for row in data["drivers"]:
            expected_keys = {"driver", "deliveries_total", "deliveries_done", "revenue",
                             "expenses_approved", "expenses_pending", "expenses_rejected", "balance"}
            assert expected_keys.issubset(row.keys())
            # balance = revenue - expenses_approved
            assert abs(row["balance"] - (row["revenue"] - row["expenses_approved"])) < 1e-6

    def test_totals_match_rows(self, admin_client):
        r = admin_client.get(f"{BASE_URL}/api/daily-closing")
        data = r.json()
        rows = data["drivers"]
        assert abs(data["totals"]["revenue"] - sum(x["revenue"] for x in rows)) < 1e-6
        assert abs(data["totals"]["expenses_approved"] - sum(x["expenses_approved"] for x in rows)) < 1e-6
        assert abs(data["totals"]["balance"] - sum(x["balance"] for x in rows)) < 1e-6

    def test_unauthenticated_blocked(self):
        r = requests.get(f"{BASE_URL}/api/daily-closing")
        assert r.status_code in (401, 403)
