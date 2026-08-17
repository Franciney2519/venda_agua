from dotenv import load_dotenv
from pathlib import Path
import os, uuid, logging, bcrypt, jwt, time, requests
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import FastAPI, APIRouter, HTTPException, Request, Depends, Response
from fastapi.responses import PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorClient
import csv, io

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]
app = FastAPI(title="HydroSaaS API")
api = APIRouter(prefix="/api")
JWT_ALGORITHM = "HS256"

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

class ResourceInput(BaseModel):
    name: Optional[str] = None
    customer: Optional[str] = None
    address: Optional[str] = None
    driver: Optional[str] = None
    product: Optional[str] = None
    quantity: Optional[int] = 1
    value: Optional[float] = 0
    type: Optional[str] = None
    amount: Optional[float] = 0
    category: Optional[str] = None
    minimum: Optional[int] = 10
    status: Optional[str] = "pending"

class RoutePlanInput(BaseModel):
    delivery_ids: list[str] = []
    city: str = "São Paulo"
    state: str = "SP"

def now(): return datetime.now(timezone.utc).isoformat()
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
async def root(): return {"message": "HydroSaaS online"}

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
    deliveries = await db.deliveries.find({}, {"_id": 0}).sort("created_at", -1).to_list(20)
    products = await db.products.find({}, {"_id": 0}).to_list(100)
    expenses = await db.expenses.find({}, {"_id": 0}).to_list(100)
    revenue = sum(float(d.get("value", 0)) for d in deliveries if d.get("status") == "delivered")
    return {"revenue": revenue, "expenses": sum(float(e.get("amount", 0)) for e in expenses), "deliveries": deliveries, "products": products, "expenses_list": expenses, "user": user}

async def list_resource(collection): return await db[collection].find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
async def create_resource(collection, payload, user):
    doc = payload.model_dump(exclude_none=True); doc.update({"id": str(uuid.uuid4()), "created_at": now(), "created_by": user["id"]})
    await db[collection].insert_one(doc); doc.pop("_id", None); return doc

@api.get("/products")
async def products(user=Depends(current_user)): return await list_resource("products")
@api.post("/products")
async def add_product(data: ResourceInput, user=Depends(admin_user)): return await create_resource("products", data, user)
@api.get("/deliveries")
async def deliveries(user=Depends(current_user)): return await list_resource("deliveries")
@api.post("/deliveries")
async def add_delivery(data: ResourceInput, user=Depends(admin_user)): return await create_resource("deliveries", data, user)
@api.patch("/deliveries/{item_id}")
async def update_delivery(item_id: str, data: ResourceInput, user=Depends(current_user)):
    values = data.model_dump(exclude_unset=True); await db.deliveries.update_one({"id": item_id}, {"$set": values})
    doc = await db.deliveries.find_one({"id": item_id}, {"_id": 0}); return doc
@api.get("/expenses")
async def expenses(user=Depends(current_user)): return await list_resource("expenses")
@api.post("/expenses")
async def add_expense(data: ResourceInput, user=Depends(current_user)): return await create_resource("expenses", data, user)
@api.patch("/expenses/{item_id}")
async def update_expense(item_id: str, data: ResourceInput, user=Depends(admin_user)):
    target = await db.expenses.find_one({"id": item_id}, {"_id": 0})
    if not target: raise HTTPException(404, "Lançamento não encontrado")
    values = data.model_dump(exclude_unset=True); values["reviewed_by"] = user["name"]; values["reviewed_at"] = now()
    await db.expenses.update_one({"id": item_id}, {"$set": values})
    doc = await db.expenses.find_one({"id": item_id}, {"_id": 0})
    await log_activity(f"expense_{doc.get('status','updated')}", user, {"id": item_id, "name": doc.get("type"), "email": doc.get("driver")})
    return doc
@api.get("/customers")
async def customers(user=Depends(current_user)): return await list_resource("customers")
@api.post("/customers")
async def add_customer(data: ResourceInput, user=Depends(admin_user)): return await create_resource("customers", data, user)

@api.get("/users")
async def list_users(user=Depends(admin_user)):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(500)
    return docs

@api.post("/users")
async def create_user(data: UserInput, user=Depends(admin_user)):
    if not data.email or not data.password or not data.name: raise HTTPException(400, "Nome, e-mail e senha são obrigatórios")
    email = data.email.lower().strip()
    if await db.users.find_one({"email": email}): raise HTTPException(409, "Este e-mail já está cadastrado")
    doc = {"id": str(uuid.uuid4()), "email": email, "name": data.name.strip(), "role": data.role or "driver", "status": "approved", "active": True, "password_hash": hash_password(data.password), "created_at": now()}
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

@api.get("/reports")
async def reports(start: Optional[str] = None, end: Optional[str] = None, user=Depends(admin_user)):
    query = {}
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end + "T23:59:59"
        query["created_at"] = rng
    deliveries = await db.deliveries.find(query, {"_id": 0}).to_list(1000)
    expenses = await db.expenses.find(query, {"_id": 0}).to_list(1000)
    products = await db.products.find({}, {"_id": 0}).to_list(1000)
    drivers = {}
    for item in deliveries:
        name = item.get("driver") or "Sem entregador"
        row = drivers.setdefault(name, {"driver": name, "deliveries": 0, "delivered": 0, "revenue": 0})
        row["deliveries"] += 1; row["revenue"] += float(item.get("value", 0))
        if item.get("status") == "delivered": row["delivered"] += 1
    return {"revenue": sum(float(x.get("value", 0)) for x in deliveries if x.get("status") == "delivered"), "expenses": sum(float(x.get("amount", 0)) for x in expenses), "deliveries": len(deliveries), "low_stock": sum(1 for x in products if x.get("quantity", 0) < x.get("minimum", 0)), "drivers": list(drivers.values()), "products": products, "period": {"start": start, "end": end}}

@api.get("/reports/export.csv", response_class=PlainTextResponse)
async def export_reports_csv(start: Optional[str] = None, end: Optional[str] = None, user=Depends(admin_user)):
    query = {}
    if start or end:
        rng = {}
        if start: rng["$gte"] = start
        if end: rng["$lte"] = end + "T23:59:59"
        query["created_at"] = rng
    deliveries = await db.deliveries.find(query, {"_id": 0}).to_list(1000)
    expenses = await db.expenses.find(query, {"_id": 0}).to_list(1000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["HydroFlow - Relatório Operacional"])
    w.writerow(["Período", start or "início", end or "hoje"])
    w.writerow([])
    w.writerow(["ENTREGAS"])
    w.writerow(["Data", "Cliente", "Endereço", "Entregador", "Produto", "Qtd", "Valor", "Status"])
    for d in deliveries:
        w.writerow([d.get("created_at",""), d.get("customer",""), d.get("address",""), d.get("driver",""), d.get("product",""), d.get("quantity",""), d.get("value",""), d.get("status","")])
    w.writerow([])
    w.writerow(["DESPESAS"])
    w.writerow(["Data", "Tipo", "Entregador", "Valor", "Status"])
    for e in expenses:
        w.writerow([e.get("created_at",""), e.get("type",""), e.get("driver",""), e.get("amount",""), e.get("status","")])
    return Response(content=buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="hydroflow-relatorio.csv"'})

@api.post("/routes/plan")
async def plan_route(data: RoutePlanInput, user=Depends(current_user)):
    deliveries = await db.deliveries.find({"id": {"$in": data.delivery_ids}}, {"_id": 0}).to_list(100)
    if not deliveries: raise HTTPException(400, "Nenhuma parada selecionada")
    stops = []
    for delivery in deliveries:
        query = f"{delivery.get('address', '')}, {data.city}, {data.state}, Brasil"
        cached = await db.geocodes.find_one({"query": query}, {"_id": 0})
        result = cached
        if not result:
            response = requests.get("https://nominatim.openstreetmap.org/search", params={"q": query, "format": "jsonv2", "limit": 1, "addressdetails": 1}, headers={"User-Agent": "HydroFlow/1.0 route-planner"}, timeout=12)
            matches = response.json() if response.ok else []
            if matches:
                result = {"query": query, "lat": float(matches[0]["lat"]), "lng": float(matches[0]["lon"]), "display_name": matches[0].get("display_name", query)}
                await db.geocodes.update_one({"query": query}, {"$set": result}, upsert=True)
            time.sleep(1.05)
        stops.append({"id": delivery["id"], "customer": delivery.get("customer"), "address": delivery.get("address"), "lat": result.get("lat") if result else None, "lng": result.get("lng") if result else None, "display_name": result.get("display_name") if result else "Endereço não encontrado"})
    located = [x for x in stops if x["lat"] is not None and x["lng"] is not None]
    route = {"distance_m": 0, "duration_s": 0, "geometry": []}
    if len(located) >= 2:
        coordinates = ";".join(f"{x['lng']},{x['lat']}" for x in located)
        response = requests.get(f"https://router.project-osrm.org/route/v1/driving/{coordinates}", params={"overview": "full", "geometries": "geojson"}, headers={"User-Agent": "HydroFlow/1.0 route-planner"}, timeout=15)
        if response.ok and response.json().get("routes"):
            selected = response.json()["routes"][0]
            route = {"distance_m": selected["distance"], "duration_s": selected["duration"], "geometry": selected.get("geometry", {}).get("coordinates", [])}
    return {"stops": stops, "route": route, "provider": "OpenStreetMap + OSRM"}

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
    if await db.deliveries.count_documents({}) == 0:
        await db.deliveries.insert_many([{ "id":"d1","customer":"Condomínio Vista Verde","address":"Av. das Nações, 440","driver":"Carlos Mendes","product":"Galão 20L","quantity":6,"value":108,"status":"delivered","created_at":now()},{"id":"d2","customer":"Padaria Pão & Prosa","address":"Rua do Comércio, 82","driver":"Carlos Mendes","product":"Galão 20L","quantity":4,"value":72,"status":"in_transit","created_at":now()},{"id":"d3","customer":"Restaurante Quintal","address":"Rua das Flores, 19","driver":"Ana Souza","product":"Fardo 500ml","quantity":8,"value":192,"status":"pending","created_at":now()}])
    if await db.expenses.count_documents({}) == 0: await db.expenses.insert_one({"id":"e1","type":"Combustível","amount":85,"driver":"Carlos Mendes","status":"pending","created_at":now()})

app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=[os.environ["FRONTEND_URL"]], allow_methods=["*"], allow_headers=["*"])
logging.basicConfig(level=logging.INFO)
@app.on_event("shutdown")
async def shutdown(): client.close()