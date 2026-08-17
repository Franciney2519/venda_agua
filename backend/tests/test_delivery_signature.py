"""Tests for delivery signature + delivered_at flow (driver rota mobile feature).

- PATCH /api/deliveries/{id} accepts signature (base64 data URL) and delivered_at.
- Driver (non-admin) can perform the PATCH.
- Partial PATCH still preserves other fields (regression from iteration 6).
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
    return r.json()["token"], r.json()["user"]


@pytest.fixture(scope="module")
def admin_ctx():
    tok, user = _login(ADMIN)
    return {"headers": {"Authorization": f"Bearer {tok}"}, "user": user}


@pytest.fixture(scope="module")
def driver_ctx():
    tok, user = _login(DRIVER)
    return {"headers": {"Authorization": f"Bearer {tok}"}, "user": user}


@pytest.fixture
def new_delivery_id(admin_ctx, driver_ctx):
    """Create a delivery assigned to the driver, return its id."""
    payload = {
        "customer": "TEST_ClienteSig",
        "address": "Rua Sig, 100",
        "driver": driver_ctx["user"]["name"],
        "product": "Galão 20L",
        "quantity": 3,
        "value": 54.0,
        "status": "pending",
    }
    r = requests.post(f"{BASE_URL}/api/deliveries", headers=admin_ctx["headers"], json=payload)
    assert r.status_code == 200, r.text
    return r.json()["id"]


SAMPLE_SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="


class TestDeliverySignature:
    def test_driver_can_patch_signature_and_delivered_at(self, driver_ctx, admin_ctx, new_delivery_id):
        delivered_at = "2026-01-15T12:34:56.000Z"
        r = requests.patch(
            f"{BASE_URL}/api/deliveries/{new_delivery_id}",
            headers=driver_ctx["headers"],
            json={"status": "delivered", "signature": SAMPLE_SIGNATURE, "delivered_at": delivered_at},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "delivered"
        assert data.get("signature") == SAMPLE_SIGNATURE
        assert data.get("delivered_at") == delivered_at
        # regression: other fields preserved
        assert data["customer"] == "TEST_ClienteSig"
        assert data["value"] == 54.0
        assert data["quantity"] == 3
        assert data["driver"] == driver_ctx["user"]["name"]

        # GET via admin to confirm persistence
        list_r = requests.get(f"{BASE_URL}/api/deliveries", headers=admin_ctx["headers"])
        assert list_r.status_code == 200
        found = next((x for x in list_r.json() if x["id"] == new_delivery_id), None)
        assert found is not None
        assert found["signature"] == SAMPLE_SIGNATURE
        assert found["delivered_at"] == delivered_at
        assert found["value"] == 54.0

    def test_driver_can_start_stop_in_transit(self, driver_ctx, new_delivery_id):
        r = requests.patch(
            f"{BASE_URL}/api/deliveries/{new_delivery_id}",
            headers=driver_ctx["headers"],
            json={"status": "in_transit"},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "in_transit"

    def test_driver_can_mark_failed(self, driver_ctx, new_delivery_id):
        r = requests.patch(
            f"{BASE_URL}/api/deliveries/{new_delivery_id}",
            headers=driver_ctx["headers"],
            json={"status": "failed"},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "failed"

    def test_partial_patch_preserves_other_fields(self, driver_ctx, admin_ctx, new_delivery_id):
        # send only signature - shouldn't wipe value/customer/quantity/driver
        r = requests.patch(
            f"{BASE_URL}/api/deliveries/{new_delivery_id}",
            headers=driver_ctx["headers"],
            json={"signature": SAMPLE_SIGNATURE},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["customer"] == "TEST_ClienteSig"
        assert d["value"] == 54.0
        assert d["quantity"] == 3
        assert d["driver"] == driver_ctx["user"]["name"]
        assert d["signature"] == SAMPLE_SIGNATURE
