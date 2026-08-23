import os, requests, pytest
BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or 'https://water-delivery-pro-6.preview.emergentagent.com').rstrip('/')

def login(email, password):
    return requests.post(f'{BASE_URL}/api/auth/login', json={'email': email, 'password': password}, timeout=20)

@pytest.fixture(scope='module')
def admin_token():
    r = login('admin@hydroflow.com', 'admin123'); assert r.status_code == 200
    return r.json()['token']

@pytest.fixture(scope='module')
def driver_token():
    r = login('carlos@hydroflow.com', 'driver123'); assert r.status_code == 200
    return r.json()['token']

def H(t): return {'Authorization': f'Bearer {t}'}

# Reports with date range
def test_reports_no_filter(admin_token):
    r = requests.get(f'{BASE_URL}/api/reports', headers=H(admin_token), timeout=20)
    assert r.status_code == 200
    d = r.json()
    for k in ('revenue','expenses','deliveries','low_stock','drivers','period'):
        assert k in d, f'missing {k}'
    assert isinstance(d['drivers'], list)

def test_reports_with_range(admin_token):
    r = requests.get(f'{BASE_URL}/api/reports', headers=H(admin_token),
                     params={'start':'2024-01-01','end':'2030-01-01'}, timeout=20)
    assert r.status_code == 200
    d = r.json()
    assert d['period']['start'] == '2024-01-01'
    assert d['period']['end'] == '2030-01-01'
    assert d['deliveries'] >= 0

def test_reports_empty_range(admin_token):
    r = requests.get(f'{BASE_URL}/api/reports', headers=H(admin_token),
                     params={'start':'1990-01-01','end':'1990-12-31'}, timeout=20)
    assert r.status_code == 200
    assert r.json()['deliveries'] == 0

def test_reports_forbidden_for_driver(driver_token):
    r = requests.get(f'{BASE_URL}/api/reports', headers=H(driver_token), timeout=20)
    assert r.status_code == 403

def test_reports_unauth():
    r = requests.get(f'{BASE_URL}/api/reports', timeout=20)
    assert r.status_code == 401

# CSV export
def test_export_csv_admin(admin_token):
    r = requests.get(f'{BASE_URL}/api/reports/export.csv', headers=H(admin_token),
                     params={'start':'2024-01-01','end':'2030-01-01'}, timeout=20)
    assert r.status_code == 200
    assert 'text/csv' in r.headers.get('content-type','')
    body = r.text
    assert 'HydroFlow' in body
    assert 'LANÇAMENTOS' in body
    assert 'DESPESAS' in body
    # header row present
    assert 'Cliente' in body and 'Marcas' in body

def test_export_csv_driver_forbidden(driver_token):
    r = requests.get(f'{BASE_URL}/api/reports/export.csv', headers=H(driver_token), timeout=20)
    assert r.status_code == 403
