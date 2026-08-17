"""Regression tests for PATCH /expenses and /deliveries preserving non-sent fields.

Bug: prior code used model_dump(exclude_none=True) with numeric defaults (amount=0, value=0),
which zeroed those fields on partial updates. Fix: switch to exclude_unset=True.
"""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
ADMIN_EMAIL = "admin@hydroflow.com"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# --- PATCH /expenses regression ---

class TestExpensePatchPreservesAmount:
    def test_approve_preserves_amount_and_other_fields(self, admin_headers):
        # CREATE expense with amount=100
        create = requests.post(f"{BASE_URL}/api/expenses",
                               headers=admin_headers,
                               json={"type": "TEST_Combustível", "amount": 100,
                                     "driver": "TEST_Driver", "status": "pending"})
        assert create.status_code == 200, create.text
        exp = create.json()
        assert exp["amount"] == 100
        exp_id = exp["id"]

        # PATCH with ONLY status
        patch = requests.patch(f"{BASE_URL}/api/expenses/{exp_id}",
                               headers=admin_headers,
                               json={"status": "approved"})
        assert patch.status_code == 200, patch.text
        updated = patch.json()
        assert updated["status"] == "approved"
        assert updated["amount"] == 100, f"amount was zeroed! got {updated.get('amount')}"
        assert updated["type"] == "TEST_Combustível"
        assert updated["driver"] == "TEST_Driver"
        assert updated.get("reviewed_by")
        assert updated.get("reviewed_at")

        # GET to confirm persistence
        get_all = requests.get(f"{BASE_URL}/api/expenses", headers=admin_headers)
        assert get_all.status_code == 200
        found = next((x for x in get_all.json() if x["id"] == exp_id), None)
        assert found is not None
        assert found["amount"] == 100
        assert found["status"] == "approved"

    def test_reject_preserves_amount(self, admin_headers):
        create = requests.post(f"{BASE_URL}/api/expenses",
                               headers=admin_headers,
                               json={"type": "TEST_Manutenção", "amount": 250.75,
                                     "driver": "TEST_Driver2"})
        assert create.status_code == 200
        exp_id = create.json()["id"]

        patch = requests.patch(f"{BASE_URL}/api/expenses/{exp_id}",
                               headers=admin_headers,
                               json={"status": "rejected"})
        assert patch.status_code == 200
        updated = patch.json()
        assert updated["status"] == "rejected"
        assert updated["amount"] == 250.75


# --- PATCH /deliveries regression ---

class TestDeliveryPatchPreservesFields:
    def test_status_update_preserves_value_qty_customer(self, admin_headers):
        create = requests.post(f"{BASE_URL}/api/deliveries",
                               headers=admin_headers,
                               json={"customer": "TEST_Cliente", "address": "Rua Teste, 1",
                                     "driver": "TEST_Motorista", "product": "Galão 20L",
                                     "quantity": 5, "value": 90.0, "status": "pending"})
        assert create.status_code == 200, create.text
        d_id = create.json()["id"]

        patch = requests.patch(f"{BASE_URL}/api/deliveries/{d_id}",
                               headers=admin_headers,
                               json={"status": "delivered"})
        assert patch.status_code == 200
        updated = patch.json()
        assert updated["status"] == "delivered"
        assert updated["value"] == 90.0, f"value zeroed! got {updated.get('value')}"
        assert updated["quantity"] == 5
        assert updated["customer"] == "TEST_Cliente"
        assert updated["driver"] == "TEST_Motorista"


# --- Activity log ---

class TestActivityLog:
    def test_expense_approved_logged(self, admin_headers):
        create = requests.post(f"{BASE_URL}/api/expenses",
                               headers=admin_headers,
                               json={"type": "TEST_LogCheck", "amount": 42,
                                     "driver": "TEST_LogDriver"})
        exp_id = create.json()["id"]
        requests.patch(f"{BASE_URL}/api/expenses/{exp_id}",
                       headers=admin_headers,
                       json={"status": "approved"})

        log = requests.get(f"{BASE_URL}/api/activity", headers=admin_headers)
        assert log.status_code == 200
        actions = [x for x in log.json() if x.get("target_id") == exp_id]
        assert any(a.get("action") == "expense_approved" for a in actions), \
            f"expense_approved not logged. actions: {[a.get('action') for a in actions]}"
