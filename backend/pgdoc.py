"""Banco Postgres (ex.: Lakebase) com a mesma interface do Motor que o server.py usa.

Cada coleção vira uma tabela `(pk bigserial, doc jsonb)`. Assim as regras de negócio continuam
escritas em consultas estilo MongoDB e os dados mantêm o mesmo formato.

- Leitura: um pré-filtro em SQL (igualdade, $in e faixas em campos de topo) corta a maior parte das
  linhas; o filtro exato roda em Python com o motor do mongomock, então a semântica é a do MongoDB.
- Escrita: cada operação roda numa transação com trava por tabela (pg_advisory_xact_lock). Isso deixa
  $inc de estoque, contadores e upserts atômicos, como no MongoDB. As atualizações ($set, $inc, $push,
  $pull, $unset, $[elem]…) são aplicadas pelo mongomock, sobre uma cópia do documento.
"""
import asyncio, copy, json, re
from datetime import date, datetime
from decimal import Decimal

import asyncpg
from mongomock import MongoClient as _MockClient
from mongomock.filtering import filter_applies
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_FIELD = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_RANGE_OPS = {"$gt": ">", "$gte": ">=", "$lt": "<", "$lte": "<="}
_SENTINEL_ID = "__pgdoc__"

# Coleção em memória usada só para aplicar operadores de atualização com a semântica do MongoDB.
# Chamadas síncronas, sem await no meio: o loop do asyncio nunca a usa por duas operações ao mesmo tempo.
_scratch = _MockClient()["pgdoc"]["scratch"]


def _json_default(v):
    if isinstance(v, (datetime, date)): return v.isoformat()
    if isinstance(v, Decimal): return float(v)
    return str(v)


def _dumps(v): return json.dumps(v, default=_json_default, ensure_ascii=False)


def _ident(name):
    if not _NAME.match(name): raise ValueError(f"Nome inválido para tabela/esquema: {name!r}")
    return f'"{name}"'


def _is_scalar(v): return v is not None and isinstance(v, (str, int, float, bool))


class _Sql:
    """Monta o pré-filtro com parâmetros numerados ($1, $2…)."""
    def __init__(self): self.params = []

    def p(self, value, cast):
        self.params.append(value)
        return f"${len(self.params)}::{cast}"

    def where(self, flt):
        """Retorna uma condição SQL que aceita TODO documento que o filtro aceitaria (pode aceitar a mais)."""
        parts = [c for c in (self._clause(k, v) for k, v in (flt or {}).items()) if c]
        return " AND ".join(parts) if parts else "TRUE"

    def _clause(self, key, value):
        if key == "$and" and isinstance(value, list):
            parts = [self.where(sub) for sub in value]
            return " AND ".join(f"({x})" for x in parts if x != "TRUE") or None
        if key == "$or" and isinstance(value, list):
            parts = [self.where(sub) for sub in value]
            if not parts or "TRUE" in parts: return None
            return "(" + " OR ".join(f"({x})" for x in parts) + ")"
        if key.startswith("$") or not _FIELD.match(key): return None
        if _is_scalar(value):
            # Igualdade, ou campo-lista que contém o valor, como no MongoDB. As duas formas usam o índice GIN.
            return f"(doc @> {self.p({key: value}, 'jsonb')} OR doc @> {self.p({key: [value]}, 'jsonb')})"
        if isinstance(value, dict) and value and all(k.startswith("$") for k in value):
            conds = []
            for op, arg in value.items():
                if op in _RANGE_OPS: conds.append(self._range(key, _RANGE_OPS[op], arg))
                elif op == "$in" and isinstance(arg, (list, tuple)) and arg and all(_is_scalar(x) for x in arg):
                    conds.append(f"doc @> ANY({self.p([{key: x} for x in arg] + [{key: [x]} for x in arg], 'jsonb[]')})")
            conds = [c for c in conds if c]
            return " AND ".join(conds) if conds else None
        return None

    def _range(self, key, sql_op, arg):
        k = self.p(key, "text")
        if isinstance(arg, str):
            # COLLATE "C" compara byte a byte, igual ao MongoDB. Campo-lista passa para o filtro exato.
            return (f"(CASE jsonb_typeof(doc->{k}) WHEN 'string' THEN (doc->>{k}) COLLATE \"C\" {sql_op} {self.p(arg, 'text')} "
                    f"WHEN 'array' THEN TRUE ELSE FALSE END)")
        if isinstance(arg, (int, float)) and not isinstance(arg, bool):
            return (f"(CASE jsonb_typeof(doc->{k}) WHEN 'number' THEN (doc->>{k})::float8 {sql_op} {self.p(float(arg), 'float8')} "
                    f"WHEN 'array' THEN TRUE ELSE FALSE END)")
        return None


def _sort_key(v):
    # Ordem de tipos do MongoDB: nulo/ausente < números < textos < objetos < listas < booleanos.
    if v is None: return (1, 0)
    if isinstance(v, bool): return (8, v)
    if isinstance(v, (int, float)): return (2, v)
    if isinstance(v, str): return (3, v)
    if isinstance(v, dict): return (4, _dumps(v))
    if isinstance(v, list): return (5, _dumps(v))
    return (9, str(v))


def _get_path(doc, path):
    cur = doc
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur: return None
        cur = cur[part]
    return cur


def _sorted(docs, spec):
    for field, direction in reversed(spec):
        docs.sort(key=lambda d: _sort_key(_get_path(d, field)), reverse=direction < 0)
    return docs


def _project(doc, projection):
    if not projection: return doc
    keep_id = bool(projection.get("_id", 1))
    include = [k for k, v in projection.items() if v and k != "_id"]
    if include:
        out = {k: doc[k] for k in include if k in doc}
        if keep_id and "_id" in doc: out["_id"] = doc["_id"]
        return out
    out = {k: v for k, v in doc.items() if projection.get(k, 1)}
    if not keep_id: out.pop("_id", None)
    return out


_ARRAY_FILTER = re.compile(r"^\$\[(\w+)\]$")


def _set_filtered(doc, parts, value, filters):
    """$set em caminho com `$[elem]` (array_filters), que o mongomock não implementa."""
    node, last = doc, len(parts) - 1
    for i, part in enumerate(parts):
        m = _ARRAY_FILTER.match(part)
        if m:
            if i == last or not isinstance(node, list): raise NotImplementedError("array_filters: caminho não suportado")
            for el in node:
                if filter_applies(filters.get(m.group(1), {}), el): _set_filtered(el, parts[i + 1:], value, filters)
            return
        if i == last:
            if isinstance(node, dict): node[part] = value
            return
        if not isinstance(node, dict) or part not in node: return
        node = node[part]


def _apply_update(doc, update, array_filters=None):
    d = copy.deepcopy(doc)
    if array_filters:
        filters = {}
        for af in array_filters:
            for k, v in af.items():
                ident, _, rest = k.partition(".")
                filters.setdefault(ident, {})[rest] = v
        update = dict(update)
        plain = {}
        for path, value in (update.pop("$set", None) or {}).items():
            if "$[" in path: _set_filtered(d, path.split("."), value, filters)
            else: plain[path] = value
        if any("$[" in p for op in update.values() for p in op): raise NotImplementedError("array_filters só com $set")
        if plain: update["$set"] = plain
        if not update: return d
    had_id = "_id" in d
    if not had_id: d["_id"] = _SENTINEL_ID
    _scratch.delete_many({})
    _scratch.insert_one(d)
    _scratch.update_one({"_id": d["_id"]}, update)
    out = _scratch.find_one({"_id": d["_id"]})
    _scratch.delete_many({})
    if not had_id: out.pop("_id", None)
    return out


def _upsert_doc(flt, update, array_filters=None):
    _scratch.delete_many({})
    res = _scratch.update_one(flt, update, upsert=True, array_filters=array_filters)
    out = _scratch.find_one({"_id": res.upserted_id})
    _scratch.delete_many({})
    # O _id só fica quando veio do filtro (ex.: contadores); o ObjectId gerado não vai para o banco.
    if "_id" not in flt: out.pop("_id", None)
    return out


class _Result:
    def __init__(self, matched=0, modified=0, deleted=0, upserted_id=None, inserted_id=None, inserted_ids=None):
        self.matched_count, self.modified_count, self.deleted_count = matched, modified, deleted
        self.upserted_id, self.inserted_id, self.inserted_ids = upserted_id, inserted_id, inserted_ids or []
        self.acknowledged = True


class Cursor:
    def __init__(self, coll, flt, projection):
        self._coll, self._filter, self._projection = coll, flt or {}, projection
        self._sort, self._skip, self._limit = [], 0, 0

    def sort(self, key, direction=None):
        self._sort = list(key) if isinstance(key, (list, tuple)) else [(key, direction or 1)]
        return self

    def skip(self, n): self._skip = n; return self

    def limit(self, n): self._limit = n; return self

    async def to_list(self, length=None):
        docs = await self._coll._matching(self._filter)
        if self._sort: _sorted(docs, self._sort)
        docs = docs[self._skip:]
        limits = [x for x in (self._limit, length) if x]
        if limits: docs = docs[:min(limits)]
        return [_project(d, self._projection) for d in docs]

    def __aiter__(self): return self._iter()

    async def _iter(self):
        for d in await self.to_list(None): yield d


class Collection:
    def __init__(self, database, name):
        self._db, self.name = database, name
        self._table = f"{_ident(database.schema)}.{_ident(name)}"

    async def _rows(self, conn, flt):
        sql = _Sql()
        where = sql.where(flt)
        rows = await conn.fetch(f"SELECT pk, doc FROM {self._table} WHERE {where} ORDER BY pk", *sql.params)
        return [(r["pk"], r["doc"]) for r in rows if filter_applies(flt or {}, r["doc"])]

    async def _matching(self, flt):
        async with self._db.acquire(self.name) as conn:
            return [doc for _, doc in await self._rows(conn, flt)]

    def _write(self): return self._db.transaction(self.name)

    async def _store(self, conn, pk, doc):
        try: await conn.execute(f"UPDATE {self._table} SET doc = $1::jsonb WHERE pk = $2", doc, pk)
        except asyncpg.UniqueViolationError as e: raise DuplicateKeyError(str(e)) from e

    async def _insert(self, conn, doc):
        try: await conn.execute(f"INSERT INTO {self._table} (doc) VALUES ($1::jsonb)", doc)
        except asyncpg.UniqueViolationError as e: raise DuplicateKeyError(str(e)) from e

    # ---- leitura ----
    def find(self, filter=None, projection=None, **kw):
        return Cursor(self, filter, kw.get("projection", projection))

    async def find_one(self, filter=None, projection=None, **kw):
        docs = await self._matching(filter)
        return _project(docs[0], kw.get("projection", projection)) if docs else None

    async def count_documents(self, filter=None, **kw):
        return len(await self._matching(filter))

    # ---- escrita ----
    async def insert_one(self, doc, **kw):
        async with self._write() as conn: await self._insert(conn, doc)
        return _Result(inserted_id=doc.get("_id", doc.get("id")))

    async def insert_many(self, docs, **kw):
        docs = list(docs)
        async with self._write() as conn:
            for d in docs: await self._insert(conn, d)
        return _Result(inserted_ids=[d.get("_id", d.get("id")) for d in docs])

    async def _update(self, flt, update, many, upsert=False, array_filters=None):
        async with self._write() as conn:
            rows = await self._rows(conn, flt)
            if not many: rows = rows[:1]
            for pk, doc in rows:
                new = _apply_update(doc, update, array_filters)
                if new != doc: await self._store(conn, pk, new)
            if not rows and upsert:
                new = _upsert_doc(flt, update, array_filters)
                await self._insert(conn, new)
                return _Result(upserted_id=new.get("_id", new.get("id")))
            return _Result(matched=len(rows), modified=len(rows))

    async def update_one(self, filter, update, upsert=False, array_filters=None, **kw):
        return await self._update(filter, update, False, upsert, array_filters)

    async def update_many(self, filter, update, upsert=False, array_filters=None, **kw):
        return await self._update(filter, update, True, upsert, array_filters)

    async def find_one_and_update(self, filter, update, projection=None, upsert=False, return_document=ReturnDocument.BEFORE, array_filters=None, **kw):
        after = return_document == ReturnDocument.AFTER
        async with self._write() as conn:
            rows = (await self._rows(conn, filter))[:1]
            if rows:
                pk, before = rows[0]
                new = _apply_update(before, update, array_filters)
                await self._store(conn, pk, new)
                return _project(new if after else before, projection)
            if not upsert: return None
            new = _upsert_doc(filter, update, array_filters)
            await self._insert(conn, new)
            return _project(new, projection) if after else None

    async def _delete(self, flt, many):
        async with self._write() as conn:
            rows = await self._rows(conn, flt)
            if not many: rows = rows[:1]
            if rows: await conn.execute(f"DELETE FROM {self._table} WHERE pk = ANY($1::bigint[])", [pk for pk, _ in rows])
            return _Result(deleted=len(rows))

    async def delete_one(self, filter, **kw): return await self._delete(filter, False)

    async def delete_many(self, filter, **kw): return await self._delete(filter, True)

    # ---- índices ----
    async def create_index(self, keys, unique=False, **kw):
        fields = [keys] if isinstance(keys, str) else [k for k, _ in keys]
        if not all(_FIELD.match(f) for f in fields): return None
        name = f"{self.name}_{'_'.join(fields)}_{'uniq' if unique else 'idx'}"[:63]
        if unique:
            cols = ", ".join(f"(doc->>'{f}')" for f in fields)
        else:
            cols = ", ".join(f"((doc->>'{f}') COLLATE \"C\")" for f in fields)
        async with self._db.acquire(self.name) as conn:
            await conn.execute(f"CREATE {'UNIQUE ' if unique else ''}INDEX IF NOT EXISTS {_ident(name)} ON {self._table} ({cols})")
        return name


class _Acquire:
    def __init__(self, database, collection, transaction):
        self._db, self._coll, self._tx = database, collection, transaction

    async def __aenter__(self):
        pool = await self._db._get_pool()
        self._conn = await pool.acquire()
        try:
            await self._db._ensure_table(self._conn, self._coll)
            if self._tx:
                self._txn = self._conn.transaction()
                await self._txn.start()
                await self._conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", f"{self._db.schema}.{self._coll}")
        except BaseException:
            await pool.release(self._conn)
            raise
        return self._conn

    async def __aexit__(self, exc_type, exc, tb):
        pool = await self._db._get_pool()
        try:
            if self._tx:
                if exc_type: await self._txn.rollback()
                else: await self._txn.commit()
        finally:
            await pool.release(self._conn)


class PgDatabase:
    def __init__(self, dsn, schema="public", **pool_kwargs):
        _ident(schema)
        self.dsn, self.schema, self._pool_kwargs = dsn, schema, pool_kwargs
        self._pool, self._pool_lock, self._pool_loop, self._tables = None, None, None, set()

    async def _get_pool(self):
        loop = asyncio.get_running_loop()
        if self._pool is not None and self._pool_loop is not loop:
            # Em hospedagem serverless cada chamada pode vir num loop novo; o pool antigo não serve mais nele.
            self._pool, self._pool_lock = None, None
        if self._pool is None:
            if self._pool_lock is None: self._pool_lock = asyncio.Lock()
            async with self._pool_lock:
                if self._pool is None:
                    async def init(conn):
                        await conn.set_type_codec("jsonb", encoder=_dumps, decoder=json.loads, schema="pg_catalog")
                    # statement_cache_size=0: funciona também atrás de pooler em modo transação.
                    self._pool = await asyncpg.create_pool(self.dsn, init=init, statement_cache_size=0,
                                                           **{"min_size": 1, "max_size": 10, **self._pool_kwargs})
                    self._pool_loop = loop
        return self._pool

    async def _ensure_table(self, conn, name):
        if name in self._tables: return
        table = f"{_ident(self.schema)}.{_ident(name)}"
        async with conn.transaction():
            # Trava para dois processos não criarem a mesma tabela ao mesmo tempo.
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext('pgdoc-ddl'))")
            await conn.execute(f"CREATE SCHEMA IF NOT EXISTS {_ident(self.schema)}")
            await conn.execute(f"CREATE TABLE IF NOT EXISTS {table} (pk bigserial PRIMARY KEY, doc jsonb NOT NULL)")
            await conn.execute(f"CREATE INDEX IF NOT EXISTS {_ident((name + '_doc_gin')[:63])} ON {table} USING gin (doc jsonb_path_ops)")
        self._tables.add(name)

    def acquire(self, collection): return _Acquire(self, collection, False)

    def transaction(self, collection): return _Acquire(self, collection, True)

    def __getitem__(self, name): return Collection(self, name)

    def __getattr__(self, name):
        if name.startswith("_"): raise AttributeError(name)
        return Collection(self, name)

    async def command(self, cmd, *a, **kw):
        pool = await self._get_pool()
        await pool.fetchval("SELECT 1")
        return {"ok": 1.0}

    async def list_collection_names(self):
        pool = await self._get_pool()
        rows = await pool.fetch("SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name", self.schema)
        return [r["table_name"] for r in rows]

    async def close(self):
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
