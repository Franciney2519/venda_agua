"""Contas criadas pelo seed ganham id próprio: trocar ADMIN_EMAIL na hospedagem não pode repetir id."""
import asyncio, os


def test_seed_gives_each_account_its_own_id(c):
    import server
    users = c.get("/api/users", headers={"Authorization": "Bearer " + c.post("/api/auth/login", json={"email": "admin@t.com", "password": "admin123"}).json()["token"]}).json()
    ids = [u["id"] for u in users]
    assert "admin-1" not in ids and "driver-1" not in ids and len(set(ids)) == len(ids)

    # Simula outra hospedagem com ADMIN_EMAIL diferente: o seed cria um 2º admin, com outro id.
    old = os.environ["ADMIN_EMAIL"]
    os.environ["ADMIN_EMAIL"] = "outro-admin@t.com"
    try: c.portal.call(server.seed)
    finally: os.environ["ADMIN_EMAIL"] = old
    first = c.post("/api/auth/login", json={"email": "admin@t.com", "password": "admin123"}).json()
    second = c.post("/api/auth/login", json={"email": "outro-admin@t.com", "password": "admin123"}).json()
    assert first["id"] != second["id"]
    # Cada sessão continua sendo da própria pessoa.
    me = c.get("/api/auth/me", headers={"Authorization": "Bearer " + second["token"]}).json()
    assert me["email"] == "outro-admin@t.com"
