import os, uuid, requests, pytest

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"

def _login(email, pwd):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=20)

@pytest.fixture(scope="module")
def admin_token():
    r = _login("admin@hydroflow.com", "admin123")
    assert r.status_code == 200, r.text
    return r.json()["token"]

@pytest.fixture(scope="module")
def driver_token():
    r = _login("carlos@hydroflow.com", "driver123")
    assert r.status_code == 200, r.text
    return r.json()["token"]

def H(t): return {"Authorization": f"Bearer {t}"}

# ---------- Signup + login gate ----------
class TestSignupFlow:
    def setup_method(self):
        self.email = f"test_signup_{uuid.uuid4().hex[:8]}@x.com"
        self.pwd = "secret123"

    def test_signup_creates_pending_user(self, admin_token):
        r = requests.post(f"{API}/auth/signup", json={"name": "TEST User", "email": self.email, "password": self.pwd})
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "pending"
        # login must be blocked with 403 pending message
        rl = _login(self.email, self.pwd)
        assert rl.status_code == 403
        assert "aguardando aprova" in rl.json().get("detail", "").lower()
        # cleanup
        users = requests.get(f"{API}/users", headers=H(admin_token)).json()
        uid = next(u["id"] for u in users if u["email"] == self.email)
        requests.delete(f"{API}/users/{uid}", headers=H(admin_token))

    def test_signup_duplicate_email(self):
        r1 = requests.post(f"{API}/auth/signup", json={"name": "Dup", "email": "admin@hydroflow.com", "password": "abc123"})
        assert r1.status_code == 409

    def test_signup_weak_password(self):
        r = requests.post(f"{API}/auth/signup", json={"name": "X", "email": f"weak_{uuid.uuid4().hex[:6]}@x.com", "password": "12"})
        assert r.status_code == 400


# ---------- Expense approval (P0 bug) ----------
class TestExpenseApproval:
    def test_admin_can_approve_expense(self, admin_token):
        # create pending expense
        r = requests.post(f"{API}/expenses", json={"type": "Combustível", "driver": "TEST", "amount": 42, "status": "pending"}, headers=H(admin_token))
        assert r.status_code == 200
        eid = r.json()["id"]
        # approve
        r2 = requests.patch(f"{API}/expenses/{eid}", json={"status": "approved"}, headers=H(admin_token))
        assert r2.status_code == 200
        body = r2.json()
        assert body["status"] == "approved"
        assert body.get("reviewed_by")
        assert body.get("reviewed_at")
        # GET verify persistence
        rl = requests.get(f"{API}/expenses", headers=H(admin_token))
        assert any(x["id"] == eid and x["status"] == "approved" for x in rl.json())

    def test_admin_can_reject(self, admin_token):
        r = requests.post(f"{API}/expenses", json={"type": "Pedágio", "driver": "TEST", "amount": 12, "status": "pending"}, headers=H(admin_token))
        eid = r.json()["id"]
        r2 = requests.patch(f"{API}/expenses/{eid}", json={"status": "rejected"}, headers=H(admin_token))
        assert r2.status_code == 200 and r2.json()["status"] == "rejected"

    def test_driver_forbidden_to_patch_expense(self, admin_token, driver_token):
        r = requests.post(f"{API}/expenses", json={"type": "Pedágio", "driver": "TEST", "amount": 10, "status": "pending"}, headers=H(admin_token))
        eid = r.json()["id"]
        r2 = requests.patch(f"{API}/expenses/{eid}", json={"status": "approved"}, headers=H(driver_token))
        assert r2.status_code == 403

    def test_patch_nonexistent(self, admin_token):
        r = requests.patch(f"{API}/expenses/does-not-exist", json={"status": "approved"}, headers=H(admin_token))
        assert r.status_code == 404


# ---------- User CRUD + approve/reject/reset ----------
class TestUserAdmin:
    @classmethod
    def setup_class(cls):
        cls.created_ids = []

    @classmethod
    def teardown_class(cls):
        r = _login("admin@hydroflow.com", "admin123")
        tk = r.json()["token"]
        for uid in cls.created_ids:
            requests.delete(f"{API}/users/{uid}", headers=H(tk))

    def test_list_users_admin_only(self, admin_token, driver_token):
        assert requests.get(f"{API}/users", headers=H(driver_token)).status_code == 403
        r = requests.get(f"{API}/users", headers=H(admin_token))
        assert r.status_code == 200 and isinstance(r.json(), list)

    def test_create_user_and_login(self, admin_token):
        email = f"test_created_{uuid.uuid4().hex[:6]}@x.com"
        r = requests.post(f"{API}/users", json={"name": "TEST New", "email": email, "password": "abc123", "role": "driver"}, headers=H(admin_token))
        assert r.status_code == 200, r.text
        uid = r.json()["id"]; self.created_ids.append(uid)
        assert r.json()["status"] == "approved" and r.json()["active"] is True
        # this user should be able to log in immediately
        rl = _login(email, "abc123")
        assert rl.status_code == 200

    def test_signup_then_approve_flow(self, admin_token):
        email = f"test_pend_{uuid.uuid4().hex[:6]}@x.com"
        requests.post(f"{API}/auth/signup", json={"name": "TEST Pend", "email": email, "password": "abc123"})
        users = requests.get(f"{API}/users", headers=H(admin_token)).json()
        uid = next(u["id"] for u in users if u["email"] == email); self.created_ids.append(uid)
        # login blocked
        assert _login(email, "abc123").status_code == 403
        # approve
        r = requests.post(f"{API}/users/{uid}/approve", headers=H(admin_token))
        assert r.status_code == 200
        # now login works
        assert _login(email, "abc123").status_code == 200

    def test_reject_flow(self, admin_token):
        email = f"test_rej_{uuid.uuid4().hex[:6]}@x.com"
        requests.post(f"{API}/auth/signup", json={"name": "TEST Rej", "email": email, "password": "abc123"})
        uid = next(u["id"] for u in requests.get(f"{API}/users", headers=H(admin_token)).json() if u["email"] == email)
        self.created_ids.append(uid)
        assert requests.post(f"{API}/users/{uid}/reject", headers=H(admin_token)).status_code == 200
        rl = _login(email, "abc123")
        assert rl.status_code == 403
        assert "não aprovado" in rl.json()["detail"].lower() or "nao aprovado" in rl.json()["detail"].lower()

    def test_reset_password(self, admin_token):
        email = f"test_reset_{uuid.uuid4().hex[:6]}@x.com"
        r = requests.post(f"{API}/users", json={"name": "TEST", "email": email, "password": "oldpass", "role": "driver"}, headers=H(admin_token))
        uid = r.json()["id"]; self.created_ids.append(uid)
        r2 = requests.post(f"{API}/users/{uid}/reset-password", json={"password": "newpass1"}, headers=H(admin_token))
        assert r2.status_code == 200
        assert _login(email, "oldpass").status_code == 401
        assert _login(email, "newpass1").status_code == 200

    def test_update_role_and_active(self, admin_token):
        email = f"test_upd_{uuid.uuid4().hex[:6]}@x.com"
        r = requests.post(f"{API}/users", json={"name": "TEST", "email": email, "password": "abc123", "role": "driver"}, headers=H(admin_token))
        uid = r.json()["id"]; self.created_ids.append(uid)
        r2 = requests.patch(f"{API}/users/{uid}", json={"role": "admin", "active": False}, headers=H(admin_token))
        assert r2.status_code == 200
        body = r2.json()
        assert body["role"] == "admin" and body["active"] is False
        # deactivated user cannot login
        rl = _login(email, "abc123")
        assert rl.status_code == 403 and "desativ" in rl.json()["detail"].lower()

    def test_delete_user(self, admin_token):
        email = f"test_del_{uuid.uuid4().hex[:6]}@x.com"
        r = requests.post(f"{API}/users", json={"name": "TEST", "email": email, "password": "abc123"}, headers=H(admin_token))
        uid = r.json()["id"]
        assert requests.delete(f"{API}/users/{uid}", headers=H(admin_token)).status_code == 200
        # verify gone
        assert not any(u["id"] == uid for u in requests.get(f"{API}/users", headers=H(admin_token)).json())

    def test_cannot_delete_self(self, admin_token):
        me = requests.get(f"{API}/auth/me", headers=H(admin_token)).json()
        r = requests.delete(f"{API}/users/{me['id']}", headers=H(admin_token))
        assert r.status_code == 400


# ---------- Activity log ----------
class TestActivity:
    def test_activity_admin_only(self, driver_token):
        assert requests.get(f"{API}/activity", headers=H(driver_token)).status_code == 403

    def test_activity_records_signup_and_approval(self, admin_token):
        email = f"test_act_{uuid.uuid4().hex[:6]}@x.com"
        requests.post(f"{API}/auth/signup", json={"name": "TEST Act", "email": email, "password": "abc123"})
        uid = next(u["id"] for u in requests.get(f"{API}/users", headers=H(admin_token)).json() if u["email"] == email)
        requests.post(f"{API}/users/{uid}/approve", headers=H(admin_token))
        # create + approve expense
        eid = requests.post(f"{API}/expenses", json={"type": "TEST", "amount": 5, "status": "pending"}, headers=H(admin_token)).json()["id"]
        requests.patch(f"{API}/expenses/{eid}", json={"status": "approved"}, headers=H(admin_token))
        acts = requests.get(f"{API}/activity", headers=H(admin_token)).json()
        actions = [a["action"] for a in acts]
        assert "signup" in actions
        assert "user_approved" in actions
        assert "expense_approved" in actions
        # cleanup
        requests.delete(f"{API}/users/{uid}", headers=H(admin_token))
