"""Backup do banco em arquivos JSON (uma pasta por execução, uma coleção por arquivo).

Uso (dentro de backend/):
    python backup.py                 # grava em backups/AAAAMMDD-HHMM/
    python backup.py --keep 14       # mantém só os 14 backups mais recentes
    python backup.py --with-passwords  # inclui password_hash dos usuários (por padrão é removido)

Restaurar: importar cada JSON com mongoimport --jsonArray, ou pymongo insert_many.
Agende no Agendador de Tarefas do Windows para rodar todo dia.
"""
import argparse, os, shutil, sys
from datetime import datetime
from pathlib import Path

from bson import json_util
from dotenv import load_dotenv
from pymongo import MongoClient

ROOT = Path(__file__).parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", type=int, default=0, help="quantos backups manter (0 = todos)")
    ap.add_argument("--with-passwords", action="store_true")
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    db = MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=20000)[os.environ["DB_NAME"]]
    out_root = ROOT / "backups"
    out = out_root / datetime.now().strftime("%Y%m%d-%H%M")
    out.mkdir(parents=True, exist_ok=True)

    total = 0
    for name in sorted(db.list_collection_names()):
        projection = None if (args.with_passwords or name != "users") else {"password_hash": 0}
        docs = list(db[name].find({}, projection))
        (out / f"{name}.json").write_text(json_util.dumps(docs, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{name}: {len(docs)} registros")
        total += len(docs)
    print(f"Backup salvo em {out} ({total} registros)")

    if args.keep > 0:
        old = sorted(p for p in out_root.iterdir() if p.is_dir())[:-args.keep]
        for p in old:
            shutil.rmtree(p)
            print(f"Removido backup antigo {p.name}")


if __name__ == "__main__":
    sys.exit(main())
