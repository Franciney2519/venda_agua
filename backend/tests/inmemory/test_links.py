"""Cadastros e histórico continuam ligados: renomear não solta os registros, nomes não se repetem, listas não cortam dados."""
import server


def _login(c, email, password):
    return {"Authorization": "Bearer " + c.post("/api/auth/login", json={"email": email, "password": password}).json()["token"]}


def _admin(c): return _login(c, "admin@t.com", "admin123")


def test_renaming_a_driver_keeps_their_history(c):
    H = _admin(c)
    u = c.post("/api/users", json={"name": "Zeca Antigo", "email": "zeca@t.com", "password": "zeca123"}, headers=H).json()
    D = _login(c, "zeca@t.com", "zeca123")
    viagem = c.post("/api/viagens", json={"turno": 0, "create_first_rota": True}, headers=D).json()
    entry = c.post("/api/daily-entries", json={"customer": "Cli Zeca", "items": [{"brand": "Sem Estoque", "quantity": 2, "price": 5}], "cash_value": 10, "viagem_id": viagem["id"]}, headers=D)
    assert entry.status_code == 200, entry.text
    c.post("/api/expenses", json={"type": "Combustível", "amount": 7, "viagem_id": viagem["id"]}, headers=D)

    assert c.patch(f"/api/users/{u['id']}", json={"name": "Zeca Novo"}, headers=H).status_code == 200

    assert [e["driver"] for e in c.get("/api/daily-entries", headers=D).json()] == ["Zeca Novo"]
    assert [v["driver"] for v in c.get("/api/viagens", headers=D).json()["viagens"]] == ["Zeca Novo"]
    assert [e["amount"] for e in c.get("/api/expenses", headers=D).json()] == [7]
    assert c.post(f"/api/viagens/{viagem['id']}/iniciar", headers=D).status_code == 200


def test_renaming_a_customer_keeps_their_history(c):
    H = _admin(c)
    cust = c.post("/api/customers", json={"name": "Mercado Velho", "brand": "Sem Estoque", "price": 5}, headers=H).json()
    viagem = c.post("/api/viagens", json={"turno": 1}, headers=H).json()
    c.post(f"/api/viagens/{viagem['id']}/rotas", json={"clientes": [{"id": cust["id"], "name": "Mercado Velho", "brand": "Sem Estoque", "quantity": 3}]}, headers=H)
    c.post("/api/daily-entries", json={"customer": "Mercado Velho", "items": [{"brand": "Sem Estoque", "quantity": 3, "price": 5}], "cash_value": 15}, headers=H)

    assert c.patch(f"/api/customers/{cust['id']}", json={"name": "Mercado Novo"}, headers=H).status_code == 200

    assert len(c.get("/api/daily-entries", headers=H, params={"customer": "Mercado Novo"}).json()) == 1
    assert c.get("/api/daily-entries", headers=H, params={"customer": "Mercado Velho"}).json() == []
    rotas = next(v for v in c.get("/api/viagens", headers=H).json()["viagens"] if v["id"] == viagem["id"])["rotas"]
    assert rotas[0]["clientes"][0]["name"] == "Mercado Novo"
    # editar outro campo não mexe no nome nem no histórico
    assert c.patch(f"/api/customers/{cust['id']}", json={"phone": "92 99999-0000"}, headers=H).json()["name"] == "Mercado Novo"


def test_duplicate_names_are_blocked(c):
    H = _admin(c)
    assert c.post("/api/customers", json={"name": "Padaria Sol"}, headers=H).status_code == 200
    assert c.post("/api/customers", json={"name": " padaria sol "}, headers=H).status_code == 409
    other = c.post("/api/customers", json={"name": "Padaria Lua"}, headers=H).json()
    assert c.patch(f"/api/customers/{other['id']}", json={"name": "Padaria Sol"}, headers=H).status_code == 409

    assert c.post("/api/users", json={"name": "Ana Lima", "email": "ana1@t.com", "password": "ana1234"}, headers=H).status_code == 200
    assert c.post("/api/users", json={"name": "ana lima", "email": "ana2@t.com", "password": "ana1234"}, headers=H).status_code == 409
    assert c.post("/api/auth/signup", json={"name": "Ana Lima", "email": "ana3@t.com", "password": "ana1234"}).status_code == 409


def test_cadastro_lists_are_not_capped_and_expenses_are_scoped(c):
    H = _admin(c)
    D = _login(c, "carlos@t.com", "driver123")
    for i in range(205):
        c.post("/api/customers", json={"name": f"Cliente Lote {i:03d}"}, headers=H)
    assert sum(1 for x in c.get("/api/customers", headers=H).json() if x["name"].startswith("Cliente Lote")) == 205

    c.post("/api/expenses", json={"type": "Do admin", "amount": 3}, headers=H)
    c.post("/api/expenses", json={"type": "Do Carlos", "amount": 4}, headers=D)
    assert {e["type"] for e in c.get("/api/expenses", headers=D).json()} == {"Do Carlos"}
    assert {"Do admin", "Do Carlos"} <= {e["type"] for e in c.get("/api/expenses", headers=H).json()}
    # o painel mostra as despesas mais recentes, não as 200 mais antigas
    for _ in range(205):
        c.post("/api/expenses", json={"type": "Enchimento", "amount": 1}, headers=H)
    c.post("/api/expenses", json={"type": "A mais nova", "amount": 9}, headers=H)
    assert c.get("/api/dashboard", headers=H).json()["expenses_list"][-1]["type"] == "A mais nova"


def test_pending_stock_movements_survive_the_recent_window(c):
    H = _admin(c)
    prod = c.post("/api/products", json={"name": "Agua Pend", "brand": "Agua Pend", "category": "Retornável", "quantity": 5000, "minimum": 1, "unit": "un"}, headers=H).json()
    first = c.post("/api/daily-entries", json={"customer": "Cli Pend", "items": [{"brand": "Agua Pend", "quantity": 1, "price": 5}], "cash_value": 5}, headers=H).json()
    for _ in range(260):  # 2 movimentos por venda: passa das 500 mais recentes
        c.post("/api/daily-entries", json={"customer": "Cli Pend", "items": [{"brand": "Agua Pend", "quantity": 1, "price": 5}], "cash_value": 5}, headers=H)
    movements = c.get("/api/stock-movements", headers=H).json()
    assert any(m["entry_id"] == first["id"] and m["reason"] == "vasilhame_vazio" for m in movements)
    assert len({m["id"] for m in movements}) == len(movements)
    assert sum(m["quantity"] for m in movements if m["reason"] == "vasilhame_vazio" and not m["resolved"] and m["product_id"] == prod["id"]) == 261
