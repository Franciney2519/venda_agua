"""In-memory API tests: run the real FastAPI app against mongomock (no MongoDB, no network).

Run from backend/:  pytest tests/inmemory -n 0
"""
import os, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
os.environ.update(MONGO_URL="mongodb://inmemory", DB_NAME="test", JWT_SECRET="x" * 40, ADMIN_EMAIL="admin@t.com", ADMIN_PASSWORD="admin123",
                  DRIVER_EMAIL="carlos@t.com", DRIVER_PASSWORD="driver123", FRONTEND_URL="http://localhost:3000")

import motor.motor_asyncio as _motor
from mongomock_motor import AsyncMongoMockClient
_motor.AsyncIOMotorClient = AsyncMongoMockClient

import dotenv
dotenv.load_dotenv = lambda *a, **k: None

import pytest
from fastapi.testclient import TestClient


class Checker:
    def __init__(self): self.fails = []
    def __call__(self, name, got, exp):
        ok = (abs(got - exp) < 0.005) if isinstance(exp, (int, float)) and isinstance(got, (int, float)) and not isinstance(exp, bool) else got == exp
        if not ok: self.fails.append(f"{name}: got={got!r} expected={exp!r}")
        return ok

    def assert_ok(self):
        assert not self.fails, "\n" + "\n".join(self.fails)


@pytest.fixture(scope="module")
def c():
    import server
    server.db = AsyncMongoMockClient()["test"]
    with TestClient(server.app) as client:
        yield client
