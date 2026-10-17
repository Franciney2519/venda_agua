"""The margin report returns revenue, cost, gross profit and expenses so the screen can show margin, markup or net margin."""
from datetime import datetime, timedelta, timezone

from test_mf_troca_viagem import _auth


def test_margin_report_has_what_the_three_modes_need(c):
    A, D = _auth(c)
    today = datetime.now(timezone(timedelta(hours=-4))).date().isoformat()
    c.post("/api/brands", json={"name": "Agua Modos", "cost_price": 3}, headers=A)
    c.post("/api/products", json={"name": "Agua Modos", "brand": "Agua Modos", "category": "Retornável", "quantity": 100, "minimum": 1, "unit": "un"}, headers=A)
    c.post("/api/customers", json={"name": "Cliente Modos", "brands": [{"brand": "Agua Modos", "price": 10}]}, headers=A)
    e = c.post("/api/daily-entries", json={"customer": "Cliente Modos", "date": today, "cash_value": 50,
                                           "items": [{"brand": "Agua Modos", "quantity": 5, "price": 10, "sale_type": "exchange"}]}, headers=D)
    assert e.status_code == 200, e.text
    c.post("/api/expenses", json={"type": "Combustível", "amount": 7}, headers=A)

    mg = c.get("/api/reports/margin", headers=A, params={"start": today, "end": today}).json()
    row = next(r for r in mg["rows"] if r["brand"] == "Agua Modos")
    assert row["revenue"] == 50 and row["cost_total"] == 15 and row["margin_value"] == 35
    assert mg["margin_total"] >= 35 and mg["cost_total"] >= 15 and mg["expenses_total"] >= 7
    assert all("cost_total" in cat and "has_cost_revenue" in cat for cat in mg["categories"])
    week = mg["evolution"][-1]
    assert week["revenue"] >= 50 and week["cost_total"] >= 15 and week["margin_value"] >= 35 and week["expenses"] >= 7
