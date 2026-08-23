"""Tests for signature capture on the daily-entries flow (driver mobile feature).

The legacy /deliveries status+signature flow was removed: drivers now record a stop
(and its signature) in one POST to /daily-entries, produced by the mobile app's
signature screen. This covers that the signature round-trips and that a partial
PATCH by the admin doesn't wipe it or other fields.
"""
import os
import requests
import pytest

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

ADMIN = {"email": "admin@hydroflow.com", "password": "admin123"}
DRIVER = {"email": "carlos@hydroflow.com", "password": "driver123"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds)
    assert r.status_code == 200, r.text
    body = r.json()
    return body["token"], body


@pytest.fixture(scope="module")
def admin_ctx():
    tok, user = _login(ADMIN)
    return {"headers": {"Authorization": f"Bearer {tok}"}, "user": user}


@pytest.fixture(scope="module")
def driver_ctx():
    tok, user = _login(DRIVER)
    return {"headers": {"Authorization": f"Bearer {tok}"}, "user": user}


SAMPLE_SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="


@pytest.fixture
def new_entry_id(driver_ctx):
    """Create a daily entry with a signature, return its id."""
    payload = {
        "customer": "TEST_ClienteSig",
        "items": [{"brand": "Minalar", "price": 6.0, "quantity": 3, "mf_quantity": 0}],
        "pix_value": 18.0, "cash_value": 0, "comp_value": 0,
        "signature": SAMPLE_SIGNATURE,
    }
    r = requests.post(f"{BASE_URL}/api/daily-entries", headers=driver_ctx["headers"], json=payload)
    assert r.status_code == 200, r.text
    return r.json()["id"]


class TestDailyEntrySignature:
    def test_signature_persisted_on_create(self, driver_ctx, admin_ctx, new_entry_id):
        list_r = requests.get(f"{BASE_URL}/api/daily-entries", headers=admin_ctx["headers"])
        assert list_r.status_code == 200
        found = next((x for x in list_r.json() if x["id"] == new_entry_id), None)
        assert found is not None
        assert found["signature"] == SAMPLE_SIGNATURE
        assert found["total"] == 18.0
        assert found["customer"] == "TEST_ClienteSig"
        assert found["driver"] == driver_ctx["user"]["name"]

    def test_partial_patch_preserves_signature_and_total(self, admin_ctx, new_entry_id):
        r = requests.patch(
            f"{BASE_URL}/api/daily-entries/{new_entry_id}",
            headers=admin_ctx["headers"],
            json={"notes": "revisado"},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["signature"] == SAMPLE_SIGNATURE
        assert d["total"] == 18.0
        assert d["customer"] == "TEST_ClienteSig"
        assert d["notes"] == "revisado"

    def test_driver_can_delete_own_entry(self, driver_ctx, new_entry_id):
        r = requests.delete(f"{BASE_URL}/api/daily-entries/{new_entry_id}", headers=driver_ctx["headers"])
        assert r.status_code == 200, r.text
