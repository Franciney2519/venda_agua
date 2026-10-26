"""Carga por produto = carga total, despesa do entregador entra aprovada e o histórico registra a operação da rota."""
from test_mf_troca_viagem import _auth, _day


def _setup(c, A, name):
    prod = c.post("/api/products", json={"name": name, "brand": name, "category": "Retornável", "quantity": 100, "minimum": 1, "unit": "un"}, headers=A).json()
    outro = c.post("/api/products", json={"name": name + " B", "brand": name + " B", "category": "Retornável", "quantity": 100, "minimum": 1, "unit": "un"}, headers=A).json()
    cust = c.post("/api/customers", json={"name": f"{name} Cliente", "brands": [{"brand": name, "price": 5}, {"brand": name + " B", "price": 6}]}, headers=A).json()
    return prod, outro, cust


def test_carga_total_must_match_products(c):
    A, D = _auth(c)
    _setup(c, A, "Agua CT")
    r = c.post("/api/viagens", json={"turno": 0, "date": _day(200), "carga_total": 40, "carga_items": [{"brand": "Agua CT", "quantity": 20}], "create_first_rota": True}, headers=D)
    assert r.status_code == 400 and "soma da carga por produto (20 un)" in r.json()["detail"]
    v = c.post("/api/viagens", json={"turno": 0, "date": _day(200), "carga_items": [{"brand": "Agua CT", "quantity": 20}], "create_first_rota": True}, headers=D).json()
    assert v["carga_total"] == 20
    assert c.patch(f"/api/viagens/{v['id']}", json={"carga_total": 30}, headers=A).status_code == 400
    assert c.patch(f"/api/viagens/{v['id']}", json={"carga_total": 20}, headers=A).status_code == 200
    # Rota só com carga geral continua editável.
    g = c.post("/api/viagens", json={"turno": 1, "date": _day(200), "carga_total": 10, "create_first_rota": True}, headers=D).json()
    assert c.patch(f"/api/viagens/{g['id']}", json={"carga_total": 15}, headers=A).json()["carga_total"] == 15


def test_limit_message_names_product_outside_load(c):
    A, D = _auth(c)
    _, _, cust = _setup(c, A, "Agua FC")
    v = c.post("/api/viagens", json={"turno": 0, "date": _day(201), "carga_items": [{"brand": "Agua FC", "quantity": 1}], "create_first_rota": True}, headers=D).json()
    rota = v["rotas"][0]
    r = c.post(f"/api/viagens/{v['id']}/rotas/{rota['id']}/clientes", headers=D, json={
        "id": cust["id"], "name": cust["name"], "quantity": 2,
        "items": [{"brand": "Agua FC", "quantity": 1}, {"brand": "Agua FC B", "quantity": 1}]})
    assert r.status_code == 400  # o bloqueio pela carga total continua
    detail = r.json()["detail"]
    assert "Resta 1 un disponível" in detail and "Agua FC B não está na carga por produto" in detail


def test_driver_expense_enters_approved_and_activity_log(c):
    A, D = _auth(c)
    prod, _, cust = _setup(c, A, "Agua AT")
    v = c.post("/api/viagens", json={"turno": 1, "date": _day(202), "carga_items": [{"brand": "Agua AT", "quantity": 5}], "create_first_rota": True}, headers=D).json()
    rota = v["rotas"][0]
    c.post(f"/api/viagens/{v['id']}/rotas/{rota['id']}/clientes", json={"id": cust["id"], "name": cust["name"], "brand": "Agua AT", "quantity": 1}, headers=D)
    assert c.post(f"/api/viagens/{v['id']}/iniciar", headers=D).status_code == 200
    e = c.post("/api/daily-entries", json={"customer": cust["name"], "date": _day(202), "viagem_id": v["id"], "rota_id": rota["id"], "cash_value": 5,
                                           "items": [{"brand": "Agua AT", "quantity": 1, "price": 5, "sale_type": "exchange"}]}, headers=D)
    assert e.status_code == 200, e.text
    # O app não decide o status: mesmo mandando "pending" ou "rejected", a despesa do entregador entra aprovada.
    x = c.post("/api/expenses", json={"type": "Combustível", "amount": 7, "viagem_id": v["id"], "status": "rejected"}, headers=D).json()
    assert x["status"] == "approved"
    # Admin continua podendo recusar.
    assert c.patch(f"/api/expenses/{x['id']}", json={"status": "rejected"}, headers=A).json()["status"] == "rejected"
    # A rota só encerra com todos os clientes atendidos; depois o admin corrige o que precisar.
    assert c.post(f"/api/viagens/{v['id']}/finalizar", headers=D).status_code == 200
    assert c.delete(f"/api/daily-entries/{e.json()['id']}", headers=A).status_code == 200
    assert c.delete(f"/api/expenses/{x['id']}", headers=A).status_code == 200
    actions = [a["action"] for a in c.get("/api/activity", headers=A).json() if a.get("target_id") in (v["id"], e.json()["id"], x["id"])]
    for expected in ("viagem_criada", "viagem_iniciada", "entrega_lancada", "despesa_lancada", "entrega_excluida", "despesa_excluida", "viagem_finalizada"):
        assert expected in actions, (expected, actions)
