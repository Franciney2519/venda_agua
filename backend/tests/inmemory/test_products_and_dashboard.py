"""Product uniqueness and dashboard totals."""
import server


def _admin(c):
    r = c.post("/api/auth/login", json={"email": "admin@t.com", "password": "admin123"})
    return {"Authorization": "Bearer " + r.json()["token"]}


def test_duplicate_products_are_blocked(c):
    H = _admin(c)
    assert c.post("/api/products", json={"name": "Minalar", "brand": "Minalar", "quantity": 5}, headers=H).status_code == 200
    dup = c.post("/api/products", json={"name": " minalar ", "quantity": 5}, headers=H)
    assert dup.status_code == 409
    other = c.post("/api/products", json={"name": "Minalar 500ML", "brand": "Minalar 500ML", "quantity": 5}, headers=H)
    assert other.status_code == 200
    assert c.patch("/api/products/" + other.json()["id"], json={"name": "Minalar", "brand": "Minalar"}, headers=H).status_code == 409


def test_dashboard_month_expenses_not_capped_at_200(c):
    H = _admin(c)
    before = c.get("/api/dashboard", headers=H).json()["expenses"]
    for _ in range(230):
        c.post("/api/expenses", json={"type": "x", "amount": 1}, headers=H)
    assert c.get("/api/dashboard", headers=H).json()["expenses"] == before + 230


def test_sale_warnings_for_unmatched_brand_and_exhausted_lots(c):
    H = _admin(c)
    prod = c.post("/api/products", json={"name": "Agua W", "brand": "Agua W", "category": "Retornável", "quantity": 0, "minimum": 1, "unit": "un"}, headers=H).json()
    c.post(f"/api/products/{prod['id']}/lots", json={"quantity": 10, "cost_price": 2.0}, headers=H)

    def sale(brand, qty):
        r = c.post("/api/daily-entries", json={"customer": "Cli", "items": [{"brand": brand, "quantity": qty, "price": 5}], "cash_value": qty * 5}, headers=H)
        assert r.status_code == 200, r.text
        return r.json()

    assert "warnings" not in sale("Agua W", 4)
    over = sale("Agua W", 10)
    assert any("passaram do saldo dos lotes" in w for w in over["warnings"])
    unknown = sale("Marca Inexistente", 1)
    assert any("não está no Estoque" in w for w in unknown["warnings"])


def test_monthly_chart_is_admin_only_and_totals_not_truncated(c):
    H = _admin(c)
    D = {"Authorization": "Bearer " + c.post("/api/auth/login", json={"email": "carlos@t.com", "password": "driver123"}).json()["token"]}
    assert c.get("/api/dashboard/monthly", headers=D).status_code == 403
    assert c.get("/api/dashboard/monthly", headers=H).status_code == 200
    # more than the old 1000-expense cap in the report/CSV window
    for _ in range(1010):
        c.post("/api/expenses", json={"type": "y", "amount": 1}, headers=H)
    today = server.today_local()
    rp = c.get("/api/reports", headers=H, params={"start": today, "end": today}).json()
    assert rp["expenses"] >= 1010


def test_login_is_throttled_after_repeated_failures(c):
    server.LOGIN_FAILURES.clear()
    for _ in range(server.LOGIN_MAX_ATTEMPTS):
        assert c.post("/api/auth/login", json={"email": "admin@t.com", "password": "errada"}).status_code == 401
    assert c.post("/api/auth/login", json={"email": "admin@t.com", "password": "admin123"}).status_code == 429
    server.LOGIN_FAILURES.clear()
    assert c.post("/api/auth/login", json={"email": "admin@t.com", "password": "admin123"}).status_code == 200


def test_stock_csv_export(c):
    H = _admin(c)
    prod = c.post("/api/products", json={"name": "Agua CSV", "brand": "Agua CSV", "category": "Retornável", "quantity": 0, "minimum": 1, "unit": "un"}, headers=H).json()
    c.post(f"/api/products/{prod['id']}/lots", json={"quantity": 30, "cost_price": 2.5, "purchase_date": "2026-09-19"}, headers=H)
    r = c.get("/api/reports/export-stock.csv", headers=H)
    assert r.status_code == 200 and r.text.startswith("\ufeff")
    assert "Agua CSV" in r.text and "19092630" in r.text and "75.00" in r.text
    D = {"Authorization": "Bearer " + c.post("/api/auth/login", json={"email": "carlos@t.com", "password": "driver123"}).json()["token"]}
    assert c.get("/api/reports/export-stock.csv", headers=D).status_code == 403
