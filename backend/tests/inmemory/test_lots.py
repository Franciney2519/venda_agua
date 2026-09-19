"""Purchase lots: codes, FIFO cost consumption, edit/delete give lots back, validations."""
from datetime import date as _d, timedelta as _td

import server
from conftest import Checker
import json

def test_lots(c):
    check = Checker()
    def note(msg): pass
    A = {"Authorization": "Bearer " + c.post("/api/auth/login", json={"email": "admin@t.com", "password": "admin123"}).json()["token"]}
    D = {"Authorization": "Bearer " + c.post("/api/auth/login", json={"email": "carlos@t.com", "password": "driver123"}).json()["token"]}
    today = server.today_local()
    ddmmaa = server.datetime.fromisoformat(today).strftime("%d%m%y")
    c.post("/api/brands", json={"name": "Agua X", "cost_price": 1.0, "cost_price_full": 4.0}, headers=A)
    prod = c.post("/api/products", json={"name": "Agua X", "brand": "Agua X", "quantity": 0, "minimum": 10, "unit": "un"}, headers=A).json()
    pid = prod["id"]
    prod_q = lambda: next(p for p in c.get("/api/products", headers=A).json() if p["id"] == pid)
    lots = lambda **kw: c.get("/api/lots", headers=A, params=kw).json()

    # compra mais ANTIGA registrada depois (FIFO deve seguir a data de compra, não a ordem de cadastro)
    l2 = c.post(f"/api/products/{pid}/lots", json={"quantity": 50, "cost_price": 3.0, "purchase_date": today}, headers=A).json()
    l1 = c.post(f"/api/products/{pid}/lots", json={"quantity": 100, "cost_price": 2.0, "purchase_date": "2026-09-10"}, headers=A).json()
    l3 = c.post(f"/api/products/{pid}/lots", json={"quantity": 2650, "cost_price": 2.5, "purchase_date": today}, headers=A).json()
    check("código lote 1 (ddmmaa+qtd+seq do dia 10/09)", l1["code"], "100926" + "100" + "001")
    check("código lote 2 (1ª compra do dia)", l2["code"], ddmmaa + "50" + "001")
    check("código lote 3 (2ª compra do dia)", l3["code"], ddmmaa + "2650" + "002")
    check("estoque soma compras", prod_q()["quantity"], 2800)
    check("custo do produto = última compra", prod_q()["cost_price"], 2.5)
    check("custo da marca atualizado", next(b for b in c.get("/api/brands", headers=A).json() if b["name"] == "Agua X")["cost_price"], 2.5)
    hist = c.get("/api/brands/cost-history", headers=A).json()
    check("histórico de custo registra mudanças (1.0->3.0, 3.0->2.0, 2.0->2.5)", len([h for h in hist if h["field"] == "cost_price"]), 3)

    def sale(q, price=5, st="exchange", h=A):
        r = c.post("/api/daily-entries", json={"customer": "Cli", "items": [{"brand": "Agua X", "quantity": q, "price": price, "sale_type": st}], "cash_value": q * price}, headers=h)
        assert r.status_code == 200, r.text
        return r.json()
    remaining = lambda: {l["code"]: l["quantity_remaining"] for l in lots()}
    e1 = sale(120)   # 100 do lote 10/09 (R$2) + 20 do lote de hoje #001 (R$3)
    check("custo médio ponderado (100*2+20*3)/120", e1["items"][0]["cost_unit"], (200 + 60) / 120)
    check("lote antigo zerado", remaining()[l1["code"]], 0)
    check("lote 001 baixou 20", remaining()[l2["code"]], 30)
    check("lote 002 intacto", remaining()[l3["code"]], 2650)
    mg = c.get("/api/reports/margin", headers=A, params={"start": today, "end": today}).json()
    row = next(r for r in mg["rows"] if r["brand"] == "Agua X")
    check("margem usa custo dos lotes (600-260)", row["margin_value"], 340)

    # venda "completa" usa custo full do lote quando existir; senão o custo normal do lote
    l4 = c.post(f"/api/products/{pid}/lots", json={"quantity": 10, "cost_price": 9.0, "cost_price_full": 12.0, "purchase_date": today}, headers=A).json()
    e2 = sale(2650 + 30 + 5, st="full")  # 30 (lote 001, sem full=3) + 2650 (lote 002, sem full=2.5) + 5 do lote 003 (full=12)
    exp = (30 * 3 + 2650 * 2.5 + 5 * 12) / 2685
    check("venda completa: custo full só onde o lote tem", e2["items"][0]["cost_unit"], exp)
    check("lote 003 baixou 5", remaining()[l4["code"]], 5)

    # editar reduz a venda 1 -> devolve aos lotes e realoca
    r = c.patch(f"/api/daily-entries/{e1['id']}", json={"items": [{"brand": "Agua X", "quantity": 100, "price": 5, "sale_type": "exchange"}], "cash_value": 500}, headers=A)
    check("editar venda 200", r.status_code, 200)
    e1b = r.json()
    check("após editar, custo 100% lote antigo", e1b["items"][0]["cost_unit"], 2.0)

    # excluir devolve estoque aos lotes
    before = remaining()
    check("excluir venda", c.delete(f"/api/daily-entries/{e2['id']}", headers=A).status_code, 200)
    after = remaining()
    check("lote 003 voltou a 10", after[l4["code"]], 10)
    check("lote 002 voltou a 2650", after[l3["code"]], 2650)

    # estoque além dos lotes usa custo do cadastro como reserva
    e3 = sale(2650 + 50 + 10 + 10)  # esgota todos os lotes (30+2650+10=2690 restantes... +10 sem lote)
    left = sum(remaining().values())
    check("todos lotes zerados", left, 0)
    check("parte sem lote usa custo do cadastro (custo médio > 0)", e3["items"][0]["cost_unit"] > 0, True)

    # excluir lote: vendido não pode; intacto pode e desfaz estoque
    check("excluir lote vendido => 409", c.delete(f"/api/lots/{l1['id']}", headers=A).status_code, 409)
    l5 = c.post(f"/api/products/{pid}/lots", json={"quantity": 7, "cost_price": 1.0, "purchase_date": today}, headers=A).json()
    q_before = prod_q()["quantity"]
    check("excluir lote intacto", c.delete(f"/api/lots/{l5['id']}", headers=A).status_code, 200)
    check("estoque desfeito ao excluir lote", prod_q()["quantity"], q_before - 7)

    # lote de saldo anterior não mexe no estoque
    q0 = prod_q()["quantity"]
    l6 = c.post(f"/api/products/{pid}/lots", json={"quantity": 30, "cost_price": 2.0, "purchase_date": "2026-09-01", "adjust_stock": False}, headers=A).json()
    check("saldo anterior não soma estoque", prod_q()["quantity"], q0)

    # validações e permissões
    check("quantidade 0 => 400", c.post(f"/api/products/{pid}/lots", json={"quantity": 0, "cost_price": 1}, headers=A).status_code, 400)
    check("data inválida => 400", c.post(f"/api/products/{pid}/lots", json={"quantity": 1, "cost_price": 1, "purchase_date": "xx"}, headers=A).status_code, 400)
    check("entregador não cria lote", c.post(f"/api/products/{pid}/lots", json={"quantity": 1, "cost_price": 1}, headers=D).status_code, 403)
    check("entregador não lista lotes", c.get("/api/lots", headers=D).status_code, 403)
    mov = [m for m in c.get("/api/stock-movements", headers=A).json() if m["reason"] == "compra"]
    check("movimentações de compra com código do lote", all(m.get("lot_code") for m in mov) and len(mov) >= 4, True)
    check.assert_ok()
