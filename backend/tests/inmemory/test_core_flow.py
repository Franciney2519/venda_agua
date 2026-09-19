"""Core flow: catalog, trip with load, sales, expenses, every admin screen, edit/delete, closing."""
from datetime import date as _d, timedelta as _td

import server
from conftest import Checker
import json

def test_core_flow(c):
    check = Checker()
    def note(msg): pass
    def login(e, p):
        r = c.post("/api/auth/login", json={"email": e, "password": p}); assert r.status_code == 200, r.text
        return {"Authorization": "Bearer " + r.json()["token"]}
    A = login("admin@t.com", "admin123"); D = login("carlos@t.com", "driver123")
    today = server.today_local()
    def post(h, url, body):
        r = c.post("/api" + url, json=body, headers=h); return r
    def get(h, url, **p): return c.get("/api" + url, headers=h, params=p)
    def patch(h, url, body): return c.patch("/api" + url, json=body, headers=h)

    # --- catalog ---
    # remove seed products
    brands = {}
    for name, cost, full in [("Garrafão 20L", 5.0, 8.0), ("Yara 1,5L", 1.0, None), ("Minalar 500ML", 0.5, None)]:
        b = {"name": name, "cost_price": cost}
        if full: b["cost_price_full"] = full
        brands[name] = post(A, "/brands", b).json()
    prods = {}
    for name in brands:
        prods[name] = post(A, "/products", {"name": name, "brand": name, "category": "Retornável", "quantity": 100, "minimum": 10, "unit": "un"}).json()
    cust = post(A, "/customers", {"name": "Cliente X", "address": "Rua 1"}).json()

    # --- viagem with carga ---
    v = post(D, "/viagens", {"turno": 0, "carga_items": [{"brand": "Garrafão 20L", "quantity": 10}, {"brand": "Yara 1,5L", "quantity": 5}]}).json()
    r = post(D, f"/viagens/{v['id']}/iniciar", {}); check("iniciar viagem", r.status_code, 200)
    stock = lambda n: next(p for p in get(A, "/products").json() if p["name"] == n)
    check("estoque Galão pós-carga", stock("Garrafão 20L")["quantity"], 90)
    check("estoque Yara pós-carga", stock("Yara 1,5L")["quantity"], 95)
    rota = post(D, f"/viagens/{v['id']}/rotas", {"clientes": []}).json()
    rota_id = rota["rotas"][0]["id"] if "rotas" in rota else None

    # --- entry A (driver, multi-item, comp) ---
    eA = post(D, "/daily-entries", {"customer": "Cliente X", "viagem_id": v["id"], "rota_id": rota_id, "items": [
        {"brand": "Garrafão 20L", "quantity": 3, "price": 10, "sale_type": "exchange"},
        {"brand": "Yara 1,5L", "quantity": 2, "price": 4, "sale_type": "full"}], "pix_value": 20, "cash_value": 6, "comp_value": 12, "comp_days": 10})
    check("entry A status", eA.status_code, 200); eA = eA.json()
    check("entry A total", eA["total"], 38)
    check("entry A cost_unit Galão (exchange=5)", eA["items"][0]["cost_unit"], 5.0)
    check("entry A cost_unit Yara (sem full -> cost)", eA["items"][1]["cost_unit"], 1.0)
    check("estoque Galão pós-venda (coberto pela carga, não muda)", stock("Garrafão 20L")["quantity"], 90)
    check("vazio Galão (exchange)", stock("Garrafão 20L").get("empty_quantity", 0), 3)
    check("vazio Yara (full não gera vazio)", stock("Yara 1,5L").get("empty_quantity", 0), 0)

    # --- entry B: legacy single-brand, MF swap, fora da carga (baixa estoque) ---
    eB = post(D, "/daily-entries", {"customer": "Cliente Y", "brand": "Minalar 500ML", "quantity": 10, "price": 2, "mf_quantity": 2, "mf_plan": "swap", "sale_type": "full", "pix_value": 20}).json()
    check("entry B total (8 cobrados + 2 swap cobrados)", eB["total"], 20)
    check("estoque Minalar (8 vendidos + 1 bom por MF swap x2 = 10 saem)", stock("Minalar 500ML")["quantity"], 90)
    check("Minalar defeituoso", stock("Minalar 500ML").get("defective_quantity", 0), 2)

    # --- entry C: fora do cadastro ---
    eC = post(D, "/daily-entries", {"customer": "Cliente X", "items": [{"brand": "Marca Nova", "quantity": 2, "price": 3, "out_of_catalog": True}], "cash_value": 6}).json()
    check("entry C total", eC["total"], 6)
    sm = [x for x in get(A, "/stock-movements").json() if x["reason"] == "sem_correspondencia"]
    check("mov. sem_correspondencia registrada", len(sm), 1)
    ooc = get(A, "/customers/out-of-catalog-brands").json()
    check("produtos fora do cadastro aparecem", len(ooc), 1)

    # --- bad payment must be rejected ---
    r = post(D, "/daily-entries", {"customer": "Z", "items": [{"brand": "Garrafão 20L", "quantity": 1, "price": 10}], "pix_value": 5})
    check("pagamento inconsistente => 400", r.status_code, 400)

    # --- expenses ---
    x1 = post(D, "/expenses", {"type": "Combustível", "amount": 15, "viagem_id": v["id"]}).json()
    x2 = post(D, "/expenses", {"type": "Lanche", "amount": 5}).json()
    x3 = post(D, "/expenses", {"type": "Multa", "amount": 100}).json()
    patch(A, f"/expenses/{x1['id']}", {"status": "approved"})
    patch(A, f"/expenses/{x3['id']}", {"status": "rejected"})
    # x2 remains pending

    total_rev = 38 + 20 + 6
    exp_ok = 15 + 5  # approved + pending (rejected excluded)

    # --- dashboard / monthly / finance / reports ---
    d = get(A, "/dashboard").json()
    check("dashboard revenue", d["revenue"], total_rev)
    check("dashboard expenses (sem rejeitadas)", d["expenses"], exp_ok)
    check("dashboard deliveries hoje", len(d["deliveries"]), 3)
    mo = get(A, "/dashboard/monthly").json()[-1]
    check("monthly revenue", mo["revenue"], total_rev); check("monthly expenses", mo["expenses"], exp_ok); check("monthly deliveries", mo["deliveries"], 3)
    f = get(A, "/finance/summary").json()
    check("finance received_today (pix+cash)", f["received_today"], 20 + 6 + 20 + 6)
    check("finance comp_today", f["comp_today"], 12)
    check("finance comp_pending", f["comp_pending_total"], 12)
    check("finance expenses_today", f["expenses_today_total"], exp_ok)
    check("finance pending expenses", f["expenses_pending_total"], 5)
    check("finance balance", f["balance_today"], 52 - exp_ok)
    fd = get(D, "/finance/summary").json()
    check("finance driver view == admin (mesmo entregador)", fd["received_today"], f["received_today"])
    rc = get(A, "/reports/receivables").json()
    check("receivables pending", rc["totals"]["pending"], 12)
    check("receivables due_date", rc["rows"][0]["due_date"], (server.datetime.fromisoformat(today) + server.timedelta(days=10)).date().isoformat())
    dc = get(A, "/daily-closing").json()
    check("daily-closing revenue", dc["totals"]["revenue"], total_rev)
    check("daily-closing pix", dc["totals"]["pix"], 40); check("daily-closing cash", dc["totals"]["cash"], 12); check("daily-closing comp", dc["totals"]["comp"], 12)
    check("daily-closing expenses_approved", dc["totals"]["expenses_approved"], 15)
    check("daily-closing expenses_pending", dc["totals"]["expenses_pending"], 5)
    rp = get(A, "/reports", start=today, end=today).json()
    check("reports revenue", rp["revenue"], total_rev); check("reports expenses", rp["expenses"], exp_ok); check("reports deliveries", rp["deliveries"], 3)

    # --- margin ---
    # Galão exch: rev 30 cost 15 -> 15; Yara full(no full cost->1): rev 8 cost 2 -> 6; Minalar full (no full -> 0.5), qty 8+2=10 rev 20 cost 5 -> 15; Marca Nova no cost
    mg = get(A, "/reports/margin", start=today, end=today).json()
    rows = {r["brand"]: r for r in mg["rows"]}
    check("margin Galão", rows["Garrafão 20L"]["margin_value"], 15)
    check("margin Yara", rows["Yara 1,5L"]["margin_value"], 6)
    check("margin Minalar (qty inclui swap)", rows["Minalar 500ML"]["margin_value"], 15)
    check("margin Minalar qty", rows["Minalar 500ML"]["quantity"], 10)
    check("margin Marca Nova sem custo", rows["Marca Nova"]["status"], "sem_custo")
    check("margin revenue_total", mg["revenue_total"], total_rev)
    check("margin lucro_liquido = margem - despesas", mg["lucro_liquido"], 36 - exp_ok)
    check("margin expenses_total", mg["expenses_total"], exp_ok)
    cu = {r["customer"]: r for r in mg["customers"]}
    check("margin cliente X receita", cu["Cliente X"]["revenue"], 44); check("margin cliente Y receita", cu["Cliente Y"]["revenue"], 20)
    check("soma clientes == soma marcas", round(sum(r["revenue"] for r in mg["customers"]), 2), mg["revenue_total"])

    # --- custo travado: mudar custo do cadastro não muda vendas antigas ---
    patch(A, f"/brands/{brands['Garrafão 20L']['id']}", {"cost_price": 9.0})
    mg2 = get(A, "/reports/margin", start=today, end=today).json()
    check("custo travado (Galão margem igual após reajuste)", {r["brand"]: r for r in mg2["rows"]}["Garrafão 20L"]["margin_value"], 15)
    ch = get(A, "/brands/cost-history").json(); check("histórico de custo registrado", len(ch), 1)

    # --- profit-by-brand / customer: consistência com margin ---
    pb = get(A, "/reports/profit-by-brand", start=today, end=today).json()
    pbr = {r["brand"]: r for r in pb["rows"]}
    print("profit-by-brand:", json.dumps({k: {x: round(y, 2) for x, y in v.items() if x != "brand"} for k, v in pbr.items()}))
    check("profit-by-brand Galão lucro == margin (15)", round(pbr["Garrafão 20L"]["profit"], 2), 15)
    check("profit-by-brand Minalar lucro == margin (15)", round(pbr["Minalar 500ML"]["profit"], 2), 15)
    check("profit-by-brand receita total == margin revenue_total", round(pb["totals"]["revenue"], 2), mg["revenue_total"])

    # --- finalizar viagem ---
    r = post(D, f"/viagens/{v['id']}/finalizar", {}); check("finalizar", r.status_code, 200); vf = r.json()
    check("viagem total_bruto (só entregas ligadas a viagem)", vf["total_bruto"], 38)
    check("viagem despesas_total", vf["despesas_total"], 15)
    check("viagem saldo_liquido", vf["saldo_liquido"], 23)
    check("carga devolvida Galão(10-3=7)+Yara(5-2=3)", vf["carga_devolvida_total"], 10)
    check("estoque Galão pós-retorno", stock("Garrafão 20L")["quantity"], 97)
    check("estoque Yara pós-retorno", stock("Yara 1,5L")["quantity"], 98)

    # --- editar entry A (admin): 3 -> 1 galão ---
    r = patch(A, f"/daily-entries/{eA['id']}", {"items": [{"brand": "Garrafão 20L", "quantity": 1, "price": 10, "sale_type": "exchange"}, {"brand": "Yara 1,5L", "quantity": 2, "price": 4, "sale_type": "full"}], "pix_value": 6, "cash_value": 0, "comp_value": 12})
    check("editar entry A", r.status_code, 200)
    d = get(A, "/dashboard").json(); check("dashboard revenue após edição", d["revenue"], 64 - 20)
    check("vazio Galão após edição", stock("Garrafão 20L").get("empty_quantity", 0), 1)
    mg3 = get(A, "/reports/margin", start=today, end=today).json()
    check("margin Galão após edição (custo travado 5)", {r["brand"]: r for r in mg3["rows"]}["Garrafão 20L"]["margin_value"], 5)

    # --- excluir entry B (admin): estoque e MF revertem ---
    r = c.delete(f"/api/daily-entries/{eB['id']}", headers=A); check("excluir entry B", r.status_code, 200)
    check("estoque Minalar revertido", stock("Minalar 500ML")["quantity"], 100)
    check("Minalar defeituoso revertido", stock("Minalar 500ML").get("defective_quantity", 0), 0)
    d = get(A, "/dashboard").json(); check("dashboard revenue após exclusão", d["revenue"], 44 - 20)
    check("dashboard deliveries", len(d["deliveries"]), 2)

    # --- fechamento do dia ---
    r = post(D, "/daily-closing/close", {}); check("fechar dia", r.status_code, 200)
    r = post(D, "/daily-entries", {"customer": "Z", "items": [{"brand": "Garrafão 20L", "quantity": 1, "price": 10}], "cash_value": 10}); check("lançar em dia fechado (driver) => 409", r.status_code, 409)
    dc2 = get(A, "/daily-closing").json(); check("closing marcado fechado", dc2["drivers"][0].get("is_closed"), True)
    check("closing revenue == dashboard", dc2["totals"]["revenue"], 24)

    # --- security probes ---
    me = get(A, "/auth/me").json(); check("auth/me NÃO expõe password_hash", "password_hash" in me, False)
    check("driver não acessa margem", get(D, "/reports/margin").status_code, 403)
    check("driver não vê lançamentos de outros", len([e for e in get(D, "/daily-entries").json() if e["driver"] != "Carlos Mendes"]), 0)

    # --- csv ---
    csvr = get(A, "/reports/export.csv", start=today, end=today); check("csv ok", csvr.status_code, 200)
    check.assert_ok()
