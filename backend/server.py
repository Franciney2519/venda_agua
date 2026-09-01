from dotenv import load_dotenv
from pathlib import Path
import os, uuid, logging, bcrypt, jwt, re
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import FastAPI, APIRouter, HTTPException, Request, Depends, Response
from fastapi.responses import PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
import csv, io

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
app = FastAPI(title="Distribuidora Diane API")
api = APIRouter(prefix="/api")
JWT_ALGORITHM = "HS256"

@api.get("/ping")
async def ping():
    await db.command("ping")
    return {"status": "ok"}

class LoginInput(BaseModel):
    email: str
    password: str

class SignupInput(BaseModel):
    name: str
    email: str
    password: str

class UserInput(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    status: Optional[str] = None
    phone: Optional[str] = None

class ResourceInput(BaseModel):
    name: Optional[str] = None
    customer: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    driver: Optional[str] = None
    quantity: Optional[int] = 1
    value: Optional[float] = 0
    type: Optional[str] = None
    amount: Optional[float] = 0
    category: Optional[str] = None
    minimum: Optional[int] = 10
    status: Optional[str] = "pending"
    signature: Optional[str] = None
    signature_name: Optional[str] = None
    notes: Optional[str] = None
    brand: Optional[str] = None
    price: Optional[float] = None
    brands: Optional[List[dict]] = None
    cost_price: Optional[float] = None
    date: Optional[str] = None
    trip_number: Optional[str] = None
    mf_quantity: Optional[float] = None
    comp_value: Optional[float] = None
    comp_days: Optional[int] = None
    pix_value: Optional[float] = None
    cash_value: Optional[float] = None
    received: Optional[bool] = None
    items: Optional[List[dict]] = None
    mf_plan: Optional[str] = None
    mf_date: Optional[str] = None
    batch: Optional[str] = None
    purchase_date: Optional[str] = None
    payment_type: Optional[str] = None
    code: Optional[str] = None
    unit: Optional[str] = None
    units_per_package: Optional[float] = None
    sale_type: Optional[str] = None
    active: Optional[bool] = None
    viagem_id: Optional[str] = None

class ViagemInput(BaseModel):
    turno: int  # 0 = manhã, 1 = tarde
    rota: int
    date: Optional[str] = None
    carga_total: Optional[int] = None
    notes: Optional[str] = None
    driver: Optional[str] = None  # admin only: criar viagem para outro entregador
    clientes: Optional[List[dict]] = None  # clientes do cadastro incluídos nesta rota

MANAUS_TZ = timezone(timedelta(hours=-4))  # America/Manaus, no DST
def now(): return datetime.now(timezone.utc).isoformat()
def now_local(): return datetime.now(MANAUS_TZ)
def today_local(): return now_local().date().isoformat()
def local_day_start_utc(day_str): return datetime.fromisoformat(day_str).replace(tzinfo=MANAUS_TZ).astimezone(timezone.utc).isoformat()
def local_day_end_utc(day_str): return (datetime.fromisoformat(day_str).replace(tzinfo=MANAUS_TZ) + timedelta(days=1) - timedelta(microseconds=1)).astimezone(timezone.utc).isoformat()

async def expenses_for_day(day_str, driver=None):
    """Despesas lançadas no dia local (por created_at), com o mesmo recorte de fuso em todo o app."""
    query = {"created_at": {"$gte": local_day_start_utc(day_str), "$lte": local_day_end_utc(day_str)}}
    if driver: query["driver"] = driver
    return await db.expenses.find(query, {"_id": 0}).to_list(2000)
def entry_total(e): return float(e.get("total") or 0)
async def next_sequence(name):
    doc = await db.counters.find_one_and_update({"_id": name}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
    return doc["seq"]
def hash_password(password): return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
def check_password(password, hashed): return bcrypt.checkpw(password.encode(), hashed.encode())
def token_for(user): return jwt.encode({"sub": user["id"], "email": user["email"], "role": user["role"], "exp": datetime.now(timezone.utc)+timedelta(hours=12)}, os.environ["JWT_SECRET"], algorithm=JWT_ALGORITHM)

async def current_user(request: Request):
    token = request.headers.get("Authorization", "").replace("Bearer ", "") or request.cookies.get("access_token")
    if not token: raise HTTPException(401, "Sessão necessária")
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
        if not user: raise HTTPException(401, "Usuário não encontrado")
        return user
    except jwt.PyJWTError: raise HTTPException(401, "Sessão expirada")

async def admin_user(user=Depends(current_user)):
    if user.get("role") != "admin": raise HTTPException(403, "Acesso restrito ao administrador")
    return user

async def log_activity(action: str, actor, target=None, meta=None):
    await db.activity.insert_one({"id": str(uuid.uuid4()), "action": action, "actor_id": actor.get("id") if actor else None, "actor_name": actor.get("name") if actor else "sistema", "target_id": (target or {}).get("id"), "target_name": (target or {}).get("name"), "target_email": (target or {}).get("email"), "meta": meta or {}, "created_at": now()})

def sanitize_user(u):
    return {k: v for k, v in u.items() if k not in ("password_hash", "_id")}

@api.get("/")
async def root(): return {"message": "Distribuidora Diane online"}

@api.post("/auth/signup")
async def signup(data: SignupInput):
    email = data.email.lower().strip()
    if not email or len(data.password) < 6: raise HTTPException(400, "Informe e-mail válido e senha com ao menos 6 caracteres")
    if await db.users.find_one({"email": email}): raise HTTPException(409, "Este e-mail já está cadastrado")
    user = {"id": str(uuid.uuid4()), "email": email, "name": data.name.strip(), "role": "driver", "status": "pending", "active": False, "password_hash": hash_password(data.password), "created_at": now()}
    await db.users.insert_one(user)
    await log_activity("signup", {"id": user["id"], "name": user["name"]}, user, {"role": "driver"})
    return {"message": "Cadastro recebido. Aguarde a aprovação do administrador.", "status": "pending"}

@api.post("/auth/login")
async def login(data: LoginInput, response: Response):
    user = await db.users.find_one({"email": data.email.lower().strip()}, {"_id": 0})
    if not user or not check_password(data.password, user["password_hash"]): raise HTTPException(401, "E-mail ou senha inválidos")
    if user.get("status") == "pending": raise HTTPException(403, "Seu cadastro está aguardando aprovação do administrador")
    if user.get("status") == "rejected": raise HTTPException(403, "Cadastro não aprovado. Entre em contato com o administrador")
    if user.get("active") is False: raise HTTPException(403, "Conta desativada. Entre em contato com o administrador")
    user.pop("password_hash", None); access_token = token_for(user)
    response.set_cookie("access_token", access_token, httponly=True, secure=True, samesite="lax", max_age=43200)
    return {**user, "token": access_token}

@api.get("/auth/me")
async def me(user=Depends(current_user)): return user

@api.get("/dashboard")
async def dashboard(user=Depends(current_user)):
    now_dt = now_local()
    today = now_dt.date().isoformat()
    month_start = f"{now_dt.year:04d}-{now_dt.month:02d}-01"
    entries_today = await db.daily_entries.find({"date": today}, {"_id": 0}).sort("created_at", -1).to_list(200)
    entries_month = await db.daily_entries.find({"date": {"$gte": month_start}}, {"_id": 0}).to_list(5000)
    products = await db.products.find({}, {"_id": 0}).to_list(100)
    expenses = await db.expenses.find({}, {"_id": 0}).to_list(200)
    revenue = sum(entry_total(e) for e in entries_month)
    month_start_utc = local_day_start_utc(month_start)
    expenses_month = sum(float(e.get("amount", 0)) for e in expenses if (e.get("created_at") or "") >= month_start_utc and e.get("status") != "rejected")
    return {"revenue": revenue, "expenses": expenses_month, "deliveries": entries_today, "products": products, "expenses_list": expenses, "user": user}

MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

@api.get("/dashboard/monthly")
async def dashboard_monthly(months: int = 6, user=Depends(current_user)):
    months = max(1, min(24, months))
    _now = now_local()
    y, m = _now.year, _now.month
    keys = []
    for _ in range(months):
        keys.append((y, m))
        m -= 1
        if m == 0: m = 12; y -= 1
    keys.reverse()
    start = f"{keys[0][0]:04d}-{keys[0][1]:02d}-01"
    entries = await db.daily_entries.find({"date": {"$gte": start}}, {"_id": 0}).to_list(5000)
    expenses = await db.expenses.find({"created_at": {"$gte": local_day_start_utc(start)}}, {"_id": 0}).to_list(5000)
    buckets = {f"{y:04d}-{m:02d}": {"month": f"{y:04d}-{m:02d}", "label": MONTH_LABELS[m - 1], "revenue": 0.0, "expenses": 0.0, "deliveries": 0, "delivered": 0} for (y, m) in keys}
    for e in entries:
        key = (e.get("date") or "")[:7]
        if key not in buckets: continue
        buckets[key]["deliveries"] += 1
        buckets[key]["delivered"] += 1
        buckets[key]["revenue"] += entry_total(e)
    for e in expenses:
        key = (e.get("created_at") or "")[:7]
        if key not in buckets: continue
        if e.get("status") != "rejected": buckets[key]["expenses"] += float(e.get("amount", 0))
    return [buckets[f"{y:04d}-{m:02d}"] for (y, m) in keys]

async def list_resource(collection): return await db[collection].find({}, {"_id": 0}).sort("created_at", -1).to_list(200)

def match_product(products_cache, brand):
    b = (brand or "").strip().lower()
    if not b: return None
    return next((p for p in products_cache if (p.get("brand") or p.get("name") or "").strip().lower() == b), None)

async def apply_stock_delta(products_cache, brand, delta, reason, entry, user, extra=None):
    if not delta: return
    match = match_product(products_cache, brand)
    if not match:
        if reason == "venda" and (brand or "").strip():
            await db.stock_movements.insert_one({
                "id": str(uuid.uuid4()), "product_id": None, "product_name": None, "brand": brand,
                "quantity": 0, "reason": "sem_correspondencia",
                "entry_id": entry.get("id"), "entry_number": entry.get("entry_number"), "customer": entry.get("customer"), "driver": entry.get("driver"),
                "created_at": now(), "created_by": user.get("id") if user else None, "created_by_name": user.get("name") if user else "sistema",
            })
        return
    await db.products.update_one({"id": match["id"]}, {"$inc": {"quantity": delta}})
    movement = {
        "id": str(uuid.uuid4()), "product_id": match["id"], "product_name": match.get("name"), "brand": match.get("brand") or match.get("name"),
        "quantity": delta, "reason": reason,
        "entry_id": entry.get("id"), "entry_number": entry.get("entry_number"), "customer": entry.get("customer"), "driver": entry.get("driver"),
        "created_at": now(), "created_by": user.get("id") if user else None, "created_by_name": user.get("name") if user else "sistema",
    }
    if extra: movement.update(extra)
    await db.stock_movements.insert_one(movement)

async def apply_entry_stock_movements(doc, reason, sign, user):
    products_cache = await db.products.find({}, {"_id": 0}).to_list(1000)
    items = doc.get("items")
    if items:
        for it in items:
            qty = float(it.get("quantity") or 0)
            if qty > 0: await apply_stock_delta(products_cache, it.get("brand"), sign * -qty, reason, doc, user)
    else:
        qty = float(doc.get("billed_quantity") or 0)
        if qty > 0: await apply_stock_delta(products_cache, doc.get("brand"), sign * -qty, reason, doc, user)
    mf_plan = doc.get("mf_plan")
    if mf_plan in ("swap", "reschedule"):
        mf_items = [it for it in (items or []) if float(it.get("mf_quantity") or 0) > 0]
        mf_total = sum(float(it.get("mf_quantity") or 0) for it in mf_items) if items else float(doc.get("mf_quantity") or 0)
        mf_brand_qty = [(it.get("brand"), float(it["mf_quantity"])) for it in mf_items] if items else ([(doc.get("brand"), mf_total)] if mf_total > 0 else [])
        if sign == 1:
            if mf_plan == "swap":
                # Defective (microfuro) bottle swapped on the truck right away: flag for supplier exchange.
                for brand, qty in mf_brand_qty:
                    await apply_stock_delta(products_cache, brand, -qty, "mf_defeito", doc, user, extra={"resolved": False})
            else:
                # Reschedule: no stock impact yet, just track that a future swap/pickup is owed.
                for brand, qty in mf_brand_qty:
                    match = match_product(products_cache, brand)
                    await db.stock_movements.insert_one({
                        "id": str(uuid.uuid4()), "product_id": match["id"] if match else None, "product_name": match.get("name") if match else None, "brand": (match.get("brand") or match.get("name")) if match else brand,
                        "quantity": 0, "pending_quantity": qty, "reason": "mf_reagendado", "resolved": False,
                        "entry_id": doc.get("id"), "entry_number": doc.get("entry_number"), "customer": doc.get("customer"), "driver": doc.get("driver"),
                        "mf_date": doc.get("mf_date"), "created_at": now(), "created_by": user.get("id") if user else None, "created_by_name": user.get("name") if user else "sistema",
                    })
        else:
            # Estorno: any pending defect tracking for this entry no longer applies.
            await db.stock_movements.update_many({"entry_id": doc.get("id"), "reason": {"$in": ["mf_defeito", "mf_reagendado"]}, "resolved": False}, {"$set": {"resolved": True, "resolved_note": "Estornado"}})
            if mf_plan == "swap":
                for brand, qty in mf_brand_qty:
                    await apply_stock_delta(products_cache, brand, qty, reason, doc, user)

@api.get("/stock-movements")
async def stock_movements(user=Depends(admin_user)): return await db.stock_movements.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)

@api.patch("/stock-movements/{item_id}")
async def update_stock_movement(item_id: str, user=Depends(admin_user)):
    target = await db.stock_movements.find_one({"id": item_id}, {"_id": 0})
    if not target: raise HTTPException(404, "Movimentação não encontrada")
    if target.get("reason") == "mf_reagendado" and not target.get("resolved"):
        qty = float(target.get("pending_quantity") or 0)
        if target.get("product_id") and qty > 0:
            await db.products.update_one({"id": target["product_id"]}, {"$inc": {"quantity": -qty}})
            await db.stock_movements.insert_one({
                "id": str(uuid.uuid4()), "product_id": target["product_id"], "product_name": target.get("product_name"), "brand": target.get("brand"),
                "quantity": -qty, "reason": "mf_defeito", "resolved": False,
                "entry_id": target.get("entry_id"), "entry_number": target.get("entry_number"), "customer": target.get("customer"), "driver": target.get("driver"),
                "created_at": now(), "created_by": user["id"], "created_by_name": user["name"],
            })
        await db.stock_movements.update_one({"id": item_id}, {"$set": {"resolved": True, "resolved_note": "Troca realizada", "resolved_by": user["name"], "resolved_at": now()}})
    else:
        await db.stock_movements.update_one({"id": item_id}, {"$set": {"resolved": True, "resolved_note": "Trocado com o fornecedor", "resolved_by": user["name"], "resolved_at": now()}})
    return await db.stock_movements.find_one({"id": item_id}, {"_id": 0})
async def create_resource(collection, payload, user):
    doc = payload.model_dump(exclude_none=True); doc.update({"id": str(uuid.uuid4()), "created_at": now(), "created_by": user["id"]})
    await db[collection].insert_one(doc); doc.pop("_id", None); return doc

@api.get("/products")
async def products(user=Depends(current_user)): return await list_resource("products")
@api.post("/products")
async def add_product(data: ResourceInput, user=Depends(admin_user)): return await create_resource("products", data, user)
@api.patch("/products/{item_id}")
async def update_product(item_id: str, data: ResourceInput, user=Depends(admin_user)):
    target = await db.products.find_one({"id": item_id}, {"_id": 0})
    if not target: raise HTTPException(404, "Produto não encontrado")
    values = data.model_dump(exclude_unset=True)
    await db.products.update_one({"id": item_id}, {"$set": values})
    doc = await db.products.find_one({"id": item_id}, {"_id": 0})
    if "quantity" in values and float(values["quantity"]) != float(target.get("quantity") or 0):
        await log_activity("stock_adjusted", user, {"id": item_id, "name": doc.get("name")}, {"from": target.get("quantity"), "to": doc.get("quantity"), "reason": values.get("notes")})
    return doc
@api.get("/expenses")
async def expenses(user=Depends(current_user)): return await list_resource("expenses")
@api.post("/expenses")
async def add_expense(data: ResourceInput, user=Depends(current_user)):
    if user.get("role") != "admin": data.driver = user["name"]
    return await create_resource("expenses", data, user)
@api.patch("/expenses/{item_id}")
async def update_expense(item_id: str, data: ResourceInput, user=Depends(admin_user)):
    target = await db.expenses.find_one({"id": item_id}, {"_id": 0})
    if not target: raise HTTPException(404, "Lançamento não encontrado")
    values = data.model_dump(exclude_unset=True); values["reviewed_by"] = user["name"]; values["reviewed_at"] = now()
    await db.expenses.update_one({"id": item_id}, {"$set": values})
    doc = await db.expenses.find_one({"id": item_id}, {"_id": 0})
    await log_activity(f"expense_{doc.get('status','updated')}", user, {"id": item_id, "name": doc.get("type"), "email": doc.get("driver")})
    return doc
@api.delete("/expenses/{item_id}")
async def delete_expense(item_id: str, user=Depends(current_user)):
    target = await db.expenses.find_one({"id": item_id}, {"_id": 0})
    if not target: raise HTTPException(404, "Lançamento não encontrado")
    if user.get("role") != "admin" and target.get("created_by") != user["id"]: raise HTTPException(403, "Sem permissão")
    await db.expenses.delete_one({"id": item_id})
    return {"message": "Excluído"}
@api.get("/customers")
async def customers(user=Depends(current_user)): return await list_resource("customers")
@api.post("/customers")
async def add_customer(data: ResourceInput, user=Depends(admin_user)): return await create_resource("customers", data, user)
@api.patch("/customers/{item_id}")
async def update_customer(item_id: str, data: ResourceInput, user=Depends(admin_user)):
    values = data.model_dump(exclude_unset=True); await db.customers.update_one({"id": item_id}, {"$set": values})
    doc = await db.customers.find_one({"id": item_id}, {"_id": 0}); return doc

@api.get("/brands")
async def brands(user=Depends(current_user)): return await list_resource("brands")
@api.post("/brands")
async def add_brand(data: ResourceInput, user=Depends(admin_user)): return await create_resource("brands", data, user)
@api.patch("/brands/{item_id}")
async def update_brand(item_id: str, data: ResourceInput, user=Depends(admin_user)):
    values = data.model_dump(exclude_unset=True); await db.brands.update_one({"id": item_id}, {"$set": values})
    doc = await db.brands.find_one({"id": item_id}, {"_id": 0}); return doc
@api.delete("/brands/{item_id}")
async def delete_brand(item_id: str, user=Depends(admin_user)):
    await db.brands.delete_one({"id": item_id})
    return {"message": "Excluída"}

@api.get("/customers/out-of-catalog-brands")
async def out_of_catalog_brands(user=Depends(admin_user)):
    entries = await db.daily_entries.find({"items": {"$elemMatch": {"out_of_catalog": True, "promoted": {"$ne": True}}}}, {"_id": 0}).to_list(2000)
    customers = await db.customers.find({}, {"_id": 0}).to_list(1000)
    by_name = {c["name"]: c for c in customers}
    groups = {}
    for e in entries:
        customer_name = e.get("customer")
        for it in e.get("items", []):
            if not it.get("out_of_catalog") or it.get("promoted"): continue
            key = (customer_name, (it.get("brand") or "").strip().lower())
            row = groups.setdefault(key, {"customer": customer_name, "customer_id": (by_name.get(customer_name) or {}).get("id"), "brand": it.get("brand"), "price": it.get("price"), "count": 0, "last_date": e.get("date")})
            row["count"] += 1
            row["price"] = it.get("price")
            if (e.get("date") or "") > (row["last_date"] or ""): row["last_date"] = e.get("date")
    return sorted(groups.values(), key=lambda r: r["last_date"] or "", reverse=True)

@api.post("/customers/{item_id}/promote-brand")
async def promote_brand(item_id: str, data: ResourceInput, user=Depends(admin_user)):
    customer = await db.customers.find_one({"id": item_id}, {"_id": 0})
    if not customer: raise HTTPException(404, "Cliente não encontrado")
    brand, price = data.brand, data.price
    if not brand: raise HTTPException(400, "Informe a marca")
    brands = customer.get("brands") or ([{"brand": customer["brand"], "price": customer.get("price")}] if customer.get("brand") else [])
    if not any((b.get("brand") or "").strip().lower() == brand.strip().lower() for b in brands):
        brands.append({"brand": brand, "price": price})
    await db.customers.update_one({"id": item_id}, {"$set": {"brands": brands}})
    await db.daily_entries.update_many(
        {"customer": customer["name"], "items.brand": brand, "items.out_of_catalog": True},
        {"$set": {"items.$[elem].promoted": True}},
        array_filters=[{"elem.brand": brand, "elem.out_of_catalog": True}],
    )
    return await db.customers.find_one({"id": item_id}, {"_id": 0})

@api.get("/daily-entries")
async def daily_entries(date: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None, driver: Optional[str] = None, customer: Optional[str] = None, codigo_viagem: Optional[str] = None, entry_number: Optional[int] = None, user=Depends(current_user)):
    query = {}
    if date: query["date"] = date
    elif start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end
        query["date"] = rng
    if driver: query["driver"] = driver
    elif user.get("role") != "admin": query["driver"] = user["name"]
    if customer: query["customer"] = {"$regex": re.escape(customer), "$options": "i"}
    if entry_number: query["entry_number"] = entry_number
    if codigo_viagem:
        viagem = await db.viagens.find_one({"codigo_viagem": codigo_viagem.strip()}, {"_id": 0})
        query["viagem_id"] = viagem["id"] if viagem else "__none__"
    return await db.daily_entries.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)

@api.post("/daily-entries")
async def add_daily_entry(data: ResourceInput, user=Depends(current_user)):
    doc = data.model_dump(exclude_none=True)
    doc["driver"] = user["name"] if user.get("role") != "admin" else (doc.get("driver") or user["name"])
    doc["date"] = doc.get("date") or today_local()
    items = doc.get("items")
    if items:
        billed_qty = sum(float(it.get("quantity") or 0) for it in items)
        mf_total = sum(float(it.get("mf_quantity") or 0) for it in items)
        total = sum(float(it.get("quantity") or 0) * float(it.get("price") or 0) for it in items)
    else:
        qty = float(doc.get("quantity") or 0)
        mf_total = float(doc.get("mf_quantity") or 0)
        billed_qty = max(0.0, qty - mf_total)
        price = float(doc.get("price") or 0)
        total = billed_qty * price
    doc["billed_quantity"] = billed_qty
    doc["mf_quantity"] = mf_total
    doc["total"] = total
    comp_value = float(doc.get("comp_value") or 0)
    pix_value = float(doc.get("pix_value") or 0)
    cash_value = float(doc.get("cash_value") or 0)
    if round(pix_value + cash_value + comp_value, 2) != round(total, 2):
        raise HTTPException(400, f"Pix + Dinheiro + A prazo (R$ {pix_value + cash_value + comp_value:.2f}) precisa somar o total do lançamento (R$ {total:.2f})")
    if comp_value > 0:
        days = int(doc.get("comp_days") or 15)
        doc["comp_days"] = days
        due = datetime.fromisoformat(doc["date"]) + timedelta(days=days)
        doc["due_date"] = due.date().isoformat()
        doc["received"] = False
    doc["entry_number"] = await next_sequence("daily_entries")
    doc.update({"id": str(uuid.uuid4()), "created_at": now(), "created_by": user["id"]})

    if doc.get("viagem_id"):
        viagem = await db.viagens.find_one({"id": doc["viagem_id"]}, {"_id": 0})
        if viagem: doc["viagem_codigo"] = viagem.get("codigo_viagem")

    await apply_entry_stock_movements(doc, "venda", 1, user)
    await db.daily_entries.insert_one(doc); doc.pop("_id", None); return doc

@api.patch("/daily-entries/{item_id}")
async def update_daily_entry(item_id: str, data: ResourceInput, user=Depends(admin_user)):
    values = data.model_dump(exclude_unset=True)
    await db.daily_entries.update_one({"id": item_id}, {"$set": values})
    doc = await db.daily_entries.find_one({"id": item_id}, {"_id": 0}); return doc

@api.delete("/daily-entries/{item_id}")
async def delete_daily_entry(item_id: str, user=Depends(current_user)):
    target = await db.daily_entries.find_one({"id": item_id}, {"_id": 0})
    if not target: raise HTTPException(404, "Lançamento não encontrado")
    if user.get("role") != "admin" and target.get("created_by") != user["id"]: raise HTTPException(403, "Sem permissão")
    await apply_entry_stock_movements(target, "estorno", -1, user)
    await db.daily_entries.delete_one({"id": item_id})
    return {"message": "Excluído"}

TURNO_LABELS = {0: "Manhã", 1: "Tarde"}
VIAGENS_POR_TURNO = 2
VIAGENS_POR_DIA = VIAGENS_POR_TURNO * len(TURNO_LABELS)

def gerar_codigo_viagem(turno: int, date_str: str, rota: int) -> str:
    d = datetime.fromisoformat(date_str)
    return f"{turno}{d.day:02d}{d.month:02d}{d.year:04d}{str(rota).zfill(3)}"

@api.post("/viagens")
async def create_viagem(data: ViagemInput, user=Depends(current_user)):
    if data.turno not in TURNO_LABELS: raise HTTPException(400, "Turno inválido (use 0 para manhã ou 1 para tarde)")
    if data.rota < 1: raise HTTPException(400, "Informe uma rota válida")
    driver_name = user["name"]
    if data.driver and user.get("role") == "admin": driver_name = data.driver
    date_str = data.date or today_local()

    count_turno = await db.viagens.count_documents({"driver": driver_name, "date": date_str, "turno": data.turno})
    if count_turno >= VIAGENS_POR_TURNO:
        raise HTTPException(400, f"Máximo de {VIAGENS_POR_TURNO} rotas no turno da {TURNO_LABELS[data.turno].lower()} ({date_str}) — já existem {count_turno}.")

    codigo = gerar_codigo_viagem(data.turno, date_str, data.rota)
    if await db.viagens.find_one({"codigo_viagem": codigo}):
        raise HTTPException(409, f"Já existe uma viagem com o código {codigo}")

    numero = await db.viagens.count_documents({"driver": driver_name, "date": date_str}) + 1
    doc = {
        "id": str(uuid.uuid4()), "codigo_viagem": codigo, "driver": driver_name, "numero": numero,
        "turno": data.turno, "rota": data.rota, "date": date_str, "carga_total": data.carga_total,
        "notes": data.notes, "clientes": data.clientes or [], "status": "planejada",
        "created_at": now(), "created_by": user["id"], "updated_at": now(),
    }
    await db.viagens.insert_one(doc); doc.pop("_id", None)
    await log_activity("viagem_criada", user, {"id": doc["id"], "name": codigo}, {"driver": driver_name, "turno": data.turno, "rota": data.rota})
    return doc

@api.get("/viagens")
async def list_viagens(date: Optional[str] = None, driver: Optional[str] = None, user=Depends(current_user)):
    query = {}
    if user.get("role") != "admin": query["driver"] = user["name"]
    elif driver: query["driver"] = driver
    if date: query["date"] = date
    viagens = await db.viagens.find(query, {"_id": 0}).sort("numero", 1).to_list(500)
    return {"total": len(viagens), "limite": VIAGENS_POR_DIA, "viagens": viagens}

async def _own_viagem_or_404(item_id, user):
    v = await db.viagens.find_one({"id": item_id}, {"_id": 0})
    if not v: raise HTTPException(404, "Viagem não encontrada")
    if user.get("role") != "admin" and v.get("driver") != user["name"]: raise HTTPException(403, "Sem permissão")
    return v

@api.post("/viagens/{item_id}/iniciar")
async def iniciar_viagem(item_id: str, user=Depends(current_user)):
    v = await _own_viagem_or_404(item_id, user)
    if v["status"] != "planejada": raise HTTPException(400, f"Viagem já está {v['status']}")
    await db.viagens.update_one({"id": item_id}, {"$set": {"status": "execucao", "updated_at": now()}})
    return await db.viagens.find_one({"id": item_id}, {"_id": 0})

@api.post("/viagens/{item_id}/finalizar")
async def finalizar_viagem(item_id: str, user=Depends(current_user)):
    v = await _own_viagem_or_404(item_id, user)
    if v["status"] == "finalizada": raise HTTPException(400, "Viagem já está finalizada")
    entregas = await db.daily_entries.find({"viagem_id": item_id}, {"_id": 0}).to_list(2000)
    despesas = await db.expenses.find({"viagem_id": item_id, "status": {"$ne": "rejected"}}, {"_id": 0}).to_list(500)
    total_bruto = sum(entry_total(e) for e in entregas)
    despesas_total = sum(float(d.get("amount") or 0) for d in despesas)
    quantidade_entregue = sum(float(e.get("billed_quantity") or 0) for e in entregas)
    problemas = sum(1 for e in entregas if float(e.get("mf_quantity") or 0) > 0)
    values = {"status": "finalizada", "total_bruto": total_bruto, "quantidade_entregue": quantidade_entregue,
              "entregas": len(entregas), "problemas": problemas, "despesas_total": despesas_total,
              "saldo_liquido": total_bruto - despesas_total, "updated_at": now()}
    await db.viagens.update_one({"id": item_id}, {"$set": values})
    return await db.viagens.find_one({"id": item_id}, {"_id": 0})

@api.delete("/viagens/{item_id}")
async def delete_viagem(item_id: str, user=Depends(current_user)):
    v = await _own_viagem_or_404(item_id, user)
    if v["status"] != "planejada": raise HTTPException(400, f"Só é possível excluir viagens planejadas (esta está {v['status']})")
    await db.viagens.delete_one({"id": item_id})
    return {"message": "Excluída", "codigo_viagem": v["codigo_viagem"]}

@api.get("/finance/summary")
async def finance_summary(driver: Optional[str] = None, user=Depends(current_user)):
    scope_driver = driver if user.get("role") == "admin" else user["name"]
    today = today_local()

    today_query = {"date": today}
    if scope_driver: today_query["driver"] = scope_driver
    todays_entries = await db.daily_entries.find(today_query, {"_id": 0}).to_list(2000)
    received_today = sum(float(e.get("pix_value") or 0) + float(e.get("cash_value") or 0) for e in todays_entries)
    comp_today = sum(float(e.get("comp_value") or 0) for e in todays_entries)

    comp_query = {"comp_value": {"$gt": 0}}
    if scope_driver: comp_query["driver"] = scope_driver
    all_comp = await db.daily_entries.find(comp_query, {"_id": 0}).to_list(5000)
    comp_pending_total = sum(float(e.get("comp_value") or 0) for e in all_comp if not e.get("received"))
    comp_received_total = sum(float(e.get("comp_value") or 0) for e in all_comp if e.get("received"))

    todays_expenses = await expenses_for_day(today, scope_driver)
    expenses_today_total = sum(float(e.get("amount") or 0) for e in todays_expenses if e.get("status") != "rejected")

    all_exp_query = {} if not scope_driver else {"driver": scope_driver}
    all_expenses = await db.expenses.find(all_exp_query, {"_id": 0}).to_list(2000)
    expenses_pending_total = sum(float(e.get("amount") or 0) for e in all_expenses if e.get("status") == "pending")

    return {
        "date": today, "received_today": received_today, "comp_today": comp_today,
        "comp_pending_total": comp_pending_total, "comp_received_total": comp_received_total,
        "expenses_today_total": expenses_today_total, "expenses_pending_total": expenses_pending_total,
        "balance_today": received_today - expenses_today_total,
    }

@api.get("/reports/receivables")
async def receivables(status: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None, user=Depends(admin_user)):
    query = {"comp_value": {"$gt": 0}}
    if status == "pending": query["received"] = False
    elif status == "received": query["received"] = True
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end
        query["due_date"] = rng
    entries = await db.daily_entries.find(query, {"_id": 0}).sort("due_date", 1).to_list(2000)
    totals = {"pending": sum(float(e.get("comp_value") or 0) for e in entries if not e.get("received")), "received": sum(float(e.get("comp_value") or 0) for e in entries if e.get("received"))}
    return {"rows": entries, "totals": totals}

def entry_item_rows(e):
    """Yield (brand, quantity, price) for each product line of a daily entry, whether it used
    the multi-brand items[] shape (desktop/mobile current) or the older single-brand shape."""
    items = e.get("items")
    if items:
        for it in items:
            qty = float(it.get("quantity") or 0)
            if qty <= 0: continue
            yield (it.get("brand") or "", qty, float(it.get("price") or 0))
    else:
        qty = float(e.get("billed_quantity") if e.get("billed_quantity") is not None else max(0.0, float(e.get("quantity") or 0) - float(e.get("mf_quantity") or 0)))
        if qty > 0:
            yield (e.get("brand") or "", qty, float(e.get("price") or 0))

async def _profit_rows(start, end, group_by):
    query = {}
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end
        query["date"] = rng
    entries = await db.daily_entries.find(query, {"_id": 0}).to_list(5000)
    products = await db.products.find({}, {"_id": 0}).to_list(1000)
    brands_cat = await db.brands.find({}, {"_id": 0}).to_list(1000)
    cost_by_brand = {}
    for b in brands_cat:
        if b.get("cost_price"):
            cost_by_brand[(b.get("name") or "").strip().lower()] = float(b["cost_price"])
    for p in products:
        if not p.get("cost_price"): continue
        upp = float(p.get("units_per_package") or 1) if (p.get("unit") or "").lower().startswith("fardo") else 1
        unit_cost = float(p["cost_price"]) / upp if upp else float(p["cost_price"])
        cost_by_brand[(p.get("brand") or p.get("name") or "").strip().lower()] = unit_cost
    rows = {}
    for e in entries:
        customer = e.get("customer") or "Sem cliente"
        for brand, qty, price in entry_item_rows(e):
            key = customer if group_by == "customer" else (brand.strip() or "Sem marca")
            cost = cost_by_brand.get(brand.strip().lower(), 0)
            row = rows.setdefault(key, {group_by: key, "quantity": 0.0, "revenue": 0.0, "cost": 0.0, "profit": 0.0})
            row["quantity"] += qty; row["revenue"] += qty * price; row["cost"] += qty * cost; row["profit"] += qty * (price - cost)
    result = sorted(rows.values(), key=lambda r: r["profit"], reverse=True)
    totals = {"quantity": sum(r["quantity"] for r in result), "revenue": sum(r["revenue"] for r in result), "cost": sum(r["cost"] for r in result), "profit": sum(r["profit"] for r in result)}
    return {"rows": result, "totals": totals, "period": {"start": start, "end": end}}

@api.get("/reports/profit-by-customer")
async def profit_by_customer(start: Optional[str] = None, end: Optional[str] = None, user=Depends(admin_user)):
    return await _profit_rows(start, end, "customer")

@api.get("/reports/profit-by-brand")
async def profit_by_brand(start: Optional[str] = None, end: Optional[str] = None, user=Depends(admin_user)):
    return await _profit_rows(start, end, "brand")

@api.get("/users")
async def list_users(user=Depends(admin_user)):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(500)
    return docs

@api.post("/users")
async def create_user(data: UserInput, user=Depends(admin_user)):
    if not data.email or not data.password or not data.name: raise HTTPException(400, "Nome, e-mail e senha são obrigatórios")
    email = data.email.lower().strip()
    if await db.users.find_one({"email": email}): raise HTTPException(409, "Este e-mail já está cadastrado")
    doc = {"id": str(uuid.uuid4()), "email": email, "name": data.name.strip(), "phone": data.phone, "role": data.role or "driver", "status": "approved", "active": True, "password_hash": hash_password(data.password), "created_at": now()}
    await db.users.insert_one(doc)
    await log_activity("user_created", user, doc, {"role": doc["role"]})
    return sanitize_user(doc)

@api.patch("/users/{user_id}")
async def update_user(user_id: str, data: UserInput, user=Depends(admin_user)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target: raise HTTPException(404, "Usuário não encontrado")
    updates = {}
    if data.name is not None: updates["name"] = data.name.strip()
    if data.email is not None:
        email = data.email.lower().strip()
        if email != target["email"] and await db.users.find_one({"email": email}): raise HTTPException(409, "E-mail já usado por outro usuário")
        updates["email"] = email
    if data.role is not None and data.role in ("admin", "driver"): updates["role"] = data.role
    if data.phone is not None: updates["phone"] = data.phone.strip()
    if data.active is not None: updates["active"] = bool(data.active)
    if data.status is not None and data.status in ("pending", "approved", "rejected"): updates["status"] = data.status
    if updates:
        await db.users.update_one({"id": user_id}, {"$set": updates})
        await log_activity("user_updated", user, target, updates)
    doc = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return doc

@api.post("/users/{user_id}/approve")
async def approve_user(user_id: str, user=Depends(admin_user)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target: raise HTTPException(404, "Usuário não encontrado")
    await db.users.update_one({"id": user_id}, {"$set": {"status": "approved", "active": True}})
    await log_activity("user_approved", user, target)
    return {"message": "Usuário aprovado"}

@api.post("/users/{user_id}/reject")
async def reject_user(user_id: str, user=Depends(admin_user)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target: raise HTTPException(404, "Usuário não encontrado")
    await db.users.update_one({"id": user_id}, {"$set": {"status": "rejected", "active": False}})
    await log_activity("user_rejected", user, target)
    return {"message": "Usuário reprovado"}

@api.post("/users/{user_id}/reset-password")
async def reset_password(user_id: str, data: UserInput, user=Depends(admin_user)):
    if not data.password or len(data.password) < 6: raise HTTPException(400, "Nova senha precisa ter ao menos 6 caracteres")
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target: raise HTTPException(404, "Usuário não encontrado")
    await db.users.update_one({"id": user_id}, {"$set": {"password_hash": hash_password(data.password)}})
    await log_activity("password_reset", user, target)
    return {"message": "Senha redefinida"}

@api.delete("/users/{user_id}")
async def delete_user(user_id: str, user=Depends(admin_user)):
    if user_id == user["id"]: raise HTTPException(400, "Você não pode excluir a própria conta")
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target: raise HTTPException(404, "Usuário não encontrado")
    await db.users.delete_one({"id": user_id})
    await log_activity("user_deleted", user, target)
    return {"message": "Usuário excluído"}

@api.get("/activity")
async def activity(user=Depends(admin_user)):
    return await db.activity.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)

@api.get("/notifications")
async def notifications(user=Depends(current_user)):
    if user.get("role") != "admin": return {"pending_users": 0, "pending_expenses": 0, "total": 0}
    pu = await db.users.count_documents({"status": "pending"})
    pe = await db.expenses.count_documents({"status": "pending"})
    return {"pending_users": pu, "pending_expenses": pe, "total": pu + pe}

@api.get("/daily-closing")
async def daily_closing(date: Optional[str] = None, user=Depends(admin_user)):
    day = date or today_local()
    entries = await db.daily_entries.find({"date": day}, {"_id": 0}).to_list(1000)
    expenses = await expenses_for_day(day)
    drivers = {}
    for e in entries:
        name = e.get("driver") or "Sem entregador"
        row = drivers.setdefault(name, {"driver": name, "deliveries_total": 0, "deliveries_done": 0, "revenue": 0, "pix": 0.0, "cash": 0.0, "comp": 0.0, "expenses_approved": 0, "expenses_pending": 0, "expenses_rejected": 0, "balance": 0})
        row["deliveries_total"] += 1; row["deliveries_done"] += 1
        row["revenue"] += entry_total(e)
        row["pix"] += float(e.get("pix_value") or 0); row["cash"] += float(e.get("cash_value") or 0); row["comp"] += float(e.get("comp_value") or 0)
    for e in expenses:
        name = e.get("driver") or "Sem entregador"
        row = drivers.setdefault(name, {"driver": name, "deliveries_total": 0, "deliveries_done": 0, "revenue": 0, "pix": 0.0, "cash": 0.0, "comp": 0.0, "expenses_approved": 0, "expenses_pending": 0, "expenses_rejected": 0, "balance": 0})
        amt = float(e.get("amount", 0))
        st = e.get("status", "pending")
        if st == "approved": row["expenses_approved"] += amt
        elif st == "rejected": row["expenses_rejected"] += amt
        else: row["expenses_pending"] += amt
    for row in drivers.values(): row["balance"] = row["revenue"] - row["expenses_approved"]
    rows = list(drivers.values())
    totals = {"revenue": sum(r["revenue"] for r in rows), "pix": sum(r["pix"] for r in rows), "cash": sum(r["cash"] for r in rows), "comp": sum(r["comp"] for r in rows), "expenses_approved": sum(r["expenses_approved"] for r in rows), "expenses_pending": sum(r["expenses_pending"] for r in rows), "deliveries_done": sum(r["deliveries_done"] for r in rows), "deliveries_total": sum(r["deliveries_total"] for r in rows), "balance": sum(r["balance"] for r in rows)}
    return {"date": day, "drivers": rows, "totals": totals}

@api.get("/reports")
async def reports(start: Optional[str] = None, end: Optional[str] = None, user=Depends(admin_user)):
    query = {}
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end
        query["date"] = rng
    entries = await db.daily_entries.find(query, {"_id": 0}).to_list(5000)
    exp_query = {}
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end + "T23:59:59"
        exp_query["created_at"] = rng
    expenses = await db.expenses.find(exp_query, {"_id": 0}).to_list(1000)
    products = await db.products.find({}, {"_id": 0}).to_list(1000)
    drivers = {}
    for item in entries:
        name = item.get("driver") or "Sem entregador"
        row = drivers.setdefault(name, {"driver": name, "deliveries": 0, "delivered": 0, "revenue": 0})
        row["deliveries"] += 1; row["delivered"] += 1; row["revenue"] += entry_total(item)
    return {"revenue": sum(entry_total(x) for x in entries), "expenses": sum(float(x.get("amount", 0)) for x in expenses if x.get("status") != "rejected"), "deliveries": len(entries), "low_stock": sum(1 for x in products if x.get("quantity", 0) < x.get("minimum", 0)), "drivers": list(drivers.values()), "products": products, "period": {"start": start, "end": end}}

@api.get("/reports/export.csv", response_class=PlainTextResponse)
async def export_reports_csv(start: Optional[str] = None, end: Optional[str] = None, user=Depends(admin_user)):
    query = {}
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end
        query["date"] = rng
    entries = await db.daily_entries.find(query, {"_id": 0}).to_list(5000)
    exp_query = {}
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end + "T23:59:59"
        exp_query["created_at"] = rng
    expenses = await db.expenses.find(exp_query, {"_id": 0}).to_list(1000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Distribuidora Diane - Relatório Operacional"])
    w.writerow(["Período", start or "início", end or "hoje"])
    w.writerow([])
    w.writerow(["LANÇAMENTOS (CONTROLE DIÁRIO)"])
    w.writerow(["Data", "Cliente", "Entregador", "Marcas", "Qtd", "Total", "Pix", "Dinheiro", "A prazo", "MF", "Status a prazo"])
    for e in entries:
        items = e.get("items") or []
        brands = " + ".join(f"{it.get('quantity')} {it.get('brand')}" for it in items) if items else e.get("brand", "")
        comp_status = ("Recebido" if e.get("received") else "Pendente") if float(e.get("comp_value") or 0) > 0 else ""
        w.writerow([e.get("date", ""), e.get("customer", ""), e.get("driver", ""), brands, e.get("billed_quantity", ""), e.get("total", ""), e.get("pix_value", ""), e.get("cash_value", ""), e.get("comp_value", ""), e.get("mf_quantity", ""), comp_status])
    w.writerow([])
    w.writerow(["DESPESAS"])
    w.writerow(["Data", "Tipo", "Entregador", "Valor", "Status"])
    for e in expenses:
        w.writerow([e.get("created_at",""), e.get("type",""), e.get("driver",""), e.get("amount",""), e.get("status","")])
    return Response(content=buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="distribuidora-diane-relatorio.csv"'})

@app.on_event("startup")
async def seed():
    await db.users.create_index("email", unique=True)
    if not await db.users.find_one({"email": os.environ["ADMIN_EMAIL"]}):
        await db.users.insert_one({"id":"admin-1","email":os.environ["ADMIN_EMAIL"],"name":"Marina Costa","role":"admin","status":"approved","active":True,"password_hash":hash_password(os.environ["ADMIN_PASSWORD"]),"created_at":now()})
    else:
        await db.users.update_many({"role": "admin", "status": {"$exists": False}}, {"$set": {"status": "approved", "active": True}})
    if not await db.users.find_one({"email": os.environ["DRIVER_EMAIL"]}):
        await db.users.insert_one({"id":"driver-1","email":os.environ["DRIVER_EMAIL"],"name":"Carlos Mendes","role":"driver","status":"approved","active":True,"password_hash":hash_password(os.environ["DRIVER_PASSWORD"]),"created_at":now()})
    else:
        await db.users.update_many({"status": {"$exists": False}}, {"$set": {"status": "approved", "active": True}})
    if await db.products.count_documents({}) == 0:
        await db.products.insert_many([{"id":"p1","name":"Galão 20L","category":"Retornável","quantity":84,"minimum":30,"unit":"un"},{"id":"p2","name":"Fardo 500ml (12un)","category":"Descartável","quantity":18,"minimum":25,"unit":"fardos"},{"id":"p3","name":"Água mineral 1,5L","category":"Descartável","quantity":42,"minimum":20,"unit":"fardos"}])

app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=[os.environ["FRONTEND_URL"]], allow_methods=["*"], allow_headers=["*"])
logging.basicConfig(level=logging.INFO)
@app.on_event("shutdown")
async def shutdown(): client.close()
