"""MF swap on the truck needs spare bottles; otherwise it is rescheduled to the next business day with a reminder."""
from datetime import date, timedelta

import server


def _login(c, email, pw):
    return {"Authorization": "Bearer " + c.post("/api/auth/login", json={"email": email, "password": pw}).json()["token"]}


def _setup(c, A, D, name, stock_qty, carga, plan):
    prod = c.post("/api/products", json={"name": name, "brand": name, "category": "Retornável", "quantity": stock_qty, "minimum": 1, "unit": "un"}, headers=A).json()
    custs = [c.post("/api/customers", json={"name": f"{name} {n}"}, headers=A).json() for n in ("A", "B")]
    v = c.post("/api/viagens", json={"turno": 1 if name.endswith("2") else 0, "carga_items": [{"brand": name, "quantity": carga}]}, headers=D).json()
    r = c.post(f"/api/viagens/{v['id']}/rotas", json={"clientes": [{"id": x["id"], "name": x["name"], "brand": name, "quantity": q} for x, q in zip(custs, plan)]}, headers=D).json()
    assert c.post(f"/api/viagens/{v['id']}/iniciar", headers=D).status_code == 200
    return prod, custs, v, r["rotas"][0]


def test_swap_blocked_when_route_uses_whole_load_and_reschedule_reminds(c):
    A = _login(c, "admin@t.com", "admin123"); D = _login(c, "carlos@t.com", "driver123")
    prod, custs, v, rota = _setup(c, A, D, "Agua MF1", 100, 10, [5, 5])
    # customer A wanted 5: 4 good + 1 leaking. Swap uses 4 + 1 replacement + 1 defective = 6; B still needs 5 -> 11 > 10.
    body = {"customer": custs[0]["name"], "viagem_id": v["id"], "rota_id": rota["id"], "items": [{"brand": "Agua MF1", "quantity": 4, "mf_quantity": 1, "price": 5, "sale_type": "exchange"}], "mf_plan": "swap", "cash_value": 25}
    r = c.post("/api/daily-entries", json=body, headers=D)
    assert r.status_code == 400 and "não tem sobra" in r.json()["detail"]

    body.update(mf_plan="reschedule", cash_value=20)
    r = c.post("/api/daily-entries", json=body, headers=D)
    assert r.status_code == 200, r.text
    e = r.json()
    hoje = date.fromisoformat(server.today_local())
    due = date.fromisoformat(e["mf_due_date"])
    assert due > hoje and due.weekday() < 5 and (due - hoje).days <= 3

    pend = c.get("/api/mf-pendentes", headers=D).json()
    row = next(p for p in pend if p["customer"] == custs[0]["name"])
    assert row["brand"] == "Agua MF1" and row["quantity"] == 1 and row["due_date"] == e["mf_due_date"]
    assert c.get("/api/mf-pendentes", headers={"Authorization": "Bearer x"}).status_code == 401
    assert c.post(f"/api/viagens/{v['id']}/finalizar", headers=D).status_code == 200


def test_swap_allowed_with_spare_and_stock_accounting(c):
    A = _login(c, "admin@t.com", "admin123"); D = _login(c, "carlos@t.com", "driver123")
    prod, custs, v, rota = _setup(c, A, D, "Agua MF2", 100, 14, [5, 5])
    qty = lambda: next(p for p in c.get("/api/products", headers=A).json() if p["id"] == prod["id"])
    e = c.post("/api/daily-entries", json={"customer": custs[0]["name"], "viagem_id": v["id"], "rota_id": rota["id"], "items": [{"brand": "Agua MF2", "quantity": 4, "mf_quantity": 1, "price": 5, "sale_type": "exchange"}], "mf_plan": "swap", "cash_value": 25}, headers=D)
    assert e.status_code == 200, e.text  # 4+2 used, B needs 5 -> 11 <= 14
    assert qty()["defective_quantity"] == 1
    c.post("/api/daily-entries", json={"customer": custs[1]["name"], "viagem_id": v["id"], "rota_id": rota["id"], "items": [{"brand": "Agua MF2", "quantity": 5, "price": 5, "sale_type": "exchange"}], "cash_value": 25}, headers=D)
    fin = c.post(f"/api/viagens/{v['id']}/finalizar", headers=D).json()
    assert fin["carga_devolvida_total"] == 3  # 14 - (4 + 1 + 1 + 5)
    p = qty()
    assert p["quantity"] == 100 - 14 + 3 and p["defective_quantity"] == 1
