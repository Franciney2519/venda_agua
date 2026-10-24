"""Camada pgdoc (Postgres) x MongoDB (mongomock): mesmas consultas, mesmos resultados.

Só roda com PG_TEST_URL apontando para um Postgres de teste, ex.:
    PG_TEST_URL=postgresql://postgres@localhost:55432/postgres python -m pytest tests/inmemory/test_pgdoc.py -n 0
"""
import asyncio, os, uuid

import asyncpg
import pytest
from mongomock_motor import AsyncMongoMockClient
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from pgdoc import PgDatabase

PG_URL = os.environ.get("PG_TEST_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="PG_TEST_URL não definido")

DOCS = [
    {"id": "a", "date": "2026-10-01", "driver": "Ana", "qty": 5, "resolved": False, "reason": "mf_defeito", "tags": ["x", "y"],
     "items": [{"brand": "Crystal", "out_of_catalog": True}, {"brand": "Lindoya", "out_of_catalog": False}], "created_at": "2026-10-01T10:00:00+00:00"},
    {"id": "b", "date": "2026-10-05", "driver": "Bruno", "qty": 2.5, "resolved": True, "reason": "vasilhame_vazio", "tags": "x",
     "items": [{"brand": "Crystal", "out_of_catalog": True, "promoted": True}], "created_at": "2026-10-05T09:00:00+00:00"},
    {"id": "c", "date": ["2026-10-02", "2026-11-30"], "driver": "ana", "qty": "7", "reason": "sem_correspondencia", "created_at": "2026-10-03T09:00:00+00:00",
     "rotas": [{"id": "r1", "clientes": [{"name": "Padaria Sol"}]}]},
    {"id": "d", "date": "2026-11-01", "driver": None, "qty": 0, "resolved": False, "status": "rejected", "created_at": "2026-11-01T00:00:00+00:00"},
    {"id": "e", "qty": 10, "status": "pending", "created_at": "2026-09-01T00:00:00+00:00"},
]

FILTERS = [
    {}, {"driver": "Ana"}, {"driver": None}, {"tags": "x"}, {"resolved": False}, {"resolved": True},
    {"date": {"$gte": "2026-10-02"}}, {"date": {"$gte": "2026-10-01", "$lte": "2026-10-31"}}, {"date": "2026-11-30"},
    {"qty": {"$gt": 2}}, {"qty": {"$lte": 2.5}}, {"qty": 5.0},
    {"reason": {"$in": ["mf_defeito", "mf_reagendado"]}, "resolved": False},
    {"$or": [{"resolved": False}, {"reason": "sem_correspondencia"}]},
    {"status": {"$ne": "rejected"}}, {"status": {"$exists": False}},
    {"driver": {"$regex": "^ana$", "$options": "i"}},
    {"items": {"$elemMatch": {"out_of_catalog": True, "promoted": {"$ne": True}}}},
    {"rotas.clientes.name": "Padaria Sol"}, {"items.brand": "Crystal", "items.out_of_catalog": True},
    {"created_at": {"$gte": "2026-10-01T00:00:00+00:00", "$lte": "2026-10-31T23:59:59+00:00"}, "status": {"$ne": "rejected"}},
]


def run(coro_fn):
    async def main():
        schema = "t_" + uuid.uuid4().hex[:12]
        pg = PgDatabase(PG_URL, schema=schema)
        mongo = AsyncMongoMockClient()["test"]
        try: await coro_fn(pg, mongo)
        finally:
            await pg.close()
            conn = await asyncpg.connect(PG_URL)
            try: await conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
            finally: await conn.close()
    asyncio.run(main())


def test_filters_match_mongodb():
    async def body(pg, mongo):
        for d in DOCS:
            await pg.entries.insert_one(dict(d)); await mongo.entries.insert_one(dict(d))
        for f in FILTERS:
            got = [d["id"] for d in await pg.entries.find(f, {"_id": 0}).to_list(None)]
            exp = [d["id"] for d in await mongo.entries.find(f, {"_id": 0}).to_list(None)]
            assert sorted(got) == sorted(exp), f"filtro {f}: pg={got} mongo={exp}"
            assert await pg.entries.count_documents(f) == len(exp)
    run(body)


def test_sort_limit_projection():
    async def body(pg, mongo):
        for d in DOCS:
            await pg.entries.insert_one(dict(d)); await mongo.entries.insert_one(dict(d))
        for spec in (("created_at", -1), ("created_at", 1)):
            # O Motor real corta no tamanho pedido em to_list; o mongomock_motor ignora, por isso o [:3].
            got = [d["id"] for d in await pg.entries.find({}, {"_id": 0}).sort(*spec).to_list(3)]
            exp = [d["id"] for d in await mongo.entries.find({}, {"_id": 0}).sort(*spec).to_list(None)][:3]
            assert got == exp
        got = [d["id"] for d in await pg.entries.find({}, {"_id": 0}).sort([("driver", 1), ("created_at", -1)]).to_list(None)]
        exp = [d["id"] for d in await mongo.entries.find({}, {"_id": 0}).sort([("driver", 1), ("created_at", -1)]).to_list(None)]
        assert got == exp
        assert await pg.entries.find_one({"id": "a"}, {"_id": 0, "id": 1, "driver": 1}) == {"id": "a", "driver": "Ana"}
        doc = await pg.entries.find_one({"id": "a"}, {"_id": 0, "items": 0})
        assert "items" not in doc and doc["qty"] == 5
    run(body)


def test_updates_match_mongodb():
    async def body(pg, mongo):
        for d in DOCS:
            await pg.entries.insert_one(dict(d)); await mongo.entries.insert_one(dict(d))
        ops = [
            ("update_one", {"id": "a"}, {"$inc": {"qty": -2}, "$set": {"updated": True}}, {}),
            ("update_many", {"resolved": False}, {"$set": {"resolved": True}, "$unset": {"reason": ""}}, {}),
            ("update_one", {"id": "c"}, {"$push": {"rotas": {"id": "r2", "clientes": []}}}, {}),
            ("update_one", {"id": "c"}, {"$pull": {"rotas": {"id": "r1"}}}, {}),
            ("update_many", {"items.brand": "Crystal", "items.out_of_catalog": True}, {"$set": {"items.$[elem].promoted": True}},
             {"array_filters": [{"elem.brand": "Crystal", "elem.out_of_catalog": True}]}),
            ("update_one", {"id": "zz"}, {"$set": {"qty": 1}, "$setOnInsert": {"created_at": "x"}}, {"upsert": True}),
        ]
        for name, f, u, kw in ops:
            await getattr(pg.entries, name)(f, u, **kw)
            if "array_filters" in kw:
                # mongomock não tem array_filters: no "a" o 1º item é o Crystal fora do catálogo; o "b" já está promovido.
                await mongo.entries.update_one({"id": "a"}, {"$set": {"items.0.promoted": True}})
            else:
                await getattr(mongo.entries, name)(f, u, **kw)
        got = {d["id"]: d for d in await pg.entries.find({}, {"_id": 0}).to_list(None)}
        exp = {d["id"]: d for d in await mongo.entries.find({}, {"_id": 0}).to_list(None)}
        assert got == exp
        await pg.entries.delete_one({"id": "zz"}); await pg.entries.delete_many({"resolved": True})
        assert sorted(d["id"] for d in await pg.entries.find({}).to_list(None)) == ["c", "e"]  # os sem "resolved"
    run(body)


def test_counter_is_atomic_and_unique_index():
    async def body(pg, mongo):
        async def bump():
            doc = await pg.counters.find_one_and_update({"_id": "entry"}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
            return doc["seq"]
        seqs = await asyncio.gather(*(bump() for _ in range(40)))
        assert sorted(seqs) == list(range(1, 41))
        await pg.users.create_index("email", unique=True)
        await pg.users.insert_one({"id": "1", "email": "a@t.com"})
        with pytest.raises(DuplicateKeyError):
            await pg.users.insert_one({"id": "2", "email": "a@t.com"})
        assert await pg.users.count_documents({}) == 1
        await pg.lots.create_index([("product_id", 1), ("purchase_date", 1)])
        assert await pg.command("ping") == {"ok": 1.0}
    run(body)
