"""Mapa das rotas: CEP e posição do cliente no cadastro, e o ponto de saída (depósito) das rotas."""
from test_mf_troca_viagem import _auth


def test_cliente_guarda_cep_e_posicao(c):
    A, D = _auth(c)
    r = c.post("/api/customers", json={"name": "Mapa Cliente", "address": "Rua do Tororó, 18 - Manaus/AM", "cep": "69042580", "lat": -3.08, "lng": -60.05}, headers=A)
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    r = c.patch(f"/api/customers/{cid}", json={"lat": -3.09, "lng": -60.06}, headers=A)
    assert r.status_code == 200 and r.json()["lat"] == -3.09 and r.json()["cep"] == "69042580"
    # O entregador lê a posição para montar o mapa.
    row = next(x for x in c.get("/api/customers", headers=D).json() if x["id"] == cid)
    assert (row["lat"], row["lng"]) == (-3.09, -60.06)


def test_deposito_so_admin_altera(c):
    A, D = _auth(c)
    assert c.get("/api/settings/deposito", headers=D).json() == {}
    body = {"cep": "69042580", "address": "Rua do Tororó - Manaus/AM", "lat": -3.08, "lng": -60.05}
    assert c.put("/api/settings/deposito", json=body, headers=D).status_code == 403
    r = c.put("/api/settings/deposito", json=body, headers=A)
    assert r.status_code == 200 and r.json()["address"] == body["address"]
    assert c.put("/api/settings/deposito", json={**body, "lat": 200}, headers=A).status_code == 400
    r = c.put("/api/settings/deposito", json={**body, "address": "Novo"}, headers=A)
    got = c.get("/api/settings/deposito", headers=D).json()
    assert got["address"] == "Novo" and got["lat"] == -3.08


def test_entregador_informa_local_do_cliente_sem_cep(c):
    A, D = _auth(c)
    cid = c.post("/api/customers", json={"name": "Mapa Sem CEP", "address": "Beco Rabi, 18"}, headers=A).json()["id"]
    # O entregador não edita o cadastro, mas pode marcar o local de entrega.
    assert c.patch(f"/api/customers/{cid}", json={"name": "Outro"}, headers=D).status_code == 403
    r = c.patch(f"/api/customers/{cid}/localizacao", json={"cep": "69042-580", "lat": -3.1, "lng": -60.0}, headers=D)
    assert r.status_code == 200, r.text
    doc = r.json()
    assert (doc["cep"], doc["lat"], doc["lng"], doc["name"]) == ("69042580", -3.1, -60.0, "Mapa Sem CEP")
    # Só o pino, sem CEP, também vale.
    r = c.patch(f"/api/customers/{cid}/localizacao", json={"lat": -3.2, "lng": -60.1}, headers=D)
    assert r.json()["lat"] == -3.2 and r.json()["cep"] == "69042580"
    assert c.patch(f"/api/customers/{cid}/localizacao", json={"cep": "123", "lat": -3.2, "lng": -60.1}, headers=D).status_code == 400
    assert c.patch("/api/customers/nao-existe/localizacao", json={"lat": -3.2, "lng": -60.1}, headers=D).status_code == 404
