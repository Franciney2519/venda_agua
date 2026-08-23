import os, requests, pytest
BASE_URL=os.environ.get('REACT_APP_BACKEND_URL') or 'https://water-delivery-pro-6.preview.emergentagent.com'
BASE_URL=BASE_URL.rstrip('/')

def login(email,password):
    return requests.post(f'{BASE_URL}/api/auth/login',json={'email':email,'password':password},timeout=20)

@pytest.fixture(scope='module')
def admin():
    r=login('admin@hydroflow.com','admin123'); assert r.status_code==200, r.text
    d=r.json(); assert d['role']=='admin' and d['email']=='admin@hydroflow.com' and d['token']
    return d

@pytest.fixture(scope='module')
def driver():
    r=login('carlos@hydroflow.com','driver123'); assert r.status_code==200, r.text
    d=r.json(); assert d['role']=='driver' and d['email']=='carlos@hydroflow.com' and d['token']
    return d

def test_admin_me(admin):
    r=requests.get(f'{BASE_URL}/api/auth/me',headers={'Authorization':f"Bearer {admin['token']}"})
    assert r.status_code==200; assert r.json()['id']=='admin-1'

def test_driver_me(driver):
    r=requests.get(f'{BASE_URL}/api/auth/me',headers={'Authorization':f"Bearer {driver['token']}"})
    assert r.status_code==200; assert r.json()['role']=='driver'

def test_dashboard(admin):
    r=requests.get(f'{BASE_URL}/api/dashboard',headers={'Authorization':f"Bearer {admin['token']}"})
    assert r.status_code==200; d=r.json(); assert {'revenue','expenses','deliveries','products','expenses_list'}<=d.keys()

def test_daily_entry_lifecycle(admin, driver):
    h={'Authorization':f"Bearer {driver['token']}"}
    payload={'customer':'TEST_ReviewCliente','items':[{'brand':'Minalar','price':6.0,'quantity':2,'mf_quantity':0}],'pix_value':12.0,'cash_value':0,'comp_value':0}
    r=requests.post(f'{BASE_URL}/api/daily-entries',headers=h,json=payload)
    assert r.status_code==200, r.text
    entry=r.json(); assert entry['total']==12.0
    ah={'Authorization':f"Bearer {admin['token']}"}
    dr=requests.delete(f"{BASE_URL}/api/daily-entries/{entry['id']}",headers=ah)
    assert dr.status_code==200

def test_resources(admin):
    h={'Authorization':f"Bearer {admin['token']}"}
    for endpoint,key in [('products','name'),('expenses','amount')]:
        r=requests.get(f'{BASE_URL}/api/{endpoint}',headers=h); assert r.status_code==200 and isinstance(r.json(),list) and key in r.json()[0]
