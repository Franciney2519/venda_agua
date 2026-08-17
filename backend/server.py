from dotenv import load_dotenv
from pathlib import Path
import os, uuid, logging, bcrypt, jwt
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import FastAPI, APIRouter, HTTPException, Request, Depends, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorClient

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

@api.get("/")
async def root(): return {"message": "HydroSaaS online"}

@api.post("/auth/login")
async def login(data: LoginInput, response: Response):
    user = await db.users.find_one({"email": data.email.lower()}, {"_id": 0})
    if not user or not check_password(data.password, user["password_hash"]): raise HTTPException(401, "E-mail ou senha inválidos")
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
    await db[collection].insert_one(doc); return doc

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
    values = data.model_dump(exclude_none=True); await db.deliveries.update_one({"id": item_id}, {"$set": values})
    doc = await db.deliveries.find_one({"id": item_id}, {"_id": 0}); return doc
@api.get("/expenses")
async def expenses(user=Depends(current_user)): return await list_resource("expenses")
@api.post("/expenses")
async def add_expense(data: ResourceInput, user=Depends(current_user)): return await create_resource("expenses", data, user)

@app.on_event("startup")
async def seed():
    await db.users.create_index("email", unique=True)
    if not await db.users.find_one({"email": os.environ["ADMIN_EMAIL"]}):
        await db.users.insert_one({"id":"admin-1","email":os.environ["ADMIN_EMAIL"],"name":"Marina Costa","role":"admin","password_hash":hash_password(os.environ["ADMIN_PASSWORD"])})
    if not await db.users.find_one({"email": os.environ["DRIVER_EMAIL"]}):
        await db.users.insert_one({"id":"driver-1","email":os.environ["DRIVER_EMAIL"],"name":"Carlos Mendes","role":"driver","password_hash":hash_password(os.environ["DRIVER_PASSWORD"])})
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