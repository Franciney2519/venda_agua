"""Pending MF swaps scheduled into a trip, route clients with a product outside their own catalog, and Rota 01 created with the trip."""
from datetime import date, timedelta


def _login(c, email, pw):
    return {"Authorization": "Bearer " + c.post("/api/auth/login", json={"email": email, "password": pw}).json()["token"]}


def _auth(c):
    return _login(c, "admin@t.com", "admin123"), _login(c, "carlos@t.com", "driver123")


def _day(n):
    """Each scenario runs on its own far-future day so the per-turno trip limit never interferes."""
    return (date(2031, 1, 1) + timedelta(days=n)).isoformat()


def _pending_mf(c, A, D, name, day):
    """A delivery with 1 leaking bottle rescheduled -> one mf_reagendado reminder for customer '<name> A'."""
    prod = c.post("/api/products", json={"name": name, "brand": name, "category": "Retornável", "quantity": 100, "minimum": 1, "unit": "un"}, headers=A).json()
    custs = [c.post("/api/customers", json={"name": f"{name} {n}", "brands": [{"brand": name, "price": 5}]}, headers=A).json() for n in ("A", "B")]
    v = c.post("/api/viagens", json={"turno": 0, "date": day, "carga_total": 20, "create_first_rota": True}, headers=D).json()
    rota = v["rotas"][0]
    c.post(f"/api/viagens/{v['id']}/rotas/{rota['id']}/clientes", json={"id": custs[0]["id"], "name": custs[0]["name"], "brand": name, "quantity": 5}, headers=D)
    assert c.post(f"/api/viagens/{v['id']}/iniciar", headers=D).status_code == 200
    e = c.post("/api/daily-entries", json={"customer": custs[0]["name"], "date": day, "viagem_id": v["id"], "rota_id": rota["id"], "mf_plan": "reschedule", "cash_value": 20,
                                           "items": [{"brand": name, "quantity": 4, "mf_quantity": 1, "price": 5, "sale_type": "exchange"}]}, headers=D)
    assert e.status_code == 200, e.text
    assert c.post(f"/api/viagens/{v['id']}/finalizar", headers=D).status_code == 200
    mf = next(p for p in c.get("/api/mf-pendentes", headers=D).json() if p["customer"] == custs[0]["name"])
    return prod, custs, mf


def _trip(c, D, day, turno=1, carga=20):
    v = c.post("/api/viagens", json={"turno": turno, "date": day, "carga_total": carga, "create_first_rota": True}, headers=D).json()
    return v, v["rotas"][0]


def _pending_ids(c, D, **params):
    return [p["id"] for p in c.get("/api/mf-pendentes", params=params, headers=D).json()]


def _product(c, A, prod):
    return next(p for p in c.get("/api/products", headers=A).json() if p["id"] == prod["id"])


def test_create_trip_with_first_rota(c):
    A, D = _auth(c)
    v = c.post("/api/viagens", json={"turno": 0, "date": _day(0), "carga_total": 30, "create_first_rota": True}, headers=D).json()
    assert len(v["rotas"]) == 1 and v["rotas"][0]["numero"] == 1 and v["rotas"][0]["clientes"] == []
    assert v["rotas"][0]["codigo_rota"] == f"{v['codigo_viagem']}-R01"
    assert c.post("/api/viagens", json={"turno": 1, "date": _day(0)}, headers=D).json()["rotas"] == []


def test_route_client_out_of_catalog_uses_catalog_price(c):
    A, D = _auth(c)
    c.post("/api/brands", json={"name": "Catalogo X", "cost_price": 3, "price": 11, "price_full": 40}, headers=A)
    c.post("/api/brands", json={"name": "Sem Preco", "cost_price": 3}, headers=A)
    cust = c.post("/api/customers", json={"name": "Cliente OOC", "brands": [{"brand": "Propria", "price": 7, "price_full": 25}]}, headers=A).json()
    v, rota = _trip(c, D, _day(1))
    url = f"/api/viagens/{v['id']}/rotas/{rota['id']}/clientes"

    cl = c.post(url, json={"id": cust["id"], "name": cust["name"], "brand": "Catalogo X", "quantity": 3, "sale_type": "exchange"}, headers=D).json()["rotas"][0]["clientes"][0]
    assert cl["out_of_catalog"] is True and cl["price"] == 11 and cl["price_full"] == 40

    cl = c.patch(f"{url}/{cust['id']}", json={"brand": "propria"}, headers=D).json()["rotas"][0]["clientes"][0]
    assert cl["out_of_catalog"] is False and cl["price"] == 7 and cl["price_full"] == 25

    cl = c.patch(f"{url}/{cust['id']}", json={"brand": "Sem Preco"}, headers=D).json()["rotas"][0]["clientes"][0]
    assert cl["out_of_catalog"] is True and cl["price"] is None

    cl = c.patch(f"{url}/{cust['id']}", json={"price": 9.5}, headers=D).json()["rotas"][0]["clientes"][0]
    assert cl["price"] == 9.5 and cl["brand"] == "Sem Preco"


def test_schedule_mf_as_new_client_and_resolve_on_delivery(c):
    A, D = _auth(c)
    prod, custs, mf = _pending_mf(c, A, D, "Agua T1", _day(2))
    v, rota = _trip(c, D, _day(3))
    url = f"/api/viagens/{v['id']}/rotas/{rota['id']}"

    r = c.post(f"{url}/mf-troca", json={"movement_id": mf["id"]}, headers=D)
    assert r.status_code == 200, r.text
    cl = r.json()["rotas"][0]["clientes"][0]
    assert cl["id"] == custs[0]["id"] and cl["brand"] == "Agua T1" and cl["quantity"] == 1 and cl["sale_type"] == "exchange"
    assert cl["mf_swap_quantity"] == 1 and cl["mf_swap_movement_ids"] == [mf["id"]] and cl["price"] == 5
    assert "Troca de MF: levar 1 × Agua T1" in cl["notes"]

    assert mf["id"] not in _pending_ids(c, D)
    scheduled = next(p for p in c.get("/api/mf-pendentes", params={"include_scheduled": 1}, headers=D).json() if p["id"] == mf["id"])
    assert scheduled["scheduled_viagem_id"] == v["id"] and scheduled["scheduled_rota_id"] == rota["id"]
    assert c.post(f"{url}/mf-troca", json={"movement_id": mf["id"]}, headers=D).status_code == 400
    assert c.post(f"{url}/mf-troca", json={"movement_id": "nope"}, headers=D).status_code == 404

    assert c.post(f"/api/viagens/{v['id']}/iniciar", headers=D).status_code == 200
    before = _product(c, A, prod)
    e = c.post("/api/daily-entries", json={"customer": custs[0]["name"], "date": _day(3), "viagem_id": v["id"], "rota_id": rota["id"], "cash_value": 5,
                                           "items": [{"brand": "Agua T1", "quantity": 1, "price": 5, "sale_type": "exchange"}]}, headers=D)
    assert e.status_code == 200, e.text
    assert e.json()["total"] == 5  # the swap is charged at the normal price
    after = _product(c, A, prod)
    assert after["quantity"] == before["quantity"] - 1 and after.get("defective_quantity", 0) == before.get("defective_quantity", 0) + 1
    assert mf["id"] not in _pending_ids(c, D, include_scheduled=1)
    moves = c.get("/api/stock-movements", headers=A).json()
    assert next(m for m in moves if m["id"] == mf["id"])["resolved_note"] == "Troca realizada"

    # Reversing the delivery puts the swap back as scheduled (not resolved) and removes the defective bottle.
    assert c.delete(f"/api/daily-entries/{e.json()['id']}", headers=D).status_code == 200
    assert _product(c, A, prod).get("defective_quantity", 0) == before.get("defective_quantity", 0)
    assert mf["id"] in _pending_ids(c, D, include_scheduled=1) and mf["id"] not in _pending_ids(c, D)
    assert c.post(f"/api/viagens/{v['id']}/finalizar", headers=D).status_code == 200


def test_schedule_mf_merges_into_existing_order_and_respects_load(c):
    A, D = _auth(c)
    prod, custs, mf = _pending_mf(c, A, D, "Agua T2", _day(4))
    v, rota1 = _trip(c, D, _day(5), carga=10)
    base = f"/api/viagens/{v['id']}/rotas"
    c.post(f"{base}/{rota1['id']}/clientes", json={"id": custs[0]["id"], "name": custs[0]["name"], "brand": "Agua T2", "quantity": 6, "notes": "portaria"}, headers=D)
    rota2 = c.post(base, json={"clientes": []}, headers=D).json()["rotas"][1]
    assert rota2["numero"] == 2

    # Asked on Rota 02, but the customer is already on Rota 01 -> merged there.
    r = c.post(f"{base}/{rota2['id']}/mf-troca", json={"movement_id": mf["id"]}, headers=D)
    assert r.status_code == 200, r.text
    rotas = r.json()["rotas"]
    cl = rotas[0]["clientes"][0]
    assert rotas[1]["clientes"] == [] and cl["quantity"] == 6 and cl["mf_swap_quantity"] == 1 and cl["mf_swap_movement_ids"] == [mf["id"]]
    assert cl["notes"].startswith("portaria · Troca de MF: levar 1 × Agua T2")

    # 6 ordered + 1 swap = 7 of 10: another 4 no longer fits, 3 does.
    other = {"id": custs[1]["id"], "name": custs[1]["name"], "brand": "Agua T2"}
    assert c.post(f"{base}/{rota2['id']}/clientes", json={**other, "quantity": 4}, headers=D).status_code == 400
    assert c.post(f"{base}/{rota2['id']}/clientes", json={**other, "quantity": 3}, headers=D).status_code == 200
    assert c.patch(f"{base}/{rota1['id']}/clientes/{custs[0]['id']}", json={"quantity": 7}, headers=D).status_code == 400


def test_schedule_mf_rejected_when_load_is_full(c):
    A, D = _auth(c)
    prod, custs, mf = _pending_mf(c, A, D, "Agua T3", _day(6))
    v, rota = _trip(c, D, _day(7), carga=5)
    base = f"/api/viagens/{v['id']}/rotas/{rota['id']}"
    c.post(f"{base}/clientes", json={"id": custs[1]["id"], "name": custs[1]["name"], "brand": "Agua T3", "quantity": 5}, headers=D)
    r = c.post(f"{base}/mf-troca", json={"movement_id": mf["id"]}, headers=D)
    assert r.status_code == 400 and "passa da carga" in r.json()["detail"]
    assert mf["id"] in _pending_ids(c, D)


def test_unschedule_when_removed_failed_or_trip_gone(c):
    A, D = _auth(c)
    prod, custs, mf = _pending_mf(c, A, D, "Agua T4", _day(8))
    cid = custs[0]["id"]

    def schedule(day, turno):
        v, rota = _trip(c, D, day, turno=turno)
        assert c.post(f"/api/viagens/{v['id']}/rotas/{rota['id']}/mf-troca", json={"movement_id": mf["id"]}, headers=D).status_code == 200
        assert mf["id"] not in _pending_ids(c, D)
        return v, rota

    v, rota = schedule(_day(9), 0)  # remove the client from the route
    assert c.delete(f"/api/viagens/{v['id']}/rotas/{rota['id']}/clientes/{cid}", headers=D).status_code == 200
    assert mf["id"] in _pending_ids(c, D)

    v, rota = schedule(_day(9), 1)  # delete the route
    assert c.delete(f"/api/viagens/{v['id']}/rotas/{rota['id']}", headers=D).status_code == 200
    assert mf["id"] in _pending_ids(c, D)

    v, rota = schedule(_day(10), 0)  # delete the trip
    assert c.delete(f"/api/viagens/{v['id']}", headers=D).status_code == 200
    assert mf["id"] in _pending_ids(c, D)

    v, rota = schedule(_day(10), 1)  # not delivered
    cl = c.patch(f"/api/viagens/{v['id']}/rotas/{rota['id']}/clientes/{cid}", json={"status": "nao_entregue"}, headers=D).json()["rotas"][0]["clientes"][0]
    assert cl["status"] == "nao_entregue" and "mf_swap_movement_ids" not in cl
    assert mf["id"] in _pending_ids(c, D)

    v, rota = schedule(_day(11), 0)  # trip finished without delivering to that customer
    assert c.post(f"/api/viagens/{v['id']}/iniciar", headers=D).status_code == 200
    assert c.post(f"/api/viagens/{v['id']}/finalizar", headers=D).status_code == 200
    assert mf["id"] in _pending_ids(c, D)
