"""Clients with several products in one stop, and the admin building and fixing routes (even after the driver concluded them)."""
from test_mf_troca_viagem import _auth, _day, _trip


def test_client_with_several_products(c):
    A, D = _auth(c)
    cust = c.post("/api/customers", json={"name": "Cliente Multi", "brands": [{"brand": "Agua A", "price": 8, "price_full": 30}]}, headers=A).json()
    c.post("/api/brands", json={"name": "Agua B", "cost_price": 3, "price": 12}, headers=A)
    v, rota = _trip(c, D, _day(40), carga=20)
    url = f"/api/viagens/{v['id']}/rotas/{rota['id']}/clientes"
    items = [{"brand": "Agua A", "quantity": 3, "sale_type": "exchange"}, {"brand": "Agua A", "quantity": 1, "sale_type": "full"}, {"brand": "Agua B", "quantity": 2, "sale_type": "exchange"}]
    r = c.post(url, json={"id": cust["id"], "name": cust["name"], "items": items}, headers=D)
    assert r.status_code == 200, r.text
    cl = r.json()["rotas"][0]["clientes"][0]
    assert cl["quantity"] == 6 and cl["brand"] == "Agua A" and len(cl["items"]) == 3
    assert cl["items"][0]["price"] == 8 and cl["items"][1]["price_full"] == 30
    assert cl["items"][2]["out_of_catalog"] is True and cl["items"][2]["price"] == 12

    # One quantity for several products is ambiguous: each product is edited through items.
    assert c.patch(f"{url}/{cust['id']}", json={"quantity": 2}, headers=D).status_code == 400
    r = c.patch(f"{url}/{cust['id']}", json={"items": [{"brand": "Agua B", "quantity": 25, "sale_type": "exchange"}]}, headers=D)
    assert r.status_code == 400 and "passa da carga" in r.json()["detail"]
    cl = c.patch(f"{url}/{cust['id']}", json={"items": [{"brand": "Agua B", "quantity": 4, "sale_type": "exchange"}]}, headers=D).json()["rotas"][0]["clientes"][0]
    assert cl["quantity"] == 4 and cl["brand"] == "Agua B" and len(cl["items"]) == 1


def test_admin_edits_concluded_route_and_reassigns_driver(c):
    A, D = _auth(c)
    cust = c.post("/api/customers", json={"name": "Cliente Admin", "brands": [{"brand": "Agua C", "price": 6}]}, headers=A).json()

    driver = _trip(c, D, _day(42))[0]["driver"]

    # Admin builds the route for the driver and can still hand it to someone else before it starts.
    v = c.post("/api/viagens", json={"turno": 0, "date": _day(41), "driver": driver, "create_first_rota": True}, headers=A).json()
    rota = v["rotas"][0]
    assert c.post(f"/api/viagens/{v['id']}/rotas/{rota['id']}/clientes", json={"id": cust["id"], "name": cust["name"], "items": [{"brand": "Agua C", "quantity": 2}]}, headers=A).status_code == 200
    assert c.patch(f"/api/viagens/{v['id']}", json={"driver": "Outro"}, headers=A).json()["driver"] == "Outro"
    assert c.patch(f"/api/viagens/{v['id']}", json={"driver": driver}, headers=D).status_code == 403
    assert c.patch(f"/api/viagens/{v['id']}", json={"driver": driver}, headers=A).json()["driver"] == driver

    assert c.post(f"/api/viagens/{v['id']}/iniciar", headers=D).status_code == 200
    r = c.patch(f"/api/viagens/{v['id']}", json={"driver": "Outro"}, headers=A)
    assert r.status_code == 400
    assert c.post(f"/api/viagens/{v['id']}/finalizar", headers=D).status_code == 200

    # Concluded: locked for the driver, still editable by the admin.
    assert c.post(f"/api/viagens/{v['id']}/rotas", json={"clientes": []}, headers=D).status_code == 400
    r = c.post(f"/api/viagens/{v['id']}/rotas", json={"clientes": []}, headers=A)
    assert r.status_code == 200 and len(r.json()["rotas"]) == 2
    nova = r.json()["rotas"][1]
    assert c.post(f"/api/viagens/{v['id']}/rotas/{nova['id']}/clientes", json={"id": cust["id"] + "x", "name": "Outro Cliente", "brand": "Agua C", "quantity": 1}, headers=A).status_code == 200
    assert c.delete(f"/api/viagens/{v['id']}/rotas/{nova['id']}", headers=A).status_code == 200


def test_delivery_order_is_saved(c):
    A, D = _auth(c)
    v, rota = _trip(c, D, _day(43))
    url = f"/api/viagens/{v['id']}/rotas/{rota['id']}/clientes"
    for n in ("Um", "Dois", "Tres"):
        cust = c.post("/api/customers", json={"name": f"Ordem {n}", "brands": [{"brand": "Agua O", "price": 5}]}, headers=A).json()
        c.post(url, json={"id": cust["id"], "name": cust["name"], "brand": "Agua O", "quantity": 1}, headers=D)
    ids = [cl["id"] for cl in c.get("/api/viagens", params={"date": _day(43)}, headers=D).json()["viagens"][0]["rotas"][0]["clientes"]]
    wanted = [ids[2], ids[0], ids[1]]
    r = c.post(f"/api/viagens/{v['id']}/ordem", json={"clientes": [{"rota_id": rota["id"], "id": i} for i in wanted]}, headers=D)
    assert r.status_code == 200, r.text
    clientes = r.json()["rotas"][0]["clientes"]
    assert sorted(clientes, key=lambda x: x["ordem"]) == [next(x for x in clientes if x["id"] == i) for i in wanted]

    assert c.post(f"/api/viagens/{v['id']}/iniciar", headers=D).status_code == 200
    assert c.post(f"/api/viagens/{v['id']}/finalizar", headers=D).status_code == 200
    assert c.post(f"/api/viagens/{v['id']}/ordem", json={"clientes": []}, headers=D).status_code == 400
