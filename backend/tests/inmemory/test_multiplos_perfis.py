"""Uma conta pode ter os perfis admin e entregador e trocar entre eles sem sair."""
from test_mf_troca_viagem import _auth, _day, _login


def _h(token): return {"Authorization": "Bearer " + token}


def test_account_with_two_roles_switches_profile(c):
    A, D = _auth(c)
    u = c.post("/api/users", json={"name": "Pessoa Dupla", "email": "dupla@t.com", "password": "dupla123", "roles": ["admin", "driver"]}, headers=A).json()
    assert u["roles"] == ["admin", "driver"] and u["role"] == "admin"

    login = c.post("/api/auth/login", json={"email": "dupla@t.com", "password": "dupla123"}).json()
    assert login["role"] == "admin" and login["roles"] == ["admin", "driver"]
    assert c.get("/api/users", headers=_h(login["token"])).status_code == 200  # como admin

    drv = c.post("/api/auth/switch-role", json={"role": "driver"}, headers=_h(login["token"])).json()
    assert drv["role"] == "driver"
    H = _h(drv["token"])
    assert c.get("/api/auth/me", headers=H).json()["role"] == "driver"
    assert c.get("/api/users", headers=H).status_code == 403  # como entregador não vê telas de admin
    v = c.post("/api/viagens", json={"turno": 0, "date": _day(300), "carga_total": 5, "create_first_rota": True}, headers=H).json()
    assert v["driver"] == "Pessoa Dupla"

    back = c.post("/api/auth/switch-role", json={"role": "admin"}, headers=H).json()
    assert c.get("/api/users", headers=_h(back["token"])).status_code == 200


def test_switch_to_role_the_account_does_not_have(c):
    A, D = _auth(c)
    assert c.post("/api/auth/switch-role", json={"role": "admin"}, headers=D).status_code == 403


def test_removed_role_falls_back_and_self_admin_protected(c):
    A, D = _auth(c)
    u = c.post("/api/users", json={"name": "Pessoa Tirada", "email": "tirada@t.com", "password": "tirada123", "roles": ["admin", "driver"]}, headers=A).json()
    tok = c.post("/api/auth/login", json={"email": "tirada@t.com", "password": "tirada123"}).json()["token"]
    # Admin tira o perfil de admin: o token antigo (perfil admin) deixa de dar acesso de admin.
    assert c.patch(f"/api/users/{u['id']}", json={"roles": ["driver"]}, headers=A).json()["roles"] == ["driver"]
    assert c.get("/api/auth/me", headers=_h(tok)).json()["role"] == "driver"
    assert c.get("/api/users", headers=_h(tok)).status_code == 403
    me = c.get("/api/auth/me", headers=A).json()
    assert c.patch(f"/api/users/{me['id']}", json={"roles": ["driver"]}, headers=A).status_code == 400
    assert c.patch(f"/api/users/{me['id']}", json={"roles": []}, headers=A).status_code == 400
    # O admin pode se dar também o perfil de entregador.
    assert c.patch(f"/api/users/{me['id']}", json={"roles": ["admin", "driver"]}, headers=A).json()["roles"] == ["admin", "driver"]
    # Contas antigas (só `role`) continuam iguais.
    assert c.get("/api/auth/me", headers=D).json()["roles"] == ["driver"]


def test_cannot_remove_driver_role_with_open_route(c):
    A, D = _auth(c)
    u = c.post("/api/users", json={"name": "Pessoa Rota", "email": "rota@t.com", "password": "rota1234", "roles": ["admin", "driver"]}, headers=A).json()
    tok = c.post("/api/auth/login", json={"email": "rota@t.com", "password": "rota1234"}).json()["token"]
    H = _h(c.post("/api/auth/switch-role", json={"role": "driver"}, headers=_h(tok)).json()["token"])
    v = c.post("/api/viagens", json={"turno": 1, "date": _day(301), "carga_total": 5, "create_first_rota": True}, headers=H).json()
    r = c.patch(f"/api/users/{u['id']}", json={"roles": ["admin"]}, headers=A)
    assert r.status_code == 400 and v["codigo_viagem"] in r.json()["detail"] and "planejada" in r.json()["detail"]
    assert c.delete(f"/api/viagens/{v['id']}", headers=H).status_code == 200
    assert c.patch(f"/api/users/{u['id']}", json={"roles": ["admin"]}, headers=A).json()["roles"] == ["admin"]
