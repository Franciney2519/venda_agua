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
