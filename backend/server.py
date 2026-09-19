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
    cost_price_full: Optional[float] = None
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
    rota_id: Optional[str] = None
    photo: Optional[str] = None
    target_margin: Optional[float] = None

class LotInput(BaseModel):
    quantity: float
    cost_price: float
    cost_price_full: Optional[float] = None
    purchase_date: Optional[str] = None
    notes: Optional[str] = None
    adjust_stock: bool = True

class ViagemInput(BaseModel):
    turno: int  # 0 = manhã, 1 = tarde
    date: Optional[str] = None
    carga_total: Optional[int] = None
    notes: Optional[str] = None
    driver: Optional[str] = None  # admin only: criar viagem para outro entregador
    carga_items: Optional[List[dict]] = None  # [{brand, quantity}] carregado no caminhão, por produto

class RotaInput(BaseModel):
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
    return await db.expenses.find(query, {"_id": 0}).to_list(None)

async def day_closing_record(day_str, driver):
    return await db.daily_closings.find_one({"date": day_str, "driver": driver, "status": "closed"}, {"_id": 0})

async def ensure_day_open(day_str, driver, user):
    if user.get("role") == "admin": return
    if await day_closing_record(day_str, driver):
        raise HTTPException(409, f"O dia {day_str} já foi fechado. Peça ao administrador para reabrir antes de alterar lançamentos.")

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

LOGIN_FAILURES = {}
LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 600

def login_throttle_key(request, email): return f"{email}|{request.client.host if request.client else '?'}"

@api.post("/auth/login")
async def login(data: LoginInput, response: Response, request: Request):
    email = data.email.lower().strip()
    key = login_throttle_key(request, email)
    cutoff = datetime.now(timezone.utc).timestamp() - LOGIN_WINDOW_SECONDS
    recent = [t for t in LOGIN_FAILURES.get(key, []) if t > cutoff]
    LOGIN_FAILURES[key] = recent
    if len(recent) >= LOGIN_MAX_ATTEMPTS:
        wait = int((recent[0] + LOGIN_WINDOW_SECONDS - datetime.now(timezone.utc).timestamp()) / 60) + 1
        raise HTTPException(429, f"Muitas tentativas de login. Aguarde {wait} min e tente de novo.")
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not check_password(data.password, user["password_hash"]):
        LOGIN_FAILURES[key].append(datetime.now(timezone.utc).timestamp())
        raise HTTPException(401, "E-mail ou senha inválidos")
    LOGIN_FAILURES.pop(key, None)
    if user.get("status") == "pending": raise HTTPException(403, "Seu cadastro está aguardando aprovação do administrador")
    if user.get("status") == "rejected": raise HTTPException(403, "Cadastro não aprovado. Entre em contato com o administrador")
    if user.get("active") is False: raise HTTPException(403, "Conta desativada. Entre em contato com o administrador")
    user.pop("password_hash", None); access_token = token_for(user)
    response.set_cookie("access_token", access_token, httponly=True, secure=True, samesite="lax", max_age=43200)
    return {**user, "token": access_token}

@api.get("/auth/me")
async def me(user=Depends(current_user)): return sanitize_user(user)

@api.get("/dashboard")
async def dashboard(user=Depends(current_user)):
    now_dt = now_local()
    today = now_dt.date().isoformat()
    month_start = f"{now_dt.year:04d}-{now_dt.month:02d}-01"
    own = {} if user.get("role") == "admin" else {"driver": user["name"]}
    entries_today = await db.daily_entries.find({"date": today, **own}, {"_id": 0}).sort("created_at", -1).to_list(200)
    entries_month = await db.daily_entries.find({"date": {"$gte": month_start}, **own}, {"_id": 0}).to_list(None)
    products = await db.products.find({}, {"_id": 0}).to_list(100)
    expenses = await db.expenses.find(own, {"_id": 0}).to_list(200)
    revenue = sum(entry_total(e) for e in entries_month)
    month_start_utc = local_day_start_utc(month_start)
    month_expenses = await db.expenses.find({"created_at": {"$gte": month_start_utc}, "status": {"$ne": "rejected"}, **own}, {"_id": 0, "amount": 1}).to_list(None)
    expenses_month = sum(float(e.get("amount", 0)) for e in month_expenses)
    return {"revenue": revenue, "expenses": expenses_month, "deliveries": entries_today, "products": products, "expenses_list": expenses, "user": user}

MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

@api.get("/dashboard/monthly")
async def dashboard_monthly(months: int = 6, user=Depends(admin_user)):
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
    entries = await db.daily_entries.find({"date": {"$gte": start}}, {"_id": 0}).to_list(None)
    expenses = await db.expenses.find({"created_at": {"$gte": local_day_start_utc(start)}}, {"_id": 0}).to_list(None)
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

def cost_unit_for(catalog, sale_type):
    if not catalog: return None
    if sale_type == "full":
        full = catalog.get("cost_price_full")
        if full is not None: return float(full)
    return float(catalog["cost_price"]) if catalog.get("cost_price") is not None else None

def lot_code(purchase_date, quantity, seq):
    d = datetime.fromisoformat(purchase_date)
    return f"{d.day:02d}{d.month:02d}{d.year % 100:02d}{int(round(quantity))}{seq:03d}"

def lot_unit_cost(lot, sale_type):
    if sale_type == "full" and lot.get("cost_unit_full") is not None: return float(lot["cost_unit_full"])
    return float(lot["cost_unit"])

async def allocate_lots(products_cache, brand, qty, sale_type, fallback_cost):
    """Baixa `qty` dos lotes abertos do produto (mais antigo primeiro) e devolve (alocações, custo médio ponderado)."""
    match = match_product(products_cache, brand)
    if not match or qty <= 0: return [], None, 0.0
    lots = await db.lots.find({"product_id": match["id"], "quantity_remaining": {"$gt": 0}}, {"_id": 0}).sort([("purchase_date", 1), ("created_at", 1)]).to_list(500)
    left, allocs = qty, []
    for lot in lots:
        if left <= 0: break
        take = min(left, float(lot["quantity_remaining"]))
        await db.lots.update_one({"id": lot["id"]}, {"$inc": {"quantity_remaining": -take}})
        allocs.append({"lot_id": lot["id"], "lot_code": lot["code"], "quantity": take, "cost_unit": lot_unit_cost(lot, sale_type)})
        left -= take
    if not allocs: return [], None, 0.0
    covered = sum(a["quantity"] for a in allocs)
    total_cost = sum(a["quantity"] * a["cost_unit"] for a in allocs)
    if left > 0.0001 and fallback_cost is not None:
        total_cost += left * float(fallback_cost); covered += left
    return allocs, total_cost / covered, max(0.0, left)

async def release_lots(doc):
    groups = [it.get("lot_allocations") or [] for it in doc["items"]] if doc.get("items") else [doc.get("lot_allocations") or []]
    for allocs in groups:
        for a in allocs: await db.lots.update_one({"id": a["lot_id"]}, {"$inc": {"quantity_remaining": float(a["quantity"])}})

async def apply_lot_costs(doc):
    """Consome os lotes na ordem de compra e trava em cada item o custo médio real dos lotes usados.
    Devolve avisos (marca fora do Estoque, saldo de lotes esgotado) para o app mostrar ao usuário."""
    products_cache = await db.products.find({}, {"_id": 0}).to_list(1000)
    swap = doc.get("mf_plan") == "swap"
    warnings = []
    async def handle(row, brand, q, sale_type, set_on):
        brand = (brand or "").strip()
        if not brand or q <= 0: return
        if not match_product(products_cache, brand):
            warnings.append(f'A marca "{brand}" não está no Estoque: a venda foi registrada, mas o estoque não foi baixado. Avise o administrador.')
            return
        allocs, cost, uncovered = await allocate_lots(products_cache, brand, q, sale_type, row.get("cost_unit"))
        if allocs:
            set_on["lot_allocations"] = allocs; set_on["cost_unit"] = cost
            if uncovered > 0.0001: warnings.append(f'"{brand}": {uncovered:g} un passaram do saldo dos lotes e usaram o custo do cadastro. Registre a compra em Estoque.')
    if doc.get("items"):
        for it in doc["items"]:
            it.pop("lot_allocations", None)
            q = float(it.get("quantity") or 0) + (float(it.get("mf_quantity") or 0) if swap else 0)
            await handle(it, it.get("brand"), q, it.get("sale_type") or "exchange", it)
    else:
        doc.pop("lot_allocations", None)
        q = float(doc.get("billed_quantity") or 0) + (float(doc.get("mf_quantity") or 0) if swap else 0)
        await handle(doc, doc.get("brand"), q, doc.get("sale_type") or "exchange", doc)
    return warnings

def normalize_unit(values):
    if (values.get("unit") or "").strip().lower().startswith("fardo"): values["unit"] = "fardo"
    return values

def next_business_day(from_date_str=None):
    d = (datetime.fromisoformat(from_date_str).date() if from_date_str else now_local().date()) + timedelta(days=1)
    while d.weekday() >= 5: d += timedelta(days=1)
    return d.isoformat()

def is_returnable(product):
    return (product.get("category") or "").strip().lower().startswith("retorn")

def viagem_ref(v):
    return {"id": v.get("id"), "entry_number": None, "customer": None, "driver": v.get("driver"), "viagem_codigo": v.get("codigo_viagem")}

async def apply_stock_delta(products_cache, brand, delta, reason, entry, user, extra=None, skip_quantity=False):
    if not delta: return
    match = match_product(products_cache, brand)
    if not match:
        if reason == "venda" and (brand or "").strip():
            await db.stock_movements.insert_one({
                "id": str(uuid.uuid4()), "product_id": None, "product_name": None, "brand": brand,
                "quantity": 0, "reason": "sem_correspondencia",
                "entry_id": entry.get("id"), "entry_number": entry.get("entry_number"), "customer": entry.get("customer"), "driver": entry.get("driver"),
                "viagem_codigo": entry.get("viagem_codigo"), "rota_codigo": entry.get("rota_codigo"),
                "created_at": now(), "created_by": user.get("id") if user else None, "created_by_name": user.get("name") if user else "sistema",
            })
        return
    if not skip_quantity:
        inc = {"quantity": delta}
        if reason == "mf_defeito": inc["defective_quantity"] = -delta
        await db.products.update_one({"id": match["id"]}, {"$inc": inc})
    elif reason == "mf_defeito":
        await db.products.update_one({"id": match["id"]}, {"$inc": {"defective_quantity": -delta}})
    movement = {
        "id": str(uuid.uuid4()), "product_id": match["id"], "product_name": match.get("name"), "brand": match.get("brand") or match.get("name"),
        "quantity": delta, "reason": reason, "from_carga": skip_quantity,
        "entry_id": entry.get("id"), "entry_number": entry.get("entry_number"), "customer": entry.get("customer"), "driver": entry.get("driver"),
        "viagem_codigo": entry.get("viagem_codigo"), "rota_codigo": entry.get("rota_codigo"),
        "created_at": now(), "created_by": user.get("id") if user else None, "created_by_name": user.get("name") if user else "sistema",
    }
    if extra: movement.update(extra)
    await db.stock_movements.insert_one(movement)

async def apply_entry_stock_movements(doc, reason, sign, user):
    products_cache = await db.products.find({}, {"_id": 0}).to_list(1000)
    viagem = await db.viagens.find_one({"id": doc["viagem_id"]}, {"_id": 0}) if doc.get("viagem_id") else None
    carga_brands = set()
    # Só enquanto a viagem está aberta a venda sai do caminhão; depois de finalizada a sobra já voltou
    # ao depósito, então qualquer ajuste da venda mexe direto no estoque do depósito.
    if viagem and viagem.get("carga_carregada") and viagem.get("status") != "finalizada":
        carga_brands = {(it.get("brand") or "").strip().lower() for it in (viagem.get("carga_items") or [])}
    def covered(brand): return (brand or "").strip().lower() in carga_brands

    items = doc.get("items")
    swap_now = doc.get("mf_plan") == "swap"
    if items:
        for it in items:
            qty = float(it.get("quantity") or 0) + (float(it.get("mf_quantity") or 0) if swap_now else 0)
            if qty > 0: await apply_stock_delta(products_cache, it.get("brand"), sign * -qty, reason, doc, user, skip_quantity=covered(it.get("brand")))
    else:
        qty = float(doc.get("billed_quantity") or 0) + (float(doc.get("mf_quantity") or 0) if swap_now else 0)
        if qty > 0: await apply_stock_delta(products_cache, doc.get("brand"), sign * -qty, reason, doc, user, skip_quantity=covered(doc.get("brand")))
    mf_plan = doc.get("mf_plan")
    if mf_plan in ("swap", "reschedule"):
        mf_items = [it for it in (items or []) if float(it.get("mf_quantity") or 0) > 0]
        mf_total = sum(float(it.get("mf_quantity") or 0) for it in mf_items) if items else float(doc.get("mf_quantity") or 0)
        mf_brand_qty = [(it.get("brand"), float(it["mf_quantity"])) for it in mf_items] if items else ([(doc.get("brand"), mf_total)] if mf_total > 0 else [])
        if sign == 1:
            if mf_plan == "swap":
                # Defective (microfuro) bottle swapped on the truck right away: flag for supplier exchange.
                # The replacement bottle itself comes from the pre-loaded truck stock when covered, so only
                # the defective_quantity bucket moves (handled inside apply_stock_delta); depot quantity does not.
                for brand, qty in mf_brand_qty:
                    await apply_stock_delta(products_cache, brand, -qty, "mf_defeito", doc, user, extra={"resolved": False}, skip_quantity=covered(brand))
            else:
                # Reschedule: no stock impact yet, just track that a future swap/pickup is owed.
                for brand, qty in mf_brand_qty:
                    match = match_product(products_cache, brand)
                    await db.stock_movements.insert_one({
                        "id": str(uuid.uuid4()), "product_id": match["id"] if match else None, "product_name": match.get("name") if match else None, "brand": (match.get("brand") or match.get("name")) if match else brand,
                        "quantity": 0, "pending_quantity": qty, "reason": "mf_reagendado", "resolved": False,
                        "entry_id": doc.get("id"), "entry_number": doc.get("entry_number"), "customer": doc.get("customer"), "driver": doc.get("driver"),
                        "mf_date": doc.get("mf_date"), "mf_due_date": doc.get("mf_due_date"), "created_at": now(), "created_by": user.get("id") if user else None, "created_by_name": user.get("name") if user else "sistema",
                    })
        else:
            # Estorno: any pending defect tracking for this entry no longer applies.
            pending_mf = await db.stock_movements.find({"entry_id": doc.get("id"), "reason": {"$in": ["mf_defeito", "mf_reagendado"]}, "resolved": False}, {"_id": 0}).to_list(50)
            await db.stock_movements.update_many({"entry_id": doc.get("id"), "reason": {"$in": ["mf_defeito", "mf_reagendado"]}, "resolved": False}, {"$set": {"resolved": True, "resolved_note": "Estornado"}})
            for m in pending_mf:
                if m.get("reason") == "mf_defeito" and m.get("product_id"):
                    qty = abs(float(m.get("quantity") or 0))
                    if qty: await db.products.update_one({"id": m["product_id"]}, {"$inc": {"defective_quantity": -qty}})
            if mf_plan == "swap":
                for brand, qty in mf_brand_qty:
                    await apply_stock_delta(products_cache, brand, qty, reason, doc, user, skip_quantity=covered(brand))

    # Vasilhame vazio: toda venda "somente água" (exchange) de produto retornável significa que o cliente
    # devolveu um vasilhame vazio na hora — isso vira estoque de vazio, separado do
    # pronto-pra-venda, aguardando envio ao fornecedor.
    if items:
        empty_by_brand = {}
        for it in items:
            if (it.get("sale_type") or "exchange") != "exchange": continue
            qty = float(it.get("quantity") or 0)
            if qty > 0: empty_by_brand[it.get("brand")] = empty_by_brand.get(it.get("brand"), 0) + qty
    else:
        empty_by_brand = {}
        if (doc.get("sale_type") or "exchange") == "exchange":
            qty = float(doc.get("billed_quantity") or 0)
            if qty > 0: empty_by_brand[doc.get("brand")] = qty
    if sign == 1:
        for brand, qty in empty_by_brand.items():
            match = match_product(products_cache, brand)
            if not match or not is_returnable(match): continue
            await db.products.update_one({"id": match["id"]}, {"$inc": {"empty_quantity": qty}})
            await db.stock_movements.insert_one({
                "id": str(uuid.uuid4()), "product_id": match["id"], "product_name": match.get("name"), "brand": match.get("brand") or match.get("name"),
                "quantity": qty, "reason": "vasilhame_vazio", "resolved": False,
                "entry_id": doc.get("id"), "entry_number": doc.get("entry_number"), "customer": doc.get("customer"), "driver": doc.get("driver"),
                "viagem_codigo": doc.get("viagem_codigo"), "rota_codigo": doc.get("rota_codigo"),
                "created_at": now(), "created_by": user.get("id") if user else None, "created_by_name": user.get("name") if user else "sistema",
            })
    else:
        pending_empty = await db.stock_movements.find({"entry_id": doc.get("id"), "reason": "vasilhame_vazio", "resolved": False}, {"_id": 0}).to_list(50)
        await db.stock_movements.update_many({"entry_id": doc.get("id"), "reason": "vasilhame_vazio", "resolved": False}, {"$set": {"resolved": True, "resolved_note": "Estornado"}})
        for m in pending_empty:
            if m.get("product_id"):
                await db.products.update_one({"id": m["product_id"]}, {"$inc": {"empty_quantity": -float(m.get("quantity") or 0)}})

@api.get("/stock-movements")
async def stock_movements(user=Depends(admin_user)): return await db.stock_movements.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)

@api.get("/mf-pendentes")
async def mf_pendentes(user=Depends(current_user)):
    """Trocas de MF reagendadas ainda não resolvidas — lembrete para incluir na carga da próxima viagem."""
    query = {"reason": "mf_reagendado", "resolved": False}
    if user.get("role") != "admin": query["driver"] = user["name"]
    rows = await db.stock_movements.find(query, {"_id": 0}).sort("created_at", 1).to_list(None)
    today = today_local()
    return [{"id": m["id"], "brand": m.get("brand"), "quantity": float(m.get("pending_quantity") or 0), "customer": m.get("customer"), "driver": m.get("driver"),
             "entry_number": m.get("entry_number"), "due_date": m.get("mf_due_date"), "due": (m.get("mf_due_date") or "") <= today} for m in rows]

@api.patch("/stock-movements/{item_id}")
async def update_stock_movement(item_id: str, user=Depends(admin_user)):
    target = await db.stock_movements.find_one({"id": item_id}, {"_id": 0})
    if not target: raise HTTPException(404, "Movimentação não encontrada")
    if target.get("reason") == "mf_reagendado" and not target.get("resolved"):
        qty = float(target.get("pending_quantity") or 0)
        if target.get("product_id") and qty > 0:
            await db.products.update_one({"id": target["product_id"]}, {"$inc": {"quantity": -qty, "defective_quantity": qty}})
            await db.stock_movements.insert_one({
                "id": str(uuid.uuid4()), "product_id": target["product_id"], "product_name": target.get("product_name"), "brand": target.get("brand"),
                "quantity": -qty, "reason": "mf_defeito", "resolved": False,
                "entry_id": target.get("entry_id"), "entry_number": target.get("entry_number"), "customer": target.get("customer"), "driver": target.get("driver"),
                "created_at": now(), "created_by": user["id"], "created_by_name": user["name"],
            })
        await db.stock_movements.update_one({"id": item_id}, {"$set": {"resolved": True, "resolved_note": "Troca realizada", "resolved_by": user["name"], "resolved_at": now()}})
    else:
        if target.get("reason") == "mf_defeito" and target.get("product_id"):
            qty = abs(float(target.get("quantity") or 0))
            if qty: await db.products.update_one({"id": target["product_id"]}, {"$inc": {"defective_quantity": -qty}})
        if target.get("reason") == "vasilhame_vazio" and target.get("product_id"):
            qty = abs(float(target.get("quantity") or 0))
            if qty: await db.products.update_one({"id": target["product_id"]}, {"$inc": {"empty_quantity": -qty}})
        resolved_note = "Enviado ao fornecedor" if target.get("reason") == "vasilhame_vazio" else "Trocado com o fornecedor"
        await db.stock_movements.update_one({"id": item_id}, {"$set": {"resolved": True, "resolved_note": resolved_note, "resolved_by": user["name"], "resolved_at": now()}})
    return await db.stock_movements.find_one({"id": item_id}, {"_id": 0})
async def create_resource(collection, payload, user):
    doc = payload.model_dump(exclude_none=True); doc.update({"id": str(uuid.uuid4()), "created_at": now(), "created_by": user["id"]})
    await db[collection].insert_one(doc); doc.pop("_id", None); return doc

@api.get("/products")
async def products(user=Depends(current_user)): return await list_resource("products")
async def ensure_unique_product(name, brand, exclude_id=None):
    key = (brand or name or "").strip().lower()
    if not key: return
    for p in await db.products.find({}, {"_id": 0, "id": 1, "name": 1, "brand": 1}).to_list(1000):
        if p["id"] != exclude_id and (p.get("brand") or p.get("name") or "").strip().lower() == key:
            raise HTTPException(409, f"Já existe um produto \"{p.get('name')}\" no estoque. Edite o existente em vez de criar outro com o mesmo nome.")

@api.post("/products")
async def add_product(data: ResourceInput, user=Depends(admin_user)):
    await ensure_unique_product(data.name, data.brand)
    if data.unit: normalize_unit(data.__dict__)
    return await create_resource("products", data, user)
@api.patch("/products/{item_id}")
async def update_product(item_id: str, data: ResourceInput, user=Depends(admin_user)):
    target = await db.products.find_one({"id": item_id}, {"_id": 0})
    if not target: raise HTTPException(404, "Produto não encontrado")
    values = normalize_unit(data.model_dump(exclude_unset=True))
    if "name" in values or "brand" in values:
        await ensure_unique_product(values.get("name", target.get("name")), values.get("brand", target.get("brand")), exclude_id=item_id)
    await db.products.update_one({"id": item_id}, {"$set": values})
    doc = await db.products.find_one({"id": item_id}, {"_id": 0})
    if "quantity" in values and float(values["quantity"]) != float(target.get("quantity") or 0):
        await log_activity("stock_adjusted", user, {"id": item_id, "name": doc.get("name")}, {"from": target.get("quantity"), "to": doc.get("quantity"), "reason": values.get("notes")})
    return doc
@api.get("/lots")
async def list_lots(product_id: Optional[str] = None, only_open: bool = False, user=Depends(admin_user)):
    query = {}
    if product_id: query["product_id"] = product_id
    if only_open: query["quantity_remaining"] = {"$gt": 0}
    return await db.lots.find(query, {"_id": 0}).sort([("purchase_date", -1), ("created_at", -1)]).to_list(2000)

@api.post("/products/{item_id}/lots")
async def add_lot(item_id: str, data: LotInput, user=Depends(admin_user)):
    product = await db.products.find_one({"id": item_id}, {"_id": 0})
    if not product: raise HTTPException(404, "Produto não encontrado")
    if data.quantity <= 0: raise HTTPException(400, "Informe uma quantidade maior que zero")
    if data.cost_price < 0 or (data.cost_price_full is not None and data.cost_price_full < 0): raise HTTPException(400, "O custo não pode ser negativo")
    purchase_date = data.purchase_date or today_local()
    try: datetime.fromisoformat(purchase_date)
    except ValueError: raise HTTPException(400, "Data de compra inválida")
    seq = await next_sequence(f"lot_{purchase_date}")
    lot = {
        "id": str(uuid.uuid4()), "code": lot_code(purchase_date, data.quantity, seq), "sequence": seq,
        "product_id": item_id, "product_name": product.get("name"), "brand": product.get("brand") or product.get("name"),
        "purchase_date": purchase_date, "quantity_initial": data.quantity, "quantity_remaining": data.quantity,
        "cost_unit": data.cost_price, "cost_unit_full": data.cost_price_full, "notes": data.notes,
        "adjusted_stock": data.adjust_stock, "created_at": now(), "created_by": user["id"], "created_by_name": user["name"],
    }
    await db.lots.insert_one(lot); lot.pop("_id", None)
    if data.adjust_stock:
        await db.products.update_one({"id": item_id}, {"$inc": {"quantity": data.quantity}, "$set": {"cost_price": data.cost_price, "purchase_date": purchase_date, "batch": lot["code"]}})
        await db.stock_movements.insert_one({
            "id": str(uuid.uuid4()), "product_id": item_id, "product_name": product.get("name"), "brand": product.get("brand") or product.get("name"),
            "quantity": data.quantity, "reason": "compra", "lot_code": lot["code"], "created_at": now(), "created_by": user["id"], "created_by_name": user["name"],
        })
        brand = await db.brands.find_one({"name": {"$regex": f"^{re.escape((product.get('brand') or product.get('name') or '').strip())}$", "$options": "i"}}, {"_id": 0})
        if brand and not (product.get("unit") or "").strip().lower().startswith("fardo"):
            changes = {"cost_price": data.cost_price}
            if data.cost_price_full is not None: changes["cost_price_full"] = data.cost_price_full
            for field, value in changes.items():
                if value != brand.get(field):
                    await db.cost_history.insert_one({"id": str(uuid.uuid4()), "brand_id": brand["id"], "brand_name": brand.get("name"), "field": field, "old_value": brand.get(field), "new_value": value, "changed_at": now(), "changed_by": user["name"], "lot_code": lot["code"]})
            await db.brands.update_one({"id": brand["id"]}, {"$set": changes})
    await log_activity("lot_created", user, {"id": lot["id"], "name": lot["code"]}, {"product": product.get("name"), "quantity": data.quantity, "cost": data.cost_price})
    return lot

@api.delete("/lots/{lot_id}")
async def delete_lot(lot_id: str, user=Depends(admin_user)):
    lot = await db.lots.find_one({"id": lot_id}, {"_id": 0})
    if not lot: raise HTTPException(404, "Lote não encontrado")
    if float(lot.get("quantity_remaining") or 0) != float(lot.get("quantity_initial") or 0):
        raise HTTPException(409, "Este lote já teve unidades vendidas e não pode ser excluído.")
    if lot.get("adjusted_stock"):
        await db.products.update_one({"id": lot["product_id"]}, {"$inc": {"quantity": -float(lot["quantity_initial"])}})
        await db.stock_movements.insert_one({
            "id": str(uuid.uuid4()), "product_id": lot["product_id"], "product_name": lot.get("product_name"), "brand": lot.get("brand"),
            "quantity": -float(lot["quantity_initial"]), "reason": "ajuste", "lot_code": lot["code"], "created_at": now(), "created_by": user["id"], "created_by_name": user["name"],
        })
    await db.lots.delete_one({"id": lot_id})
    await log_activity("lot_deleted", user, {"id": lot_id, "name": lot["code"]})
    return {"message": "Excluído"}

@api.get("/expenses")
async def expenses(user=Depends(current_user)): return await list_resource("expenses")
async def recompute_viagem_finance(viagem_id):
    v = await db.viagens.find_one({"id": viagem_id}, {"_id": 0})
    if not v or v.get("status") != "finalizada": return
    despesas = await db.expenses.find({"viagem_id": viagem_id, "status": {"$ne": "rejected"}}, {"_id": 0}).to_list(None)
    despesas_total = sum(float(d.get("amount") or 0) for d in despesas)
    total_bruto = float(v.get("total_bruto") or 0)
    await db.viagens.update_one({"id": viagem_id}, {"$set": {"despesas_total": despesas_total, "saldo_liquido": total_bruto - despesas_total}})

@api.post("/expenses")
async def add_expense(data: ResourceInput, user=Depends(current_user)):
    if user.get("role") != "admin": data.driver = user["name"]
    viagem = await db.viagens.find_one({"id": data.viagem_id}, {"_id": 0}) if data.viagem_id else None
    expense_day = viagem.get("date") if viagem else today_local()
    await ensure_day_open(expense_day, data.driver or user["name"], user)
    doc = await create_resource("expenses", data, user)
    if doc.get("viagem_id") and viagem:
        await db.expenses.update_one({"id": doc["id"]}, {"$set": {"viagem_codigo": viagem.get("codigo_viagem")}})
        doc["viagem_codigo"] = viagem.get("codigo_viagem")
        await recompute_viagem_finance(doc["viagem_id"])
    return doc
@api.patch("/expenses/{item_id}")
async def update_expense(item_id: str, data: ResourceInput, user=Depends(admin_user)):
    target = await db.expenses.find_one({"id": item_id}, {"_id": 0})
    if not target: raise HTTPException(404, "Lançamento não encontrado")
    values = data.model_dump(exclude_unset=True); values["reviewed_by"] = user["name"]; values["reviewed_at"] = now()
    await db.expenses.update_one({"id": item_id}, {"$set": values})
    doc = await db.expenses.find_one({"id": item_id}, {"_id": 0})
    await log_activity(f"expense_{doc.get('status','updated')}", user, {"id": item_id, "name": doc.get("type"), "email": doc.get("driver")})
    if doc.get("viagem_id"): await recompute_viagem_finance(doc["viagem_id"])
    return doc
@api.delete("/expenses/{item_id}")
async def delete_expense(item_id: str, user=Depends(current_user)):
    target = await db.expenses.find_one({"id": item_id}, {"_id": 0})
    if not target: raise HTTPException(404, "Lançamento não encontrado")
    if user.get("role") != "admin" and target.get("created_by") != user["id"]: raise HTTPException(403, "Sem permissão")
    await db.expenses.delete_one({"id": item_id})
    if target.get("viagem_id"): await recompute_viagem_finance(target["viagem_id"])
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
    before = await db.brands.find_one({"id": item_id}, {"_id": 0})
    values = data.model_dump(exclude_unset=True)
    if before:
        for field in ("cost_price", "cost_price_full"):
            if field in values and values[field] != before.get(field):
                await db.cost_history.insert_one({
                    "id": str(uuid.uuid4()), "brand_id": item_id, "brand_name": before.get("name"), "field": field,
                    "old_value": before.get(field), "new_value": values[field],
                    "changed_at": now(), "changed_by": user["name"],
                })
    await db.brands.update_one({"id": item_id}, {"$set": values})
    doc = await db.brands.find_one({"id": item_id}, {"_id": 0}); return doc

@api.get("/brands/cost-history")
async def brands_cost_history(brand_id: Optional[str] = None, user=Depends(admin_user)):
    query = {"brand_id": brand_id} if brand_id else {}
    return await db.cost_history.find(query, {"_id": 0}).sort("changed_at", -1).to_list(500)

@api.delete("/brands/{item_id}")
async def delete_brand(item_id: str, user=Depends(admin_user)):
    await db.brands.delete_one({"id": item_id})
    return {"message": "Excluída"}

@api.get("/customers/out-of-catalog-brands")
async def out_of_catalog_brands(user=Depends(admin_user)):
    entries = await db.daily_entries.find({"items": {"$elemMatch": {"out_of_catalog": True, "promoted": {"$ne": True}}}}, {"_id": 0}).to_list(None)
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
async def daily_entries(date: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None, driver: Optional[str] = None, customer: Optional[str] = None, codigo_viagem: Optional[str] = None, codigo_rota: Optional[str] = None, entry_number: Optional[int] = None, user=Depends(current_user)):
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
    if codigo_rota: query["rota_codigo"] = codigo_rota.strip()
    return await db.daily_entries.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)

@api.post("/daily-entries")
async def add_daily_entry(data: ResourceInput, user=Depends(current_user)):
    doc = data.model_dump(exclude_none=True)
    doc["driver"] = user["name"] if user.get("role") != "admin" else (doc.get("driver") or user["name"])
    doc["date"] = doc.get("date") or today_local()
    await ensure_day_open(doc["date"], doc["driver"], user)
    items = doc.get("items")
    # Grava o custo do fornecedor vigente NA HORA DA VENDA em cada item — se o fornecedor
    # reajustar o preço depois, vendas antigas continuam com a margem correta (histórica),
    # em vez de serem recalculadas com o custo novo.
    brands_catalog = await db.brands.find({}, {"_id": 0}).to_list(1000)
    brand_by_name = {(b.get("name") or "").strip().lower(): b for b in brands_catalog}
    if items:
        for it in items:
            it["cost_unit"] = cost_unit_for(brand_by_name.get((it.get("brand") or "").strip().lower()), it.get("sale_type") or "exchange")
    else:
        doc["cost_unit"] = cost_unit_for(brand_by_name.get((doc.get("brand") or "").strip().lower()), doc.get("sale_type") or "exchange")
    if items:
        billed_qty = sum(float(it.get("quantity") or 0) for it in items)
        mf_total = sum(float(it.get("mf_quantity") or 0) for it in items)
        total = sum(float(it.get("quantity") or 0) * float(it.get("price") or 0) for it in items)
        # MF trocado na hora entrega um galão bom no lugar do defeituoso, então o cliente paga
        # normalmente por ele — só não paga quando o galão fica pendente (reagendado/recusado).
        if doc.get("mf_plan") == "swap":
            total += sum(float(it.get("mf_quantity") or 0) * float(it.get("price") or 0) for it in items)
    else:
        qty = float(doc.get("quantity") or 0)
        mf_total = float(doc.get("mf_quantity") or 0)
        billed_qty = max(0.0, qty - mf_total)
        price = float(doc.get("price") or 0)
        total = billed_qty * price
        if doc.get("mf_plan") == "swap": total += mf_total * price
    doc["billed_quantity"] = billed_qty
    doc["mf_quantity"] = mf_total
    doc["total"] = total
    if doc.get("mf_plan") == "reschedule" and mf_total > 0: doc["mf_due_date"] = next_business_day(doc["date"])
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
        if viagem:
            doc["viagem_codigo"] = viagem.get("codigo_viagem")
            if doc.get("rota_id"):
                rota = _find_rota(viagem, doc["rota_id"])
                if not rota: raise HTTPException(400, "Rota não encontrada nesta viagem")
                doc["rota_codigo"] = rota.get("codigo_rota")
        added = billed_qty + (2 * mf_total if doc.get("mf_plan") == "swap" else 0)
        if doc.get("mf_plan") == "swap": await _check_swap_has_spare(doc["viagem_id"], doc.get("customer"), added)
        await _check_delivered_carga_limit(doc["viagem_id"], added)

    warnings = await apply_lot_costs(doc)
    await apply_entry_stock_movements(doc, "venda", 1, user)
    await db.daily_entries.insert_one(doc); doc.pop("_id", None)
    if warnings: doc["warnings"] = warnings
    return doc

@api.patch("/daily-entries/{item_id}")
async def update_daily_entry(item_id: str, data: ResourceInput, user=Depends(current_user)):
    target = await db.daily_entries.find_one({"id": item_id}, {"_id": 0})
    if not target: raise HTTPException(404, "Lançamento não encontrado")
    if user.get("role") != "admin" and target.get("created_by") != user["id"]: raise HTTPException(403, "Sem permissão")
    await ensure_day_open(target.get("date") or today_local(), target.get("driver") or user["name"], user)
    values = data.model_dump(exclude_unset=True)
    warnings = []

    if "items" in values or "quantity" in values:
        if target.get("viagem_id"):
            viagem = await db.viagens.find_one({"id": target["viagem_id"]}, {"_id": 0})
            if viagem and viagem.get("status") == "finalizada" and user.get("role") != "admin":
                raise HTTPException(400, "Esta viagem já foi finalizada — peça ao admin para corrigir esse lançamento")
        # Revisão de uma entrega já lançada: recalcula totais, valida o pagamento
        # e ajusta o estoque pela diferença (desfaz o efeito antigo, aplica o novo).
        merged = {**target, **values}
        items = merged.get("items")
        # Preserva o custo travado na venda original (histórico); só busca um custo novo
        # se a linha não existia antes (ex: marca adicionada nesta revisão).
        target_cost_by_brand = {}
        for ti in (target.get("items") or []):
            k = (ti.get("brand") or "").strip().lower()
            if ti.get("cost_unit") is not None: target_cost_by_brand.setdefault(k, ti["cost_unit"])
        if items and "items" in values:
            brands_catalog = await db.brands.find({}, {"_id": 0}).to_list(1000)
            brand_by_name = {(b.get("name") or "").strip().lower(): b for b in brands_catalog}
            for it in items:
                key = (it.get("brand") or "").strip().lower()
                if it.get("cost_unit") is None:
                    it["cost_unit"] = target_cost_by_brand.get(key, cost_unit_for(brand_by_name.get(key), it.get("sale_type") or "exchange"))
        elif not items and "quantity" in values:
            if merged.get("cost_unit") is None:
                brands_catalog = await db.brands.find({}, {"_id": 0}).to_list(1000)
                brand_by_name = {(b.get("name") or "").strip().lower(): b for b in brands_catalog}
                key = (merged.get("brand") or "").strip().lower()
                merged["cost_unit"] = target.get("cost_unit") or cost_unit_for(brand_by_name.get(key), merged.get("sale_type") or "exchange")
        if items:
            billed_qty = sum(float(it.get("quantity") or 0) for it in items)
            mf_total = sum(float(it.get("mf_quantity") or 0) for it in items)
            total = sum(float(it.get("quantity") or 0) * float(it.get("price") or 0) for it in items)
            if merged.get("mf_plan") == "swap":
                total += sum(float(it.get("mf_quantity") or 0) * float(it.get("price") or 0) for it in items)
        else:
            qty = float(merged.get("quantity") or 0)
            mf_total = float(merged.get("mf_quantity") or 0)
            billed_qty = max(0.0, qty - mf_total)
            total = billed_qty * float(merged.get("price") or 0)
            if merged.get("mf_plan") == "swap": total += mf_total * float(merged.get("price") or 0)
        merged["billed_quantity"] = billed_qty
        merged["mf_quantity"] = mf_total
        merged["total"] = total
        if merged.get("mf_plan") == "reschedule" and mf_total > 0: merged["mf_due_date"] = merged.get("mf_due_date") or next_business_day(merged.get("date") or today_local())
        comp_value = float(merged.get("comp_value") or 0)
        pix_value = float(merged.get("pix_value") or 0)
        cash_value = float(merged.get("cash_value") or 0)
        if round(pix_value + cash_value + comp_value, 2) != round(total, 2):
            raise HTTPException(400, f"Pix + Dinheiro + A prazo (R$ {pix_value + cash_value + comp_value:.2f}) precisa somar o total do lançamento (R$ {total:.2f})")
        if target.get("viagem_id"):
            added = billed_qty + (2 * mf_total if merged.get("mf_plan") == "swap" else 0)
            if merged.get("mf_plan") == "swap": await _check_swap_has_spare(target["viagem_id"], merged.get("customer"), added, exclude_entry_id=item_id)
            await _check_delivered_carga_limit(target["viagem_id"], added, exclude_entry_id=item_id)
        await release_lots(target)
        warnings = await apply_lot_costs(merged)
        await apply_entry_stock_movements(target, "estorno", -1, user)
        await apply_entry_stock_movements(merged, "venda", 1, user)
        values = {k: v for k, v in merged.items() if k not in ("id", "created_at", "created_by")}

    await db.daily_entries.update_one({"id": item_id}, {"$set": values})
    doc = await db.daily_entries.find_one({"id": item_id}, {"_id": 0})
    if warnings: doc["warnings"] = warnings
    return doc

@api.delete("/daily-entries/{item_id}")
async def delete_daily_entry(item_id: str, user=Depends(current_user)):
    target = await db.daily_entries.find_one({"id": item_id}, {"_id": 0})
    if not target: raise HTTPException(404, "Lançamento não encontrado")
    if user.get("role") != "admin" and target.get("created_by") != user["id"]: raise HTTPException(403, "Sem permissão")
    await ensure_day_open(target.get("date") or today_local(), target.get("driver") or user["name"], user)
    if target.get("viagem_id"):
        viagem = await db.viagens.find_one({"id": target["viagem_id"]}, {"_id": 0})
        if viagem and viagem.get("status") == "finalizada" and user.get("role") != "admin":
            raise HTTPException(400, "Esta viagem já foi finalizada — peça ao admin para corrigir esse lançamento")
    await release_lots(target)
    await apply_entry_stock_movements(target, "estorno", -1, user)
    await db.daily_entries.delete_one({"id": item_id})
    return {"message": "Excluído"}

TURNO_LABELS = {0: "Manhã", 1: "Tarde"}
VIAGENS_POR_TURNO = 6
VIAGENS_POR_DIA = VIAGENS_POR_TURNO * len(TURNO_LABELS)

def gerar_codigo_viagem(turno: int, date_str: str, numero: int) -> str:
    d = datetime.fromisoformat(date_str)
    return f"{turno}{d.day:02d}{d.month:02d}{d.year:04d}{str(numero).zfill(3)}"

@api.post("/viagens")
async def create_viagem(data: ViagemInput, user=Depends(current_user)):
    if data.turno not in TURNO_LABELS: raise HTTPException(400, "Turno inválido (use 0 para manhã ou 1 para tarde)")
    driver_name = user["name"]
    if data.driver and user.get("role") == "admin": driver_name = data.driver
    date_str = data.date or today_local()
    await ensure_day_open(date_str, driver_name, user)

    count_turno = await db.viagens.count_documents({"driver": driver_name, "date": date_str, "turno": data.turno})
    if count_turno >= VIAGENS_POR_TURNO:
        raise HTTPException(400, f"Máximo de {VIAGENS_POR_TURNO} viagens no turno da {TURNO_LABELS[data.turno].lower()} ({date_str}) — já existem {count_turno}.")

    numero = await db.viagens.count_documents({"driver": driver_name, "date": date_str}) + 1
    seq_global = await db.viagens.count_documents({"date": date_str, "turno": data.turno}) + 1
    codigo = gerar_codigo_viagem(data.turno, date_str, seq_global)
    if await db.viagens.find_one({"codigo_viagem": codigo}):
        raise HTTPException(409, f"Já existe uma viagem com o código {codigo}")

    carga_items = [{"brand": (it.get("brand") or "").strip(), "quantity": float(it.get("quantity") or 0)} for it in (data.carga_items or []) if (it.get("brand") or "").strip() and float(it.get("quantity") or 0) > 0]
    carga_total = data.carga_total if data.carga_total is not None else (sum(it["quantity"] for it in carga_items) or None)
    doc = {
        "id": str(uuid.uuid4()), "codigo_viagem": codigo, "driver": driver_name, "numero": numero,
        "turno": data.turno, "date": date_str, "carga_total": carga_total, "carga_items": carga_items, "carga_carregada": False,
        "notes": data.notes, "rotas": [], "status": "planejada",
        "created_at": now(), "created_by": user["id"], "updated_at": now(),
    }
    await db.viagens.insert_one(doc); doc.pop("_id", None)
    await log_activity("viagem_criada", user, {"id": doc["id"], "name": codigo}, {"driver": driver_name, "turno": data.turno})
    return doc

@api.get("/viagens")
async def list_viagens(date: Optional[str] = None, driver: Optional[str] = None, user=Depends(current_user)):
    query = {}
    if user.get("role") != "admin": query["driver"] = user["name"]
    elif driver: query["driver"] = driver
    if date: query["date"] = date
    viagens = await db.viagens.find(query, {"_id": 0}).sort("numero", 1).to_list(500)
    return {"total": len(viagens), "limite": VIAGENS_POR_DIA, "viagens": viagens}

@api.patch("/viagens/{item_id}")
async def update_viagem(item_id: str, data: dict, user=Depends(current_user)):
    v = await _own_viagem_or_404(item_id, user)
    await ensure_day_open(v.get("date") or today_local(), v.get("driver") or user["name"], user)
    if v["status"] == "finalizada": raise HTTPException(400, "Viagem já está finalizada")
    values = {}
    if "carga_total" in data:
        values["carga_total"] = float(data["carga_total"]) if data["carga_total"] not in (None, "") else None
    if "notes" in data: values["notes"] = data["notes"]
    if values:
        values["updated_at"] = now()
        await db.viagens.update_one({"id": item_id}, {"$set": values})
    return await db.viagens.find_one({"id": item_id}, {"_id": 0})

async def _own_viagem_or_404(item_id, user):
    v = await db.viagens.find_one({"id": item_id}, {"_id": 0})
    if not v: raise HTTPException(404, "Viagem não encontrada")
    if user.get("role") != "admin" and v.get("driver") != user["name"]: raise HTTPException(403, "Sem permissão")
    return v

def _find_rota(v, rota_id):
    for r in (v.get("rotas") or []):
        if r.get("id") == rota_id: return r
    return None

def _planned_quantity(v, exclude_cliente_id=None):
    total = 0.0
    for r in (v.get("rotas") or []):
        for c in (r.get("clientes") or []):
            if c.get("id") == exclude_cliente_id: continue
            total += float(c.get("quantity") or 0)
    return total

def _check_carga_limit(v, added_quantity, exclude_cliente_id=None):
    carga_total = v.get("carga_total")
    if not carga_total: return
    total = _planned_quantity(v, exclude_cliente_id) + float(added_quantity or 0)
    if total > carga_total:
        restante = max(0, carga_total - _planned_quantity(v, exclude_cliente_id))
        raise HTTPException(400, f"Isso passa da carga da viagem ({total:g}/{carga_total:g} un somando todas as rotas). Restam {restante:g} un disponíveis.")

async def _delivered_quantity(viagem_id, exclude_entry_id=None):
    entregas = await db.daily_entries.find({"viagem_id": viagem_id}, {"_id": 0}).to_list(None)
    total = 0.0
    for e in entregas:
        if e.get("id") == exclude_entry_id: continue
        total += float(e.get("billed_quantity") or 0)
        if e.get("mf_plan") == "swap":
            items = e.get("items") or ([{"mf_quantity": e.get("mf_quantity")}] if e.get("mf_quantity") else [])
            total += 2 * sum(float(it.get("mf_quantity") or 0) for it in items)
    return total

async def _check_swap_has_spare(viagem_id, customer, this_use, exclude_entry_id=None):
    """Troca de MF na hora só é possível se a carga tem sobra além do que ainda falta entregar na rota."""
    viagem = await db.viagens.find_one({"id": viagem_id}, {"_id": 0})
    carga_total = viagem.get("carga_total") if viagem else None
    if not carga_total: return
    entregas = await db.daily_entries.find({"viagem_id": viagem_id}, {"_id": 0, "id": 1, "customer": 1}).to_list(None)
    entregues = {e.get("customer") for e in entregas if e.get("id") != exclude_entry_id}
    pendente = sum(float(c.get("quantity") or 0) for r in (viagem.get("rotas") or []) for c in (r.get("clientes") or [])
                   if c.get("name") not in entregues and c.get("name") != customer and c.get("status") != "nao_entregue")
    usado = await _delivered_quantity(viagem_id, exclude_entry_id)
    if usado + float(this_use) + pendente > float(carga_total):
        raise HTTPException(400, "A carga desta viagem está certa para a rota e não tem sobra para trocar o galão com microfuro agora. Escolha \"Entregar outro dia\": a troca fica para o próximo dia útil e entra como lembrete para incluir na próxima viagem.")

async def _check_delivered_carga_limit(viagem_id, added_quantity, exclude_entry_id=None):
    viagem = await db.viagens.find_one({"id": viagem_id}, {"_id": 0})
    carga_total = viagem.get("carga_total") if viagem else None
    if not carga_total: return
    delivered = await _delivered_quantity(viagem_id, exclude_entry_id)
    total = delivered + float(added_quantity or 0)
    if total > carga_total:
        restante = max(0, carga_total - delivered)
        raise HTTPException(400, f"Isso passa da carga da viagem ({total:g}/{carga_total:g} un entregues). Restam {restante:g} un — ajuste a carga da viagem ou revise as rotas em \"Viagens do dia\" antes de lançar.")

@api.post("/viagens/{item_id}/rotas")
async def add_rota(item_id: str, data: RotaInput, user=Depends(current_user)):
    v = await _own_viagem_or_404(item_id, user)
    await ensure_day_open(v.get("date") or today_local(), v.get("driver") or user["name"], user)
    if v["status"] == "finalizada": raise HTTPException(400, "Viagem já está finalizada")
    added = sum(float(c.get("quantity") or 0) for c in (data.clientes or []))
    _check_carga_limit(v, added)
    numero = len(v.get("rotas") or []) + 1
    rota = {
        "id": str(uuid.uuid4()), "numero": numero, "codigo_rota": f"{v['codigo_viagem']}-R{str(numero).zfill(2)}",
        "clientes": data.clientes or [], "created_at": now(),
    }
    await db.viagens.update_one({"id": item_id}, {"$push": {"rotas": rota}, "$set": {"updated_at": now()}})
    return await db.viagens.find_one({"id": item_id}, {"_id": 0})

@api.post("/viagens/{item_id}/rotas/{rota_id}/clientes")
async def add_rota_cliente(item_id: str, rota_id: str, data: dict, user=Depends(current_user)):
    v = await _own_viagem_or_404(item_id, user)
    await ensure_day_open(v.get("date") or today_local(), v.get("driver") or user["name"], user)
    if v["status"] == "finalizada": raise HTTPException(400, "Viagem já está finalizada")
    rota = _find_rota(v, rota_id)
    if not rota: raise HTTPException(404, "Rota não encontrada")
    if not data.get("id") or not data.get("name"): raise HTTPException(400, "Informe o cliente")
    if any(c.get("id") == data["id"] for c in (rota.get("clientes") or [])):
        return await db.viagens.find_one({"id": item_id}, {"_id": 0})
    _check_carga_limit(v, data.get("quantity"))
    cliente = {"id": data["id"], "name": data["name"], "brand": data.get("brand"), "quantity": data.get("quantity"), "sale_type": data.get("sale_type"), "notes": data.get("notes")}
    await db.viagens.update_one({"id": item_id, "rotas.id": rota_id}, {"$push": {"rotas.$.clientes": cliente}, "$set": {"updated_at": now()}})
    return await db.viagens.find_one({"id": item_id}, {"_id": 0})

CLIENTE_ROTA_EDITABLE_FIELDS = ("status", "name", "brand", "quantity", "sale_type", "notes")

@api.patch("/viagens/{item_id}/rotas/{rota_id}/clientes/{cliente_id}")
async def update_rota_cliente(item_id: str, rota_id: str, cliente_id: str, data: dict, user=Depends(current_user)):
    v = await _own_viagem_or_404(item_id, user)
    await ensure_day_open(v.get("date") or today_local(), v.get("driver") or user["name"], user)
    rota = _find_rota(v, rota_id)
    if not rota: raise HTTPException(404, "Rota não encontrada")
    if "quantity" in data: _check_carga_limit(v, data.get("quantity"), exclude_cliente_id=cliente_id)
    clientes = rota.get("clientes") or []
    for c in clientes:
        if c.get("id") == cliente_id:
            for f in CLIENTE_ROTA_EDITABLE_FIELDS:
                if f in data: c[f] = data[f]
            break
    else:
        clientes.append({"id": cliente_id, "name": data.get("name") or cliente_id, "status": data.get("status")})
    await db.viagens.update_one({"id": item_id, "rotas.id": rota_id}, {"$set": {"rotas.$.clientes": clientes, "updated_at": now()}})
    return await db.viagens.find_one({"id": item_id}, {"_id": 0})

@api.delete("/viagens/{item_id}/rotas/{rota_id}/clientes/{cliente_id}")
async def remove_rota_cliente(item_id: str, rota_id: str, cliente_id: str, user=Depends(current_user)):
    v = await _own_viagem_or_404(item_id, user)
    await ensure_day_open(v.get("date") or today_local(), v.get("driver") or user["name"], user)
    if v["status"] == "finalizada": raise HTTPException(400, "Viagem já está finalizada")
    rota = _find_rota(v, rota_id)
    if not rota: raise HTTPException(404, "Rota não encontrada")
    await db.viagens.update_one({"id": item_id, "rotas.id": rota_id}, {"$pull": {"rotas.$.clientes": {"id": cliente_id}}, "$set": {"updated_at": now()}})
    return await db.viagens.find_one({"id": item_id}, {"_id": 0})

@api.delete("/viagens/{item_id}/rotas/{rota_id}")
async def delete_rota(item_id: str, rota_id: str, user=Depends(current_user)):
    v = await _own_viagem_or_404(item_id, user)
    await ensure_day_open(v.get("date") or today_local(), v.get("driver") or user["name"], user)
    if v["status"] == "finalizada": raise HTTPException(400, "Viagem já está finalizada")
    rota = _find_rota(v, rota_id)
    if not rota: raise HTTPException(404, "Rota não encontrada")
    if await db.daily_entries.count_documents({"rota_id": rota_id}) > 0:
        raise HTTPException(400, "Não é possível excluir uma rota que já tem entregas lançadas")
    await db.viagens.update_one({"id": item_id}, {"$pull": {"rotas": {"id": rota_id}}, "$set": {"updated_at": now()}})
    return await db.viagens.find_one({"id": item_id}, {"_id": 0})

@api.post("/viagens/{item_id}/iniciar")
async def iniciar_viagem(item_id: str, user=Depends(current_user)):
    v = await _own_viagem_or_404(item_id, user)
    await ensure_day_open(v.get("date") or today_local(), v.get("driver") or user["name"], user)
    if v["status"] != "planejada": raise HTTPException(400, f"Viagem já está {v['status']}")
    outra_em_execucao = await db.viagens.find_one({"driver": v["driver"], "status": "execucao", "id": {"$ne": item_id}}, {"_id": 0})
    if outra_em_execucao:
        raise HTTPException(400, f"Finalize a viagem {outra_em_execucao['codigo_viagem']} antes de iniciar outra")
    values = {"status": "execucao", "updated_at": now()}
    carga_items = v.get("carga_items") or []
    if carga_items:
        products_cache = await db.products.find({}, {"_id": 0}).to_list(1000)
        faltando = []
        for item in carga_items:
            match = match_product(products_cache, item["brand"])
            disponivel = float(match.get("quantity") or 0) if match else 0
            if disponivel < item["quantity"]:
                faltando.append(f"{item['brand']} (precisa {item['quantity']:g}, tem {disponivel:g})")
        if faltando:
            raise HTTPException(400, "Estoque insuficiente para carregar: " + "; ".join(faltando) + ". Ajuste a carga da viagem ou reponha o estoque antes de iniciar.")
        ref = viagem_ref(v)
        for item in carga_items:
            await apply_stock_delta(products_cache, item["brand"], -item["quantity"], "carregamento", ref, user)
        values["carga_carregada"] = True
    await db.viagens.update_one({"id": item_id}, {"$set": values})
    return await db.viagens.find_one({"id": item_id}, {"_id": 0})

@api.post("/viagens/{item_id}/finalizar")
async def finalizar_viagem(item_id: str, user=Depends(current_user)):
    v = await _own_viagem_or_404(item_id, user)
    if v["status"] == "finalizada": raise HTTPException(400, "Viagem já está finalizada")
    entregas = await db.daily_entries.find({"viagem_id": item_id}, {"_id": 0}).to_list(None)
    despesas = await db.expenses.find({"viagem_id": item_id, "status": {"$ne": "rejected"}}, {"_id": 0}).to_list(None)
    total_bruto = sum(entry_total(e) for e in entregas)
    despesas_total = sum(float(d.get("amount") or 0) for d in despesas)
    billed_total = sum(float(e.get("billed_quantity") or 0) for e in entregas)
    mf_swap_total = 0.0
    mf_problema_total = 0.0
    for e in entregas:
        items = e.get("items") or ([{"brand": e.get("brand"), "quantity": e.get("billed_quantity"), "mf_quantity": e.get("mf_quantity")}] if e.get("brand") else [])
        for it in items:
            mf_qty = float(it.get("mf_quantity") or 0)
            if mf_qty <= 0: continue
            mf_problema_total += mf_qty
            if e.get("mf_plan") == "swap": mf_swap_total += mf_qty
    # Um MF trocado na hora consome um galão bom extra do caminhão, então ele conta
    # como "entregue" para bater com a carga — mesmo não sendo cobrado do cliente.
    quantidade_entregue = billed_total + mf_swap_total
    problemas = sum(1 for e in entregas if float(e.get("mf_quantity") or 0) > 0)
    values = {"status": "finalizada", "total_bruto": total_bruto, "quantidade_entregue": quantidade_entregue,
              "entregas": len(entregas), "problemas": problemas, "mf_quantity_total": mf_problema_total,
              "despesas_total": despesas_total, "saldo_liquido": total_bruto - despesas_total, "updated_at": now()}

    if v.get("carga_carregada") and v.get("carga_items"):
        used_by_brand = {}
        for e in entregas:
            items = e.get("items") or ([{"brand": e.get("brand"), "quantity": e.get("billed_quantity"), "mf_quantity": e.get("mf_quantity")}] if e.get("brand") else [])
            for it in items:
                key = (it.get("brand") or "").strip().lower()
                if not key: continue
                used_by_brand[key] = used_by_brand.get(key, 0) + float(it.get("quantity") or 0)
                if e.get("mf_plan") == "swap": used_by_brand[key] += 2 * float(it.get("mf_quantity") or 0)
        products_cache = await db.products.find({}, {"_id": 0}).to_list(1000)
        ref = viagem_ref(v)
        carga_devolvida_total = 0.0
        for item in v["carga_items"]:
            key = item["brand"].strip().lower()
            sobra = item["quantity"] - used_by_brand.get(key, 0)
            if sobra > 0.0001:
                await apply_stock_delta(products_cache, item["brand"], sobra, "retorno_carga", ref, user)
                carga_devolvida_total += sobra
        values["carga_devolvida_total"] = carga_devolvida_total

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
    todays_entries = await db.daily_entries.find(today_query, {"_id": 0}).to_list(None)
    received_today = sum(float(e.get("pix_value") or 0) + float(e.get("cash_value") or 0) for e in todays_entries)
    comp_today = sum(float(e.get("comp_value") or 0) for e in todays_entries)

    comp_query = {"comp_value": {"$gt": 0}}
    if scope_driver: comp_query["driver"] = scope_driver
    all_comp = await db.daily_entries.find(comp_query, {"_id": 0}).to_list(None)
    comp_pending_total = sum(float(e.get("comp_value") or 0) for e in all_comp if not e.get("received"))
    comp_received_total = sum(float(e.get("comp_value") or 0) for e in all_comp if e.get("received"))

    todays_expenses = await expenses_for_day(today, scope_driver)
    expenses_today_total = sum(float(e.get("amount") or 0) for e in todays_expenses if e.get("status") != "rejected")

    all_exp_query = {} if not scope_driver else {"driver": scope_driver}
    all_expenses = await db.expenses.find(all_exp_query, {"_id": 0}).to_list(None)
    expenses_pending_total = sum(float(e.get("amount") or 0) for e in all_expenses if e.get("status") == "pending")

    return {
        "date": today, "received_today": received_today, "comp_today": comp_today,
        "comp_pending_total": comp_pending_total, "comp_received_total": comp_received_total,
        "expenses_today_total": expenses_today_total, "expenses_pending_total": expenses_pending_total,
        "balance_today": received_today - expenses_today_total,
    }

DEFAULT_TARGET_MARGIN = 0.30

@api.get("/reports/margin")
async def margin_report(start: Optional[str] = None, end: Optional[str] = None, user=Depends(admin_user)):
    start = start or today_local()[:7] + "-01"
    end = end or today_local()
    query = {"date": {"$gte": start, "$lte": end}}
    entries = await db.daily_entries.find(query, {"_id": 0}).to_list(None)
    brands_catalog = await db.brands.find({}, {"_id": 0}).to_list(1000)
    products_catalog = await db.products.find({}, {"_id": 0}).to_list(1000)
    brand_by_name = {(b.get("name") or "").strip().lower(): b for b in brands_catalog}

    per_brand = {}
    for e in entries:
        items = e.get("items") or ([{"brand": e.get("brand"), "quantity": e.get("billed_quantity"), "price": e.get("price"), "mf_quantity": e.get("mf_quantity"), "sale_type": e.get("sale_type"), "cost_unit": e.get("cost_unit")}] if e.get("brand") else [])
        for it in items:
            name = (it.get("brand") or "").strip()
            if not name: continue
            key = name.lower()
            sale_type = it.get("sale_type") or "exchange"
            qty = float(it.get("quantity") or 0)
            if e.get("mf_plan") == "swap": qty += float(it.get("mf_quantity") or 0)
            revenue = qty * float(it.get("price") or 0)
            # Usa o custo travado na venda (histórico); só recorre ao custo atual do
            # cadastro para lançamentos antigos, feitos antes dessa trava existir.
            cost_unit = it["cost_unit"] if it.get("cost_unit") is not None else cost_unit_for(brand_by_name.get(key), sale_type)
            b = per_brand.setdefault(key, {"brand": name, "quantity": 0.0, "revenue": 0.0, "cost_total": 0.0, "cost_known": True})
            b["quantity"] += qty
            b["revenue"] += revenue
            if cost_unit is None: b["cost_known"] = False
            else: b["cost_total"] += qty * cost_unit

    per_customer = {}
    for e in entries:
        cust = (e.get("customer") or "").strip()
        if not cust: continue
        items = e.get("items") or ([{"brand": e.get("brand"), "quantity": e.get("billed_quantity"), "price": e.get("price"), "mf_quantity": e.get("mf_quantity"), "sale_type": e.get("sale_type"), "cost_unit": e.get("cost_unit")}] if e.get("brand") else [])
        c = per_customer.setdefault(cust, {"customer": cust, "quantity": 0.0, "revenue": 0.0, "cost_total": 0.0, "cost_known": True, "entregas": 0})
        c["entregas"] += 1
        for it in items:
            name = (it.get("brand") or "").strip()
            if not name: continue
            key = name.lower()
            sale_type = it.get("sale_type") or "exchange"
            qty = float(it.get("quantity") or 0)
            if e.get("mf_plan") == "swap": qty += float(it.get("mf_quantity") or 0)
            revenue = qty * float(it.get("price") or 0)
            cost_unit = it["cost_unit"] if it.get("cost_unit") is not None else cost_unit_for(brand_by_name.get(key), sale_type)
            c["quantity"] += qty
            c["revenue"] += revenue
            if cost_unit is None: c["cost_known"] = False
            else: c["cost_total"] += qty * cost_unit

    customers_rows = []
    for c in per_customer.values():
        has_cost = c["cost_known"]
        cost_total = c["cost_total"] if has_cost else None
        margin_value = (c["revenue"] - cost_total) if has_cost else None
        margin_pct = (margin_value / c["revenue"]) if has_cost and c["revenue"] > 0 else None
        customers_rows.append({
            "customer": c["customer"], "entregas": c["entregas"], "quantity": c["quantity"],
            "revenue": round(c["revenue"], 2), "cost_total": round(cost_total, 2) if cost_total is not None else None,
            "margin_value": round(margin_value, 2) if margin_value is not None else None,
            "margin_pct": round(margin_pct, 4) if margin_pct is not None else None,
        })
    customers_rows.sort(key=lambda c: (c["margin_pct"] if c["margin_pct"] is not None else -999))

    def category_of(name, catalog):
        if catalog and catalog.get("category"): return catalog.get("category")
        match = match_product(products_catalog, name)
        return match.get("category") if match else None

    rows = []
    for key, b in per_brand.items():
        catalog = brand_by_name.get(key)
        target = (catalog.get("target_margin") if catalog and catalog.get("target_margin") is not None else DEFAULT_TARGET_MARGIN)
        has_cost = b["cost_known"]
        cost_total = b["cost_total"] if has_cost else None
        margin_value = (b["revenue"] - cost_total) if has_cost else None
        margin_pct = (margin_value / b["revenue"]) if has_cost and b["revenue"] > 0 else None
        if not has_cost: status = "sem_custo"
        elif margin_pct < 0: status = "prejuizo"
        elif margin_pct < target * 0.5: status = "baixa"
        elif margin_pct < target: status = "atencao"
        else: status = "saudavel"
        rows.append({
            "brand": b["brand"], "category": category_of(b["brand"], catalog) or "Sem categoria", "quantity": b["quantity"],
            "revenue": round(b["revenue"], 2), "cost_price": catalog.get("cost_price") if catalog else None,
            "cost_price_full": catalog.get("cost_price_full") if catalog else None,
            "cost_total": round(cost_total, 2) if cost_total is not None else None,
            "margin_value": round(margin_value, 2) if margin_value is not None else None, "margin_pct": round(margin_pct, 4) if margin_pct is not None else None,
            "target_margin": target, "status": status,
        })
    rows.sort(key=lambda r: (r["margin_pct"] if r["margin_pct"] is not None else -999))

    counts = {"saudavel": 0, "atencao": 0, "baixa": 0, "prejuizo": 0, "sem_custo": 0}
    for r in rows: counts[r["status"]] += 1
    revenue_total = sum(r["revenue"] for r in rows)
    margin_total = sum(r["margin_value"] for r in rows if r["margin_value"] is not None)
    margin_media = (margin_total / revenue_total) if revenue_total > 0 else None

    by_category = {}
    for r in rows:
        c = by_category.setdefault(r["category"], {"category": r["category"], "revenue": 0.0, "margin_value": 0.0, "has_cost_revenue": 0.0, "produtos": 0, "em_risco": 0})
        c["produtos"] += 1
        c["revenue"] += r["revenue"]
        if r["margin_value"] is not None:
            c["margin_value"] += r["margin_value"]
            c["has_cost_revenue"] += r["revenue"]
        if r["status"] in ("baixa", "prejuizo"): c["em_risco"] += 1
    categories = []
    for c in by_category.values():
        c["margin_pct"] = round(c["margin_value"] / c["has_cost_revenue"], 4) if c["has_cost_revenue"] > 0 else None
        c.pop("has_cost_revenue")
        c["revenue"] = round(c["revenue"], 2); c["margin_value"] = round(c["margin_value"], 2)
        categories.append(c)
    categories.sort(key=lambda c: (c["margin_pct"] if c["margin_pct"] is not None else -999))

    def margin_for_entries(subset):
        total_revenue = 0.0
        total_margin = 0.0
        for e in subset:
            sub_items = e.get("items") or ([{"brand": e.get("brand"), "quantity": e.get("billed_quantity"), "price": e.get("price"), "mf_quantity": e.get("mf_quantity"), "sale_type": e.get("sale_type"), "cost_unit": e.get("cost_unit")}] if e.get("brand") else [])
            for it in sub_items:
                n = (it.get("brand") or "").strip()
                if not n: continue
                cu = it["cost_unit"] if it.get("cost_unit") is not None else cost_unit_for(brand_by_name.get(n.lower()), it.get("sale_type") or "exchange")
                if cu is None: continue
                q = float(it.get("quantity") or 0)
                if e.get("mf_plan") == "swap": q += float(it.get("mf_quantity") or 0)
                rev = q * float(it.get("price") or 0)
                total_revenue += rev
                total_margin += rev - q * cu
        return (total_margin / total_revenue) if total_revenue > 0 else None

    end_date = datetime.fromisoformat(end)
    evo_start = (end_date - timedelta(weeks=7)).date().isoformat()
    evo_entries = entries if evo_start >= start else await db.daily_entries.find({"date": {"$gte": evo_start, "$lte": end}}, {"_id": 0}).to_list(None)
    evolution = []
    for i in range(7, -1, -1):
        b_end = end_date - timedelta(days=7 * i)
        b_start = b_end - timedelta(days=6)
        b_start_s, b_end_s = b_start.date().isoformat(), b_end.date().isoformat()
        bucket = [e for e in evo_entries if b_start_s <= e.get("date", "") <= b_end_s]
        m = margin_for_entries(bucket)
        evolution.append({"label": f"{b_end.day:02d}/{b_end.month:02d}", "start": b_start_s, "end": b_end_s, "margin_pct": round(m, 4) if m is not None else None})

    expenses = await db.expenses.find(
        {"created_at": {"$gte": local_day_start_utc(start), "$lte": local_day_end_utc(end)}, "status": {"$ne": "rejected"}}, {"_id": 0}
    ).to_list(None)
    expenses_total = sum(float(x.get("amount") or 0) for x in expenses)
    lucro_liquido = margin_total - expenses_total

    return {
        "start": start, "end": end, "total_produtos": len(rows), "counts": counts,
        "margin_media": round(margin_media, 4) if margin_media is not None else None,
        "revenue_total": round(revenue_total, 2), "rows": rows, "categories": categories, "evolution": evolution,
        "customers": customers_rows, "expenses_total": round(expenses_total, 2), "lucro_liquido": round(lucro_liquido, 2),
        "default_target_margin": DEFAULT_TARGET_MARGIN,
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
    entries = await db.daily_entries.find(query, {"_id": 0}).sort("due_date", 1).to_list(None)
    totals = {"pending": sum(float(e.get("comp_value") or 0) for e in entries if not e.get("received")), "received": sum(float(e.get("comp_value") or 0) for e in entries if e.get("received"))}
    return {"rows": entries, "totals": totals}

async def _profit_rows(start, end, group_by):
    query = {}
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end
        query["date"] = rng
    entries = await db.daily_entries.find(query, {"_id": 0}).to_list(None)
    brands_cat = await db.brands.find({}, {"_id": 0}).to_list(1000)
    brand_by_name = {(b.get("name") or "").strip().lower(): b for b in brands_cat}
    rows = {}
    for e in entries:
        customer = e.get("customer") or "Sem cliente"
        items = e.get("items") or ([{"brand": e.get("brand"), "quantity": e.get("billed_quantity"), "price": e.get("price"), "mf_quantity": e.get("mf_quantity"), "sale_type": e.get("sale_type"), "cost_unit": e.get("cost_unit")}] if e.get("brand") else [])
        for it in items:
            brand = (it.get("brand") or "").strip()
            qty = float(it.get("quantity") or 0)
            if e.get("mf_plan") == "swap": qty += float(it.get("mf_quantity") or 0)
            if qty <= 0: continue
            price = float(it.get("price") or 0)
            # Mesmo critério de /reports/margin: custo travado na venda, senão o do cadastro (completa vs somente água).
            cost = it["cost_unit"] if it.get("cost_unit") is not None else cost_unit_for(brand_by_name.get(brand.lower()), it.get("sale_type") or "exchange")
            cost = cost or 0
            key = customer if group_by == "customer" else (brand or "Sem marca")
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

@api.get("/daily-closing/status")
async def daily_closing_status(date: Optional[str] = None, driver: Optional[str] = None, user=Depends(current_user)):
    day = date or today_local()
    driver_name = driver if user.get("role") == "admin" and driver else user["name"]
    record = await day_closing_record(day, driver_name)
    return {"date": day, "driver": driver_name, "closed": bool(record), "record": record}

@api.post("/daily-closing/close")
async def close_daily_closing(data: ResourceInput, user=Depends(current_user)):
    day = data.date or today_local()
    if user.get("role") != "admin" and day != today_local():
        raise HTTPException(400, "O entregador só pode fechar o dia de hoje")
    driver_name = data.driver if user.get("role") == "admin" and data.driver else user["name"]
    existing = await day_closing_record(day, driver_name)
    if existing: return existing

    open_trips = await db.viagens.find({"date": day, "driver": driver_name, "status": {"$ne": "finalizada"}}, {"_id": 0, "codigo_viagem": 1}).to_list(100)
    if open_trips:
        codes = ", ".join(v.get("codigo_viagem") or "sem código" for v in open_trips[:3])
        raise HTTPException(409, f"Finalize ou exclua as viagens abertas antes de fechar o dia: {codes}")

    entries = await db.daily_entries.find({"date": day, "driver": driver_name}, {"_id": 0}).to_list(None)
    expenses = await expenses_for_day(day, driver_name)
    pix = sum(float(e.get("pix_value") or 0) for e in entries)
    cash = sum(float(e.get("cash_value") or 0) for e in entries)
    comp = sum(float(e.get("comp_value") or 0) for e in entries)
    expenses_total = sum(float(e.get("amount") or 0) for e in expenses if e.get("status") != "rejected")
    values = {
        "date": day, "driver": driver_name, "status": "closed", "deliveries": len(entries),
        "revenue": sum(entry_total(e) for e in entries), "pix": pix, "cash": cash, "comp": comp,
        "expenses": expenses_total, "balance": pix + cash - expenses_total,
        "closed_at": now(), "closed_by": user["id"], "closed_by_name": user["name"],
    }
    record = await db.daily_closings.find_one_and_update(
        {"date": day, "driver": driver_name},
        {"$set": values, "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now()}},
        upsert=True, return_document=ReturnDocument.AFTER, projection={"_id": 0},
    )
    await log_activity("daily_closing_closed", user, {"id": record["id"], "name": driver_name}, {"date": day})
    return record

@api.post("/daily-closing/reopen")
async def reopen_daily_closing(data: ResourceInput, user=Depends(admin_user)):
    day = data.date or today_local()
    if not data.driver: raise HTTPException(400, "Informe o entregador")
    record = await day_closing_record(day, data.driver)
    if not record: raise HTTPException(404, "Fechamento não encontrado")
    await db.daily_closings.update_one({"id": record["id"]}, {"$set": {"status": "reopened", "reopened_at": now(), "reopened_by": user["id"], "reopened_by_name": user["name"]}})
    await log_activity("daily_closing_reopened", user, {"id": record["id"], "name": data.driver}, {"date": day})
    return {"message": "Dia reaberto", "date": day, "driver": data.driver}

@api.get("/daily-closing")
async def daily_closing(date: Optional[str] = None, user=Depends(admin_user)):
    day = date or today_local()
    entries = await db.daily_entries.find({"date": day}, {"_id": 0}).to_list(None)
    expenses = await expenses_for_day(day)
    closings = await db.daily_closings.find({"date": day, "status": "closed"}, {"_id": 0}).to_list(500)
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
    for closing in closings:
        name = closing.get("driver") or "Sem entregador"
        row = drivers.setdefault(name, {"driver": name, "deliveries_total": 0, "deliveries_done": 0, "revenue": 0, "pix": 0.0, "cash": 0.0, "comp": 0.0, "expenses_approved": 0, "expenses_pending": 0, "expenses_rejected": 0, "balance": 0})
        row["is_closed"] = True; row["closed_at"] = closing.get("closed_at")
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
    entries = await db.daily_entries.find(query, {"_id": 0}).to_list(None)
    exp_query = {}
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end + "T23:59:59"
        exp_query["created_at"] = rng
    expenses = await db.expenses.find(exp_query, {"_id": 0}).to_list(None)
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
    entries = await db.daily_entries.find(query, {"_id": 0}).to_list(None)
    exp_query = {}
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end + "T23:59:59"
        exp_query["created_at"] = rng
    expenses = await db.expenses.find(exp_query, {"_id": 0}).to_list(None)
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

@api.get("/reports/export-stock.csv", response_class=PlainTextResponse)
async def export_stock_csv(user=Depends(admin_user)):
    products = await db.products.find({}, {"_id": 0}).to_list(None)
    lots = await db.lots.find({}, {"_id": 0}).sort([("purchase_date", 1), ("created_at", 1)]).to_list(None)
    brands = await db.brands.find({}, {"_id": 0}).to_list(None)
    code_of = {(b.get("name") or "").strip().lower(): b.get("code") for b in brands}
    open_lots = {}
    for l in lots:
        if float(l.get("quantity_remaining") or 0) > 0: open_lots.setdefault(l["product_id"], []).append(l)
    buf = io.StringIO(); w = csv.writer(buf)
    w.writerow(["Distribuidora Diane - Estoque"]); w.writerow(["Gerado em", now_local().strftime("%d/%m/%Y %H:%M")]); w.writerow([])
    w.writerow(["PRODUTOS"])
    w.writerow(["SKU", "Produto", "Marca", "Categoria", "Disponível", "Mínimo", "Defeito", "Vazio", "Valor em estoque"])
    for p in products:
        pl = open_lots.get(p["id"])
        value = sum(float(l["quantity_remaining"]) * float(l["cost_unit"]) for l in pl) if pl else float(p.get("quantity") or 0) * float(p.get("cost_price") or 0)
        w.writerow([code_of.get((p.get("brand") or p.get("name") or "").strip().lower(), ""), p.get("name"), p.get("brand", ""), p.get("category", ""), p.get("quantity", 0), p.get("minimum", ""), p.get("defective_quantity", 0), p.get("empty_quantity", 0), f"{value:.2f}"])
    w.writerow([]); w.writerow(["LOTES DE COMPRA"])
    w.writerow(["Lote", "Data da compra", "Produto", "Comprado", "Restante", "Custo (água)", "Custo (completa)", "Valor restante", "Observação"])
    for l in lots:
        w.writerow([l.get("code"), l.get("purchase_date"), l.get("product_name"), l.get("quantity_initial"), l.get("quantity_remaining"), l.get("cost_unit"), l.get("cost_unit_full") if l.get("cost_unit_full") is not None else "", f"{float(l.get('quantity_remaining') or 0) * float(l.get('cost_unit') or 0):.2f}", l.get("notes") or ""])
    return Response(content="﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="distribuidora-diane-estoque.csv"'})

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
        await db.products.insert_many([{"id":"p1","name":"Galão 20L","category":"Retornável","quantity":84,"minimum":30,"unit":"un"},{"id":"p2","name":"Fardo 500ml (12un)","category":"Descartável","quantity":18,"minimum":25,"unit":"fardo"},{"id":"p3","name":"Água mineral 1,5L","category":"Descartável","quantity":42,"minimum":20,"unit":"fardo"}])

app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=[os.environ["FRONTEND_URL"]], allow_methods=["*"], allow_headers=["*"])
logging.basicConfig(level=logging.INFO)
@app.on_event("shutdown")
async def shutdown(): client.close()
