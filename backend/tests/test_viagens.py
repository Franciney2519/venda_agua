"""Tests for the trip (viagem) code system: unique código de viagem per
turno+data+rota, max 2 rotas per turno (4/dia) per entregador, and the
planejada -> execução -> finalizada lifecycle.
"""
import os
import random
from datetime import datetime, timedelta

import requests
import pytest

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

ADMIN = {"email": "admin@hydroflow.com", "password": "admin123"}
DRIVER = {"email": "carlos@hydroflow.com", "password": "driver123"}


def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds)
    assert r.status_code == 200, r.text
    body = r.json()
    return body["token"], body


@pytest.fixture(scope="module")
def admin_ctx():
    tok, user = _login(ADMIN)
    return {"headers": {"Authorization": f"Bearer {tok}"}, "user": user}


@pytest.fixture(scope="module")
def driver_ctx():
    tok, user = _login(DRIVER)
    return {"headers": {"Authorization": f"Bearer {tok}"}, "user": user}


@pytest.fixture(scope="module")
def test_date():
    """A far-future, randomized date so repeated test runs never collide
    on the unique codigo_viagem index."""
    offset = random.randint(2000, 9000)
    return (datetime.now() + timedelta(days=offset)).date().isoformat()


def _codigo(turno, date_str, rota):
    d = datetime.fromisoformat(date_str)
    return f"{turno}{d.day:02d}{d.month:02d}{d.year:04d}{str(rota).zfill(3)}"


class TestCodigoViagem:
    def test_criar_viagem_gera_codigo_correto(self, driver_ctx, test_date):
        r = requests.post(
            f"{BASE_URL}/api/viagens",
            headers=driver_ctx["headers"],
            json={"turno": 0, "rota": 1, "date": test_date, "carga_total": 360},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["codigo_viagem"] == _codigo(0, test_date, 1)
        assert len(data["codigo_viagem"]) == 12
        assert data["status"] == "planejada"
        assert data["numero"] == 1
        assert data["driver"] == driver_ctx["user"]["name"]

    def test_codigo_duplicado_rejeitado(self, driver_ctx, test_date):
        # turno 0 / rota 1 / test_date já foi criada no teste anterior
        r = requests.post(
            f"{BASE_URL}/api/viagens",
            headers=driver_ctx["headers"],
            json={"turno": 0, "rota": 1, "date": test_date},
        )
        assert r.status_code == 409, r.text

    def test_listar_viagens_do_dia(self, driver_ctx, test_date):
        r = requests.get(
            f"{BASE_URL}/api/viagens",
            headers=driver_ctx["headers"],
            params={"date": test_date},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["limite"] == 4
        assert data["total"] >= 1
        assert any(v["codigo_viagem"] == _codigo(0, test_date, 1) for v in data["viagens"])

    def test_limite_duas_rotas_por_turno(self, driver_ctx, test_date):
        # rota 2 no mesmo turno 0 -> OK (2ª do turno)
        r2 = requests.post(
            f"{BASE_URL}/api/viagens",
            headers=driver_ctx["headers"],
            json={"turno": 0, "rota": 2, "date": test_date},
        )
        assert r2.status_code == 200, r2.text

        # 3ª rota no turno 0 -> deve falhar (máx 2 por turno)
        r3 = requests.post(
            f"{BASE_URL}/api/viagens",
            headers=driver_ctx["headers"],
            json={"turno": 0, "rota": 3, "date": test_date},
        )
        assert r3.status_code == 400, r3.text

    def test_turno_tarde_tem_limite_independente(self, driver_ctx, test_date):
        # turno 1 (tarde) ainda não tem nenhuma viagem nesse dia -> deve permitir
        r = requests.post(
            f"{BASE_URL}/api/viagens",
            headers=driver_ctx["headers"],
            json={"turno": 1, "rota": 1, "date": test_date},
        )
        assert r.status_code == 200, r.text
        assert r.json()["codigo_viagem"] == _codigo(1, test_date, 1)

    def test_iniciar_e_finalizar_viagem(self, driver_ctx, test_date):
        create = requests.post(
            f"{BASE_URL}/api/viagens",
            headers=driver_ctx["headers"],
            json={"turno": 1, "rota": 2, "date": test_date},
        )
        assert create.status_code == 200, create.text
        viagem_id = create.json()["id"]

        start = requests.post(f"{BASE_URL}/api/viagens/{viagem_id}/iniciar", headers=driver_ctx["headers"])
        assert start.status_code == 200, start.text
        assert start.json()["status"] == "execucao"

        finish = requests.post(f"{BASE_URL}/api/viagens/{viagem_id}/finalizar", headers=driver_ctx["headers"])
        assert finish.status_code == 200, finish.text
        finished = finish.json()
        assert finished["status"] == "finalizada"
        assert "total_bruto" in finished
        assert "quantidade_entregue" in finished

    def test_nao_deleta_viagem_finalizada(self, driver_ctx):
        offset = random.randint(9501, 9999)
        other_date = (datetime.now() + timedelta(days=offset)).date().isoformat()
        create = requests.post(
            f"{BASE_URL}/api/viagens",
            headers=driver_ctx["headers"],
            json={"turno": 0, "rota": 1, "date": other_date},
        )
        assert create.status_code == 200, create.text
        viagem_id = create.json()["id"]
        requests.post(f"{BASE_URL}/api/viagens/{viagem_id}/iniciar", headers=driver_ctx["headers"])
        requests.post(f"{BASE_URL}/api/viagens/{viagem_id}/finalizar", headers=driver_ctx["headers"])

        delete = requests.delete(f"{BASE_URL}/api/viagens/{viagem_id}", headers=driver_ctx["headers"])
        assert delete.status_code == 400, delete.text

    def test_deleta_viagem_planejada(self, driver_ctx):
        offset = random.randint(9001, 9500)
        other_date = (datetime.now() + timedelta(days=offset)).date().isoformat()
        create = requests.post(
            f"{BASE_URL}/api/viagens",
            headers=driver_ctx["headers"],
            json={"turno": 0, "rota": 1, "date": other_date},
        )
        assert create.status_code == 200, create.text
        viagem_id = create.json()["id"]

        delete = requests.delete(f"{BASE_URL}/api/viagens/{viagem_id}", headers=driver_ctx["headers"])
        assert delete.status_code == 200, delete.text
        assert delete.json()["message"] == "Excluída"

    def test_admin_ve_viagens_de_todos(self, admin_ctx, test_date):
        r = requests.get(
            f"{BASE_URL}/api/viagens",
            headers=admin_ctx["headers"],
            params={"date": test_date},
        )
        assert r.status_code == 200, r.text
        assert r.json()["total"] >= 1
