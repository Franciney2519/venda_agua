"""Editing/deleting a sale after its trip was finalized must keep the depot stock consistent."""


def _login(c, email, pw):
    return {"Authorization": "Bearer " + c.post("/api/auth/login", json={"email": email, "password": pw}).json()["token"]}


def test_edit_and_delete_after_trip_finalized(c):
    A = _login(c, "admin@t.com", "admin123"); D = _login(c, "carlos@t.com", "driver123")
    prod = c.post("/api/products", json={"name": "Agua F", "brand": "Agua F", "category": "Retornável", "quantity": 100, "minimum": 1, "unit": "un"}, headers=A).json()
    qty = lambda: next(p for p in c.get("/api/products", headers=A).json() if p["id"] == prod["id"])["quantity"]
    v = c.post("/api/viagens", json={"turno": 0, "carga_items": [{"brand": "Agua F", "quantity": 10}]}, headers=D).json()
    assert c.post(f"/api/viagens/{v['id']}/iniciar", headers=D).status_code == 200
    e = c.post("/api/daily-entries", json={"customer": "X", "viagem_id": v["id"], "items": [{"brand": "Agua F", "quantity": 4, "price": 5}], "cash_value": 20}, headers=D).json()
    assert c.post(f"/api/viagens/{v['id']}/finalizar", headers=D).status_code == 200
    assert qty() == 96  # 100 - 10 loaded + 6 returned

    r = c.patch(f"/api/daily-entries/{e['id']}", json={"items": [{"brand": "Agua F", "quantity": 6, "price": 5}], "cash_value": 30}, headers=A)
    assert r.status_code == 200, r.text
    assert qty() == 94  # two more bottles left the depot than the returned count assumed

    assert c.delete(f"/api/daily-entries/{e['id']}", headers=A).status_code == 200
    assert qty() == 100  # everything back


def test_trip_summary_is_recomputed_after_edit_or_delete(c):
    A = _login(c, "admin@t.com", "admin123"); D = _login(c, "carlos@t.com", "driver123")
    c.post("/api/products", json={"name": "Agua S", "brand": "Agua S", "category": "Retornável", "quantity": 100, "minimum": 1, "unit": "un"}, headers=A)
    v = c.post("/api/viagens", json={"turno": 0, "carga_items": [{"brand": "Agua S", "quantity": 10}]}, headers=D).json()
    c.post(f"/api/viagens/{v['id']}/iniciar", headers=D)
    e1 = c.post("/api/daily-entries", json={"customer": "X", "viagem_id": v["id"], "items": [{"brand": "Agua S", "quantity": 4, "price": 5}], "cash_value": 20}, headers=D).json()
    e2 = c.post("/api/daily-entries", json={"customer": "Y", "viagem_id": v["id"], "items": [{"brand": "Agua S", "quantity": 2, "mf_quantity": 1, "price": 5}], "mf_plan": "reschedule", "cash_value": 10}, headers=D).json()
    fin = c.post(f"/api/viagens/{v['id']}/finalizar", headers=D).json()
    assert (fin["total_bruto"], fin["quantidade_entregue"], fin["problemas"], fin["mf_quantity_total"]) == (30, 6, 1, 1)
    c.patch(f"/api/daily-entries/{e1['id']}", json={"items": [{"brand": "Agua S", "quantity": 5, "price": 5}], "cash_value": 25}, headers=A)
    trip = next(t for t in c.get("/api/viagens", headers=A).json()["viagens"] if t["id"] == v["id"])
    assert (trip["total_bruto"], trip["quantidade_entregue"]) == (35, 7)
    c.delete(f"/api/daily-entries/{e2['id']}", headers=A)
    trip = next(t for t in c.get("/api/viagens", headers=A).json()["viagens"] if t["id"] == v["id"])
    assert (trip["total_bruto"], trip["entregas"], trip["problemas"], trip["saldo_liquido"]) == (25, 1, 0, 25)
