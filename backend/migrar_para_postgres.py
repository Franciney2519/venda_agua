"""Copia todos os dados do MongoDB (MONGO_URL/DB_NAME do backend/.env) para o Postgres/Lakebase.

Uso (dentro de backend/):
    set DATABASE_URL=postgresql://usuario@host/databricks_postgres?sslmode=require
    python migrar_para_postgres.py --conferir      # só mostra quantos registros há em cada coleção
    python migrar_para_postgres.py                 # copia (pede a senha/token se não estiver na URL)
    python migrar_para_postgres.py --substituir    # apaga o que já houver no Postgres e copia de novo

O MongoDB só é lido, nunca alterado. Ao final, confere se cada tabela ficou com o mesmo número de registros.
A senha pode vir em PGPASSWORD; sem ela o script pergunta sem mostrar o que é digitado. No Lakebase serve o
token OAuth (vale 1 hora) com o e-mail como usuário.
"""
import argparse, asyncio, getpass, json, os, sys
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlparse

import asyncpg
from bson import ObjectId, Decimal128
from dotenv import load_dotenv
from pymongo import MongoClient

from pgdoc import PgDatabase, _dumps, _ident

ROOT = Path(__file__).parent


def plain(v):
    """Tipos do BSON viram JSON comum, no mesmo formato que o app já grava."""
    if isinstance(v, dict): return {k: plain(x) for k, x in v.items()}
    if isinstance(v, list): return [plain(x) for x in v]
    if isinstance(v, ObjectId): return str(v)
    if isinstance(v, Decimal128): return float(v.to_decimal())
    if isinstance(v, (datetime, date)): return v.isoformat()
    return v


def clean(doc):
    doc = dict(doc)
    # O _id gerado pelo MongoDB não é usado pelo app; _id escolhido pelo app (ex.: contadores) é mantido.
    if isinstance(doc.get("_id"), ObjectId): doc.pop("_id")
    return plain(doc)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--conferir", action="store_true", help="só conta os registros do MongoDB")
    ap.add_argument("--substituir", action="store_true", help="apaga as tabelas do Postgres antes de copiar")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    mongo = MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=20000)[os.environ["DB_NAME"]]
    names = sorted(n for n in mongo.list_collection_names() if not n.startswith("system."))
    counts = {n: mongo[n].count_documents({}) for n in names}
    for n in names: print(f"  {n}: {counts[n]} registros")
    print(f"MongoDB: {sum(counts.values())} registros em {len(names)} coleções")
    if args.conferir: return

    dsn = os.environ.get("DATABASE_URL")
    if not dsn: sys.exit("Defina DATABASE_URL com o endereço do Postgres (veja o topo deste arquivo).")
    password = os.environ.get("PGPASSWORD") or (None if urlparse(dsn).password else getpass.getpass("Senha/token do Postgres: "))
    schema = os.environ.get("PG_SCHEMA", "public")

    conn = await asyncpg.connect(dsn, password=password, statement_cache_size=0)
    pg = PgDatabase(dsn, schema=schema)
    try:
        await conn.set_type_codec("jsonb", encoder=_dumps, decoder=json.loads, schema="pg_catalog")
        busy = []
        for n in names:
            await pg._ensure_table(conn, n)
            if await conn.fetchval(f"SELECT count(*) FROM {_ident(schema)}.{_ident(n)}"): busy.append(n)
        if busy and not args.substituir:
            sys.exit(f"O Postgres já tem dados em: {', '.join(busy)}. Nada foi copiado. Use --substituir para apagar e copiar de novo.")

        async with conn.transaction():  # tudo ou nada: se algo falhar, o Postgres fica como estava
            for n in names:
                table = f"{_ident(schema)}.{_ident(n)}"
                if args.substituir: await conn.execute(f"TRUNCATE {table}")
                docs = [clean(d) for d in mongo[n].find({})]
                if docs: await conn.executemany(f"INSERT INTO {table} (doc) VALUES ($1::jsonb)", [(d,) for d in docs])
                print(f"  {n}: {len(docs)} copiados")

        wrong = []
        for n in names:
            got = await conn.fetchval(f"SELECT count(*) FROM {_ident(schema)}.{_ident(n)}")
            if got != counts[n]: wrong.append(f"{n} (MongoDB {counts[n]}, Postgres {got})")
        if wrong: sys.exit("ATENÇÃO, contagem diferente em: " + "; ".join(wrong))
        print(f"Pronto: {sum(counts.values())} registros copiados e conferidos. Os índices são criados quando o servidor liga.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
