"""Entrada do servidor na Vercel: a função serverless expõe o mesmo app FastAPI do server.py."""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import app  # noqa: E402,F401
